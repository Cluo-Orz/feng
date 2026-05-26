package runtime

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadProviderProfileFromWorkspaceConfig(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "provider test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), map[string]any{
		"id":            "local",
		"protocol":      "openai_chat",
		"base_url":      "http://127.0.0.1:9999",
		"api_key_env":   "LOCAL_LLM_KEY",
		"default_model": "local-model",
	}); err != nil {
		t.Fatal(err)
	}

	profile, err := loadProviderProfile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if profile.ID != "local" || profile.APIKeyEnv != "LOCAL_LLM_KEY" || profile.Model != "local-model" {
		t.Fatalf("unexpected provider profile: %+v", profile)
	}
}

func TestProviderProfileEnvOverrides(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "provider override test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), map[string]any{
		"id":            "local",
		"protocol":      "openai_chat",
		"base_url":      "http://old.example",
		"api_key_env":   "LOCAL_LLM_KEY",
		"default_model": "old-model",
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_LLM_MODEL", "override-model")
	t.Setenv("FENG_LLM_BASE_URL", "http://new.example")

	profile, err := loadProviderProfile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if profile.Model != "override-model" || profile.BaseURL != "http://new.example" {
		t.Fatalf("env overrides not applied: %+v", profile)
	}
}

func TestGrowMissingConfigUsesConfiguredProviderEnv(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "missing custom key test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), map[string]any{
		"id":            "local",
		"protocol":      "openai_chat",
		"base_url":      "http://127.0.0.1:9999",
		"api_key_env":   "LOCAL_LLM_KEY",
		"default_model": "local-model",
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DEEPSEEK_API_KEY", "")
	t.Setenv("LOCAL_LLM_KEY", "")
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "use custom provider", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "LOCAL_LLM_KEY") {
		t.Fatalf("missing config did not use configured env: %s", out.String())
	}
}

func TestCheckRejectsUnsupportedProviderProtocol(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "provider protocol test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), map[string]any{
		"id":            "anthropic-local",
		"protocol":      "anthropic_messages",
		"base_url":      "http://127.0.0.1:9999",
		"api_key_env":   "LOCAL_LLM_KEY",
		"default_model": "claude-like",
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected unsupported provider protocol to fail check")
	}
	if !containsProblem(report.Problems, "unsupported provider protocol") {
		t.Fatalf("expected provider protocol problem, got %+v", report.Problems)
	}
}
