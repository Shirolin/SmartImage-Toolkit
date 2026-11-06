//go:build !windows

package main

import "path/filepath"

func revealFile(path string) {
	openPath(filepath.Dir(path))
}
