package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

var selfNames = []string{
	"identity.md",
	"goal.md",
	"feng.yaml",
	"hooks.yaml",
	"permissions.yaml",
	"interface.yaml",
	"config.schema.yaml",
	"skills",
	"tools",
	"world",
	"evals",
	".gitignore",
	"docs",
	"cmd",
	"internal",
	"pkg",
	"scripts",
	"go.mod",
	"go.sum",
	"go.work",
	"go.work.sum",
}

const hatchPackageMarker = ".feng-package-dir"

type HatchManifest struct {
	Name                     string            `json:"name"`
	Portable                 bool              `json:"portable"`
	SelfCommit               string            `json:"self_commit"`
	SelfTag                  string            `json:"self_tag,omitempty"`
	RunnerVersion            string            `json:"runner_version"`
	Runner                   string            `json:"runner"`
	RequiredProviderProfiles []string          `json:"required_provider_profiles"`
	RequiredEnv              []string          `json:"required_env"`
	Entrypoints              []string          `json:"entrypoints"`
	Installers               []string          `json:"installers,omitempty"`
	Interface                map[string]any    `json:"interface"`
	PermissionsSummary       PermissionSummary `json:"permissions_summary"`
	Excludes                 []string          `json:"excludes"`
}

type PermissionSummary struct {
	Source   string                   `json:"source"`
	Files    PermissionFileSummary    `json:"files"`
	Commands PermissionCommandSummary `json:"commands"`
}

type PermissionFileSummary struct {
	Read  []string `json:"read"`
	Write []string `json:"write"`
}

type PermissionCommandSummary struct {
	Allow []string `json:"allow"`
	Deny  []string `json:"deny"`
}

func cmdHatch(args []string, cwd string, stdout, stderr io.Writer) int {
	name, outDir, portable, err := parseHatchArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	workspace, ok := findWorkspace(cwd)
	if !ok {
		fmt.Fprintln(stderr, "not a feng workspace; run feng grow first")
		return 1
	}
	release, err := acquireWorkspaceLock(workspace, "hatch")
	if err != nil {
		printJSON(stdout, map[string]any{"ok": false, "reason": "workspace_locked", "message": err.Error()})
		return 2
	}
	defer release()
	output, err := hatch(workspace, name, outDir, portable)
	if err != nil {
		fmt.Fprintf(stderr, "hatch failed: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, output)
	return 0
}

func parseHatchArgs(args []string) (string, string, bool, error) {
	var name, outDir string
	portable := false
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--name" && i+1 < len(args):
			if strings.TrimSpace(args[i+1]) == "" || strings.HasPrefix(args[i+1], "--") {
				return "", "", false, errors.New("--name requires a value")
			}
			name = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--name="):
			name = strings.TrimPrefix(args[i], "--name=")
			if strings.TrimSpace(name) == "" {
				return "", "", false, errors.New("--name requires a value")
			}
		case args[i] == "--out" && i+1 < len(args):
			if strings.TrimSpace(args[i+1]) == "" || strings.HasPrefix(args[i+1], "--") {
				return "", "", false, errors.New("--out requires a path")
			}
			outDir = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--out="):
			outDir = strings.TrimPrefix(args[i], "--out=")
			if strings.TrimSpace(outDir) == "" {
				return "", "", false, errors.New("--out requires a path")
			}
		case args[i] == "--portable":
			portable = true
		case args[i] == "--name":
			return "", "", false, errors.New("--name requires a value")
		case args[i] == "--out":
			return "", "", false, errors.New("--out requires a path")
		default:
			return "", "", false, fmt.Errorf("unknown hatch argument: %s", args[i])
		}
	}
	if strings.TrimSpace(name) == "" {
		return "", "", false, errors.New("hatch requires --name")
	}
	if err := validateHatchName(name); err != nil {
		return "", "", false, err
	}
	return name, outDir, portable, nil
}

func validateHatchName(name string) error {
	if slug(name) != name {
		return errors.New("hatch name must contain only letters, numbers, dot, dash, or underscore")
	}
	if reservedHatchPackageName(name) {
		return fmt.Errorf("hatch name is reserved for package files: %s", name)
	}
	if reservedWindowsDeviceName(name) {
		return fmt.Errorf("hatch name is reserved on Windows: %s", name)
	}
	return nil
}

func reservedHatchPackageName(name string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	reserved := map[string]bool{
		"self":              true,
		"provider-examples": true,
		"install":           true,
		"install.ps1":       true,
		"feng-release.yaml": true,
		"checksums.json":    true,
		"feng-runner":       true,
		"feng-runner.exe":   true,
	}
	return reserved[name]
}

func reservedWindowsDeviceName(name string) bool {
	base := strings.ToLower(strings.TrimSpace(name))
	if idx := strings.Index(base, "."); idx >= 0 {
		base = base[:idx]
	}
	switch base {
	case "con", "prn", "aux", "nul":
		return true
	}
	if len(base) == 4 && (strings.HasPrefix(base, "com") || strings.HasPrefix(base, "lpt")) {
		return base[3] >= '1' && base[3] <= '9'
	}
	return false
}

func hatch(workspace, rawName, outDir string, portable bool) (string, error) {
	cleanName := slug(rawName)
	state, err := loadState(workspace)
	if err != nil {
		return "", err
	}
	if state.CandidateStatus != "validated" {
		return "", errors.New("hatch requires candidate_status=validated; run feng check first")
	}
	if state.ValidatedCommit == "" {
		return "", errors.New("hatch requires a validated commit; run feng check first")
	}
	if currentHead(workspace) != state.ValidatedCommit {
		return "", errors.New("hatch requires HEAD to match the validated commit; run feng check first")
	}
	status, err := selfGitStatus(workspace)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(status) != "" {
		return "", errors.New("hatch requires clean feng self roots so the package maps to a validated commit")
	}

	output, err := resolveHatchOutput(workspace, outDir, cleanName)
	if err != nil {
		return "", err
	}
	if err := prepareHatchOutput(output); err != nil {
		return "", err
	}
	if err := writeText(filepath.Join(output, hatchPackageMarker), "feng hatch package directory\n"); err != nil {
		return "", err
	}
	selfRoot := filepath.Join(output, "self")
	if err := copySelf(workspace, selfRoot, state.ValidatedCommit); err != nil {
		return "", err
	}
	runnerName, entrypoints, err := buildOrCopyRunner(selfRoot, output, cleanName)
	if err != nil {
		return "", err
	}
	if err := writeProviderExample(output); err != nil {
		return "", err
	}
	installers, err := writeInstallers(output, cleanName)
	if err != nil {
		return "", err
	}
	interfaceConfig, err := loadInterfaceConfig(selfRoot)
	if err != nil {
		return "", err
	}
	requiredProfiles, requiredEnv := packageConfigRequirements(selfRoot)
	manifest := HatchManifest{
		Name:                     cleanName,
		Portable:                 portable,
		SelfCommit:               state.ValidatedCommit,
		SelfTag:                  currentValidatedTag(workspace, state.ValidatedCommit),
		RunnerVersion:            "0.1.0-go",
		Runner:                   runnerName,
		RequiredProviderProfiles: requiredProfiles,
		RequiredEnv:              requiredEnv,
		Entrypoints:              entrypoints,
		Installers:               installers,
		Interface:                interfaceConfig,
		PermissionsSummary:       packagePermissionsSummary(selfRoot),
		Excludes:                 []string{"API keys", "local provider profile", ".feng/cache", ".feng/runs", "unvalidated candidate"},
	}
	if err := writeJSONFile(filepath.Join(output, "feng-release.yaml"), manifest); err != nil {
		return "", err
	}
	checksums, err := packageChecksums(output)
	if err != nil {
		return "", err
	}
	if err := writeJSONFile(filepath.Join(output, "checksums.json"), checksums); err != nil {
		return "", err
	}
	content, _ := json.MarshalIndent(manifest, "", "  ")
	artifact, err := writeArtifact(workspace, "hatch-preview", "feng-hatch", string(content), "hatch package created: "+output, "hatch packages a validated self into a named command", "json", nil)
	if err != nil {
		return "", err
	}
	if err := updateState(workspace, func(state *State) {
		state.LastArtifacts = []Artifact{artifact}
	}); err != nil {
		return "", err
	}
	appendEvent(workspace, "hatch_created", map[string]any{"path": output, "artifact": artifact.Path})
	return output, nil
}

func resolveHatchOutput(workspace, outDir, cleanName string) (string, error) {
	absWorkspace, err := filepath.Abs(workspace)
	if err != nil {
		return "", err
	}
	outputRoot := outDir
	if strings.TrimSpace(outputRoot) == "" {
		outputRoot = filepath.Join(absWorkspace, "dist")
	} else if !filepath.IsAbs(outputRoot) {
		outputRoot = filepath.Join(absWorkspace, outputRoot)
	}
	output, err := filepath.Abs(filepath.Join(outputRoot, cleanName))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absWorkspace, output)
	if err != nil {
		return output, nil
	}
	relSlash := filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(relSlash, "../") {
		return output, nil
	}
	if relSlash == "dist" || strings.HasPrefix(relSlash, "dist/") {
		return output, nil
	}
	if relSlash == "." {
		relSlash = "<workspace>"
	}
	return "", fmt.Errorf("hatch output inside workspace must be under dist/: %s", relSlash)
}

func prepareHatchOutput(output string) error {
	info, err := os.Stat(output)
	if err != nil {
		if os.IsNotExist(err) {
			return os.MkdirAll(output, 0o755)
		}
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("hatch output exists and is not a directory: %s", output)
	}
	replaceable, err := replaceableHatchOutput(output)
	if err != nil {
		return err
	}
	if !replaceable {
		return fmt.Errorf("hatch refuses to overwrite existing non-package output: %s", output)
	}
	if err := os.RemoveAll(output); err != nil {
		return err
	}
	return os.MkdirAll(output, 0o755)
}

func replaceableHatchOutput(output string) (bool, error) {
	entries, err := os.ReadDir(output)
	if err != nil {
		return false, err
	}
	if len(entries) == 0 {
		return true, nil
	}
	return exists(filepath.Join(output, "feng-release.yaml")) || exists(filepath.Join(output, hatchPackageMarker)), nil
}

func copySelf(workspace, dst, commit string) error {
	if strings.TrimSpace(commit) == "" {
		return errors.New("copy self requires a validated commit")
	}
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	files, err := committedSelfFiles(workspace, commit)
	if err != nil {
		return err
	}
	for _, rel := range files {
		data, err := gitShowFile(workspace, commit, rel)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, filepath.FromSlash(rel))
		if err := writeBytes(target, data); err != nil {
			return err
		}
	}
	return nil
}

func committedSelfFiles(workspace, commit string) ([]string, error) {
	roots := selfGitPathspecs(workspace)
	if len(roots) == 0 {
		return nil, nil
	}
	args := append([]string{"ls-tree", "-r", "--name-only", commit, "--"}, roots...)
	output, err := runGit(workspace, args...)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, line := range strings.Split(output, "\n") {
		rel := strings.TrimSpace(strings.TrimRight(line, "\r"))
		if rel == "" || !pathUnderRoots(rel, roots) {
			continue
		}
		files = append(files, filepath.ToSlash(rel))
	}
	sort.Strings(files)
	return files, nil
}

func gitShowFile(workspace, commit, rel string) ([]byte, error) {
	rel = filepath.ToSlash(rel)
	cmd := exec.Command("git", "show", commit+":"+rel)
	cmd.Dir = workspace
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("git show %s:%s failed: %s", commit, rel, strings.TrimSpace(string(output)))
	}
	return output, nil
}

func buildOrCopyRunner(selfRoot, output, cleanName string) (string, []string, error) {
	runnerName := packageRunnerBinaryName()
	if hasGoRunnerSource(selfRoot) {
		if err := buildRunnerFromSource(selfRoot, output, runnerName); err != nil {
			return "", nil, err
		}
	} else if err := copyRunner(output, runnerName); err != nil {
		return "", nil, err
	}
	entrypoints, err := writePackageEntrypoints(output, cleanName, runnerName)
	if err != nil {
		return "", nil, err
	}
	return runnerName, entrypoints, nil
}

func hasGoRunnerSource(workspace string) bool {
	return exists(filepath.Join(workspace, "go.mod")) && exists(filepath.Join(workspace, "cmd", "feng"))
}

func runnerEntrypointName(cleanName string) string {
	if runtime.GOOS == "windows" {
		return cleanName + ".exe"
	}
	return cleanName
}

func packageRunnerBinaryName() string {
	if runtime.GOOS == "windows" {
		return "feng-runner.exe"
	}
	return "feng-runner"
}

func packageEntrypointName(cleanName string) string {
	if runtime.GOOS == "windows" {
		return cleanName + ".cmd"
	}
	return cleanName
}

func writePackageEntrypoints(output, cleanName, runnerName string) ([]string, error) {
	entrypoints := []string{}
	if runtime.GOOS == "windows" {
		cmdName := cleanName + ".cmd"
		content := fmt.Sprintf("@echo off\r\n\"%%~dp0%s\" %%*\r\nexit /b %%ERRORLEVEL%%\r\n", runnerName)
		if err := writeText(filepath.Join(output, cmdName), content); err != nil {
			return nil, err
		}
		entrypoints = append(entrypoints, cmdName)

		psName := cleanName + ".ps1"
		psContent := fmt.Sprintf("$ErrorActionPreference = \"Stop\"\r\n& \"$PSScriptRoot\\%s\" @args\r\nexit $LASTEXITCODE\r\n", runnerName)
		if err := writeText(filepath.Join(output, psName), psContent); err != nil {
			return nil, err
		}
		entrypoints = append(entrypoints, psName)
	}

	shellName := cleanName
	if err := writeText(filepath.Join(output, shellName), shellEntrypointScript(runnerName)); err != nil {
		return nil, err
	}
	_ = os.Chmod(filepath.Join(output, shellName), 0o755)
	entrypoints = append(entrypoints, shellName)
	return entrypoints, nil
}

func shellEntrypointScript(runnerName string) string {
	return fmt.Sprintf(`#!/bin/sh
set -eu
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$DIR/%s" "$@"
`, runnerName)
}

func writeInstallers(output, cleanName string) ([]string, error) {
	installers := []string{"install", "install.ps1"}
	if err := writeText(filepath.Join(output, "install"), shellInstallScript(cleanName)); err != nil {
		return nil, err
	}
	_ = os.Chmod(filepath.Join(output, "install"), 0o755)
	if err := writeText(filepath.Join(output, "install.ps1"), powershellInstallScript(cleanName)); err != nil {
		return nil, err
	}
	return installers, nil
}

func shellInstallScript(cleanName string) string {
	return fmt.Sprintf(`#!/bin/sh
set -eu
BIN_DIR="${1:-$HOME/.local/bin}"
PACKAGE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNNER="$PACKAGE_DIR/%[1]s"
if [ -f "$PACKAGE_DIR/%[1]s.exe" ]; then
  RUNNER="$PACKAGE_DIR/%[1]s.exe"
fi
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/%[1]s" <<EOF
#!/bin/sh
exec "$RUNNER" "\$@"
EOF
chmod +x "$BIN_DIR/%[1]s"
echo "Installed %[1]s launcher to $BIN_DIR/%[1]s"
`, cleanName)
}

func powershellInstallScript(cleanName string) string {
	lines := []string{
		"param(",
		"  [string]$BinDir = \"$env:USERPROFILE\\bin\"",
		")",
		"$ErrorActionPreference = \"Stop\"",
		"$PackageDir = $PSScriptRoot",
		"$CmdRunner = Join-Path $PackageDir \"%[1]s.cmd\"",
		"if (-not (Test-Path -LiteralPath $CmdRunner)) {",
		"  $CmdRunner = Join-Path $PackageDir \"%[1]s.exe\"",
		"}",
		"if (-not (Test-Path -LiteralPath $CmdRunner)) {",
		"  $CmdRunner = Join-Path $PackageDir \"%[1]s\"",
		"}",
		"$PsRunner = Join-Path $PackageDir \"%[1]s.ps1\"",
		"if (-not (Test-Path -LiteralPath $PsRunner)) {",
		"  $PsRunner = $CmdRunner",
		"}",
		"New-Item -ItemType Directory -Force -Path $BinDir | Out-Null",
		"$CmdLauncher = \"@echo off`r`n`\"$CmdRunner`\" %%*`r`nexit /b %%ERRORLEVEL%%`r`n\"",
		"Set-Content -LiteralPath (Join-Path $BinDir \"%[1]s.cmd\") -Value $CmdLauncher -Encoding ASCII",
		"$PsLauncher = \"& `\"$PsRunner`\" @args`r`nexit `$LASTEXITCODE`r`n\"",
		"Set-Content -LiteralPath (Join-Path $BinDir \"%[1]s.ps1\") -Value $PsLauncher -Encoding ASCII",
		"Write-Host \"Installed %[1]s launchers to $BinDir\"",
	}
	return fmt.Sprintf(strings.Join(lines, "\r\n")+"\r\n", cleanName)
}

func buildRunnerFromSource(workspace, output, runnerName string) error {
	target := filepath.Join(output, runnerName)
	goExe, err := goExecutable()
	if err != nil {
		return err
	}
	cmd := exec.Command(goExe, "build", "-o", target, "./cmd/feng")
	cmd.Dir = workspace
	combined, err := cmd.CombinedOutput()
	if err != nil {
		output := strings.TrimSpace(string(combined))
		if output == "" {
			return fmt.Errorf("go build runner failed: %w", err)
		}
		return fmt.Errorf("go build runner failed: %w: %s", err, output)
	}
	return nil
}

func goExecutable() (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("FENG_GO_EXECUTABLE")); explicit != "" {
		if exists(explicit) {
			return explicit, nil
		}
		if path, err := exec.LookPath(explicit); err == nil {
			return path, nil
		}
		return "", fmt.Errorf("configured FENG_GO_EXECUTABLE not found: %s", explicit)
	}
	if path, err := exec.LookPath("go"); err == nil {
		return path, nil
	}
	if runtime.GOOS == "windows" {
		for _, candidate := range []string{
			`C:\Program Files\Go\bin\go.exe`,
			`C:\Program Files (x86)\Go\bin\go.exe`,
		} {
			if exists(candidate) {
				return candidate, nil
			}
		}
	}
	return "", errors.New("go executable not found; install Go or add it to PATH before hatching a Go-source runner")
}

func copyRunner(output, runnerName string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return copyFile(exe, filepath.Join(output, runnerName))
}

func writeProviderExample(output string) error {
	deepseek := map[string]any{
		"id":            "deepseek",
		"protocol":      "openai_chat",
		"base_url":      "https://api.deepseek.com",
		"api_key_env":   "DEEPSEEK_API_KEY",
		"default_model": "deepseek-chat",
	}
	if err := writeJSONFile(filepath.Join(output, "provider-examples", "deepseek.yaml"), deepseek); err != nil {
		return err
	}
	deepseekAnthropic := map[string]any{
		"id":            "deepseek-anthropic",
		"protocol":      "anthropic_messages",
		"base_url":      "https://api.deepseek.com/anthropic",
		"api_key_env":   "DEEPSEEK_API_KEY",
		"default_model": "deepseek-chat",
	}
	return writeJSONFile(filepath.Join(output, "provider-examples", "deepseek-anthropic.yaml"), deepseekAnthropic)
}

func packagePermissionsSummary(selfRoot string) PermissionSummary {
	permissions := loadPermissionsFrom(selfRoot)
	return PermissionSummary{
		Source: "self/permissions.yaml",
		Files: PermissionFileSummary{
			Read:  cloneStrings(permissions.Files.Read),
			Write: cloneStrings(permissions.Files.Write),
		},
		Commands: PermissionCommandSummary{
			Allow: cloneStrings(permissions.Commands.Allow),
			Deny:  cloneStrings(permissions.Commands.Deny),
		},
	}
}

func packageConfigRequirements(selfRoot string) ([]string, []string) {
	profiles := []string{"deepseek"}
	env := []string{"DEEPSEEK_API_KEY"}
	data, err := readJSONFile(filepath.Join(selfRoot, "config.schema.yaml"))
	if err != nil {
		return profiles, env
	}
	config, ok := data.(map[string]any)
	if !ok {
		return profiles, env
	}
	if items := configSchemaStringList(config["provider_profiles"]); len(items) > 0 {
		profiles = items
	}
	if items := configSchemaStringList(config["env"]); len(items) > 0 {
		env = items
	}
	return profiles, env
}

func configSchemaStringList(raw any) []string {
	values, ok := raw.([]any)
	if !ok {
		return nil
	}
	seen := map[string]bool{}
	var items []string
	for _, value := range values {
		text, ok := value.(string)
		if !ok {
			continue
		}
		text = strings.TrimSpace(text)
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		items = append(items, text)
	}
	return items
}

func packageChecksums(root string) (map[string]string, error) {
	checksums := map[string]string{}
	var files []string
	if err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if filepath.ToSlash(rel) == "checksums.json" {
			return nil
		}
		files = append(files, path)
		return nil
	}); err != nil {
		return nil, err
	}
	sort.Strings(files)
	for _, path := range files {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(data)
		rel, _ := filepath.Rel(root, path)
		checksums[filepath.ToSlash(rel)] = hex.EncodeToString(digest[:])
	}
	return checksums, nil
}

func verifyCurrentPackageIntegrity() error {
	seedSelf := packagedSeedSelf()
	if seedSelf == "" {
		return nil
	}
	root := packageRootForSeedSelf(seedSelf)
	if root == "" {
		return nil
	}
	return verifyPackageIntegrity(root)
}

func verifyPackageIntegrity(root string) error {
	checksumPath := filepath.Join(root, "checksums.json")
	if !exists(checksumPath) {
		return nil
	}
	data, err := os.ReadFile(checksumPath)
	if err != nil {
		return err
	}
	var expected map[string]string
	if err := json.Unmarshal(data, &expected); err != nil {
		return fmt.Errorf("checksums.json is not valid: %w", err)
	}
	actual, err := packageChecksums(root)
	if err != nil {
		return err
	}
	expectedKeys := sortedStringMapKeys(expected)
	for _, rel := range expectedKeys {
		want := strings.TrimSpace(expected[rel])
		got, ok := actual[rel]
		if !ok {
			return fmt.Errorf("package file missing: %s", rel)
		}
		if got != want {
			return fmt.Errorf("package file checksum mismatch: %s", rel)
		}
	}
	actualKeys := sortedStringMapKeys(actual)
	for _, rel := range actualKeys {
		if _, ok := expected[rel]; !ok {
			return fmt.Errorf("unexpected package file: %s", rel)
		}
	}
	return nil
}

func sortedStringMapKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func rejectPackageWorkspace(cwd, seedSelf string) error {
	root := packageRootForSeedSelf(seedSelf)
	if root == "" {
		return nil
	}
	if pathInsideRoot(cwd, root) {
		return errors.New("hatch package directory cannot be used as a workspace; run the command from a separate workspace directory")
	}
	return nil
}

func packageRootForSeedSelf(seedSelf string) string {
	if strings.TrimSpace(seedSelf) == "" {
		return ""
	}
	root := filepath.Dir(seedSelf)
	if exists(filepath.Join(root, hatchPackageMarker)) ||
		exists(filepath.Join(root, "feng-release.yaml")) ||
		exists(filepath.Join(root, "checksums.json")) {
		return root
	}
	return ""
}

func pathInsideRoot(path, root string) bool {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	relSlash := filepath.ToSlash(rel)
	return rel == "." || (rel != ".." && !strings.HasPrefix(relSlash, "../"))
}

func packagedSeedSelf() string {
	if explicit := strings.TrimSpace(os.Getenv("FENG_PACKAGED_SELF")); explicit != "" && exists(explicit) {
		return explicit
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	candidate := filepath.Join(filepath.Dir(exe), "self")
	if exists(candidate) {
		return candidate
	}
	return ""
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode())
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
