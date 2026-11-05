// Package split cuts one image along vertical and horizontal lines into a
// directory of tiles. Geometry is pure so the editor can count tiles while
// the user drags lines.
package split

import (
	"context"
	"errors"
	"fmt"
	"image"
	"os"
	"path/filepath"

	"github.com/disintegration/imaging"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/center"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// MaxTiles is the most tiles one image may produce.
const MaxTiles = 500

// Grid is a cutting plan in image pixels. X and Y hold the interior lines in
// increasing order; the image edges complete the grid.
type Grid struct {
	Width, Height int
	X, Y          []int
}

// Rows and Cols count the bands the lines make.
func (g Grid) Rows() int { return len(g.Y) + 1 }
func (g Grid) Cols() int { return len(g.X) + 1 }

// Tile is one band rectangle, with zero-based row and column.
type Tile struct {
	Row, Col int
	Rect     image.Rectangle
}

// Tiles enumerates the grid's tiles in row-major order.
func (g Grid) Tiles() []Tile {
	xs := append([]int{0}, g.X...)
	xs = append(xs, g.Width)
	ys := append([]int{0}, g.Y...)
	ys = append(ys, g.Height)
	tiles := make([]Tile, 0, g.Rows()*g.Cols())
	for r := 0; r < len(ys)-1; r++ {
		for c := 0; c < len(xs)-1; c++ {
			tiles = append(tiles, Tile{
				Row:  r,
				Col:  c,
				Rect: image.Rect(xs[c], ys[r], xs[c+1], ys[r+1]),
			})
		}
	}
	return tiles
}

// Validate reports the first reason the grid cannot be cut.
func (g Grid) Validate() error {
	if g.Width < 1 || g.Height < 1 {
		return errors.New("无法读取图像尺寸")
	}
	if err := checkLines(g.X, g.Width, "竖向"); err != nil {
		return err
	}
	if err := checkLines(g.Y, g.Height, "横向"); err != nil {
		return err
	}
	if n := g.Rows() * g.Cols(); n > MaxTiles {
		return fmt.Errorf("切片总数超限：最多 %d 张（当前 %d 张）", MaxTiles, n)
	}
	return nil
}

func checkLines(lines []int, size int, axis string) error {
	prev := 0
	for _, v := range lines {
		if v <= prev || v >= size {
			return fmt.Errorf("%s切割线必须严格递增且落在画面内", axis)
		}
		prev = v
	}
	return nil
}

// EqualDivide builds a grid with evenly spaced lines. When the image is
// smaller than the requested bands, duplicate positions collapse and the
// caller sees fewer rows or columns.
func EqualDivide(width, height, rows, cols int) (Grid, error) {
	if rows < 1 || cols < 1 {
		return Grid{}, errors.New("行列数必须不小于 1")
	}
	if rows > MaxTiles || cols > MaxTiles {
		return Grid{}, fmt.Errorf("切片总数超限：最多 %d 张", MaxTiles)
	}
	g := Grid{Width: width, Height: height}
	for i := 1; i < cols; i++ {
		g.X = appendUnique(g.X, width*i/cols)
	}
	for i := 1; i < rows; i++ {
		g.Y = appendUnique(g.Y, height*i/rows)
	}
	if err := g.Validate(); err != nil {
		return Grid{}, err
	}
	return g, nil
}

func appendUnique(lines []int, v int) []int {
	if v <= 0 {
		return lines
	}
	if n := len(lines); n > 0 && v <= lines[n-1] {
		return lines
	}
	return append(lines, v)
}

// Config is the operation input. Lines are interior cut positions in image
// pixels. Center re-centers each tile's subject, like the composition page.
type Config struct {
	Grid      Grid
	Center    bool
	Threshold int
	Sides     center.Sides
	Fill      ops.Fill
	Format    string
	Policy    output.Policy
}

// Run splits one file into a fresh directory named after it.
func Run(ctx context.Context, src string, cfg Config) ops.Result {
	src = filepath.Clean(src)
	srcExt := imageio.NormalizeExt(filepath.Ext(src))

	var inputSize int64
	if info, err := os.Stat(src); err == nil {
		inputSize = info.Size()
	}
	format, err := targetFormat(cfg.Format, srcExt)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}

	if err := ctx.Err(); err != nil {
		return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
	}
	img, err := imageio.DecodeFile(src)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: fmt.Sprintf("图片文件解析失败: %v", err), InputSize: inputSize}
	}
	b := img.Bounds()
	grid := cfg.Grid
	grid.Width, grid.Height = b.Dx(), b.Dy()
	if err := grid.Validate(); err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}

	dir, base, outExt, err := cfg.Policy.Target(src, format.Ext(), output.Split)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	if err := pipeline.EnsureDir(dir); err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: "创建输出文件夹失败: " + err.Error(), InputSize: inputSize}
	}
	outDir, err := pipeline.AllocateDir(filepath.Join(dir, base))
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: "创建输出文件夹失败: " + err.Error(), InputSize: inputSize}
	}

	tiles := grid.Tiles()
	var written int64
	for _, t := range tiles {
		if err := ctx.Err(); err != nil {
			_ = os.RemoveAll(outDir)
			return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
		}
		tile := imaging.Crop(img, image.Rect(
			b.Min.X+t.Rect.Min.X, b.Min.Y+t.Rect.Min.Y,
			b.Min.X+t.Rect.Max.X, b.Min.Y+t.Rect.Max.Y))
		if cfg.Center {
			if recentered, _, skip := center.Recenter(tile, cfg.Threshold, cfg.Sides, cfg.Fill); skip == "" {
				tile = recentered
			}
		}
		name := fmt.Sprintf("%s_r%02d_c%02d%s", base, t.Row+1, t.Col+1, outExt)
		size, err := writeTile(filepath.Join(outDir, name), tile, format)
		if err != nil {
			_ = os.RemoveAll(outDir)
			return ops.Result{Status: ops.StatusError, File: src, Reason: fmt.Sprintf("写入切片 %s 失败: %v", name, err), InputSize: inputSize}
		}
		written += size
	}

	reason := fmt.Sprintf("%d 行 × %d 列 · %d 片", grid.Rows(), grid.Cols(), len(tiles))
	if cfg.Center {
		reason += " · 每片居中"
	}
	return ops.Result{
		Status: ops.StatusSuccess, File: src, Output: outDir, Reason: reason,
		InputSize: inputSize, OutputSize: written,
	}
}

func writeTile(path string, img image.Image, format imageio.Format) (int64, error) {
	f, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	if err := imageio.Encode(f, img, format); err != nil {
		f.Close()
		return 0, err
	}
	if err := f.Close(); err != nil {
		return 0, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func targetFormat(choice, srcExt string) (imageio.Format, error) {
	if choice == "" || choice == "original" {
		return imageio.PreserveFormat(srcExt), nil
	}
	return imageio.ParseFormat(choice)
}

// RunAll splits paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
