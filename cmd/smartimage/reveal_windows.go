//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// revealFile opens Explorer with the file selected. Explorer parses its raw
// command line: when the quotes wrap the whole argument, "/select,...", it
// ignores the switch and opens Documents. The quotes must wrap the path only,
// so the command line is assembled by hand instead of letting exec quote argv.
func revealFile(path string) {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: revealCommandLine(path)}
	_ = cmd.Start()
}

func revealCommandLine(path string) string {
	return `explorer.exe /select,"` + path + `"`
}
