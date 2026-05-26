package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
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
			return func() { releaseWorkspaceLock(workspace, owner, os.Getpid()) }, nil
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
	if time.Since(info.ModTime()) < time.Duration(staleAfter)*time.Second {
		return false
	}
	return os.Remove(lockPath) == nil
}

func describeLock(lockPath string) error {
	data, err := os.ReadFile(lockPath)
	if err != nil {
		return fmt.Errorf("workspace is locked")
	}
	var record lockRecord
	if json.Unmarshal(data, &record) != nil {
		return fmt.Errorf("workspace is locked")
	}
	return fmt.Errorf("workspace is locked by %s pid=%d since=%s", record.Owner, record.PID, time.Unix(record.StartedAt, 0).Format(time.RFC3339))
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
	state, err := loadState(workspace)
	if err == nil {
		state.Lock = map[string]string{"owner": "", "heartbeat": ""}
		_ = saveState(workspace, state)
	}
}

func markStateLocked(workspace string, record lockRecord) {
	state, err := loadState(workspace)
	if err != nil {
		return
	}
	state.Lock = map[string]string{
		"owner":      record.Owner,
		"pid":        strconv.Itoa(record.PID),
		"heartbeat":  time.Unix(record.Heartbeat, 0).Format(time.RFC3339),
		"started_at": time.Unix(record.StartedAt, 0).Format(time.RFC3339),
	}
	_ = saveState(workspace, state)
}
