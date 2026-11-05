// Package discovery expands files and folders into a deduplicated list of
// supported images. It never follows symlinks and reports what it skipped.
package discovery

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Warning describes an entry that was skipped during discovery.
type Warning struct {
	Kind    string // inaccessible, symlink, depth, error
	Path    string
	Message string
	Skipped int // files omitted by a depth cut
}

// Result is the outcome of one discovery run.
type Result struct {
	Files     []string
	Warnings  []Warning
	Truncated int
}

// Options tunes discovery. Zero values select the defaults.
type Options struct {
	// Supported reports whether a file has a supported image extension.
	Supported func(path string) bool
	// MaxDepth limits directory recursion; zero means 10.
	MaxDepth int
	// OnWarn receives every skipped entry.
	OnWarn func(Warning)
}

// Discover expands targets into absolute image paths.
func Discover(targets []string, opts Options) Result {
	if opts.MaxDepth <= 0 {
		opts.MaxDepth = 10
	}
	if opts.Supported == nil {
		opts.Supported = func(string) bool { return false }
	}

	var res Result
	seen := make(map[string]bool)
	warn := func(w Warning) {
		res.Warnings = append(res.Warnings, w)
		if w.Skipped > 0 {
			res.Truncated += w.Skipped
		}
		if opts.OnWarn != nil {
			opts.OnWarn(w)
		}
	}

	add := func(path string) {
		abs, err := filepath.Abs(path)
		if err != nil {
			abs = path
		}
		key := abs
		if runtime.GOOS == "windows" {
			key = strings.ToLower(abs)
		}
		if opts.Supported(abs) && !seen[key] {
			seen[key] = true
			res.Files = append(res.Files, abs)
		}
	}

	for _, target := range targets {
		if strings.TrimSpace(target) == "" {
			continue
		}
		info, err := os.Stat(target)
		if err != nil {
			warn(Warning{Kind: "inaccessible", Path: target, Message: err.Error()})
			continue
		}
		if !info.IsDir() {
			if opts.Supported(target) {
				add(target)
			}
			continue
		}

		rootDepth := strings.Count(filepath.Clean(target), string(os.PathSeparator))
		err = filepath.WalkDir(target, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				warn(Warning{Kind: "error", Path: path, Message: err.Error()})
				return nil
			}
			if d.Type()&fs.ModeSymlink != 0 {
				warn(Warning{Kind: "symlink", Path: path, Message: "符号链接已跳过"})
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				depth := strings.Count(filepath.Clean(path), string(os.PathSeparator)) - rootDepth
				if depth >= opts.MaxDepth {
					n := countSupported(path, opts.Supported)
					warn(Warning{
						Kind:    "depth",
						Path:    path,
						Message: "递归深度超限，目录已跳过",
						Skipped: n,
					})
					return filepath.SkipDir
				}
				return nil
			}
			add(path)
			return nil
		})
		if err != nil {
			warn(Warning{Kind: "error", Path: target, Message: err.Error()})
		}
	}

	return res
}

// countSupported counts supported files under root without following symlinks.
func countSupported(root string, supported func(string) bool) int {
	count := 0
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type()&fs.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() && supported(path) {
			count++
		}
		return nil
	})
	return count
}
