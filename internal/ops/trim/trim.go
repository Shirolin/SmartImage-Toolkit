// Package trim removes uniform borders from images. It detects the border
// color from the top-left pixel, measures how far each side matches it, and
// applies only the sides the user allowed.
package trim

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// Sides selects which detected edges may be cut.
type Sides string

// Side presets offered by the UI.
const (
	All       Sides = "all"
	Bottom    Sides = "bottom"
	TopBottom Sides = "top_bottom"
	LeftRight Sides = "left_right"
)

// Config is the operation input. Threshold is the color tolerance (1-100).
// Format is "original" or an imageio format name.
type Config struct {
	Threshold int
	Sides     Sides
	Format    string
	Policy    output.Policy
}

// Cuts is the number of pixels detected on each side.
type Cuts struct {
	Top, Bottom, Left, Right int
}

// Empty reports whether no side was cut.
func (c Cuts) Empty() bool {
	return c.Top == 0 && c.Bottom == 0 && c.Left == 0 && c.Right == 0
}

// Note describes the applied cuts for the result row.
func (c Cuts) Note() string {
	parts := make([]string, 0, 4)
	if c.Top > 0 {
		parts = append(parts, fmt.Sprintf("上 %d", c.Top))
	}
	if c.Bottom > 0 {
		parts = append(parts, fmt.Sprintf("下 %d", c.Bottom))
	}
	if c.Left > 0 {
		parts = append(parts, fmt.Sprintf("左 %d", c.Left))
	}
	if c.Right > 0 {
		parts = append(parts, fmt.Sprintf("右 %d", c.Right))
	}
	if len(parts) == 0 {
		return ""
	}
	return "去除 " + strings.Join(parts, " · ")
}

// Detect measures the uniform border. The top-left pixel is the reference.
// For a fully uniform image it leaves a 1px core instead of consuming the
// whole image.
func Detect(img image.Image, threshold int) Cuts {
	if threshold < 1 {
		threshold = 1
	}
	if threshold > 100 {
		threshold = 100
	}
	nrgba := toNRGBA(img)
	b := nrgba.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return Cuts{}
	}

	bg := nrgba.NRGBAAt(b.Min.X, b.Min.Y)
	tol := int(math.Round(float64(threshold) * 2.55))
	tol = max(tol, 1)
	pix := nrgba.Pix
	stride := nrgba.Stride

	similar := func(offset int) bool {
		r, g, bl, a := int(pix[offset]), int(pix[offset+1]), int(pix[offset+2]), int(pix[offset+3])
		return abs(r-int(bg.R)) <= tol &&
			abs(g-int(bg.G)) <= tol &&
			abs(bl-int(bg.B)) <= tol &&
			abs(a-int(bg.A)) <= tol
	}

	rowSimilar := func(y int) bool {
		base := y * stride
		for x := 0; x < w; x++ {
			if !similar(base + x*4) {
				return false
			}
		}
		return true
	}
	colSimilar := func(x int) bool {
		for y := 0; y < h; y++ {
			if !similar(y*stride + x*4) {
				return false
			}
		}
		return true
	}

	var c Cuts
	for c.Top < h-1 && rowSimilar(c.Top) {
		c.Top++
	}
	for c.Bottom < h-1-c.Top && rowSimilar(h-1-c.Bottom) {
		c.Bottom++
	}
	for c.Left < w-1 && colSimilar(c.Left) {
		c.Left++
	}
	for c.Right < w-1-c.Left && colSimilar(w-1-c.Right) {
		c.Right++
	}
	// A fully uniform image would otherwise shrink to a 1px core; treat it as
	// having nothing to trim.
	if c.Top == h-1 && c.Left == w-1 && similar((h-1)*stride+(w-1)*4) {
		return Cuts{}
	}
	return c
}

func toNRGBA(img image.Image) *image.NRGBA {
	if n, ok := img.(*image.NRGBA); ok && n.Bounds().Min == (image.Point{}) {
		return n
	}
	b := img.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	return dst
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func applySides(c Cuts, sides Sides) Cuts {
	switch sides {
	case Bottom:
		return Cuts{Bottom: c.Bottom}
	case TopBottom:
		return Cuts{Top: c.Top, Bottom: c.Bottom}
	case LeftRight:
		return Cuts{Left: c.Left, Right: c.Right}
	default:
		return c
	}
}

// Run trims one file. The output location and name come from the policy.
func Run(ctx context.Context, src string, cfg Config) ops.Result {
	src = filepath.Clean(src)
	srcExt := imageio.NormalizeExt(filepath.Ext(src))

	var inputSize int64
	if info, err := os.Stat(src); err == nil {
		inputSize = info.Size()
	}
	if cfg.Threshold < 1 || cfg.Threshold > 100 {
		return ops.Result{Status: ops.StatusError, File: src, Reason: "色差容忍度必须在 1-100 之间", InputSize: inputSize}
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

	cuts := applySides(Detect(img, cfg.Threshold), cfg.Sides)
	if cuts.Empty() {
		return ops.Result{
			Status: ops.StatusSkipped, File: src,
			Reason: "没有检测到可去除的边缘", InputSize: inputSize,
		}
	}

	b := img.Bounds()
	newW := b.Dx() - cuts.Left - cuts.Right
	newH := b.Dy() - cuts.Top - cuts.Bottom
	if newW <= 0 || newH <= 0 {
		return ops.Result{Status: ops.StatusError, File: src, Reason: "容差计算结果为空或越界", InputSize: inputSize}
	}
	outImg := imaging.Crop(img, image.Rect(
		b.Min.X+cuts.Left, b.Min.Y+cuts.Top,
		b.Min.X+b.Dx()-cuts.Right, b.Min.Y+b.Dy()-cuts.Bottom))

	dir, base, outExt, err := cfg.Policy.Target(src, format.Ext(), output.Trim)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	out, outSize, err := pipeline.Emit(ctx, dir, base, outExt, outImg, format)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
		}
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	return ops.Result{
		Status: ops.StatusSuccess, File: src, Output: out,
		Reason: cuts.Note(), InputSize: inputSize, OutputSize: outSize,
		Width: newW, Height: newH,
	}
}

func targetFormat(choice, srcExt string) (imageio.Format, error) {
	if choice == "" || choice == "original" {
		return imageio.PreserveFormat(srcExt), nil
	}
	return imageio.ParseFormat(choice)
}

// RunAll trims paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
