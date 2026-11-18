// Command smartimage-cli converts images from the command line. It exists to
// validate the Go image pipeline independently of the native UI and will back
// the Windows "Send to" integration.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/Shirolin/SmartImage-Toolkit/internal/discovery"
	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/transcode"
)

func main() {
	formatName := flag.String("format", "webp", "输出格式: webp, png, avif, mozjpeg")
	workers := flag.Int("workers", 5, "并发处理文件数")
	flag.Parse()

	format, err := imageio.ParseFormat(*formatName)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	paths, err := discover(flag.Args())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if len(paths) == 0 {
		fmt.Fprintln(os.Stderr, "未找到任何受支持的图片文件")
		os.Exit(1)
	}

	results := transcode.RunAll(context.Background(), paths, transcode.Config{Format: format}, *workers, func(_, _ int, r transcode.Result) {
		fmt.Println(describe(r))
	})

	failed := 0
	for _, r := range results {
		if r.Status == "error" {
			failed++
		}
	}
	if failed > 0 {
		fmt.Fprintf(os.Stderr, "完成: %d 成功, %d 失败\n", len(results)-failed, failed)
		os.Exit(1)
	}
	fmt.Printf("完成: %d 个文件\n", len(results))
}

func describe(r transcode.Result) string {
	switch r.Status {
	case "success":
		return fmt.Sprintf("✓ %s -> %s", filepath.Base(r.File), filepath.Base(r.Output))
	case "skipped":
		return fmt.Sprintf("- %s: %s", filepath.Base(r.File), r.Reason)
	default:
		return fmt.Sprintf("✗ %s: %s", filepath.Base(r.File), r.Reason)
	}
}

func discover(targets []string) ([]string, error) {
	result := discovery.Discover(targets, discovery.Options{Supported: imageio.IsSupported, MaxDepth: -1})
	for _, warning := range result.Warnings {
		if warning.Kind == "inaccessible" {
			return nil, errors.New(warning.Message)
		}
	}
	sort.Strings(result.Files)
	return result.Files, nil
}
