package padaspect

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

func writeImage(t *testing.T, dir string, w, h int) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(0, 0, w/2, h), &image.Uniform{C: color.Black}, image.Point{}, draw.Src)
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

func TestCanvasSizeFollowsLongEdge(t *testing.T) {
	w, h, err := CanvasSize(Config{AspectW: 16, AspectH: 9, LongEdge: 1920, SubjectRatio: 60})
	if err != nil {
		t.Fatal(err)
	}
	if w != 1920 || h != 1080 {
		t.Fatalf("canvas = %dx%d, want 1920x1080", w, h)
	}

	w, h, err = CanvasSize(Config{AspectW: 9, AspectH: 16, LongEdge: 1920, SubjectRatio: 60})
	if err != nil {
		t.Fatal(err)
	}
	if w != 1080 || h != 1920 {
		t.Fatalf("canvas = %dx%d, want 1080x1920", w, h)
	}
}

func TestCanvasSizeRejectsOutOfRangeRatio(t *testing.T) {
	if _, _, err := CanvasSize(Config{AspectW: 1, AspectH: 1, LongEdge: 1000, SubjectRatio: 90}); err == nil {
		t.Fatal("ratio 90 accepted, want error")
	}
}

func TestRunCentersSubjectOnCanvas(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, 100, 50)

	got := Run(context.Background(), src, Config{
		AspectW: 1, AspectH: 1, LongEdge: 200, SubjectRatio: 60,
		Subject: Full, Fill: ops.FillWhite, Format: "original",
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 200 || b.Dy() != 200 {
		t.Fatalf("bounds = %dx%d, want 200x200", b.Dx(), b.Dy())
	}
	// 100x50 at 60% of 200 is 120 high and 240 wide, so the 95% width cap
	// applies: 190x95 centered at (5,52).
	for _, p := range []struct{ x, y int }{{5, 52}, {99, 146}} {
		r, _, _, _ := img.At(p.x, p.y).RGBA()
		if r >= 0x8000 {
			t.Fatalf("subject missing at (%d,%d)", p.x, p.y)
		}
	}
	for _, p := range []struct{ x, y int }{{4, 52}, {195, 146}, {100, 20}} {
		r, _, _, _ := img.At(p.x, p.y).RGBA()
		if r < 0x8000 {
			t.Fatalf("margin not white at (%d,%d)", p.x, p.y)
		}
	}
}

func TestRunTrimSubjectUsesDetectedBox(t *testing.T) {
	dir := t.TempDir()
	img := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(20, 20, 80, 60), &image.Uniform{C: color.Black}, image.Point{}, draw.Src)
	src := filepath.Join(dir, "padded.png")
	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := imageio.Encode(f, img, imageio.PNG); err != nil {
		t.Fatal(err)
	}
	f.Close()

	got := Run(context.Background(), src, Config{
		AspectW: 1, AspectH: 1, LongEdge: 300, SubjectRatio: 50,
		Subject: Trim, Threshold: 10, Fill: ops.FillWhite, Format: "original",
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	// The 60x40 subject at 50% of 300 is 150 high, beyond the 95% width cap,
	// so it lands at 285x190.
	if got.Width != 300 || got.Height != 300 {
		t.Fatalf("result = %dx%d", got.Width, got.Height)
	}
}

func TestRunUsesOperationSubfolderAndSuffix(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, 100, 50)

	got := Run(context.Background(), src, Config{
		AspectW: 16, AspectH: 9, LongEdge: 160, SubjectRatio: 60,
		Subject: Full, Format: "original",
		Policy: output.Policy{Location: settings.Subfolder},
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Dir(got.Output) != filepath.Join(dir, "pad-aspect") {
		t.Fatalf("output dir = %q", filepath.Dir(got.Output))
	}
	if filepath.Base(got.Output) != "photo_pad.png" {
		t.Fatalf("output = %q", got.Output)
	}
}
