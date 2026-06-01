package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxInlineToolResult = 8000

var toolNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

type Tool struct {
	Name           string
	Description    string
	Parameters     map[string]any
	Source         string
	SelectionTerms []string
	AlwaysActive   bool
	Handler        func(workspace string, args map[string]any) ToolResult
}

type ToolResult struct {
	Content  string    `json:"content"`
	Artifact *Artifact `json:"artifact,omitempty"`
	IsError  bool      `json:"is_error"`
}

type ActiveToolPackReport struct {
	Tools           []Tool
	SelectedTools   []string
	SelectionReason map[string]string
}

func bootstrapTools() []Tool {
	return bootstrapToolsWithPermissions("")
}

func bootstrapToolsWithPermissions(permissionsRoot string) []Tool {
	return []Tool{
		{
			Name:        "read_file",
			Description: "Read a UTF-8 file from the workspace.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":  map[string]any{"type": "string"},
					"limit": map[string]any{"type": "integer"},
				},
				"required": []any{"path"},
			},
			Handler: func(workspace string, args map[string]any) ToolResult {
				return runReadFileWithPermissions(workspace, effectivePermissionsRoot(workspace, permissionsRoot), args)
			},
		},
		{
			Name:        "write_file",
			Description: "Write a UTF-8 file inside the workspace.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":    map[string]any{"type": "string"},
					"content": map[string]any{"type": "string"},
				},
				"required": []any{"path", "content"},
			},
			Handler: func(workspace string, args map[string]any) ToolResult {
				return runWriteFileWithPermissions(workspace, effectivePermissionsRoot(workspace, permissionsRoot), args)
			},
		},
		{
			Name:        "list_files",
			Description: "List files under a workspace path.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":      map[string]any{"type": "string"},
					"max_files": map[string]any{"type": "integer"},
				},
			},
			Handler: func(workspace string, args map[string]any) ToolResult {
				return runListFilesWithPermissions(workspace, effectivePermissionsRoot(workspace, permissionsRoot), args)
			},
		},
		{
			Name:        "run_command",
			Description: "Run an allowed shell command in the workspace.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{"type": "string"},
					"timeout": map[string]any{"type": "integer"},
				},
				"required": []any{"command"},
			},
			Handler: func(workspace string, args map[string]any) ToolResult {
				return runRunCommandWithPermissions(workspace, effectivePermissionsRoot(workspace, permissionsRoot), args)
			},
		},
	}
}

func activeToolPack(workspace, _mode, _latestEvent string) []Tool {
	return activeToolPackReport(workspace, _mode, _latestEvent).Tools
}

func activeToolPackReport(workspace, mode, latestEvent string, hookEvents ...string) ActiveToolPackReport {
	return activeToolPackReportFromSelf(workspace, workspace, mode, latestEvent, hookEvents...)
}

func activeToolPackReportFromSelf(workspace, selfRoot, mode, latestEvent string, hookEvents ...string) ActiveToolPackReport {
	tools := bootstrapToolsWithPermissions(selfRoot)
	reasons := map[string]string{}
	for _, tool := range tools {
		reasons[tool.Name] = "bootstrap tool"
	}

	selfTools := selfRepoToolsFromRoot(workspace, selfRoot)
	if len(selfTools) == 0 {
		return ActiveToolPackReport{Tools: tools, SelectedTools: toolNameList(tools), SelectionReason: reasons}
	}

	if mode == "check" || mode == "checking" {
		tools = append(tools, selfTools...)
		for _, tool := range selfTools {
			reasons[tool.Name] = "check validates every self repo tool"
		}
		return ActiveToolPackReport{Tools: tools, SelectedTools: toolNameList(tools), SelectionReason: reasons}
	}

	hookSelected, hookReasons := selectHookDeclaredTools(selfRoot, selfTools, hookEvents)
	selected := append([]Tool{}, hookSelected...)
	selectedNames := map[string]bool{}
	for _, tool := range selected {
		selectedNames[tool.Name] = true
		reasons[tool.Name] = hookReasons[tool.Name]
	}

	query := selectionQuery(workspace, mode, latestEvent)
	remainingLimit := activeSelfToolLimit() - len(selected)
	if remainingLimit < 0 {
		remainingLimit = 0
	}
	querySelected, selectedReasons := selectSelfRepoTools(selfTools, query, remainingLimit)
	for _, tool := range querySelected {
		if selectedNames[tool.Name] {
			continue
		}
		selectedNames[tool.Name] = true
		selected = append(selected, tool)
	}
	tools = append(tools, selected...)
	for name, reason := range selectedReasons {
		if !hookReasonsHasName(hookReasons, name) {
			reasons[name] = reason
		}
	}
	return ActiveToolPackReport{Tools: tools, SelectedTools: toolNameList(tools), SelectionReason: reasons}
}

func hookReasonsHasName(reasons map[string]string, name string) bool {
	_, ok := reasons[name]
	return ok
}

func effectivePermissionsRoot(workspace, permissionsRoot string) string {
	if strings.TrimSpace(permissionsRoot) == "" {
		return workspace
	}
	return permissionsRoot
}

func executeTool(workspace string, tools []Tool, name string, args map[string]any) ToolResult {
	appendEvent(workspace, "tool_called", map[string]any{"tool": name, "args": compactToolArgsForEvent(args)})
	for _, tool := range tools {
		if tool.Name == name {
			if err := validateToolArguments(tool.Parameters, args); err != nil {
				appendEvent(workspace, "tool_argument_invalid", map[string]any{"tool": name, "reason": err.Error()})
				return ToolResult{Content: err.Error(), IsError: true}
			}
			return tool.Handler(workspace, args)
		}
	}
	return ToolResult{Content: "unknown tool: " + name, IsError: true}
}

func compactToolArgsForEvent(args map[string]any) map[string]any {
	if len(args) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(args))
	for key, value := range args {
		switch typed := value.(type) {
		case string:
			if key == "content" || len(typed) > 300 {
				out[key] = truncateString(typed, 300)
			} else {
				out[key] = typed
			}
		default:
			encoded, err := json.Marshal(typed)
			if err != nil || len(encoded) <= 300 {
				out[key] = typed
			} else {
				out[key] = truncateString(string(encoded), 300)
			}
		}
	}
	return out
}

func validateToolArguments(schema map[string]any, args map[string]any) error {
	if len(schema) == 0 {
		return nil
	}
	if schemaType, ok := schema["type"].(string); ok && schemaType != "" && schemaType != "object" {
		return fmt.Errorf("tool schema root must be object")
	}
	for _, required := range stringListFromAny(schema["required"]) {
		if _, ok := args[required]; !ok {
			return fmt.Errorf("missing required tool argument: %s", required)
		}
	}
	properties, _ := schema["properties"].(map[string]any)
	for name, value := range args {
		rawProperty, ok := properties[name]
		if !ok {
			continue
		}
		property, _ := rawProperty.(map[string]any)
		expected := argString(property, "type")
		if expected == "" || argumentMatchesType(value, expected) {
			continue
		}
		return fmt.Errorf("tool argument %s must be %s", name, expected)
	}
	return nil
}

func argumentMatchesType(value any, expected string) bool {
	switch expected {
	case "string":
		_, ok := value.(string)
		return ok
	case "integer":
		switch typed := value.(type) {
		case int, int64:
			return true
		case float64:
			return typed == float64(int64(typed))
		case json.Number:
			_, err := typed.Int64()
			return err == nil
		default:
			return false
		}
	case "number":
		switch value.(type) {
		case int, int64, float64, json.Number:
			return true
		default:
			return false
		}
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "array":
		switch value.(type) {
		case []any, []string:
			return true
		default:
			return false
		}
	default:
		return true
	}
}

func runReadFile(workspace string, args map[string]any) ToolResult {
	return runReadFileWithPermissions(workspace, workspace, args)
}

func runReadFileWithPermissions(workspace, permissionsRoot string, args map[string]any) ToolResult {
	path, err := checkFileReadWithPermissions(workspace, permissionsRoot, argString(args, "path"))
	if err != nil {
		return deniedToolResult(workspace, "read_file", err)
	}
	limit := clampInt(argInt(args, "limit", 40000), 1, 200000)
	data, err := os.ReadFile(path)
	if err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	content := string(data)
	if len(content) > limit {
		content = content[:limit] + "\n[truncated]\n"
	}
	return maybeArtifact(workspace, "read_file:"+relPath(workspace, path), content, "read_file output")
}

func runWriteFile(workspace string, args map[string]any) ToolResult {
	return runWriteFileWithPermissions(workspace, workspace, args)
}

func runWriteFileWithPermissions(workspace, permissionsRoot string, args map[string]any) ToolResult {
	path, err := checkFileWriteWithPermissions(workspace, permissionsRoot, argString(args, "path"))
	if err != nil {
		return deniedToolResult(workspace, "write_file", err)
	}
	content := argString(args, "content")
	if err := writeText(path, content); err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	return ToolResult{Content: fmt.Sprintf("wrote %s (%d chars)", relPath(workspace, path), len(content))}
}

func runListFiles(workspace string, args map[string]any) ToolResult {
	return runListFilesWithPermissions(workspace, workspace, args)
}

func runListFilesWithPermissions(workspace, permissionsRoot string, args map[string]any) ToolResult {
	rawPath := argString(args, "path")
	if rawPath == "" {
		rawPath = "."
	}
	root, err := checkFileReadWithPermissions(workspace, permissionsRoot, rawPath)
	if err != nil {
		return deniedToolResult(workspace, "list_files", err)
	}
	maxFiles := clampInt(argInt(args, "max_files", 300), 1, 2000)
	var files []string
	truncated := false
	info, err := os.Stat(root)
	if err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	rootRel := relPath(workspace, root)
	if !info.IsDir() {
		files = append(files, rootRel)
	} else {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || truncated {
				return filepath.SkipAll
			}
			rel := relPath(workspace, path)
			if d.IsDir() {
				if shouldSkipListDir(rel, rootRel) {
					return filepath.SkipDir
				}
				return nil
			}
			if shouldSkipContextFile(rel) {
				return nil
			}
			files = append(files, rel)
			if len(files) >= maxFiles {
				truncated = true
				return filepath.SkipAll
			}
			return nil
		})
		sort.Strings(files)
		if truncated {
			files = append(files, "[truncated]")
		}
	}
	return maybeArtifact(workspace, "list_files:"+rawPath, strings.Join(files, "\n"), "list_files output")
}

func shouldSkipListDir(rel, rootRel string) bool {
	rel = filepath.ToSlash(rel)
	rootRel = filepath.ToSlash(rootRel)
	if rel == rootRel || rel == "." || rel == "" {
		return false
	}
	if rel == ".feng/cache" || rel == ".feng/runs" {
		return true
	}
	return shouldSkipContextDir(rel)
}

func runRunCommand(workspace string, args map[string]any) ToolResult {
	return runRunCommandWithPermissions(workspace, workspace, args)
}

func runRunCommandWithPermissions(workspace, permissionsRoot string, args map[string]any) ToolResult {
	command := strings.TrimSpace(argString(args, "command"))
	if command == "" {
		return ToolResult{Content: "command is required", IsError: true}
	}
	if err := checkCommandWithPermissions(workspace, permissionsRoot, command); err != nil {
		return deniedToolResult(workspace, "run_command", err)
	}
	timeout := clampInt(argInt(args, "timeout", 60), 1, 600)
	exitCode, output := runShellCommand(workspace, command, timeout)
	result := maybeArtifact(workspace, "run_command:"+command, fmt.Sprintf("exit_code=%d\n%s", exitCode, output), "run_command output")
	result.IsError = exitCode != 0
	return result
}

func deniedToolResult(workspace, tool string, err error) ToolResult {
	data := map[string]any{"tool": tool, "reason": err.Error()}
	result := ToolResult{Content: redactSecretText(err.Error()), IsError: true}
	var denied permissionDeniedError
	if errors.As(err, &denied) && denied.Artifact.Path != "" {
		data["artifact"] = denied.Artifact.Path
		result.Artifact = &denied.Artifact
	}
	appendEvent(workspace, "tool_denied", data)
	return result
}

func runShellCommand(workspace, command string, timeoutSeconds int) (int, string) {
	return runShellCommandWithEnv(workspace, command, timeoutSeconds, nil)
}

func runShellCommandWithEnv(workspace, command string, timeoutSeconds int, env map[string]string) (int, string) {
	return runShellCommandInDir(workspace, workspace, command, timeoutSeconds, env)
}

func runShellCommandInDir(workspace, dir, command string, timeoutSeconds int, env map[string]string) (int, string) {
	timeout := time.Duration(clampInt(timeoutSeconds, 1, 600)) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/C", command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}
	cmd.Dir = dir
	if len(env) > 0 {
		cmd.Env = os.Environ()
		keys := make([]string, 0, len(env))
		for key := range env {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			cmd.Env = append(cmd.Env, key+"="+env[key])
		}
	}
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

func selfRepoTools(workspace string) []Tool {
	return selfRepoToolsFromRoot(workspace, workspace)
}

func selfRepoToolsFromRoot(workspace, selfRoot string) []Tool {
	toolsDir := filepath.Join(selfRoot, "tools")
	if !exists(toolsDir) {
		return nil
	}
	seen := map[string]bool{}
	for _, tool := range bootstrapTools() {
		seen[tool.Name] = true
	}
	var loaded []Tool
	_ = filepath.WalkDir(toolsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !isToolFile(path) {
			return nil
		}
		tool := commandToolFromRoot(workspace, selfRoot, path)
		if tool == nil || seen[tool.Name] {
			return nil
		}
		seen[tool.Name] = true
		loaded = append(loaded, *tool)
		return nil
	})
	return loaded
}

func commandTool(workspace, path string) *Tool {
	return commandToolFromRoot(workspace, workspace, path)
}

func commandToolFromRoot(workspace, selfRoot, path string) *Tool {
	data, err := readJSONFile(path)
	if err != nil {
		appendEvent(workspace, "tool_load_failed", map[string]any{"path": relPath(selfRoot, path), "reason": err.Error()})
		return nil
	}
	raw, _ := data.(map[string]any)
	if raw["type"] != "command" {
		return nil
	}
	name := strings.TrimSpace(argString(raw, "name"))
	if name == "" {
		name = defaultToolName(path)
	}
	command := strings.TrimSpace(argString(raw, "command"))
	if !validToolName(name) || command == "" {
		appendEvent(workspace, "tool_load_failed", map[string]any{"path": relPath(selfRoot, path), "reason": "invalid name or command"})
		return nil
	}
	description := argString(raw, "description")
	if description == "" {
		description = "Run the self-defined command tool " + name + "."
	}
	inputSchema, ok := raw["input_schema"].(map[string]any)
	if !ok || inputSchema == nil {
		inputSchema = map[string]any{"type": "object", "properties": map[string]any{}, "required": []any{}}
	}
	timeout := clampInt(argInt(raw, "timeout", 60), 1, 600)
	workdirMode := strings.ToLower(strings.TrimSpace(argString(raw, "workdir")))
	if workdirMode == "" {
		workdirMode = "workspace"
	}
	if workdirMode != "workspace" && workdirMode != "self" {
		appendEvent(workspace, "tool_load_failed", map[string]any{"path": relPath(selfRoot, path), "reason": "invalid workdir"})
		return nil
	}
	rel := relPath(selfRoot, path)

	return &Tool{
		Name:           name,
		Description:    description[:minInt(len(description), 500)],
		Parameters:     inputSchema,
		Source:         rel,
		SelectionTerms: selectionTerms(name, rel, description, raw),
		AlwaysActive:   boolFromAny(raw["always"]),
		Handler: func(toolWorkspace string, args map[string]any) ToolResult {
			if err := checkCommandWithPermissions(toolWorkspace, selfRoot, command); err != nil {
				return deniedToolResult(toolWorkspace, name, err)
			}
			encodedArgs, _ := json.Marshal(args)
			commandDir := toolWorkspace
			if workdirMode == "self" {
				commandDir = selfRoot
			}
			exitCode, output := runShellCommandInDir(toolWorkspace, commandDir, command, timeout, map[string]string{
				"FENG_TOOL_ARGS":     string(encodedArgs),
				"FENG_TOOL_NAME":     name,
				"FENG_TOOL_SOURCE":   rel,
				"FENG_SELF_DIR":      selfRoot,
				"FENG_WORKSPACE_DIR": toolWorkspace,
			})
			result := maybeArtifact(toolWorkspace, name+":"+command, fmt.Sprintf("exit_code=%d\n%s", exitCode, output), name+" output")
			result.IsError = exitCode != 0
			return result
		},
	}
}

func selectionQuery(_workspace, mode, latestEvent string) string {
	return strings.ToLower(mode + "\n" + latestEvent)
}

func selectSelfRepoTools(tools []Tool, query string, limit int) ([]Tool, map[string]string) {
	type scoredTool struct {
		tool    Tool
		score   int
		reasons []string
	}
	var scored []scoredTool
	for _, tool := range tools {
		score := 0
		var reasons []string
		if tool.AlwaysActive {
			score += 100
			reasons = append(reasons, "always")
		}
		if selectionTermMatches(query, tool.Name) {
			score += 10
			reasons = append(reasons, "name:"+tool.Name)
		}
		for _, term := range tool.SelectionTerms {
			if selectionTermMatches(query, term) {
				score += 3
				if len(reasons) < 4 {
					reasons = append(reasons, "term:"+term)
				}
			}
		}
		if score > 0 {
			scored = append(scored, scoredTool{tool: tool, score: score, reasons: reasons})
		}
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].tool.Name < scored[j].tool.Name
	})
	limit = clampInt(limit, 0, len(scored))
	selected := make([]Tool, 0, limit)
	reasons := map[string]string{}
	for i := 0; i < limit; i++ {
		selected = append(selected, scored[i].tool)
		reasons[scored[i].tool.Name] = strings.Join(scored[i].reasons, ",")
	}
	return selected, reasons
}

func activeSelfToolLimit() int {
	if raw := strings.TrimSpace(os.Getenv("FENG_ACTIVE_SELF_TOOL_LIMIT")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			return clampInt(parsed, 0, 32)
		}
	}
	return 8
}

func selectionTerms(name, rel, description string, raw map[string]any) []string {
	seen := map[string]bool{}
	var terms []string
	add := func(term string) {
		term = strings.ToLower(strings.TrimSpace(term))
		if term == "" || seen[term] {
			return
		}
		seen[term] = true
		terms = append(terms, term)
	}
	for _, term := range strings.FieldsFunc(name, splitSelectionRune) {
		add(term)
	}
	for _, term := range strings.FieldsFunc(defaultToolName(rel), splitSelectionRune) {
		add(term)
	}
	for _, key := range []string{"when", "keywords", "tags"} {
		for _, term := range stringListFromAny(raw[key]) {
			add(term)
		}
	}
	for _, term := range significantSelectionTerms(description) {
		add(term)
	}
	return terms
}

func significantSelectionTerms(text string) []string {
	stop := map[string]bool{
		"with": true, "from": true, "this": true, "that": true, "tool": true,
		"command": true, "self": true, "defined": true, "through": true, "using": true,
	}
	var terms []string
	for _, term := range strings.FieldsFunc(text, splitSelectionRune) {
		term = strings.ToLower(strings.TrimSpace(term))
		if len(term) < 4 || stop[term] {
			continue
		}
		terms = append(terms, term)
		if len(terms) >= 12 {
			break
		}
	}
	return terms
}

func splitSelectionRune(r rune) bool {
	return !(r >= 'a' && r <= 'z') &&
		!(r >= 'A' && r <= 'Z') &&
		!(r >= '0' && r <= '9') &&
		r != '_'
}

func stringListFromAny(value any) []string {
	switch typed := value.(type) {
	case string:
		return []string{typed}
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			out = append(out, fmt.Sprint(item))
		}
		return out
	case []string:
		return typed
	default:
		return nil
	}
}

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true")
	default:
		return false
	}
}

func selectionTermMatches(query, term string) bool {
	term = strings.ToLower(strings.TrimSpace(term))
	if term == "" || query == "" {
		return false
	}
	if len(term) < 3 {
		return false
	}
	return strings.Contains(query, term)
}

func toolNameList(tools []Tool) []string {
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	return names
}

func isToolFile(path string) bool {
	return strings.HasSuffix(path, ".tool.yaml") || strings.HasSuffix(path, ".tool.json")
}

func validToolName(name string) bool {
	return toolNamePattern.MatchString(name)
}

func defaultToolName(path string) string {
	name := filepath.Base(path)
	name = strings.TrimSuffix(name, filepath.Ext(name))
	name = strings.TrimSuffix(name, ".tool")
	return name
}

func maybeArtifact(workspace, source, content, summary string) ToolResult {
	content = redactSecretText(content)
	if len(content) <= maxInlineToolResult {
		return ToolResult{Content: content}
	}
	artifact, err := writeArtifact(workspace, "tool-output", source, content, summary, "tool output exceeded inline message budget", "txt", []string{content[:minInt(1000, len(content))]})
	if err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	encoded, _ := json.Marshal(map[string]any{"artifact_ref": artifact})
	return ToolResult{Content: string(encoded), Artifact: &artifact}
}

func argString(args map[string]any, name string) string {
	if value, ok := args[name]; ok {
		if text, ok := value.(string); ok {
			return text
		}
		return fmt.Sprint(value)
	}
	return ""
}

func argInt(args map[string]any, name string, fallback int) int {
	value, ok := args[name]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		parsed, err := strconv.Atoi(typed)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func relPath(workspace, path string) string {
	rel, err := filepath.Rel(workspace, path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(rel)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func clampInt(value, minValue, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
