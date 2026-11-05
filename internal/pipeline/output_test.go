package pipeline

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAllocateFilePathReservesUniqueNames(t *testing.T) {
	dir := t.TempDir()

	first, err := AllocateFilePath(dir, "photo", ".webp")
	if err != nil {
		t.Fatalf("AllocateFilePath: %v", err)
	}
	second, err := AllocateFilePath(dir, "photo", ".webp")
	if err != nil {
		t.Fatalf("AllocateFilePath: %v", err)
	}

	if filepath.Base(first) != "photo.webp" {
		t.Fatalf("first = %q, want photo.webp", first)
	}
	if filepath.Base(second) != "photo(1).webp" {
		t.Fatalf("second = %q, want photo(1).webp", second)
	}
	for _, path := range []string{first, second} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat %q: %v", path, err)
		}
		if info.Size() != 0 {
			t.Fatalf("reserved file %q has size %d, want 0", path, info.Size())
		}
	}
}

func TestAllocateDirReservesUniqueNames(t *testing.T) {
	base := filepath.Join(t.TempDir(), "tiles")

	first, err := AllocateDir(base)
	if err != nil {
		t.Fatalf("AllocateDir: %v", err)
	}
	second, err := AllocateDir(base)
	if err != nil {
		t.Fatalf("AllocateDir: %v", err)
	}

	if first != base {
		t.Fatalf("first = %q, want %q", first, base)
	}
	if second != base+"(1)" {
		t.Fatalf("second = %q, want %q", second, base+"(1)")
	}
}
