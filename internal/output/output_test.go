package output

import (
	"path/filepath"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func TestConvertKeepsNameWhenExtensionChanges(t *testing.T) {
	policy := Policy{Location: settings.SameDir}
	dir, base, ext, err := policy.Target(filepath.Join("pics", "photo.png"), ".webp", Convert)
	if err != nil {
		t.Fatal(err)
	}
	if dir != "pics" || base != "photo" || ext != ".webp" {
		t.Fatalf("got (%q, %q, %q), want (pics, photo, .webp)", dir, base, ext)
	}
}

func TestConvertToSameFormatAddsOptimized(t *testing.T) {
	policy := Policy{Location: settings.SameDir}
	_, base, _, err := policy.Target(filepath.Join("pics", "photo.png"), ".png", Convert)
	if err != nil {
		t.Fatal(err)
	}
	if base != "photo_optimized" {
		t.Fatalf("base = %q, want photo_optimized", base)
	}
}

func TestSubfolderUsesDefaultPerOperation(t *testing.T) {
	policy := Policy{Location: settings.Subfolder}
	dir, base, _, err := policy.Target(filepath.Join("pics", "photo.png"), ".webp", Resize)
	if err != nil {
		t.Fatal(err)
	}
	if dir != filepath.Join("pics", "resized") {
		t.Fatalf("dir = %q, want pics/resized", dir)
	}
	if base != "photo_resized" {
		t.Fatalf("base = %q, want photo_resized", base)
	}
}

func TestCustomDirRequiresPath(t *testing.T) {
	policy := Policy{Location: settings.CustomDir}
	if _, _, _, err := policy.Target("photo.png", ".webp", Convert); err == nil {
		t.Fatal("empty custom dir accepted, want error")
	}
}

func TestCustomDirKeepsBaseName(t *testing.T) {
	out := t.TempDir()
	policy := Policy{Location: settings.CustomDir, CustomDir: out}
	dir, base, _, err := policy.Target(filepath.Join("pics", "photo.jpg"), ".webp", Convert)
	if err != nil {
		t.Fatal(err)
	}
	if dir != out || base != "photo" {
		t.Fatalf("got (%q, %q), want (%q, photo)", dir, base, out)
	}
}
