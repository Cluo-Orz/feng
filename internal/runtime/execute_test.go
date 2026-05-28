package runtime

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackagedSingleInterfaceCommandRunsExecuteMode(t *testing.T) {
	var seenRequest chatRequest
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
		writeChatResponse(w, map[string]any{
			"role":    "assistant",
			"content": "downloads organized",
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
	if !requestContains(seenRequest.Messages, "execute request:") ||
		!requestContains(seenRequest.Messages, `"command": "organize"`) ||
		!requestContains(seenRequest.Messages, `"./Downloads"`) {
		t.Fatalf("execute request was not compiled into messages: %+v", seenRequest.Messages)
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != "ready" || state.CurrentGoal == "" {
		t.Fatalf("execute state not recorded: %+v", state)
	}
	if _, err := os.Stat(filepath.Join(dir, "identity.md")); err != nil {
		t.Fatalf("execute did not seed packaged self into workspace: %v", err)
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

func requestContains(messages []chatMessage, needle string) bool {
	for _, message := range messages {
		if strings.Contains(message.Content, needle) {
			return true
		}
	}
	return false
}
