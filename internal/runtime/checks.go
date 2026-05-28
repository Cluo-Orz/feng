package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func checkSelfRepoTools(workspace string) []string {
	var problems []string
	toolsDir := filepath.Join(workspace, "tools")
	if !exists(toolsDir) {
		return problems
	}
	_ = filepath.WalkDir(toolsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !isToolFile(path) {
			return nil
		}
		rel := relPath(workspace, path)
		data, err := readJSONFile(path)
		if err != nil {
			problems = append(problems, "tool parse failed in "+rel+": "+err.Error())
			return nil
		}
		raw, _ := data.(map[string]any)
		toolType := strings.TrimSpace(argString(raw, "type"))
		if toolType != "command" {
			if toolType == "" {
				toolType = "<empty>"
			}
			problems = append(problems, "tool has unsupported type in "+rel+": "+toolType+"; MVP supports command tools only")
			return nil
		}
		name := strings.TrimSpace(argString(raw, "name"))
		if name == "" {
			name = defaultToolName(path)
		}
		command := strings.TrimSpace(argString(raw, "command"))
		if !validToolName(name) {
			problems = append(problems, "tool has invalid name in "+rel+": "+name)
		}
		if command == "" {
			problems = append(problems, "tool command is empty in "+rel)
			return nil
		}
		workdir := strings.ToLower(strings.TrimSpace(argString(raw, "workdir")))
		if workdir != "" && workdir != "workspace" && workdir != "self" {
			problems = append(problems, "tool workdir must be workspace or self in "+rel)
		}
		if err := checkCommand(workspace, command); err != nil {
			problems = append(problems, "tool command denied in "+rel+": "+err.Error())
		}
		return nil
	})
	return problems
}

func runCommandEvals(workspace string) []string {
	var problems []string
	evalsDir := filepath.Join(workspace, "evals")
	if !exists(evalsDir) {
		return problems
	}
	_ = filepath.WalkDir(evalsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !isEvalFile(path) {
			return nil
		}
		rel := relPath(workspace, path)
		data, err := readJSONFile(path)
		if err != nil {
			problems = append(problems, "eval parse failed in "+rel+": "+err.Error())
			return nil
		}
		raw, _ := data.(map[string]any)
		if raw["type"] != "command" {
			problems = append(problems, "eval has unsupported type in "+rel)
			return nil
		}
		command := strings.TrimSpace(argString(raw, "command"))
		if command == "" {
			problems = append(problems, "eval command is empty in "+rel)
			return nil
		}
		if err := checkCommand(workspace, command); err != nil {
			problems = append(problems, "eval command denied in "+rel+": "+err.Error())
			appendEvent(workspace, "eval_failed", map[string]any{"path": rel, "reason": "command_denied", "command": command})
			return nil
		}
		exitCode, output := runShellCommand(workspace, command, clampInt(argInt(raw, "timeout", 60), 1, 600))
		if exitCode != 0 {
			artifact, _ := writeArtifact(
				workspace,
				"eval-output",
				rel,
				output,
				"eval failed: "+rel,
				"eval output helps the next grow repair the candidate",
				"txt",
				[]string{output[:minInt(1000, len(output))]},
			)
			appendEvent(workspace, "eval_failed", map[string]any{"path": rel, "command": command, "exit_code": exitCode, "artifact": artifact.Path})
			problems = append(problems, fmt.Sprintf("eval failed in %s: exit_code=%d; artifact=%s", rel, exitCode, artifact.Path))
			return nil
		}
		appendEvent(workspace, "eval_passed", map[string]any{"path": rel, "command": command, "exit_code": exitCode})
		return nil
	})
	return problems
}

func runSourceHealthChecks(workspace string) []string {
	if !exists(filepath.Join(workspace, "go.mod")) {
		return nil
	}
	command := "go test ./..."
	if err := checkCommand(workspace, command); err != nil {
		return []string{"source health command denied: " + err.Error()}
	}
	exitCode, output := runGoSourceHealthCommand(workspace, 240)
	if exitCode == 0 {
		appendEvent(workspace, "source_health_passed", map[string]any{"command": command})
		return nil
	}
	artifact, _ := writeArtifact(
		workspace,
		"source-health",
		command,
		output,
		"source health failed: "+command,
		"go.mod exists; check must reject broken Go source before updating validated_commit",
		"txt",
		[]string{output[:minInt(1000, len(output))]},
	)
	return []string{fmt.Sprintf("source health failed: %s exit_code=%d; artifact=%s", command, exitCode, artifact.Path)}
}

func runGoSourceHealthCommand(workspace string, timeoutSeconds int) (int, string) {
	goExe, err := goExecutable()
	if err != nil {
		return 1, err.Error()
	}
	timeout := time.Duration(clampInt(timeoutSeconds, 1, 600)) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, goExe, "test", "./...")
	cmd.Dir = workspace
	output, err := cmd.CombinedOutput()
	exitCode := 0
	if err != nil {
		exitCode = 1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
		if ctx.Err() != nil {
			exitCode = 124
		}
	}
	return exitCode, string(output)
}

func checkMessageCompiler(workspace string) []string {
	tools := activeToolPack(workspace, "checking", "check")
	messages := compileGrowMessages(workspace, "check candidate self")
	schemas := toolSchemasForProvider(tools)
	if len(messages) == 0 {
		return []string{"message compiler returned no messages"}
	}
	if len(schemas) == 0 {
		return []string{"active tool pack returned no provider schemas"}
	}
	if _, err := json.Marshal(schemas); err != nil {
		return []string{"active tool pack schema marshal failed: " + err.Error()}
	}
	return nil
}

func checkProviderProfile(workspace string) []string {
	if _, err := loadProviderProfile(workspace); err != nil {
		return []string{"provider profile parse failed: " + err.Error()}
	}
	return nil
}

func loadInterfaceConfig(workspace string) (map[string]any, error) {
	data, err := readJSONFile(filepath.Join(workspace, "interface.yaml"))
	if err != nil {
		return nil, err
	}
	config, ok := data.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("interface.yaml must be an object")
	}
	return config, nil
}

func checkInterfaceConfig(workspace string) []string {
	config, err := loadInterfaceConfig(workspace)
	if err != nil {
		return []string{"interface parse failed: " + err.Error()}
	}
	commands, ok := config["commands"].([]any)
	if !ok || len(commands) == 0 {
		return []string{"interface.yaml commands must be a non-empty list"}
	}
	var problems []string
	for i, command := range commands {
		switch typed := command.(type) {
		case string:
			if strings.TrimSpace(typed) == "" {
				problems = append(problems, fmt.Sprintf("interface.yaml command %d is empty", i))
			}
		case map[string]any:
			if strings.TrimSpace(argString(typed, "name")) == "" {
				problems = append(problems, fmt.Sprintf("interface.yaml command %d missing name", i))
			}
		default:
			problems = append(problems, fmt.Sprintf("interface.yaml command %d must be a string or object", i))
		}
	}
	return problems
}

func checkNoSpecialRuntime(workspace string) []string {
	var problems []string
	for _, rootName := range []string{"cmd", "internal", "pkg"} {
		root := filepath.Join(workspace, rootName)
		if !exists(root) {
			continue
		}
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			text := string(data)
			doubleQuote := `"`
			singleQuote := `'`
			markers := []string{
				"if project == " + doubleQuote + "feng" + doubleQuote,
				"if project == " + singleQuote + "feng" + singleQuote,
				"init" + "-self",
				"feng" + "smith",
			}
			for _, marker := range markers {
				if strings.Contains(text, marker) {
					problems = append(problems, "special runtime marker in "+relPath(workspace, path)+": "+marker)
				}
			}
			return nil
		})
	}
	return problems
}

func isEvalFile(path string) bool {
	return strings.HasSuffix(path, ".eval.yaml") || strings.HasSuffix(path, ".eval.json")
}
