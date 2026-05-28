package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type lockRecord struct {
	Owner     string `json:"owner"`
	PID       int    `json:"pid"`
	StartedAt int64  `json:"started_at"`
	Heartbeat int64  `json:"heartbeat"`
}

func acquireWorkspaceLock(workspace, owner string) (func(), error) {
	lockPath := filepath.Join(workspace, ".feng", "lock")
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	record := lockRecord{Owner: owner, PID: os.Getpid(), StartedAt: now, Heartbeat: now}
	content, _ := json.MarshalIndent(record, "", "  ")

	for attempts := 0; attempts < 2; attempts++ {
		file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			if _, writeErr := file.Write(append(content, '\n')); writeErr != nil {
				_ = file.Close()
				_ = os.Remove(lockPath)
				return nil, writeErr
			}
			if closeErr := file.Close(); closeErr != nil {
				_ = os.Remove(lockPath)
				return nil, closeErr
			}
			markStateLocked(workspace, record)
			stopHeartbeat := startLockHeartbeat(workspace, owner, os.Getpid())
			return func() {
				stopHeartbeat()
				releaseWorkspaceLock(workspace, owner, os.Getpid())
			}, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		if !removeStaleLock(lockPath) {
			return nil, describeLock(lockPath)
		}
	}
	return nil, describeLock(lockPath)
}

func removeStaleLock(lockPath string) bool {
	info, err := os.Stat(lockPath)
	if err != nil {
		return false
	}
	staleAfter := int64(86400)
	if raw := os.Getenv("FENG_LOCK_STALE_SECONDS"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			staleAfter = int64(parsed)
		}
	}
	heartbeat := info.ModTime()
	if record, ok := readLockRecord(lockPath); ok && record.Heartbeat > 0 {
		heartbeat = time.Unix(record.Heartbeat, 0)
	}
	if time.Since(heartbeat) < time.Duration(staleAfter)*time.Second {
		return false
	}
	return os.Remove(lockPath) == nil
}

func describeLock(lockPath string) error {
	record, ok := readLockRecord(lockPath)
	if !ok {
		return fmt.Errorf("workspace is locked")
	}
	return fmt.Errorf("workspace is locked by %s pid=%d since=%s heartbeat=%s", record.Owner, record.PID, time.Unix(record.StartedAt, 0).Format(time.RFC3339), time.Unix(record.Heartbeat, 0).Format(time.RFC3339))
}

func releaseWorkspaceLock(workspace, owner string, pid int) {
	lockPath := filepath.Join(workspace, ".feng", "lock")
	data, err := os.ReadFile(lockPath)
	if err == nil {
		var record lockRecord
		if json.Unmarshal(data, &record) == nil && record.Owner == owner && record.PID == pid {
			_ = os.Remove(lockPath)
		}
	}
	_ = updateState(workspace, func(state *State) {
		state.Lock = map[string]string{"owner": "", "heartbeat": ""}
	})
}

func startLockHeartbeat(workspace, owner string, pid int) func() {
	interval := lockHeartbeatInterval()
	stop := make(chan struct{})
	done := make(chan struct{})
	var once sync.Once
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if !heartbeatWorkspaceLock(workspace, owner, pid) {
					return
				}
			case <-stop:
				return
			}
		}
	}()
	return func() {
		once.Do(func() {
			close(stop)
			<-done
		})
	}
}

func lockHeartbeatInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("FENG_LOCK_HEARTBEAT_SECONDS"))
	if raw == "" {
		return 5 * time.Second
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 1 {
		return 5 * time.Second
	}
	if parsed > 3600 {
		parsed = 3600
	}
	return time.Duration(parsed) * time.Second
}

func heartbeatWorkspaceLock(workspace, owner string, pid int) bool {
	lockPath := filepath.Join(workspace, ".feng", "lock")
	record, ok := readLockRecord(lockPath)
	if !ok || record.Owner != owner || record.PID != pid {
		return false
	}
	record.Heartbeat = time.Now().Unix()
	content, _ := json.MarshalIndent(record, "", "  ")
	if err := os.WriteFile(lockPath, append(content, '\n'), 0o644); err != nil {
		return false
	}
	markStateLocked(workspace, record)
	return true
}

func readLockRecord(lockPath string) (lockRecord, bool) {
	data, err := os.ReadFile(lockPath)
	if err != nil {
		return lockRecord{}, false
	}
	var record lockRecord
	if json.Unmarshal(data, &record) != nil {
		return lockRecord{}, false
	}
	return record, true
}

func markStateLocked(workspace string, record lockRecord) {
	_ = updateState(workspace, func(state *State) {
		state.Lock = map[string]string{
			"owner":      record.Owner,
			"pid":        strconv.Itoa(record.PID),
			"heartbeat":  time.Unix(record.Heartbeat, 0).Format(time.RFC3339),
			"started_at": time.Unix(record.StartedAt, 0).Format(time.RFC3339),
		}
	})
}
