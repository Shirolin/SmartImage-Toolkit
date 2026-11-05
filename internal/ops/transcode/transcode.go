// Package transcode converts an image from its source format to another,
// preserving its upright pixel dimensions.
package transcode

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// Config selects the target format and where the result goes.
type Config struct {
	Format imageio.Format
	Policy output.Policy
}

// Result is the outcome of one file.
type Result = ops.Result

// Progress is called once per finished file, on a worker goroutine.
type Progress = ops.Progress

// Run converts one file. The output location and name come from the policy.
func Run(ctx context.Context, src string, cfg Config) Result {
	src = filepath.Clean(src)
	ext := imageio.NormalizeExt(filepath.Ext(src))
	targetExt := cfg.Format.Ext()

	var inputSize int64
	if info, err := os.Stat(src); err == nil {
		inputSize = info.Size()
	}

	if (cfg.Format == imageio.WebP || cfg.Format == imageio.AVIF) && ext == targetExt {
		return Result{Status: ops.StatusSkipped, File: src, Reason: "已经是该格式", InputSize: inputSize}
	}
	if err := ctx.Err(); err != nil {
		return Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
	}

	img, err := imageio.DecodeFile(src)
	if err != nil {
		return Result{Status: ops.StatusError, File: src, Reason: fmt.Sprintf("图片文件解析失败: %v", err), InputSize: inputSize}
	}

	dir, base, outExt, err := cfg.Policy.Target(src, targetExt, output.Convert)
	if err != nil {
		return Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	out, outSize, err := pipeline.Emit(ctx, dir, base, outExt, img, cfg.Format)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
		}
		return Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}

	return Result{
		Status: ops.StatusSuccess, File: src, Output: out,
		InputSize: inputSize, OutputSize: outSize,
		Width: img.Bounds().Dx(), Height: img.Bounds().Dy(),
	}
}

// RunAll converts paths with a bounded worker pool. Results are returned in
// path order. Cancelling ctx stops scheduling new files; files already
// encoding complete normally or report canceled before writing.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress Progress) []Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) Result {
		return Run(ctx, src, cfg)
	}, progress)
}
