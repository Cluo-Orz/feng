package runtime

import (
	"os"
	"path/filepath"
	"strings"
)

func gitContext(workspace string) map[string]any {
	status, err := selfGitStatus(workspace)
	if err != nil {
		return map[string]any{"head": currentHead(workspace), "status_error": err.Error()}
	}
	lines := compactLines(status, 120)
	return map[string]any{
		"head":             currentHead(workspace),
		"status_short":     lines,
		"status_truncated": lineCount(status) > len(lines),
	}
}

func lineCount(text string) int {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0
	}
	return len(strings.Split(trimmed, "\n"))
}

func workspaceFileIndex(workspace string, limit int) []string {
	limit = clampInt(limit, 1, 2000)
	var files []string
	seen := map[string]bool{}
	truncated := false

	addFile := func(rel string) bool {
		rel = filepath.ToSlash(rel)
		if seen[rel] || shouldSkipContextFile(rel) {
			return true
		}
		seen[rel] = true
		files = append(files, rel)
		if len(files) >= limit {
			truncated = true
			return false
		}
		return true
	}

	roots := selfGitPathspecs(workspace)
	for _, root := range roots {
		full := filepath.Join(workspace, filepath.FromSlash(root))
		info, err := os.Stat(full)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			if !addFile(root) {
				break
			}
			continue
		}
		_ = filepath.WalkDir(full, func(path string, d os.DirEntry, err error) error {
			if err != nil || truncated {
				return filepath.SkipAll
			}
			rel := relPath(workspace, path)
			if d.IsDir() {
				if rel != root && shouldSkipContextDir(rel) {
					return filepath.SkipDir
				}
				return nil
			}
			if !addFile(rel) {
				return filepath.SkipAll
			}
			return nil
		})
		if truncated {
			break
		}
	}

	_ = filepath.WalkDir(workspace, func(path string, d os.DirEntry, err error) error {
		if err != nil || truncated {
			return filepath.SkipAll
		}
		rel := relPath(workspace, path)
		if rel != "." && pathUnderRoots(rel, roots) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if shouldSkipContextDir(rel) {
				return filepath.SkipDir
			}
			return nil
		}
		if !addFile(rel) {
			return filepath.SkipAll
		}
		return nil
	})
	if truncated {
		files = append(files, "[truncated]")
	}
	return files
}

func shouldSkipContextDir(rel string) bool {
	rel = filepath.ToSlash(rel)
	if rel == "." || rel == "" {
		return false
	}
	if rel == ".git" || rel == ".feng" {
		return true
	}
	base := filepath.Base(rel)
	if rel == "dist" || rel == "bin" || rel == "build" || rel == "out" || rel == "coverage" {
		return true
	}
	if base == "node_modules" || base == "vendor" || base == "target" {
		return true
	}
	if base == ".venv" || base == "venv" || base == ".next" || base == ".nuxt" || base == ".turbo" || base == ".cache" {
		return true
	}
	return false
}

func shouldSkipContextFile(rel string) bool {
	base := filepath.Base(rel)
	if strings.HasSuffix(base, ".test") || strings.HasSuffix(base, ".exe") {
		return true
	}
	return false
}

func recentEventRefs(workspace string, limit int) []map[string]any {
	events := tailEvents(workspace, limit)
	refs := make([]map[string]any, 0, len(events))
	for _, event := range events {
		refs = append(refs, map[string]any{
			"id":   event.ID,
			"ts":   event.TS,
			"type": event.Type,
			"data": compactEventData(event.Data),
		})
	}
	return refs
}

func compactEventData(data map[string]any) map[string]any {
	if data == nil {
		return map[string]any{}
	}
	out := map[string]any{}
	for key, value := range data {
		if key == "snippets" {
			continue
		}
		out[key] = compactContextValue(value)
	}
	return out
}

func compactContextValue(value any) any {
	switch typed := value.(type) {
	case string:
		return truncateString(typed, 500)
	case map[string]any:
		out := map[string]any{}
		keys := sortedKeysAny(typed)
		limit := minInt(len(keys), 40)
		written := 0
		for _, key := range keys {
			if key == "snippets" {
				continue
			}
			if written >= limit {
				break
			}
			out[key] = compactContextValue(typed[key])
			written++
		}
		if len(keys) > limit {
			out["_truncated"] = true
		}
		return out
	case map[string]string:
		out := map[string]any{}
		keys := sortedKeysString(typed)
		limit := minInt(len(keys), 40)
		for i := 0; i < limit; i++ {
			out[keys[i]] = compactContextValue(typed[keys[i]])
		}
		if len(keys) > limit {
			out["_truncated"] = true
		}
		return out
	case []string:
		if len(typed) > 20 {
			return append(typed[:20], "[truncated]")
		}
		return typed
	case []any:
		limit := minInt(len(typed), 20)
		out := make([]any, 0, limit+1)
		for i := 0; i < limit; i++ {
			out = append(out, compactContextValue(typed[i]))
		}
		if len(typed) > limit {
			out = append(out, "[truncated]")
		}
		return out
	default:
		return typed
	}
}

func artifactRefs(workspace string, limit int) []map[string]any {
	artifacts := listArtifacts(workspace)
	if len(artifacts) > limit {
		artifacts = artifacts[len(artifacts)-limit:]
	}
	refs := make([]map[string]any, 0, len(artifacts))
	for _, artifact := range artifacts {
		snippets := artifact.Snippets
		if len(snippets) > 2 {
			snippets = snippets[:2]
		}
		for i := range snippets {
			snippets[i] = truncateString(snippets[i], 500)
		}
		refs = append(refs, map[string]any{
			"type":         artifact.Type,
			"source":       artifact.Source,
			"path":         artifact.Path,
			"hash":         artifact.Hash,
			"summary":      artifact.Summary,
			"why_relevant": artifact.WhyRelevant,
			"snippets":     snippets,
		})
	}
	return refs
}

func compactLines(text string, limit int) []string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return []string{}
	}
	lines := strings.Split(trimmed, "\n")
	if len(lines) > limit {
		lines = append(lines[:limit], "[truncated]")
	}
	for i := range lines {
		lines[i] = truncateString(strings.TrimRight(lines[i], "\r"), 500)
	}
	return lines
}

func truncateString(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "...[truncated]"
}
