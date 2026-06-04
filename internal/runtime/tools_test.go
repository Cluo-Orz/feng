package runtime

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBootstrapToolsReadWriteListAndCommand(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "tool test", ""); err != nil {
		t.Fatal(err)
	}
	toolsReadme, err := os.ReadFile(filepath.Join(dir, "tools", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"internal Tool/ToolCall/ToolResult", "MCP is a future adapter"} {
		if !strings.Contains(string(toolsReadme), expected) {
			t.Fatalf("tools README did not expose MVP tool boundary %q: %s", expected, string(toolsReadme))
		}
	}
	tools := bootstrapTools()

	write := executeTool(dir, tools, "write_file", map[string]any{
		"path":    "docs/demo.md",
		"content": "hello from feng\n",
	})
	if write.IsError {
		t.Fatalf("write_file failed: %s", write.Content)
	}

	read := executeTool(dir, tools, "read_file", map[string]any{"path": "docs/demo.md"})
	if read.IsError || !strings.Contains(read.Content, "hello from feng") {
		t.Fatalf("read_file result=%+v", read)
	}

	list := executeTool(dir, tools, "list_files", map[string]any{"path": "docs", "max_files": 20})
	if list.IsError || !strings.Contains(list.Content, "docs/demo.md") {
		t.Fatalf("list_files result=%+v", list)
	}

	command := executeTool(dir, tools, "run_command", map[string]any{"command": "git status --short", "timeout": 10})
	if command.IsError || !strings.Contains(command.Content, "exit_code=0") {
		t.Fatalf("run_command result=%+v", command)
	}
}

func TestBootstrapToolsEnforcePermissions(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "permission test", ""); err != nil {
		t.Fatal(err)
	}
	tools := bootstrapTools()

	deniedWrite := executeTool(dir, tools, "write_file", map[string]any{
		"path":    "private.txt",
		"content": "nope",
	})
	if !deniedWrite.IsError || !strings.Contains(deniedWrite.Content, "file write denied") {
		t.Fatalf("expected write denial, got %+v", deniedWrite)
	}

	gitWrite := executeTool(dir, tools, "write_file", map[string]any{
		"path":    ".git/config",
		"content": "nope",
	})
	if !gitWrite.IsError || !strings.Contains(gitWrite.Content, "writing .git is denied") {
		t.Fatalf("expected .git write denial, got %+v", gitWrite)
	}

	fengWrite := executeTool(dir, tools, "write_file", map[string]any{
		"path":    ".feng/state.yaml",
		"content": "{}",
	})
	if !fengWrite.IsError || !strings.Contains(fengWrite.Content, "writing .feng is denied") {
		t.Fatalf("expected .feng write denial, got %+v", fengWrite)
	}

	outsideRead := executeTool(dir, tools, "read_file", map[string]any{"path": "../outside.txt"})
	if !outsideRead.IsError || !strings.Contains(outsideRead.Content, "path escapes workspace") {
		t.Fatalf("expected escaped path denial, got %+v", outsideRead)
	}

	deniedCommand := executeTool(dir, tools, "run_command", map[string]any{"command": "git reset --hard"})
	if !deniedCommand.IsError || !strings.Contains(deniedCommand.Content, "command denied") {
		t.Fatalf("expected command denial, got %+v", deniedCommand)
	}
	if err := writeJSONFile(filepath.Join(dir, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"**"},
		},
		"commands": map[string]any{
			"allow": []any{"git", "git.exe", "Remove-Item", "ri", "rm", "del", "rmdir", "rd", "erase"},
			"deny":  []any{},
		},
	}); err != nil {
		t.Fatal(err)
	}
	deniedByBuiltInRule := executeTool(dir, tools, "run_command", map[string]any{"command": "git reset   --hard"})
	if !deniedByBuiltInRule.IsError || !strings.Contains(deniedByBuiltInRule.Content, "command denied by built-in rule") {
		t.Fatalf("expected built-in command denial, got %+v", deniedByBuiltInRule)
	}
	for _, command := range []string{
		"git -C . reset --hard",
		"git.exe -C . reset --hard",
		"Remove-Item -LiteralPath docs -Force -Recurse",
		"ri -LiteralPath docs -Recurse",
		"rm -r docs",
		"rm --recursive docs",
		"del /s docs",
		"rmdir /s docs",
		"rd /s docs",
		"erase /s docs",
	} {
		result := executeTool(dir, tools, "run_command", map[string]any{"command": command})
		if !result.IsError || !strings.Contains(result.Content, "command denied by built-in rule") {
			t.Fatalf("expected token-level built-in command denial for %q, got %+v", command, result)
		}
	}
	if err := checkCommand(dir, "git reset -- docs/demo.md"); err != nil {
		t.Fatalf("non-hard git reset should remain a normal permission decision, got %v", err)
	}
	deniedFengByBuiltInRule := executeTool(dir, tools, "write_file", map[string]any{
		"path":    ".feng/state.yaml",
		"content": "{}",
	})
	if !deniedFengByBuiltInRule.IsError || !strings.Contains(deniedFengByBuiltInRule.Content, "writing .feng is denied") {
		t.Fatalf("expected built-in .feng write denial, got %+v", deniedFengByBuiltInRule)
	}

	foundArtifact := false
	for _, artifact := range listArtifacts(dir) {
		if artifact.Type == "permission-denied" {
			foundArtifact = true
			break
		}
	}
	if !foundArtifact {
		t.Fatal("expected permission-denied artifact")
	}
}

func TestBrokenPermissionsFallbackKeepsSelfRepairable(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "permission repair test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "permissions.yaml"), []byte("{not-json\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	tools := bootstrapTools()

	denied := executeTool(dir, tools, "write_file", map[string]any{
		"path":    "private.txt",
		"content": "nope",
	})
	if !denied.IsError || !strings.Contains(denied.Content, "file write denied") {
		t.Fatalf("fallback permissions should not allow arbitrary writes: %+v", denied)
	}

	command := executeTool(dir, tools, "run_command", map[string]any{"command": "git status --short"})
	if command.IsError {
		t.Fatalf("fallback permissions should allow baseline git inspection: %+v", command)
	}
	dangerous := executeTool(dir, tools, "run_command", map[string]any{"command": "git reset --hard"})
	if !dangerous.IsError || !strings.Contains(dangerous.Content, "command denied by built-in rule") {
		t.Fatalf("fallback permissions should still enforce built-in deny rules: %+v", dangerous)
	}

	repair := executeTool(dir, tools, "write_file", map[string]any{
		"path":    "permissions.yaml",
		"content": "{}\n",
	})
	if repair.IsError {
		t.Fatalf("broken permissions should not prevent self repair: %+v", repair)
	}
}

func TestEmptyCommandAllowUsesDefaultCommandBoundary(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "empty command allow test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"**"},
		},
		"commands": map[string]any{
			"allow": []any{},
			"deny":  []any{},
		},
	}); err != nil {
		t.Fatal(err)
	}

	baseline := executeTool(dir, bootstrapTools(), "run_command", map[string]any{"command": "git status --short"})
	if baseline.IsError {
		t.Fatalf("empty allow should keep baseline git command available: %+v", baseline)
	}
	arbitrary := executeTool(dir, bootstrapTools(), "run_command", map[string]any{"command": "echo hello"})
	if !arbitrary.IsError || !strings.Contains(arbitrary.Content, "command is not in allow list") {
		t.Fatalf("empty allow must not become allow-all: %+v", arbitrary)
	}
}

func TestLocalGrowPermissionsKeepSelfRepairWriteFloor(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "self repair write floor test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"reports/**"},
		},
		"commands": map[string]any{
			"allow": []any{"git status"},
			"deny":  []any{"git reset --hard"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	selfRepair := executeTool(dir, bootstrapTools(), "write_file", map[string]any{
		"path":    "docs/repair.md",
		"content": "repairable\n",
	})
	if selfRepair.IsError {
		t.Fatalf("local grow should retain self repair write floor: %+v", selfRepair)
	}
	declared := executeTool(dir, bootstrapTools(), "write_file", map[string]any{
		"path":    "reports/out.txt",
		"content": "report\n",
	})
	if declared.IsError {
		t.Fatalf("declared custom write path should remain allowed: %+v", declared)
	}
	private := executeTool(dir, bootstrapTools(), "write_file", map[string]any{
		"path":    "private.txt",
		"content": "nope\n",
	})
	if !private.IsError || !strings.Contains(private.Content, "file write denied") {
		t.Fatalf("repair floor should not allow arbitrary files: %+v", private)
	}
}

func TestPackagedPermissionsDoNotInheritGrowRepairWriteFloor(t *testing.T) {
	seed := t.TempDir()
	user := t.TempDir()
	if _, err := bootstrap(seed, "packaged permission floor test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"**"},
			"write": []any{"reports/**"},
		},
		"commands": map[string]any{
			"allow": []any{"git status"},
			"deny":  []any{"git reset --hard"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	tools := bootstrapToolsWithPermissions(seed)
	denied := executeTool(user, tools, "write_file", map[string]any{
		"path":    "docs/repair.md",
		"content": "nope\n",
	})
	if !denied.IsError || !strings.Contains(denied.Content, "file write denied") {
		t.Fatalf("packaged execute should obey frozen permissions exactly: %+v", denied)
	}
	allowed := executeTool(user, tools, "write_file", map[string]any{
		"path":    "reports/out.txt",
		"content": "ok\n",
	})
	if allowed.IsError {
		t.Fatalf("packaged declared write path should be allowed: %+v", allowed)
	}
}

func TestCheckRejectsBrokenPermissionsWithoutBlockingRepair(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "broken permission check test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "permissions.yaml"), []byte("{not-json\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK || !containsProblem(report.Problems, "permissions.yaml is not valid") {
		t.Fatalf("check should reject broken permissions.yaml: %+v", report)
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.CandidateStatus != "failed" || state.LastRecovery["type"] != "check_failed" {
		t.Fatalf("broken permissions should become repair material: %+v", state)
	}

	repair := executeTool(dir, bootstrapTools(), "write_file", map[string]any{
		"path":    "permissions.yaml",
		"content": "{}\n",
	})
	if repair.IsError {
		t.Fatalf("failed candidate should remain repairable: %+v", repair)
	}
}

func TestCheckRejectsInvalidPermissionsSchema(t *testing.T) {
	for _, tc := range []struct {
		name        string
		permissions map[string]any
		problem     string
	}{
		{
			name: "files_not_object",
			permissions: map[string]any{
				"files": "bad",
			},
			problem: "permissions.yaml files must be an object",
		},
		{
			name: "write_not_list",
			permissions: map[string]any{
				"files": map[string]any{"write": "docs/**"},
			},
			problem: "permissions.yaml files.write must be a list of strings",
		},
		{
			name: "allow_not_list",
			permissions: map[string]any{
				"commands": map[string]any{"allow": "git status"},
			},
			problem: "permissions.yaml commands.allow must be a list of strings",
		},
		{
			name: "deny_non_string",
			permissions: map[string]any{
				"commands": map[string]any{"deny": []any{42}},
			},
			problem: "permissions.yaml commands.deny item 0 must be a string",
		},
		{
			name: "empty_item",
			permissions: map[string]any{
				"files": map[string]any{"read": []any{""}},
			},
			problem: "permissions.yaml files.read item 0 is empty",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if _, err := bootstrap(dir, "invalid permissions schema test", ""); err != nil {
				t.Fatal(err)
			}
			if err := writeJSONFile(filepath.Join(dir, "permissions.yaml"), tc.permissions); err != nil {
				t.Fatal(err)
			}

			report := runCheck(dir)
			if report.OK {
				t.Fatal("expected check to reject invalid permissions schema")
			}
			if !containsProblem(report.Problems, tc.problem) {
				t.Fatalf("expected permissions problem %q, got %+v", tc.problem, report.Problems)
			}
		})
	}
}

func TestPermissionDeniedArtifactsAndEventsAreRedacted(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "permission redaction test", ""); err != nil {
		t.Fatal(err)
	}
	secretLike := "sk-" + "permissionsecret1234567890"
	tools := bootstrapTools()

	result := executeTool(dir, tools, "write_file", map[string]any{
		"path":    "private-" + secretLike + ".txt",
		"content": "nope",
	})
	if !result.IsError {
		t.Fatalf("expected denied write, got %+v", result)
	}
	if strings.Contains(result.Content, secretLike) {
		t.Fatalf("denied write result leaked secret-like value: %s", result.Content)
	}
	result = executeTool(dir, tools, "run_command", map[string]any{
		"command": "git reset --hard " + secretLike,
	})
	if !result.IsError {
		t.Fatalf("expected denied command, got %+v", result)
	}
	if strings.Contains(result.Content, secretLike) {
		t.Fatalf("denied command result leaked secret-like value: %s", result.Content)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "secret.tool.yaml"), map[string]any{
		"type":    "command",
		"name":    "secret_tool",
		"command": "curl https://example.invalid/" + secretLike,
	}); err != nil {
		t.Fatal(err)
	}
	result = executeTool(dir, activeToolPack(dir, "check", ""), "secret_tool", map[string]any{})
	if !result.IsError {
		t.Fatalf("expected denied self repo tool, got %+v", result)
	}
	if strings.Contains(result.Content, secretLike) {
		t.Fatalf("denied self repo tool result leaked secret-like value: %s", result.Content)
	}
	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject secret-bearing self repo tool")
	}
	for _, problem := range report.Problems {
		if strings.Contains(problem, secretLike) {
			t.Fatalf("check problem leaked secret-like value: %s", problem)
		}
	}

	if !artifactTypeExists(dir, "permission-denied") {
		t.Fatal("expected permission-denied artifact")
	}
	_ = filepath.WalkDir(filepath.Join(dir, ".feng"), func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err == nil && strings.Contains(string(data), secretLike) {
			t.Fatalf("secret-like value was not redacted in %s", relPath(dir, path))
		}
		return nil
	})
}

func TestToolCallLifecycleIsObservableAndCompact(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "tool lifecycle test", ""); err != nil {
		t.Fatal(err)
	}
	largeContent := strings.Repeat("x", 1200)

	result := executeTool(dir, bootstrapTools(), "write_file", map[string]any{
		"path":    "docs/lifecycle.md",
		"content": largeContent,
	})
	if result.IsError {
		t.Fatalf("write_file failed: %+v", result)
	}

	var calls []Event
	for _, event := range tailEvents(dir, 20) {
		if event.Type == "tool_called" && event.Data["tool"] == "write_file" {
			calls = append(calls, event)
		}
	}
	if len(calls) != 1 {
		t.Fatalf("expected one dispatcher-owned tool_called event, got %+v", calls)
	}
	args, _ := calls[0].Data["args"].(map[string]any)
	if args["path"] != "docs/lifecycle.md" {
		t.Fatalf("tool_called event lost path args: %+v", calls[0])
	}
	content := fmt.Sprint(args["content"])
	if len(content) > 340 || strings.Contains(content, strings.Repeat("x", 500)) {
		t.Fatalf("tool_called event should not store full write content: %q", content)
	}
}

func TestPermissionDeniedResultAndEventReferenceArtifact(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "permission artifact ref test", ""); err != nil {
		t.Fatal(err)
	}

	result := executeTool(dir, bootstrapTools(), "run_command", map[string]any{"command": "git reset --hard"})
	if !result.IsError {
		t.Fatalf("expected denied command, got %+v", result)
	}
	if result.Artifact == nil || result.Artifact.Type != "permission-denied" {
		t.Fatalf("permission denied result did not reference artifact: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(result.Artifact.Path))); err != nil {
		t.Fatalf("permission artifact missing: %v", err)
	}
	for _, event := range tailEvents(dir, 20) {
		if event.Type == "tool_denied" && event.Data["tool"] == "run_command" {
			if event.Data["artifact"] != result.Artifact.Path {
				t.Fatalf("tool_denied event did not reference artifact: event=%+v result=%+v", event, result)
			}
			return
		}
	}
	t.Fatalf("tool_denied event missing: %+v", tailEvents(dir, 20))
}

func TestDefaultPermissionsAllowSelfRuntimeGrowth(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "self runtime permission test", ""); err != nil {
		t.Fatal(err)
	}
	tools := bootstrapTools()
	for _, item := range []struct {
		path    string
		content string
	}{
		{"internal/runtime/next.go", "package runtime\n"},
		{"cmd/feng/next.go", "package main\n"},
		{"go.mod", "module candidate\n"},
		{"scripts/check.ps1", "Write-Output ok\n"},
	} {
		result := executeTool(dir, tools, "write_file", map[string]any{"path": item.path, "content": item.content})
		if result.IsError {
			t.Fatalf("expected write to %s to be allowed: %s", item.path, result.Content)
		}
	}
	for _, command := range []string{"go run ./cmd/feng --help", "go test ./...", "go vet ./...", "go build ./cmd/feng"} {
		if err := checkCommand(dir, command); err != nil {
			t.Fatalf("expected command %q to be allowed: %v", command, err)
		}
	}
}

func TestLongToolOutputBecomesArtifact(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "artifact test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("x", maxInlineToolResult+100)
	if err := os.WriteFile(filepath.Join(dir, "docs", "long.md"), []byte(long), 0o644); err != nil {
		t.Fatal(err)
	}

	result := executeTool(dir, bootstrapTools(), "read_file", map[string]any{
		"path":  "docs/long.md",
		"limit": maxInlineToolResult + 100,
	})
	if result.IsError {
		t.Fatalf("read_file failed: %s", result.Content)
	}
	if result.Artifact == nil || !strings.Contains(result.Content, "artifact_ref") {
		t.Fatalf("expected artifact ref, got %+v", result)
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(result.Artifact.Path))); err != nil {
		t.Fatal(err)
	}
}

func TestListFilesSkipsGeneratedNoiseUnlessExplicit(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "list noise test", ""); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{
		"docs/important.md",
		"node_modules/pkg/index.js",
		".feng/cache/noise.txt",
		"build/generated.txt",
	} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, rel)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(rel+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	rootList := executeTool(dir, bootstrapTools(), "list_files", map[string]any{"path": ".", "max_files": 200})
	if rootList.IsError {
		t.Fatalf("list_files failed: %s", rootList.Content)
	}
	if !strings.Contains(rootList.Content, "docs/important.md") {
		t.Fatalf("root listing missed self-relevant docs: %s", rootList.Content)
	}
	for _, noisy := range []string{"node_modules/pkg/index.js", ".feng/cache/noise.txt", "build/generated.txt"} {
		if strings.Contains(rootList.Content, noisy) {
			t.Fatalf("root listing leaked noisy path %s:\n%s", noisy, rootList.Content)
		}
	}

	explicitList := executeTool(dir, bootstrapTools(), "list_files", map[string]any{"path": "node_modules", "max_files": 20})
	if explicitList.IsError || !strings.Contains(explicitList.Content, "node_modules/pkg/index.js") {
		t.Fatalf("explicit generated directory listing should remain possible: %+v", explicitList)
	}
}

func TestParseGrowArgs(t *testing.T) {
	goal, turns, err := parseGrowArgs([]string{"improve", "self", "--max-turns", "3"})
	if err != nil {
		t.Fatal(err)
	}
	if goal != "improve self" || turns != 3 {
		t.Fatalf("goal=%q turns=%d", goal, turns)
	}

	goal, turns, err = parseGrowArgs([]string{"--max-turns=0", "hatch"})
	if err != nil {
		t.Fatal(err)
	}
	if goal != "hatch" || turns != 1 {
		t.Fatalf("goal=%q turns=%d", goal, turns)
	}

	goal, turns, err = parseGrowArgs([]string{"--max-turns", "2", "--", "--inspect dashed goal"})
	if err != nil {
		t.Fatal(err)
	}
	if goal != "--inspect dashed goal" || turns != 2 {
		t.Fatalf("goal=%q turns=%d", goal, turns)
	}

	_, _, err = parseGrowArgs(nil)
	if err == nil {
		t.Fatal("expected missing goal error")
	}
	for _, args := range [][]string{
		{"--max-turns"},
		{"--max-turns", "abc", "goal"},
		{"--max-turns=abc", "goal"},
		{"--template=", "goal"},
		{"--unknown", "goal"},
	} {
		if _, _, err := parseGrowArgs(args); err == nil {
			t.Fatalf("expected grow args %v to fail", args)
		}
	}
}

func TestRunCommandUsesWorkspace(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "cwd test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "cwd.md"), []byte("cwd\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	command := "git status --short"
	result := executeTool(dir, bootstrapTools(), "run_command", map[string]any{"command": command})
	if result.IsError {
		t.Fatalf("run_command failed: %s", result.Content)
	}
	if !strings.Contains(result.Content, "docs/") {
		t.Fatalf("command did not run in workspace: %s", result.Content)
	}
}

func TestSelfRepoCommandToolLoadsExecutesAndChecks(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "self tool test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "hello.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "hello_tool",
		"description": "Use a self-defined command tool.",
		"command":     "git status --short",
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "evals", "smoke.eval.yaml"), map[string]any{
		"type":    "command",
		"command": "git status --short",
	}); err != nil {
		t.Fatal(err)
	}

	tools := activeToolPack(dir, "check", "")
	if !hasTool(tools, "hello_tool") {
		t.Fatalf("self repo tool was not loaded: %+v", tools)
	}
	result := executeTool(dir, tools, "hello_tool", map[string]any{})
	if result.IsError || !strings.Contains(result.Content, "exit_code=0") {
		t.Fatalf("self repo tool failed: %+v", result)
	}
	if err := writeText(filepath.Join(dir, "scripts", "echo_args.go"), "package main\n\nimport (\n\t\"encoding/json\"\n\t\"fmt\"\n\t\"os\"\n)\n\nfunc main() {\n\tvar args map[string]any\n\t_ = json.Unmarshal([]byte(os.Getenv(\"FENG_TOOL_ARGS\")), &args)\n\tfmt.Println(args[\"subject\"])\n}\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "echo.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "echo_arg",
		"description": "Echo a function-call argument.",
		"keywords":    []any{"echo"},
		"input_schema": map[string]any{
			"type":       "object",
			"properties": map[string]any{"subject": map[string]any{"type": "string"}},
			"required":   []any{"subject"},
		},
		"command": "go run scripts/echo_args.go",
	}); err != nil {
		t.Fatal(err)
	}
	tools = activeToolPack(dir, "grow", "echo the subject")
	result = executeTool(dir, tools, "echo_arg", map[string]any{"subject": "wind"})
	if result.IsError || !strings.Contains(result.Content, "wind") {
		t.Fatalf("self repo tool did not receive function-call args: %+v", result)
	}
	result = executeTool(dir, tools, "echo_arg", map[string]any{})
	if !result.IsError || !strings.Contains(result.Content, "missing required tool argument: subject") {
		t.Fatalf("expected missing required arg to fail before command execution: %+v", result)
	}
	result = executeTool(dir, tools, "echo_arg", map[string]any{"subject": 42})
	if !result.IsError || !strings.Contains(result.Content, "tool argument subject must be string") {
		t.Fatalf("expected wrong arg type to fail before command execution: %+v", result)
	}

	report := runCheck(dir)
	if !report.OK {
		t.Fatalf("check failed: %+v", report.Problems)
	}
}

func TestPackagedSelfCommandToolReportsPackageMutation(t *testing.T) {
	packageRoot := t.TempDir()
	selfRoot := filepath.Join(packageRoot, "self")
	user := t.TempDir()
	if err := writeText(filepath.Join(packageRoot, hatchPackageMarker), "package marker\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(selfRoot, "permissions.yaml"), defaultPermissionsConfig()); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(selfRoot, "scripts", "mutate_self.go"), "package main\n\nimport (\n\t\"os\"\n\t\"path/filepath\"\n)\n\nfunc main() {\n\t_ = os.WriteFile(filepath.Join(os.Getenv(\"FENG_SELF_DIR\"), \"identity.md\"), []byte(\"mutated\\n\"), 0o644)\n}\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(selfRoot, "tools", "mutate.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "package_mutator",
		"description": "Mutate the frozen self.",
		"command":     "go run scripts/mutate_self.go",
		"workdir":     "self",
		"always":      true,
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

	tools := activeToolPackReportFromSelf(user, selfRoot, "execute", "run package mutator").Tools
	result := executeTool(user, tools, "package_mutator", map[string]any{})
	if !result.IsError || !strings.Contains(result.Content, "package integrity check failed after tool package_mutator") ||
		!strings.Contains(result.Content, "self/identity.md") {
		t.Fatalf("packaged self mutation should be surfaced as tool error: %+v", result)
	}
	if err := verifyPackageIntegrity(packageRoot); err == nil {
		t.Fatal("package should remain detectably tampered after self mutation")
	}
}

func TestPackagedSelfCommandToolCanWriteWorkspaceWithoutPackageMutation(t *testing.T) {
	packageRoot := t.TempDir()
	selfRoot := filepath.Join(packageRoot, "self")
	user := t.TempDir()
	if err := writeText(filepath.Join(packageRoot, hatchPackageMarker), "package marker\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(selfRoot, "permissions.yaml"), defaultPermissionsConfig()); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(selfRoot, "scripts", "write_workspace.go"), "package main\n\nimport (\n\t\"os\"\n\t\"path/filepath\"\n)\n\nfunc main() {\n\t_ = os.WriteFile(filepath.Join(os.Getenv(\"FENG_WORKSPACE_DIR\"), \"marker.txt\"), []byte(\"ok\\n\"), 0o644)\n}\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(selfRoot, "tools", "workspace.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "workspace_writer",
		"description": "Write into the user workspace from frozen self.",
		"command":     "go run scripts/write_workspace.go",
		"workdir":     "self",
		"always":      true,
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

	tools := activeToolPackReportFromSelf(user, selfRoot, "execute", "run workspace writer").Tools
	result := executeTool(user, tools, "workspace_writer", map[string]any{})
	if result.IsError {
		t.Fatalf("workspace write should not fail package integrity: %+v", result)
	}
	if data, err := os.ReadFile(filepath.Join(user, "marker.txt")); err != nil || string(data) != "ok\n" {
		t.Fatalf("workspace writer did not write user workspace: data=%q err=%v", string(data), err)
	}
	if err := verifyPackageIntegrity(packageRoot); err != nil {
		t.Fatalf("workspace writer should not mutate package: %v", err)
	}
}

func TestActiveToolPackSelectsRelevantSelfRepoTools(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "tool selection test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "api.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "api_contract_check",
		"description": "Run API contract checks.",
		"keywords":    []any{"api", "contract", "http"},
		"command":     "git status --short",
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "news.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "news_fetch",
		"description": "Fetch RSS news sources.",
		"keywords":    []any{"news", "rss"},
		"command":     "git status --short",
	}); err != nil {
		t.Fatal(err)
	}

	tools := activeToolPack(dir, "grow", "improve api contract checks")
	if !hasTool(tools, "read_file") || !hasTool(tools, "run_command") {
		t.Fatalf("bootstrap tools must remain available: %+v", tools)
	}
	if !hasTool(tools, "api_contract_check") {
		t.Fatalf("relevant self repo tool was not selected: %+v", tools)
	}
	if hasTool(tools, "news_fetch") {
		t.Fatalf("unrelated self repo tool should not be exposed to this round: %+v", tools)
	}

	checkTools := activeToolPack(dir, "check", "")
	if !hasTool(checkTools, "api_contract_check") || !hasTool(checkTools, "news_fetch") {
		t.Fatalf("check should validate all self repo tools: %+v", checkTools)
	}
}

func TestActiveToolPackSelectsHookSkillDeclaredTools(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "hook tool selection test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "validate.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "validation_gate",
		"description": "Run validation gate.",
		"command":     "git status --short",
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "unrelated.tool.yaml"), map[string]any{
		"type":        "command",
		"name":        "unrelated_tool",
		"description": "Unrelated helper.",
		"command":     "git status --short",
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "reviewer.md"), []byte("# Reviewer\n\ntools:\n- validation_gate\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "hooks.yaml"), map[string]any{
		"on_grow": []any{"reviewer"},
	}); err != nil {
		t.Fatal(err)
	}

	report := activeToolPackReport(dir, "grow", "plain objective", "on_grow")
	if !hasTool(report.Tools, "validation_gate") {
		t.Fatalf("hook-selected skill tool was not exposed: %+v", report)
	}
	if hasTool(report.Tools, "unrelated_tool") {
		t.Fatalf("unrelated self repo tool should not be exposed: %+v", report)
	}
	if !strings.Contains(report.SelectionReason["validation_gate"], "hook on_grow selected skill") {
		t.Fatalf("hook-selected tool reason missing: %+v", report.SelectionReason)
	}
}

func TestCheckRejectsDeniedSelfRepoTool(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "bad tool test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "bad.tool.yaml"), map[string]any{
		"type":    "command",
		"name":    "bad_tool",
		"command": "git reset --hard",
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject denied tool command")
	}
	if !containsProblem(report.Problems, "tool command denied") {
		t.Fatalf("expected denied tool problem, got %+v", report.Problems)
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !hasArtifactType(state.LastArtifacts, "diff") {
		t.Fatalf("expected failed check to expose diff artifact, got %+v", state.LastArtifacts)
	}
}

func TestCheckRejectsMCPToolTypeInMVP(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "mcp tool boundary test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "tools", "external.tool.yaml"), map[string]any{
		"type":   "mcp",
		"name":   "external_search",
		"server": "example",
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject MCP tool type in MVP")
	}
	if !containsProblem(report.Problems, "unsupported type") || !containsProblem(report.Problems, "MVP supports command tools only") {
		t.Fatalf("expected explicit MVP tool boundary problem, got %+v", report.Problems)
	}
}

func TestCheckRejectsShadowedOrDuplicateSelfRepoToolNames(t *testing.T) {
	for _, tc := range []struct {
		name    string
		files   map[string]string
		problem string
	}{
		{
			name: "bootstrap_shadow",
			files: map[string]string{
				"tools/read.tool.yaml": `{"type":"command","name":"read_file","command":"git status --short"}`,
			},
			problem: "tool name shadows bootstrap tool",
		},
		{
			name: "duplicate_self_tool",
			files: map[string]string{
				"tools/a.tool.yaml": `{"type":"command","name":"review_gate","command":"git status --short"}`,
				"tools/b.tool.yaml": `{"type":"command","name":"review_gate","command":"git status --short"}`,
			},
			problem: "tool name duplicates another self repo tool",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if _, err := bootstrap(dir, "tool name boundary test", ""); err != nil {
				t.Fatal(err)
			}
			for rel, content := range tc.files {
				if err := writeText(filepath.Join(dir, filepath.FromSlash(rel)), content+"\n"); err != nil {
					t.Fatal(err)
				}
			}

			report := runCheck(dir)
			if report.OK {
				t.Fatal("expected check to reject ambiguous tool registry")
			}
			if !containsProblem(report.Problems, tc.problem) {
				t.Fatalf("expected problem %q, got %+v", tc.problem, report.Problems)
			}
		})
	}
}

func TestCheckRejectsInvalidSelfRepoToolInputSchema(t *testing.T) {
	for _, tc := range []struct {
		name    string
		schema  any
		problem string
	}{
		{
			name:    "non_object_schema",
			schema:  "bad",
			problem: "tool input_schema must be an object",
		},
		{
			name: "non_object_root_type",
			schema: map[string]any{
				"type": "array",
			},
			problem: "tool input_schema root type must be object",
		},
		{
			name: "required_string",
			schema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"subject": map[string]any{"type": "string"}},
				"required":   "subject",
			},
			problem: "tool input_schema required must be a list of strings",
		},
		{
			name: "missing_required_property",
			schema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
				"required":   []any{"subject"},
			},
			problem: "tool input_schema required field has no property schema",
		},
		{
			name: "unsupported_property_type",
			schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"subject": map[string]any{"type": "date"},
				},
			},
			problem: "tool input_schema property has unsupported type",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if _, err := bootstrap(dir, "bad tool schema test", ""); err != nil {
				t.Fatal(err)
			}
			if err := writeJSONFile(filepath.Join(dir, "tools", "bad-schema.tool.yaml"), map[string]any{
				"type":         "command",
				"name":         "bad_schema_tool",
				"command":      "git status --short",
				"input_schema": tc.schema,
			}); err != nil {
				t.Fatal(err)
			}

			report := runCheck(dir)
			if report.OK {
				t.Fatal("expected check to reject invalid tool input_schema")
			}
			if !containsProblem(report.Problems, tc.problem) {
				t.Fatalf("expected schema problem %q, got %+v", tc.problem, report.Problems)
			}
		})
	}
}

func TestCheckRejectsBrokenHookSkillReferences(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "bad hook test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "hooks.yaml"), map[string]any{
		"on_grow": []any{"missing-skill"},
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject missing hook skill")
	}
	if !containsProblem(report.Problems, "hook skill not found") {
		t.Fatalf("expected missing hook skill problem, got %+v", report.Problems)
	}
}

func TestCheckRejectsUnsupportedHookEvent(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "bad hook event test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "reviewer.md"), []byte("# Reviewer\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "hooks.yaml"), map[string]any{
		"on_startup": []any{"reviewer"},
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject unsupported hook event")
	}
	if !containsProblem(report.Problems, "hooks.on_startup is not a supported MVP hook event") {
		t.Fatalf("expected unsupported hook event problem, got %+v", report.Problems)
	}
}

func TestCheckRejectsHookSkillUnknownTool(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "bad hook tool test", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skills", "reviewer.md"), []byte("# Reviewer\n\ntools: missing_tool\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "hooks.yaml"), map[string]any{
		"on_grow": []any{"reviewer"},
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject hook skill unknown tool")
	}
	if !containsProblem(report.Problems, "declares unknown tool: missing_tool") {
		t.Fatalf("expected unknown tool problem, got %+v", report.Problems)
	}
}

func TestCheckRejectsInvalidInterface(t *testing.T) {
	for _, tc := range []struct {
		name     string
		commands []any
		problem  string
	}{
		{
			name:     "empty",
			commands: []any{""},
			problem:  "interface.yaml command 0 is empty",
		},
		{
			name:     "space",
			commands: []any{"bad command"},
			problem:  "must contain only letters, numbers, dot, dash, or underscore",
		},
		{
			name:     "help",
			commands: []any{"help"},
			problem:  "help is reserved for command help",
		},
		{
			name:     "duplicate",
			commands: []any{"review", "review"},
			problem:  "duplicates command name: review",
		},
		{
			name:     "non_string_object_name",
			commands: []any{map[string]any{"name": 42}},
			problem:  "name must be a string",
		},
		{
			name:     "non_string_usage",
			commands: []any{map[string]any{"name": "review", "usage": 42}},
			problem:  "usage must be a string",
		},
		{
			name:     "non_string_description",
			commands: []any{map[string]any{"name": "review", "description": 42}},
			problem:  "description must be a string",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if _, err := bootstrap(dir, "bad interface test", ""); err != nil {
				t.Fatal(err)
			}
			if err := writeJSONFile(filepath.Join(dir, "interface.yaml"), map[string]any{"commands": tc.commands}); err != nil {
				t.Fatal(err)
			}

			report := runCheck(dir)
			if report.OK {
				t.Fatal("expected check to reject invalid interface")
			}
			if !containsProblem(report.Problems, tc.problem) {
				t.Fatalf("expected invalid interface problem %q, got %+v", tc.problem, report.Problems)
			}
		})
	}
}

func TestCheckScansPackagedSourceRootsForSecrets(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "secret scan roots test", ""); err != nil {
		t.Fatal(err)
	}
	secretLike := "sk-" + "sourcepackageroot1234567890"
	if err := writeText(filepath.Join(dir, "scripts", "leak.ps1"), "Write-Output "+secretLike+"\n"); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject secret-like value in packaged source root")
	}
	if !containsProblem(report.Problems, "possible secret in scripts/leak.ps1") {
		t.Fatalf("expected script secret scan problem, got %+v", report.Problems)
	}
}

func TestCheckIgnoresGeneratedSecretLikeFiles(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "generated secret scan test", ""); err != nil {
		t.Fatal(err)
	}
	secretLike := "sk-" + "generatedcache1234567890"
	generated := filepath.Join(dir, "docs", ".cache", "generated.bin")
	if err := os.MkdirAll(filepath.Dir(generated), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(generated, []byte(secretLike), 0o644); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if !report.OK {
		t.Fatalf("generated cache files should not fail check: %+v", report.Problems)
	}
}

func TestCheckRunsCommandEvals(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "eval test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "evals", "good.eval.yaml"), map[string]any{
		"type":    "command",
		"command": "git status --short",
	}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "evals", "bad.eval.yaml"), map[string]any{
		"type":    "command",
		"command": "git status --definitely-not-a-real-option",
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected failing eval to fail check")
	}
	if !containsProblem(report.Problems, "eval failed") {
		t.Fatalf("expected eval failure, got %+v", report.Problems)
	}
	if !hasEventForPath(dir, "eval_passed", "evals/good.eval.yaml") {
		t.Fatalf("expected eval_passed event, got %+v", tailEvents(dir, 50))
	}
	if !hasEventForPath(dir, "eval_failed", "evals/bad.eval.yaml") {
		t.Fatalf("expected eval_failed event, got %+v", tailEvents(dir, 50))
	}
	if !artifactTypeExistsForToolsTest(dir, "eval-output") {
		t.Fatalf("expected eval-output artifact, got %+v", listArtifacts(dir))
	}
}

func hasTool(tools []Tool, name string) bool {
	for _, tool := range tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func containsProblem(problems []string, needle string) bool {
	for _, problem := range problems {
		if strings.Contains(problem, needle) {
			return true
		}
	}
	return false
}

func hasArtifactType(artifacts []Artifact, artifactType string) bool {
	for _, artifact := range artifacts {
		if artifact.Type == artifactType {
			return true
		}
	}
	return false
}

func hasEventForPath(workspace, eventType, path string) bool {
	for _, event := range tailEvents(workspace, 50) {
		if event.Type == eventType && event.Data["path"] == path {
			return true
		}
	}
	return false
}

func artifactTypeExistsForToolsTest(workspace, artifactType string) bool {
	for _, artifact := range listArtifacts(workspace) {
		if artifact.Type == artifactType {
			return true
		}
	}
	return false
}
