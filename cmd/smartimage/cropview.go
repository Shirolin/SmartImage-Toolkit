package main

import (
	"fmt"
	"image"
	"math"

	"github.com/disintegration/imaging"
	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/components"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/cropaspect"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
)

// maxCropProbe caps the copy kept for subject detection, so changing the
// tolerance never decodes the file again.
const maxCropProbe = 512

// Canvas limits. Zoom starts at fit (1) and the frame may shrink to a small
// share of the picture, which is what cutting one cell out of a sheet needs.
const (
	cropMinZoom  = 1.0
	cropMaxZoom  = 8.0
	cropMinScale = 0.02
	cropMinFrame = 8 // source pixels
)

// cropHandle is what a pointer drag on the canvas grabbed.
type cropHandle int

const (
	cropNone cropHandle = iota
	cropMove
	cropPan
	cropN
	cropS
	cropW
	cropE
	cropNW
	cropNE
	cropSW
	cropSE
)

// cropPreview is the image shown behind the crop frame. The frame is a
// fraction of the source, which is what the batch run uses for every file.
type cropPreview struct {
	item   *fileItem // the image picked in the preview select
	shown  *fileItem // the image the bitmap belongs to, decoding behind item
	bitmap *ui.Bitmap
	imgW   int
	imgH   int
	dispW  int
	dispH  int
	probe  image.Image

	// subject is the detected content box on the probe; hasSubject is false
	// when the border is not uniform enough to find one.
	subject    image.Rectangle
	hasSubject bool

	// box is the canvas rect from the last paint; draw is where the source
	// went inside it, after zoom and pan. Input maps back through draw.
	box   ui.Rect
	draw  ui.Rect
	hover cropHandle
	drag  cropHandle

	// A drag keeps the gesture's starting frame and pointer, so every move
	// is measured from the press instead of accumulating rounding.
	dragRect image.Rectangle
	dragX    float64
	dragY    float64
	dragMX   float32
	dragMY   float32
	dragPanX float32
	dragPanY float32
	dragging bool
}

func (st *cropPreview) detect(threshold int) {
	st.hasSubject = false
	st.subject = image.Rectangle{}
	if st.probe == nil {
		return
	}
	b := st.probe.Bounds()
	cuts := trim.Detect(st.probe, threshold)
	if cuts.Empty() {
		return
	}
	st.subject = image.Rect(cuts.Left, cuts.Top, b.Dx()-cuts.Right, b.Dy()-cuts.Bottom)
	st.hasSubject = st.subject.Dx() > 0 && st.subject.Dy() > 0
}

// subjectCenter is the middle of the detected box as a fraction of the source.
func (st *cropPreview) subjectCenter() (fx, fy float64) {
	if !st.hasSubject || st.probe == nil {
		return 0.5, 0.5
	}
	b := st.probe.Bounds()
	return (float64(st.subject.Min.X) + float64(st.subject.Dx())/2) / float64(b.Dx()),
		(float64(st.subject.Min.Y) + float64(st.subject.Dy())/2) / float64(b.Dy())
}

// selectCropItem switches the preview to another queued image. The preview
// struct stays put: the select binds to its item field, and a fresh struct
// would leave the select writing into an abandoned one.
func (a *app) selectCropItem(item *fileItem) {
	if item == nil {
		return
	}
	st := a.cropPreview
	if st == nil {
		st = &cropPreview{}
		a.cropPreview = st
	}
	st.item = item
	a.previewSel.Clear()
	a.previewSel.Add(item.path)
	if st.shown == item && st.bitmap != nil {
		return
	}
	gen := a.gen
	go func() {
		img, err := imageio.DecodeFile(item.path)
		if err != nil {
			a.update(func() {
				if a.cropPreview == st {
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
		probe := imaging.Fit(img, maxCropProbe, maxCropProbe, imaging.Lanczos)
		db := display.Bounds()
		bmp := ui.NewBitmap(display)
		a.update(func() {
			// A newer pick (or a cleared queue) makes this decode stale; the
			// old bitmap stays up until the chosen one is ready.
			if a.cropPreview != st || gen != a.gen || st.item != item {
				bmp.ReleasePixels()
				return
			}
			if st.bitmap != nil && st.bitmap != bmp {
				st.bitmap.ReleasePixels()
			}
			st.shown = item
			st.bitmap = bmp
			st.imgW, st.imgH = origW, origH
			st.dispW, st.dispH = db.Dx(), db.Dy()
			st.probe = probe
			a.cropZoom, a.cropPanX, a.cropPanY = cropMinZoom, 0, 0
			st.detect(int(math.Round(a.cropThreshold)))
			if a.cropAnchor == anchorSubject {
				a.centerCropOnSubject()
			}
		})
	}()
}

// syncCropSelection makes the queue's chosen row the previewed image. The
// list is given a selection only on this page; elsewhere its rows stay plain.
func (a *app) syncCropSelection() {
	a.list.Selection = &a.previewSel
	chosen := ""
	for k := range a.previewSel.All() {
		if path, ok := k.(string); ok {
			chosen = path
		}
	}
	st := a.cropPreview
	if chosen == "" {
		if st != nil && st.item != nil {
			a.previewSel.Add(st.item.path)
		}
		return
	}
	if st != nil && st.item != nil && st.item.path == chosen {
		return
	}
	for _, f := range a.files {
		if f.path == chosen {
			a.selectCropItem(f)
			return
		}
	}
}

// ensureCropPreview keeps the preview pointed at a file still in the queue.
func (a *app) ensureCropPreview() {
	for _, f := range a.files {
		if a.cropPreview != nil && a.cropPreview.item == f {
			return
		}
	}
	a.releaseCropPreview()
	if len(a.files) > 0 {
		a.selectCropItem(a.files[0])
	}
}

// syncCropPreview drops the preview when its image left the queue.
func (a *app) syncCropPreview() {
	if a.cropPreview == nil {
		return
	}
	for _, f := range a.files {
		if a.cropPreview.item == f {
			return
		}
	}
	a.releaseCropPreview()
}

func (a *app) releaseCropPreview() {
	if a.cropPreview != nil && a.cropPreview.bitmap != nil {
		a.cropPreview.bitmap.ReleasePixels()
	}
	a.cropPreview = nil
}

// centerCropOnSubject moves the frame onto the detected subject, falling back
// to the frame centre when there is none.
func (a *app) centerCropOnSubject() {
	if a.cropPreview == nil {
		return
	}
	a.cropFX, a.cropFY = a.cropPreview.subjectCenter()
}

func (a *app) setCropAnchor(v cropAnchor) {
	a.cropAnchor = v
	switch v {
	case anchorFrame:
		a.cropFX, a.cropFY = 0.5, 0.5
	case anchorSubject:
		a.centerCropOnSubject()
	}
	a.resetOp(output.CropAspect)
}

// refreshCropSubject re-runs detection after the tolerance changed.
func (a *app) refreshCropSubject() {
	if st := a.cropPreview; st != nil {
		st.detect(int(math.Round(a.cropThreshold)))
		if a.cropAnchor == anchorSubject {
			a.centerCropOnSubject()
		}
	}
	a.resetOp(output.CropAspect)
}

// frameSizeIn is the crop size in source pixels: the pixel tab's insets, or
// the ratio's largest rect times the frame scale.
func (a *app) frameSizeIn(w, h int) (int, int) {
	if a.crop == cropPixels {
		c := a.cropConfig()
		return w - c.Left - c.Right, h - c.Top - c.Bottom
	}
	aw, ah := a.cropRatio()
	return cropaspect.FrameSize(w, h, aw, ah, a.cropScale)
}

// frameSrcRect is the crop as source pixels, which the canvas and the drag
// gestures both work in.
func (a *app) frameSrcRect(w, h int) (image.Rectangle, bool) {
	fw, fh := a.frameSizeIn(w, h)
	if fw < 1 || fh < 1 {
		return image.Rectangle{}, false
	}
	if a.crop == cropPixels {
		c := a.cropConfig()
		return image.Rect(c.Left, c.Top, c.Left+fw, c.Top+fh), true
	}
	return cropaspect.RectAt(image.Rect(0, 0, w, h), fw, fh, a.cropFX, a.cropFY), true
}

// cropFrameSize is the source-pixel size of the frame.
func (a *app) cropFrameSize() (int, int) {
	st := a.cropPreview
	if st == nil {
		return 0, 0
	}
	return a.frameSizeIn(st.imgW, st.imgH)
}

// cropFrameRect maps the crop to canvas coordinates.
func (a *app) cropFrameRect(draw ui.Rect) (ui.Rect, bool) {
	st := a.cropPreview
	if st == nil || st.imgW < 1 || st.imgH < 1 || draw.W <= 0 {
		return ui.Rect{}, false
	}
	src, ok := a.frameSrcRect(st.imgW, st.imgH)
	if !ok {
		return ui.Rect{}, false
	}
	scale := draw.W / float32(st.imgW)
	return ui.Rect{
		X: draw.X + float32(src.Min.X)*scale,
		Y: draw.Y + float32(src.Min.Y)*scale,
		W: float32(src.Dx()) * scale,
		H: float32(src.Dy()) * scale,
	}, true
}

// cropBarStrip is the canvas band kept clear for the zoom buttons, so the
// picture and its handles never sit under them.
const cropBarStrip = 30

// cropImageRect places the source on the canvas: fit inside the box, then the
// wheel zoom, then the pan from dragging the empty canvas.
func (a *app) cropImageRect(box ui.Rect) ui.Rect {
	st := a.cropPreview
	const pad = 14
	height := box.H
	if height > cropBarStrip+80 {
		height -= cropBarStrip
	}
	fit := min((box.W-pad*2)/float32(st.dispW), (height-pad*2)/float32(st.dispH))
	scale := fit * float32(max(a.cropZoom, cropMinZoom))
	dw, dh := float32(st.dispW)*scale, float32(st.dispH)*scale
	return ui.Rect{
		X: box.X + (box.W-dw)/2 + a.cropPanX,
		Y: box.Y + (height-dh)/2 + a.cropPanY,
		W: dw,
		H: dh,
	}
}

// clampCropPan keeps part of the zoomed image on the canvas.
func (a *app) clampCropPan() {
	st := a.cropPreview
	if st == nil || st.box.W <= 0 {
		return
	}
	a.cropZoom = clampFloat64(a.cropZoom, cropMinZoom, cropMaxZoom)
	panX, panY := a.cropPanX, a.cropPanY
	a.cropPanX, a.cropPanY = 0, 0
	base := a.cropImageRect(st.box)
	a.cropPanX, a.cropPanY = panX, panY
	limitX := max(0, (base.W-st.box.W)/2)
	limitY := max(0, (base.H-st.box.H)/2)
	a.cropPanX = clampFloat32(a.cropPanX, -limitX, limitX)
	a.cropPanY = clampFloat32(a.cropPanY, -limitY, limitY)
}

func (a *app) cropCanvas(c *ui.Context) {
	t := c.Theme()
	st := a.cropPreview
	canvas := ui.RGB(0x17, 0x16, 0x14)
	if !t.Dark {
		canvas = ui.RGB(0xDE, 0xDA, 0xD3)
	}
	cursor := ui.CursorDefault
	switch {
	case st != nil && st.dragging && st.drag == cropPan:
		cursor = ui.CursorGrabbing
	case st != nil && st.dragging:
		cursor = ui.CursorGrabbing
	case st != nil && st.hover != cropNone:
		cursor = cropHandleCursor(st.hover)
	case a.cropZoom > cropMinZoom:
		cursor = ui.CursorGrab
	}
	e := ui.Box(c).FillWidth().Grow(3).MinHeight(120).MaxHeight(400).Clip().Radius(t.Radius).
		Background(canvas).Border(1, t.Border.Alpha(0.6)).Cursor(cursor)
	if st == nil || st.bitmap == nil {
		e.Children(func() {
			ui.Column(c).Fill().Center().Children(func() {
				components.Text(c, "正在载入预览…").FontSize(13).TextColor(t.TextMuted)
			})
		})
		return
	}
	e.Focusable()
	e.DrawOver(func(p *ui.Painter, r ui.Rect) {
		p.Clip(r, t.Radius, func() { a.paintCrop(p, r, t) })
	})
	e.HandleInput(func(ev ui.InputEvent) bool { return a.cropInput(ev) })
}

func cropHandleCursor(h cropHandle) ui.Cursor {
	switch h {
	case cropNW, cropSE:
		return ui.CursorResizeNWSE
	case cropNE, cropSW:
		return ui.CursorResizeNESW
	case cropN, cropS:
		return ui.CursorResizeNS
	case cropW, cropE:
		return ui.CursorResizeEW
	case cropMove:
		return ui.CursorMove
	}
	return ui.CursorDefault
}

func (a *app) paintCrop(p *ui.Painter, r ui.Rect, t *ui.Theme) {
	st := a.cropPreview
	st.box = r
	draw := a.cropImageRect(r)
	st.draw = draw
	p.Image(st.bitmap, draw, ui.FillBox)
	p.Stroke(draw, t.Text.Alpha(0.25), 0, 1)

	rect, ok := a.cropFrameRect(draw)
	if !ok {
		return
	}
	// Dim what the frame cuts away, keeping the kept area untouched.
	dim := ui.RGBA(0, 0, 0, 0.42)
	top := max(0, rect.Y-draw.Y)
	bottom := max(0, draw.Y+draw.H-(rect.Y+rect.H))
	left := max(0, rect.X-draw.X)
	right := max(0, draw.X+draw.W-(rect.X+rect.W))
	if top > 0 {
		p.Fill(ui.Rect{X: draw.X, Y: draw.Y, W: draw.W, H: top}, dim, 0)
	}
	if bottom > 0 {
		p.Fill(ui.Rect{X: draw.X, Y: rect.Y + rect.H, W: draw.W, H: bottom}, dim, 0)
	}
	if left > 0 {
		p.Fill(ui.Rect{X: draw.X, Y: rect.Y, W: left, H: rect.H}, dim, 0)
	}
	if right > 0 {
		p.Fill(ui.Rect{X: rect.X + rect.W, Y: rect.Y, W: right, H: rect.H}, dim, 0)
	}
	p.Stroke(rect, t.Accent, 0, 2)

	// Show what the subject anchor found, so the tolerance is not a blind
	// dial. It is drawn over the dim, or the detection would be invisible
	// whenever the subject straddles the frame edge.
	if a.crop != cropPixels && st.hasSubject {
		b := st.probe.Bounds()
		sx := draw.X + float32(st.subject.Min.X)/float32(b.Dx())*draw.W
		sy := draw.Y + float32(st.subject.Min.Y)/float32(b.Dy())*draw.H
		sw := float32(st.subject.Dx()) / float32(b.Dx()) * draw.W
		sh := float32(st.subject.Dy()) / float32(b.Dy()) * draw.H
		box := ui.Rect{X: sx, Y: sy, W: sw, H: sh}
		p.StrokeDashed(box, t.Warning.Alpha(0.9), 0, 1)
		// Bottom-right of the box keeps the label clear of the size pill,
		// which sits at the frame's top-left. The plate keeps it readable
		// over whatever the subject happens to be.
		const label = "主体"
		lw := float32(len([]rune(label))) * 10.5
		plate := ui.Rect{X: box.X + box.W - lw - 10, Y: box.Y + box.H - 19, W: lw + 8, H: 15}
		p.Fill(plate, ui.RGBA(0, 0, 0, 0.55), 3)
		p.Text(plate.X+4, plate.Y+2.5, label, 10.5, t.Warning)
	}

	if label, ok := a.cropSizeLabel(); ok {
		pill := ui.Rect{X: rect.X + 6, Y: rect.Y + 6, W: float32(len([]rune(label)))*6.5 + 12, H: 18}
		p.Fill(pill, ui.RGBA(0, 0, 0, 0.62), 4)
		p.Text(pill.X+6, pill.Y+3.5, label, 11, ui.RGB(0xF4, 0xF4, 0xF5))
	}
	a.paintCropHandles(p, rect, t)
	a.paintCropZoom(p, r, t)
}

// cropZoomBar lays out the canvas' zoom buttons in its bottom-right corner.
func cropZoomBar(r ui.Rect) (minus, label, plus ui.Rect) {
	const h, gap, margin = 20, 2, 10
	plus = ui.Rect{X: r.X + r.W - margin - 22, Y: r.Y + r.H - margin - h, W: 22, H: h}
	label = ui.Rect{X: plus.X - gap - 46, Y: plus.Y, W: 46, H: h}
	minus = ui.Rect{X: label.X - gap - 22, Y: plus.Y, W: 22, H: h}
	return minus, label, plus
}

func (a *app) paintCropZoom(p *ui.Painter, r ui.Rect, t *ui.Theme) {
	minus, label, plus := cropZoomBar(r)
	bg := ui.RGBA(0, 0, 0, 0.55)
	for _, box := range []ui.Rect{minus, label, plus} {
		p.Fill(box, bg, 4)
	}
	fg := ui.RGB(0xF4, 0xF4, 0xF5)
	p.Text(minus.X+8, minus.Y+4, "−", 12, fg)
	p.Text(plus.X+8, plus.Y+4, "+", 12, fg)
	text := fmt.Sprintf("%d%%", int(math.Round(a.cropZoom*100)))
	p.Text(label.X+float32(46-len([]rune(text))*6)/2, label.Y+3.5, text, 11, fg)
}

// paintCropHandles draws the eight grab points, which are what makes the
// frame resizable rather than only movable. The one under the pointer fills
// in, so a handle reads as a target before it is grabbed.
func (a *app) paintCropHandles(p *ui.Painter, rect ui.Rect, t *ui.Theme) {
	const size = 7
	cx, cy := rect.X+rect.W/2, rect.Y+rect.H/2
	for _, spot := range []struct {
		h    cropHandle
		x, y float32
	}{
		{cropNW, rect.X, rect.Y}, {cropN, cx, rect.Y}, {cropNE, rect.X + rect.W, rect.Y},
		{cropW, rect.X, cy}, {cropE, rect.X + rect.W, cy},
		{cropSW, rect.X, rect.Y + rect.H}, {cropS, cx, rect.Y + rect.H},
		{cropSE, rect.X + rect.W, rect.Y + rect.H},
	} {
		box := ui.Rect{X: spot.x - size/2, Y: spot.y - size/2, W: size, H: size}
		if a.cropPreview.hover == spot.h || a.cropPreview.drag == spot.h {
			p.Fill(box, t.Accent, 2)
			continue
		}
		p.Fill(box, t.Background, 2)
		p.Stroke(box, t.Accent, 2, 1.5)
	}
}

// cropSizeLabel is what the frame cuts, and what it will write when the crop
// is also scaled, drawn on the frame.
func (a *app) cropSizeLabel() (string, bool) {
	st := a.cropPreview
	if st == nil {
		return "", false
	}
	src, ok := a.frameSrcRect(st.imgW, st.imgH)
	if !ok {
		return "", false
	}
	label := fmt.Sprintf("%d×%d", src.Dx(), src.Dy())
	if a.crop == cropPixels {
		return label, true
	}
	w, h, err := cropaspect.OutputSize(st.imgW, st.imgH, a.cropAspectConfig())
	if err == nil && (w != src.Dx() || h != src.Dy()) {
		label += fmt.Sprintf(" → %d×%d", w, h)
	}
	return label, true
}

// cropInput drives the canvas: wheel zooms, dragging a handle resizes, the
// frame moves, and the empty canvas pans once zoomed in. Double-clicking
// returns to fit.
func (a *app) cropInput(ev ui.InputEvent) bool {
	st := a.cropPreview
	if st == nil || st.bitmap == nil || a.busy {
		return false
	}
	// The engine reports the pointer relative to the element, while the box,
	// the picture and the frame are held in the canvas' coordinates.
	ev.X += st.box.X
	ev.Y += st.box.Y
	switch ev.Kind {
	case ui.InputScroll:
		return a.zoomCrop(ev.X, ev.Y, ev.DY)
	case ui.InputPointerDown:
		if ev.Clicks >= 2 {
			st.dragging, st.drag = false, cropNone
			a.cropZoom, a.cropPanX, a.cropPanY = cropMinZoom, 0, 0
			a.invalidate()
			return true
		}
		// Handles win over the zoom buttons, the buttons win over the frame's
		// body, so neither steals the other's press.
		h := a.cropHit(ev.X, ev.Y)
		if h != cropNone && h != cropMove {
			st.hover = h
			return a.beginCropDrag(h, ev.X, ev.Y)
		}
		if a.cropZoomClick(ev.X, ev.Y) {
			return true
		}
		if h == cropNone {
			if a.cropZoom <= cropMinZoom {
				return false
			}
			h = cropPan
		}
		st.hover = h
		return a.beginCropDrag(h, ev.X, ev.Y)
	case ui.InputPointerMove:
		if !st.dragging {
			h := a.cropHit(ev.X, ev.Y)
			if h != st.hover {
				st.hover = h
				a.invalidate()
			}
			return false
		}
		return a.dragCrop(ev.X, ev.Y)
	case ui.InputPointerUp:
		was := st.dragging
		st.dragging, st.drag = false, cropNone
		// The pointer usually rests where the drag ended; the handle under it
		// keeps its highlight instead of waiting for the next move.
		st.hover = a.cropHit(ev.X, ev.Y)
		if was {
			a.invalidate()
		}
		return was
	}
	return false
}

func (a *app) invalidate() {
	if a.win != nil {
		a.win.Invalidate()
	}
}

// cropZoomClick applies a press on the canvas' zoom buttons.
func (a *app) cropZoomClick(x, y float32) bool {
	st := a.cropPreview
	if st == nil || st.box.W <= 0 {
		return false
	}
	minus, _, plus := cropZoomBar(st.box)
	switch {
	case insideRect(minus, x, y):
		return a.stepCropZoom(1 / 1.5)
	case insideRect(plus, x, y):
		return a.stepCropZoom(1.5)
	}
	return false
}

// stepCropZoom zooms about the canvas centre, for the buttons and the cases a
// wheel is not available.
func (a *app) stepCropZoom(factor float64) bool {
	st := a.cropPreview
	if st == nil || st.box.W <= 0 || st.draw.W <= 0 {
		return false
	}
	next := clampFloat64(max(a.cropZoom, cropMinZoom)*factor, cropMinZoom, cropMaxZoom)
	if math.Abs(next-a.cropZoom) < 1e-9 {
		return false
	}
	cx := st.draw.X + st.draw.W/2
	cy := st.draw.Y + st.draw.H/2
	fx := float64((cx - st.draw.X) / st.draw.W)
	fy := float64((cy - st.draw.Y) / st.draw.H)
	a.cropZoom = next
	a.cropPanX, a.cropPanY = 0, 0
	draw := a.cropImageRect(st.box)
	a.cropPanX = cx - (draw.X + float32(fx)*draw.W)
	a.cropPanY = cy - (draw.Y + float32(fy)*draw.H)
	a.clampCropPan()
	a.invalidate()
	return true
}

func insideRect(r ui.Rect, x, y float32) bool {
	return x >= r.X && x <= r.X+r.W && y >= r.Y && y <= r.Y+r.H
}

// zoomCrop scales about the pointer, so the pixel under the cursor stays put.
func (a *app) zoomCrop(x, y, dy float32) bool {
	st := a.cropPreview
	if st == nil || st.box.W <= 0 || st.draw.W <= 0 || dy == 0 {
		return false
	}
	step := 1.2
	if dy > 0 {
		step = 1 / step
	}
	next := clampFloat64(max(a.cropZoom, cropMinZoom)*step, cropMinZoom, cropMaxZoom)
	if math.Abs(next-a.cropZoom) < 1e-9 {
		return false
	}
	fx := float64((x - st.draw.X) / st.draw.W)
	fy := float64((y - st.draw.Y) / st.draw.H)
	a.cropZoom = next
	a.cropPanX, a.cropPanY = 0, 0
	draw := a.cropImageRect(st.box)
	a.cropPanX = x - (draw.X + float32(fx)*draw.W)
	a.cropPanY = y - (draw.Y + float32(fy)*draw.H)
	a.clampCropPan()
	a.invalidate()
	return true
}

// cropHit reports what sits under a canvas point, handles first because they
// overhang the frame's edges.
func (a *app) cropHit(x, y float32) cropHandle {
	st := a.cropPreview
	rect, ok := a.cropFrameRect(st.draw)
	if !ok {
		return cropNone
	}
	const grab = 11
	cx, cy := rect.X+rect.W/2, rect.Y+rect.H/2
	for _, spot := range []struct {
		h    cropHandle
		x, y float32
	}{
		{cropNW, rect.X, rect.Y}, {cropN, cx, rect.Y}, {cropNE, rect.X + rect.W, rect.Y},
		{cropW, rect.X, cy}, {cropE, rect.X + rect.W, cy},
		{cropSW, rect.X, rect.Y + rect.H}, {cropS, cx, rect.Y + rect.H},
		{cropSE, rect.X + rect.W, rect.Y + rect.H},
	} {
		if abs32(x-spot.x) <= grab && abs32(y-spot.y) <= grab {
			return spot.h
		}
	}
	if x >= rect.X && x <= rect.X+rect.W && y >= rect.Y && y <= rect.Y+rect.H {
		return cropMove
	}
	return cropNone
}

// cropSourcePoint maps a canvas point to source pixels, unclamped so a drag
// can run past the image edge and clamp where it lands.
func (a *app) cropSourcePoint(x, y float32) (float64, float64) {
	st := a.cropPreview
	if st.draw.W <= 0 || st.draw.H <= 0 {
		return 0, 0
	}
	return float64(x-st.draw.X) / float64(st.draw.W) * float64(st.imgW),
		float64(y-st.draw.Y) / float64(st.draw.H) * float64(st.imgH)
}

func (a *app) beginCropDrag(h cropHandle, x, y float32) bool {
	st := a.cropPreview
	if h == cropPan {
		st.dragging, st.drag = true, cropPan
		st.dragMX, st.dragMY = x, y
		st.dragPanX, st.dragPanY = a.cropPanX, a.cropPanY
		return true
	}
	src, ok := a.frameSrcRect(st.imgW, st.imgH)
	if !ok {
		return false
	}
	st.dragging, st.drag = true, h
	st.dragRect = src
	st.dragX, st.dragY = a.cropSourcePoint(x, y)
	return true
}

func (a *app) dragCrop(x, y float32) bool {
	st := a.cropPreview
	switch st.drag {
	case cropPan:
		a.cropPanX = st.dragPanX + (x - st.dragMX)
		a.cropPanY = st.dragPanY + (y - st.dragMY)
		a.clampCropPan()
		return true
	case cropMove:
		px, py := a.cropSourcePoint(x, y)
		dx := int(math.Round(px - st.dragX))
		dy := int(math.Round(py - st.dragY))
		next := st.dragRect.Add(image.Pt(dx, dy))
		return a.setFrameRect(clampRectInside(next, image.Pt(st.imgW, st.imgH)))
	case cropNone:
		return false
	default:
		px, py := a.cropSourcePoint(x, y)
		return a.setFrameRect(a.resizeFrameRect(st.dragRect, st.drag, px, py))
	}
}

// resizeFrameRect moves the edges a handle owns. The ratio tab keeps the
// chosen ratio around its anchors; the pixel tab moves each edge on its own,
// which is exactly what the inset fields say.
func (a *app) resizeFrameRect(start image.Rectangle, h cropHandle, px, py float64) image.Rectangle {
	st := a.cropPreview
	w, hgt := st.imgW, st.imgH
	left := h == cropW || h == cropNW || h == cropSW
	right := h == cropE || h == cropNE || h == cropSE
	top := h == cropN || h == cropNW || h == cropNE
	bottom := h == cropS || h == cropSW || h == cropSE

	if a.crop == cropPixels {
		x0, y0 := float64(start.Min.X), float64(start.Min.Y)
		x1, y1 := float64(start.Max.X), float64(start.Max.Y)
		if left {
			x0 = clampFloat64(px, 0, x1-cropMinFrame)
		}
		if right {
			x1 = clampFloat64(px, x0+cropMinFrame, float64(w))
		}
		if top {
			y0 = clampFloat64(py, 0, y1-cropMinFrame)
		}
		if bottom {
			y1 = clampFloat64(py, y0+cropMinFrame, float64(hgt))
		}
		return image.Rect(int(math.Round(x0)), int(math.Round(y0)), int(math.Round(x1)), int(math.Round(y1)))
	}

	aw, ah := a.cropRatio()
	ratio := float64(aw) / float64(ah)
	// The edges that stay put.
	ax := (float64(start.Min.X) + float64(start.Max.X)) / 2
	ay := (float64(start.Min.Y) + float64(start.Max.Y)) / 2
	if left {
		ax = float64(start.Max.X)
	}
	if right {
		ax = float64(start.Min.X)
	}
	if top {
		ay = float64(start.Max.Y)
	}
	if bottom {
		ay = float64(start.Min.Y)
	}

	// The width the pointer asks for, on whichever axis it moved.
	var want float64
	switch {
	case left || right:
		want = abs64(px - ax)
		if (top || bottom) && (h == cropNW || h == cropNE || h == cropSW || h == cropSE) {
			want = max(want, abs64(py-ay)*ratio)
		}
	case top || bottom:
		want = abs64(py-ay) * ratio
	}
	if want <= 0 {
		return start
	}

	// Stay inside the picture around those anchors.
	maxW := math.Min(float64(w), float64(hgt)*ratio)
	switch {
	case left:
		maxW = math.Min(maxW, ax)
	case right:
		maxW = math.Min(maxW, float64(w)-ax)
	default:
		maxW = math.Min(maxW, 2*math.Min(ax, float64(w)-ax))
	}
	switch {
	case top:
		maxW = math.Min(maxW, ay*ratio)
	case bottom:
		maxW = math.Min(maxW, (float64(hgt)-ay)*ratio)
	default:
		maxW = math.Min(maxW, 2*math.Min(ay, float64(hgt)-ay)*ratio)
	}
	want = clampFloat64(want, cropMinFrame, maxW)
	nh := want / ratio

	x, y := ax-want/2, ay-nh/2
	if left {
		x = ax - want
	}
	if right {
		x = ax
	}
	if top {
		y = ay - nh
	}
	if bottom {
		y = ay
	}
	return image.Rect(int(math.Round(x)), int(math.Round(y)),
		int(math.Round(x+want)), int(math.Round(y+nh)))
}

// setFrameRect writes a dragged frame back to the tab that owns the numbers:
// the pixel tab's insets or the ratio tab's centre and frame scale.
func (a *app) setFrameRect(r image.Rectangle) bool {
	st := a.cropPreview
	if a.crop == cropPixels {
		left := clampFloat64(float64(r.Min.X), 0, float64(st.imgW-cropMinFrame))
		top := clampFloat64(float64(r.Min.Y), 0, float64(st.imgH-cropMinFrame))
		right := clampFloat64(float64(st.imgW-r.Max.X), 0, float64(st.imgW-cropMinFrame))
		bottom := clampFloat64(float64(st.imgH-r.Max.Y), 0, float64(st.imgH-cropMinFrame))
		if left == a.cropLeft && top == a.cropTop && right == a.cropRight && bottom == a.cropBottom {
			return false
		}
		a.cropLeft, a.cropTop, a.cropRight, a.cropBottom = left, top, right, bottom
		a.resetOp(output.Crop)
		return true
	}
	aw, ah := a.cropRatio()
	rw, _ := cropaspect.RatioSize(st.imgW, st.imgH, aw, ah)
	if rw < 1 {
		return false
	}
	scale := clampFloat64(float64(r.Dx())/float64(rw), cropMinScale, 1)
	fx := (float64(r.Min.X) + float64(r.Dx())/2) / float64(st.imgW)
	fy := (float64(r.Min.Y) + float64(r.Dy())/2) / float64(st.imgH)
	if scale == a.cropScale && fx == a.cropFX && fy == a.cropFY {
		return false
	}
	a.cropScale = scale
	a.cropFX, a.cropFY = fx, fy
	a.cropAnchor = anchorCustom
	a.resetOp(output.CropAspect)
	return true
}

// clampRectInside slides r back inside bounds without changing its size.
func clampRectInside(r image.Rectangle, size image.Point) image.Rectangle {
	dx := 0
	if r.Min.X < 0 {
		dx = -r.Min.X
	} else if r.Max.X > size.X {
		dx = size.X - r.Max.X
	}
	dy := 0
	if r.Min.Y < 0 {
		dy = -r.Min.Y
	} else if r.Max.Y > size.Y {
		dy = size.Y - r.Max.Y
	}
	return r.Add(image.Pt(dx, dy))
}

func clampFloat64(v, lo, hi float64) float64 {
	if hi < lo {
		return (lo + hi) / 2
	}
	return min(max(v, lo), hi)
}

func clampFloat32(v, lo, hi float32) float32 {
	if hi < lo {
		return (lo + hi) / 2
	}
	return min(max(v, lo), hi)
}

func abs32(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}

func abs64(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
