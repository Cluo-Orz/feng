//go:build windows

package runtime

import (
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestProcessAliveReturnsFalseForKilledProcessWithOpenHandle(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=TestProcessAliveHelper", "--")
	cmd.Env = append(os.Environ(), "FENG_PROCESS_ALIVE_HELPER=1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	if !processAlive(pid) {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatalf("fresh helper process should be alive: pid=%d", pid)
	}
	if err := cmd.Process.Kill(); err != nil {
		_ = cmd.Wait()
		t.Fatal(err)
	}
	defer cmd.Wait()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("killed helper process still reported alive: pid=%d", pid)
}

func TestProcessAliveHelper(t *testing.T) {
	if os.Getenv("FENG_PROCESS_ALIVE_HELPER") != "1" {
		return
	}
	time.Sleep(30 * time.Second)
}
