package split

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

func TestEqualDivideBuildsEvenLines(t *testing.T) {
	g, err := EqualDivide(100, 60, 3, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.X) != 1 || g.X[0] != 50 {
		t.Fatalf("x lines = %v, want [50]", g.X)
	}
	if len(g.Y) != 2 || g.Y[0] != 20 || g.Y[1] != 40 {
		t.Fatalf("y lines = %v, want [20 40]", g.Y)
	}
	if g.Rows() != 3 || g.Cols() != 2 || len(g.Tiles()) != 6 {
		t.Fatalf("rows=%d cols=%d tiles=%d", g.Rows(), g.Cols(), len(g.Tiles()))
	}
}

func TestEqualDivideCollapsesTinyImage(t *testing.T) {
	g, err := EqualDivide(2, 2, 5, 5)
	if err != nil {
		t.Fatal(err)
	}
	if g.Rows() != 2 || g.Cols() != 2 {
		t.Fatalf("rows=%d cols=%d, want 2x2 after collapsing duplicates", g.Rows(), g.Cols())
	}
}

func TestValidateRejectsUnsortedAndOutOfRangeLines(t *testing.T) {
	grid := Grid{Width: 100, Height: 100, X: []int{60, 40}}
	if err := grid.Validate(); err == nil {
		t.Fatal("unsorted lines accepted")
	}
	grid = Grid{Width: 100, Height: 100, Y: []int{0}}
	if err := grid.Validate(); err == nil {
		t.Fatal("line on the edge accepted")
	}
}

func TestValidateRejectsTooManyTiles(t *testing.T) {
	grid := Grid{Width: 1000, Height: 1000}
	for i := 1; i <= 501; i++ {
		grid.Y = append(grid.Y, i*2)
	}
	if err := grid.Validate(); err == nil {
		t.Fatal("501 tiles accepted")
	}
}

func writeImage(t *testing.T, dir string, w, h int) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
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

func TestRunWritesTilesIntoNewFolder(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, 100, 60)

	got := Run(context.Background(), src, Config{
		Grid:   Grid{X: []int{30, 70}, Y: []int{20}},
		Format: "original",
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if got.Reason != "2 行 × 3 列 · 6 片" {
		t.Fatalf("reason = %q", got.Reason)
	}
	if filepath.Base(got.Output) != "photo" || filepath.Dir(got.Output) != dir {
		t.Fatalf("output dir = %q", got.Output)
	}
	sizes := map[string][2]int{
		"photo_r01_c01.png": {30, 20},
		"photo_r01_c02.png": {40, 20},
		"photo_r01_c03.png": {30, 20},
		"photo_r02_c01.png": {30, 40},
		"photo_r02_c02.png": {40, 40},
		"photo_r02_c03.png": {30, 40},
	}
	for name, want := range sizes {
		img, err := imageio.DecodeFile(filepath.Join(got.Output, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if b := img.Bounds(); b.Dx() != want[0] || b.Dy() != want[1] {
			t.Fatalf("%s = %dx%d, want %dx%d", name, b.Dx(), b.Dy(), want[0], want[1])
		}
	}
}

func TestRunUsesSubfolderAndSuffixFreeName(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, 40, 40)

	got := Run(context.Background(), src, Config{
		Grid:   Grid{X: []int{20}, Y: []int{20}},
		Format: "original",
		Policy: output.Policy{Location: settings.Subfolder},
	})
	if got.Status != ops.StatusSuccess {
		t.Fatalf("status = %q (%s)", got.Status, got.Reason)
	}
	if filepath.Dir(got.Output) != filepath.Join(dir, "split") {
		t.Fatalf("output dir = %q", got.Output)
	}
}

func TestRunCancelsAndRemovesFolder(t *testing.T) {
	dir := t.TempDir()
	src := writeImage(t, dir, 100, 100)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	got := Run(ctx, src, Config{Grid: Grid{X: []int{50}, Y: []int{50}}, Format: "original"})
	if got.Status != ops.StatusCanceled {
		t.Fatalf("status = %q (%s), want canceled", got.Status, got.Reason)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("leftover output after cancel: %v", entries)
	}
}
