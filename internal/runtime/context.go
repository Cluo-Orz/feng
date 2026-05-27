package runtime

import (
	"os"
	"path/filepath"
	"sort"
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
		"status_truncated": len(strings.Split(strings.TrimSpace(status), "\n")) > len(lines),
	}
}

func workspaceFileIndex(workspace string, limit int) []string {
	limit = clampInt(limit, 1, 2000)
	var files []string
	_ = filepath.WalkDir(workspace, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel := relPath(workspace, path)
		if d.IsDir() {
			if shouldSkipContextDir(rel) {
				return filepath.SkipDir
			}
			return nil
		}
		if shouldSkipContextFile(rel) {
			return nil
		}
		files = append(files, rel)
		if len(files) >= limit {
			files = append(files, "[truncated]")
			return filepath.SkipAll
		}
		return nil
	})
	sort.Strings(files)
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
	if rel == "dist" || rel == "bin" || rel == "__pycache__" || rel == ".pytest_cache" {
		return true
	}
	return strings.HasSuffix(rel, "/__pycache__")
}

func shouldSkipContextFile(rel string) bool {
	base := filepath.Base(rel)
	if strings.HasSuffix(base, ".pyc") || strings.HasSuffix(base, ".test") || strings.HasSuffix(base, ".exe") {
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
