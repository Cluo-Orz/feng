package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompileGrowMessagesIncludesDynamicWorkspaceContext(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "context test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "architecture-note.md"), []byte("note\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	appendEvent(dir, "custom_progress", map[string]any{"message": strings.Repeat("p", 800), "snippets": []string{"should-not-enter"}})
	if _, err := writeArtifact(dir, "test-log", "unit", strings.Repeat("x", 3000), "large log", "test context refs", "txt", []string{strings.Repeat("s", 900)}); err != nil {
		t.Fatal(err)
	}

	messages := compileGrowMessages(dir, "improve context")
	if len(messages) != 4 {
		t.Fatalf("expected 4 messages, got %d", len(messages))
	}
	if strings.Contains(messages[1].Content, "workspace_file_index") {
		t.Fatalf("dynamic workspace index leaked into stable self contract: %s", messages[1].Content)
	}
	stateManifest := parseStateManifest(t, messages[2].Content)
	files, _ := stateManifest["workspace_file_index"].([]any)
	if !containsAnyString(files, "docs/architecture-note.md") {
		t.Fatalf("workspace file index did not include docs file: %+v", files)
	}
	if containsAnyString(files, ".feng/events.jsonl") {
		t.Fatalf("workspace file index should not include runtime logs: %+v", files)
	}
	gitData, _ := stateManifest["git"].(map[string]any)
	statusLines, _ := gitData["status_short"].([]any)
	if !containsAnyString(statusLines, "docs/") {
		t.Fatalf("git status did not include docs directory: %+v", statusLines)
	}
	artifactRefs, _ := stateManifest["artifact_refs"].([]any)
	if len(artifactRefs) == 0 {
		t.Fatal("expected artifact refs in state manifest")
	}
	if strings.Contains(messages[2].Content, strings.Repeat("x", 1000)) {
		t.Fatal("full artifact content leaked into message")
	}
	if strings.Contains(messages[2].Content, "should-not-enter") {
		t.Fatal("event snippets leaked into message")
	}
	if !strings.Contains(messages[2].Content, "[truncated]") {
		t.Fatalf("expected truncated dynamic content: %s", messages[2].Content)
	}
}

func TestAppendEventUpdatesObservableLastEventID(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "event state test", ""); err != nil {
		t.Fatal(err)
	}
	event := appendEvent(dir, "unit_event", map[string]any{"ok": true})
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastEventID != event.ID {
		t.Fatalf("last_event_id=%q event=%q", state.LastEventID, event.ID)
	}
}

func parseStateManifest(t *testing.T, content string) map[string]any {
	t.Helper()
	raw := strings.TrimPrefix(content, "state manifest:\n")
	var value map[string]any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatalf("state manifest is not JSON: %v\n%s", err, content)
	}
	return value
}

func containsAnyString(items []any, needle string) bool {
	for _, item := range items {
		if strings.Contains(strings.TrimSpace(toString(item)), needle) {
			return true
		}
	}
	return false
}

func toString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
