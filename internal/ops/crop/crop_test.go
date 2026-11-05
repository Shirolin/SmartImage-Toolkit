package crop

import (
	"context"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
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
			img.SetNRGBA(x, y, color.NRGBA{R: 20, G: 120, B: 200, A: 255})
		}
	}
	if err := imageio.Encode(f, img, imageio.PNG); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCropRemovesEachSide(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 100, 80)

	got := Run(context.Background(), src, Config{Top: 10, Bottom: 20, Left: 5, Right: 25, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 70 || b.Dy() != 50 {
		t.Fatalf("bounds = %dx%d, want 70x50", b.Dx(), b.Dy())
	}
	if got.Reason != "裁去 上 10 · 下 20 · 左 5 · 右 25" {
		t.Fatalf("reason = %q", got.Reason)
	}
}

func TestCropRejectsEmptyAndOversized(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 100, 80)

	if got := Run(context.Background(), src, Config{Format: "original"}); got.Status != ops.StatusError {
		t.Fatalf("empty crop status = %q, want error", got.Status)
	}
	if got := Run(context.Background(), src, Config{Left: 80, Right: 30, Format: "original"}); got.Status != ops.StatusError {
		t.Fatalf("oversized crop status = %q, want error", got.Status)
	}
}

func TestCropWritesToOperationSubfolder(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, "photo.png", 100, 80)

	got := Run(context.Background(), src, Config{
		Top: 10, Format: "original",
		Policy: output.Policy{Location: settings.Subfolder},
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Dir(got.Output) != filepath.Join(dir, "cropped") {
		t.Fatalf("output dir = %q, want cropped", filepath.Dir(got.Output))
	}
}
