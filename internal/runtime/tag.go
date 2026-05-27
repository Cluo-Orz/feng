package runtime

import (
	"errors"
	"fmt"
	"io"
	"strings"
)

func cmdTag(args []string, cwd string, stdout, stderr io.Writer) int {
	name, err := parseTagArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	workspace, ok := findWorkspace(cwd)
	if !ok {
		fmt.Fprintln(stderr, "not a feng workspace; run feng grow first")
		return 1
	}
	release, err := acquireWorkspaceLock(workspace, "tag")
	if err != nil {
		printJSON(stdout, map[string]any{"ok": false, "reason": "workspace_locked", "message": err.Error()})
		return 2
	}
	defer release()
	tag, err := createValidatedTag(workspace, name)
	if err != nil {
		fmt.Fprintf(stderr, "tag failed: %v\n", err)
		return 1
	}
	printJSON(stdout, map[string]any{"ok": true, "tag": tag, "commit": currentHead(workspace)})
	return 0
}

func parseTagArgs(args []string) (string, error) {
	if len(args) != 1 || strings.TrimSpace(args[0]) == "" {
		return "", errors.New("tag requires exactly one name")
	}
	name := strings.TrimSpace(args[0])
	if slug(name) != name {
		return "", errors.New("tag name must contain only letters, numbers, dot, dash, or underscore")
	}
	return name, nil
}

func createValidatedTag(workspace, name string) (string, error) {
	state, err := loadState(workspace)
	if err != nil {
		return "", err
	}
	if state.CandidateStatus != "validated" || state.ValidatedCommit == "" {
		return "", errors.New("tag requires candidate_status=validated; run feng check first")
	}
	if currentHead(workspace) != state.ValidatedCommit {
		return "", errors.New("tag requires HEAD to match the validated commit; run feng check first")
	}
	status, err := selfGitStatus(workspace)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(status) != "" {
		return "", errors.New("tag requires clean feng self roots")
	}
	if _, err := runGit(workspace, "rev-parse", "--verify", "refs/tags/"+name); err == nil {
		return "", errors.New("tag already exists: " + name)
	}
	if _, err := runGit(workspace, "tag", name, state.ValidatedCommit); err != nil {
		return "", err
	}
	appendEvent(workspace, "tag_created", map[string]any{"tag": name, "commit": state.ValidatedCommit})
	return name, nil
}

func currentValidatedTag(workspace, commit string) string {
	if commit == "" {
		return ""
	}
	out, err := runGit(workspace, "tag", "--points-at", commit)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(out, "\n") {
		tag := strings.TrimSpace(line)
		if tag != "" {
			return tag
		}
	}
	return ""
}
