package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func cmdGUI(args []string, cwd string, stdout, stderr io.Writer) int {
	outPath, err := parseGUIArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	workspace, ok := findWorkspace(cwd)
	if !ok {
		fmt.Fprintln(stderr, "not a feng workspace")
		return 1
	}
	if outPath == "" {
		outPath = filepath.Join(workspace, ".feng", "gui.html")
	} else if !filepath.IsAbs(outPath) {
		outPath = filepath.Join(cwd, outPath)
	}
	if err := validateGUIOutputPath(workspace, outPath); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	path, err := writeGUIDashboard(workspace, outPath)
	if err != nil {
		fmt.Fprintf(stderr, "gui failed: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, path)
	return 0
}

func parseGUIArgs(args []string) (string, error) {
	var outPath string
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--out" && i+1 < len(args):
			if strings.TrimSpace(args[i+1]) == "" {
				return "", errors.New("--out requires a path")
			}
			outPath = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--out="):
			outPath = strings.TrimPrefix(args[i], "--out=")
			if strings.TrimSpace(outPath) == "" {
				return "", errors.New("--out requires a path")
			}
		case args[i] == "--out":
			return "", errors.New("--out requires a path")
		default:
			return "", fmt.Errorf("unknown gui argument: %s", args[i])
		}
	}
	return outPath, nil
}

func validateGUIOutputPath(workspace, outPath string) error {
	absPath, err := filepath.Abs(outPath)
	if err != nil {
		return err
	}
	absWorkspace, err := filepath.Abs(workspace)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(absWorkspace, absPath)
	if err != nil {
		return err
	}
	relSlash := filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(relSlash, "../") {
		return nil
	}
	if relSlash == ".feng" || strings.HasPrefix(relSlash, ".feng/") {
		return nil
	}
	return fmt.Errorf("gui output inside workspace must be under .feng/: %s", relSlash)
}

func writeGUIDashboard(workspace, outPath string) (string, error) {
	state, err := loadState(workspace)
	if err != nil {
		return "", err
	}
	state.Lock = currentLockSnapshot(workspace)
	events := tailEvents(workspace, 80)
	artifacts := listArtifacts(workspace)
	provider := providerStatus(workspace)
	htmlContent := renderGUIDashboard(state, events, artifacts, provider)
	if err := writeText(outPath, htmlContent); err != nil {
		return "", err
	}
	appendEvent(workspace, "gui_written", map[string]any{"path": relPath(workspace, outPath)})
	return outPath, nil
}

func providerStatus(workspace string) map[string]any {
	paths := providerProfileCandidates(workspace)
	examples := providerExamplePaths()
	profile, err := loadProviderProfile(workspace)
	if err != nil {
		return map[string]any{
			"ok":                    false,
			"error":                 err.Error(),
			"provider_config_paths": paths,
			"provider_examples":     examples,
		}
	}
	missing := os.Getenv(profile.APIKeyEnv) == ""
	return map[string]any{
		"ok":                    !missing,
		"id":                    profile.ID,
		"protocol":              profile.Protocol,
		"base_url":              profile.BaseURL,
		"api_key_env":           profile.APIKeyEnv,
		"model":                 profile.Model,
		"missing_config":        missing,
		"required_env":          []string{profile.APIKeyEnv},
		"provider_config_paths": paths,
		"provider_examples":     examples,
		"suggested_provider_profile": map[string]any{
			"id":            profile.ID,
			"protocol":      profile.Protocol,
			"base_url":      profile.BaseURL,
			"api_key_env":   profile.APIKeyEnv,
			"default_model": profile.Model,
		},
	}
}

func providerExamplePaths() []string {
	names := []string{
		filepath.Join("provider-examples", "deepseek.yaml"),
		filepath.Join("provider-examples", "deepseek-anthropic.yaml"),
	}
	exe, err := os.Executable()
	if err != nil {
		return slashPaths(names)
	}
	dir := filepath.Dir(exe)
	var paths []string
	for _, name := range names {
		full := filepath.Join(dir, name)
		if exists(full) {
			paths = append(paths, filepath.ToSlash(full))
		} else {
			paths = append(paths, filepath.ToSlash(name))
		}
	}
	return paths
}

func slashPaths(paths []string) []string {
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		out = append(out, filepath.ToSlash(path))
	}
	return out
}

func renderGUIDashboard(state State, events []Event, artifacts []Artifact, provider map[string]any) string {
	var b strings.Builder
	b.WriteString("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">")
	b.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
	b.WriteString("<title>feng dashboard</title>")
	b.WriteString("<style>")
	b.WriteString("body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#f7f7f4;color:#1f2328}main{max-width:1120px;margin:0 auto;padding:24px}h1{font-size:28px;margin:0 0 18px}h2{font-size:16px;margin:0 0 10px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.panel{border:1px solid #d9d9d2;background:#fff;border-radius:8px;padding:14px;min-width:0}.wide{grid-column:1/-1}.metric{font-size:13px;color:#61666d}.value{font-size:20px;font-weight:650;margin-top:4px;overflow-wrap:anywhere}.ok{color:#166534}.bad{color:#b42318}.table{width:100%;border-collapse:collapse;font-size:13px}.table th,.table td{border-top:1px solid #ecece7;padding:8px;text-align:left;vertical-align:top}.mono{font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#6b7280}@media(max-width:760px){.grid{grid-template-columns:1fr}main{padding:16px}}")
	b.WriteString("</style></head><body><main>")
	b.WriteString("<h1>feng dashboard</h1>")
	b.WriteString("<section class=\"grid\">")
	writeMetric(&b, "Running", "state", runningLabel(state), runningOK(state))
	writeMetric(&b, "Progress", "candidate", state.CandidateStatus, state.CandidateStatus == "validated" || state.Mode == "ready")
	writeMetric(&b, "Provider", "config", providerLabel(provider), provider["ok"] == true)
	b.WriteString("<div class=\"panel wide\"><h2>Current Goal</h2><div class=\"mono\">")
	b.WriteString(escapeGUI(state.CurrentGoal))
	b.WriteString("</div></div>")
	b.WriteString("<div class=\"panel\"><h2>Version</h2>")
	writeKV(&b, "validated", state.ValidatedCommit)
	writeKV(&b, "last event", state.LastEventID)
	writeKV(&b, "tool pack", state.ActiveToolPackHash)
	writeKV(&b, "stable prefix", state.StablePrefixHash)
	writeKV(&b, "context pack", state.ContextPackHash)
	b.WriteString("</div>")
	b.WriteString("<div class=\"panel\"><h2>Lock</h2>")
	writeKV(&b, "active", state.Lock["active"])
	writeKV(&b, "stale", state.Lock["stale"])
	writeKV(&b, "owner", state.Lock["owner"])
	writeKV(&b, "pid", state.Lock["pid"])
	writeKV(&b, "started", state.Lock["started_at"])
	writeKV(&b, "heartbeat", state.Lock["heartbeat"])
	b.WriteString("</div>")
	b.WriteString("<div class=\"panel\"><h2>Context</h2>")
	for _, pair := range sortedContextBudget(state.ContextBudget) {
		writeKV(&b, pair.key, fmt.Sprint(pair.value))
	}
	b.WriteString("</div>")
	b.WriteString("<div class=\"panel\"><h2>Recovery</h2>")
	for key, value := range state.LastRecovery {
		writeKV(&b, key, value)
	}
	b.WriteString("</div>")
	writeEvents(&b, events)
	writeArtifacts(&b, artifacts)
	writeJSONPanel(&b, "Provider Profile", provider)
	b.WriteString("</section>")
	b.WriteString("<p class=\"muted\">Generated by feng. This page is read-only and does not execute tools.</p>")
	b.WriteString("</main></body></html>")
	return b.String()
}

func runningLabel(state State) string {
	if state.Lock["stale"] == "true" {
		return "stale lock"
	}
	if state.Lock["active"] == "true" {
		owner := strings.TrimSpace(state.Lock["owner"])
		if owner == "" {
			owner = "session"
		}
		return owner + " running"
	}
	if strings.TrimSpace(state.Mode) == "" {
		return "unknown"
	}
	return state.Mode
}

func runningOK(state State) bool {
	if state.Lock["stale"] == "true" {
		return false
	}
	return state.Mode != "blocked" && state.Mode != "missing_config"
}

func writeMetric(b *strings.Builder, title, label, value string, ok bool) {
	class := "value ok"
	if !ok {
		class = "value bad"
	}
	b.WriteString("<div class=\"panel\"><h2>")
	b.WriteString(escapeGUI(title))
	b.WriteString("</h2><div class=\"metric\">")
	b.WriteString(escapeGUI(label))
	b.WriteString("</div><div class=\"")
	b.WriteString(class)
	b.WriteString("\">")
	b.WriteString(escapeGUI(value))
	b.WriteString("</div></div>")
}

func writeKV(b *strings.Builder, key, value string) {
	if value == "" {
		value = "-"
	}
	b.WriteString("<div class=\"metric\">")
	b.WriteString(escapeGUI(key))
	b.WriteString("</div><div class=\"mono\">")
	b.WriteString(escapeGUI(value))
	b.WriteString("</div>")
}

func writeEvents(b *strings.Builder, events []Event) {
	b.WriteString("<div class=\"panel wide\"><h2>Progress</h2><table class=\"table\"><thead><tr><th>Time</th><th>Type</th><th>Data</th></tr></thead><tbody>")
	for i := len(events) - 1; i >= 0; i-- {
		event := events[i]
		data, _ := json.Marshal(compactEventData(event.Data))
		b.WriteString("<tr><td>")
		b.WriteString(escapeGUI(time.UnixMilli(event.TS).Format(time.RFC3339)))
		b.WriteString("</td><td>")
		b.WriteString(escapeGUI(event.Type))
		b.WriteString("</td><td class=\"mono\">")
		b.WriteString(escapeGUI(string(data)))
		b.WriteString("</td></tr>")
	}
	b.WriteString("</tbody></table></div>")
}

func writeArtifacts(b *strings.Builder, artifacts []Artifact) {
	b.WriteString("<div class=\"panel wide\"><h2>Artifacts</h2><table class=\"table\"><thead><tr><th>Type</th><th>Source</th><th>Path</th><th>Summary</th></tr></thead><tbody>")
	for i := len(artifacts) - 1; i >= 0; i-- {
		artifact := artifacts[i]
		b.WriteString("<tr><td>")
		b.WriteString(escapeGUI(artifact.Type))
		b.WriteString("</td><td>")
		b.WriteString(escapeGUI(artifact.Source))
		b.WriteString("</td><td class=\"mono\">")
		b.WriteString(escapeGUI(artifact.Path))
		b.WriteString("</td><td>")
		b.WriteString(escapeGUI(artifact.Summary))
		b.WriteString("</td></tr>")
	}
	b.WriteString("</tbody></table></div>")
}

func writeJSONPanel(b *strings.Builder, title string, value any) {
	encoded, _ := json.MarshalIndent(value, "", "  ")
	b.WriteString("<div class=\"panel wide\"><h2>")
	b.WriteString(escapeGUI(title))
	b.WriteString("</h2><pre class=\"mono\">")
	b.WriteString(escapeGUI(string(encoded)))
	b.WriteString("</pre></div>")
}

func providerLabel(provider map[string]any) string {
	if provider["ok"] == true {
		return fmt.Sprint(provider["id"]) + " ready"
	}
	if provider["missing_config"] == true {
		return "missing " + fmt.Sprint(provider["api_key_env"])
	}
	return "not configured"
}

func sortedContextBudget(values map[string]int) []stringPair {
	pairs := make([]stringPair, 0, len(values))
	for key, value := range values {
		pairs = append(pairs, stringPair{key: key, value: value})
	}
	sortStringPairs(pairs)
	return pairs
}

type stringPair struct {
	key   string
	value int
}

func sortStringPairs(pairs []stringPair) {
	for i := 0; i < len(pairs); i++ {
		for j := i + 1; j < len(pairs); j++ {
			if pairs[j].key < pairs[i].key {
				pairs[i], pairs[j] = pairs[j], pairs[i]
			}
		}
	}
}

func escapeGUI(value string) string {
	return html.EscapeString(secretPattern.ReplaceAllString(value, "[redacted-secret]"))
}
