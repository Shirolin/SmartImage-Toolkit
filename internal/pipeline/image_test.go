package pipeline

import (
	"context"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
)

func TestRunCleansUpUnfinishedOutput(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		status string
	}{
		{name: "encoding fails", status: ops.StatusError},
		{name: "canceled during recipe", status: ops.StatusCanceled},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "source.png")
			file, err := os.Create(path)
			if err != nil {
				t.Fatal(err)
			}
			encodeErr := png.Encode(file, image.NewNRGBA(image.Rect(0, 0, 2, 2)))
			closeErr := file.Close()
			if encodeErr != nil || closeErr != nil {
				t.Fatalf("write source: %v, close: %v", encodeErr, closeErr)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			got := ReadSource(path).Run(ctx, output.Resize, output.Policy{}, imageio.PNG,
				func(img image.Image) (image.Image, string, error) {
					if scenario.status == ops.StatusCanceled {
						cancel()
						return img, "", nil
					}
					return image.NewNRGBA(image.Rectangle{}), "", nil
				})
			if got.Status != scenario.status || got.Output != "" || got.File != path || got.InputSize <= 0 {
				t.Fatalf("unexpected result: %+v", got)
			}
			if scenario.status == ops.StatusError && !strings.Contains(got.Reason, "编码失败") {
				t.Fatalf("expected an encoding error, got %q", got.Reason)
			}
			entries, err := os.ReadDir(dir)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 1 || entries[0].Name() != "source.png" {
				t.Fatalf("output directory contains a ghost file: %v", entries)
			}
		})
	}
}
