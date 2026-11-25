package main

import (
	"fmt"
	"image"

	"github.com/disintegration/imaging"
	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/components"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
)

// maxPreviewEdge caps the picture held for the pane and the crop canvas: a
// 6000px photo costs more to keep decoded than either can show.
const maxPreviewEdge = 1400

// previewMinWindow is the window width from which a list page has room for
// the preview pane beside its queue. Below it the rows keep the full width.
const previewMinWindow = 1040

// pagePreview is the picture shown beside the queue: the source, or the op's
// output once the file has one.
type pagePreview struct {
	item     *fileItem
	path     string // the file the bitmap belongs to
	bitmap   *ui.Bitmap
	isResult bool
	loading  bool
	err      string
}

// displayBitmap decodes path and fits it to maxPreviewEdge, which is what a
// canvas can show.
func displayBitmap(path string) (image.Image, *ui.Bitmap, error) {
	img, err := imageio.DecodeFile(path)
	if err != nil {
		return nil, nil, err
	}
	if b := img.Bounds(); b.Dx() > maxPreviewEdge || b.Dy() > maxPreviewEdge {
		img = imaging.Fit(img, maxPreviewEdge, maxPreviewEdge, imaging.Lanczos)
	}
	return img, ui.NewBitmap(img), nil
}

// selectedPath is the queue row the page is looking at.
func (a *app) selectedPath() (string, bool) {
	chosen := ""
	for k := range a.previewSel.All() {
		if path, ok := k.(string); ok {
			chosen = path
		}
	}
	return chosen, chosen != ""
}

// wideEnough reports the window has room for the pane beside its queue.
func (a *app) wideEnough(c *ui.Context) bool {
	w, _ := c.Size()
	return w >= previewMinWindow
}

// syncPagePreview points the pane at the chosen row, decoding only when the
// picture to show changed. A file the op has written shows its result unless
// the pane was switched back to the source.
func (a *app) syncPagePreview(op output.Op) {
	chosen, ok := a.selectedPath()
	if !ok {
		if len(a.files) == 0 {
			a.releasePagePreview()
			return
		}
		a.previewSel.Clear()
		a.previewSel.Add(a.files[0].path)
		chosen = a.files[0].path
	}
	var item *fileItem
	for _, f := range a.files {
		if f.path == chosen {
			item = f
			break
		}
	}
	if item == nil {
		a.releasePagePreview()
		return
	}
	st := a.preview
	if st == nil {
		st = &pagePreview{}
		a.preview = st
	}
	st.item = item
	path, isResult := item.path, false
	if !a.previewSource {
		if r := item.result(op); r.status == statusSuccess && r.output != "" {
			path, isResult = r.output, true
		}
	}
	st.isResult = isResult
	if path == st.path {
		return
	}
	a.loadPagePreview(st, path)
}

func (a *app) loadPagePreview(st *pagePreview, path string) {
	if st.bitmap != nil {
		st.bitmap.ReleasePixels()
		st.bitmap = nil
	}
	st.path, st.loading, st.err = path, true, ""
	go func() {
		_, bmp, err := displayBitmap(path)
		a.update(func() {
			if a.preview != st || st.path != path {
				if bmp != nil {
					bmp.ReleasePixels()
				}
				return
			}
			st.loading = false
			if err != nil {
				st.err = err.Error()
				return
			}
			st.bitmap = bmp
		})
	}()
}

func (a *app) releasePagePreview() {
	if a.preview != nil && a.preview.bitmap != nil {
		a.preview.bitmap.ReleasePixels()
	}
	a.preview = nil
}

// previewPane draws the chosen image beside the queue, with the source and
// the result a segmented control away from each other.
func (a *app) previewPane(c *ui.Context, op output.Op) {
	t := c.Theme()
	st := a.preview
	result := st != nil && st.item.result(op).status == statusSuccess && st.item.result(op).output != ""

	ui.Column(c).Width(272).Shrink(0).MinHeight(180).Background(t.Surface).
		Border(1, t.Border).Radius(t.Radius * 1.5).Clip().Children(func() {
		ui.Row(c).FillWidth().Padding(t.Space(2), t.Space(3)).AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
			components.Text(c, "预览").FontSize(12.5).FontWeight(600)
			ui.Spacer(c)
			if result {
				sel := 0
				if st.isResult {
					sel = 1
				}
				tabs := components.Tabs(c, &sel, components.TabsSegmented, "原图", "结果")
				if tabs.List.Changed() {
					a.previewSource = sel == 0
					c.Invalidate()
				}
			}
		})
		ui.Divider(c)
		if st == nil || st.item == nil {
			components.Text(c, "选一张图片查看预览").FontSize(11.5).TextColor(t.TextMuted).
				Padding(t.Space(2), t.Space(3))
			return
		}
		components.Text(c, st.item.name).FontSize(11.5).TextColor(t.TextMuted).SingleLine().
			Padding(0, t.Space(3)).MaxWidth(272 - t.Space(3)*2)
		a.previewCanvas(c, st, op)
	})
}

func (a *app) previewCanvas(c *ui.Context, st *pagePreview, op output.Op) {
	t := c.Theme()
	canvas := ui.RGB(0x17, 0x16, 0x14)
	if !t.Dark {
		canvas = ui.RGB(0xDE, 0xDA, 0xD3)
	}
	e := ui.Box(c).FillWidth().Grow(1).MinHeight(120).Clip().Background(canvas)
	switch {
	case st.err != "":
		e.Children(func() {
			components.Text(c, "预览载入失败").FontSize(11.5).TextColor(t.TextMuted).Padding(t.Space(3))
		})
	case st.bitmap == nil:
		e.Children(func() {
			components.Text(c, "正在载入…").FontSize(11.5).TextColor(t.TextMuted).Padding(t.Space(3))
		})
	default:
		e.DrawOver(func(p *ui.Painter, r ui.Rect) {
			const pad = 10
			bw, bh := st.bitmap.Size()
			scale := min((r.W-pad*2)/float32(bw), (r.H-pad*2)/float32(bh))
			if scale <= 0 {
				return
			}
			w, h := float32(bw)*scale, float32(bh)*scale
			p.Image(st.bitmap, ui.Rect{X: r.X + (r.W-w)/2, Y: r.Y + (r.H-h)/2, W: w, H: h}, ui.FillBox)
		})
	}
	ui.Divider(c)
	if label := previewCaption(st, op); label != "" {
		components.Text(c, label).FontSize(11).TextColor(t.TextMuted).SingleLine().
			Padding(t.Space(1.5), t.Space(3))
	}
}

// previewCaption is what the pane shows: the picture's size and bytes, and
// for a result the source size before the arrow.
func previewCaption(st *pagePreview, op output.Op) string {
	if st == nil || st.item == nil {
		return ""
	}
	f := st.item
	if st.isResult {
		r := f.result(op)
		size := ""
		if r.outputSize > 0 {
			size = " · " + formatBytes(r.outputSize)
		}
		return "结果 " + dims(r.width, r.height) + size
	}
	size := ""
	if f.size > 0 {
		size = " · " + formatBytes(f.size)
	}
	return "原图 " + dims(f.width, f.height) + size
}

func dims(w, h int) string {
	if w <= 0 || h <= 0 {
		return "—"
	}
	return fmt.Sprintf("%d×%d", w, h)
}
