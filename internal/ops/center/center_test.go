package center

import (
	"context"
	"image"
	"image/color"
	"image/draw"
	"os"
	"path/filepath"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func writeSubject(t *testing.T, dir string, w, h int, subject image.Rectangle) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(img, subject, &image.Uniform{C: color.Black}, image.Point{}, draw.Src)
	path := filepath.Join(dir, "photo.png")
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

func TestCenterBalancesHorizontalMargins(t *testing.T) {
	dir := t.TempDir()
	src := writeSubject(t, dir, 60, 40, image.Rect(20, 10, 55, 30))

	got := Run(context.Background(), src, Config{Threshold: 10, Sides: All, Fill: ops.FillAuto, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if got.Reason != "左右 12 / 13" {
		t.Fatalf("reason = %q", got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 60 || b.Dy() != 40 {
		t.Fatalf("bounds = %dx%d, want 60x40", b.Dx(), b.Dy())
	}
	assertPixel := func(x, y int, wantBlack bool) {
		t.Helper()
		r, _, _, _ := img.At(x, y).RGBA()
		if black := r < 0x8000; black != wantBlack {
			t.Fatalf("pixel (%d,%d) black=%v, want %v", x, y, black, wantBlack)
		}
	}
	assertPixel(11, 20, false)
	assertPixel(12, 20, true)
	assertPixel(46, 20, true)
	assertPixel(47, 20, false)
}

func TestCenterSkipsAlreadyCentered(t *testing.T) {
	dir := t.TempDir()
	src := writeSubject(t, dir, 60, 40, image.Rect(10, 10, 50, 30))

	got := Run(context.Background(), src, Config{Threshold: 10, Sides: All, Format: "original"})
	if got.Status != ops.StatusSkipped {
		t.Fatalf("status = %q (%s), want skipped", got.Status, got.Reason)
	}
}

func TestCenterHorizontalKeepsVerticalPosition(t *testing.T) {
	dir := t.TempDir()
	src := writeSubject(t, dir, 60, 40, image.Rect(20, 2, 55, 22))

	got := Run(context.Background(), src, Config{Threshold: 10, Sides: LeftRight, Fill: ops.FillAuto, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	r, _, _, _ := img.At(12, 2).RGBA()
	if r >= 0x8000 {
		t.Fatal("subject did not move horizontally")
	}
	r, _, _, _ = img.At(12, 21).RGBA()
	if r >= 0x8000 {
		t.Fatal("subject moved vertically although only left/right was selected")
	}
}

func TestCenterUsesOperationSubfolderAndSuffix(t *testing.T) {
	dir := t.TempDir()
	src := writeSubject(t, dir, 60, 40, image.Rect(20, 10, 55, 30))

	got := Run(context.Background(), src, Config{
		Threshold: 10, Sides: All, Format: "original",
		Policy: output.Policy{Location: settings.Subfolder},
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Dir(got.Output) != filepath.Join(dir, "centered") {
		t.Fatalf("output dir = %q", filepath.Dir(got.Output))
	}
	if filepath.Base(got.Output) != "photo_centered.png" {
		t.Fatalf("output = %q", got.Output)
	}
}
