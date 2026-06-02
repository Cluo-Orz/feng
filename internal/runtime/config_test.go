package runtime

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigInitWritesWorkspaceProviderProfileWithoutSecret(t *testing.T) {
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	code := Run([]string{"config", "init"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("config init exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	path := filepath.Join(dir, ".feng", "provider.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, `"api_key_env": "DEEPSEEK_API_KEY"`) ||
		!strings.Contains(text, `"base_url": "https://api.deepseek.com"`) {
		t.Fatalf("provider profile missing expected fields: %s", text)
	}
	if strings.Contains(text, "sk-") {
		t.Fatalf("provider profile should not store API keys: %s", text)
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"config", "status"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("config status exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"provider":`) ||
		!strings.Contains(out.String(), `"required_env"`) ||
		!strings.Contains(out.String(), `"provider_config_paths"`) {
		t.Fatalf("config status missing provider hints: %s", out.String())
	}
}

func TestConfigInitUserScopeUsesFengHome(t *testing.T) {
	dir := t.TempDir()
	home := t.TempDir()
	t.Setenv("FENG_HOME", home)
	var out, errOut bytes.Buffer
	code := Run([]string{"config", "init", "--user", "--provider", "deepseek-anthropic"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("config init --user exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	data, err := os.ReadFile(filepath.Join(home, "provider.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"protocol": "anthropic_messages"`) {
		t.Fatalf("user provider profile did not use requested template: %s", string(data))
	}
	if _, err := os.Stat(filepath.Join(dir, ".feng", "provider.yaml")); !os.IsNotExist(err) {
		t.Fatalf("user scoped config should not write workspace profile: %v", err)
	}
}

func TestPackagedBusinessConfigInitDoesNotEnterExecuteMode(t *testing.T) {
	seed := t.TempDir()
	user := t.TempDir()
	if _, err := bootstrap(seed, "seed config command", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{map[string]any{"name": "run", "usage": "app [args...]"}},
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_PACKAGED_SELF", seed)

	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"config", "init"}, user, &out, &errOut, "app.exe")
	if code != 0 {
		t.Fatalf("packaged config init exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if _, err := os.Stat(filepath.Join(user, ".feng", "provider.yaml")); err != nil {
		t.Fatalf("packaged config init did not write user workspace provider profile: %v", err)
	}
	for _, rel := range []string{"identity.md", "skills", "tools", "world", "interface.yaml", "permissions.yaml"} {
		if _, err := os.Stat(filepath.Join(user, rel)); !os.IsNotExist(err) {
			t.Fatalf("packaged config should not expose self repo in user workspace at %s: %v", rel, err)
		}
	}
}

func TestPackagedConfigInitRefusesPackageDirectoryWorkspaceScope(t *testing.T) {
	packageRoot := t.TempDir()
	seed := filepath.Join(packageRoot, "self")
	if err := writeText(filepath.Join(packageRoot, hatchPackageMarker), "package marker\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(seed, "interface.yaml"), map[string]any{
		"commands": []any{"grow", "check", "hatch", "status", "watch", "artifacts", "gui", "tag", "config"},
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_PACKAGED_SELF", seed)

	var out, errOut bytes.Buffer
	code := RunWithExecutable([]string{"config", "init"}, packageRoot, &out, &errOut, "feng.exe")
	if code != 1 {
		t.Fatalf("workspace config init in package dir should fail, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(errOut.String(), "hatch package directory cannot be used as a workspace") {
		t.Fatalf("package workspace refusal was unclear: %s", errOut.String())
	}
	if _, err := os.Stat(filepath.Join(packageRoot, ".feng")); !os.IsNotExist(err) {
		t.Fatalf("config init mutated package root: %v", err)
	}

	home := t.TempDir()
	t.Setenv("FENG_HOME", home)
	out.Reset()
	errOut.Reset()
	code = RunWithExecutable([]string{"config", "init", "--user"}, packageRoot, &out, &errOut, "feng.exe")
	if code != 0 {
		t.Fatalf("user config init in package dir should work, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if _, err := os.Stat(filepath.Join(home, "provider.yaml")); err != nil {
		t.Fatalf("user provider profile was not written: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packageRoot, ".feng")); !os.IsNotExist(err) {
		t.Fatalf("user config init mutated package root: %v", err)
	}
}
