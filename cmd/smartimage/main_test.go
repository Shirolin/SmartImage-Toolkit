package main

import (
	"image"
	"image/png"
	"math"
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
		cropPreset:      "1:1",
		cropAspectW:     1,
		cropAspectH:     1,
		cropResize:      true,
		cropLongEdge:    512,
		cropAnchor:      anchorFrame,
		cropScale:       1,
		cropZoom:        cropMinZoom,
		cropFX:          0.5,
		cropFY:          0.5,
		cropThreshold:   10,
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
	for _, want := range []string{"把图片拖到这里", "选择图片", "选择文件夹"} {
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
		"文件列表", "· 3", "cover.png", "1920×1080", "2.3 MB", "469 KB", "−80%", "完成",
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
	for _, want := range []string{"1000 B", "500 B", "−50%"} {
		if !tt.HasText(want) {
			t.Fatalf("convert result is missing %q; texts = %v", want, tt.Texts())
		}
	}

	a.page = pageResize
	tt.Frame()
	for _, want := range []string{"250 B", "−75%", "1920×1080 → 960×540", "开始缩放"} {
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
	if err := tt.Click("裁剪"); err != nil {
		t.Fatalf("click crop: %v", err)
	}
	if a.page != pageCrop {
		t.Fatalf("page = %v, want crop", a.page)
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

func TestCropPagePreviewsEachMode(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.files = []*fileItem{{path: `D:\pics\photo.png`, name: "photo.png", size: 1000, width: 1920, height: 1080}}

	// The ratio tab is what the avatar use case needs: the largest 1:1 crop
	// of a 16:9 photo, scaled so its long edge is 512.
	tt := render(t, a)
	for _, want := range []string{"按比例", "按像素", "比例", "定位", "画面中心", "缩放到长边", "1920×1080 → 512×512", "开始裁剪 (1)"} {
		if !tt.HasText(want) {
			t.Fatalf("ratio crop is missing %q; texts = %v", want, tt.Texts())
		}
	}

	// Without scaling the crop keeps the source pixel density.
	a.cropResize = false
	tt.Frame()
	if !tt.HasText("1920×1080 → 1080×1080") {
		t.Fatalf("ratio crop without scaling is missing its preview; texts = %v", tt.Texts())
	}
	a.cropResize = true

	a.crop = cropPixels
	tt.Frame()
	for _, want := range []string{"预览", "上", "下", "左", "右", "至少一个方向大于 0"} {
		if !tt.HasText(want) {
			t.Fatalf("pixel crop is missing %q; texts = %v", want, tt.Texts())
		}
	}
}

func TestCropFrameDragStaysInside(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.cropScale = 1
	a.cropPreview = &cropPreview{imgW: 300, imgH: 200, draw: ui.Rect{W: 300, H: 200}}

	// A 1:1 frame on a 300×200 source is 200 wide, so its centre can only
	// travel between x=100 and x=200.
	if !a.beginCropDrag(cropMove, 150, 100) {
		t.Fatal("the frame's middle should start a move")
	}
	if !a.dragCrop(0, 100) {
		t.Fatal("dragging to the left edge should move the frame")
	}
	if want := 100.0 / 300; math.Abs(a.cropFX-want) > 1e-9 || a.cropFY != 0.5 {
		t.Fatalf("frame = %v,%v, want %v,0.5", a.cropFX, a.cropFY, want)
	}
	if a.cropAnchor != anchorCustom {
		t.Fatalf("anchor = %v, want custom after a drag", a.cropAnchor)
	}
	if a.cropScale != 1 {
		t.Fatalf("scale = %v, want the frame to keep its size", a.cropScale)
	}
	a.dragCrop(300, 100)
	if want := 200.0 / 300; math.Abs(a.cropFX-want) > 1e-9 {
		t.Fatalf("frame = %v, want %v", a.cropFX, want)
	}
}

func TestCropHandleShrinksTheFrame(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.cropScale = 1
	a.cropPreview = &cropPreview{imgW: 400, imgH: 400, draw: ui.Rect{W: 400, H: 400}}

	// Pulling the bottom-right handle to the middle halves the 1:1 frame and
	// keeps the opposite corner where it was.
	if !a.beginCropDrag(cropSE, 400, 400) {
		t.Fatal("the corner handle should start a resize")
	}
	if !a.dragCrop(200, 200) {
		t.Fatal("dragging the handle inward should resize the frame")
	}
	if math.Abs(a.cropScale-0.5) > 1e-9 {
		t.Fatalf("scale = %v, want 0.5", a.cropScale)
	}
	if math.Abs(a.cropFX-0.25) > 1e-9 || math.Abs(a.cropFY-0.25) > 1e-9 {
		t.Fatalf("centre = %v,%v, want 0.25,0.25", a.cropFX, a.cropFY)
	}
	if w, h := a.cropFrameSize(); w != 200 || h != 200 {
		t.Fatalf("frame = %d×%d, want 200×200", w, h)
	}
}

// TestCropCanvasPointerDrivesTheFrame goes through the canvas entry point, so
// the hit test, the drag and the write-back are all exercised as the mouse
// would.
func TestCropCanvasPointerDrivesTheFrame(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.cropScale = 1
	a.cropPreview = &cropPreview{
		imgW: 400, imgH: 400, dispW: 400, dispH: 400,
		bitmap: ui.NewBitmap(image.NewRGBA(image.Rect(0, 0, 400, 400))),
		box:    ui.Rect{W: 400, H: 400},
		draw:   ui.Rect{W: 400, H: 400},
	}
	down := ui.InputEvent{Kind: ui.InputPointerDown, X: 400, Y: 400}
	if !a.cropInput(down) {
		t.Fatal("pressing the bottom-right handle should start a resize")
	}
	if a.cropPreview.drag != cropSE {
		t.Fatalf("grabbed %v, want the south-east handle", a.cropPreview.drag)
	}
	if !a.cropInput(ui.InputEvent{Kind: ui.InputPointerMove, X: 200, Y: 200}) {
		t.Fatal("moving inward should resize the frame")
	}
	if math.Abs(a.cropScale-0.5) > 1e-9 {
		t.Fatalf("scale = %v, want 0.5", a.cropScale)
	}
	a.cropInput(ui.InputEvent{Kind: ui.InputPointerUp, X: 200, Y: 200})
	if a.cropPreview.dragging {
		t.Fatal("releasing should end the drag")
	}
}

// TestCropWheelZoomsAboutThePointer checks the source pixel under the cursor
// stays put, which is what makes a small frame easy to place.
func TestCropWheelZoomsAboutThePointer(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.cropScale = 1
	a.cropPreview = &cropPreview{
		imgW: 400, imgH: 400, dispW: 400, dispH: 400,
		bitmap: ui.NewBitmap(image.NewRGBA(image.Rect(0, 0, 400, 400))),
		box:    ui.Rect{W: 400, H: 400},
		draw:   ui.Rect{W: 400, H: 400},
	}
	// The real canvas paints this rect; the wheel maps through it.
	before := a.cropImageRect(a.cropPreview.box)
	a.cropPreview.draw = before
	fx0 := (300 - before.X) / before.W
	fy0 := (100 - before.Y) / before.H
	// Zoom until the picture is larger than the canvas, which is when the
	// pointer can stay anchored instead of the pan being clamped back.
	for i := 0; i < 5; i++ {
		if !a.cropInput(ui.InputEvent{Kind: ui.InputScroll, X: 300, Y: 100, DY: -1}) {
			t.Fatal("scrolling up should zoom in")
		}
	}
	if a.cropZoom < 2 {
		t.Fatalf("zoom = %v, want well above fit", a.cropZoom)
	}
	draw := a.cropImageRect(a.cropPreview.box)
	if fx := (300 - draw.X) / draw.W; math.Abs(float64(fx-fx0)) > 1e-3 {
		t.Fatalf("source x under the cursor = %v, want %v", fx, fx0)
	}
	if fy := (100 - draw.Y) / draw.H; math.Abs(float64(fy-fy0)) > 1e-3 {
		t.Fatalf("source y under the cursor = %v, want %v", fy, fy0)
	}
	a.cropInput(ui.InputEvent{Kind: ui.InputPointerDown, X: 10, Y: 10, Clicks: 2})
	if a.cropZoom != cropMinZoom || a.cropPanX != 0 {
		t.Fatalf("double-click = zoom %v pan %v, want fit", a.cropZoom, a.cropPanX)
	}
}

// TestCropZoomButtonsWorkWithoutAWheel covers the canvas' own zoom controls,
// which is what a mouse without a wheel (or a trackpad) reaches for.
func TestCropZoomButtonsWorkWithoutAWheel(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.cropPreview = &cropPreview{
		imgW: 400, imgH: 400, dispW: 400, dispH: 400,
		bitmap: ui.NewBitmap(image.NewRGBA(image.Rect(0, 0, 400, 400))),
		box:    ui.Rect{W: 400, H: 400},
	}
	a.cropPreview.draw = a.cropImageRect(a.cropPreview.box)
	_, _, plus := cropZoomBar(a.cropPreview.box)
	if !a.cropInput(ui.InputEvent{Kind: ui.InputPointerDown, X: plus.X + plus.W/2, Y: plus.Y + plus.H/2}) {
		t.Fatal("pressing the plus button should zoom in")
	}
	if a.cropZoom <= cropMinZoom {
		t.Fatalf("zoom = %v, want above fit", a.cropZoom)
	}
	if a.cropPreview.dragging {
		t.Fatal("the zoom button must not start a frame drag")
	}
	minus, _, _ := cropZoomBar(a.cropPreview.box)
	a.cropPreview.draw = a.cropImageRect(a.cropPreview.box)
	if !a.cropInput(ui.InputEvent{Kind: ui.InputPointerDown, X: minus.X + minus.W/2, Y: minus.Y + minus.H/2}) {
		t.Fatal("pressing the minus button should zoom out")
	}
	if a.cropZoom != cropMinZoom {
		t.Fatalf("zoom = %v, want fit again", a.cropZoom)
	}
}

// TestCropCanvasTakesTheEnginePointer renders the page and presses through the
// window's own hit test, which is the path a real mouse takes: the canvas must
// be the element that gets the press, not a wrapper that swallows it.
func TestCropCanvasTakesTheEnginePointer(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	src := image.NewRGBA(image.Rect(0, 0, 400, 300))
	for i := range src.Pix {
		src.Pix[i] = 0xC0
	}
	item := &fileItem{path: `D:\pics\sheet.png`, name: "sheet.png", width: 400, height: 300}
	a.files = []*fileItem{item}
	a.cropPreview = &cropPreview{
		item: item, shown: item, bitmap: ui.NewBitmap(src), probe: src,
		imgW: 400, imgH: 300, dispW: 400, dispH: 300,
	}

	tt := render(t, a)
	st := a.cropPreview
	if st.box.W <= 0 || st.draw.W <= 0 {
		t.Fatalf("the canvas did not paint: box %v draw %v", st.box, st.draw)
	}
	rect, ok := a.cropFrameRect(st.draw)
	if !ok {
		t.Fatalf("no frame on a 400×300 source: draw %v", st.draw)
	}
	cx, cy := rect.X+rect.W/2, rect.Y+rect.H/2
	// The frame is the largest 1:1 rect, so its middle is a free move.
	tt.Press(cx, cy)
	if !st.dragging || st.drag != cropMove {
		t.Fatalf("the press did not grab the frame: dragging %v drag %v", st.dragging, st.drag)
	}
	before := a.cropFX
	tt.Move(cx-40, cy)
	if a.cropFX == before {
		t.Fatalf("moving the pointer did not reach the canvas: centre still %v", before)
	}
	tt.Release(cx-40, cy)
	if st.dragging {
		t.Fatal("the release did not end the drag")
	}
	if a.cropAnchor != anchorCustom {
		t.Fatalf("anchor = %v, want custom after a drag", a.cropAnchor)
	}
	// The wheel goes through the same local-to-canvas mapping.
	tt.Scroll(cx, cy, 0, -1)
	if a.cropZoom <= cropMinZoom {
		t.Fatalf("zoom = %v, want the wheel to zoom in", a.cropZoom)
	}
}

func TestCropPixelHandleWritesInsets(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.crop = cropPixels
	a.cropPreview = &cropPreview{imgW: 400, imgH: 400, draw: ui.Rect{W: 400, H: 400}}

	// Dragging the right edge to x=150 leaves the other three insets alone.
	if !a.beginCropDrag(cropE, 400, 200) {
		t.Fatal("the right handle should start a resize")
	}
	if !a.dragCrop(150, 200) {
		t.Fatal("dragging should write the insets")
	}
	if a.cropLeft != 0 || a.cropTop != 0 || a.cropBottom != 0 || math.Abs(a.cropRight-250) > 1e-9 {
		t.Fatalf("insets = %v/%v/%v/%v, want 0/0/250/0", a.cropTop, a.cropBottom, a.cropLeft, a.cropRight)
	}
}

func TestPixelCropRequiresAnEdge(t *testing.T) {
	a := newTestApp(t)
	a.page = pageCrop
	a.crop = cropPixels
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
		"竖线", "横线", "平移", "吸附", "等分", "清空切割线", "每片居中",
		"开始切割 (1 片)",
	} {
		if !tt.HasText(want) {
			t.Fatalf("split page is missing %q; texts = %v", want, tt.Texts())
		}
	}

	// The equal-divide fields cut the image immediately; the primary button
	// and its count are the visible result.
	a.splitRows, a.splitCols = 2, 2
	a.applySplitDivide()
	tt.Frame()
	if !tt.HasText("开始切割 (4 片)") {
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
	a.quickLaunch = true
	a.submitLaunch(parseLaunch([]string{"--quick", "png", "first.jpg"}))
	a.submitLaunch(parseLaunch([]string{"second.jpg"}))
	a.submitLaunch(parseLaunch([]string{"--quick", "webp", "third.jpg"}))
	if len(a.pending) != 3 ||
		a.pending[0].quick != imageio.PNG || a.pending[0].paths[0] != "first.jpg" ||
		a.pending[1].hasQuick || a.pending[1].paths[0] != "second.jpg" ||
		a.pending[2].quick != imageio.WebP || a.pending[2].paths[0] != "third.jpg" {
		t.Fatalf("queued = %+v, want the original requests in order", a.pending)
	}
	if a.quickLaunch {
		t.Fatal("an ordinary open request should keep the window open")
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
	a.pending = []launch{{paths: []string{`D:\pics\a.png`}}}
	if a.shouldAutoClose(output.Convert) {
		t.Fatal("a launch waiting in the queue keeps the window open")
	}
	a.pending = nil
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
	case "crop":
		a.page = pageCrop
		a.crop = cropRatio
		a.cropPreset = "1:1"
		a.cropAnchor = anchorSubject
		f := &fileItem{path: `D:\pics\cover.png`, name: "cover.png", size: 2_400_000}
		a.files = []*fileItem{f}
		img, err := imageio.DecodeFile("../../.tmp/live/photo.png")
		if err != nil {
			t.Fatal(err)
		}
		b := img.Bounds()
		w, h := b.Dx(), b.Dy()
		f.width, f.height = w, h
		st := &cropPreview{
			item: f, bitmap: ui.NewBitmap(img), imgW: w, imgH: h,
			dispW: w, dispH: h, probe: img,
		}
		st.detect(10)
		a.cropPreview = st
		a.cropFX, a.cropFY = st.subjectCenter()
		f.setResult(output.CropAspect, opResult{
			status: statusSuccess, output: `D:\pics\cropped\cover.png`, outputSize: 1_100_000,
			reason: "裁成 1:1", width: 512, height: 512,
		})
		a.summaries[output.CropAspect] = "完成 1 个 · 节省 1.2 MB"
	case "edge":
		a.page = pageEdge
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
