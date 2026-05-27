package runtime

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
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
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
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
	if _, err := os.Stat(filepath.Join(packagePath, "self", "identity.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "feng-release.yaml")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "checksums.json")); err != nil {
		t.Fatal(err)
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
	exePath := filepath.Join(packagePath, runnerEntrypointName("sample"))
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
	runExternalFeng(t, fengExe, maker, env, 0, "check")
	packagePath := strings.TrimSpace(runExternalFeng(t, fengExe, maker, env, 0, "hatch", "--name", "sample", "--portable"))
	packageRunner := filepath.Join(packagePath, runnerEntrypointName("sample"))
	if _, err := os.Stat(packageRunner); err != nil {
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
	runExternalFeng(t, packageRunner, user, env, 0, "check")
	secondPackage := strings.TrimSpace(runExternalFeng(t, packageRunner, user, env, 0, "hatch", "--name", "sample2", "--portable"))
	if _, err := os.Stat(filepath.Join(secondPackage, runnerEntrypointName("sample2"))); err != nil {
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
	if !artifactTypeExists(dir, "source-health") {
		t.Fatalf("source health artifact missing: %+v", listArtifacts(dir))
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
