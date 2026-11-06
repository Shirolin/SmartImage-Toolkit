package matting

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
)

func TestTargetFormatKeepsAlpha(t *testing.T) {
	cases := []struct {
		choice string
		srcExt string
		want   imageio.Format
		note   bool
	}{
		{"", ".png", imageio.PNG, false},
		{"", ".webp", imageio.WebP, false},
		{"", ".avif", imageio.AVIF, false},
		{"", ".jpg", imageio.PNG, false},
		{"original", ".jpeg", imageio.PNG, false},
		{"webp", ".png", imageio.WebP, false},
		{"avif", ".png", imageio.AVIF, false},
		{"mozjpeg", ".png", imageio.PNG, true},
	}
	for _, c := range cases {
		got, note, err := targetFormat(c.choice, c.srcExt)
		if err != nil {
			t.Fatalf("%q/%q: %v", c.choice, c.srcExt, err)
		}
		if got != c.want || (note != "") != c.note {
			t.Fatalf("%q/%q = %v note=%q, want %v note=%v", c.choice, c.srcExt, got, note, c.want, c.note)
		}
	}
	if _, _, err := targetFormat("bmp", ".png"); err == nil {
		t.Fatal("an unknown format was accepted")
	}
}

func TestFeatherAlphaOnlyTouchesAlpha(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 9, 9))
	img.SetNRGBA(4, 4, color.NRGBA{R: 200, G: 10, B: 20, A: 255})

	featherAlpha(img, 1)

	if got := img.NRGBAAt(4, 4); got.A != 28 || got.R != 200 || got.G != 10 || got.B != 20 {
		t.Fatalf("center = %+v, want alpha 28 and untouched RGB", got)
	}
	if got := img.NRGBAAt(0, 0); got.A != 0 {
		t.Fatalf("corner alpha = %d, want 0", got.A)
	}
}

func TestStartEngineRejectsMissingPaths(t *testing.T) {
	if _, err := StartEngine("", "model.onnx"); err == nil {
		t.Fatal("empty worker path was accepted")
	}
	if _, err := StartEngine("worker.exe", ""); err == nil {
		t.Fatal("empty model path was accepted")
	}
}

// TestRunWithRealModel is opt-in: it needs the built worker and a model.
// SMARTIMAGE_MATTING_WORKER and SMARTIMAGE_MATTING_MODEL select them.
func TestRunWithRealModel(t *testing.T) {
	workerPath := os.Getenv("SMARTIMAGE_MATTING_WORKER")
	modelPath := os.Getenv("SMARTIMAGE_MATTING_MODEL")
	if workerPath == "" || modelPath == "" {
		t.Skip("set SMARTIMAGE_MATTING_WORKER and SMARTIMAGE_MATTING_MODEL to run")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "shape.png")
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := 8; y < 56; y++ {
		for x := 8; x < 56; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 220, G: 40, B: 40, A: 255})
		}
	}
	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()

	engine, err := StartEngine(workerPath, modelPath)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()

	got := RunWith(context.Background(), engine, src, Config{Format: "original"})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Base(got.Output) != "shape_nobg.png" {
		t.Fatalf("output = %q", got.Output)
	}
	out, err := imageio.DecodeFile(got.Output)
	if err != nil {
		t.Fatal(err)
	}
	if b := out.Bounds(); b.Dx() != 64 || b.Dy() != 64 {
		t.Fatalf("output size = %dx%d, want 64x64", b.Dx(), b.Dy())
	}
	if _, ok := out.(*image.NRGBA); !ok {
		t.Fatalf("output type = %T, want *image.NRGBA", out)
	}
}
