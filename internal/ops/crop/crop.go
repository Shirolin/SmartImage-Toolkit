// Package crop removes a fixed number of pixels from each side of an image.
package crop

import (
	"context"
	"errors"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// Config is the operation input. Format is "original" or an imageio format
// name.
type Config struct {
	Top, Bottom, Left, Right int
	Format                   string
	Policy                   output.Policy
}

func (c Config) empty() bool {
	return c.Top == 0 && c.Bottom == 0 && c.Left == 0 && c.Right == 0
}

// Run crops one file. The output location and name come from the policy.
func Run(ctx context.Context, src string, cfg Config) ops.Result {
	src = filepath.Clean(src)
	srcExt := imageio.NormalizeExt(filepath.Ext(src))

	var inputSize int64
	if info, err := os.Stat(src); err == nil {
		inputSize = info.Size()
	}

	if cfg.Top < 0 || cfg.Bottom < 0 || cfg.Left < 0 || cfg.Right < 0 {
		return ops.Result{Status: ops.StatusError, File: src, Reason: "裁剪边距不能为负数", InputSize: inputSize}
	}
	if cfg.empty() {
		return ops.Result{Status: ops.StatusError, File: src, Reason: "上/下/左/右不能全为 0", InputSize: inputSize}
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
	newW := b.Dx() - cfg.Left - cfg.Right
	newH := b.Dy() - cfg.Top - cfg.Bottom
	if newW <= 0 || newH <= 0 {
		return ops.Result{Status: ops.StatusError, File: src, Reason: "裁剪范围大于原图尺寸，将导致图像消失", InputSize: inputSize}
	}
	outImg := imaging.Crop(img, image.Rect(
		b.Min.X+cfg.Left, b.Min.Y+cfg.Top,
		b.Min.X+b.Dx()-cfg.Right, b.Min.Y+b.Dy()-cfg.Bottom))

	dir, base, outExt, err := cfg.Policy.Target(src, format.Ext(), output.Crop)
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
		Reason: note(cfg), InputSize: inputSize, OutputSize: outSize,
		Width: newW, Height: newH,
	}
}

func note(c Config) string {
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
	return "裁去 " + strings.Join(parts, " · ")
}

func targetFormat(choice, srcExt string) (imageio.Format, error) {
	if choice == "" || choice == "original" {
		return imageio.PreserveFormat(srcExt), nil
	}
	return imageio.ParseFormat(choice)
}

// RunAll crops paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
