package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
)

const (
	maxConversationSuffixToolTurns      = 4
	maxRecentFullConversationToolResult = 4
	maxInlineConversationToolResult     = 1000
)

func runGrowLoop(workspace, goal string, maxTurns int, hookEvent string, stdout io.Writer) int {
	var messages []chatMessage
	var conversationSuffix []chatMessage
	latestEvent := goal
	toolPack := activeToolPackReport(workspace, "grow", latestEvent, hookEvent)
	tools := toolPack.Tools
	toolSchemas := toolSchemasForProvider(tools)
	refreshToolPack := func() {
		toolPack = activeToolPackReport(workspace, "grow", latestEvent, hookEvent)
		tools = toolPack.Tools
		toolSchemas = toolSchemasForProvider(tools)
		updateContextMetrics(workspace, messages, toolSchemas)
	}
	profile, err := loadProviderProfile(workspace)
	if err != nil {
		return handleLLMError(workspace, err, stdout)
	}

	for turn := 0; turn < maxTurns; turn++ {
		conversationSuffix = compactConversationSuffixForTurn(workspace, "grow", turn, conversationSuffix)
		messages = appendCompiledMessages(compileGrowMessages(workspace, goal, hookEvent), conversationSuffix)
		refreshToolPack()
		if compacted, changed := compactMessagesForBudget(workspace, messages, toolSchemas); changed {
			messages = compacted
			updateContextMetrics(workspace, messages, toolSchemas)
		}
		appendEvent(workspace, "message_compiled", map[string]any{
			"turn":                   turn,
			"estimated_input_tokens": estimateMessageTokens(messages),
			"tool_schema_tokens":     estimateJSONTokens(toolSchemas),
			"active_tool_pack_hash":  shaJSON(toolSchemas),
			"context_pack_hash":      contextPackHash(messages),
			"context_pack_tokens":    estimateMessageTokens(contextPackMessages(messages)),
			"selected_tools":         toolPack.SelectedTools,
			"selection_reason":       toolPack.SelectionReason,
		})
		assistant, updatedMessages, err := callProviderWithRecovery(workspace, profile, messages, toolSchemas)
		messages = updatedMessages
		if err != nil {
			return handleLLMError(workspace, err, stdout)
		}
		updateUsageMetrics(workspace, assistant.Usage)
		appendEvent(workspace, "llm_called", map[string]any{"provider": profile.ID, "model": profile.Model, "turn": turn, "tool_calls": len(assistant.ToolCalls), "usage": assistant.Usage})

		if len(assistant.ToolCalls) == 0 {
			assistantArtifact := recordAssistantOutputArtifact(workspace, assistant.Content)
			state, _ := loadState(workspace)
			state.Mode = "ready"
			if !shouldKeepCheckRecovery(state) {
				state.LastRecovery = emptyRecovery()
			}
			if assistantArtifact != nil {
				state.LastArtifacts = []Artifact{*assistantArtifact}
			}
			saveState(workspace, state)
			event := map[string]any{"turn": turn, "reason": "assistant_done"}
			response := map[string]any{"ok": true, "turns": turn + 1, "message": assistant.Content}
			if assistantArtifact != nil {
				event["artifact"] = assistantArtifact.Path
				response["artifact"] = assistantArtifact
			}
			appendEvent(workspace, "run_stopped", event)
			printJSON(stdout, response)
			return 0
		}

		assistantMessage := chatMessage{Role: "assistant", Content: assistant.Content, ToolCalls: assistant.ToolCalls}
		messages = append(messages, assistantMessage)
		conversationSuffix = append(conversationSuffix, assistantMessage)
		for _, call := range assistant.ToolCalls {
			args := parseToolArguments(call.Function.Arguments)
			result := executeTool(workspace, tools, call.Function.Name, args)
			recordToolResult(workspace, call.Function.Name, result)
			markCandidateDirtyIfSelfChanged(workspace)
			toolMessage := chatMessage{Role: "tool", ToolCallID: call.ID, Content: encodeToolResult(result)}
			messages = append(messages, toolMessage)
			conversationSuffix = append(conversationSuffix, toolMessage)
			latestEvent = "tool " + call.Function.Name + " returned: " + truncateString(result.Content, 500)
		}
		updateContextMetrics(workspace, messages, toolSchemas)
	}

	state, _ := loadState(workspace)
	state.Mode = "blocked"
	saveState(workspace, state)
	appendEvent(workspace, "blocked", map[string]any{"reason": "budget_reached", "max_turns": maxTurns})
	printJSON(stdout, map[string]any{"ok": false, "reason": "budget_reached", "max_turns": maxTurns})
	return 2
}

func compactConversationSuffixForTurn(workspace, mode string, turn int, suffix []chatMessage) []chatMessage {
	compacted, changed := compactConversationSuffix(suffix)
	if !changed {
		return suffix
	}
	appendEvent(workspace, "conversation_suffix_compacted", map[string]any{
		"mode":            mode,
		"turn":            turn,
		"before_messages": len(suffix),
		"after_messages":  len(compacted),
		"before_tokens":   estimateMessageTokens(suffix),
		"after_tokens":    estimateMessageTokens(compacted),
	})
	return compacted
}

func compactConversationSuffix(suffix []chatMessage) ([]chatMessage, bool) {
	if len(suffix) == 0 {
		return suffix, false
	}
	beforeHash := shaJSON(suffix)
	hadSummary := false
	var orphaned []chatMessage
	var segments [][]chatMessage
	var current []chatMessage
	for _, message := range suffix {
		if isConversationCompactionSummary(message) {
			hadSummary = true
			continue
		}
		if message.Role == "assistant" {
			if len(current) > 0 {
				segments = append(segments, current)
			}
			current = []chatMessage{message}
			continue
		}
		if len(current) == 0 {
			orphaned = append(orphaned, message)
			continue
		}
		current = append(current, message)
	}
	if len(current) > 0 {
		segments = append(segments, current)
	}

	droppedSegments := 0
	if len(segments) > maxConversationSuffixToolTurns {
		droppedSegments = len(segments) - maxConversationSuffixToolTurns
		segments = segments[droppedSegments:]
	}

	compacted := make([]chatMessage, 0, 1+len(suffix))
	if hadSummary || droppedSegments > 0 || len(orphaned) > 0 {
		compacted = append(compacted, chatMessage{
			Role:    "user",
			Content: conversationCompactionSummaryContent(),
		})
	}
	for _, segment := range segments {
		compacted = append(compacted, segment...)
	}
	compactOldToolMessages(compacted)

	return compacted, shaJSON(compacted) != beforeHash
}

func isConversationCompactionSummary(message chatMessage) bool {
	return message.Role == "user" && strings.HasPrefix(message.Content, "conversation suffix compacted:")
}

func conversationCompactionSummaryContent() string {
	return "conversation suffix compacted: older assistant/tool turns were removed from the live message list. " +
		"Use state manifest recent_events, artifact_refs, Git status, or targeted read_file calls when older evidence is needed."
}

func compactOldToolMessages(messages []chatMessage) {
	fullResultsRemaining := maxRecentFullConversationToolResult
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "tool" {
			continue
		}
		if fullResultsRemaining > 0 {
			fullResultsRemaining--
			continue
		}
		if len(messages[i].Content) <= maxInlineConversationToolResult {
			continue
		}
		messages[i].Content = compactToolResultContent(messages[i].Content)
	}
}

func compactToolResultContent(content string) string {
	var result ToolResult
	if err := json.Unmarshal([]byte(content), &result); err == nil {
		result.Content = "[compacted older tool result; use artifact refs, recent events, Git status, or targeted reads if needed]"
		return encodeToolResult(result)
	}
	return `{"content":"[compacted older tool result; use artifact refs, recent events, Git status, or targeted reads if needed]","is_error":false}`
}

func shouldKeepCheckRecovery(state State) bool {
	if state.LastRecovery["type"] != "check_failed" || state.LastRecovery["artifact"] == "" {
		return false
	}
	return state.CandidateStatus == "failed" || state.CandidateStatus == "dirty"
}

func appendCompiledMessages(base []chatMessage, suffix []chatMessage) []chatMessage {
	if len(suffix) == 0 {
		return base
	}
	out := make([]chatMessage, 0, len(base)+len(suffix))
	if len(base) == 0 {
		out = append(out, suffix...)
		return out
	}
	out = append(out, base[:len(base)-1]...)
	out = append(out, suffix...)
	out = append(out, base[len(base)-1])
	return out
}

func recordAssistantOutputArtifact(workspace, content string) *Artifact {
	return recordLLMOutputArtifact(
		workspace,
		"assistant-output",
		content,
		"assistant output from grow turn",
		"grow assistant output is durable progress material for future turns, especially when it contains a plan but no tool call",
	)
}

func recordExecuteOutputArtifact(workspace, content string) *Artifact {
	return recordLLMOutputArtifact(
		workspace,
		"execute-output",
		content,
		"assistant output from execute command",
		"execute assistant output is the user-visible result of a hatched agent command",
	)
}

func recordLLMOutputArtifact(workspace, artifactType, content, summary, whyRelevant string) *Artifact {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	artifact, err := writeArtifact(
		workspace,
		artifactType,
		"llm",
		content,
		summary,
		whyRelevant,
		"md",
		compactLines(content, 12),
	)
	if err != nil {
		appendEvent(workspace, "artifact_write_failed", map[string]any{"type": artifactType, "reason": err.Error()})
		return nil
	}
	return &artifact
}

func recordToolResult(workspace, name string, result ToolResult) {
	data := map[string]any{
		"tool":     name,
		"is_error": result.IsError,
	}
	if result.Artifact != nil {
		data["artifact"] = result.Artifact.Path
	}
	if result.IsError {
		data["content"] = truncateString(result.Content, 500)
	}
	appendEvent(workspace, "tool_result", data)
}

func updateUsageMetrics(workspace string, usage map[string]any) {
	if len(usage) == 0 {
		return
	}
	state, err := loadState(workspace)
	if err != nil {
		return
	}
	for key, value := range usage {
		state.ContextBudget["last_"+key] = intFromAny(value)
	}
	saveState(workspace, state)
}

func parseToolArguments(raw string) map[string]any {
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err != nil || args == nil {
		return map[string]any{"_raw": raw}
	}
	return args
}

func encodeToolResult(result ToolResult) string {
	encoded, err := json.Marshal(result)
	if err != nil {
		return `{"content":"failed to encode tool result","is_error":true}`
	}
	return string(encoded)
}

func toolSchemasForProvider(tools []Tool) []map[string]any {
	schemas := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		schemas = append(schemas, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        tool.Name,
				"description": tool.Description,
				"parameters":  tool.Parameters,
			},
		})
	}
	return schemas
}

func updateContextMetrics(workspace string, messages []chatMessage, toolSchemas []map[string]any) {
	state, err := loadState(workspace)
	if err != nil {
		return
	}
	state.ActiveToolPackHash = shaJSON(toolSchemas)
	state.StablePrefixHash = shaJSON(messages[:minInt(2, len(messages))])
	state.ContextPackHash = contextPackHash(messages)
	if maxTokens := maxInputTokensFromState(state); maxTokens > 0 {
		state.ContextBudget["max_input_tokens"] = maxTokens
	}
	state.ContextBudget["estimated_input_tokens"] = estimateMessageTokens(messages) + estimateJSONTokens(toolSchemas)
	state.ContextBudget["dynamic_suffix_tokens"] = estimateMessageTokens(messages[minInt(2, len(messages)):])
	state.ContextBudget["context_pack_tokens"] = estimateMessageTokens(contextPackMessages(messages))
	saveState(workspace, state)
}

func estimateJSONTokens(value any) int {
	encoded, _ := json.Marshal(value)
	if len(encoded) < 4 {
		return 1
	}
	return len(encoded) / 4
}

func shaJSON(value any) string {
	encoded, _ := json.Marshal(value)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func contextPackMessages(messages []chatMessage) []chatMessage {
	var out []chatMessage
	for _, message := range messages {
		if strings.HasPrefix(message.Content, "cached context pack:\n") {
			out = append(out, message)
		}
	}
	return out
}

func contextPackHash(messages []chatMessage) string {
	packMessages := contextPackMessages(messages)
	if len(packMessages) == 0 {
		return ""
	}
	return shaJSON(packMessages)
}
