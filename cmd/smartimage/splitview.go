package main

import (
	"errors"
	"fmt"
	"math"

	"github.com/disintegration/imaging"
	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/components"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/center"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/split"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

// splitMode is what a click on the canvas does.
type splitMode int

const (
	splitVertical splitMode = iota
	splitHorizontal
	splitPan
)

// maxSplitDisplay caps the editor bitmap so a huge photo does not keep a
// full-resolution copy in memory; cuts are still in source pixels.
const maxSplitDisplay = 2048

// splitView is how the last painted frame showed the image. panX and panY are
// the image's top-left corner in element-local coordinates, which is also the
// space InputEvent uses.
type splitView struct {
	zoom     float32
	panX     float32
	panY     float32
	displayW float32
	displayH float32
}

// imageToScreen is the scale from source pixels to canvas pixels.
func (v splitView) imageToScreen(imgW int) float32 {
	if imgW == 0 || v.displayW == 0 {
		return 0
	}
	return v.displayW / float32(imgW) * v.zoom
}

// splitState is the editor of one image.
type splitState struct {
	item   *fileItem
	bitmap *ui.Bitmap
	imgW   int
	imgH   int
	dispW  int
	dispH  int

	cutX []int
	cutY []int

	mode splitMode
	snap bool
	zoom float32 // 0 fits the image to the canvas
	panX float32
	panY float32

	view splitView

	dragAxis  int // 1 vertical lines, 2 horizontal, 0 none
	dragIndex int
	panning   bool
	space     bool

	hoverAxis  int
	hoverIndex int

	lastX float32
	lastY float32
}

func (a *app) selectSplitFile(item *fileItem) {
	if item == nil {
		return
	}
	if a.split != nil && a.split.item == item && a.split.bitmap != nil {
		return
	}
	old := a.split
	st := &splitState{item: item, snap: true}
	a.split = st
	gen := a.gen
	go func() {
		img, err := imageio.DecodeFile(item.path)
		if err != nil {
			a.update(func() {
				if a.split == st {
					a.notice = "无法载入这张图片：" + err.Error()
				}
			})
			return
		}
		b := img.Bounds()
		origW, origH := b.Dx(), b.Dy()
		display := img
		if origW > maxSplitDisplay || origH > maxSplitDisplay {
			display = imaging.Fit(img, maxSplitDisplay, maxSplitDisplay, imaging.Lanczos)
		}
		db := display.Bounds()
		bmp := ui.NewBitmap(display)
		a.update(func() {
			if a.split != st || gen != a.gen {
				bmp.ReleasePixels()
				return
			}
			st.bitmap = bmp
			st.imgW, st.imgH = origW, origH
			st.dispW, st.dispH = db.Dx(), db.Dy()
		})
	}()
	if old != nil && old.bitmap != nil {
		old.bitmap.ReleasePixels()
	}
}

// ensureSplit keeps the editor pointed at a file that is still in the queue.
func (a *app) ensureSplit() {
	for _, f := range a.files {
		if a.split != nil && a.split.item == f {
			return
		}
	}
	a.releaseSplit()
	if len(a.files) > 0 {
		a.selectSplitFile(a.files[0])
	}
}

// syncSplit drops the editor image when it left the queue.
func (a *app) syncSplit() {
	if a.split == nil {
		return
	}
	for _, f := range a.files {
		if a.split.item == f {
			return
		}
	}
	a.releaseSplit()
}

func (a *app) releaseSplit() {
	if a.split != nil && a.split.bitmap != nil {
		a.split.bitmap.ReleasePixels()
	}
	a.split = nil
}

// splitGrid snapshots the current lines for validation, preview and export.
func (a *app) splitGrid() (split.Grid, error) {
	if a.split == nil || a.split.imgW == 0 || a.split.bitmap == nil {
		return split.Grid{}, errors.New("请先选择一张图片")
	}
	g := split.Grid{
		Width:  a.split.imgW,
		Height: a.split.imgH,
		X:      append([]int(nil), a.split.cutX...),
		Y:      append([]int(nil), a.split.cutY...),
	}
	return g, g.Validate()
}

func (a *app) splitToolbar(c *ui.Context) {
	t := c.Theme()
	st := a.split
	if st == nil {
		return
	}
	panel(c, func() {
		ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
			components.Text(c, "图片").FontSize(12).TextColor(t.TextMuted)
			a.splitFileSelect(c, 190)

			components.Text(c, "模式").FontSize(12).TextColor(t.TextMuted)
			mode := int(st.mode)
			tabs := components.Tabs(c, &mode, components.TabsSegmented, "竖线", "横线", "平移")
			if tabs.List.Changed() {
				st.mode = splitMode(mode)
			}

			components.Switch(c, &st.snap, "吸附").Disabled(a.busy)

			ui.Spacer(c)
			components.Text(c, "等分").FontSize(12).TextColor(t.TextMuted)
			if numberField(c, &a.splitRows, 1, 50, 1, 64, "行数") {
				a.applySplitDivide()
			}
			components.Text(c, "×").FontSize(12).TextColor(t.TextMuted)
			if numberField(c, &a.splitCols, 1, 50, 1, 64, "列数") {
				a.applySplitDivide()
			}
			if components.Button(c, "应用等分", components.ButtonOutline).Disabled(a.busy).Clicked() {
				a.applySplitDivide()
			}
			if components.Button(c, "清空切割线", components.ButtonGhost).Disabled(a.busy).Clicked() {
				st.cutX, st.cutY = nil, nil
				a.resetOp(output.Split)
			}
		})
		ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
			components.Text(c, "输出格式").FontSize(12).TextColor(t.TextMuted)
			if selectControl(c, &a.splitFormat, 132, opFormatLabel, opFormatChoices, a.busy) {
				a.resetOp(output.Split)
			}
			components.Switch(c, &a.splitCenter, "每片居中").Disabled(a.busy)
			if a.splitCenter {
				components.Text(c, "容差").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.splitThreshold, 1, 100, 1, 84, "色差容忍度") {
					a.resetOp(output.Split)
				}
				if selectControl(c, &a.splitSides, 96, centerSidesLabel,
					[]center.Sides{center.All, center.TopBottom, center.LeftRight}, a.busy) {
					a.resetOp(output.Split)
				}
				if selectControl(c, &a.splitFill, 96, fillLabel,
					[]ops.Fill{ops.FillAuto, ops.FillTransparent, ops.FillWhite, ops.FillBlack}, a.busy) {
					a.resetOp(output.Split)
				}
			}
			ui.Spacer(c)
			components.Text(c, "输出位置").FontSize(12).TextColor(t.TextMuted)
			a.locationSelect(c, 150)
			if components.Button(c, "添加图片", components.ButtonSecondary).Disabled(a.busy).Clicked() {
				a.chooseFiles()
			}
		})
		ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
			components.Text(c, a.outputHint()).FontSize(12).TextColor(t.TextMuted).Grow(1).MinWidth(0).SingleLine()
			if a.settings.Location == settings.CustomDir {
				if components.Button(c, "更改目录…", components.ButtonGhost).Disabled(a.busy).Clicked() {
					a.chooseOutputDir(nil)
				}
			}
			if components.Button(c, "打开输出文件夹", components.ButtonGhost).Disabled(!a.hasOutput()).Clicked() {
				a.openOutputDir()
			}
			if components.Button(c, "清空", components.ButtonGhost).Disabled(a.busy || len(a.files) == 0).Clicked() {
				a.clearFiles()
			}
		})
	})
}

// splitFileSelect switches the editor between queued images.
func (a *app) splitFileSelect(c *ui.Context, width float32) {
	st := a.split
	sel := components.Select(c, &st.item)
	sel.Trigger.Width(width).Disabled(a.busy).Children(func() {
		components.Text(c, st.item.name).SingleLine()
	})
	sel.Popup(func(ui.Element) {
		for _, f := range a.files {
			item := sel.Item(f)
			item.Children(func() {
				components.Text(c, f.name).SingleLine()
			})
		}
	})
	if sel.Trigger.Changed() && st.item != nil {
		a.selectSplitFile(st.item)
	}
}

func (a *app) applySplitDivide() {
	if a.split == nil || a.split.bitmap == nil {
		return
	}
	rows := int(math.Round(a.splitRows))
	cols := int(math.Round(a.splitCols))
	g, err := split.EqualDivide(a.split.imgW, a.split.imgH, rows, cols)
	if err != nil {
		a.notice = err.Error()
		return
	}
	a.split.cutX, a.split.cutY = g.X, g.Y
	a.resetOp(output.Split)
}

func (a *app) splitPage(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Gap(t.Space(3)).Children(func() {
		a.noticeBanner(c)
		if len(a.files) == 0 {
			a.emptyState(c)
			return
		}
		a.ensureSplit()
		if a.split == nil {
			return
		}
		a.splitToolbar(c)
		a.splitCanvas(c)
		a.splitActionBar(c)
	})
}

func (a *app) splitCanvas(c *ui.Context) {
	st := a.split
	t := c.Theme()
	cursor := ui.CursorCrosshair
	switch {
	case st.dragAxis == 1 || st.hoverAxis == 1:
		cursor = ui.CursorResizeColumn
	case st.dragAxis == 2 || st.hoverAxis == 2:
		cursor = ui.CursorResizeRow
	case st.panning:
		cursor = ui.CursorGrabbing
	case st.mode == splitPan:
		cursor = ui.CursorGrab
	}
	e := ui.Box(c).Fill().MinHeight(0).Clip().Radius(t.Radius).
		Background(ui.RGB(0x18, 0x18, 0x1b)).Cursor(cursor)
	if st.bitmap == nil {
		e.Children(func() {
			ui.Column(c).Fill().Center().Children(func() {
				components.Text(c, "正在载入预览…").FontSize(13).TextColor(t.TextMuted)
			})
		})
		return
	}
	e.Focusable()
	e.DrawOver(func(p *ui.Painter, r ui.Rect) { a.paintSplit(p, r, st) })
	e.HandleInput(func(ev ui.InputEvent) bool { return a.splitInput(ev, st) })
}

func (a *app) paintSplit(p *ui.Painter, r ui.Rect, st *splitState) {
	zoom := st.zoom
	panX, panY := st.panX, st.panY
	if zoom <= 0 {
		fw := float32(st.dispW)
		fh := float32(st.dispH)
		zoom = min((r.W-24)/fw, (r.H-24)/fh)
		if zoom <= 0 {
			return
		}
		panX = (r.W - fw*zoom) / 2
		panY = (r.H - fh*zoom) / 2
	}
	st.view = splitView{
		zoom:     zoom,
		panX:     panX,
		panY:     panY,
		displayW: float32(st.dispW) * zoom,
		displayH: float32(st.dispH) * zoom,
	}
	x0 := r.X + panX
	y0 := r.Y + panY
	p.Image(st.bitmap, ui.Rect{X: x0, Y: y0, W: st.view.displayW, H: st.view.displayH}, ui.FillBox)
	p.Stroke(ui.Rect{X: x0, Y: y0, W: st.view.displayW, H: st.view.displayH}, ui.RGBA(255, 255, 255, 0.25), 0, 1)

	scale := st.view.imageToScreen(st.imgW)
	verticalColor := ui.RGBA(0, 229, 255, 0.95)
	horizontalColor := ui.RGBA(255, 42, 109, 0.95)
	activeColor := ui.RGBA(255, 214, 10, 0.95)
	for i, v := range st.cutX {
		x := x0 + float32(v)*scale
		c := verticalColor
		active := (st.dragAxis == 1 && st.dragIndex == i) || (st.hoverAxis == 1 && st.hoverIndex == i)
		if active {
			c = activeColor
		}
		p.Line(x, y0, x, y0+st.view.displayH, 1.5, c)
		if active {
			p.Text(x+6, y0+14, fmt.Sprintf("%d px", v), 11, activeColor)
		}
	}
	for i, v := range st.cutY {
		y := y0 + float32(v)*scale
		c := horizontalColor
		active := (st.dragAxis == 2 && st.dragIndex == i) || (st.hoverAxis == 2 && st.hoverIndex == i)
		if active {
			c = activeColor
		}
		p.Line(x0, y, x0+st.view.displayW, y, 1.5, c)
		if active {
			p.Text(x0+6, y-6, fmt.Sprintf("%d px", v), 11, activeColor)
		}
	}
}

// splitInput handles pointer and wheel input on the canvas. Coordinates are
// local to the element; the last painted view maps them to image pixels.
func (a *app) splitInput(ev ui.InputEvent, st *splitState) bool {
	if a.busy {
		return false
	}
	switch ev.Kind {
	case ui.InputPointerDown:
		panning := ev.Button == 2 || ev.Mods&ui.Shift != 0 || st.space
		if ev.Button == 0 && !panning {
			if axis, idx, ok := st.hitLine(ev.X, ev.Y); ok {
				if ev.Clicks >= 2 {
					st.removeLine(axis, idx)
					a.resetOp(output.Split)
					return true
				}
				st.dragAxis, st.dragIndex = axis, idx
				return true
			}
			if st.mode == splitPan {
				st.startPan(ev.X, ev.Y)
				return true
			}
			if st.addLine(ev.X, ev.Y, ev.Mods&ui.Alt != 0) {
				a.resetOp(output.Split)
			}
			return true
		}
		st.startPan(ev.X, ev.Y)
		return true
	case ui.InputPointerMove:
		if st.panning {
			st.panTo(ev.X, ev.Y)
			return true
		}
		if st.dragAxis != 0 {
			if st.dragLine(ev.X, ev.Y) {
				a.resetOp(output.Split)
			}
			return true
		}
		st.updateHover(ev.X, ev.Y)
		return true
	case ui.InputPointerUp:
		wasActive := st.dragAxis != 0 || st.panning
		st.panning = false
		st.dragAxis = 0
		return wasActive
	case ui.InputScroll:
		if ev.DY == 0 {
			return false
		}
		st.zoomBy(ev.X, ev.Y, float32(math.Pow(1.0015, -float64(ev.DY))))
		return true
	case ui.InputKeyDown:
		if ev.Key == ui.KeySpace && !ev.Repeat {
			st.space = true
			return true
		}
	case ui.InputKeyUp:
		if ev.Key == ui.KeySpace {
			st.space = false
			return true
		}
	}
	return false
}

// point maps canvas coordinates to source pixels.
func (st *splitState) point(x, y float32) (px, py float32) {
	v := st.view
	scale := v.imageToScreen(st.imgW)
	if scale == 0 {
		return 0, 0
	}
	return (x - v.panX) / scale, (y - v.panY) / scale
}

func (st *splitState) hitLine(x, y float32) (axis, index int, ok bool) {
	const tolerance = 8
	v := st.view
	scale := v.imageToScreen(st.imgW)
	if scale == 0 {
		return 0, 0, false
	}
	offsetX := x - v.panX
	offsetY := y - v.panY
	if i, d := nearestLine(st.cutX, offsetX, scale); d <= tolerance {
		return 1, i, true
	}
	if i, d := nearestLine(st.cutY, offsetY, scale); d <= tolerance {
		return 2, i, true
	}
	return 0, 0, false
}

func nearestLine(lines []int, offset, scale float32) (int, float32) {
	best, bestDist := 0, float32(math.MaxFloat32)
	for i, cut := range lines {
		d := absf(offset - float32(cut)*scale)
		if d < bestDist {
			best, bestDist = i, d
		}
	}
	return best, bestDist
}

func absf(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}

// snapValue aligns v to another line within a few screen pixels.
func (st *splitState) snapValue(v, axis, skip int) int {
	if !st.snap {
		return v
	}
	scale := st.view.imageToScreen(st.imgW)
	if scale <= 0 {
		return v
	}
	tolerance := int(math.Ceil(8 / float64(scale)))
	lines := st.cutX
	if axis == 2 {
		lines = st.cutY
	}
	best, bestDist := v, tolerance+1
	for i, t := range lines {
		if i == skip {
			continue
		}
		d := v - t
		if d < 0 {
			d = -d
		}
		if d < bestDist {
			best, bestDist = t, d
		}
	}
	if bestDist <= tolerance {
		return best
	}
	return v
}

func (st *splitState) addLine(x, y float32, invert bool) bool {
	horizontal := st.mode == splitHorizontal
	if invert {
		horizontal = !horizontal
	}
	px, py := st.point(x, y)
	if horizontal {
		if py < 0 || py > float32(st.imgH) {
			return false
		}
		v := clampInt(int(math.Round(float64(py))), 1, st.imgH-1)
		v = st.snapValue(v, 2, -1)
		if containsInt(st.cutY, v) {
			return false
		}
		st.cutY = append(st.cutY, v)
		sortInts(st.cutY)
		return true
	}
	if px < 0 || px > float32(st.imgW) {
		return false
	}
	v := clampInt(int(math.Round(float64(px))), 1, st.imgW-1)
	v = st.snapValue(v, 1, -1)
	if containsInt(st.cutX, v) {
		return false
	}
	st.cutX = append(st.cutX, v)
	sortInts(st.cutX)
	return true
}

func (st *splitState) removeLine(axis, index int) {
	if axis == 1 && index >= 0 && index < len(st.cutX) {
		st.cutX = append(st.cutX[:index], st.cutX[index+1:]...)
	}
	if axis == 2 && index >= 0 && index < len(st.cutY) {
		st.cutY = append(st.cutY[:index], st.cutY[index+1:]...)
	}
}

func (st *splitState) dragLine(x, y float32) bool {
	px, py := st.point(x, y)
	lines, size := st.cutX, st.imgW
	if st.dragAxis == 2 {
		lines, size = st.cutY, st.imgH
	}
	if st.dragIndex < 0 || st.dragIndex >= len(lines) {
		return false
	}
	lo, hi := 1, size-1
	if st.dragIndex > 0 {
		lo = lines[st.dragIndex-1] + 1
	}
	if st.dragIndex < len(lines)-1 {
		hi = lines[st.dragIndex+1] - 1
	}
	raw := int(math.Round(float64(px)))
	if st.dragAxis == 2 {
		raw = int(math.Round(float64(py)))
	}
	v := clampInt(st.snapValue(raw, st.dragAxis, st.dragIndex), lo, hi)
	if v == lines[st.dragIndex] {
		return false
	}
	lines[st.dragIndex] = v
	return true
}

func (st *splitState) updateHover(x, y float32) {
	axis, idx, ok := st.hitLine(x, y)
	if !ok {
		axis, idx = 0, 0
	}
	st.hoverAxis, st.hoverIndex = axis, idx
}

func (st *splitState) startPan(x, y float32) {
	if st.view.zoom > 0 {
		st.zoom, st.panX, st.panY = st.view.zoom, st.view.panX, st.view.panY
	}
	st.panning = true
	st.lastX, st.lastY = x, y
}

func (st *splitState) panTo(x, y float32) {
	st.panX += x - st.lastX
	st.panY += y - st.lastY
	st.lastX, st.lastY = x, y
}

func (st *splitState) zoomBy(x, y, factor float32) {
	v := st.view
	if v.zoom <= 0 {
		return
	}
	next := clampFloat(v.zoom*factor, 0.02, 16)
	if next == v.zoom {
		return
	}
	ratio := next / v.zoom
	st.zoom = next
	st.panX = x - (x-v.panX)*ratio
	st.panY = y - (y-v.panY)*ratio
}

func clampInt(v, lo, hi int) int {
	if hi < lo {
		return lo
	}
	return min(max(v, lo), hi)
}

func clampFloat(v, lo, hi float32) float32 {
	return min(max(v, lo), hi)
}

func containsInt(values []int, v int) bool {
	for _, item := range values {
		if item == v {
			return true
		}
	}
	return false
}

func sortInts(values []int) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

func (a *app) splitActionBar(c *ui.Context) {
	t := c.Theme()
	g, err := a.splitGrid()
	summary := a.summaries[output.Split]
	if a.busy {
		summary = "正在切割…"
	} else if summary == "" {
		if err != nil {
			summary = err.Error()
		} else {
			summary = fmt.Sprintf("%d 行 × %d 列 · %d 片", g.Rows(), g.Cols(), len(g.Tiles()))
		}
	}
	ui.Column(c).FillWidth().Padding(t.Space(2), t.Space(3), t.Space(3), t.Space(3)).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
			components.Text(c, "滚轮缩放 · 拖动切割线 · 双击删除").FontSize(11).TextColor(t.TextMuted).Shrink(0)
			components.Text(c, summary).FontSize(12).TextColor(t.TextMuted).Grow(1).MinWidth(0).SingleLine()
			if a.busy {
				if components.Button(c, "取消", components.ButtonSecondary).Clicked() {
					a.cancelRun()
				}
				return
			}
			disabled := err != nil || a.split == nil || a.split.bitmap == nil
			label := "开始切割"
			if !disabled {
				label = fmt.Sprintf("开始切割 (%d 片)", len(g.Tiles()))
			}
			if components.Button(c, label, components.ButtonPrimary).Disabled(disabled).Clicked() {
				a.startSplit()
			}
		})
	})
}
