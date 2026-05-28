package runtime

import (
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

func cmdConfig(args []string, cwd string, stdout, stderr io.Writer) int {
	workspace := configWorkspace(cwd)
	if len(args) == 0 || args[0] == "status" {
		printJSON(stdout, map[string]any{
			"ok":       true,
			"provider": providerStatus(workspace),
			"commands": []string{"config", "config status", "config init"},
		})
		return 0
	}
	switch args[0] {
	case "-h", "--help", "help":
		printConfigHelp(stdout)
		return 0
	case "init":
		return cmdConfigInit(args[1:], workspace, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unknown config argument: %s\n", args[0])
		printConfigHelp(stderr)
		return 2
	}
}

func printConfigHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: config [status|init] [--user] [--provider deepseek|deepseek-anthropic] [--force]")
}

func configWorkspace(cwd string) string {
	if seedSelf := packagedSeedSelf(); seedSelf != "" {
		if config, err := loadInterfaceConfig(seedSelf); err == nil {
			commands := parseInterfaceCommands(config)
			if len(commands) > 0 && !isDefaultKernelInterface(commands) {
				abs, err := filepath.Abs(cwd)
				if err != nil {
					return cwd
				}
				return abs
			}
		}
	}
	if workspace, ok := findWorkspace(cwd); ok {
		return workspace
	}
	abs, err := filepath.Abs(cwd)
	if err != nil {
		return cwd
	}
	return abs
}

func cmdConfigInit(args []string, workspace string, stdout, stderr io.Writer) int {
	scope := "workspace"
	provider := "deepseek"
	force := false
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--user":
			scope = "user"
		case args[i] == "--workspace":
			scope = "workspace"
		case args[i] == "--force":
			force = true
		case args[i] == "--provider" && i+1 < len(args):
			provider = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--provider="):
			provider = strings.TrimPrefix(args[i], "--provider=")
		default:
			fmt.Fprintf(stderr, "unknown config init argument: %s\n", args[i])
			printConfigHelp(stderr)
			return 2
		}
	}
	profile, err := providerTemplate(provider)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	target, err := providerConfigTarget(workspace, scope)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if exists(target) && !force {
		printJSON(stdout, map[string]any{
			"ok":      false,
			"reason":  "exists",
			"path":    target,
			"message": "provider config already exists; pass --force to overwrite",
		})
		return 1
	}
	if err := writeJSONFile(target, profile); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	printJSON(stdout, map[string]any{
		"ok":            true,
		"path":          target,
		"scope":         scope,
		"provider":      profile,
		"required_env":  []string{argString(profile, "api_key_env")},
		"stores_secret": false,
	})
	return 0
}

func providerConfigTarget(workspace, scope string) (string, error) {
	switch scope {
	case "workspace":
		return filepath.Join(workspace, ".feng", "provider.yaml"), nil
	case "user":
		root := providerHomeDir()
		if strings.TrimSpace(root) == "" {
			return "", fmt.Errorf("user config directory is unavailable")
		}
		return filepath.Join(root, "provider.yaml"), nil
	default:
		return "", fmt.Errorf("unsupported config scope: %s", scope)
	}
}

func providerTemplate(provider string) (map[string]any, error) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "", "deepseek", "openai", "openai_chat":
		return map[string]any{
			"id":            "deepseek",
			"protocol":      "openai_chat",
			"base_url":      "https://api.deepseek.com",
			"api_key_env":   "DEEPSEEK_API_KEY",
			"default_model": "deepseek-chat",
		}, nil
	case "deepseek-anthropic", "anthropic", "anthropic_messages":
		return map[string]any{
			"id":            "deepseek-anthropic",
			"protocol":      "anthropic_messages",
			"base_url":      "https://api.deepseek.com/anthropic",
			"api_key_env":   "DEEPSEEK_API_KEY",
			"default_model": "deepseek-chat",
		}, nil
	default:
		return nil, fmt.Errorf("unknown provider template: %s", provider)
	}
}
