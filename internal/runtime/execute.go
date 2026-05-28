package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type interfaceCommand struct {
	Name        string
	Description string
	Usage       string
}

func shouldRunPackagedExecute(_args []string, executable string) bool {
	seedSelf := packagedSeedSelf()
	if seedSelf == "" {
		return false
	}
	config, err := loadInterfaceConfig(seedSelf)
	if err != nil {
		return false
	}
	commands := parseInterfaceCommands(config)
	return len(commands) > 0 && !isDefaultKernelInterface(commands)
}

func cmdExecute(args []string, cwd string, stdout, stderr io.Writer, executable string) int {
	seedSelf := packagedSeedSelf()
	if seedSelf == "" {
		fmt.Fprintln(stderr, "packaged self not found")
		return 1
	}
	interfaceConfig, err := loadInterfaceConfig(seedSelf)
	if err != nil {
		fmt.Fprintf(stderr, "interface load failed: %v\n", err)
		return 1
	}
	commands := parseInterfaceCommands(interfaceConfig)
	command, commandArgs, help, err := resolveExecuteCommand(args, executableCommandName(executable), commands)
	if err != nil {
		fmt.Fprintln(stderr, err)
		printExecuteHelp(stdout, executableCommandName(executable), commands)
		return 2
	}
	if help {
		printExecuteHelp(stdout, executableCommandName(executable), commands)
		return 0
	}

	workspace := executeWorkspace(cwd)
	goal := strings.TrimSpace("execute " + command + " " + strings.Join(commandArgs, " "))
	if _, err := bootstrapExecuteWorkspace(workspace, goal, seedSelf); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	release, err := acquireWorkspaceLock(workspace, "execute")
	if err != nil {
		printJSON(stdout, map[string]any{"ok": false, "reason": "workspace_locked", "message": err.Error()})
		return 2
	}
	defer release()

	state, _ := loadState(workspace)
	state.Mode = "executing"
	state.CurrentGoal = goal
	saveState(workspace, state)
	appendEvent(workspace, "run_started", map[string]any{"mode": "execute", "command": command, "args": commandArgs})
	return runExecuteLoop(workspace, seedSelf, command, commandArgs, interfaceConfig, stdout)
}

func executeWorkspace(cwd string) string {
	abs, err := filepath.Abs(cwd)
	if err != nil {
		return cwd
	}
	return abs
}

func bootstrapExecuteWorkspace(workspace, goal, seedSelf string) (bool, error) {
	created := false
	for _, dir := range []string{".feng", ".feng/artifacts", ".feng/cache", ".feng/runs"} {
		full := filepath.Join(workspace, filepath.FromSlash(dir))
		if !exists(full) {
			created = true
		}
		if err := os.MkdirAll(full, 0o755); err != nil {
			return false, err
		}
	}
	statePath := filepath.Join(workspace, ".feng", "state.yaml")
	if !exists(statePath) {
		state := defaultState(goal)
		state.SourceSelfCommit = packagedSourceCommit(seedSelf)
		state.CandidateStatus = "execute"
		if err := saveState(workspace, state); err != nil {
			return false, err
		}
		created = true
	} else if state, err := loadState(workspace); err == nil && state.SourceSelfCommit == "" {
		state.SourceSelfCommit = packagedSourceCommit(seedSelf)
		if err := saveState(workspace, state); err != nil {
			return false, err
		}
	}
	if created {
		appendEvent(workspace, "execute_bootstrap", map[string]any{
			"source_self_commit": packagedSourceCommit(seedSelf),
		})
	}
	return created, nil
}

func runExecuteLoop(workspace, selfRoot, command string, commandArgs []string, interfaceConfig map[string]any, stdout io.Writer) int {
	messages := compileExecuteMessages(workspace, selfRoot, command, commandArgs, interfaceConfig)
	latestEvent := "execute " + command + " " + strings.Join(commandArgs, " ")
	toolPack := activeToolPackReportFromSelf(workspace, selfRoot, "execute", latestEvent, "on_execute")
	tools := toolPack.Tools
	toolSchemas := toolSchemasForProvider(tools)
	refreshToolPack := func() {
		toolPack = activeToolPackReportFromSelf(workspace, selfRoot, "execute", latestEvent, "on_execute")
		tools = toolPack.Tools
		toolSchemas = toolSchemasForProvider(tools)
		updateContextMetrics(workspace, messages, toolSchemas)
	}
	refreshToolPack()
	profile, err := loadProviderProfile(workspace)
	if err != nil {
		return handleLLMError(workspace, err, stdout)
	}

	for turn := 0; turn < executeMaxTurns(); turn++ {
		if turn > 0 {
			refreshToolPack()
		}
		if compacted, changed := compactMessagesForBudget(workspace, messages, toolSchemas); changed {
			messages = compacted
			updateContextMetrics(workspace, messages, toolSchemas)
		}
		appendEvent(workspace, "message_compiled", map[string]any{
			"mode":                   "execute",
			"turn":                   turn,
			"estimated_input_tokens": estimateMessageTokens(messages),
			"tool_schema_tokens":     estimateJSONTokens(toolSchemas),
			"active_tool_pack_hash":  shaJSON(toolSchemas),
			"context_pack_hash":      contextPackHash(messages),
			"context_pack_tokens":    estimateMessageTokens(contextPackMessages(messages)),
			"selected_tools":         toolPack.SelectedTools,
			"selection_reason":       toolPack.SelectionReason,
		})
		assistant, updatedMessages, err := callProviderWithRecovery(workspace, profile, messages, toolSchemas)
		messages = updatedMessages
		if err != nil {
			return handleLLMError(workspace, err, stdout)
		}
		updateUsageMetrics(workspace, assistant.Usage)
		appendEvent(workspace, "llm_called", map[string]any{"provider": profile.ID, "model": profile.Model, "mode": "execute", "turn": turn, "tool_calls": len(assistant.ToolCalls), "usage": assistant.Usage})

		if len(assistant.ToolCalls) == 0 {
			state, _ := loadState(workspace)
			state.Mode = "ready"
			state.LastRecovery = emptyRecovery()
			saveState(workspace, state)
			appendEvent(workspace, "run_stopped", map[string]any{"mode": "execute", "turn": turn, "reason": "assistant_done"})
			if strings.TrimSpace(assistant.Content) == "" {
				printJSON(stdout, map[string]any{"ok": true, "turns": turn + 1})
			} else {
				fmt.Fprintln(stdout, assistant.Content)
			}
			return 0
		}

		messages = append(messages, chatMessage{Role: "assistant", Content: assistant.Content, ToolCalls: assistant.ToolCalls})
		for _, call := range assistant.ToolCalls {
			args := parseToolArguments(call.Function.Arguments)
			result := executeTool(workspace, tools, call.Function.Name, args)
			recordToolResult(workspace, call.Function.Name, result)
			messages = append(messages, chatMessage{Role: "tool", ToolCallID: call.ID, Content: encodeToolResult(result)})
			latestEvent = "tool " + call.Function.Name + " returned: " + truncateString(result.Content, 500)
		}
		updateContextMetrics(workspace, messages, toolSchemas)
	}

	state, _ := loadState(workspace)
	state.Mode = "blocked"
	saveState(workspace, state)
	appendEvent(workspace, "blocked", map[string]any{"mode": "execute", "reason": "budget_reached", "max_turns": executeMaxTurns()})
	printJSON(stdout, map[string]any{"ok": false, "reason": "budget_reached", "max_turns": executeMaxTurns()})
	return 2
}

func compileExecuteMessages(workspace, selfRoot, command string, commandArgs []string, interfaceConfig map[string]any) []chatMessage {
	state, _ := loadState(workspace)
	requestQuery := command + " " + strings.Join(commandArgs, " ")
	hookEvent := "on_execute"
	contextPack := cachedContextPack(selfRoot, requestQuery, hookEvent)
	selfContract := map[string]any{
		"self_commit":        packagedSourceCommit(selfRoot),
		"source_self_commit": state.SourceSelfCommit,
		"self_files":         selfFileIndex(selfRoot),
		"identity":           fileTextExcerpt(selfRoot, "identity.md", 2000),
		"goal":               fileTextExcerpt(selfRoot, "goal.md", 2000),
		"skill_catalog":      skillCatalog(selfRoot, 80),
		"world_index":        worldIndex(selfRoot, 200),
		"interface":          interfaceConfig,
	}
	stateManifest := map[string]any{
		"mode":                 state.Mode,
		"active_hook":          hookEvent,
		"current_goal":         state.CurrentGoal,
		"source_self_commit":   state.SourceSelfCommit,
		"last_recovery":        state.LastRecovery,
		"recovery_count":       state.RecoveryCount,
		"workspace_file_index": workspaceFileIndex(workspace, 300),
		"recent_events":        recentEventRefs(workspace, 8),
		"artifact_refs":        artifactRefs(workspace, 10),
	}
	request := map[string]any{
		"command": command,
		"args":    commandArgs,
		"cwd":     workspace,
	}
	selfContractJSON, _ := json.MarshalIndent(selfContract, "", "  ")
	stateManifestJSON, _ := json.MarshalIndent(stateManifest, "", "  ")
	requestJSON, _ := json.MarshalIndent(request, "", "  ")
	messages := []chatMessage{
		{
			Role: "system",
			Content: "You are a hatched feng agent running in execute mode. Fulfill the packaged interface command for the user. " +
				"Use tool calls when you need to inspect or change the user's workspace. Keep large evidence in files/artifacts. " +
				"Do not expose feng internals unless the user asks.",
		},
		{
			Role:    "system",
			Content: "self contract:\n" + string(selfContractJSON),
		},
	}
	if len(contextPack) > 0 {
		contextPackJSON, _ := json.MarshalIndent(contextPack, "", "  ")
		messages = append(messages, chatMessage{
			Role:    "system",
			Content: "cached context pack:\n" + string(contextPackJSON),
		})
	}
	messages = append(messages,
		chatMessage{
			Role:    "user",
			Content: "state manifest:\n" + string(stateManifestJSON),
		},
		chatMessage{
			Role:    "user",
			Content: "execute request:\n" + string(requestJSON),
		},
	)
	return messages
}

func parseInterfaceCommands(config map[string]any) []interfaceCommand {
	rawCommands, _ := config["commands"].([]any)
	commands := make([]interfaceCommand, 0, len(rawCommands))
	for _, raw := range rawCommands {
		switch typed := raw.(type) {
		case string:
			name := strings.TrimSpace(typed)
			if name != "" {
				commands = append(commands, interfaceCommand{Name: name})
			}
		case map[string]any:
			name := strings.TrimSpace(argString(typed, "name"))
			if name != "" {
				commands = append(commands, interfaceCommand{
					Name:        name,
					Description: argString(typed, "description"),
					Usage:       argString(typed, "usage"),
				})
			}
		}
	}
	return commands
}

func resolveExecuteCommand(args []string, executableName string, commands []interfaceCommand) (string, []string, bool, error) {
	if len(commands) == 0 {
		return "", nil, false, errors.New("interface.yaml does not expose an execute command")
	}
	if len(args) > 0 && isHelpArg(args[0]) {
		return "", nil, true, nil
	}
	if len(commands) == 1 {
		command := commands[0].Name
		if len(args) > 0 && args[0] == command {
			return command, args[1:], false, nil
		}
		return command, args, false, nil
	}
	if len(args) == 0 {
		return "", nil, true, nil
	}
	for _, command := range commands {
		if args[0] == command.Name {
			return command.Name, args[1:], false, nil
		}
	}
	return "", nil, false, fmt.Errorf("%s requires a subcommand; unknown command: %s", executableName, args[0])
}

func printExecuteHelp(w io.Writer, executableName string, commands []interfaceCommand) {
	if strings.TrimSpace(executableName) == "" {
		executableName = "agent"
	}
	if len(commands) == 1 {
		command := commands[0]
		usage := command.Usage
		if usage == "" {
			usage = executableName + " [args...]"
		}
		fmt.Fprintln(w, "usage: "+usage)
		if command.Description != "" {
			fmt.Fprintln(w, command.Description)
		}
		return
	}
	fmt.Fprintln(w, "usage: "+executableName+" <command> [args...]")
	fmt.Fprintln(w, "commands:")
	for _, command := range commands {
		line := "  " + command.Name
		if command.Description != "" {
			line += "  " + command.Description
		}
		fmt.Fprintln(w, line)
	}
}

func isDefaultKernelInterface(commands []interfaceCommand) bool {
	defaults := stringListFromAny(defaultInterfaceConfig()["commands"])
	defaultSet := map[string]bool{}
	for _, item := range defaults {
		defaultSet[item] = true
	}
	actual := make([]string, 0, len(commands))
	for _, command := range commands {
		if !defaultSet[command.Name] {
			return false
		}
		actual = append(actual, command.Name)
	}
	// Older hatch packages may have a default kernel interface from before a
	// new kernel command was added. Treat a core kernel subset as kernel mode
	// so a packaged feng can still grow itself instead of becoming execute mode.
	if len(actual) < len(defaults) {
		seen := map[string]bool{}
		for _, item := range actual {
			seen[item] = true
		}
		return seen["grow"] && seen["check"] && seen["hatch"]
	}
	if len(actual) != len(defaults) {
		return false
	}
	sort.Strings(actual)
	sort.Strings(defaults)
	for i := range defaults {
		if actual[i] != defaults[i] {
			return false
		}
	}
	return true
}

func isHelpArg(arg string) bool {
	return arg == "-h" || arg == "--help" || arg == "help"
}

func executableCommandName(executable string) string {
	if strings.TrimSpace(executable) == "" {
		if exe, err := os.Executable(); err == nil {
			executable = exe
		}
	}
	base := filepath.Base(executable)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	if base == "" || base == "." {
		return "agent"
	}
	return base
}

func executeMaxTurns() int {
	if raw := strings.TrimSpace(os.Getenv("FENG_EXECUTE_MAX_TURNS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			return clampInt(parsed, 1, 64)
		}
	}
	return 12
}
