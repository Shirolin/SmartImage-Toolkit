// Package crop removes a fixed number of pixels from each side of an image.
package crop

import (
	"context"
	"errors"
	"fmt"
	"image"
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
	source := pipeline.ReadSource(src)
	if cfg.Top < 0 || cfg.Bottom < 0 || cfg.Left < 0 || cfg.Right < 0 {
		return source.Failed(errors.New("裁剪边距不能为负数"))
	}
	if cfg.empty() {
		return source.Failed(errors.New("上/下/左/右不能全为 0"))
	}
	format, err := imageio.OutputFormat(cfg.Format, source.Extension())
	if err != nil {
		return source.Failed(err)
	}
	return source.Run(ctx, output.Crop, cfg.Policy, format, func(img image.Image) (image.Image, string, error) {
		bounds := img.Bounds()
		width := bounds.Dx() - cfg.Left - cfg.Right
		height := bounds.Dy() - cfg.Top - cfg.Bottom
		if width <= 0 || height <= 0 {
			return nil, "", errors.New("裁剪范围大于原图尺寸，将导致图像消失")
		}
		cropped := imaging.Crop(img, image.Rect(
			bounds.Min.X+cfg.Left, bounds.Min.Y+cfg.Top,
			bounds.Max.X-cfg.Right, bounds.Max.Y-cfg.Bottom))
		return cropped, note(cfg), nil
	})
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

// RunAll crops paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
