//go:build windows

package runtime

import "syscall"

const (
	processQueryLimitedInformation = 0x1000
	processSynchronize             = 0x00100000
)

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		handle, err = syscall.OpenProcess(processSynchronize, false, uint32(pid))
	}
	if err != nil {
		return false
	}
	_ = syscall.CloseHandle(handle)
	return true
}
