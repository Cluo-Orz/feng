package runtime

import (
	"bytes"
	"encoding/json"
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

func lastToolMessage(messages []chatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "tool" {
			return messages[i].Content
		}
	}
	return ""
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
