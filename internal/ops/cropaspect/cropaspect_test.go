package cropaspect

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

func TestRatioSizeFitsInsideTheSource(t *testing.T) {
	cases := []struct {
		width, height, aw, ah, wantW, wantH int
	}{
		{1920, 1080, 1, 1, 1080, 1080},
		{1920, 1080, 16, 9, 1920, 1080},
		{4000, 3000, 16, 9, 4000, 2250},
		{800, 800, 4, 5, 640, 800},
		{100, 80, 3, 2, 100, 67},
	}
	for _, c := range cases {
		w, h := RatioSize(c.width, c.height, c.aw, c.ah)
		if w != c.wantW || h != c.wantH {
			t.Errorf("RatioSize(%d×%d, %d:%d) = %d×%d, want %d×%d",
				c.width, c.height, c.aw, c.ah, w, h, c.wantW, c.wantH)
		}
	}
}

func TestFrameSizeScalesTheLargestRatioRect(t *testing.T) {
	cases := []struct {
		width, height, aw, ah int
		scale                 float64
		wantW, wantH          int
	}{
		{300, 200, 1, 1, 0.25, 50, 50},
		{1920, 1080, 16, 9, 0.5, 960, 540},
		{1920, 1080, 1, 1, 1, 1080, 1080},
		{1920, 1080, 1, 1, 0, 1080, 1080},
		{1920, 1080, 1, 1, 1.5, 1080, 1080},
	}
	for _, c := range cases {
		w, h := FrameSize(c.width, c.height, c.aw, c.ah, c.scale)
		if w != c.wantW || h != c.wantH {
			t.Errorf("FrameSize(%d×%d, %d:%d, %v) = %d×%d, want %d×%d",
				c.width, c.height, c.aw, c.ah, c.scale, w, h, c.wantW, c.wantH)
		}
	}
}

func TestLongEdgeSizeKeepsTheRatio(t *testing.T) {
	if w, h := LongEdgeSize(1080, 1080, 512); w != 512 || h != 512 {
		t.Errorf("square = %d×%d, want 512×512", w, h)
	}
	if w, h := LongEdgeSize(1920, 1080, 960); w != 960 || h != 540 {
		t.Errorf("landscape = %d×%d, want 960×540", w, h)
	}
	if w, h := LongEdgeSize(900, 1600, 800); w != 450 || h != 800 {
		t.Errorf("portrait = %d×%d, want 450×800", w, h)
	}
}

func TestRectAtSlidesBackInside(t *testing.T) {
	bounds := image.Rect(0, 0, 300, 200)
	if got := RectAt(bounds, 200, 200, 0.5, 0.5); got != image.Rect(50, 0, 250, 200) {
		t.Errorf("centred rect = %v", got)
	}
	// A subject near the left edge cannot be centred; the crop stays inside.
	if got := RectAt(bounds, 200, 200, 0.1, 0.5); got != image.Rect(0, 0, 200, 200) {
		t.Errorf("clamped rect = %v", got)
	}
}

// writeSubject draws a 300×200 white frame with a black subject against the
// left edge, so the frame centre and the subject centre land on different
// pixels.
func writeSubject(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "photo.png")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 300, 200))
	for y := 0; y < 200; y++ {
		for x := 0; x < 300; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 70; y < 130; y++ {
		for x := 0; x < 60; x++ {
			img.SetNRGBA(x, y, color.NRGBA{A: 255})
		}
	}
	if err := imageio.Encode(f, img, imageio.PNG); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRunCropsToRatioAndKeepsDensity(t *testing.T) {
	src := writeSubject(t)
	got := Run(context.Background(), src, Config{AspectW: 1, AspectH: 1, CenterX: 0.5, CenterY: 0.5, Format: "original"})
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
	// Centred on the frame, the crop starts at x=50 and misses the subject.
	if r, _, _, _ := img.At(30, 100).RGBA(); r < 0xf000 {
		t.Fatalf("frame-centred crop took the subject pixel at 30,100")
	}
	if got.Reason != "裁成 1:1" {
		t.Fatalf("reason = %q", got.Reason)
	}
}

func TestRunKeepsTheChosenCentre(t *testing.T) {
	src := writeSubject(t)
	got := Run(context.Background(), src, Config{AspectW: 1, AspectH: 1, CenterX: 0.1, CenterY: 0.5, Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	// A centre at x=0.1 of 300 puts the 200px crop at x=0, over the subject.
	if r, _, _, _ := img.At(30, 100).RGBA(); r > 0x0f00 {
		t.Fatalf("centre-anchored crop missed the subject pixel at 30,100")
	}
}

func TestRunScalesToTheLongEdge(t *testing.T) {
	src := writeSubject(t)
	got := Run(context.Background(), src, Config{
		AspectW: 1, AspectH: 1, Resize: true, LongEdge: 64,
		CenterX: 0.5, CenterY: 0.5, Format: "original",
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 64 || b.Dy() != 64 {
		t.Fatalf("bounds = %dx%d, want 64x64", b.Dx(), b.Dy())
	}
}

// TestRunCutsOneCellOutOfASheet is the contact-sheet case: a quarter-size
// frame, away from the subject, scaled down to an exact output edge.
func TestRunCutsOneCellOutOfASheet(t *testing.T) {
	src := writeSubject(t)
	cfg := Config{
		AspectW: 1, AspectH: 1, Scale: 0.25, Resize: true, LongEdge: 32,
		CenterX: 0.4, CenterY: 0.5, Format: "original",
	}
	got := Run(context.Background(), src, cfg)
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	img, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 32 || b.Dy() != 32 {
		t.Fatalf("bounds = %dx%d, want 32x32", b.Dx(), b.Dy())
	}
	// The 50px frame sits at x=95..145, right of the black subject at x<60.
	if r, _, _, _ := img.At(2, 16).RGBA(); r < 0xf000 {
		t.Fatal("the quarter frame reached the subject outside its cell")
	}
	if w, h, err := OutputSize(300, 200, cfg); err != nil || w != 32 || h != 32 {
		t.Fatalf("OutputSize = %d×%d, %v; want 32×32", w, h, err)
	}
}

func TestOutputSizeMatchesRun(t *testing.T) {
	if w, h, err := OutputSize(1920, 1080, Config{AspectW: 4, AspectH: 5}); err != nil || w != 864 || h != 1080 {
		t.Fatalf("OutputSize = %d×%d, %v; want 864×1080", w, h, err)
	}
	if w, h, err := OutputSize(1920, 1080, Config{AspectW: 1, AspectH: 1, Resize: true, LongEdge: 512}); err != nil || w != 512 || h != 512 {
		t.Fatalf("OutputSize = %d×%d, %v; want 512×512", w, h, err)
	}
	if w, h, err := OutputSize(1920, 1080, Config{AspectW: 16, AspectH: 9, Resize: true, LongEdge: 1280}); err != nil || w != 1280 || h != 720 {
		t.Fatalf("OutputSize = %d×%d, %v; want 1280×720", w, h, err)
	}
	if w, h, err := OutputSize(1920, 1080, Config{AspectW: 1, AspectH: 1, Scale: 0.5}); err != nil || w != 540 || h != 540 {
		t.Fatalf("OutputSize with scale = %d×%d, %v; want 540×540", w, h, err)
	}
	if _, _, err := OutputSize(1920, 1080, Config{AspectW: 1, AspectH: 1, Scale: 1.5}); err == nil {
		t.Fatal("a scale above 100% must be rejected")
	}
	if _, _, err := OutputSize(1920, 1080, Config{AspectW: 0, AspectH: 1}); err == nil {
		t.Fatal("a zero ratio must be rejected")
	}
}
