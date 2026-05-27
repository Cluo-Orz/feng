package runtime

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"time"
)

func callProviderWithRecovery(workspace string, profile ProviderProfile, messages []chatMessage, tools []map[string]any) (AssistantTurn, []chatMessage, error) {
	attempts := providerRetryAttempts()
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		turn, err := callProvider(profile, messages, tools)
		if err == nil {
			return turn, messages, nil
		}
		lastErr = err
		llmErr := asLLMError(err)
		if llmErr.Kind == "prompt_too_long" {
			compacted, changed := compactMessagesForRetry(messages)
			if !changed {
				return AssistantTurn{}, messages, err
			}
			appendEvent(workspace, "context_compacted", map[string]any{
				"reason":        "prompt_too_long",
				"before_tokens": estimateMessageTokens(messages),
				"after_tokens":  estimateMessageTokens(compacted),
			})
			messages = compacted
			turn, retryErr := callProvider(profile, messages, tools)
			if retryErr == nil {
				return turn, messages, nil
			}
			return AssistantTurn{}, messages, retryErr
		}
		if llmErr.Kind == "output_truncated" {
			recoveredMessages := messagesWithOutputContinuation(messages, llmErr)
			appendEvent(workspace, "provider_recovery", map[string]any{
				"reason":        "output_truncated",
				"before_tokens": estimateMessageTokens(messages),
				"after_tokens":  estimateMessageTokens(recoveredMessages),
			})
			turn, retryErr := callProvider(profile, recoveredMessages, tools)
			if retryErr == nil {
				appendEvent(workspace, "provider_recovered", map[string]any{
					"reason": "output_truncated",
				})
				return turn, recoveredMessages, nil
			}
			return AssistantTurn{}, recoveredMessages, retryErr
		}
		if llmErr.Kind != "transient" || attempt+1 >= attempts {
			return AssistantTurn{}, messages, err
		}
		appendEvent(workspace, "provider_retry", map[string]any{
			"provider": profile.ID,
			"model":    profile.Model,
			"attempt":  attempt + 1,
			"reason":   llmErr.Kind,
		})
		time.Sleep(providerRetryDelay())
	}
	return AssistantTurn{}, messages, lastErr
}

func messagesWithOutputContinuation(messages []chatMessage, llmErr LLMError) []chatMessage {
	recovered := make([]chatMessage, 0, len(messages)+2)
	recovered = append(recovered, messages...)
	if llmErr.Partial != nil && strings.TrimSpace(llmErr.Partial.Content) != "" && len(llmErr.Partial.ToolCalls) == 0 {
		recovered = append(recovered, chatMessage{Role: "assistant", Content: llmErr.Partial.Content})
	}
	recovered = append(recovered, chatMessage{
		Role: "user",
		Content: "The provider truncated the previous assistant output. Continue from the last complete point. " +
			"Be concise, prefer valid tool calls when action is needed, and do not repeat already completed text.",
	})
	return recovered
}

func compactMessagesForBudget(workspace string, messages []chatMessage, toolSchemas []map[string]any) ([]chatMessage, bool) {
	maxTokens := maxInputTokens(workspace)
	if maxTokens <= 0 {
		return messages, false
	}
	before := estimateMessageTokens(messages) + estimateJSONTokens(toolSchemas)
	if before <= maxTokens {
		return messages, false
	}
	compacted, changed := compactMessagesForRetry(messages)
	if !changed {
		return messages, false
	}
	after := estimateMessageTokens(compacted) + estimateJSONTokens(toolSchemas)
	appendEvent(workspace, "context_compacted", map[string]any{
		"reason":        "context_budget",
		"max_tokens":    maxTokens,
		"before_tokens": before,
		"after_tokens":  after,
	})
	return compacted, true
}

func asLLMError(err error) LLMError {
	if llmErr, ok := err.(LLMError); ok {
		return llmErr
	}
	return LLMError{Kind: "provider_error", Message: err.Error()}
}

func maxInputTokens(workspace string) int {
	state, err := loadState(workspace)
	if err != nil {
		return maxInputTokensFromState(defaultState(""))
	}
	return maxInputTokensFromState(state)
}

func maxInputTokensFromState(state State) int {
	if raw := strings.TrimSpace(os.Getenv("FENG_MAX_INPUT_TOKENS")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 {
			return parsed
		}
		return 0
	}
	if state.ContextBudget == nil {
		return 0
	}
	return state.ContextBudget["max_input_tokens"]
}

func providerRetryAttempts() int {
	raw := strings.TrimSpace(os.Getenv("FENG_PROVIDER_RETRIES"))
	if raw == "" {
		return 3
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 1 {
		return 1
	}
	if parsed > 5 {
		return 5
	}
	return parsed
}

func providerRetryDelay() time.Duration {
	raw := strings.TrimSpace(os.Getenv("FENG_PROVIDER_RETRY_DELAY_MS"))
	if raw == "" {
		return 200 * time.Millisecond
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 0 {
		return 0
	}
	if parsed > 5000 {
		parsed = 5000
	}
	return time.Duration(parsed) * time.Millisecond
}

func compactMessagesForRetry(messages []chatMessage) ([]chatMessage, bool) {
	compacted := make([]chatMessage, len(messages))
	copy(compacted, messages)
	for i := range compacted {
		message := &compacted[i]
		switch {
		case message.Role == "tool" && len(message.Content) > 1000:
			message.Content = `{"content":"[compacted large tool result after prompt_too_long; use artifact refs or targeted reads if needed]","is_error":false}`
		case message.Role == "user" && strings.HasPrefix(message.Content, "state manifest:\n"):
			message.Content = compactStateManifestMessage(message.Content)
		case message.Role != "system" && len(message.Content) > 4000:
			message.Content = truncateString(message.Content, 4000)
		}
	}
	return compacted, estimateMessageTokens(compacted) < estimateMessageTokens(messages)
}

func compactStateManifestMessage(content string) string {
	raw := strings.TrimPrefix(content, "state manifest:\n")
	var manifest map[string]any
	if json.Unmarshal([]byte(raw), &manifest) != nil {
		return truncateString(content, 4000)
	}
	limitManifestArray(manifest, "workspace_file_index", 80, true)
	if gitData, ok := manifest["git"].(map[string]any); ok {
		limitManifestArray(gitData, "status_short", 40, true)
	}
	limitManifestArray(manifest, "recent_events", 4, false)
	limitManifestArray(manifest, "artifact_refs", 5, false)
	if artifacts, ok := manifest["artifact_refs"].([]any); ok {
		for _, item := range artifacts {
			if artifact, ok := item.(map[string]any); ok {
				artifact["snippets"] = []any{}
			}
		}
	}
	encoded, _ := json.MarshalIndent(manifest, "", "  ")
	return "state manifest:\n" + string(encoded)
}

func limitManifestArray(manifest map[string]any, key string, limit int, keepHead bool) {
	items, ok := manifest[key].([]any)
	if !ok || len(items) <= limit {
		return
	}
	if keepHead {
		manifest[key] = append(items[:limit], "[truncated]")
		return
	}
	manifest[key] = append([]any{"[truncated]"}, items[len(items)-limit:]...)
}
