//go:build !windows

package matting

import "os/exec"

func hideWindow(*exec.Cmd) {}
