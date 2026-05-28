package runtime

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func growHookEvent(state State) string {
	if state.CandidateStatus == "failed" {
		return "on_check_failed"
	}
	return "on_grow"
}

func hookSelectedSkillItems(root string, events []string, excerptLimit int) []map[string]any {
	seen := map[string]bool{}
	var items []map[string]any
	for _, event := range events {
		for _, ref := range hookSkillRefs(root, event) {
			path, ok := resolveHookSkillPath(root, ref)
			if !ok || seen[path] {
				continue
			}
			seen[path] = true
			item, ok := contextFileItem(root, path, "hook "+event+" selected "+ref, excerptLimit)
			if ok {
				items = append(items, item)
			}
			if len(items) >= 4 {
				return items
			}
		}
	}
	return items
}

func hookSelectedSkillPaths(root string, events []string) []string {
	seen := map[string]bool{}
	var paths []string
	for _, event := range events {
		for _, ref := range hookSkillRefs(root, event) {
			path, ok := resolveHookSkillPath(root, ref)
			if !ok || seen[path] {
				continue
			}
			seen[path] = true
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	return paths
}

func selectHookDeclaredTools(root string, tools []Tool, events []string) ([]Tool, map[string]string) {
	declared := hookDeclaredToolRefs(root, events)
	if len(declared) == 0 {
		return nil, nil
	}
	byName := map[string]Tool{}
	for _, tool := range tools {
		byName[tool.Name] = tool
	}
	var selected []Tool
	reasons := map[string]string{}
	names := sortedMapKeys(declared)
	for _, name := range names {
		tool, ok := byName[name]
		if !ok {
			continue
		}
		selected = append(selected, tool)
		reasons[name] = declared[name]
	}
	return selected, reasons
}

func hookDeclaredToolRefs(root string, events []string) map[string]string {
	declared := map[string]string{}
	for _, event := range events {
		for _, path := range hookSelectedSkillPaths(root, []string{event}) {
			for _, name := range skillDeclaredTools(path) {
				if !validToolName(name) {
					continue
				}
				if _, exists := declared[name]; !exists {
					declared[name] = "hook " + event + " selected skill " + relPath(root, path)
				}
			}
		}
	}
	return declared
}

func hookSkillRefs(root, event string) []string {
	value, err := readJSONFile(filepath.Join(root, "hooks.yaml"))
	if err != nil {
		return nil
	}
	raw, _ := value.(map[string]any)
	items, _ := raw[event].([]any)
	var refs []string
	for _, item := range items {
		switch typed := item.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				refs = append(refs, strings.TrimSpace(typed))
			}
		case map[string]any:
			for _, key := range []string{"skill", "path", "name"} {
				if ref := strings.TrimSpace(argString(typed, key)); ref != "" {
					refs = append(refs, ref)
					break
				}
			}
		}
	}
	return refs
}

func checkHooksConfig(workspace string) []string {
	var problems []string
	value, err := readJSONFile(filepath.Join(workspace, "hooks.yaml"))
	if err != nil {
		return []string{"hooks parse failed: " + err.Error()}
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return []string{"hooks.yaml must be an object"}
	}
	toolNames := map[string]bool{}
	for _, tool := range bootstrapTools() {
		toolNames[tool.Name] = true
	}
	for _, tool := range selfRepoTools(workspace) {
		toolNames[tool.Name] = true
	}
	for event, rawItems := range raw {
		items, ok := rawItems.([]any)
		if !ok {
			problems = append(problems, "hooks."+event+" must be a list")
			continue
		}
		for index, item := range items {
			ref := hookRefFromItem(item)
			if ref == "" {
				problems = append(problems, fmt.Sprintf("hooks.%s[%d] must reference a skill", event, index))
				continue
			}
			path, ok := resolveHookSkillPath(workspace, ref)
			if !ok {
				problems = append(problems, fmt.Sprintf("hook skill not found in hooks.%s[%d]: %s", event, index, ref))
				continue
			}
			for _, toolName := range skillDeclaredTools(path) {
				if !validToolName(toolName) {
					problems = append(problems, fmt.Sprintf("hook skill %s declares invalid tool name: %s", relPath(workspace, path), toolName))
					continue
				}
				if !toolNames[toolName] {
					problems = append(problems, fmt.Sprintf("hook skill %s declares unknown tool: %s", relPath(workspace, path), toolName))
				}
			}
		}
	}
	return problems
}

func hookRefFromItem(item any) string {
	switch typed := item.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		for _, key := range []string{"skill", "path", "name"} {
			if ref := strings.TrimSpace(argString(typed, key)); ref != "" {
				return ref
			}
		}
	}
	return ""
}

func skillDeclaredTools(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	lines := strings.Split(string(data), "\n")
	seen := map[string]bool{}
	var tools []string
	add := func(raw string) {
		for _, name := range parseToolNameList(raw) {
			if seen[name] {
				continue
			}
			seen[name] = true
			tools = append(tools, name)
		}
	}
	for i := 0; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		lowered := strings.ToLower(trimmed)
		if !strings.HasPrefix(lowered, "tools:") {
			continue
		}
		rest := strings.TrimSpace(trimmed[len("tools:"):])
		if rest != "" {
			add(rest)
			continue
		}
		for j := i + 1; j < len(lines); j++ {
			item := strings.TrimSpace(lines[j])
			if item == "" {
				break
			}
			if strings.HasSuffix(item, ":") && !strings.HasPrefix(item, "- ") && !strings.HasPrefix(item, "* ") {
				break
			}
			if strings.HasPrefix(item, "- ") || strings.HasPrefix(item, "* ") {
				add(strings.TrimSpace(item[2:]))
				continue
			}
			if strings.HasPrefix(lines[j], " ") || strings.HasPrefix(lines[j], "\t") {
				add(item)
				continue
			}
			break
		}
	}
	sort.Strings(tools)
	return tools
}

func parseToolNameList(raw string) []string {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.Trim(cleaned, "[]")
	fields := strings.FieldsFunc(cleaned, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t'
	})
	var names []string
	for _, field := range fields {
		name := strings.Trim(strings.TrimSpace(field), "`\"'")
		name = strings.TrimSuffix(name, ":")
		if name != "" {
			names = append(names, name)
		}
	}
	return names
}

func sortedMapKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func resolveHookSkillPath(root, ref string) (string, bool) {
	ref = filepath.ToSlash(strings.TrimSpace(ref))
	if ref == "" || strings.HasPrefix(ref, "../") || strings.Contains(ref, "/../") || filepath.IsAbs(ref) {
		return "", false
	}
	var candidates []string
	addCandidate := func(rel string) {
		rel = filepath.ToSlash(strings.TrimSpace(rel))
		if rel == "" {
			return
		}
		candidates = append(candidates, filepath.Join(root, filepath.FromSlash(rel)))
		if filepath.Ext(rel) == "" {
			candidates = append(candidates, filepath.Join(root, filepath.FromSlash(rel+".md")))
		}
	}
	if strings.HasPrefix(ref, "skills/") {
		addCandidate(ref)
	} else {
		addCandidate(filepath.ToSlash(filepath.Join("skills", ref)))
	}
	for _, candidate := range candidates {
		if skillPathInsideRoot(root, candidate) && exists(candidate) {
			return candidate, true
		}
	}
	return scanSkillByName(root, ref)
}

func scanSkillByName(root, ref string) (string, bool) {
	target := strings.TrimSuffix(filepath.Base(ref), filepath.Ext(ref))
	if target == "" {
		return "", false
	}
	skillsDir := filepath.Join(root, "skills")
	var found string
	_ = filepath.WalkDir(skillsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || found != "" || !isSkillBodyFile(path) {
			return nil
		}
		name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		if strings.EqualFold(name, target) {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	return found, found != ""
}

func skillPathInsideRoot(root, path string) bool {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(rel)
	return rel == "skills" || strings.HasPrefix(rel, "skills/")
}
