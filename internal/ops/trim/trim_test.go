package trim

import (
	"context"
	"image"
	"image/color"
	"image/draw"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func writeBordered(t *testing.T, dir, name string, w, h int, border int) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(border, border, w-border, h-border),
		&image.Uniform{C: color.Black}, image.Point{}, draw.Src)
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := imageio.Encode(f, img, imageio.PNG); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestTrimAllSides(t *testing.T) {
	dir := t.TempDir()
	src := writeBordered(t, dir, "photo.png", 60, 40, 10)

	got := Run(context.Background(), src, Config{Threshold: 10, Sides: All, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if got.Reason != "去除 上 10 · 下 10 · 左 10 · 右 10" {
		t.Fatalf("reason = %q", got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 40 || b.Dy() != 20 {
		t.Fatalf("bounds = %dx%d, want 40x20", b.Dx(), b.Dy())
	}
}

func TestTrimBottomOnlyKeepsOtherSides(t *testing.T) {
	dir := t.TempDir()
	src := writeBordered(t, dir, "photo.png", 60, 40, 10)

	got := Run(context.Background(), src, Config{Threshold: 10, Sides: Bottom, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 60 || b.Dy() != 30 {
		t.Fatalf("bounds = %dx%d, want 60x30", b.Dx(), b.Dy())
	}
}

func TestTrimSkipsUniformImage(t *testing.T) {
	dir := t.TempDir()
	img := image.NewNRGBA(image.Rect(0, 0, 20, 20))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	src := filepath.Join(dir, "blank.png")
	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := imageio.Encode(f, img, imageio.PNG); err != nil {
		t.Fatal(err)
	}
	f.Close()

	got := Run(context.Background(), src, Config{Threshold: 10, Sides: All, Format: "original"})
	if got.Status != ops.StatusSkipped {
		t.Fatalf("status = %q (%s), want skipped", got.Status, got.Reason)
	}
}

func TestTrimTransparentBorder(t *testing.T) {
	dir := t.TempDir()
	img := image.NewNRGBA(image.Rect(0, 0, 40, 40))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.NRGBA{A: 0}}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(10, 10, 30, 30),
		&image.Uniform{C: color.NRGBA{R: 10, G: 20, B: 30, A: 255}}, image.Point{}, draw.Src)
	src := filepath.Join(dir, "alpha.png")
	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := imageio.Encode(f, img, imageio.PNG); err != nil {
		t.Fatal(err)
	}
	f.Close()

	got := Run(context.Background(), src, Config{Threshold: 10, Sides: All, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	decoded, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := decoded.Bounds(); b.Dx() != 20 || b.Dy() != 20 {
		t.Fatalf("bounds = %dx%d, want 20x20", b.Dx(), b.Dy())
	}
}

func TestTrimUsesOperationSubfolder(t *testing.T) {
	dir := t.TempDir()
	src := writeBordered(t, dir, "photo.png", 60, 40, 10)

	got := Run(context.Background(), src, Config{
		Threshold: 10, Sides: All, Format: "original",
		Policy: output.Policy{Location: settings.Subfolder},
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Dir(got.Output) != filepath.Join(dir, "trimmed") {
		t.Fatalf("output dir = %q, want %s", filepath.Dir(got.Output), filepath.Join(dir, "trimmed"))
	}
	if !strings.HasSuffix(got.Output, "photo_trimmed.png") {
		t.Fatalf("output = %q", got.Output)
	}
}
