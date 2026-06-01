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

type permissionDeniedError struct {
	Message  string
	Artifact Artifact
}

func (e permissionDeniedError) Error() string {
	return e.Message
}

var builtInDeniedCommands = []string{
	"git reset --hard",
	"git push",
	"rm -rf",
	"remove-item -recurse",
	"del /s",
	"rmdir /s",
	"rd /s",
	"erase /s",
}

var defaultPermissionWritePatterns = []string{
	".gitignore", "identity.md", "goal.md", "feng.yaml", "hooks.yaml", "permissions.yaml",
	"interface.yaml", "config.schema.yaml", "skills/**", "tools/**",
	"world/**", "evals/**", "docs/**",
	"cmd/**", "internal/**", "pkg/**", "scripts/**",
	"go.mod", "go.sum", "go.work", "go.work.sum",
}

var defaultPermissionAllowedCommands = []string{
	"git status", "git diff", "git log", "rg", "go run", "go test", "go vet", "go build",
}

func defaultPermissionsConfig() map[string]any {
	return map[string]any{
		"files": map[string]any{
			"read":  []string{"**"},
			"write": cloneStrings(defaultPermissionWritePatterns),
		},
		"commands": map[string]any{
			"allow": cloneStrings(defaultPermissionAllowedCommands),
			"deny":  cloneStrings(builtInDeniedCommands),
		},
	}
}

func defaultPermissions() Permissions {
	var permissions Permissions
	permissions.Files.Read = []string{"**"}
	permissions.Files.Write = cloneStrings(defaultPermissionWritePatterns)
	permissions.Commands.Allow = cloneStrings(defaultPermissionAllowedCommands)
	permissions.Commands.Deny = cloneStrings(builtInDeniedCommands)
	return permissions
}

func loadPermissions(workspace string) Permissions {
	return loadPermissionsFrom(workspace)
}

func loadPermissionsFrom(root string) Permissions {
	data, err := readJSONFile(filepath.Join(root, "permissions.yaml"))
	if err != nil {
		return defaultPermissions()
	}
	raw, ok := data.(map[string]any)
	if !ok {
		return defaultPermissions()
	}
	files, _ := raw["files"].(map[string]any)
	commands, _ := raw["commands"].(map[string]any)
	var permissions Permissions
	permissions.Files.Read = stringSlice(files["read"])
	permissions.Files.Write = stringSlice(files["write"])
	permissions.Commands.Allow = stringSlice(commands["allow"])
	permissions.Commands.Deny = stringSlice(commands["deny"])
	if len(permissions.Files.Read) == 0 {
		permissions.Files.Read = []string{"**"}
	}
	return permissions
}

func cloneStrings(items []string) []string {
	out := make([]string, len(items))
	copy(out, items)
	return out
}

func checkFileRead(workspace, rawPath string) (string, error) {
	return checkFileReadWithPermissions(workspace, workspace, rawPath)
}

func checkFileReadWithPermissions(workspace, permissionsRoot, rawPath string) (string, error) {
	target, rel, err := safeWorkspacePath(workspace, rawPath)
	if err != nil {
		return "", permissionDenied(workspace, "file_read", rawPath, err.Error(), "file read target must stay inside the workspace")
	}
	if !matchesAny(rel, loadPermissionsFrom(permissionsRoot).Files.Read) {
		return "", permissionDenied(workspace, "file_read", rel, "file read denied: "+rel, "file read path did not match permissions.yaml")
	}
	return target, nil
}

func checkFileWrite(workspace, rawPath string) (string, error) {
	return checkFileWriteWithPermissions(workspace, workspace, rawPath)
}

func checkFileWriteWithPermissions(workspace, permissionsRoot, rawPath string) (string, error) {
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
	if !matchesAny(rel, loadPermissionsFrom(permissionsRoot).Files.Write) {
		return "", permissionDenied(workspace, "file_write", rel, "file write denied: "+rel, "file write path did not match permissions.yaml")
	}
	return target, nil
}

func checkCommand(workspace, command string) error {
	return checkCommandWithPermissions(workspace, workspace, command)
}

func checkCommandWithPermissions(workspace, permissionsRoot, command string) error {
	permissions := loadPermissionsFrom(permissionsRoot)
	if pattern := builtInDeniedCommand(command); pattern != "" {
		return permissionDenied(workspace, "run_command", command, "command denied by built-in rule: "+pattern, "dangerous command matched built-in deny rule")
	}
	lowered := normalizedCommand(command)
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

func builtInDeniedCommand(command string) string {
	tokens := commandTokens(command)
	if containsToken(tokens, "git") && containsTokenAfter(tokens, "git", "push") {
		return "git push"
	}
	if containsToken(tokens, "git") && containsTokenAfter(tokens, "git", "reset") && hasHardResetFlag(tokens) {
		return "git reset --hard"
	}
	if containsToken(tokens, "remove-item", "ri") && hasPowerShellRecurseFlag(tokens) {
		return "remove-item -recurse"
	}
	if containsToken(tokens, "rm") && hasRecursiveRmFlag(tokens) {
		return "rm -rf"
	}
	if containsToken(tokens, "del") && containsToken(tokens, "/s") {
		return "del /s"
	}
	if containsToken(tokens, "rmdir") && containsToken(tokens, "/s") {
		return "rmdir /s"
	}
	if containsToken(tokens, "rd") && containsToken(tokens, "/s") {
		return "rd /s"
	}
	if containsToken(tokens, "erase") && containsToken(tokens, "/s") {
		return "erase /s"
	}

	lowered := normalizedCommand(command)
	for _, pattern := range builtInDeniedCommands {
		if strings.Contains(lowered, normalizedCommand(pattern)) {
			return pattern
		}
	}
	return ""
}

func commandTokens(command string) []string {
	replaced := strings.NewReplacer(
		";", " ",
		"&&", " ",
		"||", " ",
		"|", " ",
		"\r", " ",
		"\n", " ",
		"\t", " ",
	).Replace(strings.ToLower(command))
	raw := strings.Fields(replaced)
	tokens := make([]string, 0, len(raw))
	for _, token := range raw {
		token = normalizeCommandToken(token)
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	return tokens
}

func normalizeCommandToken(token string) string {
	token = strings.Trim(token, "\"'`()[]{}")
	token = strings.ReplaceAll(token, "\\", "/")
	if idx := strings.LastIndex(token, "/"); idx >= 0 {
		token = token[idx+1:]
	}
	for _, suffix := range []string{".exe", ".cmd", ".bat"} {
		if strings.HasSuffix(token, suffix) {
			return strings.TrimSuffix(token, suffix)
		}
	}
	return token
}

func containsToken(tokens []string, candidates ...string) bool {
	for _, token := range tokens {
		for _, candidate := range candidates {
			if token == candidate {
				return true
			}
		}
	}
	return false
}

func containsTokenAfter(tokens []string, after string, candidates ...string) bool {
	seenAfter := false
	for _, token := range tokens {
		if token == after {
			seenAfter = true
			continue
		}
		if !seenAfter {
			continue
		}
		for _, candidate := range candidates {
			if token == candidate {
				return true
			}
		}
	}
	return false
}

func hasHardResetFlag(tokens []string) bool {
	for _, token := range tokens {
		if token == "--hard" || strings.HasPrefix(token, "--hard=") {
			return true
		}
	}
	return false
}

func hasPowerShellRecurseFlag(tokens []string) bool {
	for _, token := range tokens {
		if token == "-recurse" || strings.HasPrefix(token, "-recurse:") {
			return true
		}
	}
	return false
}

func hasRecursiveRmFlag(tokens []string) bool {
	for _, token := range tokens {
		if token == "--recursive" || token == "-r" || token == "-rf" || token == "-fr" {
			return true
		}
		if strings.HasPrefix(token, "-") && !strings.HasPrefix(token, "--") && strings.Contains(token, "r") {
			return true
		}
	}
	return false
}

func normalizedCommand(command string) string {
	return strings.Join(strings.Fields(strings.ToLower(command)), " ")
}

func permissionDenied(workspace, source, attempted, message, whyRelevant string) error {
	artifact, err := writeArtifact(workspace, "permission-denied", source, attempted, message, whyRelevant, "txt", nil)
	if err != nil {
		return errors.New(redactSecretText(message))
	}
	return permissionDeniedError{Message: redactSecretText(message), Artifact: artifact}
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
