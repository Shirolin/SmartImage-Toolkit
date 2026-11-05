package resize

import (
	"context"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
)

func writeImage(t *testing.T, dir, name string, w, h int) string {
	t.Helper()
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 200, G: 80, B: 40, A: 255})
		}
	}
	if err := imageio.Encode(f, img, imageio.PNG); err != nil {
		t.Fatal(err)
	}
	return path
}

func decode(t *testing.T, path string) image.Image {
	t.Helper()
	img, err := imageio.DecodeFile(path)
	if err != nil {
		t.Fatalf("decode %q: %v", path, err)
	}
	return img
}

func TestByWidthPreservesAspect(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 200, 100)

	got := Run(context.Background(), src, Config{Mode: ByWidth, Width: 100, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Base(got.Output) != "photo_resized.png" {
		t.Fatalf("output = %q", got.Output)
	}
	b := decode(t, got.Output).Bounds()
	if b.Dx() != 100 || b.Dy() != 50 {
		t.Fatalf("bounds = %dx%d, want 100x50", b.Dx(), b.Dy())
	}
}

func TestByPercent(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 200, 100)

	got := Run(context.Background(), src, Config{Mode: ByPercent, Percent: 200, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	b := decode(t, got.Output).Bounds()
	if b.Dx() != 400 || b.Dy() != 200 {
		t.Fatalf("bounds = %dx%d, want 400x200", b.Dx(), b.Dy())
	}
}

func TestCustomCoverFillsBox(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 200, 100)

	got := Run(context.Background(), src, Config{Mode: Custom, Width: 100, Height: 100, Fit: Cover, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	b := decode(t, got.Output).Bounds()
	if b.Dx() != 100 || b.Dy() != 100 {
		t.Fatalf("bounds = %dx%d, want 100x100", b.Dx(), b.Dy())
	}
}

func TestCustomContainPadsWithTransparency(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 200, 100)

	got := Run(context.Background(), src, Config{Mode: Custom, Width: 100, Height: 100, Fit: Contain, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img := decode(t, got.Output)
	if b := img.Bounds(); b.Dx() != 100 || b.Dy() != 100 {
		t.Fatalf("bounds = %v, want 100x100", b)
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatalf("corner alpha = %d, want transparent padding", a)
	}
}

func TestCustomInsideDoesNotUpscale(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 200, 100)

	got := Run(context.Background(), src, Config{Mode: Custom, Width: 400, Height: 400, Fit: Inside, Format: "original"})
	if got.Status != ops.StatusSkipped {
		t.Fatalf("status = %q (%s), want skipped for an unchanged size", got.Status, got.Reason)
	}
}

func TestWidthConversionChangesExtension(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 200, 100)

	got := Run(context.Background(), src, Config{Mode: ByWidth, Width: 100, Format: string(imageio.WebP)})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Base(got.Output) != "photo_resized.webp" {
		t.Fatalf("output = %q", got.Output)
	}
}

func TestUnchangedSizeIsSkipped(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 200, 100)

	got := Run(context.Background(), src, Config{Mode: ByWidth, Width: 200, Format: "original"})
	if got.Status != ops.StatusSkipped {
		t.Fatalf("status = %q (%s), want skipped", got.Status, got.Reason)
	}
}

func TestTargetSizeRejectsOversized(t *testing.T) {
	if _, _, err := TargetSize(100, 100, Config{Mode: ByWidth, Width: MaxDim + 1}); err == nil {
		t.Fatal("oversized width accepted")
	}
	if _, _, err := TargetSize(100, 100, Config{Mode: ByPercent, Percent: MaxPercent + 1}); err == nil {
		t.Fatal("oversized percent accepted")
	}
}
