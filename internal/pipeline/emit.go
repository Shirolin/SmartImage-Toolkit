package pipeline

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"os"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
)

// Emit encodes img into dir/base.ext, using an exclusive placeholder so
// concurrent writers never collide. The returned size is the encoded byte
// count. Errors are wrapped for the UI ("编码失败: …"); cancellation is
// returned unwrapped so callers can test errors.Is(err, context.Canceled).
func Emit(ctx context.Context, dir, base, ext string, img image.Image, format imageio.Format) (string, int64, error) {
	if err := ctx.Err(); err != nil {
		return "", 0, err
	}
	out, err := AllocateFilePath(dir, base, ext)
	if err != nil {
		return "", 0, fmt.Errorf("创建输出文件失败: %w", err)
	}

	var buf bytes.Buffer
	if err := imageio.EncodeContext(ctx, &buf, img, format); err != nil {
		RemoveGhost(out)
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", 0, err
		}
		return "", 0, fmt.Errorf("编码失败: %w", err)
	}
	if err := os.WriteFile(out, buf.Bytes(), 0o666); err != nil {
		RemoveGhost(out)
		return "", 0, fmt.Errorf("写入失败: %w", err)
	}
	return out, int64(buf.Len()), nil
}
