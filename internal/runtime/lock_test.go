package runtime

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWorkspaceLockBlocksMutatingCommands(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	if _, err := bootstrap(dir, "lock test", ""); err != nil {
		t.Fatal(err)
	}
	release, err := acquireWorkspaceLock(dir, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	var out, errOut bytes.Buffer
	code := Run([]string{"check"}, dir, &out, &errOut)
	if code != 2 || !strings.Contains(out.String(), "workspace_locked") {
		t.Fatalf("check was not blocked by lock: code=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"grow", "continue", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 2 || !strings.Contains(out.String(), "workspace_locked") {
		t.Fatalf("grow was not blocked by lock: code=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
}

func TestWorkspaceLockReleaseAndStaleRecovery(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "stale lock test", ""); err != nil {
		t.Fatal(err)
	}
	release, err := acquireWorkspaceLock(dir, "first")
	if err != nil {
		t.Fatal(err)
	}
	release()
	if exists(filepath.Join(dir, ".feng", "lock")) {
		t.Fatal("lock file still exists after release")
	}

	lockPath := filepath.Join(dir, ".feng", "lock")
	if err := os.WriteFile(lockPath, []byte(`{"owner":"old","pid":1,"started_at":1,"heartbeat":1}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Second)
	if err := os.Chtimes(lockPath, old, old); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_LOCK_STALE_SECONDS", "1")
	secondRelease, err := acquireWorkspaceLock(dir, "second")
	if err != nil {
		t.Fatalf("stale lock was not recovered: %v", err)
	}
	secondRelease()
}
