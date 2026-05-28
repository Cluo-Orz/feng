package runtime

import (
	"os"
	"path/filepath"
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
