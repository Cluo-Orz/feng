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

func TestCompileGrowMessagesSelectsMultilingualCachedContextPack(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "multilingual context test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "小车.md"), []byte("# 小车避障 skill\n使用传感器和控制报告改进小车避障行为。\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "news.md"), []byte("# 新闻摘要 skill\n汇总新闻来源并生成摘要。\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "world", "vehicle.md"), []byte("# 小车 world\n传感器、里程计和避障边界说明。\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	messages := compileGrowMessages(dir, "请帮我优化小车避障能力")
	if len(messages) != 5 {
		t.Fatalf("expected multilingual cached context pack, got %d messages: %+v", len(messages), messages)
	}
	pack := parseCachedContextPack(t, messages[2].Content)
	skills, _ := pack["skills"].([]any)
	if !containsAnyString(skills, "skills/小车.md") || !containsAnyString(skills, "控制报告") {
		t.Fatalf("multilingual skill body missing from context pack: %+v", pack)
	}
	if containsAnyString(skills, "新闻摘要") {
		t.Fatalf("irrelevant Chinese skill body entered context pack: %+v", pack)
	}
	world, _ := pack["world"].([]any)
	if !containsAnyString(world, "world/vehicle.md") || !containsAnyString(world, "里程计") {
		t.Fatalf("multilingual world body missing from context pack: %+v", pack)
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

func TestCompileGrowMessagesExposeRecoveryState(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "recovery context test", ""); err != nil {
		t.Fatal(err)
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	state.Mode = "blocked"
	state.CandidateStatus = "failed"
	state.LastRecovery = map[string]string{"type": "check_failed", "artifact": ".feng/artifacts/check.json"}
	state.RecoveryCount = 3
	if err := saveState(dir, state); err != nil {
		t.Fatal(err)
	}

	messages := compileGrowMessages(dir, "repair candidate")
	stateManifest := parseStateManifest(t, messages[2].Content)
	recovery, _ := stateManifest["last_recovery"].(map[string]any)
	if recovery["type"] != "check_failed" || recovery["artifact"] != ".feng/artifacts/check.json" {
		t.Fatalf("state manifest did not expose recovery material: %+v", stateManifest)
	}
	if stateManifest["recovery_count"].(float64) != 3 {
		t.Fatalf("state manifest did not expose recovery count: %+v", stateManifest)
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

func TestSelfFileIndexBalancesSelfRoots(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "self index balance test", ""); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 80; i++ {
		name := filepath.Join(dir, "skills", fmt.Sprintf("skill-%03d.md", i))
		if err := os.WriteFile(name, []byte("# skill\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, root := range []string{"tools", "world", "evals"} {
		for i := 0; i < 3; i++ {
			name := filepath.Join(dir, root, fmt.Sprintf("%s-%03d.md", root, i))
			if err := os.WriteFile(name, []byte(root+"\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}

	files := selfFileIndex(dir)
	for _, want := range []string{
		"identity.md",
		"goal.md",
		"skills/skill-000.md",
		"skills/[truncated]",
		"tools/tools-000.md",
		"world/world-000.md",
		"evals/evals-000.md",
	} {
		if !containsString(files, want) {
			t.Fatalf("self file index missing %q in %+v", want, files)
		}
	}
	if containsString(files, "skills/skill-079.md") {
		t.Fatalf("self file index should cap dense roots before late skill files: %+v", files)
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

func TestLoadStateNormalizesEmptyContextPackTokens(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, ".feng"), 0o755); err != nil {
		t.Fatal(err)
	}
	state := defaultState("legacy context metrics")
	state.ContextPackHash = ""
	state.ContextBudget["context_pack_tokens"] = 1
	if err := saveState(dir, state); err != nil {
		t.Fatal(err)
	}

	loaded, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ContextBudget["context_pack_tokens"] != 0 {
		t.Fatalf("empty context_pack_hash should normalize context_pack_tokens to zero: %+v", loaded.ContextBudget)
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

func TestAppendEventCompactsAndRedactsStoredData(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "event compaction test", ""); err != nil {
		t.Fatal(err)
	}
	secretLike := "sk-" + "eventsecret1234567890"
	longValue := secretLike + " " + strings.Repeat("x", maxEventStringLength+100)
	manyItems := make([]any, 0, maxEventArrayItems+10)
	for i := 0; i < maxEventArrayItems+10; i++ {
		manyItems = append(manyItems, "item")
	}

	appendEvent(dir, "large_event", map[string]any{
		"message": longValue,
		"items":   manyItems,
		"nested": map[string]any{
			"secret": longValue,
		},
	})

	events := tailEvents(dir, 1)
	if len(events) != 1 {
		t.Fatalf("event missing: %+v", events)
	}
	message := fmt.Sprint(events[0].Data["message"])
	if strings.Contains(message, secretLike) {
		t.Fatalf("event leaked secret-looking value: %s", message)
	}
	if !strings.Contains(message, "[redacted-secret]") || !strings.Contains(message, "[truncated]") {
		t.Fatalf("event message was not redacted and compacted: %s", message)
	}
	items, _ := events[0].Data["items"].([]any)
	if len(items) != maxEventArrayItems+1 || items[len(items)-1] != "[truncated]" {
		t.Fatalf("event array was not compacted: %+v", items)
	}
	nested, _ := events[0].Data["nested"].(map[string]any)
	if strings.Contains(fmt.Sprint(nested["secret"]), secretLike) {
		t.Fatalf("nested event value leaked secret-looking value: %+v", nested)
	}
}

func TestTailEventsSurvivesHistoricalLargeEventLines(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "large event line test", ""); err != nil {
		t.Fatal(err)
	}
	large := Event{
		ID:   "evt_large",
		TS:   1,
		Type: "old_large_event",
		Data: map[string]any{"message": strings.Repeat("x", 70*1024)},
	}
	latest := Event{
		ID:   "evt_latest",
		TS:   2,
		Type: "latest_event",
		Data: map[string]any{"ok": true},
	}
	largeLine, _ := json.Marshal(large)
	latestLine, _ := json.Marshal(latest)
	content := append(append(largeLine, '\n'), append(latestLine, '\n')...)
	if err := os.WriteFile(filepath.Join(dir, ".feng", "events.jsonl"), content, 0o644); err != nil {
		t.Fatal(err)
	}

	events := tailEvents(dir, 1)
	if len(events) != 1 || events[0].ID != "evt_latest" {
		t.Fatalf("tailEvents should read past a historical large line, got %+v", events)
	}
}

func TestRecentEventRefsRecursivelyCompactNestedData(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "nested context compaction test", ""); err != nil {
		t.Fatal(err)
	}
	appendEvent(dir, "nested_event", map[string]any{
		"outer": map[string]any{
			"message":  strings.Repeat("n", 900),
			"snippets": []string{"do-not-include"},
			"items":    []any{strings.Repeat("i", 900)},
		},
	})

	refs := recentEventRefs(dir, 1)
	if len(refs) != 1 {
		t.Fatalf("expected one recent event ref, got %+v", refs)
	}
	data, _ := refs[0]["data"].(map[string]any)
	outer, _ := data["outer"].(map[string]any)
	if _, ok := outer["snippets"]; ok {
		t.Fatalf("nested snippets leaked into recent event refs: %+v", refs)
	}
	message := fmt.Sprint(outer["message"])
	if len(message) > 520 || !strings.Contains(message, "[truncated]") {
		t.Fatalf("nested message was not compacted for context: %q", message)
	}
	items, _ := outer["items"].([]any)
	if len(items) != 1 || len(fmt.Sprint(items[0])) > 520 {
		t.Fatalf("nested array item was not compacted: %+v", refs)
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
