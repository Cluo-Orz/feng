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
}

type HatchManifest struct {
	Name                     string         `json:"name"`
	Portable                 bool           `json:"portable"`
	SelfCommit               string         `json:"self_commit"`
	SelfTag                  string         `json:"self_tag,omitempty"`
	RunnerVersion            string         `json:"runner_version"`
	RequiredProviderProfiles []string       `json:"required_provider_profiles"`
	RequiredEnv              []string       `json:"required_env"`
	Entrypoints              []string       `json:"entrypoints"`
	Interface                map[string]any `json:"interface"`
	Excludes                 []string       `json:"excludes"`
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
			name = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--name="):
			name = strings.TrimPrefix(args[i], "--name=")
		case args[i] == "--out" && i+1 < len(args):
			outDir = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--out="):
			outDir = strings.TrimPrefix(args[i], "--out=")
		case args[i] == "--portable":
			portable = true
		default:
			return "", "", false, fmt.Errorf("unknown hatch argument: %s", args[i])
		}
	}
	if strings.TrimSpace(name) == "" {
		return "", "", false, errors.New("hatch requires --name")
	}
	return name, outDir, portable, nil
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
	status, err := runGit(workspace, "status", "--short")
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(status) != "" {
		return "", errors.New("hatch requires a clean working tree so the package maps to a validated commit")
	}

	outputRoot := outDir
	if outputRoot == "" {
		outputRoot = filepath.Join(workspace, "dist")
	}
	output := filepath.Join(outputRoot, cleanName)
	if err := os.RemoveAll(output); err != nil {
		return "", err
	}
	if err := os.MkdirAll(output, 0o755); err != nil {
		return "", err
	}
	if err := copySelf(workspace, filepath.Join(output, "self")); err != nil {
		return "", err
	}
	entrypoints, err := buildOrCopyRunner(workspace, output, cleanName)
	if err != nil {
		return "", err
	}
	if err := writeProviderExample(output); err != nil {
		return "", err
	}
	manifest := HatchManifest{
		Name:                     cleanName,
		Portable:                 portable,
		SelfCommit:               state.ValidatedCommit,
		SelfTag:                  currentValidatedTag(workspace, state.ValidatedCommit),
		RunnerVersion:            "0.1.0-go",
		RequiredProviderProfiles: []string{"deepseek"},
		RequiredEnv:              []string{"DEEPSEEK_API_KEY"},
		Entrypoints:              entrypoints,
		Interface: map[string]any{
			"commands": []any{"grow", "check", "hatch", "status", "watch", "artifacts", "gui", "tag"},
		},
		Excludes: []string{"API keys", "local provider profile", ".feng/cache", ".feng/runs", "unvalidated candidate"},
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
	artifact, _ := writeArtifact(workspace, "hatch-preview", "feng-hatch", string(content), "hatch package created: "+output, "hatch packages a validated self into a named command", "json", nil)
	appendEvent(workspace, "hatch_created", map[string]any{"path": output, "artifact": artifact})
	return output, nil
}

func copySelf(workspace, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, name := range selfNames {
		src := filepath.Join(workspace, name)
		target := filepath.Join(dst, name)
		if !exists(src) {
			continue
		}
		info, err := os.Stat(src)
		if err != nil {
			return err
		}
		if info.IsDir() {
			if err := os.RemoveAll(target); err != nil {
				return err
			}
			if err := copyDir(src, target); err != nil {
				return err
			}
		} else if err := copyFile(src, target); err != nil {
			return err
		}
	}
	return nil
}

func buildOrCopyRunner(workspace, output, cleanName string) ([]string, error) {
	if hasGoRunnerSource(workspace) {
		return buildRunnerFromSource(workspace, output, cleanName)
	}
	return copyRunner(output, cleanName)
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

func writeWindowsCommandShim(output, cleanName string) ([]string, error) {
	var entrypoints []string
	if runtime.GOOS == "windows" {
		cmdName := cleanName + ".cmd"
		content := fmt.Sprintf("@echo off\r\n\"%%~dp0%s.exe\" %%*\r\n", cleanName)
		if err := writeText(filepath.Join(output, cmdName), content); err != nil {
			return nil, err
		}
		entrypoints = append(entrypoints, cmdName)
	}
	return entrypoints, nil
}

func buildRunnerFromSource(workspace, output, cleanName string) ([]string, error) {
	entryName := runnerEntrypointName(cleanName)
	target := filepath.Join(output, entryName)
	goExe, err := goExecutable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(goExe, "build", "-o", target, "./cmd/feng")
	cmd.Dir = workspace
	combined, err := cmd.CombinedOutput()
	if err != nil {
		output := strings.TrimSpace(string(combined))
		if output == "" {
			return nil, fmt.Errorf("go build runner failed: %w", err)
		}
		return nil, fmt.Errorf("go build runner failed: %w: %s", err, output)
	}
	entrypoints := []string{entryName}
	shims, err := writeWindowsCommandShim(output, cleanName)
	if err != nil {
		return nil, err
	}
	entrypoints = append(entrypoints, shims...)
	return entrypoints, nil
}

func goExecutable() (string, error) {
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

func copyRunner(output, cleanName string) ([]string, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	entryName := runnerEntrypointName(cleanName)
	if err := copyFile(exe, filepath.Join(output, entryName)); err != nil {
		return nil, err
	}
	entrypoints := []string{entryName}
	shims, err := writeWindowsCommandShim(output, cleanName)
	if err != nil {
		return nil, err
	}
	entrypoints = append(entrypoints, shims...)
	return entrypoints, nil
}

func writeProviderExample(output string) error {
	example := map[string]any{
		"id":            "deepseek",
		"protocol":      "openai_chat",
		"base_url":      "https://api.deepseek.com",
		"api_key_env":   "DEEPSEEK_API_KEY",
		"default_model": "deepseek-chat",
	}
	return writeJSONFile(filepath.Join(output, "provider-examples", "deepseek.yaml"), example)
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

func packagedSeedSelf() string {
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
