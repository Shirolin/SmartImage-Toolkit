// Package cropaspect crops each image to a fixed aspect ratio around a
// chosen point, and optionally scales the crop so its long edge reaches an
// exact pixel count — the way an avatar is cut.
package cropaspect

import (
	"context"
	"errors"
	"fmt"
	"image"
	"math"

	"github.com/disintegration/imaging"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// MaxDim bounds the scaled long edge, matching resize's limit.
const MaxDim = 30000

// maxRatio bounds the ratio numbers; a ratio is small by nature and the
// bound keeps the products safe.
const maxRatio = 1000

// Config is the operation input. AspectW:AspectH is the crop ratio;
// CenterX/CenterY place the crop centre as a fraction of the source (0.5 is
// the middle). With Resize the crop is scaled so its long edge is LongEdge
// pixels. Format is "original" or an imageio format name.
type Config struct {
	AspectW, AspectH int
	Resize           bool
	LongEdge         int
	CenterX, CenterY float64
	Format           string
	Policy           output.Policy
}

// Validate checks the numbers before any file is decoded.
func Validate(cfg Config) error {
	if cfg.AspectW < 1 || cfg.AspectH < 1 {
		return errors.New("目标比例必须是两个正整数")
	}
	if cfg.AspectW > maxRatio || cfg.AspectH > maxRatio {
		return fmt.Errorf("比例数值最大 %d", maxRatio)
	}
	if cfg.Resize && (cfg.LongEdge < 1 || cfg.LongEdge > MaxDim) {
		return fmt.Errorf("输出长边必须在 1-%d 之间", MaxDim)
	}
	return nil
}

// RatioSize is the largest w×h of ratio aw:ah that fits in width×height.
func RatioSize(width, height, aw, ah int) (int, int) {
	if width < 1 || height < 1 || aw < 1 || ah < 1 {
		return 0, 0
	}
	var w, h int
	if int64(width)*int64(ah) <= int64(height)*int64(aw) {
		w = width
		h = int(math.Round(float64(width) * float64(ah) / float64(aw)))
	} else {
		h = height
		w = int(math.Round(float64(height) * float64(aw) / float64(ah)))
	}
	w = min(max(w, 1), width)
	h = min(max(h, 1), height)
	return w, h
}

// LongEdgeSize scales w×h, keeping its ratio, so the longer side is longEdge.
func LongEdgeSize(width, height, longEdge int) (int, int) {
	if width < 1 || height < 1 || longEdge < 1 {
		return 0, 0
	}
	if width >= height {
		return longEdge, max(1, int(math.Round(float64(longEdge)*float64(height)/float64(width))))
	}
	return max(1, int(math.Round(float64(longEdge)*float64(width)/float64(height)))), longEdge
}

// RectAt places a w×h box inside bounds with its centre at the fraction
// (fx, fy) of the source, sliding it back inside when the fraction would
// push it out.
func RectAt(bounds image.Rectangle, w, h int, fx, fy float64) image.Rectangle {
	return rectCentred(bounds, w, h,
		float64(bounds.Min.X)+fx*float64(bounds.Dx()),
		float64(bounds.Min.Y)+fy*float64(bounds.Dy()))
}

// Rect places a w×h box centred on a pixel coordinate inside bounds.
func Rect(bounds image.Rectangle, w, h int, cx, cy float64) image.Rectangle {
	return rectCentred(bounds, w, h, cx, cy)
}

func rectCentred(bounds image.Rectangle, w, h int, cx, cy float64) image.Rectangle {
	x := int(math.Round(cx - float64(w)/2))
	y := int(math.Round(cy - float64(h)/2))
	x = clampInt(x, bounds.Min.X, bounds.Max.X-w)
	y = clampInt(y, bounds.Min.Y, bounds.Max.Y-h)
	return image.Rect(x, y, x+w, y+h)
}

// OutputSize predicts the result without decoding: the scaled long edge when
// Resize is set, otherwise the largest crop of the ratio.
func OutputSize(width, height int, cfg Config) (int, int, error) {
	if err := Validate(cfg); err != nil {
		return 0, 0, err
	}
	w, h := RatioSize(width, height, cfg.AspectW, cfg.AspectH)
	if w < 1 || h < 1 {
		return 0, 0, errors.New("原图尺寸过小，无法按该比例裁剪")
	}
	if cfg.Resize {
		w, h = LongEdgeSize(w, h, cfg.LongEdge)
	}
	return w, h, nil
}

// Run crops one file. The output location and name come from the policy.
func Run(ctx context.Context, src string, cfg Config) ops.Result {
	source := pipeline.ReadSource(src)
	if err := Validate(cfg); err != nil {
		return source.Failed(err)
	}
	format, err := imageio.OutputFormat(cfg.Format, source.Extension())
	if err != nil {
		return source.Failed(err)
	}
	return source.Run(ctx, output.CropAspect, cfg.Policy, format, func(img image.Image) (image.Image, string, error) {
		b := img.Bounds()
		cw, ch := RatioSize(b.Dx(), b.Dy(), cfg.AspectW, cfg.AspectH)
		if cw < 1 || ch < 1 {
			return nil, "", errors.New("原图尺寸过小，无法按该比例裁剪")
		}
		out := imaging.Crop(img, RectAt(b, cw, ch, cfg.CenterX, cfg.CenterY))
		if cfg.Resize {
			w, h := LongEdgeSize(cw, ch, cfg.LongEdge)
			out = imaging.Resize(out, w, h, imaging.Lanczos)
		}
		return out, note(cfg), nil
	})
}

// note names the ratio; the row already shows the resulting pixels, so it
// must not repeat them.
func note(cfg Config) string {
	aw, ah := reduce(cfg.AspectW, cfg.AspectH)
	return fmt.Sprintf("裁成 %d:%d", aw, ah)
}

// reduce divides a ratio to its lowest terms for the result row.
func reduce(w, h int) (int, int) {
	a, b := w, h
	for b != 0 {
		a, b = b, a%b
	}
	if a == 0 {
		return w, h
	}
	return w / a, h / a
}

func clampInt(v, lo, hi int) int {
	if hi < lo {
		return lo
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// RunAll crops paths with a bounded worker pool.
func RunAll(ctx context.Context, paths []string, cfg Config, workers int, progress ops.Progress) []ops.Result {
	return ops.RunAll(ctx, paths, workers, func(ctx context.Context, src string) ops.Result {
		return Run(ctx, src, cfg)
	}, progress)
}
