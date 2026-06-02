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
	if len(state.LastArtifacts) != 1 || state.LastArtifacts[0].Type != "execute-output" {
		t.Fatalf("execute output was not exposed as latest artifact: %+v", state.LastArtifacts)
	}
	if !hasRunStoppedArtifact(dir, state.LastArtifacts[0].Path) {
		t.Fatalf("execute run_stopped did not point at output artifact: %+v", tailEvents(dir, 20))
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

func TestPackagedExecutePersistsAssistantOutputArtifact(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeChatResponse(w, map[string]any{
			"role":    "assistant",
			"content": "direct packaged result\n",
		})
	}))
	defer server.Close()

	seed := t.TempDir()
	if _, err := bootstrap(seed, "seed direct execute output", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":  "run",
			"usage": "direct-agent [args...]",
		}},
	}); err != nil {
		t.Fatal(err)
	}

	t.Setenv("FENG_PACKAGED_SELF", seed)
	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	user := t.TempDir()
	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--quick"}, user, &out, &errOut, "direct-agent.exe")
	if code != 0 {
		t.Fatalf("execute exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if strings.TrimSpace(out.String()) != "direct packaged result" {
		t.Fatalf("execute stdout mismatch: %s", out.String())
	}
	state, err := loadState(user)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.LastArtifacts) != 1 || state.LastArtifacts[0].Type != "execute-output" {
		t.Fatalf("execute output artifact missing from state: %+v", state.LastArtifacts)
	}
	artifact := state.LastArtifacts[0]
	data, err := os.ReadFile(filepath.Join(user, filepath.FromSlash(artifact.Path)))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "direct packaged result\n" {
		t.Fatalf("execute artifact content mismatch: %q", string(data))
	}
	messages := compileExecuteMessages(user, seed, "run", []string{"--quick"}, map[string]any{"commands": []any{"run"}})
	stateManifest := requestStateManifest(t, messages)
	artifactRefs, _ := stateManifest["artifact_refs"].([]any)
	if !containsAnyString(artifactRefs, artifact.Path) || !containsAnyString(artifactRefs, "assistant output from execute command") {
		t.Fatalf("next execute context did not include output artifact ref: %+v", artifactRefs)
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

func TestPackagedRunnerRejectsChecksumMismatch(t *testing.T) {
	packageRoot := t.TempDir()
	seed := filepath.Join(packageRoot, "self")
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":  "run",
			"usage": "agent [args...]",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	checksums, err := packageChecksums(packageRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(packageRoot, "checksums.json"), checksums); err != nil {
		t.Fatal(err)
	}

	t.Setenv("FENG_PACKAGED_SELF", seed)
	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--help"}, t.TempDir(), &out, &errOut, "agent.exe")
	if code != 0 {
		t.Fatalf("valid package should start, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}

	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":  "tampered",
			"usage": "agent [args...]",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	code = RunWithExecutable([]string{"--help"}, t.TempDir(), &out, &errOut, "agent.exe")
	if code != 1 {
		t.Fatalf("tampered package should fail, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "package integrity check failed") ||
		!strings.Contains(errOut.String(), "self/interface.yaml") {
		t.Fatalf("checksum mismatch error was unclear: %s", errOut.String())
	}
}

func TestPackagedExecuteRefusesPackageDirectoryAsWorkspace(t *testing.T) {
	packageRoot := t.TempDir()
	seed := filepath.Join(packageRoot, "self")
	if err := writeText(filepath.Join(packageRoot, hatchPackageMarker), "package marker\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":  "run",
			"usage": "agent [args...]",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_PACKAGED_SELF", seed)

	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--help"}, packageRoot, &out, &errOut, "agent.exe")
	if code != 0 {
		t.Fatalf("execute help in package dir should work, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if _, err := os.Stat(filepath.Join(packageRoot, ".feng")); !os.IsNotExist(err) {
		t.Fatalf("execute help should not create package runtime state: %v", err)
	}

	out.Reset()
	errOut.Reset()
	code = RunWithExecutable([]string{"--quick"}, packageRoot, &out, &errOut, "agent.exe")
	if code != 1 {
		t.Fatalf("execute in package dir should fail, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "hatch package directory cannot be used as a workspace") {
		t.Fatalf("package workspace refusal was unclear: %s", errOut.String())
	}
	if _, err := os.Stat(filepath.Join(packageRoot, ".feng")); !os.IsNotExist(err) {
		t.Fatalf("execute mutated package root: %v", err)
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

func TestLegacyDefaultKernelInterfaceDoesNotEnterExecuteMode(t *testing.T) {
	seed := t.TempDir()
	if _, err := bootstrap(seed, "seed legacy kernel", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{"grow", "check", "hatch", "status", "watch", "artifacts", "gui", "tag"},
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_PACKAGED_SELF", seed)
	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--help"}, t.TempDir(), &out, &errOut, "feng.exe")
	if code != 0 {
		t.Fatalf("help exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "usage: feng {grow,check,hatch,status,watch,artifacts,gui,tag,config}") {
		t.Fatalf("legacy default kernel interface should keep feng help: %s", out.String())
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

func TestExecuteRecompilesMessagesAfterToolCallChangesWorkspace(t *testing.T) {
	seed := t.TempDir()
	user := t.TempDir()
	if _, err := bootstrap(seed, "seed execute refresh", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{
			"name":  "run",
			"usage": "refresh-agent [args...]",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"observed.txt"},
		},
		"commands": map[string]any{
			"allow": []any{"git status"},
			"deny":  []any{"git reset --hard"},
		},
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
		requestNumber := requests.Add(1)
		switch requestNumber {
		case 1:
			stateManifest := requestStateManifest(t, request.Messages)
			files, _ := stateManifest["workspace_file_index"].([]any)
			if containsAnyString(files, "observed.txt") {
				t.Errorf("observed.txt should not be visible before tool call: %+v", files)
				http.Error(w, "unexpected observed file", http.StatusBadRequest)
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
							"arguments": `{"path":"observed.txt","content":"visible to execute\n"}`,
						},
					},
				},
			})
		case 2:
			stateManifest := requestStateManifest(t, request.Messages)
			files, _ := stateManifest["workspace_file_index"].([]any)
			if !containsAnyString(files, "observed.txt") {
				t.Errorf("execute message compiler did not reread workspace: %+v", stateManifest)
				http.Error(w, "missing observed file", http.StatusBadRequest)
				return
			}
			if !hasToolMessage(request.Messages) {
				t.Errorf("execute conversation suffix lost prior tool result: %+v", request.Messages)
				http.Error(w, "missing tool suffix", http.StatusBadRequest)
				return
			}
			last := request.Messages[len(request.Messages)-1]
			if last.Role != "user" || !strings.Contains(last.Content, "execute request:") {
				t.Errorf("execute request should remain after conversation suffix: %+v", request.Messages)
				http.Error(w, "bad message order", http.StatusBadRequest)
				return
			}
			writeChatResponse(w, map[string]any{"role": "assistant", "content": "done"})
		default:
			t.Errorf("unexpected extra request")
			http.Error(w, "unexpected extra request", http.StatusBadRequest)
		}
	}))
	defer server.Close()

	t.Setenv("FENG_PACKAGED_SELF", seed)
	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"--flag"}, user, &out, &errOut, "refresh-agent.exe")
	if code != 0 {
		t.Fatalf("execute exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected two provider calls, got %d", requests.Load())
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
