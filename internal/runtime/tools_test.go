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
	for _, command := range []string{"go test ./...", "go vet ./...", "go build ./cmd/feng"} {
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

func TestCheckRejectsInvalidInterface(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "bad interface test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "interface.yaml"), map[string]any{"commands": []any{""}}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject invalid interface")
	}
	if !containsProblem(report.Problems, "interface.yaml command 0 is empty") {
		t.Fatalf("expected invalid interface problem, got %+v", report.Problems)
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
	generated := filepath.Join(dir, "tests", "__pycache__", "test.cpython-314.pyc")
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
