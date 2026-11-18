package pipeline

import (
	"context"
	"errors"
	"fmt"
	"image"
	"os"
	"path/filepath"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
)

type Source struct {
	path string
	size int64
}

func ReadSource(path string) Source {
	source := Source{path: filepath.Clean(path)}
	if info, err := os.Stat(source.path); err == nil {
		source.size = info.Size()
	}
	return source
}

func (source Source) Extension() string {
	return imageio.NormalizeExt(filepath.Ext(source.path))
}

func (source Source) Failed(err error) ops.Result {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ops.Result{Status: ops.StatusCanceled, File: source.path, InputSize: source.size}
	}
	return ops.Result{Status: ops.StatusError, File: source.path, InputSize: source.size, Reason: err.Error()}
}

func (source Source) Skipped(reason string) ops.Result {
	return ops.Result{Status: ops.StatusSkipped, File: source.path, InputSize: source.size, Reason: reason}
}

// Recipe transforms an upright image. A nil image with no error skips output.
type Recipe func(image.Image) (image.Image, string, error)

func (source Source) Run(ctx context.Context, op output.Op, policy output.Policy, format imageio.Format, recipe Recipe) ops.Result {
	if err := ctx.Err(); err != nil {
		return source.Failed(err)
	}
	img, err := imageio.DecodeFile(source.path)
	if err != nil {
		return source.Failed(fmt.Errorf("图片文件解析失败: %w", err))
	}
	transformed, reason, err := recipe(img)
	if err != nil {
		return source.Failed(err)
	}
	if transformed == nil {
		return source.Skipped(reason)
	}
	dir, base, ext, err := policy.Target(source.path, format.Ext(), op)
	if err != nil {
		return source.Failed(err)
	}
	path, size, err := Emit(ctx, dir, base, ext, transformed, format)
	if err != nil {
		return source.Failed(err)
	}
	bounds := transformed.Bounds()
	return ops.Result{
		Status: ops.StatusSuccess, File: source.path, Output: path, Reason: reason,
		InputSize: source.size, OutputSize: size, Width: bounds.Dx(), Height: bounds.Dy(),
	}
}
