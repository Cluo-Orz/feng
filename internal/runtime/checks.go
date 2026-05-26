package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
		if raw["type"] != "command" {
			problems = append(problems, "tool has unsupported type in "+rel)
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
			problems = append(problems, fmt.Sprintf("eval failed in %s: exit_code=%d; artifact=%s", rel, exitCode, artifact.Path))
		}
		return nil
	})
	return problems
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

func checkNoSpecialRuntime(workspace string) []string {
	var problems []string
	for _, rootName := range []string{"cmd", "internal", "src"} {
		root := filepath.Join(workspace, rootName)
		if !exists(root) {
			continue
		}
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !(strings.HasSuffix(path, ".go") || strings.HasSuffix(path, ".py")) {
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
