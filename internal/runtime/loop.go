package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
)

func runGrowLoop(workspace, goal string, maxTurns int, stdout io.Writer) int {
	tools := activeToolPack(workspace, "grow", goal)
	messages := compileGrowMessages(workspace, goal)
	toolSchemas := toolSchemasForProvider(tools)
	updateContextMetrics(workspace, messages, toolSchemas)
	profile, err := loadProviderProfile(workspace)
	if err != nil {
		return handleLLMError(workspace, err, stdout)
	}

	for turn := 0; turn < maxTurns; turn++ {
		appendEvent(workspace, "message_compiled", map[string]any{
			"turn":                   turn,
			"estimated_input_tokens": estimateMessageTokens(messages),
			"tool_schema_tokens":     estimateJSONTokens(toolSchemas),
			"active_tool_pack_hash":  shaJSON(toolSchemas),
		})
		assistant, updatedMessages, err := callProviderWithRecovery(workspace, profile, messages, toolSchemas)
		messages = updatedMessages
		if err != nil {
			return handleLLMError(workspace, err, stdout)
		}
		appendEvent(workspace, "llm_called", map[string]any{"provider": profile.ID, "model": profile.Model, "turn": turn, "tool_calls": len(assistant.ToolCalls)})

		if len(assistant.ToolCalls) == 0 {
			state, _ := loadState(workspace)
			state.Mode = "ready"
			saveState(workspace, state)
			appendEvent(workspace, "run_stopped", map[string]any{"turn": turn, "reason": "assistant_done"})
			printJSON(stdout, map[string]any{"ok": true, "turns": turn + 1, "message": assistant.Content})
			return 0
		}

		messages = append(messages, chatMessage{Role: "assistant", Content: assistant.Content, ToolCalls: assistant.ToolCalls})
		for _, call := range assistant.ToolCalls {
			args := parseToolArguments(call.Function.Arguments)
			result := executeTool(workspace, tools, call.Function.Name, args)
			messages = append(messages, chatMessage{Role: "tool", ToolCallID: call.ID, Content: encodeToolResult(result)})
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
	state.ContextBudget["estimated_input_tokens"] = estimateMessageTokens(messages) + estimateJSONTokens(toolSchemas)
	state.ContextBudget["dynamic_suffix_tokens"] = estimateMessageTokens(messages[minInt(2, len(messages)):])
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
