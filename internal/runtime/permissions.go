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
		return "", err
	}
	if !matchesAny(rel, loadPermissions(workspace).Files.Read) {
		return "", errors.New("file read denied: " + rel)
	}
	return target, nil
}

func checkFileWrite(workspace, rawPath string) (string, error) {
	target, rel, err := safeWorkspacePath(workspace, rawPath)
	if err != nil {
		return "", err
	}
	if rel == ".git" || strings.HasPrefix(rel, ".git/") {
		return "", errors.New("writing .git is denied")
	}
	if !matchesAny(rel, loadPermissions(workspace).Files.Write) {
		return "", errors.New("file write denied: " + rel)
	}
	return target, nil
}

func checkCommand(workspace, command string) error {
	permissions := loadPermissions(workspace)
	lowered := strings.ToLower(command)
	for _, pattern := range permissions.Commands.Deny {
		if strings.Contains(lowered, strings.ToLower(pattern)) {
			_, _ = writeArtifact(workspace, "permission-denied", "run_command", command, "Denied command: "+pattern, "dangerous command matched deny rule", "txt", nil)
			return errors.New("command denied by rule: " + pattern)
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
	return errors.New("command is not in allow list: " + command)
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
