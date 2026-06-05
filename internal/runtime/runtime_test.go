package runtime

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"
)

func TestGoRuntimeGrowStatusCheck(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "make a tiny agent", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "missing_config") {
		t.Fatalf("grow did not report missing_config: %s", out.String())
	}
	if !strings.Contains(out.String(), `"provider_config_paths"`) ||
		!strings.Contains(out.String(), `"provider_examples"`) ||
		!strings.Contains(out.String(), `"required_env"`) {
		t.Fatalf("grow did not expose provider setup hints: %s", out.String())
	}
	if !hasRunStoppedReason(dir, "grow", "missing_config") {
		t.Fatalf("missing_config grow did not emit terminal run_stopped event: %+v", tailEvents(dir, 20))
	}
	if _, err := os.Stat(filepath.Join(dir, ".feng", "state.yaml")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "skills", "README.md")); err != nil {
		t.Fatal(err)
	}
	interfaceData, err := os.ReadFile(filepath.Join(dir, "interface.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(interfaceData), `"grow"`) || !strings.Contains(string(interfaceData), `"hatch"`) {
		t.Fatalf("default interface did not expose feng kernel commands: %s", string(interfaceData))
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"status"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("status exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"mode": "missing_config"`) {
		t.Fatalf("status did not expose missing_config: %s", out.String())
	}
	if !strings.Contains(out.String(), `"provider":`) ||
		!strings.Contains(out.String(), `"api_key_env": "DEEPSEEK_API_KEY"`) ||
		!strings.Contains(out.String(), `"missing_config": true`) ||
		!strings.Contains(out.String(), `"provider_config_paths"`) ||
		!strings.Contains(out.String(), `"provider_examples"`) ||
		!strings.Contains(out.String(), `"suggested_provider_profile"`) {
		t.Fatalf("status did not expose provider configuration hint: %s", out.String())
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"check"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"ok": true`) {
		t.Fatalf("check did not pass: %s", out.String())
	}
	if !strings.Contains(out.String(), `"validated_commit": "`) {
		t.Fatalf("check did not report validated commit: %s", out.String())
	}
	if !hasRunStartedMode(dir, "check") || !hasRunStoppedReason(dir, "check", "check_passed") {
		t.Fatalf("check did not emit observable run lifecycle events: %+v", tailEvents(dir, 50))
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastRecovery["type"] != "" || state.LastRecovery["artifact"] != "" {
		t.Fatalf("successful check should clear stale recovery state: %+v", state.LastRecovery)
	}
}

func TestCheckRejectsInvalidConfigSchema(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "invalid config schema test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "config.schema.yaml"), map[string]any{
		"provider_profiles": []any{"deepseek"},
		"env":               []any{"DEEPSEEK_API_KEY", 42},
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected check to reject invalid config schema")
	}
	if !containsProblem(report.Problems, "config.schema.yaml env item 1 must be a string") {
		t.Fatalf("expected config schema problem, got %+v", report.Problems)
	}
}

func TestGoRuntimeWatchValidatesLimitArgs(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "watch args test", ""); err != nil {
		t.Fatal(err)
	}
	appendEvent(dir, "first_event", map[string]any{"n": 1})
	appendEvent(dir, "second_event", map[string]any{"n": 2})

	var out, errOut bytes.Buffer
	code := Run([]string{"watch", "--limit=1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("watch exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if strings.Contains(out.String(), "first_event") || !strings.Contains(out.String(), "second_event") {
		t.Fatalf("watch --limit=1 did not return only the latest event: %s", out.String())
	}

	for _, args := range [][]string{
		{"watch", "--limit"},
		{"watch", "--limit", "abc"},
		{"watch", "--limit=0"},
		{"watch", "--unknown"},
	} {
		out.Reset()
		errOut.Reset()
		if code := Run(args, dir, &out, &errOut); code != 2 {
			t.Fatalf("%v should fail usage, exit=%d stdout=%s stderr=%s", args, code, out.String(), errOut.String())
		}
	}
}

func TestGoRuntimeNoArgCommandsRejectExtraArgs(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		args    []string
		message string
	}{
		{[]string{"check", "--bad"}, "unknown check argument: --bad"},
		{[]string{"status", "--bad"}, "unknown status argument: --bad"},
		{[]string{"artifacts", "--bad"}, "unknown artifacts argument: --bad"},
	} {
		var out, errOut bytes.Buffer
		if code := Run(tc.args, dir, &out, &errOut); code != 2 {
			t.Fatalf("%v should fail usage, exit=%d stdout=%s stderr=%s", tc.args, code, out.String(), errOut.String())
		}
		if !strings.Contains(errOut.String(), tc.message) {
			t.Fatalf("%v did not explain rejected argument: %s", tc.args, errOut.String())
		}
	}
}

func TestGoRuntimeGrowCanSeedFromLocalTemplate(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	root := t.TempDir()
	template := filepath.Join(root, "template")
	if err := os.MkdirAll(filepath.Join(template, "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(template, "identity.md"), []byte("template identity\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(template, "skills", "templated.md"), []byte("# Templated Skill\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	workspace := filepath.Join(root, "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "identity.md"), []byte("existing identity\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var out, errOut bytes.Buffer
	code := Run([]string{"grow", "--template", template, "use local template", "--max-turns", "1"}, workspace, &out, &errOut)
	if code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	identity, err := os.ReadFile(filepath.Join(workspace, "identity.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(identity) != "existing identity\n" {
		t.Fatalf("local template overwrote existing file: %q", string(identity))
	}
	if _, err := os.Stat(filepath.Join(workspace, "skills", "templated.md")); err != nil {
		t.Fatalf("local template did not seed missing skill: %v", err)
	}
	state, err := loadState(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if state.CurrentGoal != "use local template" {
		t.Fatalf("grow goal not recorded in state: %+v", state)
	}
	if !hasEventWithTemplate(workspace, template) {
		t.Fatalf("run_started event did not record template: %+v", tailEvents(workspace, 20))
	}
}

func TestGoRuntimeGrowRejectsMissingLocalTemplate(t *testing.T) {
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	code := Run([]string{"grow", "--template", filepath.Join(dir, "missing"), "bad template"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("missing template should fail usage, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "template not found") {
		t.Fatalf("missing template error was unclear: %s", errOut.String())
	}
	if _, err := os.Stat(filepath.Join(dir, ".feng")); !os.IsNotExist(err) {
		t.Fatalf("missing template should not bootstrap workspace: %v", err)
	}
}

func TestGoRuntimeCheckDoesNotCommitUnrelatedUntrackedFiles(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "make a scoped checkpoint", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	outsideDir := filepath.Join(dir, "outside-world")
	if err := os.MkdirAll(outsideDir, 0o755); err != nil {
		t.Fatal(err)
	}
	outsideFile := filepath.Join(outsideDir, "keep.txt")
	if err := os.WriteFile(outsideFile, []byte("not feng self\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"check"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	tracked, err := runGit(dir, "ls-files", "--", "outside-world/keep.txt")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(tracked) != "" {
		t.Fatalf("unrelated file was committed: %s", tracked)
	}
	status, err := runGit(dir, "status", "--short")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(status, "outside-world/") {
		t.Fatalf("unrelated file should remain untracked, status=%s", status)
	}
}

func TestGoRuntimeCheckRejectsEvalMutatingRequiredSelfFile(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "eval mutation test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(dir, "go.mod"), "module evalmutation\n\ngo 1.26\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(dir, "scripts", "delete_goal.go"), "package main\n\nimport \"os\"\n\nfunc main() { _ = os.Remove(\"goal.md\") }\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "evals", "delete-goal.eval.yaml"), map[string]any{
		"type":    "command",
		"command": "go run ./scripts/delete_goal.go",
		"timeout": 60,
	}); err != nil {
		t.Fatal(err)
	}

	var out, errOut bytes.Buffer
	code := Run([]string{"check"}, dir, &out, &errOut)
	if code != 1 {
		t.Fatalf("check should reject eval-mutated self, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "missing self file: goal.md") {
		t.Fatalf("check did not revalidate self after eval mutation: %s", out.String())
	}
	if head := currentHead(dir); head != "" {
		t.Fatalf("mutated self should not be checkpointed, head=%s", head)
	}
}

func TestGoRuntimeGrowMissingConfigDoesNotDirtyValidatedSelf(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	if code := Run([]string{"grow", "make a stable self", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("initial grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	validated := currentHead(dir)
	if validated == "" {
		t.Fatal("validated commit was not created")
	}

	out.Reset()
	errOut.Reset()
	if code := Run([]string{"grow", "attempt without provider", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("second grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.CandidateStatus != "validated" || state.ValidatedCommit != validated {
		t.Fatalf("missing-config grow should not dirty validated self: %+v validated=%s", state, validated)
	}

	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "stable", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("hatch after missing config grow should still work, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
}

func TestGoRuntimeNoBootstrapCommand(t *testing.T) {
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	code := Run([]string{"bootstrap"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("bootstrap should not be public, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
}

func TestGoRuntimeHatchCreatesPackage(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "make a portable agent", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	gitignorePath := filepath.Join(dir, ".gitignore")
	gitignore, err := os.ReadFile(gitignorePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(gitignorePath, append(gitignore, []byte("docs/ignored-note.md\n")...), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "ignored-note.md"), []byte("ignored workspace note\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "config.schema.yaml"), map[string]any{
		"provider_profiles": []any{"deepseek-anthropic"},
		"env":               []any{"DEEPSEEK_API_KEY", "CUSTOM_AGENT_KEY"},
	}); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	outsideDir := filepath.Join(dir, "outside-world")
	if err := os.MkdirAll(outsideDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outsideDir, "keep.txt"), []byte("not packaged\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"tag", "sample-v1"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("tag exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !hasRunStartedMode(dir, "tag") || !hasRunStoppedReason(dir, "tag", "tag_created") {
		t.Fatalf("tag did not emit observable run lifecycle events: %+v", tailEvents(dir, 50))
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "sample", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("hatch exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	packagePath := strings.TrimSpace(out.String())
	if !hasRunStartedMode(dir, "hatch") || !hasRunStoppedReason(dir, "hatch", "hatch_created") {
		t.Fatalf("hatch did not emit observable run lifecycle events: %+v", tailEvents(dir, 50))
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "sample", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("second hatch should replace prior package, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if strings.TrimSpace(out.String()) != packagePath {
		t.Fatalf("second hatch changed package path: %q != %q", strings.TrimSpace(out.String()), packagePath)
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.LastArtifacts) != 1 || state.LastArtifacts[0].Type != "hatch-preview" {
		t.Fatalf("hatch preview was not exposed as latest artifact: %+v", state.LastArtifacts)
	}
	if !hasEventWithArtifactPath(dir, "hatch_created", state.LastArtifacts[0].Path) {
		t.Fatalf("hatch_created did not reference artifact path: artifact=%s events=%+v", state.LastArtifacts[0].Path, tailEvents(dir, 20))
	}
	if _, err := os.Stat(filepath.Join(packagePath, "self", "identity.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "feng-release.yaml")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "checksums.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "install")); err != nil {
		t.Fatalf("hatch package missing shell installer: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "install.ps1")); err != nil {
		t.Fatalf("hatch package missing PowerShell installer: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, packageRunnerBinaryName())); err != nil {
		t.Fatalf("hatch package missing fixed runner binary: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "sample")); err != nil {
		t.Fatalf("hatch package missing named shell entrypoint: %v", err)
	}
	if goruntime.GOOS == "windows" {
		if _, err := os.Stat(filepath.Join(packagePath, "sample.cmd")); err != nil {
			t.Fatalf("hatch package missing cmd shim: %v", err)
		}
		if _, err := os.Stat(filepath.Join(packagePath, "sample.ps1")); err != nil {
			t.Fatalf("hatch package missing PowerShell shim: %v", err)
		}
	}
	if _, err := os.Stat(filepath.Join(packagePath, "self", "outside-world", "keep.txt")); !os.IsNotExist(err) {
		t.Fatalf("hatch copied unrelated workspace content: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "self", "docs", "ignored-note.md")); !os.IsNotExist(err) {
		t.Fatalf("hatch copied ignored workspace content from outside validated commit: %v", err)
	}
	tracked, err := runGit(dir, "ls-files", "--", "outside-world/keep.txt")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(tracked) != "" {
		t.Fatalf("unrelated file was committed: %s", tracked)
	}
	tracked, err = runGit(dir, "ls-files", "--", "docs/ignored-note.md")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(tracked) != "" {
		t.Fatalf("ignored file was committed: %s", tracked)
	}
	anthropicExample, err := os.ReadFile(filepath.Join(packagePath, "provider-examples", "deepseek-anthropic.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(anthropicExample), `"protocol": "anthropic_messages"`) {
		t.Fatalf("anthropic provider example missing protocol: %s", string(anthropicExample))
	}
	manifest, err := os.ReadFile(filepath.Join(packagePath, "feng-release.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(manifest), `"self_tag": "sample-v1"`) || !strings.Contains(string(manifest), `"tag"`) {
		t.Fatalf("hatch manifest did not include tag metadata: %s", string(manifest))
	}
	if !strings.Contains(string(manifest), `"runner": "feng-runner`) {
		t.Fatalf("hatch manifest did not include fixed runner: %s", string(manifest))
	}
	if !strings.Contains(string(manifest), `"installers"`) || !strings.Contains(string(manifest), `"install.ps1"`) {
		t.Fatalf("hatch manifest did not include installers: %s", string(manifest))
	}
	var parsedManifest HatchManifest
	if err := json.Unmarshal(manifest, &parsedManifest); err != nil {
		t.Fatal(err)
	}
	if !containsString(parsedManifest.RequiredProviderProfiles, "deepseek-anthropic") ||
		!containsString(parsedManifest.RequiredEnv, "CUSTOM_AGENT_KEY") {
		t.Fatalf("hatch manifest did not use config.schema.yaml requirements: %+v", parsedManifest)
	}
	if !strings.Contains(string(manifest), `"permissions_summary"`) ||
		!strings.Contains(string(manifest), `"source": "self/permissions.yaml"`) ||
		!strings.Contains(string(manifest), `"read"`) ||
		!strings.Contains(string(manifest), `"write"`) ||
		!strings.Contains(string(manifest), `"allow"`) ||
		!strings.Contains(string(manifest), `"deny"`) {
		t.Fatalf("hatch manifest did not include permissions summary: %s", string(manifest))
	}
	checksums, err := os.ReadFile(filepath.Join(packagePath, "checksums.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(checksums), `"install"`) || !strings.Contains(string(checksums), `"install.ps1"`) || !strings.Contains(string(checksums), `"feng-runner`) {
		t.Fatalf("checksums did not include installers: %s", string(checksums))
	}
}

func TestGoRuntimeHatchManifestUsesInterfaceFile(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "make a custom interface package", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if err := writeJSONFile(filepath.Join(dir, "interface.yaml"), map[string]any{"commands": []any{"review"}}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, "permissions.yaml"), map[string]any{
		"files": map[string]any{
			"read":  []any{"docs/**"},
			"write": []any{"reports/**"},
		},
		"commands": map[string]any{
			"allow": []any{"git status"},
			"deny":  []any{"git reset --hard"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "custom", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("hatch exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	manifestData, err := os.ReadFile(filepath.Join(strings.TrimSpace(out.String()), "feng-release.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest HatchManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatal(err)
	}
	commands, _ := manifest.Interface["commands"].([]any)
	if len(commands) != 1 || commands[0] != "review" {
		t.Fatalf("hatch manifest did not use interface.yaml: %+v", manifest.Interface)
	}
	if manifest.PermissionsSummary.Source != "self/permissions.yaml" ||
		!stringSliceEqual(manifest.PermissionsSummary.Files.Read, []string{"docs/**"}) ||
		!stringSliceEqual(manifest.PermissionsSummary.Files.Write, []string{"reports/**"}) ||
		!stringSliceEqual(manifest.PermissionsSummary.Commands.Allow, []string{"git status"}) ||
		!stringSliceEqual(manifest.PermissionsSummary.Commands.Deny, []string{"git reset --hard"}) {
		t.Fatalf("hatch manifest did not use frozen permissions.yaml: %+v", manifest.PermissionsSummary)
	}
}

func TestPackageIntegrityRejectsUnexpectedFiles(t *testing.T) {
	packageRoot := t.TempDir()
	if err := writeText(filepath.Join(packageRoot, "self", "identity.md"), "packaged self\n"); err != nil {
		t.Fatal(err)
	}
	checksums, err := packageChecksums(packageRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(packageRoot, "checksums.json"), checksums); err != nil {
		t.Fatal(err)
	}
	if err := verifyPackageIntegrity(packageRoot); err != nil {
		t.Fatalf("valid package should verify: %v", err)
	}
	if err := writeText(filepath.Join(packageRoot, "self", "tools", "extra.tool.yaml"), `{"type":"command","name":"extra","command":"git status --short"}`+"\n"); err != nil {
		t.Fatal(err)
	}
	err = verifyPackageIntegrity(packageRoot)
	if err == nil || !strings.Contains(err.Error(), "unexpected package file: self/tools/extra.tool.yaml") {
		t.Fatalf("unexpected file should fail package integrity, got %v", err)
	}
}

func TestPackagedGrowRefusesPackageDirectoryAsWorkspace(t *testing.T) {
	packageRoot := t.TempDir()
	seed := filepath.Join(packageRoot, "self")
	if err := os.MkdirAll(seed, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(packageRoot, hatchPackageMarker), "package marker\n"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_PACKAGED_SELF", seed)

	for _, cwd := range []string{packageRoot, seed} {
		var out, errOut bytes.Buffer
		code := Run([]string{"grow", "do not mutate package", "--max-turns", "1"}, cwd, &out, &errOut)
		if code != 1 {
			t.Fatalf("grow in package cwd %s should fail, exit=%d stdout=%s stderr=%s", cwd, code, out.String(), errOut.String())
		}
		if !strings.Contains(errOut.String(), "hatch package directory cannot be used as a workspace") {
			t.Fatalf("package workspace refusal was unclear: %s", errOut.String())
		}
	}
	for _, rel := range []string{".feng", ".git", "identity.md"} {
		if _, err := os.Stat(filepath.Join(packageRoot, rel)); !os.IsNotExist(err) {
			t.Fatalf("grow mutated package root at %s: %v", rel, err)
		}
	}
}

func TestGoRuntimeHatchRejectsExistingNonPackageOutput(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "make a portable agent", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	outputDir := filepath.Join(dir, "dist", "sample")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Fatal(err)
	}
	keepPath := filepath.Join(outputDir, "keep.txt")
	if err := os.WriteFile(keepPath, []byte("user content\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "sample", "--portable"}, dir, &out, &errOut); code != 1 {
		t.Fatalf("hatch should reject existing non-package output, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "hatch refuses to overwrite existing non-package output") {
		t.Fatalf("hatch did not explain non-package output refusal: %s", errOut.String())
	}
	data, err := os.ReadFile(keepPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "user content\n" {
		t.Fatalf("hatch modified existing output content: %q", string(data))
	}
}

func TestGoRuntimeHatchRejectsInvalidPackageName(t *testing.T) {
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	code := Run([]string{"hatch", "--name", "bad name", "--portable"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("invalid hatch name should fail usage, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "hatch name must contain only letters, numbers, dot, dash, or underscore") {
		t.Fatalf("invalid hatch name error was unclear: %s", errOut.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "dist", "bad-name")); !os.IsNotExist(err) {
		t.Fatalf("hatch should not slug invalid names into output directories: %v", err)
	}

	for _, item := range []struct {
		name   string
		reason string
	}{
		{"install", "reserved for package files"},
		{"install.ps1", "reserved for package files"},
		{"self", "reserved for package files"},
		{"provider-examples", "reserved for package files"},
		{"feng-runner", "reserved for package files"},
		{"CON", "reserved on Windows"},
		{"aux.txt", "reserved on Windows"},
	} {
		out.Reset()
		errOut.Reset()
		code := Run([]string{"hatch", "--name", item.name, "--portable"}, dir, &out, &errOut)
		if code != 2 {
			t.Fatalf("reserved hatch name %q should fail usage, exit=%d stdout=%s stderr=%s", item.name, code, out.String(), errOut.String())
		}
		if !strings.Contains(errOut.String(), item.reason) {
			t.Fatalf("reserved hatch name %q error was unclear: %s", item.name, errOut.String())
		}
	}
}

func TestGoRuntimeHatchRequiresOptionValues(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		args    []string
		message string
	}{
		{[]string{"hatch", "--name"}, "--name requires a value"},
		{[]string{"hatch", "--name="}, "--name requires a value"},
		{[]string{"hatch", "--name", "--portable"}, "--name requires a value"},
		{[]string{"hatch", "--name", "sample", "--out"}, "--out requires a path"},
		{[]string{"hatch", "--name", "sample", "--out="}, "--out requires a path"},
		{[]string{"hatch", "--name", "sample", "--out", "--portable"}, "--out requires a path"},
	} {
		var out, errOut bytes.Buffer
		code := Run(tc.args, dir, &out, &errOut)
		if code != 2 {
			t.Fatalf("%v should fail usage, exit=%d stdout=%s stderr=%s", tc.args, code, out.String(), errOut.String())
		}
		if !strings.Contains(errOut.String(), tc.message) {
			t.Fatalf("%v error was unclear: %s", tc.args, errOut.String())
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "dist")); !os.IsNotExist(err) {
		t.Fatalf("invalid hatch args should not create default output: %v", err)
	}
}

func TestGoRuntimeHatchRejectsWorkspaceOutputOutsideDist(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "make a portable agent", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	docsDir := filepath.Join(dir, "docs")
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	keepPath := filepath.Join(docsDir, "keep.md")
	if err := os.WriteFile(keepPath, []byte("keep\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "docs", "--out", ".", "--portable"}, dir, &out, &errOut); code != 1 {
		t.Fatalf("hatch should reject workspace output, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "hatch output inside workspace must be under dist/") {
		t.Fatalf("hatch did not explain output boundary: %s", errOut.String())
	}
	data, err := os.ReadFile(keepPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "keep\n" {
		t.Fatalf("hatch modified workspace content: %q", string(data))
	}
}

func TestGoRuntimeHatchBuildsRunnerFromWorkspaceSource(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "build source runner", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if err := writeText(filepath.Join(dir, "go.mod"), "module hatchsource\n\ngo 1.26\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(dir, "cmd", "feng", "main.go"), "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"built-from-source\") }\n"); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "sample", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("hatch exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	packagePath := strings.TrimSpace(out.String())
	exePath := filepath.Join(packagePath, packageEntrypointName("sample"))
	output, err := exec.Command(exePath).CombinedOutput()
	if err != nil {
		t.Fatalf("built runner failed: %v output=%s", err, string(output))
	}
	if strings.TrimSpace(string(output)) != "built-from-source" {
		t.Fatalf("hatch did not build runner from workspace source: %s", string(output))
	}
	if _, err := os.Stat(filepath.Join(packagePath, "self", "go.mod")); err != nil {
		t.Fatalf("hatch package did not preserve Go module source: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "self", "cmd", "feng", "main.go")); err != nil {
		t.Fatalf("hatch package did not preserve runner source: %v", err)
	}
}

func TestGoRuntimePortableHatchRunnerContinuesInNewWorkspace(t *testing.T) {
	goExe, err := goExecutable()
	if err != nil {
		t.Skip(err)
	}
	root := moduleRoot(t)
	tmp := t.TempDir()
	fengExe := filepath.Join(tmp, runnerEntrypointName("feng-e2e"))
	build := exec.Command(goExe, "build", "-o", fengExe, "./cmd/feng")
	build.Dir = root
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build cli failed: %v output=%s", err, string(output))
	}
	env := append(os.Environ(), "DEEPSEEK_API_KEY=", "FENG_PROVIDER_RETRIES=0")

	maker := filepath.Join(tmp, "maker")
	if err := os.MkdirAll(maker, 0o755); err != nil {
		t.Fatal(err)
	}
	growOut := runExternalFeng(t, fengExe, maker, env, 2, "grow", "make a portable self", "--max-turns", "1")
	if !strings.Contains(growOut, "missing_config") {
		t.Fatalf("maker grow did not stop on missing config: %s", growOut)
	}
	if err := writeText(filepath.Join(maker, "internal", "runtime", "runtime.go"), "package runtime\n"); err != nil {
		t.Fatal(err)
	}
	runExternalFeng(t, fengExe, maker, env, 0, "check")
	packagePath := strings.TrimSpace(runExternalFeng(t, fengExe, maker, env, 0, "hatch", "--name", "sample", "--portable"))
	packageRunner := filepath.Join(packagePath, packageEntrypointName("sample"))
	if _, err := os.Stat(packageRunner); err != nil {
		t.Fatal(err)
	}
	manifestData, err := os.ReadFile(filepath.Join(packagePath, "feng-release.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest HatchManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatal(err)
	}

	user := filepath.Join(tmp, "user")
	if err := os.MkdirAll(user, 0o755); err != nil {
		t.Fatal(err)
	}
	userGrowOut := runExternalFeng(t, packageRunner, user, env, 2, "grow", "continue from packaged self", "--max-turns", "1")
	if !strings.Contains(userGrowOut, "missing_config") {
		t.Fatalf("packaged runner grow did not use normal provider handling: %s", userGrowOut)
	}
	if _, err := os.Stat(filepath.Join(user, "identity.md")); err != nil {
		t.Fatalf("packaged runner did not seed self repo in new workspace: %v", err)
	}
	if _, err := os.Stat(filepath.Join(user, "internal", "runtime", "runtime.go")); err != nil {
		t.Fatalf("packaged runner did not seed optional runtime source root: %v", err)
	}
	userState, err := loadState(user)
	if err != nil {
		t.Fatal(err)
	}
	if userState.SourceSelfCommit != manifest.SelfCommit {
		t.Fatalf("packaged runner did not record source self commit: state=%q manifest=%q", userState.SourceSelfCommit, manifest.SelfCommit)
	}
	if goruntime.GOOS == "windows" {
		if _, err := exec.LookPath("pwsh"); err == nil {
			binDir := filepath.Join(tmp, "installed-bin")
			install := exec.Command("pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filepath.Join(packagePath, "install.ps1"), "-BinDir", binDir)
			if output, err := install.CombinedOutput(); err != nil {
				t.Fatalf("install.ps1 failed: %v output=%s", err, string(output))
			}
			installedRunner := filepath.Join(binDir, packageEntrypointName("sample"))
			if output, err := exec.Command(installedRunner, "--help").CombinedOutput(); err != nil || !strings.Contains(string(output), "usage: feng") {
				t.Fatalf("installed launcher failed: err=%v output=%s", err, string(output))
			}
		}
	}
	runExternalFeng(t, packageRunner, user, env, 0, "check")
	secondPackage := strings.TrimSpace(runExternalFeng(t, packageRunner, user, env, 0, "hatch", "--name", "sample2", "--portable"))
	if _, err := os.Stat(filepath.Join(secondPackage, packageEntrypointName("sample2"))); err != nil {
		t.Fatalf("second hatch package is not runnable: %v", err)
	}
}

func TestGoRuntimeCheckRejectsBrokenGoSource(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "reject broken go source", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if err := writeText(filepath.Join(dir, "go.mod"), "module brokensource\n\ngo 1.26\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(dir, "internal", "runtime", "broken.go"), "package runtime\n\nfunc broken(\n"); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 1 {
		t.Fatalf("check should fail broken go source, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "source health failed") {
		t.Fatalf("check did not report source health failure: %s", out.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.CandidateStatus != "failed" {
		t.Fatalf("broken source should not validate: %+v", state)
	}
	if state.LastRecovery["type"] != "check_failed" || state.LastRecovery["artifact"] == "" {
		t.Fatalf("check failure should record recovery material: %+v", state.LastRecovery)
	}
	if state.RecoveryCount < 1 {
		t.Fatalf("check failure should increment recovery_count: %+v", state)
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(state.LastRecovery["artifact"]))); err != nil {
		t.Fatalf("last_recovery artifact missing: %v", err)
	}
	if !artifactTypeExists(dir, "source-health") {
		t.Fatalf("source health artifact missing: %+v", listArtifacts(dir))
	}
}

func TestGoRuntimeSourceHealthUsesConfiguredGoExecutableOutsidePATH(t *testing.T) {
	goExe, err := goExecutable()
	if err != nil {
		t.Skip(err)
	}
	dir := t.TempDir()
	if _, err := bootstrap(dir, "source health path test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(dir, "go.mod"), "module sourcehealthpath\n\ngo 1.26\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeText(filepath.Join(dir, "pkg", "ok", "ok.go"), "package ok\n\nfunc OK() bool { return true }\n"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_GO_EXECUTABLE", goExe)
	t.Setenv("PATH", "")

	if problems := runSourceHealthChecks(dir); len(problems) != 0 {
		t.Fatalf("source health should use configured go executable outside PATH: %+v", problems)
	}
}

func TestGoRuntimeSourceHealthTimeoutIsConfigurable(t *testing.T) {
	t.Setenv("FENG_SOURCE_HEALTH_TIMEOUT_SECONDS", "")
	if got := sourceHealthTimeoutSeconds(); got != 600 {
		t.Fatalf("default source health timeout=%d", got)
	}
	t.Setenv("FENG_SOURCE_HEALTH_TIMEOUT_SECONDS", "900")
	if got := sourceHealthTimeoutSeconds(); got != 900 {
		t.Fatalf("configured source health timeout=%d", got)
	}
	t.Setenv("FENG_SOURCE_HEALTH_TIMEOUT_SECONDS", "999999")
	if got := sourceHealthTimeoutSeconds(); got != 1800 {
		t.Fatalf("source health timeout cap=%d", got)
	}
	t.Setenv("FENG_SOURCE_HEALTH_TIMEOUT_SECONDS", "bad")
	if got := sourceHealthTimeoutSeconds(); got != 600 {
		t.Fatalf("invalid source health timeout fallback=%d", got)
	}
}

func TestGoRuntimeSourceHealthFiltersProviderEnvironment(t *testing.T) {
	env := sourceHealthEnv([]string{
		"PATH=C:/Go/bin",
		"GOCACHE=C:/cache",
		"FENG_SOURCE_HEALTH_TIMEOUT_SECONDS=30",
		"FENG_LLM_BASE_URL=http://127.0.0.1:1",
		"FENG_LLM_MODEL=test-model",
		"FENG_PROVIDER_CONFIG=provider.yaml",
		"FENG_PROVIDER_RETRIES=0",
		"FENG_HOME=C:/user/.feng",
		"DEEPSEEK_API_KEY=sk-test",
		"ANTHROPIC_API_KEY=sk-ant",
		"OPENAI_API_KEY=sk-openai",
	})

	for _, key := range []string{"PATH", "GOCACHE", "FENG_SOURCE_HEALTH_TIMEOUT_SECONDS"} {
		if !envHasKey(env, key) {
			t.Fatalf("source health env should preserve %s: %+v", key, env)
		}
	}
	for _, key := range []string{"FENG_LLM_BASE_URL", "FENG_LLM_MODEL", "FENG_PROVIDER_CONFIG", "FENG_PROVIDER_RETRIES", "FENG_HOME", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"} {
		if envHasKey(env, key) {
			t.Fatalf("source health env should filter %s: %+v", key, env)
		}
	}
}

func TestGoRuntimeTagRequiresValidatedCleanHead(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "make a taggable agent", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"tag", "too-early"}, dir, &out, &errOut); code != 1 {
		t.Fatalf("tag before check should fail, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "dirty.md"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"tag", "dirty-v1"}, dir, &out, &errOut); code != 1 {
		t.Fatalf("tag on dirty tree should fail, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
}

func artifactTypeExists(workspace, artifactType string) bool {
	for _, artifact := range listArtifacts(workspace) {
		if artifact.Type == artifactType {
			return true
		}
	}
	return false
}

func hasEventWithTemplate(workspace, template string) bool {
	for _, event := range tailEvents(workspace, 20) {
		if event.Type == "run_started" && event.Data["template"] == template {
			return true
		}
	}
	return false
}

func hasRunStartedMode(workspace, mode string) bool {
	for _, event := range tailEvents(workspace, 50) {
		if event.Type == "run_started" && event.Data["mode"] == mode {
			return true
		}
	}
	return false
}

func hasEventWithArtifactPath(workspace, eventType, path string) bool {
	for _, event := range tailEvents(workspace, 50) {
		if event.Type == eventType && event.Data["artifact"] == path {
			return true
		}
	}
	return false
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if exists(filepath.Join(dir, "go.mod")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found")
		}
		dir = parent
	}
}

func runExternalFeng(t *testing.T, exe, cwd string, env []string, wantCode int, args ...string) string {
	t.Helper()
	cmd := exec.Command(exe, args...)
	cmd.Dir = cwd
	cmd.Env = env
	output, err := cmd.CombinedOutput()
	if exitCode(err) != wantCode {
		t.Fatalf("%s %s exit=%d want=%d err=%v output=%s", exe, strings.Join(args, " "), exitCode(err), wantCode, err, string(output))
	}
	return string(output)
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	}
	return -1
}

func envHasKey(env []string, key string) bool {
	prefix := key + "="
	for _, item := range env {
		if strings.HasPrefix(item, prefix) {
			return true
		}
	}
	return false
}

func stringSliceEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func TestGoRuntimeGUIWritesReadOnlyDashboard(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	secretLike := "sk-" + "thisshouldberedacted123456"
	if code := Run([]string{"grow", "observe " + secretLike, "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	code := Run([]string{"gui"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("gui exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	path := strings.TrimSpace(out.String())
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	html := string(data)
	for _, needle := range []string{"Running", "Progress", "Artifacts", "missing DEEPSEEK_API_KEY", "This page is read-only"} {
		if !strings.Contains(html, needle) {
			t.Fatalf("dashboard missing %q:\n%s", needle, html)
		}
	}
	if strings.Contains(html, secretLike) {
		t.Fatal("dashboard leaked secret-looking value")
	}
	if !strings.Contains(html, "[redacted-secret]") {
		t.Fatal("dashboard did not redact secret-looking value")
	}
}

func TestGoRuntimeGUIOutputInsideWorkspaceStaysUnderFeng(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "gui output boundary test", ""); err != nil {
		t.Fatal(err)
	}
	identityBefore, err := os.ReadFile(filepath.Join(dir, "identity.md"))
	if err != nil {
		t.Fatal(err)
	}

	var out, errOut bytes.Buffer
	code := Run([]string{"gui", "--out", "identity.md"}, dir, &out, &errOut)
	if code != 1 {
		t.Fatalf("gui should reject self root output, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "gui output inside workspace must be under .feng/") {
		t.Fatalf("gui output boundary error was unclear: %s", errOut.String())
	}
	identityAfter, err := os.ReadFile(filepath.Join(dir, "identity.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(identityAfter) != string(identityBefore) {
		t.Fatalf("gui mutated identity.md: before=%q after=%q", string(identityBefore), string(identityAfter))
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"gui", "--out", ".feng/custom-dashboard.html"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("gui should allow .feng output, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if _, err := os.Stat(filepath.Join(dir, ".feng", "custom-dashboard.html")); err != nil {
		t.Fatalf("gui did not write .feng output: %v", err)
	}

	outside := filepath.Join(t.TempDir(), "dashboard.html")
	out.Reset()
	errOut.Reset()
	code = Run([]string{"gui", "--out", outside}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("gui should allow outside-workspace export, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("gui did not write outside export: %v", err)
	}
}

func TestGoRuntimeGUIOutRequiresPath(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "gui out arg test", ""); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"gui", "--out"},
		{"gui", "--out="},
	} {
		var out, errOut bytes.Buffer
		code := Run(args, dir, &out, &errOut)
		if code != 2 {
			t.Fatalf("%v should fail usage, exit=%d stdout=%s stderr=%s", args, code, out.String(), errOut.String())
		}
		if !strings.Contains(errOut.String(), "--out requires a path") {
			t.Fatalf("%v error was unclear: %s", args, errOut.String())
		}
	}
	if _, err := os.Stat(filepath.Join(dir, ".feng", "gui.html")); !os.IsNotExist(err) {
		t.Fatalf("invalid gui --out should not write default dashboard: %v", err)
	}
}

func TestListArtifactsSkipsJSONContentFiles(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "artifact metadata test", ""); err != nil {
		t.Fatal(err)
	}
	written, err := writeArtifact(dir, "check-report", "unit", `{"ok":true}`, "check passed", "json content should not be listed as metadata", "json", nil)
	if err != nil {
		t.Fatal(err)
	}

	artifacts := listArtifacts(dir)
	if len(artifacts) != 1 {
		t.Fatalf("expected only metadata artifact, got %+v", artifacts)
	}
	if artifacts[0].Path != written.Path || artifacts[0].Type != "check-report" {
		t.Fatalf("unexpected artifact listing: %+v written=%+v", artifacts, written)
	}
}
