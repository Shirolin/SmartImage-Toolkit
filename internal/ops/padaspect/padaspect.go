// Package padaspect rebuilds an image on a canvas of another aspect ratio:
// the subject is scaled to a share of the canvas and centered with even
// margins on all sides.
package padaspect

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"math"
	"os"
	"path/filepath"

	"github.com/disintegration/imaging"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// MaxDim bounds the canvas long edge, matching resize's limit.
const MaxDim = 30000

// SubjectMode selects what counts as the subject placed on the canvas.
type SubjectMode string

// Subject modes offered by the UI.
const (
	Full SubjectMode = "full"
	Trim SubjectMode = "trim"
)

// Config is the operation input. SubjectRatio is a percentage (40-80).
// Threshold applies only when Subject is Trim. Format is "original" or an
// imageio format name.
type Config struct {
	AspectW, AspectH int
	LongEdge         int
	SubjectRatio     int
	Subject          SubjectMode
	Threshold        int
	Fill             ops.Fill
	Format           string
	Policy           output.Policy
}

// CanvasSize returns the target canvas for the configured aspect and long
// edge. Both sides are even so encoders keep chroma alignment.
func CanvasSize(cfg Config) (w, h int, err error) {
	if cfg.AspectW < 1 || cfg.AspectH < 1 {
		return 0, 0, errors.New("目标比例必须是两个正整数")
	}
	if cfg.LongEdge < 1 || cfg.LongEdge > MaxDim {
		return 0, 0, fmt.Errorf("画布长边必须在 1-%d 之间", MaxDim)
	}
	if cfg.SubjectRatio < 40 || cfg.SubjectRatio > 80 {
		return 0, 0, errors.New("主体占比必须在 40%-80% 之间")
	}
	if cfg.AspectW >= cfg.AspectH {
		w = cfg.LongEdge
		h = int(math.Round(float64(cfg.LongEdge) * float64(cfg.AspectH) / float64(cfg.AspectW)))
	} else {
		h = cfg.LongEdge
		w = int(math.Round(float64(cfg.LongEdge) * float64(cfg.AspectW) / float64(cfg.AspectH)))
	}
	if w < 1 || h < 1 {
		return 0, 0, errors.New("目标画布尺寸过小，请调整比例或长边")
	}
	w -= w % 2
	h -= h % 2
	if w > MaxDim || h > MaxDim {
		return 0, 0, fmt.Errorf("目标画布超限: %dx%d，单边最大 %dpx", w, h, MaxDim)
	}
	return w, h, nil
}

// Run pads one file onto the configured canvas.
func Run(ctx context.Context, src string, cfg Config) ops.Result {
	src = filepath.Clean(src)
	srcExt := imageio.NormalizeExt(filepath.Ext(src))

	var inputSize int64
	if info, err := os.Stat(src); err == nil {
		inputSize = info.Size()
	}
	canvasW, canvasH, err := CanvasSize(cfg)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	if cfg.Subject == Trim && (cfg.Threshold < 1 || cfg.Threshold > 100) {
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

	subject, err := subjectImage(img, cfg)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	rawW, rawH := subject.Bounds().Dx(), subject.Bounds().Dy()

	// The subject keeps its ratio: it fills the configured share of the canvas
	// height unless that would push it past 95% of the canvas width.
	ratio := float64(cfg.SubjectRatio) / 100
	scale := float64(canvasH) * ratio / float64(rawH)
	if maxW := float64(canvasW) * 0.95; float64(rawW)*scale > maxW {
		scale = maxW / float64(rawW)
	}
	sw := max(1, int(math.Round(float64(rawW)*scale)))
	sh := max(1, int(math.Round(float64(rawH)*scale)))
	scaled := imaging.Resize(subject, sw, sh, imaging.Lanczos)

	canvas := image.NewNRGBA(image.Rect(0, 0, canvasW, canvasH))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: cfg.Fill.Color(img)}, image.Point{}, draw.Src)
	left := (canvasW - sw) / 2
	top := (canvasH - sh) / 2
	draw.Draw(canvas, image.Rect(left, top, left+sw, top+sh), scaled, scaled.Bounds().Min, draw.Over)

	dir, base, outExt, err := cfg.Policy.Target(src, format.Ext(), output.Pad)
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
		Reason:    fmt.Sprintf("%d:%d 画布 · 主体 %d%%", cfg.AspectW, cfg.AspectH, cfg.SubjectRatio),
		InputSize: inputSize, OutputSize: outSize,
		Width: canvasW, Height: canvasH,
	}
}

// subjectImage returns the trimmed subject or the whole image. The result may
// share bounds with img; callers only read it.
func subjectImage(img image.Image, cfg Config) (image.Image, error) {
	b := img.Bounds()
	if cfg.Subject != Trim {
		return img, nil
	}
	cuts := trim.Detect(img, cfg.Threshold)
	w := b.Dx() - cuts.Left - cuts.Right
	h := b.Dy() - cuts.Top - cuts.Bottom
	if w < 1 || h < 1 {
		return nil, errors.New("主体探测结果为空，请增大容差或改用整图模式")
	}
	if cuts.Empty() {
		return img, nil
	}
	return imaging.Crop(img, image.Rect(
		b.Min.X+cuts.Left, b.Min.Y+cuts.Top,
		b.Min.X+cuts.Left+w, b.Min.Y+cuts.Top+h)), nil
}

func targetFormat(choice, srcExt string) (imageio.Format, error) {
	if choice == "" || choice == "original" {
		return imageio.PreserveFormat(srcExt), nil
	}
	return imageio.ParseFormat(choice)
}

// RunAll pads paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
