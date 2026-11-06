//go:build windows

package matting

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps the console worker invisible from a GUI session.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
