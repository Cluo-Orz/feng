package runtime

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
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

func TestStatusReportsCurrentWorkspaceLock(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "observable lock test", ""); err != nil {
		t.Fatal(err)
	}
	release, err := acquireWorkspaceLock(dir, "observer")
	if err != nil {
		t.Fatal(err)
	}

	var out, errOut bytes.Buffer
	code := Run([]string{"status"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("status exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	var snapshot StatusSnapshot
	if err := json.Unmarshal(out.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Lock["active"] != "true" || snapshot.Lock["stale"] != "false" || snapshot.Lock["owner"] != "observer" || snapshot.Lock["pid"] == "" {
		t.Fatalf("status did not expose active lock: %+v", snapshot.Lock)
	}

	release()
	out.Reset()
	errOut.Reset()
	code = Run([]string{"status"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("status after release exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if err := json.Unmarshal(out.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Lock["active"] != "false" || snapshot.Lock["owner"] != "" {
		t.Fatalf("status did not clear released lock: %+v", snapshot.Lock)
	}
}

func TestStatusReportsStaleWorkspaceLock(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "stale observable lock test", ""); err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(dir, ".feng", "lock")
	if err := os.WriteFile(lockPath, []byte(`{"owner":"old","pid":1,"started_at":1,"heartbeat":1}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_LOCK_STALE_SECONDS", "1")

	var out, errOut bytes.Buffer
	code := Run([]string{"status"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("status exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	var snapshot StatusSnapshot
	if err := json.Unmarshal(out.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Lock["active"] != "false" || snapshot.Lock["stale"] != "true" || snapshot.Lock["owner"] != "old" {
		t.Fatalf("status did not expose stale lock: %+v", snapshot.Lock)
	}
}

func TestGUIReportsCurrentWorkspaceLock(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "gui lock test", ""); err != nil {
		t.Fatal(err)
	}
	release, err := acquireWorkspaceLock(dir, "gui-observer")
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	var out, errOut bytes.Buffer
	code := Run([]string{"gui"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("gui exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	html, err := os.ReadFile(strings.TrimSpace(out.String()))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"gui-observer running", "Lock", "active", "true", "gui-observer"} {
		if !strings.Contains(string(html), expected) {
			t.Fatalf("gui did not expose active lock %q:\n%s", expected, string(html))
		}
	}
}

func TestGUIReportsStaleWorkspaceLock(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "gui stale lock test", ""); err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(dir, ".feng", "lock")
	if err := os.WriteFile(lockPath, []byte(`{"owner":"old-gui","pid":1,"started_at":1,"heartbeat":1}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_LOCK_STALE_SECONDS", "1")

	var out, errOut bytes.Buffer
	code := Run([]string{"gui"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("gui exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	html, err := os.ReadFile(strings.TrimSpace(out.String()))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"stale lock", "Lock", "stale", "true", "old-gui"} {
		if !strings.Contains(string(html), expected) {
			t.Fatalf("gui did not expose stale lock %q:\n%s", expected, string(html))
		}
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

func TestWorkspaceLockHeartbeatRefreshesRecordAndState(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "heartbeat lock test", ""); err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(dir, ".feng", "lock")
	if err := os.WriteFile(lockPath, []byte(`{"owner":"heartbeat","pid":`+strconv.Itoa(os.Getpid())+`,"started_at":1,"heartbeat":1}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if !heartbeatWorkspaceLock(dir, "heartbeat", os.Getpid()) {
		t.Fatal("heartbeat refresh returned false")
	}
	record, ok := readLockRecord(lockPath)
	if !ok {
		t.Fatal("lock record was not readable after heartbeat")
	}
	if record.Heartbeat <= 1 {
		t.Fatalf("heartbeat was not refreshed: %+v", record)
	}

	state, err := loadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Lock["owner"] != "heartbeat" {
		t.Fatalf("state lock owner was not updated: %+v", state.Lock)
	}
	if state.Lock["heartbeat"] == time.Unix(1, 0).Format(time.RFC3339) || state.Lock["heartbeat"] == "" {
		t.Fatalf("state lock heartbeat was not refreshed: %+v", state.Lock)
	}
}

func TestWorkspaceLockStaleRecoveryUsesHeartbeatNotModTime(t *testing.T) {
	dir := t.TempDir()
	if _, err := bootstrap(dir, "heartbeat stale test", ""); err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(dir, ".feng", "lock")
	freshHeartbeat := time.Now().Add(60 * time.Second).Unix()
	if err := os.WriteFile(lockPath, []byte(`{"owner":"fresh","pid":1,"started_at":1,"heartbeat":`+strconv.FormatInt(freshHeartbeat, 10)+`}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Second)
	if err := os.Chtimes(lockPath, old, old); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FENG_LOCK_STALE_SECONDS", "1")
	release, err := acquireWorkspaceLock(dir, "blocked")
	if err == nil {
		release()
		t.Fatal("fresh heartbeat lock was incorrectly treated as stale")
	}

	if err := os.WriteFile(lockPath, []byte(`{"owner":"old","pid":1,"started_at":1,"heartbeat":1}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := os.Chtimes(lockPath, now, now); err != nil {
		t.Fatal(err)
	}
	release, err = acquireWorkspaceLock(dir, "second")
	if err != nil {
		t.Fatalf("stale heartbeat lock was not recovered: %v", err)
	}
	release()
}
