package transcode

import (
	"context"
	"image"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
)

func writeImage(t *testing.T, dir, name string, format imageio.Format) string {
	t.Helper()
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %q: %v", path, err)
	}
	defer f.Close()
	img := image.NewRGBA(image.Rect(0, 0, 32, 24))
	if err := imageio.Encode(f, img, format); err != nil {
		t.Fatalf("encode %q: %v", path, err)
	}
	return path
}

func TestRunCreatesWebP(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "sample.png", imageio.PNG)

	got := Run(context.Background(), src, Config{Format: imageio.WebP})
	if got.Status != "success" {
		t.Fatalf("status = %q (%s), want success", got.Status, got.Reason)
	}
	if filepath.Base(got.Output) != "sample.webp" {
		t.Fatalf("output = %q, want sample.webp", got.Output)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 32 || b.Dy() != 24 {
		t.Fatalf("output bounds = %v, want 32x24", b)
	}
}

func TestRunIncrementsNameOnSecondPass(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "sample.png", imageio.PNG)

	if got := Run(context.Background(), src, Config{Format: imageio.WebP}); got.Status != "success" {
		t.Fatalf("first run: %q (%s)", got.Status, got.Reason)
	}
	second := Run(context.Background(), src, Config{Format: imageio.WebP})
	if second.Status != "success" {
		t.Fatalf("second run: %q (%s)", second.Status, second.Reason)
	}
	if filepath.Base(second.Output) != "sample(1).webp" {
		t.Fatalf("second output = %q, want sample(1).webp", second.Output)
	}
}

func TestRunSkipsSameLossyFormat(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "ready.webp", imageio.WebP)

	got := Run(context.Background(), src, Config{Format: imageio.WebP})
	if got.Status != "skipped" {
		t.Fatalf("status = %q, want skipped", got.Status)
	}
}

func TestRunFailureLeavesNoGhost(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "broken.png")
	if err := os.WriteFile(src, []byte("not an image"), 0o666); err != nil {
		t.Fatal(err)
	}

	got := Run(context.Background(), src, Config{Format: imageio.WebP})
	if got.Status != "error" {
		t.Fatalf("status = %q, want error", got.Status)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "broken.png" {
		t.Fatalf("directory = %v, want only broken.png", entries)
	}
}

func TestRunAllReportsProgress(t *testing.T) {
	dir := t.TempDir()
	paths := []string{
		writeImage(t, dir, "a.png", imageio.PNG),
		writeImage(t, dir, "b.png", imageio.PNG),
		writeImage(t, dir, "c.png", imageio.PNG),
	}

	var mu sync.Mutex
	var seen []int
	results := RunAll(context.Background(), paths, Config{Format: imageio.WebP}, 2, func(done, total int, _ Result) {
		mu.Lock()
		defer mu.Unlock()
		seen = append(seen, done)
		if total != 3 {
			t.Errorf("total = %d, want 3", total)
		}
	})

	if len(results) != 3 {
		t.Fatalf("results = %d, want 3", len(results))
	}
	for _, r := range results {
		if r.Status != "success" {
			t.Fatalf("%s: %q (%s)", r.File, r.Status, r.Reason)
		}
	}
	if len(seen) != 3 {
		t.Fatalf("progress calls = %d, want 3", len(seen))
	}
}
