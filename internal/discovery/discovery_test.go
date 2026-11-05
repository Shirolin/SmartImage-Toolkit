package discovery

import (
	"os"
	"path/filepath"
	"testing"
)

func supported(path string) bool {
	switch filepath.Ext(path) {
	case ".png", ".jpg", ".webp", ".avif":
		return true
	}
	return false
}

func TestDiscoverExpandsFoldersAndDeduplicates(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "a.png"))
	mustWrite(t, filepath.Join(dir, "b.txt"))
	sub := filepath.Join(dir, "sub")
	if err := os.Mkdir(sub, 0o777); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(sub, "c.jpg"))

	res := Discover([]string{dir, filepath.Join(dir, "a.png")}, Options{Supported: supported})
	if len(res.Files) != 2 {
		t.Fatalf("files = %v, want 2 entries", res.Files)
	}
	if len(res.Warnings) != 0 {
		t.Fatalf("warnings = %v, want none", res.Warnings)
	}
}

func TestDiscoverReportsMissingTarget(t *testing.T) {
	res := Discover([]string{filepath.Join(t.TempDir(), "missing")}, Options{Supported: supported})
	if len(res.Files) != 0 {
		t.Fatalf("files = %v, want none", res.Files)
	}
	if len(res.Warnings) != 1 || res.Warnings[0].Kind != "inaccessible" {
		t.Fatalf("warnings = %v, want one inaccessible warning", res.Warnings)
	}
}

func TestDiscoverStopsAtDepthLimit(t *testing.T) {
	root := t.TempDir()
	deep := root
	for i := 0; i < 3; i++ {
		deep = filepath.Join(deep, "d")
		if err := os.Mkdir(deep, 0o777); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite(t, filepath.Join(deep, "deep.png"))

	res := Discover([]string{root}, Options{Supported: supported, MaxDepth: 2})
	if len(res.Files) != 0 {
		t.Fatalf("files = %v, want none below the depth limit", res.Files)
	}
	if res.Truncated != 1 {
		t.Fatalf("truncated = %d, want 1", res.Truncated)
	}
}

func mustWrite(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("x"), 0o666); err != nil {
		t.Fatal(err)
	}
}
