package main

import (
	"image/png"
	"os"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/theme"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/resize"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func newTestApp(t *testing.T) *app {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	a := &app{
		page:          pageConvert,
		settings:      settings.Default(),
		format:        imageio.WebP,
		resizeMode:    resize.ByWidth,
		resizeWidth:   1920,
		resizeHeight:  1080,
		resizePercent: 50,
		resizeFit:     resize.Cover,
		resizeFormat:  "original",
		trimThreshold: 10,
		trimSides:     trim.All,
		trimFormat:    "original",
		cropFormat:    "original",
		index:         make(map[string]*fileItem),
		summaries:     make(map[output.Op]string),
		outputDirs:    make(map[output.Op]string),
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
