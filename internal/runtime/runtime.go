package runtime

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const stateVersion = 1
const (
	maxEventStringLength = 2000
	maxEventArrayItems   = 50
)

var (
	eventSequence atomic.Uint64
	stateFileMu   sync.Mutex

	selfFiles = map[string]any{
		"identity.md": "This is a feng self.\n\nIt starts without project-specific skills. Stable capabilities must grow through candidate files and pass check before becoming validated self.\n",
		"goal.md":     "",
		"feng.yaml": map[string]any{
			"version": 1,
			"name":    "feng-workspace",
			"llm": map[string]any{
				"provider": "deepseek",
				"model":    "deepseek-chat",
			},
		},
		"hooks.yaml": map[string]any{
			"on_grow":         []any{},
			"on_check_failed": []any{},
		},
		"permissions.yaml": defaultPermissionsConfig(),
		"interface.yaml":   defaultInterfaceConfig(),
		"config.schema.yaml": map[string]any{
			"provider_profiles": []any{"deepseek"},
			"env":               []any{"DEEPSEEK_API_KEY"},
		},
	}

	selfDirs = map[string]string{
		"skills": "Skills grow from candidate files. This directory may be empty.\n",
		"tools":  "Tool declarations grow here. MVP tools use feng's internal Tool/ToolCall/ToolResult protocol and JSON-compatible *.tool.yaml command wrappers. MCP is a future adapter, not an MVP tool type.\n",
		"world":  "Stable world descriptions live here. Runtime logs do not.\n",
		"evals":  "Candidate and baseline evals live here.\n",
	}

	runtimeGitignore = []string{
		".feng/lock",
		".feng/provider.yaml",
		".feng/provider.json",
		".feng/gui.html",
		".feng/state.yaml",
		".feng/events.jsonl",
		".feng/artifacts/",
		".feng/cache/",
		".feng/runs/",
		"dist/",
	}

	secretPattern = regexp.MustCompile(`sk-[A-Za-z0-9_-]{16,}`)
)

func defaultInterfaceConfig() map[string]any {
	return map[string]any{
		"commands": []any{"grow", "check", "hatch", "status", "watch", "artifacts", "gui", "tag", "config"},
	}
}

type State struct {
	Version            int               `json:"version"`
	Mode               string            `json:"mode"`
	CurrentGoal        string            `json:"current_goal"`
	ValidatedCommit    string            `json:"validated_commit"`
	SourceSelfCommit   string            `json:"source_self_commit"`
	CandidateStatus    string            `json:"candidate_status"`
	ActiveToolPackHash string            `json:"active_tool_pack_hash"`
	StablePrefixHash   string            `json:"stable_prefix_hash"`
	ContextBudget      map[string]int    `json:"context_budget"`
	LastRecovery       map[string]string `json:"last_recovery"`
	RecoveryCount      int               `json:"recovery_count"`
	LastEventID        string            `json:"last_event_id"`
	LastArtifacts      []Artifact        `json:"last_artifacts"`
	Lock               map[string]string `json:"lock"`
}

type Artifact struct {
	Type        string   `json:"type"`
	Source      string   `json:"source"`
	Path        string   `json:"path"`
	Hash        string   `json:"hash"`
	Summary     string   `json:"summary"`
	WhyRelevant string   `json:"why_relevant"`
	Snippets    []string `json:"snippets"`
}

type Event struct {
	ID   string         `json:"id"`
	TS   int64          `json:"ts"`
	Type string         `json:"type"`
	Data map[string]any `json:"data"`
}

type CheckReport struct {
	OK              bool     `json:"ok"`
	Problems        []string `json:"problems"`
	ValidatedCommit string   `json:"validated_commit"`
}

type StatusSnapshot struct {
	State
	Provider map[string]any `json:"provider"`
}

func Run(args []string, cwd string, stdout, stderr io.Writer) int {
	return RunWithExecutable(args, cwd, stdout, stderr, "")
}

func RunWithExecutable(args []string, cwd string, stdout, stderr io.Writer, executable string) int {
	if cwd == "" {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	if err := verifyCurrentPackageIntegrity(); err != nil {
		fmt.Fprintf(stderr, "package integrity check failed: %v\n", err)
		return 1
	}
	if shouldRunPackagedConfigCommand(args) {
		return cmdConfig(args[1:], cwd, stdout, stderr)
	}
	if shouldRunPackagedExecute(args, executable) {
		return cmdExecute(args, cwd, stdout, stderr, executable)
	}
	if len(args) > 0 && args[0] == "config" {
		return cmdConfig(args[1:], cwd, stdout, stderr)
	}
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		printHelp(stdout)
		return 0
	}
	switch args[0] {
	case "grow":
		return cmdGrow(args[1:], cwd, stdout, stderr)
	case "check":
		if err := noExtraArgs("check", args[1:]); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		return cmdCheck(cwd, stdout, stderr)
	case "status":
		if err := noExtraArgs("status", args[1:]); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		return cmdStatus(cwd, stdout, stderr)
	case "watch":
		return cmdWatch(args[1:], cwd, stdout, stderr)
	case "artifacts":
		if err := noExtraArgs("artifacts", args[1:]); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		return cmdArtifacts(cwd, stdout, stderr)
	case "hatch":
		return cmdHatch(args[1:], cwd, stdout, stderr)
	case "gui":
		return cmdGUI(args[1:], cwd, stdout, stderr)
	case "tag":
		return cmdTag(args[1:], cwd, stdout, stderr)
	case "config":
		return cmdConfig(args[1:], cwd, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unknown command: %s\n", args[0])
		printHelp(stderr)
		return 2
	}
}

func shouldRunPackagedConfigCommand(args []string) bool {
	if len(args) < 2 || args[0] != "config" || packagedSeedSelf() == "" {
		return false
	}
	switch args[1] {
	case "init", "status", "-h", "--help", "help":
		return true
	default:
		return false
	}
}

func noExtraArgs(command string, args []string) error {
	if len(args) == 0 {
		return nil
	}
	return fmt.Errorf("unknown %s argument: %s", command, args[0])
}

func printHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: feng {grow,check,hatch,status,watch,artifacts,gui,tag,config} ...")
	fmt.Fprintln(w, "       feng grow [--template PATH|builtin] [--max-turns N] [--] \"goal\"")
	fmt.Fprintln(w, "       feng watch [--limit N]")
}

func cmdGrow(args []string, cwd string, stdout, stderr io.Writer) int {
	options, err := parseGrowOptions(args, cwd)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if err := rejectPackageWorkspace(cwd, options.SeedSelf); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	workspace := workspaceOrCwd(cwd)
	if _, err := bootstrap(workspace, options.Goal, options.SeedSelf); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	release, err := acquireWorkspaceLock(workspace, "grow")
	if err != nil {
		printJSON(stdout, map[string]any{"ok": false, "reason": "workspace_locked", "message": err.Error()})
		return 2
	}
	defer release()
	state, _ := loadState(workspace)
	hookEvent := growHookEvent(state)
	state.Mode = "growing"
	state.CurrentGoal = options.Goal
	if selfRootsChanged(workspace) && state.CandidateStatus != "failed" {
		state.CandidateStatus = "dirty"
	}
	saveState(workspace, state)
	event := map[string]any{"mode": "grow", "goal": options.Goal, "active_hook": hookEvent}
	if options.Template != "" {
		event["template"] = options.Template
	}
	appendEvent(workspace, "run_started", event)

	return runGrowLoop(workspace, options.Goal, options.MaxTurns, hookEvent, stdout)
}

type GrowOptions struct {
	Goal     string
	MaxTurns int
	Template string
	SeedSelf string
}

func parseGrowArgs(args []string) (string, int, error) {
	options, err := parseGrowOptions(args, "")
	return options.Goal, options.MaxTurns, err
}

func parseGrowOptions(args []string, cwd string) (GrowOptions, error) {
	var parts []string
	options := GrowOptions{MaxTurns: 12}
	for i := 0; i < len(args); i++ {
		if args[i] == "--" {
			parts = append(parts, args[i+1:]...)
			break
		}
		if args[i] == "--max-turns" {
			if i+1 >= len(args) {
				return options, errors.New("--max-turns requires an integer")
			}
			parsed, err := strconv.Atoi(args[i+1])
			if err != nil {
				return options, fmt.Errorf("--max-turns must be an integer: %s", args[i+1])
			}
			options.MaxTurns = parsed
			i++
			continue
		}
		if strings.HasPrefix(args[i], "--max-turns=") {
			raw := strings.TrimPrefix(args[i], "--max-turns=")
			parsed, err := strconv.Atoi(raw)
			if err != nil {
				return options, fmt.Errorf("--max-turns must be an integer: %s", raw)
			}
			options.MaxTurns = parsed
			continue
		}
		if args[i] == "--template" {
			if i+1 >= len(args) {
				return options, errors.New("--template requires a path or builtin")
			}
			options.Template = args[i+1]
			i++
			continue
		}
		if strings.HasPrefix(args[i], "--template=") {
			options.Template = strings.TrimPrefix(args[i], "--template=")
			if strings.TrimSpace(options.Template) == "" {
				return options, errors.New("--template requires a path or builtin")
			}
			continue
		}
		if strings.HasPrefix(args[i], "--") {
			return options, fmt.Errorf("unknown grow argument: %s", args[i])
		}
		parts = append(parts, args[i])
	}
	goal := strings.TrimSpace(strings.Join(parts, " "))
	if goal == "" {
		return options, errors.New("grow requires a goal")
	}
	if options.MaxTurns < 1 {
		options.MaxTurns = 1
	}
	seedSelf, err := resolveGrowSeedSelf(cwd, options.Template)
	if err != nil {
		return options, err
	}
	options.Goal = goal
	options.SeedSelf = seedSelf
	return options, nil
}

func resolveGrowSeedSelf(cwd, template string) (string, error) {
	template = strings.TrimSpace(template)
	if template == "" {
		return packagedSeedSelf(), nil
	}
	if template == "builtin" || template == "default" {
		return "", nil
	}
	base := cwd
	if strings.TrimSpace(base) == "" {
		if current, err := os.Getwd(); err == nil {
			base = current
		}
	}
	path := template
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("template not found: %s", template)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("template must be a directory: %s", template)
	}
	return abs, nil
}

func cmdCheck(cwd string, stdout, stderr io.Writer) int {
	workspace, ok := findWorkspace(cwd)
	if !ok {
		fmt.Fprintln(stderr, "not a feng workspace; run feng grow first")
		return 1
	}
	release, err := acquireWorkspaceLock(workspace, "check")
	if err != nil {
		printJSON(stdout, map[string]any{"ok": false, "reason": "workspace_locked", "message": err.Error()})
		return 2
	}
	defer release()
	report := runCheck(workspace)
	printJSON(stdout, report)
	if !report.OK {
		return 1
	}
	return 0
}

func cmdStatus(cwd string, stdout, stderr io.Writer) int {
	workspace, ok := findWorkspace(cwd)
	if !ok {
		fmt.Fprintln(stderr, "not a feng workspace")
		return 1
	}
	state, err := loadState(workspace)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	state.Lock = currentLockSnapshot(workspace)
	printJSON(stdout, StatusSnapshot{State: state, Provider: providerStatus(workspace)})
	return 0
}

func cmdWatch(args []string, cwd string, stdout, stderr io.Writer) int {
	workspace, ok := findWorkspace(cwd)
	if !ok {
		fmt.Fprintln(stderr, "not a feng workspace")
		return 1
	}
	limit, err := parseWatchLimit(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	for _, event := range tailEvents(workspace, limit) {
		printJSON(stdout, event)
	}
	return 0
}

func parseWatchLimit(args []string) (int, error) {
	limit := 20
	for i := 0; i < len(args); i++ {
		if args[i] == "--limit" {
			if i+1 >= len(args) {
				return 0, errors.New("--limit requires a positive integer")
			}
			parsed, err := strconv.Atoi(args[i+1])
			if err != nil || parsed < 1 {
				return 0, fmt.Errorf("--limit must be a positive integer: %s", args[i+1])
			}
			limit = parsed
			i++
			continue
		}
		if strings.HasPrefix(args[i], "--limit=") {
			raw := strings.TrimPrefix(args[i], "--limit=")
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 {
				return 0, fmt.Errorf("--limit must be a positive integer: %s", raw)
			}
			limit = parsed
			continue
		}
		return 0, fmt.Errorf("unknown watch argument: %s", args[i])
	}
	return limit, nil
}

func cmdArtifacts(cwd string, stdout, stderr io.Writer) int {
	workspace, ok := findWorkspace(cwd)
	if !ok {
		fmt.Fprintln(stderr, "not a feng workspace")
		return 1
	}
	for _, artifact := range listArtifacts(workspace) {
		printJSON(stdout, artifact)
	}
	return 0
}

func runCheck(workspace string) CheckReport {
	var problems []string
	state, _ := loadState(workspace)
	state.Mode = "checking"
	saveState(workspace, state)

	for name := range selfFiles {
		if !exists(filepath.Join(workspace, name)) {
			problems = append(problems, "missing self file: "+name)
		}
	}
	for name := range selfDirs {
		if !exists(filepath.Join(workspace, name)) {
			problems = append(problems, "missing self directory: "+name)
		}
	}
	for _, name := range []string{"feng.yaml", "hooks.yaml", "permissions.yaml", "interface.yaml", "config.schema.yaml"} {
		if _, err := readJSONFile(filepath.Join(workspace, name)); err != nil {
			problems = append(problems, err.Error())
		}
	}
	problems = append(problems, scanSecrets(workspace)...)
	problems = append(problems, checkNoSpecialRuntime(workspace)...)
	problems = append(problems, checkHooksConfig(workspace)...)
	problems = append(problems, checkInterfaceConfig(workspace)...)
	problems = append(problems, checkSelfRepoTools(workspace)...)
	problems = append(problems, checkMessageCompiler(workspace)...)
	problems = append(problems, checkProviderProfile(workspace)...)
	problems = append(problems, runSourceHealthChecks(workspace)...)
	problems = append(problems, runCommandEvals(workspace)...)

	report := CheckReport{OK: len(problems) == 0, Problems: problems, ValidatedCommit: state.ValidatedCommit}
	if report.OK {
		if head, err := checkpointCommit(workspace, "feng: validated checkpoint"); err == nil {
			report.ValidatedCommit = head
			appendEvent(workspace, "validated_commit_updated", map[string]any{"commit": head})
		} else {
			report.OK = false
			report.Problems = append(report.Problems, "git checkpoint failed: "+err.Error())
		}
	}

	content, _ := json.MarshalIndent(report, "", "  ")
	artifact, _ := writeArtifact(workspace, "check-report", "feng-check", string(content), ternary(report.OK, "check passed", "check failed"), "check validates candidate self before hatch", "json", nil)
	artifacts := []Artifact{artifact}
	if !report.OK {
		if diffArtifact, ok := writeDiffSummaryArtifact(workspace); ok {
			artifacts = append(artifacts, diffArtifact)
		}
	}
	state, _ = loadState(workspace)
	state.LastArtifacts = artifacts
	if report.OK {
		state.Mode = "ready"
		state.CandidateStatus = "validated"
		state.ValidatedCommit = report.ValidatedCommit
		state.LastRecovery = emptyRecovery()
	} else {
		state.Mode = "blocked"
		state.CandidateStatus = "failed"
		state.LastRecovery = map[string]string{"type": "check_failed", "artifact": artifact.Path}
		state.RecoveryCount++
	}
	saveState(workspace, state)
	appendEvent(workspace, ternary(report.OK, "check_passed", "check_failed"), map[string]any{"ok": report.OK, "problems": report.Problems, "validated_commit": report.ValidatedCommit})
	return report
}

func selfRootsChanged(workspace string) bool {
	status, err := selfGitStatus(workspace)
	return err == nil && strings.TrimSpace(status) != ""
}

func markCandidateDirtyIfSelfChanged(workspace string) {
	if !selfRootsChanged(workspace) {
		return
	}
	_ = updateState(workspace, func(state *State) {
		state.CandidateStatus = "dirty"
	})
}

func writeDiffSummaryArtifact(workspace string) (Artifact, bool) {
	status, _ := selfGitStatus(workspace)
	stat, _ := runSelfGitPathspec(workspace, "diff", "--stat")
	names, _ := runSelfGitPathspec(workspace, "diff", "--name-only")
	content := strings.TrimSpace("git status --short:\n" + status + "\n\ngit diff --stat:\n" + stat + "\n\ngit diff --name-only:\n" + names)
	if content == "" || content == "git status --short:\n\n\ngit diff --stat:\n\n\ngit diff --name-only:" {
		return Artifact{}, false
	}
	artifact, err := writeArtifact(
		workspace,
		"diff",
		"git",
		content,
		"candidate diff summary",
		"check failed; diff summary helps the next grow repair the candidate without embedding full file contents",
		"txt",
		compactLines(content, 20),
	)
	if err != nil {
		return Artifact{}, false
	}
	return artifact, true
}

func bootstrap(workspace, goal string, seedSelf string) (bool, error) {
	created := false
	sourceSelfCommit := packagedSourceCommit(seedSelf)
	if !exists(filepath.Join(workspace, ".git")) {
		if _, err := runGit(workspace, "init"); err != nil {
			return false, err
		}
	}
	if ensureGitignore(workspace) {
		created = true
	}
	for _, dir := range []string{".feng", ".feng/artifacts", ".feng/cache", ".feng/runs"} {
		if err := os.MkdirAll(filepath.Join(workspace, filepath.FromSlash(dir)), 0o755); err != nil {
			return false, err
		}
	}
	keys := sortedKeysAny(selfFiles)
	for _, name := range keys {
		path := filepath.Join(workspace, name)
		if exists(path) {
			continue
		}
		if seed := filepath.Join(seedSelf, name); seedSelf != "" && exists(seed) {
			if err := copyFile(seed, path); err != nil {
				return false, err
			}
		} else if name == "goal.md" && goal != "" {
			if err := writeText(path, goal+"\n"); err != nil {
				return false, err
			}
		} else if text, ok := selfFiles[name].(string); ok {
			if err := writeText(path, text); err != nil {
				return false, err
			}
		} else if err := writeJSONFile(path, selfFiles[name]); err != nil {
			return false, err
		}
		created = true
	}
	dirKeys := sortedKeysString(selfDirs)
	for _, name := range dirKeys {
		dir := filepath.Join(workspace, name)
		if seed := filepath.Join(seedSelf, name); seedSelf != "" && !exists(dir) && exists(seed) {
			if err := copyDir(seed, dir); err != nil {
				return false, err
			}
			created = true
			continue
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return false, err
		}
		readme := filepath.Join(dir, "README.md")
		if !exists(readme) {
			if err := writeText(readme, selfDirs[name]); err != nil {
				return false, err
			}
			created = true
		}
	}
	for _, name := range seedOptionalSelfNames() {
		path := filepath.Join(workspace, filepath.FromSlash(name))
		seed := filepath.Join(seedSelf, filepath.FromSlash(name))
		if seedSelf == "" || exists(path) || !exists(seed) {
			continue
		}
		info, err := os.Stat(seed)
		if err != nil {
			return false, err
		}
		if info.IsDir() {
			if err := copyDir(seed, path); err != nil {
				return false, err
			}
		} else if err := copyFile(seed, path); err != nil {
			return false, err
		}
		created = true
	}
	statePath := filepath.Join(workspace, ".feng", "state.yaml")
	if !exists(statePath) {
		state := defaultState(goal)
		state.ValidatedCommit = currentHead(workspace)
		state.SourceSelfCommit = sourceSelfCommit
		if err := saveState(workspace, state); err != nil {
			return false, err
		}
		created = true
	}
	if created {
		event := map[string]any{"goal": goal}
		if sourceSelfCommit != "" {
			event["source_self_commit"] = sourceSelfCommit
		}
		appendEvent(workspace, "bootstrap", event)
	}
	return created, nil
}

func packagedSourceCommit(seedSelf string) string {
	if seedSelf == "" {
		return ""
	}
	value, err := readJSONFile(filepath.Join(filepath.Dir(seedSelf), "feng-release.yaml"))
	if err != nil {
		return ""
	}
	raw, _ := value.(map[string]any)
	return argString(raw, "self_commit")
}

func seedOptionalSelfNames() []string {
	var names []string
	for _, name := range selfNames {
		if _, ok := selfFiles[name]; ok {
			continue
		}
		if _, ok := selfDirs[name]; ok {
			continue
		}
		names = append(names, name)
	}
	return names
}

func ensureGitignore(workspace string) bool {
	path := filepath.Join(workspace, ".gitignore")
	contentBytes, _ := os.ReadFile(path)
	content := string(contentBytes)
	existing := map[string]bool{}
	for _, line := range strings.Split(content, "\n") {
		existing[strings.TrimRight(line, "\r")] = true
	}
	var missing []string
	for _, line := range runtimeGitignore {
		if !existing[line] {
			missing = append(missing, line)
		}
	}
	if len(missing) == 0 {
		return false
	}
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += "# feng runtime\n" + strings.Join(missing, "\n") + "\n"
	_ = writeText(path, content)
	return true
}

func defaultState(goal string) State {
	return State{
		Version:         stateVersion,
		Mode:            "ready",
		CurrentGoal:     goal,
		CandidateStatus: "none",
		ContextBudget:   defaultContextBudget(),
		LastRecovery:    emptyRecovery(),
		LastArtifacts:   []Artifact{},
		Lock:            emptyLockSnapshot(),
	}
}

func defaultContextBudget() map[string]int {
	return map[string]int{
		"max_input_tokens":       0,
		"estimated_input_tokens": 0,
		"dynamic_suffix_tokens":  0,
		"context_pack_tokens":    0,
	}
}

func emptyRecovery() map[string]string {
	return map[string]string{"type": "", "artifact": ""}
}

func loadState(workspace string) (State, error) {
	stateFileMu.Lock()
	defer stateFileMu.Unlock()
	return loadStateUnlocked(workspace)
}

func loadStateUnlocked(workspace string) (State, error) {
	state := defaultState("")
	path := filepath.Join(workspace, ".feng", "state.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		return state, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return state, nil
	}
	err = json.Unmarshal(data, &state)
	if state.ContextBudget == nil {
		state.ContextBudget = defaultContextBudget()
	} else {
		for key, value := range defaultContextBudget() {
			if _, ok := state.ContextBudget[key]; !ok {
				state.ContextBudget[key] = value
			}
		}
	}
	if state.LastRecovery == nil {
		state.LastRecovery = emptyRecovery()
	}
	if state.Lock == nil {
		state.Lock = defaultState("").Lock
	}
	return state, err
}

func saveState(workspace string, state State) error {
	stateFileMu.Lock()
	defer stateFileMu.Unlock()
	return saveStateUnlocked(workspace, state)
}

func saveStateUnlocked(workspace string, state State) error {
	return writeJSONFile(filepath.Join(workspace, ".feng", "state.yaml"), state)
}

func updateState(workspace string, update func(*State)) error {
	stateFileMu.Lock()
	defer stateFileMu.Unlock()
	state, err := loadStateUnlocked(workspace)
	if err != nil {
		return err
	}
	update(&state)
	return saveStateUnlocked(workspace, state)
}

func appendEvent(workspace, eventType string, data map[string]any) Event {
	ts := time.Now().UnixMilli()
	sequence := eventSequence.Add(1)
	data = redactEventData(data)
	event := Event{ID: fmt.Sprintf("evt_%d_%06d", ts, sequence), TS: ts, Type: eventType, Data: data}
	path := filepath.Join(workspace, ".feng", "events.jsonl")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		defer f.Close()
		encoded, _ := json.Marshal(event)
		_, _ = f.Write(append(encoded, '\n'))
	}
	_ = updateState(workspace, func(state *State) {
		state.LastEventID = event.ID
	})
	return event
}

func redactEventData(data map[string]any) map[string]any {
	if data == nil {
		return map[string]any{}
	}
	redacted := map[string]any{}
	for key, value := range data {
		redacted[key] = redactValue(value)
	}
	return redacted
}

func redactValue(value any) any {
	switch typed := value.(type) {
	case string:
		return truncateString(redactSecretText(typed), maxEventStringLength)
	case []string:
		limit := minInt(len(typed), maxEventArrayItems)
		out := make([]string, 0, limit+1)
		for i := 0; i < limit; i++ {
			out = append(out, truncateString(redactSecretText(typed[i]), maxEventStringLength))
		}
		if len(typed) > limit {
			out = append(out, "[truncated]")
		}
		return out
	case []any:
		limit := minInt(len(typed), maxEventArrayItems)
		out := make([]any, 0, limit+1)
		for i := 0; i < limit; i++ {
			out = append(out, redactValue(typed[i]))
		}
		if len(typed) > limit {
			out = append(out, "[truncated]")
		}
		return out
	case map[string]any:
		out := map[string]any{}
		for key, item := range typed {
			out[key] = redactValue(item)
		}
		return out
	default:
		return value
	}
}

func tailEvents(workspace string, limit int) []Event {
	path := filepath.Join(workspace, ".feng", "events.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var events []Event
	reader := bufio.NewReader(f)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(strings.TrimSpace(string(line))) > 0 {
			var event Event
			if json.Unmarshal(line, &event) == nil {
				events = append(events, event)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			break
		}
	}
	if len(events) > limit {
		return events[len(events)-limit:]
	}
	return events
}

func writeArtifact(workspace, artifactType, source, content, summary, whyRelevant, extension string, snippets []string) (Artifact, error) {
	content = redactSecretText(content)
	source = redactSecretText(source)
	summary = redactSecretText(summary)
	whyRelevant = redactSecretText(whyRelevant)
	for i := range snippets {
		snippets[i] = redactSecretText(snippets[i])
	}
	digest := sha256.Sum256([]byte(content))
	hash := hex.EncodeToString(digest[:])
	name := fmt.Sprintf("%d-%s-%s.%s", time.Now().UnixMilli(), slug(artifactType), hash[:10], extension)
	rel := filepath.ToSlash(filepath.Join(".feng", "artifacts", name))
	full := filepath.Join(workspace, filepath.FromSlash(rel))
	if err := writeText(full, content); err != nil {
		return Artifact{}, err
	}
	artifact := Artifact{Type: artifactType, Source: source, Path: rel, Hash: hash, Summary: summary, WhyRelevant: whyRelevant, Snippets: snippets}
	if err := writeJSONFile(full+".json", artifact); err != nil {
		return Artifact{}, err
	}
	appendEvent(workspace, "artifact_written", map[string]any{"type": artifact.Type, "source": artifact.Source, "path": artifact.Path, "hash": artifact.Hash, "summary": artifact.Summary, "why_relevant": artifact.WhyRelevant, "snippets": artifact.Snippets})
	return artifact, nil
}

func redactSecretText(value string) string {
	return secretPattern.ReplaceAllString(value, "[redacted-secret]")
}

func listArtifacts(workspace string) []Artifact {
	dir := filepath.Join(workspace, ".feng", "artifacts")
	_ = os.MkdirAll(dir, 0o755)
	var artifacts []Artifact
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		var artifact Artifact
		if data, err := os.ReadFile(filepath.Join(dir, entry.Name())); err == nil && json.Unmarshal(data, &artifact) == nil && artifact.Type != "" && artifact.Path != "" && artifact.Hash != "" {
			artifacts = append(artifacts, artifact)
		}
	}
	sort.Slice(artifacts, func(i, j int) bool { return artifacts[i].Path < artifacts[j].Path })
	return artifacts
}

func findWorkspace(start string) (string, bool) {
	cur, err := filepath.Abs(start)
	if err != nil {
		return "", false
	}
	for {
		if exists(filepath.Join(cur, ".feng")) {
			return cur, true
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return "", false
		}
		cur = parent
	}
}

func workspaceOrCwd(cwd string) string {
	if workspace, ok := findWorkspace(cwd); ok {
		return workspace
	}
	abs, err := filepath.Abs(cwd)
	if err != nil {
		return cwd
	}
	return abs
}

func scanSecrets(workspace string) []string {
	var problems []string
	seen := map[string]bool{}
	var roots []string
	for name := range selfFiles {
		roots = append(roots, name)
	}
	for name := range selfDirs {
		roots = append(roots, name)
	}
	roots = append(roots,
		".feng/artifacts", ".gitignore",
		"cmd", "internal", "docs", "pkg", "scripts",
		"go.mod", "go.sum", "go.work", "go.work.sum",
	)
	for _, root := range roots {
		full := filepath.Join(workspace, filepath.FromSlash(root))
		if !exists(full) || seen[full] {
			continue
		}
		seen[full] = true
		problems = append(problems, scanSecretsUnder(workspace, full)...)
	}
	return problems
}

func scanSecretsUnder(workspace, root string) []string {
	var problems []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(workspace, path)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if shouldSkipSecretScanDir(rel) {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > 512_000 {
			return nil
		}
		data, err := os.ReadFile(path)
		if err == nil && secretPattern.Match(data) {
			problems = append(problems, "possible secret in "+rel)
		}
		return nil
	})
	return problems
}

func shouldSkipSecretScanDir(rel string) bool {
	rel = filepath.ToSlash(rel)
	if rel == ".git" || rel == ".feng/cache" || rel == ".feng/runs" {
		return true
	}
	return shouldSkipContextDir(rel)
}

func checkpointCommit(workspace, message string) (string, error) {
	roots := selfGitPathspecs(workspace)
	if len(roots) == 0 {
		return currentHead(workspace), nil
	}
	addArgs := append([]string{"add", "-A", "--"}, roots...)
	if _, err := runGit(workspace, addArgs...); err != nil {
		return "", err
	}
	if err := ensureNoStagedOutsideSelfRoots(workspace, roots); err != nil {
		return "", err
	}
	status, err := selfGitStatus(workspace)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(status) == "" {
		return currentHead(workspace), nil
	}
	if _, err := runGit(workspace, "-c", "user.name=feng", "-c", "user.email=feng@example.invalid", "commit", "-m", message); err != nil {
		return "", err
	}
	return currentHead(workspace), nil
}

func selfGitStatus(workspace string) (string, error) {
	return runSelfGitPathspec(workspace, "status", "--short")
}

func runSelfGitPathspec(workspace string, args ...string) (string, error) {
	roots := selfGitPathspecs(workspace)
	if len(roots) == 0 {
		return "", nil
	}
	fullArgs := append([]string{}, args...)
	fullArgs = append(fullArgs, "--")
	fullArgs = append(fullArgs, roots...)
	return runGit(workspace, fullArgs...)
}

func selfGitPathspecs(workspace string) []string {
	seen := map[string]bool{}
	var roots []string
	for _, name := range selfNames {
		rel := filepath.ToSlash(name)
		if rel == "" || rel == "." || strings.HasPrefix(rel, "../") || strings.Contains(rel, "/../") {
			continue
		}
		if seen[rel] {
			continue
		}
		if exists(filepath.Join(workspace, filepath.FromSlash(rel))) || gitHasTrackedPath(workspace, rel) {
			seen[rel] = true
			roots = append(roots, rel)
		}
	}
	sort.Strings(roots)
	return roots
}

func gitHasTrackedPath(workspace, rel string) bool {
	output, err := runGit(workspace, "ls-files", "--", rel)
	return err == nil && strings.TrimSpace(output) != ""
}

func ensureNoStagedOutsideSelfRoots(workspace string, roots []string) error {
	output, err := runGit(workspace, "diff", "--cached", "--name-only")
	if err != nil {
		return err
	}
	var outside []string
	for _, line := range strings.Split(output, "\n") {
		path := strings.TrimSpace(strings.TrimRight(line, "\r"))
		if path == "" || pathUnderRoots(path, roots) {
			continue
		}
		outside = append(outside, path)
	}
	if len(outside) > 0 {
		return fmt.Errorf("checkpoint refuses to commit staged files outside feng self roots: %s", strings.Join(outside, ", "))
	}
	return nil
}

func pathUnderRoots(path string, roots []string) bool {
	path = strings.Trim(filepath.ToSlash(path), "/")
	for _, root := range roots {
		root = strings.Trim(filepath.ToSlash(root), "/")
		if path == root || strings.HasPrefix(path, root+"/") {
			return true
		}
	}
	return false
}

func currentHead(workspace string) string {
	out, err := runGit(workspace, "rev-parse", "--verify", "HEAD")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

func runGit(workspace string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = workspace
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

func readJSONFile(path string) (any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(data)) == "" {
		return map[string]any{}, nil
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON-compatible YAML: %w", path, err)
	}
	return value, nil
}

func writeJSONFile(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return writeBytes(path, data)
}

func writeText(path, content string) error {
	return writeBytes(path, []byte(content))
}

func writeBytes(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func printJSON(w io.Writer, value any) {
	encoded, _ := json.MarshalIndent(value, "", "  ")
	fmt.Fprintln(w, string(encoded))
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func sortedKeysAny(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedKeysString(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func slug(value string) string {
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-_.")
	if out == "" {
		return "item"
	}
	if len(out) > 80 {
		return out[:80]
	}
	return out
}

func ternary[T any](cond bool, yes, no T) T {
	if cond {
		return yes
	}
	return no
}
