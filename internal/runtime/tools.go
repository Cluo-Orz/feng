package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxInlineToolResult = 8000

type Tool struct {
	Name        string
	Description string
	Parameters  map[string]any
	Handler     func(workspace string, args map[string]any) ToolResult
}

type ToolResult struct {
	Content  string    `json:"content"`
	Artifact *Artifact `json:"artifact,omitempty"`
	IsError  bool      `json:"is_error"`
}

func bootstrapTools() []Tool {
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
			Handler: runReadFile,
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
			Handler: runWriteFile,
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
			Handler: runListFiles,
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
			Handler: runRunCommand,
		},
	}
}

func activeToolPack(_workspace, _mode, _latestEvent string) []Tool {
	return bootstrapTools()
}

func executeTool(workspace string, tools []Tool, name string, args map[string]any) ToolResult {
	for _, tool := range tools {
		if tool.Name == name {
			return tool.Handler(workspace, args)
		}
	}
	return ToolResult{Content: "unknown tool: " + name, IsError: true}
}

func runReadFile(workspace string, args map[string]any) ToolResult {
	path, err := checkFileRead(workspace, argString(args, "path"))
	if err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
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
	appendEvent(workspace, "tool_called", map[string]any{"tool": "read_file", "path": relPath(workspace, path)})
	return maybeArtifact(workspace, "read_file:"+relPath(workspace, path), content, "read_file output")
}

func runWriteFile(workspace string, args map[string]any) ToolResult {
	path, err := checkFileWrite(workspace, argString(args, "path"))
	if err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	content := argString(args, "content")
	if err := writeText(path, content); err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	appendEvent(workspace, "tool_called", map[string]any{"tool": "write_file", "path": relPath(workspace, path)})
	return ToolResult{Content: fmt.Sprintf("wrote %s (%d chars)", relPath(workspace, path), len(content))}
}

func runListFiles(workspace string, args map[string]any) ToolResult {
	rawPath := argString(args, "path")
	if rawPath == "" {
		rawPath = "."
	}
	root, err := checkFileRead(workspace, rawPath)
	if err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	maxFiles := clampInt(argInt(args, "max_files", 300), 1, 2000)
	var files []string
	info, err := os.Stat(root)
	if err != nil {
		return ToolResult{Content: err.Error(), IsError: true}
	}
	if !info.IsDir() {
		files = append(files, relPath(workspace, root))
	} else {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			rel := relPath(workspace, path)
			if d.IsDir() {
				if rel == ".git" || strings.HasPrefix(rel, ".git/") {
					return filepath.SkipDir
				}
				return nil
			}
			files = append(files, rel)
			if len(files) >= maxFiles {
				files = append(files, "[truncated]")
				return filepath.SkipAll
			}
			return nil
		})
		sort.Strings(files)
	}
	appendEvent(workspace, "tool_called", map[string]any{"tool": "list_files", "path": rawPath})
	return maybeArtifact(workspace, "list_files:"+rawPath, strings.Join(files, "\n"), "list_files output")
}

func runRunCommand(workspace string, args map[string]any) ToolResult {
	command := strings.TrimSpace(argString(args, "command"))
	if command == "" {
		return ToolResult{Content: "command is required", IsError: true}
	}
	if err := checkCommand(workspace, command); err != nil {
		appendEvent(workspace, "tool_denied", map[string]any{"tool": "run_command", "reason": err.Error()})
		return ToolResult{Content: err.Error(), IsError: true}
	}
	timeout := time.Duration(clampInt(argInt(args, "timeout", 60), 1, 600)) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/C", command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}
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
	appendEvent(workspace, "tool_called", map[string]any{"tool": "run_command", "command": command, "exit_code": exitCode})
	result := maybeArtifact(workspace, "run_command:"+command, fmt.Sprintf("exit_code=%d\n%s", exitCode, string(output)), "run_command output")
	result.IsError = exitCode != 0
	return result
}

func maybeArtifact(workspace, source, content, summary string) ToolResult {
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
