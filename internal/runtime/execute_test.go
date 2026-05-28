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

func TestPackagedSingleInterfaceCommandRunsExecuteMode(t *testing.T) {
	var seenRequest chatRequest
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&seenRequest); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requests.Add(1)
		if hasToolMessage(seenRequest.Messages) {
			var result ToolResult
			if err := json.Unmarshal([]byte(lastToolMessage(seenRequest.Messages)), &result); err != nil {
				t.Errorf("tool message was not structured JSON: %v", err)
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if result.IsError || !strings.Contains(result.Content, "wrote result.txt") {
				t.Errorf("unexpected tool result: %+v", result)
				http.Error(w, "bad tool result", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{
				"role":    "assistant",
				"content": "downloads organized",
			})
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
						"arguments": `{"path":"result.txt","content":"organized\n"}`,
					},
				},
			},
		})
	}))
	defer server.Close()

	seed := t.TempDir()
	if _, err := bootstrap(seed, "seed execute command", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":        "organize",
			"description": "Organize a directory.",
			"usage":       "xiaogui --input PATH",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"result.txt"},
		},
		"commands": map[string]any{
			"allow": []any{"git status"},
			"deny":  []any{"git reset --hard"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	t.Setenv("FENG_PACKAGED_SELF", seed)
	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := RunWithExecutable([]string{"--input", "./Downloads"}, dir, &out, &errOut, filepath.Join(dir, "xiaogui.exe"))
	if code != 0 {
		t.Fatalf("execute exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if strings.TrimSpace(out.String()) != "downloads organized" {
		t.Fatalf("execute did not print assistant result: %s", out.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected two provider calls, got %d", requests.Load())
	}
	if !requestContains(seenRequest.Messages, "execute request:") ||
		!requestContains(seenRequest.Messages, `"command": "organize"`) ||
		!requestContains(seenRequest.Messages, `"./Downloads"`) {
		t.Fatalf("execute request was not compiled into messages: %+v", seenRequest.Messages)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "result.txt")); err != nil || string(data) != "organized\n" {
		t.Fatalf("execute did not write through packaged permissions: data=%q err=%v", string(data), err)
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != "ready" || state.CurrentGoal == "" {
		t.Fatalf("execute state not recorded: %+v", state)
	}
	if _, err := os.Stat(filepath.Join(dir, ".feng", "state.yaml")); err != nil {
		t.Fatalf("execute did not create runtime state: %v", err)
	}
	for _, rel := range []string{"identity.md", "skills", "tools", "world", "evals", "interface.yaml", "permissions.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, rel)); !os.IsNotExist(err) {
			t.Fatalf("execute exposed self repo in user workspace at %s: %v", rel, err)
		}
	}
}

func TestPackagedExecuteHelpUsesInterface(t *testing.T) {
	seed := t.TempDir()
	if _, err := bootstrap(seed, "seed execute help", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":        "organize",
			"description": "Organize a directory.",
			"usage":       "xiaogui --input PATH",
		}},
	}); err != nil {
		t.Fatal(err)
	}

	t.Setenv("FENG_PACKAGED_SELF", seed)
	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--help"}, t.TempDir(), &out, &errOut, "xiaogui.exe")
	if code != 0 {
		t.Fatalf("help exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "usage: xiaogui --input PATH") ||
		!strings.Contains(out.String(), "Organize a directory.") ||
		strings.Contains(out.String(), "grow,check,hatch") {
		t.Fatalf("execute help did not use interface: %s", out.String())
	}
}

func TestDefaultKernelInterfaceDoesNotEnterExecuteMode(t *testing.T) {
	seed := t.TempDir()
	if _, err := bootstrap(seed, "seed kernel", ""); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_PACKAGED_SELF", seed)
	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--help"}, t.TempDir(), &out, &errOut, "feng.exe")
	if code != 0 {
		t.Fatalf("help exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "grow,check,hatch") {
		t.Fatalf("default kernel interface should keep feng help: %s", out.String())
	}
}

func TestPackagedSelfToolCanRunFromFrozenSelf(t *testing.T) {
	seed := t.TempDir()
	user := t.TempDir()
	if _, err := bootstrap(seed, "seed packaged tool", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"**"},
		},
		"commands": map[string]any{
			"allow": []any{"go run"},
			"deny":  []any{"git reset --hard"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(seed, "scripts", "mark.go"), "package main\n\nimport (\n\t\"os\"\n\t\"path/filepath\"\n)\n\nfunc main() {\n\tworkspace := os.Getenv(\"FENG_WORKSPACE_DIR\")\n\tif workspace == \"\" {\n\t\tos.Exit(2)\n\t}\n\t_ = os.WriteFile(filepath.Join(workspace, \"marker.txt\"), []byte(os.Getenv(\"FENG_SELF_DIR\")), 0o644)\n}\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "tools", "marker.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "mark_from_self",
		"description": "Create a marker from a packaged self script.",
		"command":     "go run scripts/mark.go",
		"workdir":     "self",
		"always":      true,
	}); err != nil {
		t.Fatal(err)
	}

	tools := activeToolPackReportFromSelf(user, seed, "execute", "mark").Tools
	result := executeTool(user, tools, "mark_from_self", map[string]any{})
	if result.IsError {
		t.Fatalf("packaged self tool failed: %+v", result)
	}
	data, err := os.ReadFile(filepath.Join(user, "marker.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != seed {
		t.Fatalf("tool did not run from packaged self: marker=%q seed=%q", string(data), seed)
	}
}

func TestPackagedExecuteLoopCanCallFrozenSelfTool(t *testing.T) {
	seed := t.TempDir()
	user := t.TempDir()
	if _, err := bootstrap(seed, "seed execute self tool", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":  "run",
			"usage": "packaged-runner [args...]",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"**"},
		},
		"commands": map[string]any{
			"allow": []any{"go run"},
			"deny":  []any{"git reset --hard"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(seed, "scripts", "mark.go"), "package main\n\nimport (\n\t\"os\"\n\t\"path/filepath\"\n)\n\nfunc main() {\n\tworkspace := os.Getenv(\"FENG_WORKSPACE_DIR\")\n\t_ = os.WriteFile(filepath.Join(workspace, \"execute-marker.txt\"), []byte(\"from-self\"), 0o644)\n}\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "tools", "marker.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "mark_from_self",
		"description": "Create an execute marker from a packaged self script.",
		"command":     "go run scripts/mark.go",
		"workdir":     "self",
		"always":      true,
	}); err != nil {
		t.Fatal(err)
	}

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requests.Add(1)
		if hasToolMessage(request.Messages) {
			var result ToolResult
			if err := json.Unmarshal([]byte(lastToolMessage(request.Messages)), &result); err != nil {
				t.Errorf("tool result decode: %v", err)
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if result.IsError {
				t.Errorf("self tool failed: %+v", result)
				http.Error(w, "tool failed", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{"role": "assistant", "content": "done"})
			return
		}
		if !requestHasTool(request.Tools, "mark_from_self") {
			t.Errorf("execute request did not expose packaged self tool: %+v", request.Tools)
			http.Error(w, "missing self tool", http.StatusBadRequest)
			return
		}
		writeChatResponse(w, map[string]any{
			"role": "assistant",
			"tool_calls": []map[string]any{
				{
					"id":   "call_1",
					"type": "function",
					"function": map[string]any{
						"name":      "mark_from_self",
						"arguments": `{}`,
					},
				},
			},
		})
	}))
	defer server.Close()

	t.Setenv("FENG_PACKAGED_SELF", seed)
	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--flag"}, user, &out, &errOut, "packaged-runner.exe")
	if code != 0 {
		t.Fatalf("execute exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected two provider calls, got %d", requests.Load())
	}
	data, err := os.ReadFile(filepath.Join(user, "execute-marker.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "from-self" {
		t.Fatalf("unexpected marker: %q", string(data))
	}
}

func requestContains(messages []chatMessage, needle string) bool {
	for _, message := range messages {
		if strings.Contains(message.Content, needle) {
			return true
		}
	}
	return false
}
