package runtime

import (
	"encoding/json"
	"fmt"
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
	if err := os.WriteFile(filepath.Join(dir, "identity.md"), []byte("Custom feng identity\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "review.md"), []byte("# Review skill\nUse tests.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "world", "car.md"), []byte("sensor notes\n"), 0o644); err != nil {
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
	selfContract := parseSelfContract(t, messages[1].Content)
	if selfContract["identity"] != "Custom feng identity\n" {
		t.Fatalf("self contract did not include identity excerpt: %+v", selfContract)
	}
	skills, _ := selfContract["skill_catalog"].([]any)
	if !containsAnyString(skills, "Review skill") {
		t.Fatalf("self contract did not include skill catalog: %+v", skills)
	}
	world, _ := selfContract["world_index"].([]any)
	if !containsAnyString(world, "world/car.md") {
		t.Fatalf("self contract did not include world index: %+v", world)
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

func TestCompileGrowMessagesIncludesRelevantCachedContextPack(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "cached context test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "api-testing.md"), []byte("# API testing skill\nwhen: api testing\nUse endpoint fixtures and report HTTP assertions.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "desktop.md"), []byte("# Desktop cleanup skill\nwhen: windows desktop\nDo not use for API work.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "world", "api.md"), []byte("# API world\nHTTP endpoints for testing workflow and authentication terms.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	messages := compileGrowMessages(dir, "improve api testing workflow")
	if len(messages) != 5 {
		t.Fatalf("expected optional cached context pack, got %d messages: %+v", len(messages), messages)
	}
	pack := parseCachedContextPack(t, messages[2].Content)
	skills, _ := pack["skills"].([]any)
	if !containsAnyString(skills, "skills/api-testing.md") || !containsAnyString(skills, "endpoint fixtures") {
		t.Fatalf("relevant skill body missing from context pack: %+v", pack)
	}
	if containsAnyString(skills, "Desktop cleanup") {
		t.Fatalf("irrelevant skill body entered context pack: %+v", pack)
	}
	world, _ := pack["world"].([]any)
	if !containsAnyString(world, "world/api.md") || !containsAnyString(world, "HTTP endpoints") {
		t.Fatalf("relevant world body missing from context pack: %+v", pack)
	}
	stateManifest := parseStateManifest(t, messages[3].Content)
	if stateManifest["mode"] == nil {
		t.Fatalf("state manifest moved or failed to parse: %+v", messages)
	}
}

func TestCompileGrowMessagesUsesHookSelectedSkill(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "hook context test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "hooks.yaml"), map[string]any{
		"on_grow": []any{"reviewer"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "reviewer.md"), []byte("# Review gate\nAlways inspect validation reports before editing.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	messages := compileGrowMessages(dir, "unrelated objective")
	if len(messages) != 5 {
		t.Fatalf("expected hook-selected cached context pack, got %d messages", len(messages))
	}
	pack := parseCachedContextPack(t, messages[2].Content)
	skills, _ := pack["skills"].([]any)
	if !containsAnyString(skills, "skills/reviewer.md") || !containsAnyString(skills, "validation reports") {
		t.Fatalf("hook-selected skill body missing from context pack: %+v", pack)
	}
	stateManifest := parseStateManifest(t, messages[3].Content)
	if stateManifest["active_hook"] != "on_grow" {
		t.Fatalf("state manifest did not expose active hook: %+v", stateManifest)
	}
}

func TestCompileExecuteMessagesUsesOnExecuteHook(t *testing.T) {
	selfRoot := t.TempDir()
	user := t.TempDir()
	if _, err := bootstrap(selfRoot, "execute hook context test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(selfRoot, "hooks.yaml"), map[string]any{
		"on_execute": []any{map[string]any{"skill": "runner"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(selfRoot, "skills", "runner.md"), []byte("# Runner skill\nUse packaged behavior rules for every execution.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	messages := compileExecuteMessages(user, selfRoot, "do", []string{"task"}, map[string]any{"commands": []any{"do"}})
	if len(messages) != 5 {
		t.Fatalf("expected execute cached context pack, got %d messages", len(messages))
	}
	pack := parseCachedContextPack(t, messages[2].Content)
	skills, _ := pack["skills"].([]any)
	if !containsAnyString(skills, "skills/runner.md") || !containsAnyString(skills, "packaged behavior rules") {
		t.Fatalf("execute hook-selected skill body missing from context pack: %+v", pack)
	}
	stateManifest := parseStateManifest(t, messages[3].Content)
	if stateManifest["active_hook"] != "on_execute" {
		t.Fatalf("execute state manifest did not expose active hook: %+v", stateManifest)
	}
}

func TestWorkspaceFileIndexPrioritizesSelfRootsOverUnrelatedNoise(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "context priority test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "aaa-noise"), 0o755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 150; i++ {
		name := filepath.Join(dir, "aaa-noise", fmt.Sprintf("noise-%03d.txt", i))
		if err := os.WriteFile(name, []byte("noise\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "important.md"), []byte("important\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	nodeModules := filepath.Join(dir, "node_modules", "pkg")
	if err := os.MkdirAll(nodeModules, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nodeModules, "index.js"), []byte("generated\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	files := workspaceFileIndex(dir, 40)
	if !containsString(files, "docs/important.md") {
		t.Fatalf("self docs were hidden by unrelated noise: %+v", files)
	}
	if containsString(files, "node_modules/pkg/index.js") {
		t.Fatalf("generated dependency directory leaked into file index: %+v", files)
	}
}

func TestGitContextDoesNotReportCleanStatusAsTruncated(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "clean git context test", ""); err != nil {
		t.Fatal(err)
	}
	report := runCheck(dir)
	if !report.OK {
		t.Fatalf("check failed: %+v", report.Problems)
	}

	context := gitContext(dir)
	if truncated, _ := context["status_truncated"].(bool); truncated {
		t.Fatalf("clean git status was marked truncated: %+v", context)
	}
	statusLines, _ := context["status_short"].([]string)
	if len(statusLines) != 0 {
		t.Fatalf("clean git status should have no lines: %+v", context)
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

func TestAppendEventUsesUniqueObservableIDs(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "event id test", ""); err != nil {
		t.Fatal(err)
	}
	first := appendEvent(dir, "unit_event", map[string]any{"n": 1})
	second := appendEvent(dir, "unit_event", map[string]any{"n": 2})
	if first.ID == second.ID {
		t.Fatalf("rapid events reused id: %s", first.ID)
	}
	events := tailEvents(dir, 2)
	if len(events) != 2 || events[0].ID == events[1].ID {
		t.Fatalf("tail events did not preserve unique ids: %+v", events)
	}
}

func parseCachedContextPack(t *testing.T, content string) map[string]any {
	t.Helper()
	raw := strings.TrimPrefix(content, "cached context pack:\n")
	var value map[string]any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatalf("cached context pack is not JSON: %v\n%s", err, content)
	}
	return value
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

func parseSelfContract(t *testing.T, content string) map[string]any {
	t.Helper()
	raw := strings.TrimPrefix(content, "self contract:\n")
	var value map[string]any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatalf("self contract is not JSON: %v\n%s", err, content)
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

func containsString(items []string, needle string) bool {
	for _, item := range items {
		if strings.Contains(strings.TrimSpace(item), needle) {
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
