// Package transcode converts an image from its source format to another,
// preserving its upright pixel dimensions.
package transcode

import (
	"context"
	"image"

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
	source := pipeline.ReadSource(src)
	if (cfg.Format == imageio.WebP || cfg.Format == imageio.AVIF) && source.Extension() == cfg.Format.Ext() {
		return source.Skipped("已经是该格式")
	}
	return source.Run(ctx, output.Convert, cfg.Policy, cfg.Format, func(img image.Image) (image.Image, string, error) {
		return img, "", nil
	})
}

// RunAll converts paths with a bounded worker pool. Results are returned in
// path order. Cancelling ctx stops scheduling new files; files already
// encoding complete normally or report canceled before writing.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress Progress) []Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) Result {
		return Run(ctx, src, cfg)
	}, progress)
}
