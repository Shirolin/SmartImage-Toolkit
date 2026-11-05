package main

import (
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"github.com/Shirolin/SmartImage-Toolkit/internal/discovery"
	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/crop"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/resize"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/transcode"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func fileKey(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	abs = filepath.Clean(abs)
	if runtime.GOOS == "windows" {
		return strings.ToLower(abs)
	}
	return abs
}

// addTargets expands dropped paths and files in the background, then merges
// them into the queue on the UI thread. done runs after the merge.
func (a *app) addTargets(paths []string, done func()) {
	if len(paths) == 0 {
		if done != nil {
			done()
		}
		return
	}
	go func() {
		res := discovery.Discover(paths, discovery.Options{Supported: imageio.IsSupported})
		a.update(func() {
			a.addFiles(res.Files)
			a.setDiscoveryNotice(res)
			if done != nil {
				done()
			}
		})
	}()
}

func (a *app) setDiscoveryNotice(res discovery.Result) {
	switch {
	case len(res.Files) == 0 && len(res.Warnings) == 0:
		a.notice = "没有找到可处理的图片。支持 PNG、JPEG、WebP、AVIF。"
	case len(res.Files) == 0:
		a.notice = fmt.Sprintf("没有找到可处理的图片，有 %d 个路径无法读取。", len(res.Warnings))
	case res.Truncated > 0:
		a.notice = fmt.Sprintf("有 %d 个文件夹层级过深，已跳过。", res.Truncated)
	case len(res.Warnings) > 0:
		a.notice = fmt.Sprintf("有 %d 个路径无法读取，已跳过。", len(res.Warnings))
	}
}

func (a *app) addFiles(paths []string) {
	added := 0
	for _, path := range paths {
		key := fileKey(path)
		if _, exists := a.index[key]; exists {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		item := &fileItem{
			path: path,
			name: filepath.Base(path),
			size: info.Size(),
		}
		a.files = append(a.files, item)
		a.index[key] = item
		a.loadThumb(item, a.gen)
		added++
	}
	if added == 0 && len(paths) > 0 {
		a.notice = "这些文件已经在列表中。"
	}
}

func (a *app) loadThumb(item *fileItem, gen int) {
	go func() {
		a.thumbSem <- struct{}{}
		defer func() { <-a.thumbSem }()

		img, err := imageio.DecodeFile(item.path)
		if err != nil {
			return
		}
		thumb := imaging.Fit(img, 96, 96, imaging.Lanczos)
		w, h := img.Bounds().Dx(), img.Bounds().Dy()
		a.update(func() {
			if gen != a.gen || a.index[fileKey(item.path)] != item {
				return
			}
			item.thumb = ui.NewBitmap(thumb)
			item.width, item.height = w, h
		})
	}()
}

func (a *app) clearFiles() {
	if a.busy {
		return
	}
	for _, f := range a.files {
		if f.thumb != nil {
			f.thumb.ReleasePixels()
		}
	}
	a.gen++
	a.files = nil
	a.index = make(map[string]*fileItem)
	a.summaries = make(map[output.Op]string)
	a.outputDirs = make(map[output.Op]string)
	a.notice = ""
}

// removeFile drops one queued entry. Files are only removable while idle so a
// running batch keeps its immutable target list.
func (a *app) removeFile(f *fileItem) {
	if a.busy {
		return
	}
	for i, item := range a.files {
		if item != f {
			continue
		}
		a.files = append(a.files[:i], a.files[i+1:]...)
		delete(a.index, fileKey(f.path))
		if f.thumb != nil {
			f.thumb.ReleasePixels()
		}
		if len(a.files) == 0 {
			a.summaries = make(map[output.Op]string)
			a.outputDirs = make(map[output.Op]string)
		}
		return
	}
}

func (a *app) chooseFiles() {
	go func() {
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
			Parent:   a.win,
			Title:    "选择图片",
			Multiple: true,
			Filters: []mygo.FileFilter{{
				Name:       "图片",
				Extensions: []string{"png", "jpg", "jpeg", "jfif", "webp", "avif", "gif", "bmp", "tif", "tiff"},
			}},
		})
		if err != nil || len(paths) == 0 {
			return
		}
		a.addTargets(paths, nil)
	}()
}

func (a *app) chooseFolder() {
	go func() {
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
			Parent:    a.win,
			Title:     "选择图片文件夹",
			Directory: true,
		})
		if err != nil || len(paths) == 0 {
			return
		}
		a.addTargets(paths, nil)
	}()
}

// chooseOutputDir opens the directory picker. then runs on the UI thread with
// the chosen path, or "" when the user cancelled.
func (a *app) chooseOutputDir(then func(string)) {
	go func() {
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
			Parent:    a.win,
			Title:     "选择输出目录",
			Directory: true,
		})
		chosen := ""
		if err == nil && len(paths) > 0 {
			chosen = paths[0]
		}
		a.update(func() {
			if chosen != "" {
				a.settings.CustomDir = chosen
				a.settings.Location = settings.CustomDir
				a.persist()
			}
			if then != nil {
				then(chosen)
			}
		})
	}()
}

func (a *app) setConvertFormat(f imageio.Format) {
	if a.busy {
		return
	}
	a.format = f
	a.settings.Format = string(f)
	a.persist()
	a.resetOp(output.Convert)
}

func (a *app) setLocation(loc settings.Location) {
	if a.busy {
		return
	}
	a.settings.Location = loc
	a.persist()
	if loc == settings.CustomDir && a.settings.CustomDir == "" {
		a.chooseOutputDir(func(chosen string) {
			if chosen == "" && a.settings.CustomDir == "" {
				a.settings.Location = settings.SameDir
				a.persist()
			}
		})
	}
}

func (a *app) persist() {
	// The settings file is a few hundred bytes; writing it synchronously keeps
	// tests and shutdown free of in-flight saves without a visible stall.
	_ = settings.Save(a.settings)
}

func (a *app) policy() output.Policy {
	return output.FromSettings(a.settings)
}

// resetOp forgets the results of one operation so parameter changes turn the
// queue back into pending work without touching other operations' results.
func (a *app) resetOp(op output.Op) {
	if a.busy {
		return
	}
	for _, f := range a.files {
		if f.results != nil {
			delete(f.results, op)
		}
	}
	delete(a.summaries, op)
	delete(a.outputDirs, op)
}

func (a *app) convertible(op output.Op) []*fileItem {
	var out []*fileItem
	for _, f := range a.files {
		switch f.result(op).status {
		case statusQueued, statusError, statusCanceled:
			out = append(out, f)
		}
	}
	return out
}

func (a *app) failedCount(op output.Op) int {
	n := 0
	for _, f := range a.files {
		if f.result(op).status == statusError {
			n++
		}
	}
	return n
}

func (a *app) successCount(op output.Op) int {
	n := 0
	for _, f := range a.files {
		if f.result(op).status == statusSuccess {
			n++
		}
	}
	return n
}

func (a *app) resizeConfig() resize.Config {
	return resize.Config{
		Mode:    a.resizeMode,
		Width:   int(math.Round(a.resizeWidth)),
		Height:  int(math.Round(a.resizeHeight)),
		Percent: int(math.Round(a.resizePercent)),
		Fit:     a.resizeFit,
		Format:  a.resizeFormat,
		Policy:  a.policy(),
	}
}

func (a *app) trimConfig() trim.Config {
	return trim.Config{
		Threshold: int(math.Round(a.trimThreshold)),
		Sides:     a.trimSides,
		Format:    a.trimFormat,
		Policy:    a.policy(),
	}
}

func (a *app) cropConfig() crop.Config {
	return crop.Config{
		Top:    int(math.Round(a.cropTop)),
		Bottom: int(math.Round(a.cropBottom)),
		Left:   int(math.Round(a.cropLeft)),
		Right:  int(math.Round(a.cropRight)),
		Format: a.cropFormat,
		Policy: a.policy(),
	}
}

func (a *app) cropEmpty() bool {
	c := a.cropConfig()
	return c.Top == 0 && c.Bottom == 0 && c.Left == 0 && c.Right == 0
}

func (a *app) startCurrent() {
	switch a.currentOp() {
	case output.Resize:
		a.startResize()
	case output.Trim:
		a.startTrim()
	case output.Crop:
		a.startCrop()
	default:
		a.startConvert()
	}
}

func (a *app) startConvert() {
	cfg := transcode.Config{Format: a.format, Policy: a.policy()}
	a.startRun(output.Convert, func(ctx context.Context, src string) ops.Result {
		return transcode.Run(ctx, src, cfg)
	})
}

func (a *app) startResize() {
	cfg := a.resizeConfig()
	a.startRun(output.Resize, func(ctx context.Context, src string) ops.Result {
		return resize.Run(ctx, src, cfg)
	})
}

func (a *app) startTrim() {
	cfg := a.trimConfig()
	a.startRun(output.Trim, func(ctx context.Context, src string) ops.Result {
		return trim.Run(ctx, src, cfg)
	})
}

func (a *app) startCrop() {
	if a.cropEmpty() {
		a.notice = "请至少设置一个裁剪边距。"
		return
	}
	cfg := a.cropConfig()
	a.startRun(output.Crop, func(ctx context.Context, src string) ops.Result {
		return crop.Run(ctx, src, cfg)
	})
}

func (a *app) startRun(op output.Op, job ops.Job) {
	if a.busy {
		return
	}
	targets := a.convertible(op)
	if len(targets) == 0 {
		a.notice = "没有待处理的文件。"
		return
	}
	if a.settings.Location == settings.CustomDir && strings.TrimSpace(a.settings.CustomDir) == "" {
		a.notice = "请先选择输出目录。"
		a.chooseOutputDir(nil)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	a.cancel = cancel
	a.busy = true
	a.notice = ""
	a.done = 0
	a.total = len(targets)
	delete(a.summaries, op)
	delete(a.outputDirs, op)

	paths := make([]string, len(targets))
	targetSet := make(map[string]*fileItem, len(targets))
	for i, f := range targets {
		paths[i] = f.path
		targetSet[fileKey(f.path)] = f
		f.setResult(op, opResult{status: statusRunning})
	}

	go func() {
		results := ops.RunAll(ctx, paths, a.settings.Concurrency, job,
			func(done, total int, r ops.Result) {
				a.update(func() {
					if f := targetSet[fileKey(r.File)]; f != nil {
						applyResult(f, op, r)
					}
					a.done = done
				})
			})
		a.update(func() {
			for _, r := range results {
				if f := targetSet[fileKey(r.File)]; f != nil {
					applyResult(f, op, r)
				}
			}
			a.busy = false
			a.cancel = nil
			a.done = len(results)
			a.summarize(op, targets)
		})
	}()
}

func applyResult(f *fileItem, op output.Op, r ops.Result) {
	f.setResult(op, opResult{
		status:     uiStatus(r.Status),
		output:     r.Output,
		outputSize: r.OutputSize,
		reason:     r.Reason,
		width:      r.Width,
		height:     r.Height,
	})
	if r.InputSize > 0 {
		f.size = r.InputSize
	}
}

func uiStatus(s string) status {
	switch s {
	case ops.StatusSuccess:
		return statusSuccess
	case ops.StatusSkipped:
		return statusSkipped
	case ops.StatusError:
		return statusError
	case ops.StatusCanceled:
		return statusCanceled
	default:
		return statusQueued
	}
}

func (a *app) cancelRun() {
	if a.cancel != nil {
		a.cancel()
	}
	a.notice = "正在取消…"
}

func (a *app) summarize(op output.Op, targets []*fileItem) {
	var ok, skipped, failed, canceled int
	var saved int64
	dir := ""
	for _, f := range targets {
		r := f.result(op)
		switch r.status {
		case statusSuccess:
			ok++
			saved += f.size - r.outputSize
			if dir == "" && r.output != "" {
				dir = filepath.Dir(r.output)
			}
		case statusSkipped:
			skipped++
		case statusError:
			failed++
		case statusCanceled:
			canceled++
		}
	}

	parts := make([]string, 0, 4)
	if ok > 0 {
		parts = append(parts, fmt.Sprintf("完成 %d 个", ok))
	}
	if saved > 0 {
		parts = append(parts, "节省 "+formatBytes(saved))
	} else if saved < 0 {
		parts = append(parts, "增加 "+formatBytes(-saved))
	}
	if skipped > 0 {
		parts = append(parts, fmt.Sprintf("跳过 %d 个", skipped))
	}
	if failed > 0 {
		parts = append(parts, fmt.Sprintf("失败 %d 个", failed))
	}
	if canceled > 0 {
		parts = append(parts, fmt.Sprintf("取消 %d 个", canceled))
	}
	if len(parts) == 0 {
		a.summaries[op] = "任务已结束。"
	} else {
		a.summaries[op] = strings.Join(parts, " · ")
	}
	if dir != "" {
		a.outputDirs[op] = dir
	}
}

// previewDims predicts the output size for the current parameters without
// decoding. It is used in the queue rows before a run.
func (a *app) previewDims(f *fileItem, op output.Op) (w, h int, ok bool) {
	if f.width <= 0 || f.height <= 0 {
		return 0, 0, false
	}
	switch op {
	case output.Resize:
		w, h, err := resize.TargetSize(f.width, f.height, a.resizeConfig())
		return w, h, err == nil
	case output.Crop:
		c := a.cropConfig()
		w = f.width - c.Left - c.Right
		h = f.height - c.Top - c.Bottom
		return w, h, w > 0 && h > 0
	}
	return 0, 0, false
}

func (a *app) hasOutput() bool {
	if a.outputDirs[a.currentOp()] != "" {
		return true
	}
	return a.settings.Location == settings.CustomDir && strings.TrimSpace(a.settings.CustomDir) != ""
}

func (a *app) openOutputDir() {
	dir := a.outputDirs[a.currentOp()]
	if dir == "" && a.settings.Location == settings.CustomDir {
		dir = a.settings.CustomDir
	}
	if dir == "" {
		a.notice = "还没有生成文件。"
		return
	}
	openPath(dir)
}

func revealFile(path string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("explorer.exe", "/select,"+path).Start()
		return
	}
	openPath(filepath.Dir(path))
}

func openPath(path string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer.exe", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	_ = cmd.Start()
}

func formatBytes(n int64) string {
	if n < 0 {
		n = -n
	}
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	value := float64(n) / float64(div)
	if value >= 100 {
		return fmt.Sprintf("%.0f %cB", value, "KMGTPE"[exp])
	}
	return fmt.Sprintf("%.1f %cB", value, "KMGTPE"[exp])
}

func sortedConcurrency(current int) []int {
	options := []int{1, 2, 3, 4, 5, 6, 8}
	found := false
	for _, n := range options {
		if n == current {
			found = true
			break
		}
	}
	if !found && current > 0 {
		options = append(options, current)
		sort.Ints(options)
	}
	return options
}
