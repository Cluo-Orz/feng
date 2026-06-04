//go:build windows

package runtime

import "syscall"

const (
	processQueryLimitedInformation = 0x1000
	processSynchronize             = 0x00100000
	processStillActive             = 259
)

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := syscall.OpenProcess(processQueryLimitedInformation|processSynchronize, false, uint32(pid))
	if err != nil {
		handle, err = syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	}
	if err != nil {
		handle, err = syscall.OpenProcess(processSynchronize, false, uint32(pid))
	}
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(handle)
	var exitCode uint32
	if err := syscall.GetExitCodeProcess(handle, &exitCode); err == nil {
		return exitCode == processStillActive
	}
	event, err := syscall.WaitForSingleObject(handle, 0)
	return err == nil && event == syscall.WAIT_TIMEOUT
}
