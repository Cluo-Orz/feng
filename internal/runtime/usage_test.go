package runtime

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGrowRecordsProviderUsageMetrics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeChatResponseWithUsage(w, map[string]any{"role": "assistant", "content": "done"}, map[string]any{
			"prompt_tokens":     123,
			"completion_tokens": 45,
			"total_tokens":      168,
			"prompt_tokens_details": map[string]any{
				"cached_tokens": 80,
			},
		})
	}))
	defer server.Close()

	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "record usage", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.ContextBudget["last_prompt_tokens"] != 123 || state.ContextBudget["last_completion_tokens"] != 45 || state.ContextBudget["last_total_tokens"] != 168 {
		t.Fatalf("usage metrics not recorded: %+v", state.ContextBudget)
	}
	if state.ContextBudget["last_cached_tokens"] != 80 {
		t.Fatalf("cache usage metric not recorded: %+v", state.ContextBudget)
	}
	foundUsageEvent := false
	for _, event := range tailEvents(dir, 20) {
		if event.Type == "llm_called" && event.Data["usage"] != nil {
			foundUsageEvent = true
			break
		}
	}
	if !foundUsageEvent {
		t.Fatal("llm_called event did not include usage")
	}
}
