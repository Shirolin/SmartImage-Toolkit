package main

import (
	"image"
	"image/png"
	"os"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/theme"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/center"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/padaspect"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/resize"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func newTestApp(t *testing.T) *app {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	a := &app{
		page:            pageConvert,
		settings:        settings.Default(),
		format:          imageio.WebP,
		resizeMode:      resize.ByWidth,
		resizeWidth:     1920,
		resizeHeight:    1080,
		resizePercent:   50,
		resizeFit:       resize.Cover,
		resizeFormat:    "original",
		trimThreshold:   10,
		trimSides:       trim.All,
		trimFormat:      "original",
		cropFormat:      "original",
		fig:             figCenter,
		centerThreshold: 10,
		centerSides:     center.All,
		centerFill:      ops.FillAuto,
		centerFormat:    "original",
		padPreset:       pad16x9,
		padAspectW:      4,
		padAspectH:      5,
		padLongEdge:     1920,
		padRatio:        60,
		padSubject:      padaspect.Full,
		padThreshold:    10,
		padFill:         ops.FillAuto,
		padFormat:       "original",
		splitThreshold:  10,
		splitSides:      center.All,
		splitFill:       ops.FillAuto,
		splitFormat:     "original",
		splitRows:       2,
		splitCols:       2,
		mattingPreset:   mattingFine,
		mattingFormat:   "original",
		mattingFeather:  0,
		index:           make(map[string]*fileItem),
		summaries:       make(map[output.Op]string),
		outputDirs:      make(map[output.Op]string),
	}
	a.list.Key = func(i int) any {
		if i < 0 || i >= len(a.files) {
			return i
		}
		return a.files[i].path
	}
	return a
}

func render(t *testing.T, a *app) *ui.Tester {
	t.Helper()
	return ui.NewTester(func(c *ui.Context) {
		theme.Apply(c)
		a.content(c)
	}, 980, 740)
}

func TestEmptyStateInvitesDrop(t *testing.T) {
	tt := render(t, newTestApp(t))
	for _, want := range []string{"把图片或文件夹拖到这里", "选择图片", "选择文件夹"} {
		if !tt.HasText(want) {
			t.Fatalf("empty state is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

func TestQueueShowsStatusSizesAndSavings(t *testing.T) {
	a := newTestApp(t)
	done := &fileItem{path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000, width: 1920, height: 1080}
	done.setResult(output.Convert, opResult{
		status: statusSuccess, output: `D:\pics\cover.webp`, outputSize: 480_000,
		width: 1920, height: 1080,
	})
	failed := &fileItem{path: `D:\pics\banner.jpg`, name: "banner.jpg", size: 1_200_000}
	failed.setResult(output.Convert, opResult{status: statusError, reason: "图片文件解析失败"})
	skipped := &fileItem{path: `D:\pics\ready.webp`, name: "ready.webp", size: 300_000}
	skipped.setResult(output.Convert, opResult{status: statusSkipped, reason: "已经是该格式"})
	a.files = []*fileItem{done, failed, skipped}
	a.summaries[output.Convert] = "完成 1 个 · 节省 1.9 MB · 跳过 1 个"

	tt := render(t, a)
	for _, want := range []string{
		"文件列表 · 3", "cover.png", "1920×1080", "2.3 MB → 469 KB  −80%", "完成",
		"banner.jpg", "图片文件解析失败", "失败",
		"ready.webp", "已经是该格式", "已跳过",
		"完成 1 个 · 节省 1.9 MB · 跳过 1 个",
	} {
		if !tt.HasText(want) {
			t.Errorf("queue is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

func TestPerOperationResultsStaySeparate(t *testing.T) {
	a := newTestApp(t)
	f := &fileItem{path: `D:\pics\photo.png`, name: "photo.png", size: 1000, width: 1920, height: 1080}
	f.setResult(output.Convert, opResult{
		status: statusSuccess, output: `D:\pics\photo.webp`, outputSize: 500,
		width: 1920, height: 1080,
	})
	f.setResult(output.Resize, opResult{
		status: statusSuccess, output: `D:\pics\photo_resized.png`, outputSize: 250,
		width: 960, height: 540,
	})
	a.files = []*fileItem{f}

	tt := render(t, a)
	if !tt.HasText("1000 B → 500 B  −50%") {
		t.Fatalf("convert result missing; texts = %v", tt.Texts())
	}

	a.page = pageResize
	tt.Frame()
	for _, want := range []string{"1000 B → 250 B  −75%", "1920×1080 → 960×540", "开始缩放"} {
		if !tt.HasText(want) {
			t.Fatalf("resize page is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

func TestConvertFormatChangeDropsConvertResults(t *testing.T) {
	a := newTestApp(t)
	f := &fileItem{path: `D:\pics\a.png`, name: "a.png"}
	f.setResult(output.Convert, opResult{status: statusSuccess, output: `D:\pics\a.webp`, outputSize: 10})
	f.setResult(output.Resize, opResult{status: statusSuccess, output: `D:\pics\a_resized.png`, outputSize: 20})
	a.files = []*fileItem{f}
	a.summaries[output.Convert] = "完成 1 个"

	a.setConvertFormat(imageio.AVIF)

	if got := f.result(output.Convert); got.status != statusQueued {
		t.Fatalf("convert result = %+v, want queued", got)
	}
	if got := f.result(output.Resize); got.status != statusSuccess {
		t.Fatalf("resize result was dropped: %+v", got)
	}
	if a.summaries[output.Convert] != "" {
		t.Fatalf("convert summary = %q, want empty", a.summaries[output.Convert])
	}
	if a.format != imageio.AVIF || a.settings.Format != "avif" {
		t.Fatalf("format = %v/%q", a.format, a.settings.Format)
	}
}

func TestSidebarNavigatesBetweenPages(t *testing.T) {
	a := newTestApp(t)
	tt := ui.NewTester(func(c *ui.Context) {
		theme.Apply(c)
		a.sidebar(c)
	}, 260, 700)

	if err := tt.Click("缩放"); err != nil {
		t.Fatalf("click resize: %v", err)
	}
	if a.page != pageResize {
		t.Fatalf("page = %v, want resize", a.page)
	}
	if err := tt.Click("边缘处理"); err != nil {
		t.Fatalf("click edge: %v", err)
	}
	if a.page != pageEdge {
		t.Fatalf("page = %v, want edge", a.page)
	}
	if err := tt.Click("构图"); err != nil {
		t.Fatalf("click figure: %v", err)
	}
	if a.page != pageFigure {
		t.Fatalf("page = %v, want figure", a.page)
	}
	if err := tt.Click("切图"); err != nil {
		t.Fatalf("click split: %v", err)
	}
	if a.page != pageSplit {
		t.Fatalf("page = %v, want split", a.page)
	}
	if err := tt.Click("抠图"); err != nil {
		t.Fatalf("click matting: %v", err)
	}
	if a.page != pageMatting {
		t.Fatalf("page = %v, want matting", a.page)
	}
	if err := tt.Click("设置"); err != nil {
		t.Fatalf("click settings: %v", err)
	}
	if a.page != pageSettings {
		t.Fatalf("page = %v, want settings", a.page)
	}
}

func TestEdgeCropRequiresAnEdge(t *testing.T) {
	a := newTestApp(t)
	a.page = pageEdge
	a.edge = edgeCrop
	a.files = []*fileItem{{path: `D:\pics\photo.png`, name: "photo.png", size: 1000, width: 100, height: 80}}

	tt := render(t, a)
	if !tt.HasText("至少一个方向大于 0") {
		t.Fatalf("crop page is missing the empty-edge hint; texts = %v", tt.Texts())
	}

	a.cropLeft = 10
	tt.Frame()
	if !tt.HasText("开始裁剪 (1)") {
		t.Fatalf("start label did not enable; texts = %v", tt.Texts())
	}
	if !tt.HasText("100×80 → 90×80") {
		t.Fatalf("crop preview is missing; texts = %v", tt.Texts())
	}
}

func TestResizePagePreviewsOutputSize(t *testing.T) {
	a := newTestApp(t)
	a.page = pageResize
	a.resizeWidth = 960
	a.files = []*fileItem{{path: `D:\pics\photo.png`, name: "photo.png", size: 1000, width: 1920, height: 1080}}

	tt := render(t, a)
	for _, want := range []string{"模式", "宽度", "输出格式", "1920×1080 → 960×540", "开始缩放 (1)"} {
		if !tt.HasText(want) {
			t.Fatalf("resize page is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

func TestFigurePadPreviewsCanvas(t *testing.T) {
	a := newTestApp(t)
	a.page = pageFigure
	a.fig = figPad
	a.files = []*fileItem{{path: `D:\pics\photo.png`, name: "photo.png", size: 1000, width: 4000, height: 3000}}

	tt := render(t, a)
	for _, want := range []string{"比例", "长边", "主体占比", "主体", "填充", "4000×3000 → 1920×1080", "开始扩边 (1)"} {
		if !tt.HasText(want) {
			t.Fatalf("pad page is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

func TestFigureCenterShowsControls(t *testing.T) {
	a := newTestApp(t)
	a.page = pageFigure
	a.files = []*fileItem{{path: `D:\pics\photo.png`, name: "photo.png", size: 1000, width: 100, height: 80}}

	tt := render(t, a)
	for _, want := range []string{"智能居中", "画布扩边", "容差", "参与边", "开始居中 (1)"} {
		if !tt.HasText(want) {
			t.Fatalf("center page is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

// splitEditor builds the editor state for a 100×80 image shown at 2×.
func splitEditor(f *fileItem) *splitState {
	st := &splitState{
		item:   f,
		bitmap: ui.NewBitmap(image.NewNRGBA(image.Rect(0, 0, 100, 80))),
		imgW:   100,
		imgH:   80,
		dispW:  100,
		dispH:  80,
	}
	st.view = splitView{zoom: 1, panX: 10, panY: 10, displayW: 200, displayH: 160}
	return st
}

func TestSplitPageShowsEditorAndTileCount(t *testing.T) {
	a := newTestApp(t)
	a.page = pageSplit
	f := &fileItem{path: `D:\pics\photo.png`, name: "photo.png", size: 1000}
	a.files = []*fileItem{f}
	a.split = splitEditor(f)

	tt := render(t, a)
	for _, want := range []string{
		"竖线", "横线", "平移", "吸附", "应用等分", "清空切割线", "每片居中",
		"1 行 × 1 列 · 1 片", "开始切割 (1 片)",
	} {
		if !tt.HasText(want) {
			t.Fatalf("split page is missing %q; texts = %v", want, tt.Texts())
		}
	}

	if err := tt.Click("应用等分"); err != nil {
		t.Fatalf("click equal divide: %v", err)
	}
	tt.Frame()
	if !tt.HasText("2 行 × 2 列 · 4 片") || !tt.HasText("开始切割 (4 片)") {
		t.Fatalf("equal divide did not update the tile count; texts = %v", tt.Texts())
	}
}

func TestSplitEditorAddsDragsAndRemovesLines(t *testing.T) {
	st := splitEditor(&fileItem{path: `D:\pics\photo.png`, name: "photo.png"})

	// A click at x=110 is image x=50.
	if !st.addLine(110, 40, false) || len(st.cutX) != 1 || st.cutX[0] != 50 {
		t.Fatalf("cutX = %v, want [50]", st.cutX)
	}
	if axis, idx, ok := st.hitLine(112, 40); !ok || axis != 1 || idx != 0 {
		t.Fatalf("hitLine = %d/%d/%v, want the vertical line", axis, idx, ok)
	}
	if !st.dragLine(150, 40) || st.cutX[0] != 70 {
		t.Fatalf("cutX after drag = %v, want [70]", st.cutX)
	}

	// Alt inverts the axis while the mode stays on vertical lines.
	if !st.addLine(110, 70, true) || len(st.cutY) != 1 || st.cutY[0] != 30 {
		t.Fatalf("cutY = %v, want [30]", st.cutY)
	}

	st.cutX = []int{30, 70}
	st.dragIndex = 1
	if !st.dragLine(410, 40) || st.cutX[1] != 99 {
		t.Fatalf("cutX = %v, want the line clamped inside the image", st.cutX)
	}

	st.removeLine(1, 0)
	if len(st.cutX) != 1 || st.cutX[0] != 99 {
		t.Fatalf("cutX after remove = %v, want [99]", st.cutX)
	}
}

func TestSplitSnapAlignsToOtherLines(t *testing.T) {
	st := splitEditor(&fileItem{path: `D:\pics\photo.png`, name: "photo.png"})
	st.snap = true
	st.cutX = []int{30}

	if got := st.snapValue(33, 1, -1); got != 30 {
		t.Fatalf("snapValue(33) = %d, want 30", got)
	}
	if got := st.snapValue(40, 1, -1); got != 40 {
		t.Fatalf("snapValue(40) = %d, want 40", got)
	}
}

func TestSplitEditorLeavesWithTheQueue(t *testing.T) {
	a := newTestApp(t)
	f := &fileItem{path: `D:\pics\photo.png`, name: "photo.png", size: 1000}
	a.files = []*fileItem{f}
	a.split = splitEditor(f)

	a.removeFile(f)
	if a.split != nil {
		t.Fatal("split editor kept an image that left the queue")
	}
}

func TestMattingPageShowsModelAndFormat(t *testing.T) {
	a := newTestApp(t)
	a.page = pageMatting
	a.files = []*fileItem{{path: `D:\pics\photo.png`, name: "photo.png", size: 1000, width: 100, height: 80}}

	tt := render(t, a)
	for _, want := range []string{"模型", "精细（U2-Net）", "输出格式", "开始抠图"} {
		if !tt.HasText(want) {
			t.Fatalf("matting page is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

func TestParseLaunch(t *testing.T) {
	l := parseLaunch([]string{"--quick", "webp", `D:\pics\a.png`, `D:\pics\b.jpg`})
	if !l.hasQuick || l.quick != imageio.WebP {
		t.Fatalf("quick = %v/%v, want webp", l.hasQuick, l.quick)
	}
	if len(l.paths) != 2 {
		t.Fatalf("paths = %v, want 2 files", l.paths)
	}

	l = parseLaunch([]string{"--unknown", "x.png"})
	if l.hasQuick || len(l.paths) != 1 {
		t.Fatalf("got %+v, want one path and no quick format", l)
	}

	l = parseLaunch([]string{})
	if l.hasQuick || len(l.paths) != 0 {
		t.Fatalf("got %+v, want empty launch", l)
	}
}

func TestQueuedLaunchKeepsPathsAndFormat(t *testing.T) {
	a := newTestApp(t)
	a.busy = true
	a.page = pageResize
	a.queueLaunch(launch{paths: []string{`D:\pics\a.png`}, quick: imageio.PNG, hasQuick: true})
	if len(a.pendingPaths) != 1 || !a.hasPendingQuick || a.pendingQuick != imageio.PNG {
		t.Fatalf("queued = %v/%v/%v, want one path and png", a.pendingPaths, a.hasPendingQuick, a.pendingQuick)
	}

	// The paths need real files, so drain the format alone.
	a.busy = false
	a.pendingPaths = nil
	a.drainPending()
	if a.page != pageConvert || a.format != imageio.PNG || a.hasPendingQuick {
		t.Fatalf("after drain: page=%v format=%v pending=%v", a.page, a.format, a.hasPendingQuick)
	}
}

func TestAutoCloseOnlyAfterAQuickBatchWithoutFailures(t *testing.T) {
	a := newTestApp(t)
	a.quickLaunch = true
	if !a.shouldAutoClose(output.Convert) {
		t.Fatal("a quick conversion should be allowed to close the window")
	}
	if a.shouldAutoClose(output.Matting) {
		t.Fatal("only the quick convert batch may close the window")
	}
	a.runFailed = 1
	if a.shouldAutoClose(output.Convert) {
		t.Fatal("failures keep the window open")
	}
	a.runFailed = 0
	a.pendingPaths = []string{`D:\pics\a.png`}
	if a.shouldAutoClose(output.Convert) {
		t.Fatal("a launch waiting in the queue keeps the window open")
	}
	a.pendingPaths = nil
	a.quickLaunch = false
	if a.shouldAutoClose(output.Convert) {
		t.Fatal("a manually opened window stays open")
	}
}

// TestRenderPreview writes a headless rendering for visual review. It is
// opt-in so ordinary test runs never produce artifacts.
func TestRenderPreview(t *testing.T) {
	out := os.Getenv("SMARTIMAGE_PREVIEW")
	if out == "" {
		t.Skip("set SMARTIMAGE_PREVIEW=<file.png> to write a rendering")
	}
	a := newTestApp(t)
	switch os.Getenv("SMARTIMAGE_PREVIEW_PAGE") {
	case "empty":
		// The empty state renders on its own.
	case "settings":
		a.page = pageSettings
		a.settings.Location = settings.Subfolder
		a.settings.Concurrency = 4
	case "resize":
		a.page = pageResize
		a.resizeWidth = 960
		a.files = []*fileItem{{
			path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000,
			width: 1920, height: 1080,
		}}
		a.files[0].setResult(output.Resize, opResult{
			status: statusSuccess, output: `D:\pics\cover_resized.png`, outputSize: 480_000,
			width: 960, height: 540,
		})
	case "edge":
		a.page = pageEdge
		a.edge = edgeTrim
		a.files = []*fileItem{{
			path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000,
			width: 1920, height: 1080,
		}}
		a.files[0].setResult(output.Trim, opResult{
			status: statusSuccess, output: `D:\pics\trimmed\cover.png`, outputSize: 1_900_000,
			reason: "去除 上 12 · 下 12", width: 1920, height: 1056,
		})
		a.summaries[output.Trim] = "完成 1 个 · 节省 500 KB"
	case "split":
		a.page = pageSplit
		f := &fileItem{path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000}
		a.files = []*fileItem{f}
		img, err := imageio.DecodeFile("../../.tmp/live/photo.png")
		if err != nil {
			t.Fatal(err)
		}
		b := img.Bounds()
		w, h := b.Dx(), b.Dy()
		f.width, f.height = w, h
		a.split = &splitState{
			item: f, bitmap: ui.NewBitmap(img),
			imgW: w, imgH: h, dispW: w, dispH: h, snap: true,
			cutX: []int{w / 3, w * 2 / 3}, cutY: []int{h / 2},
		}
	case "matting":
		a.page = pageMatting
		f := &fileItem{path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000, width: 1920, height: 1080}
		f.setResult(output.Matting, opResult{
			status: statusSuccess, output: `D:\pics\cover_nobg.png`, outputSize: 1_200_000,
			width: 1920, height: 1080,
		})
		a.files = []*fileItem{f}
		a.summaries[output.Matting] = "完成 1 个 · 节省 1.1 MB"
	case "center", "pad":
		a.page = pageFigure
		if os.Getenv("SMARTIMAGE_PREVIEW_PAGE") == "pad" {
			a.fig = figPad
		}
		a.files = []*fileItem{{
			path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000,
			width: 1920, height: 1080,
		}}
		op, reason, w, h := output.Center, "左右各 40 · 上下各 20", 1920, 1080
		if a.fig == figPad {
			op, reason, w, h = output.Pad, "16:9 画布 · 主体 60%", 1920, 1080
		}
		a.files[0].setResult(op, opResult{
			status: statusSuccess, output: `D:\pics\cover_centered.png`, outputSize: 2_000_000,
			reason: reason, width: w, height: h,
		})
		a.summaries[op] = "完成 1 个 · 节省 400 KB"
	default:
		a.files = []*fileItem{
			{
				path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000,
				width: 1920, height: 1080,
				results: map[output.Op]opResult{output.Convert: {
					status: statusSuccess, output: `D:\pics\cover.webp`, outputSize: 480_000,
					width: 1920, height: 1080,
				}},
			},
			{
				path: `D:\pics\banner.jpg`, name: "banner.jpg", size: 1_200_000,
				width: 1600, height: 900,
				results: map[output.Op]opResult{output.Convert: {status: statusRunning}},
			},
			{
				path: `D:\pics\ready.webp`, name: "ready.webp", size: 300_000,
				width: 800, height: 800,
				results: map[output.Op]opResult{output.Convert: {
					status: statusSkipped, reason: "已经是该格式",
				}},
			},
		}
		a.summaries[output.Convert] = "完成 1 个 · 节省 1.9 MB · 跳过 1 个"
	}

	tt := render(t, a)
	// The list measures its rows after the first layout pass; render the
	// settled frame so variable-height rows appear as users see them.
	tt.Frame()
	f, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, tt.Image()); err != nil {
		t.Fatal(err)
	}
}
