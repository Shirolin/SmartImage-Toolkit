// Package resize scales images by width, height, percentage or an exact box,
// preserving the source orientation and writing through the shared pipeline.
package resize

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
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// Bounds shared with the old CLI.
const (
	MaxDim     = 30000
	MaxPercent = 1000
)

// Mode selects how the target size is derived.
type Mode string

// Resize modes.
const (
	ByWidth   Mode = "by_width"
	ByHeight  Mode = "by_height"
	ByPercent Mode = "by_percent"
	Custom    Mode = "custom"
)

// Fit selects how a custom width/height box is filled.
type Fit string

// Fit strategies for Custom mode.
const (
	Cover   Fit = "cover"
	Contain Fit = "contain"
	Fill    Fit = "fill"
	Inside  Fit = "inside"
)

// Config is the operation input. Format is "original" or an imageio format
// name; Policy decides where the result is written.
type Config struct {
	Mode    Mode
	Width   int
	Height  int
	Percent int
	Fit     Fit
	Format  string
	Policy  output.Policy
}

// TargetSize validates cfg against a source size and returns the output
// dimensions.
func TargetSize(srcW, srcH int, cfg Config) (w, h int, err error) {
	if srcW <= 0 || srcH <= 0 {
		return 0, 0, errors.New("无法读取图片尺寸")
	}
	fit := cfg.Fit
	if fit == "" {
		fit = Cover
	}

	switch cfg.Mode {
	case ByWidth:
		if cfg.Width <= 0 {
			return 0, 0, errors.New("按宽度缩放缺少宽度参数")
		}
		w = cfg.Width
		h = scaleHeight(srcH, cfg.Width, srcW)
	case ByHeight:
		if cfg.Height <= 0 {
			return 0, 0, errors.New("按高度缩放缺少高度参数")
		}
		h = cfg.Height
		w = scaleHeight(srcW, cfg.Height, srcH)
	case ByPercent:
		if cfg.Percent <= 0 {
			return 0, 0, errors.New("按比例缩放缺少百分比参数")
		}
		if cfg.Percent > MaxPercent {
			return 0, 0, fmt.Errorf("缩放百分比超限：最大 %d%%（当前 %d%%）", MaxPercent, cfg.Percent)
		}
		w = max(1, int(math.Round(float64(srcW)*float64(cfg.Percent)/100)))
		h = scaleHeight(srcH, w, srcW)
	case Custom:
		if cfg.Width <= 0 || cfg.Height <= 0 {
			return 0, 0, errors.New("自定义宽高模式参数不完整")
		}
		w, h = cfg.Width, cfg.Height
		if fit == Inside {
			scale := math.Min(float64(w)/float64(srcW), float64(h)/float64(srcH))
			scale = math.Min(scale, 1)
			w = max(1, int(math.Round(float64(srcW)*scale)))
			h = max(1, int(math.Round(float64(srcH)*scale)))
		}
	default:
		return 0, 0, errors.New("不支持的缩放模式")
	}

	if w > MaxDim || h > MaxDim {
		return 0, 0, fmt.Errorf("目标尺寸超限：单边最大 %dpx（计算得 %dx%d）", MaxDim, w, h)
	}
	if w < 1 || h < 1 {
		return 0, 0, errors.New("目标尺寸无效")
	}
	return w, h, nil
}

func scaleHeight(srcH, targetW, srcW int) int {
	if srcW <= 0 {
		return 1
	}
	return max(1, int(math.Round(float64(srcH)*float64(targetW)/float64(srcW))))
}

// Run resizes one file. The output location and name come from the policy.
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
	targetExt := format.Ext()

	if err := ctx.Err(); err != nil {
		return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
	}

	img, err := imageio.DecodeFile(src)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: fmt.Sprintf("图片文件解析失败: %v", err), InputSize: inputSize}
	}
	b := img.Bounds()
	targetW, targetH, err := TargetSize(b.Dx(), b.Dy(), cfg)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}

	if targetW == b.Dx() && targetH == b.Dy() && targetExt == srcExt {
		return ops.Result{
			Status: ops.StatusSkipped, File: src,
			Reason: "尺寸未变化且未要求格式转换，已跳过", InputSize: inputSize,
		}
	}

	outImg := transform(img, targetW, targetH, cfg)

	dir, base, outExt, err := cfg.Policy.Target(src, targetExt, output.Resize)
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
		InputSize: inputSize, OutputSize: outSize,
		Width: targetW, Height: targetH,
	}
}

func targetFormat(choice, srcExt string) (imageio.Format, error) {
	if choice == "" || choice == "original" {
		return imageio.PreserveFormat(srcExt), nil
	}
	return imageio.ParseFormat(choice)
}

func transform(img image.Image, w, h int, cfg Config) image.Image {
	fit := cfg.Fit
	if fit == "" {
		fit = Cover
	}
	if cfg.Mode != Custom {
		return imaging.Resize(img, w, h, imaging.Lanczos)
	}
	switch fit {
	case Fill:
		return imaging.Resize(img, w, h, imaging.Lanczos)
	case Cover:
		return imaging.Fill(img, w, h, imaging.Center, imaging.Lanczos)
	case Contain:
		srcW := img.Bounds().Dx()
		srcH := img.Bounds().Dy()
		scale := math.Min(float64(w)/float64(srcW), float64(h)/float64(srcH))
		sw := max(1, int(math.Round(float64(srcW)*scale)))
		sh := max(1, int(math.Round(float64(srcH)*scale)))
		canvas := image.NewNRGBA(image.Rect(0, 0, w, h))
		draw.Draw(canvas, image.Rect((w-sw)/2, (h-sh)/2, (w-sw)/2+sw, (h-sh)/2+sh),
			imaging.Resize(img, sw, sh, imaging.Lanczos), image.Point{}, draw.Over)
		return canvas
	case Inside:
		return imaging.Resize(img, w, h, imaging.Lanczos)
	default:
		return imaging.Fill(img, w, h, imaging.Center, imaging.Lanczos)
	}
}

// RunAll resizes paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
