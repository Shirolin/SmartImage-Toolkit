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

// cropPreview is the image shown behind the crop frame. The frame itself is
// a fraction of the source, which is what the batch run uses for every file.
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

	// draw is where the last frame put the source; input maps back through it.
	draw     ui.Rect
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

// cropFrameSize is the source-pixel size of the ratio crop.
func (a *app) cropFrameSize() (int, int) {
	st := a.cropPreview
	if st == nil {
		return 0, 0
	}
	w, h := a.cropRatio()
	return cropaspect.RatioSize(st.imgW, st.imgH, w, h)
}

// cropFrameRect maps the crop to canvas coordinates.
func (a *app) cropFrameRect(draw ui.Rect) (ui.Rect, bool) {
	st := a.cropPreview
	if st == nil || st.imgW < 1 || st.imgH < 1 || draw.W <= 0 {
		return ui.Rect{}, false
	}
	var src image.Rectangle
	if a.crop == cropPixels {
		c := a.cropConfig()
		src = image.Rect(c.Left, c.Top, st.imgW-c.Right, st.imgH-c.Bottom)
		if src.Dx() < 1 || src.Dy() < 1 {
			return ui.Rect{}, false
		}
	} else {
		w, h := a.cropFrameSize()
		if w < 1 || h < 1 {
			return ui.Rect{}, false
		}
		src = cropaspect.RectAt(image.Rect(0, 0, st.imgW, st.imgH), w, h, a.cropFX, a.cropFY)
	}
	scale := draw.W / float32(st.imgW)
	return ui.Rect{
		X: draw.X + float32(src.Min.X)*scale,
		Y: draw.Y + float32(src.Min.Y)*scale,
		W: float32(src.Dx()) * scale,
		H: float32(src.Dy()) * scale,
	}, true
}

func (a *app) cropCanvas(c *ui.Context) {
	t := c.Theme()
	st := a.cropPreview
	canvas := ui.RGB(0x17, 0x16, 0x14)
	if !t.Dark {
		canvas = ui.RGB(0xDE, 0xDA, 0xD3)
	}
	cursor := ui.CursorDefault
	if a.crop == cropRatio {
		cursor = ui.CursorGrab
		if st != nil && st.dragging {
			cursor = ui.CursorGrabbing
		}
	}
	e := ui.Box(c).FillWidth().Grow(1).MinHeight(120).MaxHeight(400).Clip().Radius(t.Radius).
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

func (a *app) paintCrop(p *ui.Painter, r ui.Rect, t *ui.Theme) {
	st := a.cropPreview
	const pad = 14
	scale := min((r.W-pad*2)/float32(st.dispW), (r.H-pad*2)/float32(st.dispH))
	if scale <= 0 {
		return
	}
	dw, dh := float32(st.dispW)*scale, float32(st.dispH)*scale
	st.draw = ui.Rect{X: r.X + (r.W-dw)/2, Y: r.Y + (r.H-dh)/2, W: dw, H: dh}
	p.Image(st.bitmap, st.draw, ui.FillBox)
	p.Stroke(st.draw, t.Text.Alpha(0.25), 0, 1)

	rect, ok := a.cropFrameRect(st.draw)
	if !ok {
		return
	}
	// Dim what the frame cuts away, keeping the kept area untouched.
	dim := ui.RGBA(0, 0, 0, 0.42)
	top := rect.Y - st.draw.Y
	bottom := st.draw.Y + st.draw.H - (rect.Y + rect.H)
	left := rect.X - st.draw.X
	right := st.draw.X + st.draw.W - (rect.X + rect.W)
	if top > 0 {
		p.Fill(ui.Rect{X: st.draw.X, Y: st.draw.Y, W: st.draw.W, H: top}, dim, 0)
	}
	if bottom > 0 {
		p.Fill(ui.Rect{X: st.draw.X, Y: rect.Y + rect.H, W: st.draw.W, H: bottom}, dim, 0)
	}
	if left > 0 {
		p.Fill(ui.Rect{X: st.draw.X, Y: rect.Y, W: left, H: rect.H}, dim, 0)
	}
	if right > 0 {
		p.Fill(ui.Rect{X: rect.X + rect.W, Y: rect.Y, W: right, H: rect.H}, dim, 0)
	}
	p.Stroke(rect, t.Accent, 0, 2)

	// Show what the subject anchor found, so the tolerance is not a blind
	// dial. It is drawn over the dim, or the detection would be invisible
	// whenever the subject straddles the frame edge.
	if a.crop == cropRatio && st.hasSubject {
		b := st.probe.Bounds()
		sx := st.draw.X + float32(st.subject.Min.X)/float32(b.Dx())*st.draw.W
		sy := st.draw.Y + float32(st.subject.Min.Y)/float32(b.Dy())*st.draw.H
		sw := float32(st.subject.Dx()) / float32(b.Dx()) * st.draw.W
		sh := float32(st.subject.Dy()) / float32(b.Dy()) * st.draw.H
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
}

// cropSizeLabel is the output size drawn on the frame, or false when the
// parameters do not produce one.
func (a *app) cropSizeLabel() (string, bool) {
	st := a.cropPreview
	if st == nil {
		return "", false
	}
	if a.crop == cropPixels {
		c := a.cropConfig()
		w, h := st.imgW-c.Left-c.Right, st.imgH-c.Top-c.Bottom
		if w < 1 || h < 1 {
			return "", false
		}
		return fmt.Sprintf("%d×%d", w, h), true
	}
	w, h, err := cropaspect.OutputSize(st.imgW, st.imgH, a.cropAspectConfig())
	if err != nil {
		return "", false
	}
	return fmt.Sprintf("%d×%d", w, h), true
}

// cropInput drags the ratio frame; the pixel tab's frame follows its fields.
func (a *app) cropInput(ev ui.InputEvent) bool {
	st := a.cropPreview
	if st == nil || a.busy || a.crop == cropPixels {
		return false
	}
	switch ev.Kind {
	case ui.InputPointerDown:
		st.dragging = true
		a.moveCropFrame(ev.X, ev.Y)
		return true
	case ui.InputPointerMove:
		if !st.dragging {
			return false
		}
		a.moveCropFrame(ev.X, ev.Y)
		return true
	case ui.InputPointerUp:
		was := st.dragging
		st.dragging = false
		return was
	}
	return false
}

// moveCropFrame centres the frame on a canvas point, clamped so the frame
// stays inside the source.
func (a *app) moveCropFrame(x, y float32) bool {
	st := a.cropPreview
	if st == nil || st.draw.W <= 0 || st.draw.H <= 0 {
		return false
	}
	w, h := a.cropFrameSize()
	if w < 1 || h < 1 {
		return false
	}
	fx := float64((x - st.draw.X) / st.draw.W)
	fy := float64((y - st.draw.Y) / st.draw.H)
	fx = clampFloat64(fx, float64(w)/2/float64(st.imgW), 1-float64(w)/2/float64(st.imgW))
	fy = clampFloat64(fy, float64(h)/2/float64(st.imgH), 1-float64(h)/2/float64(st.imgH))
	if fx == a.cropFX && fy == a.cropFY {
		return false
	}
	a.cropFX, a.cropFY = fx, fy
	a.cropAnchor = anchorCustom
	a.resetOp(output.CropAspect)
	return true
}

func clampFloat64(v, lo, hi float64) float64 {
	if hi < lo {
		return (lo + hi) / 2
	}
	return min(max(v, lo), hi)
}
