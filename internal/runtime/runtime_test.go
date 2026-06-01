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
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastRecovery["type"] != "" || state.LastRecovery["artifact"] != "" {
		t.Fatalf("successful check should clear stale recovery state: %+v", state.LastRecovery)
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
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "sample", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("hatch exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	packagePath := strings.TrimSpace(out.String())
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "sample", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("second hatch should replace prior package, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if strings.TrimSpace(out.String()) != packagePath {
		t.Fatalf("second hatch changed package path: %q != %q", strings.TrimSpace(out.String()), packagePath)
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
