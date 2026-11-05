// Package center balances the empty margins around an image's subject without
// changing the canvas size. The subject is whatever the trim detector keeps.
package center

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"os"
	"path/filepath"
	"strings"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// Sides selects which axes are re-centered. The other axis keeps the subject
// where it was.
type Sides string

// Sides presets offered by the UI.
const (
	All       Sides = "all"
	TopBottom Sides = "top_bottom"
	LeftRight Sides = "left_right"
)

// Config is the operation input. Threshold is the color tolerance (1-100).
// Format is "original" or an imageio format name.
type Config struct {
	Threshold int
	Sides     Sides
	Fill      ops.Fill
	Format    string
	Policy    output.Policy
}

// Run centers one file. The canvas keeps its original size; only the margins
// move.
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

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	canvas, noteText, skip := Recenter(img, cfg.Threshold, cfg.Sides, cfg.Fill)
	if canvas == nil {
		return ops.Result{Status: ops.StatusSkipped, File: src, Reason: skip, InputSize: inputSize}
	}

	dir, base, outExt, err := cfg.Policy.Target(src, format.Ext(), output.Center)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	out, outSize, err := pipeline.Emit(ctx, dir, base, outExt, canvas, format)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
		}
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	return ops.Result{
		Status: ops.StatusSuccess, File: src, Output: out,
		Reason: noteText, InputSize: inputSize, OutputSize: outSize,
		Width: w, Height: h,
	}
}

// Recenter returns a canvas of the image's size with its subject centered on
// the chosen axes, plus the resulting margins. It returns a nil canvas and
// the reason when nothing would move, which is also how the split operation
// decides to keep a tile unchanged.
func Recenter(img image.Image, threshold int, sides Sides, fill ops.Fill) (canvas *image.NRGBA, noteText, skip string) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	cuts := trim.Detect(img, threshold)
	contentW := w - cuts.Left - cuts.Right
	contentH := h - cuts.Top - cuts.Bottom
	if cuts.Empty() {
		return nil, "", "画面没有可调整的留白"
	}

	left, top := cuts.Left, cuts.Top
	if sides == All || sides == LeftRight {
		left = (w - contentW) / 2
	}
	if sides == All || sides == TopBottom {
		top = (h - contentH) / 2
	}
	if left == cuts.Left && top == cuts.Top {
		return nil, "", "主体已经居中，无需调整"
	}

	canvas = image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: fill.Color(img)}, image.Point{}, draw.Src)
	srcRect := image.Rect(b.Min.X+cuts.Left, b.Min.Y+cuts.Top,
		b.Min.X+cuts.Left+contentW, b.Min.Y+cuts.Top+contentH)
	draw.Draw(canvas, image.Rect(left, top, left+contentW, top+contentH), img, srcRect.Min, draw.Over)
	return canvas, note(cuts, left, w-left-contentW, top, h-top-contentH, sides), ""
}

// note describes the resulting margins for the axes that moved.
func note(cuts trim.Cuts, left, right, top, bottom int, sides Sides) string {
	var parts []string
	if (sides == All || sides == LeftRight) && left != cuts.Left {
		parts = append(parts, pair("左右", left, right))
	}
	if (sides == All || sides == TopBottom) && top != cuts.Top {
		parts = append(parts, pair("上下", top, bottom))
	}
	return strings.Join(parts, " · ")
}

func pair(label string, a, b int) string {
	if a == b {
		return fmt.Sprintf("%s各 %d", label, a)
	}
	return fmt.Sprintf("%s %d / %d", label, a, b)
}

func targetFormat(choice, srcExt string) (imageio.Format, error) {
	if choice == "" || choice == "original" {
		return imageio.PreserveFormat(srcExt), nil
	}
	return imageio.ParseFormat(choice)
}

// RunAll centers paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
