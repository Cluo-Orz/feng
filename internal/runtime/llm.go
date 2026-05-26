package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type ProviderProfile struct {
	ID        string
	Protocol  string
	BaseURL   string
	APIKeyEnv string
	Model     string
}

type LLMError struct {
	Kind    string
	Message string
}

func (e LLMError) Error() string {
	return e.Message
}

type chatMessage struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
}

type chatRequest struct {
	Model      string           `json:"model"`
	Messages   []chatMessage    `json:"messages"`
	Tools      []map[string]any `json:"tools,omitempty"`
	ToolChoice string           `json:"tool_choice,omitempty"`
	MaxTokens  int              `json:"max_tokens"`
	Stream     bool             `json:"stream"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Role             string     `json:"role"`
			Content          string     `json:"content"`
			ReasoningContent string     `json:"reasoning_content"`
			ToolCalls        []ToolCall `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
	Usage map[string]any `json:"usage"`
}

type anthropicRequest struct {
	Model      string             `json:"model"`
	System     string             `json:"system,omitempty"`
	Messages   []anthropicMessage `json:"messages"`
	Tools      []map[string]any   `json:"tools,omitempty"`
	ToolChoice map[string]string  `json:"tool_choice,omitempty"`
	MaxTokens  int                `json:"max_tokens"`
	Stream     bool               `json:"stream"`
}

type anthropicMessage struct {
	Role    string                  `json:"role"`
	Content []anthropicContentBlock `json:"content"`
}

type anthropicContentBlock struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Input     any    `json:"input,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
}

type anthropicResponse struct {
	Content []struct {
		Type  string          `json:"type"`
		Text  string          `json:"text"`
		ID    string          `json:"id"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	} `json:"content"`
	Usage map[string]any `json:"usage"`
}

type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type AssistantTurn struct {
	Content   string
	ToolCalls []ToolCall
	Usage     map[string]any
}

func defaultProviderProfile() ProviderProfile {
	model := os.Getenv("FENG_LLM_MODEL")
	if model == "" {
		model = "deepseek-chat"
	}
	baseURL := os.Getenv("FENG_LLM_BASE_URL")
	if baseURL == "" {
		baseURL = "https://api.deepseek.com"
	}
	return ProviderProfile{
		ID:        "deepseek",
		Protocol:  "openai_chat",
		BaseURL:   baseURL,
		APIKeyEnv: "DEEPSEEK_API_KEY",
		Model:     model,
	}
}

func loadProviderProfile(workspace string) (ProviderProfile, error) {
	for _, path := range providerProfileCandidates(workspace) {
		if path == "" || !exists(path) {
			continue
		}
		value, err := readJSONFile(path)
		if err != nil {
			return ProviderProfile{}, err
		}
		raw, _ := value.(map[string]any)
		profile := ProviderProfile{
			ID:        firstNonEmpty(argString(raw, "id"), "provider"),
			Protocol:  firstNonEmpty(argString(raw, "protocol"), "openai_chat"),
			BaseURL:   argString(raw, "base_url"),
			APIKeyEnv: argString(raw, "api_key_env"),
			Model:     firstNonEmpty(argString(raw, "default_model"), argString(raw, "model")),
		}
		profile = applyProviderEnvOverrides(profile)
		return validateProviderProfile(profile)
	}
	return validateProviderProfile(defaultProviderProfile())
}

func providerProfileCandidates(workspace string) []string {
	candidates := []string{}
	if explicit := strings.TrimSpace(os.Getenv("FENG_PROVIDER_CONFIG")); explicit != "" {
		candidates = append(candidates, explicit)
	}
	candidates = append(candidates,
		filepath.Join(workspace, ".feng", "provider.yaml"),
		filepath.Join(workspace, ".feng", "provider.json"),
	)
	if root := strings.TrimSpace(os.Getenv("FENG_HOME")); root != "" {
		candidates = append(candidates,
			filepath.Join(root, "provider.yaml"),
			filepath.Join(root, "provider.json"),
		)
	}
	return candidates
}

func applyProviderEnvOverrides(profile ProviderProfile) ProviderProfile {
	if model := strings.TrimSpace(os.Getenv("FENG_LLM_MODEL")); model != "" {
		profile.Model = model
	}
	if baseURL := strings.TrimSpace(os.Getenv("FENG_LLM_BASE_URL")); baseURL != "" {
		profile.BaseURL = baseURL
	}
	return profile
}

func validateProviderProfile(profile ProviderProfile) (ProviderProfile, error) {
	if strings.TrimSpace(profile.Protocol) == "" {
		profile.Protocol = "openai_chat"
	}
	if strings.TrimSpace(profile.ID) == "" {
		profile.ID = "provider"
	}
	if profile.Protocol != "openai_chat" && profile.Protocol != "anthropic_messages" {
		return profile, LLMError{Kind: "request_error", Message: "unsupported provider protocol in MVP: " + profile.Protocol}
	}
	if strings.TrimSpace(profile.BaseURL) == "" {
		return profile, LLMError{Kind: "request_error", Message: "provider base_url is required"}
	}
	if strings.TrimSpace(profile.APIKeyEnv) == "" {
		return profile, LLMError{Kind: "request_error", Message: "provider api_key_env is required"}
	}
	if strings.TrimSpace(profile.Model) == "" {
		return profile, LLMError{Kind: "request_error", Message: "provider model is required"}
	}
	return profile, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func compileGrowMessages(workspace, goal string) []chatMessage {
	state, _ := loadState(workspace)
	selfCommit := currentHead(workspace)
	selfContract := map[string]any{
		"self_commit":   selfCommit,
		"self_files":    selfFileIndex(workspace),
		"identity":      fileTextExcerpt(workspace, "identity.md", 2000),
		"goal":          fileTextExcerpt(workspace, "goal.md", 2000),
		"skill_catalog": skillCatalog(workspace, 80),
		"world_index":   worldIndex(workspace, 200),
	}
	stateManifest := map[string]any{
		"mode":                 state.Mode,
		"current_goal":         state.CurrentGoal,
		"candidate_status":     state.CandidateStatus,
		"validated_commit":     state.ValidatedCommit,
		"git":                  gitContext(workspace),
		"workspace_file_index": workspaceFileIndex(workspace, 300),
		"recent_events":        recentEventRefs(workspace, 8),
		"artifact_refs":        artifactRefs(workspace, 10),
	}
	selfContractJSON, _ := json.MarshalIndent(selfContract, "", "  ")
	stateManifestJSON, _ := json.MarshalIndent(stateManifest, "", "  ")
	return []chatMessage{
		{
			Role: "system",
			Content: "You are feng, a minimal self-growing agent kernel. Use tool calls when you need to inspect or change the workspace. " +
				"Keep large evidence in files/artifacts. Do not claim validation; validation is performed by feng check.",
		},
		{
			Role:    "system",
			Content: "self contract:\n" + string(selfContractJSON),
		},
		{
			Role:    "user",
			Content: "state manifest:\n" + string(stateManifestJSON),
		},
		{
			Role: "user",
			Content: "Grow this feng workspace toward the goal:\n" + goal + "\n" +
				"Use tools to inspect and modify files when useful. Stop when this turn has made coherent progress.",
		},
	}
}

func callProvider(profile ProviderProfile, messages []chatMessage, tools []map[string]any) (AssistantTurn, error) {
	if _, err := validateProviderProfile(profile); err != nil {
		return AssistantTurn{}, err
	}
	switch profile.Protocol {
	case "openai_chat":
		return callOpenAIChat(profile, messages, tools)
	case "anthropic_messages":
		return callAnthropicMessages(profile, messages, tools)
	default:
		return AssistantTurn{}, LLMError{Kind: "request_error", Message: "unsupported provider protocol in MVP: " + profile.Protocol}
	}
}

func callOpenAIChat(profile ProviderProfile, messages []chatMessage, tools []map[string]any) (AssistantTurn, error) {
	if _, err := validateProviderProfile(profile); err != nil {
		return AssistantTurn{}, err
	}
	apiKey := os.Getenv(profile.APIKeyEnv)
	if apiKey == "" {
		return AssistantTurn{}, LLMError{Kind: "missing_config", Message: "missing env " + profile.APIKeyEnv}
	}
	payload := chatRequest{
		Model:      profile.Model,
		Messages:   messages,
		Tools:      tools,
		ToolChoice: "auto",
		MaxTokens:  1024,
		Stream:     false,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return AssistantTurn{}, LLMError{Kind: "request_error", Message: err.Error()}
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(profile.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return AssistantTurn{}, LLMError{Kind: "request_error", Message: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return AssistantTurn{}, LLMError{Kind: "transient", Message: err.Error()}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return AssistantTurn{}, normalizeLLMHTTPError(resp.StatusCode, string(data))
	}
	var parsed chatResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return AssistantTurn{}, LLMError{Kind: "provider_error", Message: "invalid provider response: " + err.Error()}
	}
	if len(parsed.Choices) == 0 {
		return AssistantTurn{}, LLMError{Kind: "provider_error", Message: "provider response has no choices"}
	}
	message := parsed.Choices[0].Message
	turn := AssistantTurn{ToolCalls: message.ToolCalls, Usage: normalizeUsage(parsed.Usage)}
	if strings.TrimSpace(message.Content) != "" {
		turn.Content = message.Content
		return turn, nil
	}
	if strings.TrimSpace(message.ReasoningContent) != "" {
		turn.Content = message.ReasoningContent
		return turn, nil
	}
	return turn, nil
}

func callAnthropicMessages(profile ProviderProfile, messages []chatMessage, tools []map[string]any) (AssistantTurn, error) {
	if _, err := validateProviderProfile(profile); err != nil {
		return AssistantTurn{}, err
	}
	apiKey := os.Getenv(profile.APIKeyEnv)
	if apiKey == "" {
		return AssistantTurn{}, LLMError{Kind: "missing_config", Message: "missing env " + profile.APIKeyEnv}
	}
	system, anthropicMessages := convertAnthropicMessages(messages)
	payload := anthropicRequest{
		Model:      profile.Model,
		System:     system,
		Messages:   anthropicMessages,
		Tools:      anthropicTools(tools),
		ToolChoice: map[string]string{"type": "auto"},
		MaxTokens:  1024,
		Stream:     false,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return AssistantTurn{}, LLMError{Kind: "request_error", Message: err.Error()}
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(profile.BaseURL, "/")+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return AssistantTurn{}, LLMError{Kind: "request_error", Message: err.Error()}
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return AssistantTurn{}, LLMError{Kind: "transient", Message: err.Error()}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return AssistantTurn{}, normalizeLLMHTTPError(resp.StatusCode, string(data))
	}
	var parsed anthropicResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return AssistantTurn{}, LLMError{Kind: "provider_error", Message: "invalid provider response: " + err.Error()}
	}
	turn := AssistantTurn{Usage: normalizeAnthropicUsage(parsed.Usage)}
	var text []string
	for _, block := range parsed.Content {
		switch block.Type {
		case "text":
			if strings.TrimSpace(block.Text) != "" {
				text = append(text, block.Text)
			}
		case "tool_use":
			raw := strings.TrimSpace(string(block.Input))
			if raw == "" || raw == "null" {
				raw = "{}"
			}
			turn.ToolCalls = append(turn.ToolCalls, ToolCall{
				ID:   block.ID,
				Type: "function",
				Function: FunctionCall{
					Name:      block.Name,
					Arguments: raw,
				},
			})
		}
	}
	turn.Content = strings.Join(text, "\n")
	return turn, nil
}

func convertAnthropicMessages(messages []chatMessage) (string, []anthropicMessage) {
	var system []string
	var out []anthropicMessage
	for _, message := range messages {
		switch message.Role {
		case "system":
			if strings.TrimSpace(message.Content) != "" {
				system = append(system, message.Content)
			}
		case "assistant":
			var blocks []anthropicContentBlock
			if strings.TrimSpace(message.Content) != "" {
				blocks = append(blocks, anthropicContentBlock{Type: "text", Text: message.Content})
			}
			for _, call := range message.ToolCalls {
				blocks = append(blocks, anthropicContentBlock{
					Type:  "tool_use",
					ID:    call.ID,
					Name:  call.Function.Name,
					Input: parseToolArguments(call.Function.Arguments),
				})
			}
			if len(blocks) > 0 {
				out = appendAnthropicMessage(out, "assistant", blocks...)
			}
		case "tool":
			block := anthropicContentBlock{
				Type:      "tool_result",
				ToolUseID: message.ToolCallID,
				Content:   message.Content,
			}
			out = appendAnthropicMessage(out, "user", block)
		default:
			if strings.TrimSpace(message.Content) != "" {
				out = appendAnthropicMessage(out, "user", anthropicContentBlock{Type: "text", Text: message.Content})
			}
		}
	}
	return strings.Join(system, "\n\n"), out
}

func appendAnthropicMessage(messages []anthropicMessage, role string, blocks ...anthropicContentBlock) []anthropicMessage {
	if len(blocks) == 0 {
		return messages
	}
	if len(messages) > 0 && messages[len(messages)-1].Role == role {
		messages[len(messages)-1].Content = append(messages[len(messages)-1].Content, blocks...)
		return messages
	}
	return append(messages, anthropicMessage{Role: role, Content: blocks})
}

func anthropicTools(tools []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if len(function) == 0 {
			continue
		}
		out = append(out, map[string]any{
			"name":         function["name"],
			"description":  function["description"],
			"input_schema": function["parameters"],
		})
	}
	return out
}

func normalizeUsage(usage map[string]any) map[string]any {
	if len(usage) == 0 {
		return nil
	}
	out := map[string]any{}
	copyUsageInt(out, usage, "prompt_tokens")
	copyUsageInt(out, usage, "completion_tokens")
	copyUsageInt(out, usage, "total_tokens")
	if details, ok := usage["prompt_tokens_details"].(map[string]any); ok {
		copyUsageInt(out, details, "cached_tokens")
	}
	copyUsageInt(out, usage, "prompt_cache_hit_tokens")
	copyUsageInt(out, usage, "prompt_cache_miss_tokens")
	return out
}

func normalizeAnthropicUsage(usage map[string]any) map[string]any {
	if len(usage) == 0 {
		return nil
	}
	out := map[string]any{}
	input := intFromAny(usage["input_tokens"])
	output := intFromAny(usage["output_tokens"])
	if input > 0 {
		out["prompt_tokens"] = input
	}
	if output > 0 {
		out["completion_tokens"] = output
	}
	if input+output > 0 {
		out["total_tokens"] = input + output
	}
	cacheRead := intFromAny(usage["cache_read_input_tokens"])
	if cacheRead > 0 {
		out["cached_tokens"] = cacheRead
		out["prompt_cache_hit_tokens"] = cacheRead
	}
	cacheCreated := intFromAny(usage["cache_creation_input_tokens"])
	if cacheCreated > 0 {
		out["prompt_cache_miss_tokens"] = cacheCreated
	}
	return out
}

func copyUsageInt(out map[string]any, usage map[string]any, key string) {
	if value, ok := usage[key]; ok {
		out[key] = intFromAny(value)
	}
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func normalizeLLMHTTPError(status int, body string) LLMError {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		trimmed = fmt.Sprintf("provider returned HTTP %d", status)
	}
	switch status {
	case 401, 402, 403:
		return LLMError{Kind: "config_error", Message: trimmed}
	case 429, 500, 503, 529:
		return LLMError{Kind: "transient", Message: trimmed}
	case 400, 413, 422:
		if status == 413 || strings.Contains(strings.ToLower(trimmed), "token") {
			return LLMError{Kind: "prompt_too_long", Message: trimmed}
		}
		return LLMError{Kind: "request_error", Message: trimmed}
	default:
		return LLMError{Kind: "provider_error", Message: trimmed}
	}
}

func handleLLMError(workspace string, err error, stdout io.Writer) int {
	llmErr, ok := err.(LLMError)
	if !ok {
		llmErr = LLMError{Kind: "provider_error", Message: err.Error()}
	}
	state, _ := loadState(workspace)
	if llmErr.Kind == "missing_config" {
		state.Mode = "missing_config"
	} else {
		state.Mode = "blocked"
	}
	artifact, _ := writeArtifact(workspace, "provider-error", "llm", llmErr.Message, "LLM error: "+llmErr.Kind, "provider error stopped or delayed the grow loop", "txt", nil)
	state.LastRecovery = map[string]string{"type": llmErr.Kind, "artifact": artifact.Path}
	state.RecoveryCount++
	state.LastArtifacts = []Artifact{artifact}
	saveState(workspace, state)
	appendEvent(workspace, "blocked", map[string]any{"reason": llmErr.Kind, "message": llmErr.Message})
	printJSON(stdout, map[string]any{"ok": false, "reason": llmErr.Kind, "message": llmErr.Message})
	if llmErr.Kind == "missing_config" {
		return 2
	}
	return 1
}

func selfFileIndex(workspace string) []string {
	var names []string
	for name := range selfFiles {
		if exists(filepath.Join(workspace, name)) {
			names = append(names, name)
		}
	}
	for name := range selfDirs {
		root := filepath.Join(workspace, name)
		if !exists(root) {
			continue
		}
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if rel, err := filepath.Rel(workspace, path); err == nil {
				names = append(names, filepath.ToSlash(rel))
			}
			return nil
		})
	}
	sort.Strings(names)
	if len(names) > 200 {
		return names[:200]
	}
	return names
}

func skillCatalog(workspace string, limit int) []map[string]string {
	root := filepath.Join(workspace, "skills")
	if !exists(root) {
		return nil
	}
	limit = clampInt(limit, 1, 500)
	var items []map[string]string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(path), ".md") || strings.EqualFold(filepath.Base(path), "README.md") {
			return nil
		}
		text, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		items = append(items, map[string]string{
			"path":        relPath(workspace, path),
			"description": firstMarkdownLine(string(text), filepath.Base(path)),
		})
		if len(items) >= limit {
			return filepath.SkipAll
		}
		return nil
	})
	return items
}

func worldIndex(workspace string, limit int) []string {
	root := filepath.Join(workspace, "world")
	if !exists(root) {
		return nil
	}
	limit = clampInt(limit, 1, 1000)
	var paths []string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		paths = append(paths, relPath(workspace, path))
		if len(paths) >= limit {
			paths = append(paths, "[truncated]")
			return filepath.SkipAll
		}
		return nil
	})
	sort.Strings(paths)
	return paths
}

func fileTextExcerpt(workspace, rel string, limit int) string {
	data, err := os.ReadFile(filepath.Join(workspace, filepath.FromSlash(rel)))
	if err != nil {
		return ""
	}
	return truncateString(string(data), limit)
}

func firstMarkdownLine(content, fallback string) string {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(line, "#"))
		if line != "" {
			return truncateString(line, 200)
		}
	}
	return fallback
}

func estimateMessageTokens(messages []chatMessage) int {
	total := 0
	for _, message := range messages {
		total += len(message.Role) + len(message.Content)
	}
	if total < 4 {
		return 1
	}
	return total / 4
}
