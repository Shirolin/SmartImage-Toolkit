package main

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/components"
	"github.com/oneo-me/onevra/source/icons/lucide"
	"github.com/oneo-me/onevra/source/shells/sidebar"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/center"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/padaspect"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/resize"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func (a *app) sidebar(c *ui.Context) {
	t := c.Theme()
	top := sidebar.HeaderHeight(c) + t.Space(2)
	ui.Column(c).Fill().Padding(top, t.Space(2), t.Space(3), t.Space(2)).Gap(t.Space(2)).Children(func() {
		components.SidebarSection(c, "处理", func() {
			if components.SidebarItem(c, "快速转换", lucide.Zap(), a.page == pageConvert).Clicked() {
				a.setPage(pageConvert)
			}
			if components.SidebarItem(c, "缩放", lucide.Scaling(), a.page == pageResize).Clicked() {
				a.setPage(pageResize)
			}
			if components.SidebarItem(c, "边缘处理", lucide.Scissors(), a.page == pageEdge).Clicked() {
				a.setPage(pageEdge)
			}
			if components.SidebarItem(c, "构图", lucide.Frame(), a.page == pageFigure).Clicked() {
				a.setPage(pageFigure)
			}
			if components.SidebarItem(c, "切图", lucide.SquareSplitVertical(), a.page == pageSplit).Clicked() {
				a.setPage(pageSplit)
			}
		})
		ui.Spacer(c)
		components.SidebarSection(c, "应用", func() {
			if components.SidebarItem(c, "设置", lucide.Settings(), a.page == pageSettings).Clicked() {
				a.setPage(pageSettings)
			}
		})
		components.Text(c, "原生版 · P4").FontSize(11).TextColor(t.TextMuted).PaddingStart(t.Space(1))
	})
}

func (a *app) titlebar(c *ui.Context) {
	t := c.Theme()
	title := "快速转换"
	switch a.page {
	case pageResize:
		title = "缩放"
	case pageEdge:
		title = "边缘处理 · 智能去边"
		if a.edge == edgeCrop {
			title = "边缘处理 · 手动裁剪"
		}
	case pageFigure:
		title = "构图 · 智能居中"
		if a.fig == figPad {
			title = "构图 · 画布扩边"
		}
	case pageSplit:
		title = "切图 · 切割线编辑器"
	case pageSettings:
		title = "设置"
	}
	ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
		components.Text(c, title).FontSize(13).FontWeight(600).SingleLine()
		if a.busy {
			components.Text(c, fmt.Sprintf("· %d / %d", a.done, a.total)).FontSize(12).TextColor(t.TextMuted).SingleLine()
		}
	})
}

func (a *app) content(c *ui.Context) {
	t := c.Theme()
	top := sidebar.HeaderHeight(c) + t.Space(2)
	ui.Column(c).Fill().Padding(top, t.Space(4), t.Space(4), t.Space(4)).Children(func() {
		switch a.page {
		case pageSettings:
			a.settingsPage(c)
		case pageResize:
			a.workPage(c, a.resizeToolbar)
		case pageEdge:
			a.workPage(c, a.edgeToolbar)
		case pageFigure:
			a.workPage(c, a.figureToolbar)
		case pageSplit:
			a.splitPage(c)
		default:
			a.workPage(c, a.convertToolbar)
		}
	})
}

func (a *app) workPage(c *ui.Context, toolbar func(*ui.Context)) {
	t := c.Theme()
	ui.Column(c).Fill().Gap(t.Space(3)).Children(func() {
		a.noticeBanner(c)
		a.edgeTabs(c)
		a.figureTabs(c)
		toolbar(c)
		if len(a.files) == 0 {
			a.emptyState(c)
			return
		}
		a.queuePanel(c)
	})
}

func (a *app) noticeBanner(c *ui.Context) {
	if a.notice == "" {
		return
	}
	t := c.Theme()
	ui.Row(c).FillWidth().Padding(t.Space(2), t.Space(3)).Gap(t.Space(2)).AlignItems(ui.Center).
		Background(t.Surface).Border(1, t.Border).Radius(t.Radius).Children(func() {
		components.Icon(c, lucide.Info()).Size(16, 16).TextColor(t.TextMuted).Shrink(0)
		components.Text(c, a.notice).FontSize(12).Grow(1).MinWidth(0).SingleLine()
		if components.IconButton(c, lucide.X(), "关闭提示", components.IconButtonCompact).Clicked() {
			a.notice = ""
		}
	})
}

// edgeTabs only renders on the edge page; the caller keeps the layout stable.
func (a *app) edgeTabs(c *ui.Context) {
	if a.page != pageEdge {
		return
	}
	selected := int(a.edge)
	tabs := components.Tabs(c, &selected, components.TabsSegmented, "智能去边", "手动裁剪")
	if tabs.List.Changed() {
		a.setEdgeMode(edgeMode(selected))
	}
}

func (a *app) figureTabs(c *ui.Context) {
	if a.page != pageFigure {
		return
	}
	selected := int(a.fig)
	tabs := components.Tabs(c, &selected, components.TabsSegmented, "智能居中", "画布扩边")
	if tabs.List.Changed() {
		a.setFigureMode(figMode(selected))
	}
}

func panel(c *ui.Context, build func()) {
	t := c.Theme()
	ui.Column(c).FillWidth().Padding(t.Space(3)).Gap(t.Space(2)).
		Background(t.Surface).Border(1, t.Border).Radius(t.Radius * 1.5).Children(build)
}

func (a *app) convertToolbar(c *ui.Context) {
	panel(c, func() {
		a.outputRows(c, func() {
			a.formatSelect(c, 132)
		})
	})
}

func (a *app) resizeToolbar(c *ui.Context) {
	t := c.Theme()
	panel(c, func() {
		ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
			components.Text(c, "模式").FontSize(12).TextColor(t.TextMuted)
			if selectControl(c, &a.resizeMode, 118, resizeModeLabel,
				[]resize.Mode{resize.ByWidth, resize.ByHeight, resize.ByPercent, resize.Custom}, a.busy) {
				a.resetOp(output.Resize)
			}

			switch a.resizeMode {
			case resize.ByWidth:
				components.Text(c, "宽度").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.resizeWidth, 1, resize.MaxDim, 1, 108, "目标宽度") {
					a.resetOp(output.Resize)
				}
				components.Text(c, "px").FontSize(12).TextColor(t.TextMuted)
			case resize.ByHeight:
				components.Text(c, "高度").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.resizeHeight, 1, resize.MaxDim, 1, 108, "目标高度") {
					a.resetOp(output.Resize)
				}
				components.Text(c, "px").FontSize(12).TextColor(t.TextMuted)
			case resize.ByPercent:
				components.Text(c, "比例").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.resizePercent, 1, resize.MaxPercent, 1, 90, "缩放百分比") {
					a.resetOp(output.Resize)
				}
				components.Text(c, "%").FontSize(12).TextColor(t.TextMuted)
			case resize.Custom:
				components.Text(c, "宽").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.resizeWidth, 1, resize.MaxDim, 1, 92, "目标宽度") {
					a.resetOp(output.Resize)
				}
				components.Text(c, "×").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.resizeHeight, 1, resize.MaxDim, 1, 92, "目标高度") {
					a.resetOp(output.Resize)
				}
				components.Text(c, "适配").FontSize(12).TextColor(t.TextMuted)
				if selectControl(c, &a.resizeFit, 106, fitLabel,
					[]resize.Fit{resize.Cover, resize.Contain, resize.Fill, resize.Inside}, a.busy) {
					a.resetOp(output.Resize)
				}
			}
			ui.Spacer(c)
		})
		a.outputRows(c, func() {
			a.opFormatSelect(c, &a.resizeFormat, output.Resize, 140)
		})
	})
}

func (a *app) edgeToolbar(c *ui.Context) {
	t := c.Theme()
	panel(c, func() {
		if a.edge == edgeCrop {
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				for _, field := range []struct {
					label string
					value *float64
				}{
					{"上", &a.cropTop},
					{"下", &a.cropBottom},
					{"左", &a.cropLeft},
					{"右", &a.cropRight},
				} {
					components.Text(c, field.label).FontSize(12).TextColor(t.TextMuted)
					if numberField(c, field.value, 0, resize.MaxDim, 1, 88, field.label+"边裁剪像素") {
						a.resetOp(output.Crop)
					}
					components.Text(c, "px").FontSize(12).TextColor(t.TextMuted)
				}
				if a.cropEmpty() {
					components.Text(c, "至少一个方向大于 0").FontSize(11).TextColor(t.Warning)
				}
				ui.Spacer(c)
			})
		} else {
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				components.Text(c, "容差").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.trimThreshold, 1, 100, 1, 90, "色差容忍度") {
					a.resetOp(output.Trim)
				}
				components.Text(c, "修剪方向").FontSize(12).TextColor(t.TextMuted)
				if selectControl(c, &a.trimSides, 128, sidesLabel,
					[]trim.Sides{trim.All, trim.Bottom, trim.TopBottom, trim.LeftRight}, a.busy) {
					a.resetOp(output.Trim)
				}
				ui.Spacer(c)
			})
		}
		formatOp := output.Trim
		formatValue := &a.trimFormat
		if a.edge == edgeCrop {
			formatOp = output.Crop
			formatValue = &a.cropFormat
		}
		a.outputRows(c, func() {
			a.opFormatSelect(c, formatValue, formatOp, 140)
		})
	})
}

func (a *app) figureToolbar(c *ui.Context) {
	t := c.Theme()
	panel(c, func() {
		if a.fig == figPad {
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				components.Text(c, "比例").FontSize(12).TextColor(t.TextMuted)
				if selectControl(c, &a.padPreset, 104, padPresetLabel,
					[]padPreset{pad16x9, pad9x16, pad1x1, pad4x5, padCustom}, a.busy) {
					a.resetOp(output.Pad)
				}
				if a.padPreset == padCustom {
					if numberField(c, &a.padAspectW, 1, 1000, 1, 72, "比例宽") {
						a.resetOp(output.Pad)
					}
					components.Text(c, ":").FontSize(12).TextColor(t.TextMuted)
					if numberField(c, &a.padAspectH, 1, 1000, 1, 72, "比例高") {
						a.resetOp(output.Pad)
					}
				}
				components.Text(c, "长边").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.padLongEdge, 1, padaspect.MaxDim, 10, 92, "画布长边像素") {
					a.resetOp(output.Pad)
				}
				components.Text(c, "主体占比").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.padRatio, 40, 80, 5, 72, "主体占画布高度的百分比") {
					a.resetOp(output.Pad)
				}
				components.Text(c, "%").FontSize(12).TextColor(t.TextMuted)
				ui.Spacer(c)
			})
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				components.Text(c, "主体").FontSize(12).TextColor(t.TextMuted)
				if selectControl(c, &a.padSubject, 112, subjectLabel,
					[]padaspect.SubjectMode{padaspect.Full, padaspect.Trim}, a.busy) {
					a.resetOp(output.Pad)
				}
				if a.padSubject == padaspect.Trim {
					components.Text(c, "容差").FontSize(12).TextColor(t.TextMuted)
					if numberField(c, &a.padThreshold, 1, 100, 1, 90, "色差容忍度") {
						a.resetOp(output.Pad)
					}
				}
				components.Text(c, "填充").FontSize(12).TextColor(t.TextMuted)
				if selectControl(c, &a.padFill, 104, fillLabel,
					[]ops.Fill{ops.FillAuto, ops.FillTransparent, ops.FillWhite, ops.FillBlack}, a.busy) {
					a.resetOp(output.Pad)
				}
				if err := a.padError(); err != nil {
					components.Text(c, err.Error()).FontSize(11).TextColor(t.Warning).SingleLine()
				}
				ui.Spacer(c)
			})
		} else {
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				components.Text(c, "容差").FontSize(12).TextColor(t.TextMuted)
				if numberField(c, &a.centerThreshold, 1, 100, 1, 90, "色差容忍度") {
					a.resetOp(output.Center)
				}
				components.Text(c, "参与边").FontSize(12).TextColor(t.TextMuted)
				if selectControl(c, &a.centerSides, 104, centerSidesLabel,
					[]center.Sides{center.All, center.TopBottom, center.LeftRight}, a.busy) {
					a.resetOp(output.Center)
				}
				components.Text(c, "填充").FontSize(12).TextColor(t.TextMuted)
				if selectControl(c, &a.centerFill, 104, fillLabel,
					[]ops.Fill{ops.FillAuto, ops.FillTransparent, ops.FillWhite, ops.FillBlack}, a.busy) {
					a.resetOp(output.Center)
				}
				ui.Spacer(c)
			})
		}
		formatOp := output.Center
		formatValue := &a.centerFormat
		if a.fig == figPad {
			formatOp = output.Pad
			formatValue = &a.padFormat
		}
		a.outputRows(c, func() {
			a.opFormatSelect(c, formatValue, formatOp, 140)
		})
	})
}

// outputRows builds the controls shared by every operation page: export
// format, output location and file actions.
func (a *app) outputRows(c *ui.Context, formatControl func()) {
	t := c.Theme()
	ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
		components.Text(c, "输出格式").FontSize(12).TextColor(t.TextMuted)
		formatControl()

		components.Text(c, "输出位置").FontSize(12).TextColor(t.TextMuted)
		a.locationSelect(c, 150)
		if a.settings.Location == settings.CustomDir && a.settings.CustomDir == "" {
			if components.Button(c, "选择目录", components.ButtonOutline).Clicked() {
				a.chooseOutputDir(nil)
			}
		}
		ui.Spacer(c)
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
}

func (a *app) formatSelect(c *ui.Context, width float32) {
	if selectControl(c, &a.format, width, formatLabel, imageio.Formats, a.busy) {
		a.setConvertFormat(a.format)
	}
}

func (a *app) opFormatSelect(c *ui.Context, value *string, op output.Op, width float32) {
	if selectControl(c, value, width, opFormatLabel, opFormatChoices, a.busy) {
		a.resetOp(op)
	}
}

func (a *app) locationSelect(c *ui.Context, width float32) {
	if selectControl(c, &a.settings.Location, width, locationLabel,
		[]settings.Location{settings.SameDir, settings.Subfolder, settings.CustomDir}, a.busy) {
		a.setLocation(a.settings.Location)
	}
}

func numberField(c *ui.Context, value *float64, lo, hi, step float64, width float32, label string) bool {
	n := components.NumberInput(c, value, lo, hi, step)
	n.Width(width).Label(label)
	return n.Changed()
}

func selectControl[T comparable](c *ui.Context, value *T, width float32, label func(T) string, options []T, disabled bool) bool {
	sel := components.Select(c, value)
	sel.Trigger.Width(width).Disabled(disabled).Children(func() {
		components.Text(c, label(*value)).SingleLine()
	})
	sel.Popup(func(panel ui.Element) {
		for _, opt := range options {
			item := sel.Item(opt)
			item.Children(func() {
				components.Text(c, label(opt)).SingleLine()
			})
		}
	})
	return sel.Trigger.Changed()
}

func (a *app) emptyState(c *ui.Context) {
	t := c.Theme()
	ui.Box(c).Fill().Border(1, t.Border).BorderStyle(ui.BorderDashed).Radius(t.Radius * 2).Children(func() {
		ui.Column(c).Fill().Center().Gap(t.Space(2)).Children(func() {
			components.Icon(c, lucide.Upload()).Size(34, 34).TextColor(t.TextMuted)
			components.Text(c, "把图片或文件夹拖到这里").FontSize(17).FontWeight(600)
			components.Text(c, "支持 PNG、JPEG、WebP、AVIF，可批量处理。").
				FontSize(12).TextColor(t.TextMuted)
			ui.Row(c).Gap(t.Space(2)).Padding(t.Space(2), 0, 0, 0).Children(func() {
				if components.Button(c, "选择图片", components.ButtonPrimary).Clicked() {
					a.chooseFiles()
				}
				if components.Button(c, "选择文件夹", components.ButtonOutline).Clicked() {
					a.chooseFolder()
				}
			})
		})
	})
}

func (a *app) queuePanel(c *ui.Context) {
	t := c.Theme()
	op := a.currentOp()
	ui.Column(c).Fill().MinHeight(0).Background(t.Surface).Border(1, t.Border).Radius(t.Radius * 1.5).
		Children(func() {
			ui.Row(c).FillWidth().Padding(t.Space(2), t.Space(3)).AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
				components.Text(c, fmt.Sprintf("文件列表 · %d", len(a.files))).FontSize(12).FontWeight(600)
				ui.Spacer(c)
				components.Text(c, a.queueStats(op)).FontSize(12).TextColor(t.TextMuted).SingleLine()
			})
			ui.Divider(c)
			ui.Column(c).Grow(1).MinHeight(0).Clip().Children(func() {
				components.List(c, &a.list, len(a.files), func(i int) { a.fileRow(c, i, op) })
			})
			ui.Divider(c)
			a.actionBar(c, op)
		})
}

func (a *app) fileRow(c *ui.Context, i int, op output.Op) {
	if i < 0 || i >= len(a.files) {
		return
	}
	f := a.files[i]
	r := f.result(op)
	t := c.Theme()

	ui.Row(c).FillWidth().Padding(t.Space(1.5), t.Space(2)).Gap(t.Space(2)).AlignItems(ui.Center).
		BorderWidth(0, 0, borderWidth(i, len(a.files)), 0).BorderColor(t.Border).Children(func() {
		if f.thumb != nil {
			components.Image(c, f.thumb).Size(42, 42).Fit(ui.Cover).Radius(6).Shrink(0)
		} else {
			ui.Box(c).Size(42, 42).Radius(6).Background(t.Background).Border(1, t.Border).Shrink(0)
		}

		ui.Column(c).Grow(1).MinWidth(0).Gap(1).Children(func() {
			components.Tooltip(c, components.Text(c, f.name).FontSize(13).SingleLine(), f.path)
			detail := components.Text(c, a.rowDetail(f, op, r)).FontSize(11).TextColor(t.TextMuted).SingleLine()
			if r.status == statusError {
				detail.TextColor(t.Danger)
			}
		})

		components.Text(c, sizeText(f, r)).FontSize(12).TextColor(sizeColor(t, f, r)).Width(190).Shrink(0)

		ui.Box(c).Width(64).Shrink(0).Children(func() {
			components.Badge(c, statusLabel(r.status), components.BadgeOptions{Tone: statusTone(r.status)})
		})

		if r.status == statusSuccess && r.output != "" {
			if components.IconButton(c, lucide.FolderOpen(), "在资源管理器中显示", components.IconButtonCompact).Clicked() {
				revealFile(r.output)
			}
		}
		if components.IconButton(c, lucide.X(), "从列表移除 "+f.name, components.IconButtonCompact).
			Disabled(a.busy).Clicked() {
			a.removeFile(f)
		}
	})
}

// borderWidth keeps the hairline between rows only where there is a next row.
func borderWidth(i, n int) float32 {
	if i < n-1 {
		return 1
	}
	return 0
}

func (a *app) rowDetail(f *fileItem, op output.Op, r opResult) string {
	switch r.status {
	case statusError, statusSkipped:
		if r.reason != "" {
			return r.reason
		}
	case statusCanceled:
		return "已取消，开始时会重新处理"
	case statusRunning:
		return "正在处理…"
	}

	src := ""
	if f.width > 0 && f.height > 0 {
		src = fmt.Sprintf("%d×%d", f.width, f.height)
	}

	if r.status == statusSuccess {
		if r.width > 0 && r.height > 0 {
			if src != "" && (r.width != f.width || r.height != f.height) {
				src += fmt.Sprintf(" → %d×%d", r.width, r.height)
			} else if src == "" {
				src = fmt.Sprintf("%d×%d", r.width, r.height)
			}
		}
		if r.reason != "" {
			if src != "" {
				src += " · "
			}
			src += r.reason
		}
		if src != "" {
			return src
		}
	}

	if w, h, ok := a.previewDims(f, op); ok && (w != f.width || h != f.height) {
		if src != "" {
			src += fmt.Sprintf(" → %d×%d", w, h)
		} else {
			src = fmt.Sprintf("%d×%d", w, h)
		}
	}
	if src != "" {
		return src + " · " + f.path
	}
	return f.path
}

func (a *app) queueStats(op output.Op) string {
	total := int64(0)
	for _, f := range a.files {
		total += f.size
	}
	if a.busy {
		return fmt.Sprintf("%d / %d · %s", a.done, a.total, formatBytes(total))
	}
	return formatBytes(total)
}

func (a *app) actionBar(c *ui.Context, op output.Op) {
	t := c.Theme()
	ui.Column(c).FillWidth().Padding(t.Space(2), t.Space(3), t.Space(3), t.Space(3)).Gap(t.Space(2)).Children(func() {
		if a.busy {
			ratio := 0.0
			if a.total > 0 {
				ratio = float64(a.done) / float64(a.total)
			}
			components.Progress(c, ratio).FillWidth().MaxWidth(520).Label("处理进度")
		}
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
			summary := a.summaries[op]
			if a.busy {
				summary = fmt.Sprintf("正在处理 %d / %d", a.done, a.total)
			}
			if summary == "" {
				summary = a.operationHint(op)
			}
			components.Text(c, summary).FontSize(12).TextColor(t.TextMuted).Grow(1).MinWidth(0).SingleLine()
			if a.busy {
				if components.Button(c, "取消", components.ButtonSecondary).Clicked() {
					a.cancelRun()
				}
			} else {
				disabled := len(a.convertible(op)) == 0 ||
					(op == output.Crop && a.cropEmpty()) ||
					(op == output.Pad && a.padError() != nil)
				primary := components.Button(c, a.startLabel(op), components.ButtonPrimary).Disabled(disabled)
				if primary.Clicked() {
					a.startCurrent()
				}
			}
		})
	})
}

func (a *app) startLabel(op output.Op) string {
	verb := opVerb(op)
	n := len(a.convertible(op))
	if n == 0 {
		return verb
	}
	if a.failedCount(op) == n && a.successCount(op) > 0 {
		return fmt.Sprintf("重试失败 (%d)", n)
	}
	return fmt.Sprintf("%s (%d)", verb, n)
}

func opVerb(op output.Op) string {
	switch op {
	case output.Resize:
		return "开始缩放"
	case output.Trim:
		return "开始去边"
	case output.Crop:
		return "开始裁剪"
	case output.Center:
		return "开始居中"
	case output.Pad:
		return "开始扩边"
	default:
		return "开始转换"
	}
}

func (a *app) operationHint(op output.Op) string {
	switch op {
	case output.Resize:
		return "按上面设置的尺寸批量缩放。"
	case output.Trim:
		return "自动识别边缘纯色或透明区域并切除。"
	case output.Crop:
		return "按上/下/左/右像素批量裁剪。"
	case output.Center:
		return "识别主体后重新分配四周留白，画布尺寸不变。"
	case output.Pad:
		return "按目标比例新建画布，主体等比缩小后居中。"
	default:
		return "选择目标格式后批量转换。"
	}
}

func (a *app) settingsPage(c *ui.Context) {
	t := c.Theme()
	ui.Scroll(c).Fill().Children(func() {
		ui.Column(c).FillWidth().Gap(t.Space(3)).Padding(0, t.Space(1), t.Space(4), 0).Children(func() {
			components.Text(c, "修改后自动保存，下次启动继续使用。").FontSize(12).TextColor(t.TextMuted)

			settingsCard(c, "输出", func() {
				a.settingRow(c, "默认转换格式", "快速转换页预先选择的格式", func() {
					a.formatSelect(c, 150)
				})
				a.settingRow(c, "输出位置", "所有操作共用的落盘位置", func() {
					a.locationSelect(c, 178)
				})
				if a.settings.Location == settings.Subfolder {
					a.settingRow(c, "子文件夹名称", "留空则使用各操作的默认名称", func() {
						if components.TextBox(c, &a.settings.Subfolder, components.TextBoxOptions{}).
							Width(178).Label("子文件夹名称").Placeholder("留空自动命名").
							Disabled(a.busy).Changed() {
							a.persist()
						}
					})
				}
				if a.settings.Location == settings.CustomDir {
					a.settingRow(c, "输出目录", a.customDirHint(), func() {
						if components.Button(c, "更改…", components.ButtonOutline).Disabled(a.busy).Clicked() {
							a.chooseOutputDir(nil)
						}
					})
				}
			})

			settingsCard(c, "性能", func() {
				a.settingRow(c, "同时处理", "图片较多时可以调高", func() {
					n := a.settings.Concurrency
					if selectControl(c, &n, 100, func(v int) string { return fmt.Sprintf("%d", v) },
						sortedConcurrency(a.settings.Concurrency), a.busy) {
						a.settings.Concurrency = n
						a.persist()
					}
				})
			})

			settingsCard(c, "关于", func() {
				a.settingRow(c, "版本", "Go 原生重写 · P4", func() {
					components.Text(c, "0.4.0").FontSize(12).TextColor(t.TextMuted)
				})
				path, err := settings.Path()
				if err == nil {
					a.settingRow(c, "设置文件", path, func() {
						if components.Button(c, "打开所在文件夹", components.ButtonGhost).Clicked() {
							openPath(filepath.Dir(path))
						}
					})
				}
			})
		})
	})
}

func (a *app) settingRow(c *ui.Context, label, hint string, control func()) {
	t := c.Theme()
	ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(3)).Children(func() {
		ui.Column(c).Grow(1).MinWidth(0).Gap(1).Children(func() {
			components.Text(c, label).FontSize(13).SingleLine()
			if hint != "" {
				components.Text(c, hint).FontSize(11).TextColor(t.TextMuted).SingleLine()
			}
		})
		control()
	})
}

func settingsCard(c *ui.Context, title string, build func()) {
	t := c.Theme()
	ui.Column(c).FillWidth().Padding(t.Space(4)).Gap(t.Space(3)).
		Background(t.Surface).Border(1, t.Border).Radius(t.Radius * 1.5).Children(func() {
		components.Text(c, title).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
		build()
	})
}

func (a *app) outputHint() string {
	switch a.settings.Location {
	case settings.Subfolder:
		name := strings.TrimSpace(a.settings.Subfolder)
		if name == "" {
			name = a.currentOp().DefaultSubfolder()
		}
		return fmt.Sprintf("保存到每张原图旁的 “%s” 文件夹。", name)
	case settings.CustomDir:
		if strings.TrimSpace(a.settings.CustomDir) == "" {
			return "尚未选择输出目录。"
		}
		return "保存到 " + a.settings.CustomDir
	default:
		return "生成的文件保存在原图所在文件夹。"
	}
}

func (a *app) customDirHint() string {
	if strings.TrimSpace(a.settings.CustomDir) == "" {
		return "尚未选择"
	}
	return a.settings.CustomDir
}

func formatLabel(f imageio.Format) string {
	if f == imageio.JPEG {
		return "JPEG"
	}
	return f.Label()
}

var opFormatChoices = []string{"original", "webp", "png", "avif", "mozjpeg"}

func opFormatLabel(v string) string {
	if v == "" || v == "original" {
		return "保持原格式"
	}
	if f, err := imageio.ParseFormat(v); err == nil {
		return formatLabel(f)
	}
	return v
}

func resizeModeLabel(m resize.Mode) string {
	switch m {
	case resize.ByHeight:
		return "按高度"
	case resize.ByPercent:
		return "按百分比"
	case resize.Custom:
		return "自定义宽高"
	default:
		return "按宽度"
	}
}

func fitLabel(f resize.Fit) string {
	switch f {
	case resize.Contain:
		return "Contain 留白"
	case resize.Fill:
		return "Fill 拉伸"
	case resize.Inside:
		return "Inside 不放大"
	default:
		return "Cover 裁剪"
	}
}

func sidesLabel(s trim.Sides) string {
	switch s {
	case trim.Bottom:
		return "仅底部"
	case trim.TopBottom:
		return "上下"
	case trim.LeftRight:
		return "左右"
	default:
		return "全向"
	}
}

func centerSidesLabel(s center.Sides) string {
	switch s {
	case center.TopBottom:
		return "仅上下"
	case center.LeftRight:
		return "仅左右"
	default:
		return "四周"
	}
}

func fillLabel(f ops.Fill) string {
	switch f {
	case ops.FillTransparent:
		return "透明"
	case ops.FillWhite:
		return "白色"
	case ops.FillBlack:
		return "黑色"
	default:
		return "背景色"
	}
}

func padPresetLabel(p padPreset) string {
	if p == padCustom {
		return "自定义"
	}
	return string(p)
}

func subjectLabel(m padaspect.SubjectMode) string {
	if m == padaspect.Trim {
		return "去边探测"
	}
	return "整图"
}

func locationLabel(l settings.Location) string {
	switch l {
	case settings.Subfolder:
		return "存到子文件夹"
	case settings.CustomDir:
		return "指定文件夹"
	default:
		return "原图所在文件夹"
	}
}

func statusLabel(s status) string {
	switch s {
	case statusRunning:
		return "处理中"
	case statusSuccess:
		return "完成"
	case statusSkipped:
		return "已跳过"
	case statusError:
		return "失败"
	case statusCanceled:
		return "已取消"
	default:
		return "待处理"
	}
}

func statusTone(s status) components.BadgeTone {
	switch s {
	case statusRunning:
		return components.BadgeAccent
	case statusSuccess:
		return components.BadgeSuccess
	case statusSkipped:
		return components.BadgeWarning
	case statusError:
		return components.BadgeDanger
	default:
		return components.BadgeNeutral
	}
}

func sizeText(f *fileItem, r opResult) string {
	if r.status == statusSuccess && r.outputSize > 0 && f.size > 0 {
		return fmt.Sprintf("%s → %s  %s", formatBytes(f.size), formatBytes(r.outputSize), savings(f.size, r.outputSize))
	}
	if f.size > 0 {
		return formatBytes(f.size)
	}
	return ""
}

func savings(input, output int64) string {
	if input <= 0 {
		return ""
	}
	pct := float64(input-output) / float64(input) * 100
	if pct >= 0 {
		return fmt.Sprintf("−%.0f%%", pct)
	}
	return fmt.Sprintf("+%.0f%%", -pct)
}

func sizeColor(t *ui.Theme, f *fileItem, r opResult) ui.Color {
	if r.status == statusSuccess && r.outputSize > 0 && f.size > 0 {
		if r.outputSize < f.size {
			return t.Success
		}
		return t.Warning
	}
	return t.TextMuted
}
