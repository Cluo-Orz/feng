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
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model     string        `json:"model"`
	Messages  []chatMessage `json:"messages"`
	MaxTokens int           `json:"max_tokens"`
	Stream    bool          `json:"stream"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Role             string `json:"role"`
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
}

func defaultProviderProfile() ProviderProfile {
	model := os.Getenv("FENG_LLM_MODEL")
	if model == "" {
		model = "deepseek-chat"
	}
	return ProviderProfile{
		ID:        "deepseek",
		Protocol:  "openai_chat",
		BaseURL:   "https://api.deepseek.com",
		APIKeyEnv: "DEEPSEEK_API_KEY",
		Model:     model,
	}
}

func compileGrowMessages(workspace, goal string) []chatMessage {
	state, _ := loadState(workspace)
	selfCommit := currentHead(workspace)
	manifest := map[string]any{
		"mode":             state.Mode,
		"candidate_status": state.CandidateStatus,
		"validated_commit": state.ValidatedCommit,
		"self_commit":      selfCommit,
		"self_files":       selfFileIndex(workspace),
	}
	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	return []chatMessage{
		{
			Role: "system",
			Content: "You are feng, a minimal self-growing agent kernel. Keep large evidence in files/artifacts. " +
				"Do not claim validation; validation is performed by feng check.",
		},
		{
			Role:    "system",
			Content: "self contract:\n" + string(manifestJSON),
		},
		{
			Role: "user",
			Content: "Grow this feng workspace toward the goal:\n" + goal + "\n" +
				"This Go runtime validation turn has no tool-call dispatcher yet. Reply with a concise next-step summary only.",
		},
	}
}

func callOpenAIChat(profile ProviderProfile, messages []chatMessage) (string, error) {
	apiKey := os.Getenv(profile.APIKeyEnv)
	if apiKey == "" {
		return "", LLMError{Kind: "missing_config", Message: "missing env " + profile.APIKeyEnv}
	}
	payload := chatRequest{
		Model:     profile.Model,
		Messages:  messages,
		MaxTokens: 256,
		Stream:    false,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", LLMError{Kind: "request_error", Message: err.Error()}
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(profile.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", LLMError{Kind: "request_error", Message: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", LLMError{Kind: "transient", Message: err.Error()}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", normalizeLLMHTTPError(resp.StatusCode, string(data))
	}
	var parsed chatResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", LLMError{Kind: "provider_error", Message: "invalid provider response: " + err.Error()}
	}
	if len(parsed.Choices) == 0 {
		return "", LLMError{Kind: "provider_error", Message: "provider response has no choices"}
	}
	message := parsed.Choices[0].Message
	if strings.TrimSpace(message.Content) != "" {
		return message.Content, nil
	}
	if strings.TrimSpace(message.ReasoningContent) != "" {
		return message.ReasoningContent, nil
	}
	return "", nil
}

func normalizeLLMHTTPError(status int, body string) LLMError {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		trimmed = fmt.Sprintf("provider returned HTTP %d", status)
	}
	switch status {
	case 401, 402:
		return LLMError{Kind: "config_error", Message: trimmed}
	case 429, 500, 503:
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
