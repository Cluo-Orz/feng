package runtime

import (
	"errors"
	"path/filepath"
	"strings"
)

type Permissions struct {
	Files struct {
		Read  []string `json:"read"`
		Write []string `json:"write"`
	} `json:"files"`
	Commands struct {
		Allow []string `json:"allow"`
		Deny  []string `json:"deny"`
	} `json:"commands"`
}

var builtInDeniedCommands = []string{
	"git reset --hard",
	"git push",
	"rm -rf",
	"remove-item -recurse",
	"del /s",
}

func loadPermissions(workspace string) Permissions {
	var permissions Permissions
	data, err := readJSONFile(filepath.Join(workspace, "permissions.yaml"))
	if err != nil {
		permissions.Files.Read = []string{"**"}
		return permissions
	}
	raw, _ := data.(map[string]any)
	files, _ := raw["files"].(map[string]any)
	commands, _ := raw["commands"].(map[string]any)
	permissions.Files.Read = stringSlice(files["read"])
	permissions.Files.Write = stringSlice(files["write"])
	permissions.Commands.Allow = stringSlice(commands["allow"])
	permissions.Commands.Deny = stringSlice(commands["deny"])
	if len(permissions.Files.Read) == 0 {
		permissions.Files.Read = []string{"**"}
	}
	return permissions
}

func checkFileRead(workspace, rawPath string) (string, error) {
	target, rel, err := safeWorkspacePath(workspace, rawPath)
	if err != nil {
		return "", permissionDenied(workspace, "file_read", rawPath, err.Error(), "file read target must stay inside the workspace")
	}
	if !matchesAny(rel, loadPermissions(workspace).Files.Read) {
		return "", permissionDenied(workspace, "file_read", rel, "file read denied: "+rel, "file read path did not match permissions.yaml")
	}
	return target, nil
}

func checkFileWrite(workspace, rawPath string) (string, error) {
	target, rel, err := safeWorkspacePath(workspace, rawPath)
	if err != nil {
		return "", permissionDenied(workspace, "file_write", rawPath, err.Error(), "file write target must stay inside the workspace")
	}
	if rel == ".git" || strings.HasPrefix(rel, ".git/") {
		return "", permissionDenied(workspace, "file_write", rel, "writing .git is denied", "runtime owns Git metadata; tools cannot write .git directly")
	}
	if rel == ".feng" || strings.HasPrefix(rel, ".feng/") {
		return "", permissionDenied(workspace, "file_write", rel, "writing .feng is denied", "runtime owns .feng state/events/artifacts; tools cannot write .feng directly")
	}
	if !matchesAny(rel, loadPermissions(workspace).Files.Write) {
		return "", permissionDenied(workspace, "file_write", rel, "file write denied: "+rel, "file write path did not match permissions.yaml")
	}
	return target, nil
}

func checkCommand(workspace, command string) error {
	permissions := loadPermissions(workspace)
	lowered := normalizedCommand(command)
	for _, pattern := range builtInDeniedCommands {
		if strings.Contains(lowered, normalizedCommand(pattern)) {
			return permissionDenied(workspace, "run_command", command, "command denied by built-in rule: "+pattern, "dangerous command matched built-in deny rule")
		}
	}
	for _, pattern := range permissions.Commands.Deny {
		if strings.Contains(lowered, normalizedCommand(pattern)) {
			return permissionDenied(workspace, "run_command", command, "command denied by rule: "+pattern, "dangerous command matched deny rule")
		}
	}
	if len(permissions.Commands.Allow) == 0 {
		return nil
	}
	for _, allowed := range permissions.Commands.Allow {
		if command == allowed || strings.HasPrefix(command, allowed+" ") {
			return nil
		}
	}
	return permissionDenied(workspace, "run_command", command, "command is not in allow list: "+command, "command did not match permissions.yaml allow list")
}

func normalizedCommand(command string) string {
	return strings.Join(strings.Fields(strings.ToLower(command)), " ")
}

func permissionDenied(workspace, source, attempted, message, whyRelevant string) error {
	_, _ = writeArtifact(workspace, "permission-denied", source, attempted, message, whyRelevant, "txt", nil)
	return errors.New(redactSecretText(message))
}

func safeWorkspacePath(workspace, rawPath string) (string, string, error) {
	if strings.TrimSpace(rawPath) == "" {
		return "", "", errors.New("path is required")
	}
	var target string
	if filepath.IsAbs(rawPath) {
		target = rawPath
	} else {
		target = filepath.Join(workspace, rawPath)
	}
	absWorkspace, err := filepath.Abs(workspace)
	if err != nil {
		return "", "", err
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", "", err
	}
	rel, err := filepath.Rel(absWorkspace, absTarget)
	if err != nil {
		return "", "", err
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", "", errors.New("path escapes workspace: " + rawPath)
	}
	if rel == "." {
		rel = ""
	}
	return absTarget, rel, nil
}

func matchesAny(rel string, patterns []string) bool {
	rel = filepath.ToSlash(rel)
	if rel == "" {
		rel = "."
	}
	for _, pattern := range patterns {
		pattern = filepath.ToSlash(pattern)
		if pattern == "**" {
			return true
		}
		if strings.HasSuffix(pattern, "/**") {
			prefix := strings.TrimSuffix(pattern, "/**")
			if rel == prefix || strings.HasPrefix(rel, prefix+"/") {
				return true
			}
		}
		if ok, _ := filepath.Match(pattern, rel); ok {
			return true
		}
		if !strings.Contains(pattern, "/") {
			if ok, _ := filepath.Match(pattern, filepath.Base(rel)); ok {
				return true
			}
		}
	}
	return false
}

func stringSlice(value any) []string {
	items, _ := value.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}
