// Package pipeline owns the file-system side of an image operation: output
// directory creation, exclusive name allocation and ghost cleanup.
package pipeline

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// EnsureDir creates dir and its parents.
func EnsureDir(dir string) error {
	return os.MkdirAll(dir, 0o777)
}

// AllocateFilePath reserves base+ext in dir with O_EXCL and returns the path.
// When the name exists it appends (1), (2), … before the extension, matching
// the Node implementation. The reserved file is an empty placeholder; callers
// must fill it or remove it.
func AllocateFilePath(dir, base, ext string) (string, error) {
	if err := EnsureDir(dir); err != nil {
		return "", err
	}
	candidate := filepath.Join(dir, base+ext)
	for n := 1; ; n++ {
		f, err := os.OpenFile(candidate, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o666)
		if err == nil {
			if cerr := f.Close(); cerr != nil {
				return "", cerr
			}
			return candidate, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", err
		}
		candidate = filepath.Join(dir, fmt.Sprintf("%s(%d)%s", base, n, ext))
	}
}

// AllocateDir reserves base, appending (1), (2), … when it exists.
func AllocateDir(base string) (string, error) {
	candidate := base
	for n := 1; ; n++ {
		err := os.Mkdir(candidate, 0o777)
		if err == nil {
			return candidate, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", err
		}
		candidate = fmt.Sprintf("%s(%d)", base, n)
	}
}

// RemoveGhost deletes a reserved output that was never completed.
func RemoveGhost(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}
