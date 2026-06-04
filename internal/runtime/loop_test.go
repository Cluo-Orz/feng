package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestGrowRunsOpenAIToolCallLoop(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer fake-key" {
			t.Errorf("unexpected authorization header")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if len(request.Tools) == 0 {
			t.Errorf("request did not include tool schemas")
			http.Error(w, "missing tools", http.StatusBadRequest)
			return
		}
		requests.Add(1)
		if hasToolMessage(request.Messages) {
			var result ToolResult
			if err := json.Unmarshal([]byte(lastToolMessage(request.Messages)), &result); err != nil {
				t.Errorf("tool message was not structured JSON: %v", err)
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if result.IsError || !strings.Contains(result.Content, "wrote docs/from-loop.md") {
				t.Errorf("unexpected tool result: %+v", result)
				http.Error(w, "bad tool result", http.StatusBadRequest)
				return
			}
			writeChatResponseWithUsage(
				w,
				map[string]any{
					"role":    "assistant",
					"content": "done",
				},
				map[string]any{
					"prompt_tokens":           120,
					"completion_tokens":       12,
					"prompt_cache_hit_tokens": 80,
				},
			)
			return
		}
		writeChatResponse(w, map[string]any{
			"role": "assistant",
			"tool_calls": []map[string]any{
				{
					"id":   "call_1",
					"type": "function",
					"function": map[string]any{
						"name":      "write_file",
						"arguments": `{"path":"docs/from-loop.md","content":"loop-ok\n"}`,
					},
				},
			},
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "create a loop file", "--max-turns", "3"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected two provider calls, got %d", requests.Load())
	}
	data, err := os.ReadFile(filepath.Join(dir, "docs", "from-loop.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "loop-ok\n" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
	if !strings.Contains(out.String(), `"ok": true`) {
		t.Fatalf("grow did not finish cleanly: %s", out.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != "ready" {
		t.Fatalf("mode=%s", state.Mode)
	}
	if state.ContextBudget["estimated_input_tokens"] == 0 || state.ActiveToolPackHash == "" {
		t.Fatalf("context metrics were not recorded: %+v", state)
	}
	if state.ContextBudget["last_prompt_cache_hit_tokens"] != 80 {
		t.Fatalf("openai-compatible cache usage was not recorded: %+v", state.ContextBudget)
	}
	if !messageCompiledSelectedTool(dir, "write_file") {
		t.Fatalf("message_compiled event did not expose selected tools: %+v", tailEvents(dir, 20))
	}
	if !hasToolResultEvent(dir, "write_file", false) {
		t.Fatalf("tool_result event did not record successful tool call: %+v", tailEvents(dir, 20))
	}
}

func TestGrowBudgetReachedWritesRunStoppedEvent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeChatResponse(w, map[string]any{
			"role": "assistant",
			"tool_calls": []map[string]any{
				{
					"id":   "call_1",
					"type": "function",
					"function": map[string]any{
						"name":      "list_files",
						"arguments": `{"path":".","max_files":5}`,
					},
				},
			},
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "force budget stop", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != "blocked" {
		t.Fatalf("mode=%s state=%+v", state.Mode, state)
	}
	if !hasRunStoppedReason(dir, "grow", "budget_reached") {
		t.Fatalf("budget stop did not emit terminal run_stopped event: %+v", tailEvents(dir, 20))
	}
}

func TestGrowRecordsContextPackHashInStateStatusAndGUI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if !requestHasCachedContextPack(request.Messages) {
			t.Errorf("request did not include cached context pack: %+v", request.Messages)
			http.Error(w, "missing context pack", http.StatusBadRequest)
			return
		}
		writeChatResponse(w, map[string]any{
			"role":    "assistant",
			"content": "context observed",
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	if _, err := bootstrap(dir, "api context hash test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "api.md"), []byte("# API skill\nwhen: api context\nUse cached context material.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "improve api context", "--max-turns", "1"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.ContextPackHash == "" || state.ContextBudget["context_pack_tokens"] == 0 {
		t.Fatalf("context pack metrics were not recorded in state: %+v", state)
	}

	out.Reset()
	errOut.Reset()
	if code := Run([]string{"status"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("status exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"context_pack_hash": "`) {
		t.Fatalf("status did not expose context_pack_hash: %s", out.String())
	}

	out.Reset()
	errOut.Reset()
	if code := Run([]string{"gui"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("gui exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	html, err := os.ReadFile(strings.TrimSpace(out.String()))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(html), "context pack") || !strings.Contains(string(html), state.ContextPackHash) {
		t.Fatalf("gui did not expose context pack hash: %s", string(html))
	}
}

func TestContextPackTokensAreZeroWhenPackAbsent(t *testing.T) {
	messages := []chatMessage{
		{Role: "system", Content: "kernel"},
		{Role: "system", Content: "self contract"},
		{Role: "user", Content: "state manifest"},
	}
	if hash := contextPackHash(messages); hash != "" {
		t.Fatalf("context pack hash should be empty without context pack, got %s", hash)
	}
	if tokens := contextPackTokens(messages); tokens != 0 {
		t.Fatalf("context pack tokens should be zero without context pack, got %d", tokens)
	}

	withPack := append([]chatMessage{}, messages...)
	withPack = append(withPack, chatMessage{Role: "system", Content: "cached context pack:\n{\"skills\":[\"x\"]}"})
	if hash := contextPackHash(withPack); hash == "" {
		t.Fatal("context pack hash should be present when context pack exists")
	}
	if tokens := contextPackTokens(withPack); tokens == 0 {
		t.Fatal("context pack tokens should be positive when context pack exists")
	}
}

func TestGrowRefreshesActiveToolPackAfterToolGrowth(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requestNumber := requests.Add(1)
		switch requestNumber {
		case 1:
			if requestHasTool(request.Tools, "generated_helper") {
				t.Errorf("generated tool should not exist before the candidate writes it")
				http.Error(w, "unexpected generated tool", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{
				"role": "assistant",
				"tool_calls": []map[string]any{
					{
						"id":   "call_1",
						"type": "function",
						"function": map[string]any{
							"name":      "write_file",
							"arguments": `{"path":"tools/generated-helper.tool.yaml","content":"{\"type\":\"command\",\"name\":\"generated_helper\",\"description\":\"Run generated helper checks.\",\"keywords\":[\"generated\",\"helper\"],\"command\":\"git status --short\"}\n"}`,
						},
					},
				},
			})
		case 2:
			if !requestHasTool(request.Tools, "generated_helper") {
				t.Errorf("generated tool was not exposed on the next turn: %+v", request.Tools)
				http.Error(w, "missing generated tool", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{
				"role":    "assistant",
				"content": "done",
			})
		default:
			t.Errorf("unexpected extra request")
			http.Error(w, "unexpected extra request", http.StatusBadRequest)
		}
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "create generated helper", "--max-turns", "3"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected two provider calls, got %d", requests.Load())
	}
	if _, err := os.Stat(filepath.Join(dir, "tools", "generated-helper.tool.yaml")); err != nil {
		t.Fatal(err)
	}
}

func TestGrowPersistsAssistantOutputWithoutToolCalls(t *testing.T) {
	plan := "# Plan\n\n1. Inspect docs.\n2. Update the MVP design.\n3. Run checks.\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		writeChatResponse(w, map[string]any{
			"role":    "assistant",
			"content": plan,
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "make a durable plan", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != "ready" {
		t.Fatalf("mode=%s", state.Mode)
	}
	if len(state.LastArtifacts) != 1 || state.LastArtifacts[0].Type != "assistant-output" {
		t.Fatalf("assistant output was not exposed as latest artifact: %+v", state.LastArtifacts)
	}
	artifact := state.LastArtifacts[0]
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(artifact.Path)))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != plan {
		t.Fatalf("assistant output artifact content mismatch: %q", string(data))
	}
	if !strings.Contains(out.String(), `"artifact"`) || !strings.Contains(out.String(), `"assistant-output"`) {
		t.Fatalf("grow stdout did not report assistant artifact: %s", out.String())
	}
	if !hasRunStoppedArtifact(dir, artifact.Path) {
		t.Fatalf("run_stopped did not point at assistant artifact: %+v", tailEvents(dir, 20))
	}
	messages := compileGrowMessages(dir, "continue from durable plan")
	stateManifest := requestStateManifest(t, messages)
	artifactRefs, _ := stateManifest["artifact_refs"].([]any)
	if !containsAnyString(artifactRefs, artifact.Path) || !containsAnyString(artifactRefs, "assistant output from grow turn") {
		t.Fatalf("next grow context did not include assistant artifact ref: %+v", artifactRefs)
	}
}

func TestGrowPlanAfterCheckFailureKeepsRecoveryMaterial(t *testing.T) {
	plan := "# Repair plan\n\nRead the failed check report before editing.\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeChatResponse(w, map[string]any{
			"role":    "assistant",
			"content": plan,
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	if _, err := bootstrap(dir, "failed recovery test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "interface.yaml"), map[string]any{"commands": []any{""}}); err != nil {
		t.Fatal(err)
	}
	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected invalid interface to fail check")
	}
	failedState, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	recoveryArtifact := failedState.LastRecovery["artifact"]
	if failedState.CandidateStatus != "failed" || failedState.LastRecovery["type"] != "check_failed" || recoveryArtifact == "" {
		t.Fatalf("check failure did not record recovery material: %+v", failedState)
	}

	var out, errOut bytes.Buffer
	code := Run([]string{"grow", "plan repair after failed check", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.CandidateStatus != "failed" {
		t.Fatalf("plan-only grow should not change failed candidate status: %+v", state)
	}
	if state.LastRecovery["type"] != "check_failed" || state.LastRecovery["artifact"] != recoveryArtifact {
		t.Fatalf("plan-only grow cleared check recovery material: before=%s after=%+v", recoveryArtifact, state.LastRecovery)
	}
	if len(state.LastArtifacts) != 1 || state.LastArtifacts[0].Type != "assistant-output" {
		t.Fatalf("assistant plan should still be latest artifact: %+v", state.LastArtifacts)
	}
	messages := compileGrowMessages(dir, "continue repair")
	stateManifest := requestStateManifest(t, messages)
	recovery, _ := stateManifest["last_recovery"].(map[string]any)
	if recovery["artifact"] != recoveryArtifact {
		t.Fatalf("next grow context lost check recovery ref: %+v", stateManifest)
	}
}

func TestGrowRecompilesMessagesAfterToolCallChangesWorkspace(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requestNumber := requests.Add(1)
		switch requestNumber {
		case 1:
			stateManifest := requestStateManifest(t, request.Messages)
			files, _ := stateManifest["workspace_file_index"].([]any)
			if containsAnyString(files, "docs/after-tool.md") {
				t.Errorf("new file should not be visible before tool call: %+v", files)
				http.Error(w, "unexpected file", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{
				"role": "assistant",
				"tool_calls": []map[string]any{
					{
						"id":   "call_1",
						"type": "function",
						"function": map[string]any{
							"name":      "write_file",
							"arguments": `{"path":"docs/after-tool.md","content":"visible next turn\n"}`,
						},
					},
				},
			})
		case 2:
			stateManifest := requestStateManifest(t, request.Messages)
			files, _ := stateManifest["workspace_file_index"].([]any)
			if !containsAnyString(files, "docs/after-tool.md") {
				t.Errorf("message compiler did not reread workspace after tool call: %+v", stateManifest)
				http.Error(w, "missing refreshed file", http.StatusBadRequest)
				return
			}
			if !hasToolMessage(request.Messages) {
				t.Errorf("conversation suffix lost prior tool result: %+v", request.Messages)
				http.Error(w, "missing tool suffix", http.StatusBadRequest)
				return
			}
			last := request.Messages[len(request.Messages)-1]
			if last.Role != "user" || !strings.Contains(last.Content, "Grow this feng workspace toward the goal:") {
				t.Errorf("latest grow event should remain after conversation suffix: %+v", request.Messages)
				http.Error(w, "bad message order", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{
				"role":    "assistant",
				"content": "done",
			})
		default:
			t.Errorf("unexpected extra request")
			http.Error(w, "unexpected extra request", http.StatusBadRequest)
		}
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "refresh after tool", "--max-turns", "3"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected two provider calls, got %d", requests.Load())
	}
}

func TestGrowCompactsConversationSuffixDuringLongRun(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requestNumber := requests.Add(1)
		if requestNumber == 6 {
			if conversationHasCallID(request.Messages, "call_1") {
				t.Errorf("oldest tool turn should have been compacted out: %+v", request.Messages)
				http.Error(w, "old suffix retained", http.StatusBadRequest)
				return
			}
			if !messagesContainContent(request.Messages, "conversation suffix compacted:") {
				t.Errorf("compaction summary missing from request: %+v", request.Messages)
				http.Error(w, "missing compaction summary", http.StatusBadRequest)
				return
			}
			if !conversationHasCallID(request.Messages, "call_5") {
				t.Errorf("recent tool turn should remain visible: %+v", request.Messages)
				http.Error(w, "recent suffix missing", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{
				"role":    "assistant",
				"content": "done",
			})
			return
		}
		writeChatResponse(w, map[string]any{
			"role": "assistant",
			"tool_calls": []map[string]any{
				{
					"id":   fmt.Sprintf("call_%d", requestNumber),
					"type": "function",
					"function": map[string]any{
						"name":      "list_files",
						"arguments": `{"path":".","max_files":1}`,
					},
				},
			},
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "exercise long suffix", "--max-turns", "8"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 6 {
		t.Fatalf("expected six provider calls, got %d", requests.Load())
	}
	if !hasEventType(dir, "conversation_suffix_compacted") {
		t.Fatalf("suffix compaction was not observable: %+v", tailEvents(dir, 20))
	}
}

func TestAppendCompiledMessagesKeepsLatestEventLast(t *testing.T) {
	base := []chatMessage{
		{Role: "system", Content: "kernel"},
		{Role: "user", Content: "state manifest:\n{}"},
		{Role: "user", Content: "latest event"},
	}
	suffix := []chatMessage{
		{Role: "assistant", ToolCalls: []ToolCall{{ID: "call_1", Type: "function", Function: FunctionCall{Name: "read_file", Arguments: `{}`}}}},
		{Role: "tool", ToolCallID: "call_1", Content: `{"content":"ok","is_error":false}`},
	}

	messages := appendCompiledMessages(base, suffix)
	if len(messages) != 5 {
		t.Fatalf("unexpected message count: %+v", messages)
	}
	if messages[2].Role != "assistant" || messages[3].Role != "tool" {
		t.Fatalf("conversation suffix was not inserted before latest event: %+v", messages)
	}
	if messages[4].Role != "user" || messages[4].Content != "latest event" {
		t.Fatalf("latest event should remain last: %+v", messages)
	}
}

func TestCompactConversationSuffixKeepsRecentToolTurns(t *testing.T) {
	var suffix []chatMessage
	for i := 1; i <= 6; i++ {
		callID := fmt.Sprintf("call_%d", i)
		suffix = append(suffix,
			chatMessage{Role: "assistant", ToolCalls: []ToolCall{{ID: callID, Type: "function", Function: FunctionCall{Name: "read_file", Arguments: `{}`}}}},
			chatMessage{Role: "tool", ToolCallID: callID, Content: encodeToolResult(ToolResult{Content: fmt.Sprintf("result %d", i)})},
		)
	}

	compacted, changed := compactConversationSuffix(suffix)
	if !changed {
		t.Fatal("expected old suffix turns to be compacted")
	}
	if !messagesContainContent(compacted, "conversation suffix compacted:") {
		t.Fatalf("compaction summary missing: %+v", compacted)
	}
	for _, oldID := range []string{"call_1", "call_2"} {
		if conversationHasCallID(compacted, oldID) {
			t.Fatalf("old call %s should have been removed: %+v", oldID, compacted)
		}
	}
	for _, recentID := range []string{"call_3", "call_4", "call_5", "call_6"} {
		if !conversationHasCallID(compacted, recentID) {
			t.Fatalf("recent call %s should remain: %+v", recentID, compacted)
		}
	}
	assertNoOrphanToolMessages(t, compacted)
}

func TestCompactConversationSuffixCompactsOlderLargeToolResults(t *testing.T) {
	large := strings.Repeat("x", maxInlineConversationToolResult+100)
	calls := make([]ToolCall, 0, maxRecentFullConversationToolResult+1)
	suffix := []chatMessage{{Role: "assistant"}}
	for i := 1; i <= maxRecentFullConversationToolResult+1; i++ {
		callID := fmt.Sprintf("call_%d", i)
		calls = append(calls, ToolCall{ID: callID, Type: "function", Function: FunctionCall{Name: "read_file", Arguments: `{}`}})
		suffix = append(suffix, chatMessage{Role: "tool", ToolCallID: callID, Content: encodeToolResult(ToolResult{Content: large})})
	}
	suffix[0].ToolCalls = calls

	compacted, changed := compactConversationSuffix(suffix)
	if !changed {
		t.Fatal("expected older large tool result to be compacted")
	}
	first := toolContentForCall(compacted, "call_1")
	if !strings.Contains(first, "compacted older tool result") || strings.Contains(first, large) {
		t.Fatalf("old large tool result was not compacted: %s", first)
	}
	latest := toolContentForCall(compacted, fmt.Sprintf("call_%d", maxRecentFullConversationToolResult+1))
	if !strings.Contains(latest, large) {
		t.Fatalf("latest tool result should remain full: %s", latest)
	}
	assertNoOrphanToolMessages(t, compacted)
}

func TestGrowRecordsUnknownToolResult(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestNumber := requests.Add(1)
		if requestNumber == 1 {
			writeChatResponse(w, map[string]any{
				"role": "assistant",
				"tool_calls": []map[string]any{
					{
						"id":   "call_1",
						"type": "function",
						"function": map[string]any{
							"name":      "missing_tool",
							"arguments": `{}`,
						},
					},
				},
			})
			return
		}
		writeChatResponse(w, map[string]any{
			"role":    "assistant",
			"content": "done",
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "record unknown tool", "--max-turns", "3"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !hasToolResultEvent(dir, "missing_tool", true) {
		t.Fatalf("missing tool was not observable in events: %+v", tailEvents(dir, 20))
	}
}

func hasToolMessage(messages []chatMessage) bool {
	for _, message := range messages {
		if message.Role == "tool" {
			return true
		}
	}
	return false
}

func requestHasCachedContextPack(messages []chatMessage) bool {
	for _, message := range messages {
		if strings.HasPrefix(message.Content, "cached context pack:\n") {
			return true
		}
	}
	return false
}

func lastToolMessage(messages []chatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "tool" {
			return messages[i].Content
		}
	}
	return ""
}

func conversationHasCallID(messages []chatMessage, callID string) bool {
	for _, message := range messages {
		if message.ToolCallID == callID {
			return true
		}
		for _, call := range message.ToolCalls {
			if call.ID == callID {
				return true
			}
		}
	}
	return false
}

func messagesContainContent(messages []chatMessage, needle string) bool {
	for _, message := range messages {
		if strings.Contains(message.Content, needle) {
			return true
		}
	}
	return false
}

func toolContentForCall(messages []chatMessage, callID string) string {
	for _, message := range messages {
		if message.Role == "tool" && message.ToolCallID == callID {
			return message.Content
		}
	}
	return ""
}

func assertNoOrphanToolMessages(t *testing.T, messages []chatMessage) {
	t.Helper()
	seenCalls := map[string]bool{}
	for _, message := range messages {
		if message.Role == "assistant" {
			for _, call := range message.ToolCalls {
				seenCalls[call.ID] = true
			}
			continue
		}
		if message.Role == "tool" && !seenCalls[message.ToolCallID] {
			t.Fatalf("tool message has no preceding assistant tool call: %+v in %+v", message, messages)
		}
	}
}

func requestHasTool(tools []map[string]any, name string) bool {
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if function["name"] == name {
			return true
		}
	}
	return false
}

func hasToolResultEvent(workspace, name string, isError bool) bool {
	for _, event := range tailEvents(workspace, 20) {
		if event.Type != "tool_result" {
			continue
		}
		if event.Data["tool"] == name && event.Data["is_error"] == isError {
			return true
		}
	}
	return false
}

func hasRunStoppedArtifact(workspace, path string) bool {
	for _, event := range tailEvents(workspace, 20) {
		if event.Type == "run_stopped" && event.Data["artifact"] == path {
			return true
		}
	}
	return false
}

func hasRunStoppedReason(workspace, mode, reason string) bool {
	for _, event := range tailEvents(workspace, 20) {
		if event.Type == "run_stopped" && event.Data["mode"] == mode && event.Data["reason"] == reason {
			return true
		}
	}
	return false
}

func messageCompiledSelectedTool(workspace, name string) bool {
	for _, event := range tailEvents(workspace, 20) {
		if event.Type != "message_compiled" {
			continue
		}
		items, _ := event.Data["selected_tools"].([]any)
		for _, item := range items {
			if item == name {
				return true
			}
		}
	}
	return false
}

func writeChatResponse(w http.ResponseWriter, message map[string]any) {
	writeChatResponseWithUsage(w, message, nil)
}

func writeChatResponseWithUsage(w http.ResponseWriter, message map[string]any, usage map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	response := map[string]any{
		"choices": []map[string]any{{"message": message}},
	}
	if usage != nil {
		response["usage"] = usage
	}
	_ = json.NewEncoder(w).Encode(response)
}
