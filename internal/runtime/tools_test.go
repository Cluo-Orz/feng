package runtime

import (
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

	outsideRead := executeTool(dir, tools, "read_file", map[string]any{"path": "../outside.txt"})
	if !outsideRead.IsError || !strings.Contains(outsideRead.Content, "path escapes workspace") {
		t.Fatalf("expected escaped path denial, got %+v", outsideRead)
	}

	deniedCommand := executeTool(dir, tools, "run_command", map[string]any{"command": "git reset --hard"})
	if !deniedCommand.IsError || !strings.Contains(deniedCommand.Content, "command denied by rule") {
		t.Fatalf("expected command denial, got %+v", deniedCommand)
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

	_, _, err = parseGrowArgs(nil)
	if err == nil {
		t.Fatal("expected missing goal error")
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

	report := runCheck(dir)
	if !report.OK {
		t.Fatalf("check failed: %+v", report.Problems)
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

func TestCheckRunsCommandEvals(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "eval test", ""); err != nil {
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
