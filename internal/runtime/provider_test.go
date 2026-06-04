package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "feng-test-home-")
	if err == nil {
		_ = os.Setenv("FENG_HOME", home)
	}
	os.Exit(m.Run())
}

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

func TestLoadProviderProfileFromFengHome(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "provider home test", ""); err != nil {
		t.Fatal(err)
	}
	home := t.TempDir()
	t.Setenv("FENG_HOME", home)
	if err := writeJSONFile(filepath.Join(home, "provider.yaml"), map[string]any{
		"id":            "home",
		"protocol":      "openai_chat",
		"base_url":      "http://127.0.0.1:7777",
		"api_key_env":   "HOME_LLM_KEY",
		"default_model": "home-model",
	}); err != nil {
		t.Fatal(err)
	}

	profile, err := loadProviderProfile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if profile.ID != "home" || profile.APIKeyEnv != "HOME_LLM_KEY" || profile.Model != "home-model" {
		t.Fatalf("unexpected provider profile from FENG_HOME: %+v", profile)
	}
}

func TestLoadProviderProfileFromDefaultUserHome(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "provider default home test", ""); err != nil {
		t.Fatal(err)
	}
	userHome := t.TempDir()
	t.Setenv("FENG_HOME", "")
	t.Setenv("HOME", userHome)
	t.Setenv("USERPROFILE", userHome)
	providerDir := filepath.Join(userHome, ".feng")
	if err := writeJSONFile(filepath.Join(providerDir, "provider.yaml"), map[string]any{
		"id":            "default-home",
		"protocol":      "openai_chat",
		"base_url":      "http://127.0.0.1:6666",
		"api_key_env":   "DEFAULT_HOME_LLM_KEY",
		"default_model": "default-home-model",
	}); err != nil {
		t.Fatal(err)
	}

	profile, err := loadProviderProfile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if profile.ID != "default-home" || profile.APIKeyEnv != "DEFAULT_HOME_LLM_KEY" || profile.Model != "default-home-model" {
		t.Fatalf("unexpected provider profile from default user home: %+v", profile)
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

func TestProviderProfileRejectsStoredSecrets(t *testing.T) {
	secretLike := "sk-" + "providersecret1234567890"
	for _, tc := range []struct {
		name    string
		extra   map[string]any
		problem string
	}{
		{
			name:    "direct_api_key",
			extra:   map[string]any{"api_key": secretLike},
			problem: "provider profile must not store API keys or tokens; remove api_key and use api_key_env",
		},
		{
			name: "nested_authorization",
			extra: map[string]any{
				"headers": map[string]any{
					"Authorization": "Bearer " + secretLike,
				},
			},
			problem: "provider profile must not store API keys or tokens; remove headers.Authorization and use api_key_env",
		},
		{
			name:    "secret_like_value",
			extra:   map[string]any{"note": "do not store " + secretLike},
			problem: "provider profile contains a secret-like value in note; use api_key_env instead",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if _, err := bootstrap(dir, "provider secret boundary test", ""); err != nil {
				t.Fatal(err)
			}
			profile := map[string]any{
				"id":            "local",
				"protocol":      "openai_chat",
				"base_url":      "http://127.0.0.1:9999",
				"api_key_env":   "LOCAL_LLM_KEY",
				"default_model": "local-model",
			}
			for key, value := range tc.extra {
				profile[key] = value
			}
			if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), profile); err != nil {
				t.Fatal(err)
			}

			if _, err := loadProviderProfile(dir); err == nil || !strings.Contains(err.Error(), tc.problem) || strings.Contains(err.Error(), secretLike) {
				t.Fatalf("provider secret error not enforced/redacted: err=%v", err)
			}
			status := providerStatus(dir)
			if fmt.Sprint(status["error"]) == "" || strings.Contains(fmt.Sprint(status), secretLike) {
				t.Fatalf("provider status did not expose redacted config error: %+v", status)
			}
			report := runCheck(dir)
			if report.OK {
				t.Fatal("check should reject provider profiles that store secrets")
			}
			for _, problem := range report.Problems {
				if strings.Contains(problem, secretLike) {
					t.Fatalf("check problem leaked secret-like value: %s", problem)
				}
			}
			if !containsProblem(report.Problems, tc.problem) {
				t.Fatalf("expected provider secret problem %q, got %+v", tc.problem, report.Problems)
			}
		})
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

func TestCheckAcceptsAnthropicProviderProtocol(t *testing.T) {
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
	if !report.OK {
		t.Fatalf("expected anthropic_messages provider to pass check: %+v", report.Problems)
	}
}

func TestCheckRejectsUnknownProviderProtocol(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "unknown provider protocol test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), map[string]any{
		"id":            "unknown-local",
		"protocol":      "made_up_protocol",
		"base_url":      "http://127.0.0.1:9999",
		"api_key_env":   "LOCAL_LLM_KEY",
		"default_model": "unknown-like",
	}); err != nil {
		t.Fatal(err)
	}

	report := runCheck(dir)
	if report.OK {
		t.Fatal("expected unknown provider protocol to fail check")
	}
	if !containsProblem(report.Problems, "unsupported provider protocol") {
		t.Fatalf("expected provider protocol problem, got %+v", report.Problems)
	}
}

func TestGrowRunsAnthropicToolCallLoop(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("x-api-key") != "fake-anthropic-key" {
			t.Errorf("unexpected x-api-key header")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("anthropic-version") == "" {
			t.Errorf("missing anthropic-version header")
			http.Error(w, "missing anthropic-version", http.StatusBadRequest)
			return
		}
		var request anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if request.System == "" {
			t.Errorf("system messages were not mapped to top-level system")
			http.Error(w, "missing system", http.StatusBadRequest)
			return
		}
		if len(request.Tools) == 0 || request.Tools[0]["input_schema"] == nil {
			t.Errorf("tools were not mapped to anthropic input_schema: %+v", request.Tools)
			http.Error(w, "bad tools", http.StatusBadRequest)
			return
		}
		requestNumber := requests.Add(1)
		if requestNumber == 1 {
			writeAnthropicResponse(w, []map[string]any{{
				"type":  "tool_use",
				"id":    "toolu_1",
				"name":  "write_file",
				"input": map[string]any{"path": "docs/from-anthropic.md", "content": "anthropic-ok\n"},
			}}, map[string]any{"input_tokens": 100, "output_tokens": 20, "cache_read_input_tokens": 50})
			return
		}
		if !anthropicRequestHasToolResult(request, "toolu_1") {
			t.Errorf("second request did not include tool_result: %+v", request.Messages)
			http.Error(w, "missing tool_result", http.StatusBadRequest)
			return
		}
		writeAnthropicResponse(w, []map[string]any{{"type": "text", "text": "done"}}, nil)
	}))
	defer server.Close()

	dir := t.TempDir()
	if _, err := bootstrap(dir, "anthropic loop test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), map[string]any{
		"id":            "anthropic-local",
		"protocol":      "anthropic_messages",
		"base_url":      server.URL,
		"api_key_env":   "ANTHROPIC_TEST_KEY",
		"default_model": "claude-test",
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ANTHROPIC_TEST_KEY", "fake-anthropic-key")
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "create an anthropic file", "--max-turns", "3"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	data, err := os.ReadFile(filepath.Join(dir, "docs", "from-anthropic.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "anthropic-ok\n" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.ContextBudget["last_prompt_cache_hit_tokens"] != 50 {
		t.Fatalf("anthropic cache usage was not normalized: %+v", state.ContextBudget)
	}
}

func TestGrowRecoversFromOpenAIOutputTruncation(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requestNumber := requests.Add(1)
		if requestNumber == 1 {
			writeChatResponseWithFinishReason(w, map[string]any{"role": "assistant", "content": "partial"}, "length")
			return
		}
		if !strings.Contains(request.Messages[len(request.Messages)-1].Content, "truncated") {
			t.Errorf("retry did not ask for continuation: %+v", request.Messages)
			http.Error(w, "missing continuation", http.StatusBadRequest)
			return
		}
		writeChatResponseWithFinishReason(w, map[string]any{"role": "assistant", "content": "done"}, "stop")
	}))
	defer server.Close()

	dir := t.TempDir()
	if _, err := bootstrap(dir, "output truncation test", ""); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DEEPSEEK_API_KEY", "fake-key")
	t.Setenv("FENG_LLM_BASE_URL", server.URL)
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "trigger truncation", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"ok": true`) {
		t.Fatalf("grow did not recover from output truncation: %s", out.String())
	}
	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != "ready" || state.LastRecovery["type"] != "" {
		t.Fatalf("recovered output truncation should leave ready state: %+v", state)
	}
	if !eventTypeExists(dir, "provider_recovered") {
		t.Fatalf("provider_recovered event missing: %+v", tailEvents(dir, 20))
	}
}

func TestGrowRecoversFromAnthropicOutputTruncation(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestNumber := requests.Add(1)
		if requestNumber > 1 {
			var request anthropicRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode request: %v", err)
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			last := request.Messages[len(request.Messages)-1]
			if len(last.Content) == 0 || !strings.Contains(last.Content[len(last.Content)-1].Text, "truncated") {
				t.Errorf("retry did not ask for continuation: %+v", request.Messages)
				http.Error(w, "missing continuation", http.StatusBadRequest)
				return
			}
			writeAnthropicResponse(w, []map[string]any{{"type": "text", "text": "done"}}, nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"type":        "message",
			"role":        "assistant",
			"stop_reason": "max_tokens",
			"content":     []map[string]any{{"type": "text", "text": "partial"}},
		})
	}))
	defer server.Close()

	dir := t.TempDir()
	if _, err := bootstrap(dir, "anthropic output truncation test", ""); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(filepath.Join(dir, ".feng", "provider.yaml"), map[string]any{
		"id":            "anthropic-local",
		"protocol":      "anthropic_messages",
		"base_url":      server.URL,
		"api_key_env":   "ANTHROPIC_TEST_KEY",
		"default_model": "claude-test",
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ANTHROPIC_TEST_KEY", "fake-key")
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "trigger anthropic truncation", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"ok": true`) {
		t.Fatalf("grow did not recover from anthropic output truncation: %s", out.String())
	}
}

func TestNormalizeLLMHTTPErrorProviderSpecificStatus(t *testing.T) {
	if normalizeLLMHTTPError(403, "forbidden").Kind != "config_error" {
		t.Fatal("403 should be treated as provider configuration or permission error")
	}
	if normalizeLLMHTTPError(529, "overloaded").Kind != "transient" {
		t.Fatal("529 should be treated as transient provider overload")
	}
}

func anthropicRequestHasToolResult(request anthropicRequest, toolUseID string) bool {
	for _, message := range request.Messages {
		for _, block := range message.Content {
			if block.Type == "tool_result" && block.ToolUseID == toolUseID {
				return true
			}
		}
	}
	return false
}

func eventTypeExists(workspace, eventType string) bool {
	for _, event := range tailEvents(workspace, 20) {
		if event.Type == eventType {
			return true
		}
	}
	return false
}

func writeAnthropicResponse(w http.ResponseWriter, content []map[string]any, usage map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	response := map[string]any{
		"type":    "message",
		"role":    "assistant",
		"content": content,
	}
	if usage != nil {
		response["usage"] = usage
	}
	_ = json.NewEncoder(w).Encode(response)
}

func writeChatResponseWithFinishReason(w http.ResponseWriter, message map[string]any, finishReason string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"choices": []map[string]any{{
			"message":       message,
			"finish_reason": finishReason,
		}},
	})
}
