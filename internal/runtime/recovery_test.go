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

func TestGrowRetriesTransientProviderError(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			http.Error(w, "temporary overload", http.StatusServiceUnavailable)
			return
		}
		writeChatResponse(w, map[string]any{"role": "assistant", "content": "done"})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	t.Setenv("FENG_PROVIDER_RETRY_DELAY_MS", "0")
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "retry transient", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected retry to make 2 calls, got %d", requests.Load())
	}
	if !hasEventType(dir, "provider_retry") {
		t.Fatalf("provider_retry event missing")
	}
}

func TestGrowCompactsAndRetriesPromptTooLong(t *testing.T) {
	var requests atomic.Int32
	var firstSize, secondSize int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		encoded, _ := json.Marshal(request.Messages)
		if requests.Add(1) == 1 {
			firstSize = len(encoded)
			http.Error(w, "context length exceeded", http.StatusRequestEntityTooLarge)
			return
		}
		secondSize = len(encoded)
		writeChatResponse(w, map[string]any{"role": "assistant", "content": "done"})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	if _, err := bootstrap(dir, "compact test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 180; i++ {
		name := filepath.Join(dir, "docs", fmt.Sprintf("very-long-file-name-that-forces-context-compaction-%03d.md", i))
		if err := os.WriteFile(name, []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "compact prompt", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("expected compact retry to make 2 calls, got %d", requests.Load())
	}
	if secondSize >= firstSize {
		t.Fatalf("expected compacted request to shrink, before=%d after=%d", firstSize, secondSize)
	}
	if !hasEventType(dir, "context_compacted") {
		t.Fatalf("context_compacted event missing")
	}
}

func TestGrowCompactsBeforeProviderWhenBudgetExceeded(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		stateManifest := requestStateManifest(t, request.Messages)
		files, _ := stateManifest["workspace_file_index"].([]any)
		if len(files) > 81 {
			t.Errorf("workspace_file_index was not compacted before provider call: %d", len(files))
			http.Error(w, "not compacted", http.StatusBadRequest)
			return
		}
		requests.Add(1)
		writeChatResponse(w, map[string]any{"role": "assistant", "content": "done"})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	t.Setenv("FENG_MAX_INPUT_TOKENS", "1")
	dir := t.TempDir()
	if _, err := bootstrap(dir, "budget compact test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 180; i++ {
		name := filepath.Join(dir, "docs", fmt.Sprintf("budget-file-%03d.md", i))
		if err := os.WriteFile(name, []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "compact before provider", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if requests.Load() != 1 {
		t.Fatalf("expected one already-compacted provider call, got %d", requests.Load())
	}
	if !hasEventWithReason(dir, "context_compacted", "context_budget") {
		t.Fatalf("context_budget compaction event missing: %+v", tailEvents(dir, 20))
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.ContextBudget["max_input_tokens"] != 1 {
		t.Fatalf("max input budget not recorded in state: %+v", state.ContextBudget)
	}
}

func hasEventType(workspace, eventType string) bool {
	for _, event := range tailEvents(workspace, 50) {
		if event.Type == eventType {
			return true
		}
	}
	return false
}

func hasEventWithReason(workspace, eventType, reason string) bool {
	for _, event := range tailEvents(workspace, 50) {
		if event.Type == eventType && event.Data["reason"] == reason {
			return true
		}
	}
	return false
}

func requestStateManifest(t *testing.T, messages []chatMessage) map[string]any {
	t.Helper()
	for _, message := range messages {
		if message.Role == "user" && strings.HasPrefix(message.Content, "state manifest:\n") {
			raw := strings.TrimPrefix(message.Content, "state manifest:\n")
			var manifest map[string]any
			if err := json.Unmarshal([]byte(raw), &manifest); err != nil {
				t.Fatalf("state manifest is not JSON: %v\n%s", err, message.Content)
			}
			return manifest
		}
	}
	t.Fatalf("state manifest message missing: %+v", messages)
	return nil
}
