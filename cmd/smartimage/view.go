package main

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/components"
	"github.com/oneo-me/onevra/source/icons/lucide"
	"github.com/oneo-me/onevra/source/shells/sidebar"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/center"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/cropaspect"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/padaspect"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/resize"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

func (a *app) sidebar(c *ui.Context) {
	t := c.Theme()
	top := sidebar.HeaderHeight(c) + t.Space(1)
	ui.Column(c).Fill().Padding(top, t.Space(2), t.Space(3), t.Space(2)).Gap(t.Space(2)).Children(func() {
		a.sidebarBrand(c)
		components.SidebarSection(c, "处理", func() {
			a.navItem(c, "快速转换", lucide.Zap(), pageConvert)
			a.navItem(c, "缩放", lucide.Scaling(), pageResize)
			a.navItem(c, "裁剪", lucide.Crop(), pageCrop)
			a.navItem(c, "边缘处理", lucide.Scissors(), pageEdge)
			a.navItem(c, "构图", lucide.Frame(), pageFigure)
			a.navItem(c, "切图", lucide.SquareSplitVertical(), pageSplit)
			a.navItem(c, "抠图", lucide.WandSparkles(), pageMatting)
		})
		ui.Spacer(c)
		components.SidebarSection(c, "应用", func() {
			a.navItem(c, "设置", lucide.Settings(), pageSettings)
		})
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(1.5)).
			Padding(t.Space(1), t.Space(2), 0, t.Space(2)).Children(func() {
			ui.Box(c).Size(6, 6).Radius(3).Background(t.Success).Shrink(0)
			components.Text(c, "本地处理 · 无需联网").FontSize(10.5).TextColor(t.TextMuted).SingleLine()
		})
	})
}

// navItem keeps the leading icon quiet until its page is active; six accent
// icons at once would compete with the selected row.
func (a *app) navItem(c *ui.Context, label string, icon *ui.SVG, p page) {
	t := c.Theme()
	selected := a.page == p
	item := components.SidebarItemWithLeading(c, label, selected, func(c *ui.Context, size float32) {
		color := t.TextMuted
		if selected {
			color = t.Accent
		}
		components.Icon(c, icon).Size(size, size).TextColor(color)
	})
	if item.Clicked() {
		a.setPage(p)
	}
}

// sidebarBrand anchors the window with the product name. The shell's floating
// header owns the collapse control, so the mark starts below it.
func (a *app) sidebarBrand(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(2)).
		Padding(t.Space(1), t.Space(1), t.Space(1), t.Space(1)).Children(func() {
		ui.Box(c).Size(32, 32).Background(t.Accent).Radius(t.Radius).Center().Shrink(0).Children(func() {
			components.Icon(c, lucide.Image()).Size(18, 18).TextColor(t.AccentText)
		})
		ui.Column(c).Gap(0).MinWidth(0).Children(func() {
			components.Text(c, "SmartImage").FontSize(14).FontWeight(700).SingleLine()
			components.Text(c, "图像批处理工作台").FontSize(10.5).TextColor(t.TextMuted).SingleLine()
		})
	})
}

func (a *app) titlebar(c *ui.Context) {
	t := c.Theme()
	title := "快速转换"
	switch a.page {
	case pageResize:
		title = "缩放"
	case pageCrop:
		title = "裁剪 · 按比例"
		if a.crop == cropPixels {
			title = "裁剪 · 按像素"
		}
	case pageEdge:
		title = "边缘处理"
	case pageFigure:
		title = "构图 · 智能居中"
		if a.fig == figPad {
			title = "构图 · 画布扩边"
		}
	case pageSplit:
		title = "切图 · 切割线编辑器"
	case pageMatting:
		title = "抠图 · 本地 AI 去背景"
	case pageSettings:
		title = "设置"
	}
	ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
		ui.Column(c).Gap(1).Justify(ui.Center).MinWidth(0).Children(func() {
			ui.Row(c).AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
				components.Text(c, title).FontSize(15).FontWeight(600).SingleLine()
				if a.busy {
					components.Text(c, fmt.Sprintf("%d / %d", a.done, a.total)).
						FontSize(11).TextColor(t.TextMuted).SingleLine()
				}
			})
			components.Text(c, a.pageSubtitle()).FontSize(11).TextColor(t.TextMuted).SingleLine()
		})
	})
}

// pageSubtitle gives the floating title a second line of context.
func (a *app) pageSubtitle() string {
	switch a.page {
	case pageResize:
		return "按宽度、高度或百分比统一缩放"
	case pageCrop:
		if a.crop == cropPixels {
			return "按像素裁掉四边"
		}
		return "拖动裁剪框，按比例裁切或缩放到指定尺寸"
	case pageEdge:
		return "自动切除纯色或透明边缘"
	case pageFigure:
		if a.fig == figPad {
			return "按目标比例扩展画布"
		}
		return "识别主体后重新分配留白"
	case pageSplit:
		return "拖动切割线，导出规则切片"
	case pageMatting:
		return "本地 AI 去除背景，保留透明通道"
	case pageSettings:
		return "修改后自动保存，下次启动继续使用"
	default:
		return "选择输出格式，批量转换图片"
	}
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
		case pageCrop:
			a.cropPage(c)
		case pageEdge:
			a.workPage(c, a.trimToolbar)
		case pageFigure:
			a.workPage(c, a.figureToolbar)
		case pageSplit:
			a.splitPage(c)
		case pageMatting:
			a.workPage(c, a.mattingToolbar)
		default:
			a.workPage(c, a.convertToolbar)
		}
	})
}

func (a *app) workPage(c *ui.Context, toolbar func(*ui.Context)) {
	t := c.Theme()
	ui.Column(c).Fill().Gap(t.Space(3)).Children(func() {
		a.noticeBanner(c)
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
	if a.countdown > 0 {
		a.countdownBanner(c)
		return
	}
	if a.notice == "" {
		return
	}
	t := c.Theme()
	ui.Row(c).FillWidth().Padding(t.Space(2), t.Space(3)).Gap(t.Space(2)).AlignItems(ui.Center).
		Background(t.Surface).Border(1, t.Border).Radius(t.Radius).Children(func() {
		components.Icon(c, lucide.Info()).Size(16, 16).TextColor(t.TextMuted).Shrink(0)
		components.Text(c, a.notice).FontSize(12).Grow(1).MinWidth(0).SingleLine()
		if components.IconButton(c, lucide.X(), "关闭提示", components.IconButtonCompact).Clicked() {
			if a.countdown > 0 {
				a.cancelAutoClose()
			}
			a.notice = ""
		}
	})
}

// countdownBanner takes over the notice slot while the window is about to
// close: accent fill and border, a draining bar and a labelled way out.
func (a *app) countdownBanner(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).FillWidth().Padding(t.Space(3)).Gap(t.Space(2)).
		Background(t.Accent.Alpha(0.12)).Border(1, t.Accent.Alpha(0.6)).Radius(t.Radius * 1.2).
		Children(func() {
			ui.Row(c).FillWidth().Gap(t.Space(3)).AlignItems(ui.Center).Children(func() {
				components.Icon(c, lucide.Timer()).Size(20, 20).TextColor(t.Accent).Shrink(0)
				ui.Column(c).Grow(1).MinWidth(0).Gap(1).Children(func() {
					components.Text(c, "转换完成").FontSize(13).FontWeight(600).SingleLine()
					components.Text(c, fmt.Sprintf("%d 秒后自动关闭窗口", a.countdown)).
						FontSize(12).TextColor(t.Accent).SingleLine()
				})
				if components.Button(c, "取消自动关闭", components.ButtonSecondary).Clicked() {
					a.cancelAutoClose()
				}
			})
			components.Progress(c, float64(a.countdown)/closeCountdownSeconds).
				FillWidth().Label("自动关闭倒计时")
		})
}

// cropTabs only renders on the crop page; the caller keeps the layout stable.
func (a *app) cropTabs(c *ui.Context) {
	if a.page != pageCrop {
		return
	}
	selected := int(a.crop)
	tabs := components.Tabs(c, &selected, components.TabsSegmented, "按比例", "按像素")
	if tabs.List.Changed() {
		a.setCropMode(cropMode(selected))
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

// fieldLabel keeps toolbars from squeezing the short Chinese labels.
func fieldLabel(c *ui.Context, text string) {
	components.Text(c, text).FontSize(11.5).TextColor(c.Theme().TextMuted).Shrink(0).NoWrap()
}

// unitText is the muted suffix beside a number field, such as px or %.
func unitText(c *ui.Context, text string) {
	components.Text(c, text).FontSize(11.5).TextColor(c.Theme().TextMuted).Shrink(0).NoWrap()
}

// toolbarDivider separates independent control groups without a second card.
func toolbarDivider(c *ui.Context) {
	ui.Box(c).Width(1).Height(18).MarginX(c.Theme().Space(1)).Background(c.Theme().Border).Shrink(0)
}

// toolbarNote fills the trailing side of a control row with one short,
// factual explanation instead of leaving a dead gap.
func toolbarNote(c *ui.Context, text string) {
	t := c.Theme()
	ui.Row(c).Gap(6).AlignItems(ui.Center).Shrink(0).Children(func() {
		components.Icon(c, lucide.Info()).Size(13, 13).TextColor(t.TextMuted).Shrink(0)
		components.Text(c, text).FontSize(11.5).TextColor(t.TextMuted).SingleLine()
	})
}

// fieldGroup keeps a label and its control on the same wrapped line.
func fieldGroup(c *ui.Context, build func()) {
	t := c.Theme()
	ui.Row(c).Gap(t.Space(2)).AlignItems(ui.Center).Shrink(0).Children(build)
}

// buttonWithIcon puts the glyph before the label; Button itself only appends
// children after its text.
func buttonWithIcon(c *ui.Context, icon *ui.SVG, label string, variant components.ButtonVariant) ui.Element {
	b := components.Button(c, "", variant).Label(label).Gap(6)
	b.Children(func() {
		components.Icon(c, icon).Size(15, 15)
		components.Text(c, label).FontSize(12.5).FontWeight(600).SingleLine()
	})
	return b
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
			fieldLabel(c, "模式")
			if selectControl(c, &a.resizeMode, 118, resizeModeLabel,
				[]resize.Mode{resize.ByWidth, resize.ByHeight, resize.ByPercent, resize.Custom}, a.busy) {
				a.resetOp(output.Resize)
			}

			switch a.resizeMode {
			case resize.ByWidth:
				fieldLabel(c, "宽度")
				if numberField(c, &a.resizeWidth, 1, resize.MaxDim, 1, 108, "目标宽度") {
					a.resetOp(output.Resize)
				}
				unitText(c, "px")
			case resize.ByHeight:
				fieldLabel(c, "高度")
				if numberField(c, &a.resizeHeight, 1, resize.MaxDim, 1, 108, "目标高度") {
					a.resetOp(output.Resize)
				}
				unitText(c, "px")
			case resize.ByPercent:
				fieldLabel(c, "比例")
				if numberField(c, &a.resizePercent, 1, resize.MaxPercent, 1, 90, "缩放百分比") {
					a.resetOp(output.Resize)
				}
				unitText(c, "%")
			case resize.Custom:
				fieldLabel(c, "宽")
				if numberField(c, &a.resizeWidth, 1, resize.MaxDim, 1, 92, "目标宽度") {
					a.resetOp(output.Resize)
				}
				unitText(c, "×")
				if numberField(c, &a.resizeHeight, 1, resize.MaxDim, 1, 92, "目标高度") {
					a.resetOp(output.Resize)
				}
				fieldLabel(c, "适配")
				if selectControl(c, &a.resizeFit, 106, fitLabel,
					[]resize.Fit{resize.Cover, resize.Contain, resize.Fill, resize.Inside}, a.busy) {
					a.resetOp(output.Resize)
				}
			}
			ui.Spacer(c)
			toolbarNote(c, resizeNote(a.resizeMode))
		})
		a.outputRows(c, func() {
			a.opFormatSelect(c, &a.resizeFormat, output.Resize, 140)
		})
	})
}

// cropPage adds the preview canvas between the toolbar and the queue.
func (a *app) cropPage(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Gap(t.Space(3)).Children(func() {
		a.noticeBanner(c)
		a.cropTabs(c)
		if len(a.files) > 0 {
			a.syncCropSelection()
			a.ensureCropPreview()
		}
		a.cropToolbar(c)
		if len(a.files) == 0 {
			a.emptyState(c)
			return
		}
		a.cropCanvas(c)
		a.queuePanel(c)
	})
}

func (a *app) cropToolbar(c *ui.Context) {
	t := c.Theme()
	panel(c, func() {
		if a.crop == cropPixels {
			ui.Row(c).FillWidth().Wrap().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				a.cropPreviewField(c, 150)
				for _, field := range []struct {
					label string
					value *float64
				}{
					{"上", &a.cropTop},
					{"下", &a.cropBottom},
					{"左", &a.cropLeft},
					{"右", &a.cropRight},
				} {
					fieldGroup(c, func() {
						fieldLabel(c, field.label)
						if numberField(c, field.value, 0, resize.MaxDim, 1, 88, field.label+"边裁剪像素") {
							a.resetOp(output.Crop)
						}
					})
				}
				toolbarNote(c, "拖动画框或直接填数字，单位 px")
			})
		} else {
			ui.Row(c).FillWidth().Wrap().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				a.cropPreviewField(c, 150)
				fieldGroup(c, func() {
					fieldLabel(c, "比例")
					if selectControl(c, &a.cropPreset, 96, cropPresetLabel, cropPresets, a.busy) {
						a.resetOp(output.CropAspect)
					}
					if a.cropPreset == cropCustom {
						if numberField(c, &a.cropAspectW, 1, 1000, 1, 64, "比例宽") {
							a.resetOp(output.CropAspect)
						}
						unitText(c, ":")
						if numberField(c, &a.cropAspectH, 1, 1000, 1, 64, "比例高") {
							a.resetOp(output.CropAspect)
						}
					}
				})
				a.cropAnchorFields(c)
				fieldGroup(c, func() {
					components.Switch(c, &a.cropResize, "缩放到长边").Disabled(a.busy)
					if a.cropResize {
						if numberField(c, &a.cropLongEdge, 1, cropaspect.MaxDim, 16, 96, "输出长边像素") {
							a.resetOp(output.CropAspect)
						}
						unitText(c, "px")
					}
				})
				if err := a.cropSubjectWarning(); err != "" {
					components.Text(c, err).FontSize(11.5).TextColor(t.Warning).SingleLine()
				} else if len(a.files) > 0 {
					toolbarNote(c, "拖动画框移动、拖手柄缩放，滚轮放大，双击复位")
				}
			})
		}
		formatOp := a.cropOp()
		a.outputRows(c, func() {
			a.opFormatSelect(c, &a.cropFormat, formatOp, 140)
		})
	})
}

// cropPreviewField is the labelled preview picker. With an empty queue there
// is nothing to pick, so the field is left out rather than printing a label
// beside an empty control.
func (a *app) cropPreviewField(c *ui.Context, width float32) {
	st := a.cropPreview
	if st == nil || st.item == nil {
		return
	}
	fieldGroup(c, func() {
		fieldLabel(c, "预览")
		a.cropPreviewSelect(c, width)
	})
}

// cropPreviewSelect switches the preview between queued images; the batch
// itself always covers the whole queue.
func (a *app) cropPreviewSelect(c *ui.Context, width float32) {
	st := a.cropPreview
	if st == nil || st.item == nil {
		return
	}
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
		a.selectCropItem(st.item)
	}
}

// cropAnchorFields places the frame: frame centre, subject centre, or
// wherever the user dragged it.
func (a *app) cropAnchorFields(c *ui.Context) {
	fieldGroup(c, func() {
		fieldLabel(c, "定位")
		options := []cropAnchor{anchorFrame, anchorSubject}
		if a.cropAnchor == anchorCustom {
			options = append(options, anchorCustom)
		}
		if selectControl(c, &a.cropAnchor, 112, cropAnchorLabel, options, a.busy) {
			a.setCropAnchor(a.cropAnchor)
		}
	})
	if a.cropAnchor == anchorSubject {
		fieldGroup(c, func() {
			fieldLabel(c, "容差")
			if numberField(c, &a.cropThreshold, 1, 100, 1, 84, "色差容忍度") {
				a.refreshCropSubject()
			}
		})
	}
}

// cropSubjectWarning explains a failed subject detection; an empty string
// means there is nothing to warn about.
func (a *app) cropSubjectWarning() string {
	if a.crop != cropRatio || a.cropAnchor != anchorSubject {
		return ""
	}
	if a.cropPreview == nil || !a.cropPreview.hasSubject {
		return "未探测到主体，已按画面中心"
	}
	return ""
}

func (a *app) trimToolbar(c *ui.Context) {
	t := c.Theme()
	panel(c, func() {
		ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
			fieldLabel(c, "容差")
			if numberField(c, &a.trimThreshold, 1, 100, 1, 90, "色差容忍度") {
				a.resetOp(output.Trim)
			}
			fieldLabel(c, "修剪方向")
			if selectControl(c, &a.trimSides, 128, sidesLabel,
				[]trim.Sides{trim.All, trim.Bottom, trim.TopBottom, trim.LeftRight}, a.busy) {
				a.resetOp(output.Trim)
			}
			ui.Spacer(c)
			toolbarNote(c, "容差越大，判定为背景的范围越宽")
		})
		a.outputRows(c, func() {
			a.opFormatSelect(c, &a.trimFormat, output.Trim, 140)
		})
	})
}

func (a *app) figureToolbar(c *ui.Context) {
	t := c.Theme()
	panel(c, func() {
		if a.fig == figPad {
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				fieldLabel(c, "比例")
				if selectControl(c, &a.padPreset, 104, padPresetLabel,
					[]padPreset{pad16x9, pad9x16, pad1x1, pad4x5, padCustom}, a.busy) {
					a.resetOp(output.Pad)
				}
				if a.padPreset == padCustom {
					if numberField(c, &a.padAspectW, 1, 1000, 1, 72, "比例宽") {
						a.resetOp(output.Pad)
					}
					unitText(c, ":")
					if numberField(c, &a.padAspectH, 1, 1000, 1, 72, "比例高") {
						a.resetOp(output.Pad)
					}
				}
				fieldLabel(c, "长边")
				if numberField(c, &a.padLongEdge, 1, padaspect.MaxDim, 10, 92, "画布长边像素") {
					a.resetOp(output.Pad)
				}
				fieldLabel(c, "主体占比")
				if numberField(c, &a.padRatio, 40, 80, 5, 72, "主体占画布高度的百分比") {
					a.resetOp(output.Pad)
				}
				unitText(c, "%")
				ui.Spacer(c)
				toolbarNote(c, "长边决定成品尺寸，比例决定画布形状")
			})
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				fieldLabel(c, "主体")
				if selectControl(c, &a.padSubject, 112, subjectLabel,
					[]padaspect.SubjectMode{padaspect.Full, padaspect.Trim}, a.busy) {
					a.resetOp(output.Pad)
				}
				if a.padSubject == padaspect.Trim {
					fieldLabel(c, "容差")
					if numberField(c, &a.padThreshold, 1, 100, 1, 90, "色差容忍度") {
						a.resetOp(output.Pad)
					}
				}
				fieldLabel(c, "填充")
				if selectControl(c, &a.padFill, 104, fillLabel,
					[]ops.Fill{ops.FillAuto, ops.FillTransparent, ops.FillWhite, ops.FillBlack}, a.busy) {
					a.resetOp(output.Pad)
				}
				ui.Spacer(c)
				if a.padError() == nil {
					toolbarNote(c, "主体占比是主体高度占画布的比例")
				}
			})
		} else {
			ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
				fieldLabel(c, "容差")
				if numberField(c, &a.centerThreshold, 1, 100, 1, 90, "色差容忍度") {
					a.resetOp(output.Center)
				}
				fieldLabel(c, "参与边")
				if selectControl(c, &a.centerSides, 104, centerSidesLabel,
					[]center.Sides{center.All, center.TopBottom, center.LeftRight}, a.busy) {
					a.resetOp(output.Center)
				}
				fieldLabel(c, "填充")
				if selectControl(c, &a.centerFill, 104, fillLabel,
					[]ops.Fill{ops.FillAuto, ops.FillTransparent, ops.FillWhite, ops.FillBlack}, a.busy) {
					a.resetOp(output.Center)
				}
				ui.Spacer(c)
				toolbarNote(c, "容差控制主体与背景的判定边界")
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

var mattingFormatChoices = []string{"original", "webp", "png", "avif"}

func (a *app) mattingToolbar(c *ui.Context) {
	t := c.Theme()
	panel(c, func() {
		ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
			fieldLabel(c, "模型")
			if selectControl(c, &a.mattingPreset, 160, mattingPresetLabel,
				[]string{mattingFine, mattingFast}, a.busy) {
				a.resetOp(output.Matting)
			}
			fieldLabel(c, "边缘羽化")
			if numberField(c, &a.mattingFeather, 0, 3, 1, 64, "边缘羽化像素") {
				a.resetOp(output.Matting)
			}
			unitText(c, "px")
			ui.Spacer(c)
			if err := a.mattingError(); err != nil {
				components.Text(c, err.Error()).FontSize(11.5).TextColor(t.Warning).SingleLine()
			} else {
				toolbarNote(c, "羽化让透明边缘过渡更柔和")
			}
		})
		a.outputRows(c, func() {
			if selectControl(c, &a.mattingFormat, 132, opFormatLabel, mattingFormatChoices, a.busy) {
				a.resetOp(output.Matting)
			}
		})
	})
}

func mattingPresetLabel(p string) string {
	if p == mattingFast {
		return "快速（U2-Netp）"
	}
	return "精细（U2-Net）"
}

// outputRows builds the controls shared by every operation page: export
// format, output location and file actions.
func (a *app) outputRows(c *ui.Context, formatControl func()) {
	t := c.Theme()
	ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
		fieldLabel(c, "输出格式")
		formatControl()

		toolbarDivider(c)
		fieldLabel(c, "输出位置")
		a.locationSelect(c, 150)
		if a.settings.Location == settings.CustomDir && a.settings.CustomDir == "" {
			if components.Button(c, "选择目录", components.ButtonOutline).Clicked() {
				a.chooseOutputDir(nil)
			}
		}
		ui.Spacer(c)
		if buttonWithIcon(c, lucide.Plus(), "添加图片", components.ButtonSecondary).Disabled(a.busy).Clicked() {
			a.chooseFiles()
		}
	})
	ui.Row(c).FillWidth().Gap(t.Space(2)).AlignItems(ui.Center).Children(func() {
		components.Text(c, a.outputHint()).FontSize(11.5).TextColor(t.TextMuted).Grow(1).MinWidth(0).SingleLine()
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
	ui.Box(c).Fill().Background(t.Surface.Alpha(0.35)).Border(1, t.Border).
		BorderStyle(ui.BorderDashed).Radius(t.Radius * 2).Children(func() {
		ui.Column(c).Fill().Center().Gap(t.Space(1.5)).Children(func() {
			ui.Box(c).Size(60, 60).Radius(30).Background(t.Accent.Alpha(0.12)).
				Center().Margin(0, 0, t.Space(1), 0).Children(func() {
				components.Icon(c, lucide.Upload()).Size(28, 28).TextColor(t.Accent)
			})
			components.Text(c, "把图片拖到这里").FontSize(19).FontWeight(600)
			components.Text(c, "也可以选择文件或整个文件夹 · PNG / JPEG / WebP / AVIF").
				FontSize(12).TextColor(t.TextMuted)
			ui.Row(c).Gap(t.Space(2)).Padding(t.Space(3), 0, 0, 0).Children(func() {
				if buttonWithIcon(c, lucide.Plus(), "选择图片", components.ButtonPrimary).Clicked() {
					a.chooseFiles()
				}
				if buttonWithIcon(c, lucide.FolderOpen(), "选择文件夹", components.ButtonOutline).Clicked() {
					a.chooseFolder()
				}
			})
			components.Text(c, "所有处理都在本机完成，图片不会上传").
				FontSize(10.5).TextColor(t.TextMuted).Padding(t.Space(2), 0, 0, 0)
		})
	})
}

// queuePanel fills the space the page leaves it. On the crop page the canvas
// above already took its share, so the list only gets what is left.
func (a *app) queuePanel(c *ui.Context) {
	t := c.Theme()
	op := a.currentOp()
	// The crop page points the list's selection at the previewed image; other
	// pages get plain rows back.
	if a.page != pageCrop {
		a.list.Selection = nil
	}
	ui.Column(c).Grow(1).MinHeight(180).Background(t.Surface).Border(1, t.Border).Radius(t.Radius * 1.5).
		Children(func() {
			ui.Row(c).FillWidth().Padding(t.Space(2), t.Space(3)).AlignItems(ui.Center).Gap(t.Space(2)).Children(func() {
				components.Text(c, "文件列表").FontSize(12.5).FontWeight(600)
				components.Text(c, fmt.Sprintf("· %d", len(a.files))).FontSize(11.5).TextColor(t.TextMuted)
				ui.Spacer(c)
				components.Text(c, a.queueStats(op)).FontSize(11.5).TextColor(t.TextMuted).SingleLine()
			})
			ui.Divider(c)
			ui.Row(c).FillWidth().Padding(t.Space(1), t.Space(2)).Gap(t.Space(2)).
				AlignItems(ui.Center).Children(func() {
				ui.Box(c).Width(44).Shrink(0)
				components.Text(c, "文件").FontSize(10.5).TextColor(t.TextMuted).Grow(1)
				components.Text(c, "大小").FontSize(10.5).TextColor(t.TextMuted).Width(170).TextAlign(ui.End)
				components.Text(c, "状态").FontSize(10.5).TextColor(t.TextMuted).Width(64).TextAlign(ui.Center)
				ui.Box(c).Width(48).Shrink(0)
			})
			ui.Divider(c)
			ui.Column(c).Grow(1).MinHeight(0).Clip().Children(func() {
				components.List(c, &a.list, len(a.files), func(i int) { a.fileRow(c, i, op) })
			})
			a.loadVisibleThumbs()
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

	row := ui.Row(c).FillWidth().Padding(t.Space(1.5), t.Space(2)).Gap(t.Space(2)).AlignItems(ui.Center).
		BorderWidth(0, 0, borderWidth(i, len(a.files)), 0).BorderColor(t.Border)
	row.Draw(func(p *ui.Painter, rect ui.Rect) {
		if row.Hovered() {
			p.Fill(rect, t.SurfaceHover.Alpha(0.45), 0)
		}
		// The chosen row is the one the crop canvas shows; the bar makes that
		// read at a glance instead of relying on the list's faint tint.
		if sel := a.list.Selection; sel != nil && sel.Has(f.path) {
			p.Fill(ui.Rect{X: rect.X, Y: rect.Y, W: 2.5, H: rect.H}, t.Accent, 0)
		}
	})
	row.Children(func() {
		if f.thumb != nil {
			components.Image(c, f.thumb).Size(44, 44).Fit(ui.Cover).Radius(7).Shrink(0)
		} else {
			ui.Box(c).Size(44, 44).Radius(7).Background(t.Background).Border(1, t.Border).Shrink(0)
		}

		ui.Column(c).Grow(1).MinWidth(0).Gap(1).Children(func() {
			components.Tooltip(c, components.Text(c, f.name).FontSize(13).FontWeight(500).SingleLine(), f.path)
			detail := components.Text(c, a.rowDetail(f, op, r)).FontSize(11).TextColor(t.TextMuted).SingleLine()
			if r.status == statusError {
				detail.TextColor(t.Danger)
			}
		})

		a.sizeCell(c, f, r)

		ui.Box(c).Width(64).Shrink(0).Children(func() {
			components.Badge(c, statusLabel(r.status), components.BadgeOptions{Tone: statusTone(r.status)})
		})

		ui.Box(c).Width(20).Shrink(0).Children(func() {
			if r.status == statusSuccess && r.output != "" {
				if components.IconButton(c, lucide.FolderOpen(), "在资源管理器中显示", components.IconButtonCompact).Clicked() {
					revealFile(r.output)
				}
			}
		})
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
			return withFormat(src, f.path)
		}
	}

	if w, h, ok := a.previewDims(f, op); ok && (w != f.width || h != f.height) {
		if src != "" {
			src += fmt.Sprintf(" → %d×%d", w, h)
		} else {
			src = fmt.Sprintf("%d×%d", w, h)
		}
	}
	// The row already names the file; format and pixel size are what differ
	// between rows. The full path stays in the name's tooltip.
	return withFormat(src, f.path)
}

// withFormat appends a row's source format without disturbing an empty detail.
func withFormat(src, path string) string {
	tag := formatTag(path)
	switch {
	case tag == "":
		return src
	case src == "":
		return tag
	default:
		return src + " · " + tag
	}
}

// formatTag is the compact label of a path's extension for the queue row.
func formatTag(path string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	switch ext {
	case "jpg", "jpeg", "jfif":
		return "JPEG"
	case "tif", "tiff":
		return "TIFF"
	}
	return strings.ToUpper(ext)
}

// sizeCell shows bytes before and after a run, with the delta colored by
// direction, so the table reads as a before/after report.
func (a *app) sizeCell(c *ui.Context, f *fileItem, r opResult) {
	t := c.Theme()
	ui.Row(c).Width(170).Shrink(0).Justify(ui.End).AlignItems(ui.Center).Gap(6).Children(func() {
		if r.status == statusSuccess && r.outputSize > 0 && f.size > 0 {
			components.Text(c, formatBytes(f.size)).FontSize(11.5).TextColor(t.TextMuted).Shrink(0)
			components.Text(c, "→").FontSize(11.5).TextColor(t.TextMuted.Alpha(0.7)).Shrink(0)
			components.Text(c, formatBytes(r.outputSize)).FontSize(11.5).FontWeight(600).Shrink(0)
			components.Text(c, savings(f.size, r.outputSize)).FontSize(11).
				TextColor(sizeColor(t, f, r)).Shrink(0)
			return
		}
		if f.size > 0 {
			components.Text(c, formatBytes(f.size)).FontSize(11.5).TextColor(t.TextMuted).Shrink(0)
		}
	})
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
			warn := false
			if summary == "" {
				// A disabled primary button needs its reason where the click
				// would land, not tucked into the toolbar.
				switch {
				case op == output.Crop && a.cropEmpty():
					summary, warn = "至少一个方向大于 0。", true
				case op == output.CropAspect && a.cropAspectError() != nil:
					summary, warn = a.cropAspectError().Error(), true
				case op == output.Pad && a.padError() != nil:
					summary, warn = a.padError().Error(), true
				case op == output.Matting && a.mattingError() != nil:
					summary, warn = a.mattingError().Error(), true
				default:
					summary = a.operationHint(op)
				}
			}
			color := t.TextMuted
			if warn {
				color = t.Warning
			}
			components.Text(c, summary).FontSize(12).TextColor(color).Grow(1).MinWidth(0).SingleLine()
			if a.busy {
				if components.Button(c, "取消", components.ButtonSecondary).Clicked() {
					a.cancelRun()
				}
			} else {
				disabled := len(a.convertible(op)) == 0 ||
					(op == output.Crop && a.cropEmpty()) ||
					(op == output.CropAspect && a.cropAspectError() != nil) ||
					(op == output.Pad && a.padError() != nil) ||
					(op == output.Matting && a.mattingError() != nil)
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
	case output.Crop, output.CropAspect:
		return "开始裁剪"
	case output.Center:
		return "开始居中"
	case output.Pad:
		return "开始扩边"
	case output.Matting:
		return "开始抠图"
	default:
		return "开始转换"
	}
}

func (a *app) operationHint(op output.Op) string {
	switch op {
	case output.Resize:
		return "按上面设置的尺寸批量缩放。"
	case output.Trim:
		return "裁到内容边界，四周留白一并去掉。"
	case output.Crop:
		return "从原图四边向内裁剪，数值按像素计。"
	case output.CropAspect:
		if a.cropResize {
			return "按比例裁切后缩放到指定长边，适合头像。"
		}
		return "按比例裁切，保留原像素密度。"
	case output.Center:
		return "只对齐主体位置，画布尺寸不变。"
	case output.Pad:
		return "主体等比缩放后居中。"
	case output.Matting:
		return "输出带透明通道的图片，JPEG 会转为 PNG。"
	default:
		return "按所选格式重新编码，尺寸不变。"
	}
}

func (a *app) settingsPage(c *ui.Context) {
	t := c.Theme()
	ui.Scroll(c).Fill().Children(func() {
		ui.Column(c).FillWidth().Gap(t.Space(3)).Padding(0, t.Space(1), t.Space(4), 0).Children(func() {
			a.noticeBanner(c)

			settingsCard(c, lucide.FileOutput(), "输出", func() {
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

			settingsCard(c, lucide.Gauge(), "性能", func() {
				a.settingRow(c, "同时处理", "图片较多时可以调高", func() {
					n := a.settings.Concurrency
					if selectControl(c, &n, 100, func(v int) string { return fmt.Sprintf("%d", v) },
						sortedConcurrency(a.settings.Concurrency), a.busy) {
						a.settings.Concurrency = n
						a.persist()
					}
				})
			})

			if runtime.GOOS == "windows" {
				settingsCard(c, lucide.Keyboard(), "快捷方式与右键菜单", func() {
					a.shortcutRow(c, shortcutStartMenu)
					a.shortcutRow(c, shortcutDesktop)
					a.contextMenuRow(c)
				})
			}

			settingsCard(c, lucide.Info(), "关于", func() {
				a.settingRow(c, "版本", "原生桌面版", func() {
					components.Text(c, appVersion()).FontSize(12).TextColor(t.TextMuted)
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

// shortcutRow shows whether the app is pinned to a place and offers the
// matching add or remove action.
func (a *app) shortcutRow(c *ui.Context, k shortcutKind) {
	hint := "未添加"
	label := "添加"
	if shortcutExists(k) {
		hint, label = "已添加", "移除"
	}
	a.settingRow(c, k.label(), hint, func() {
		if components.Button(c, label, components.ButtonOutline).Clicked() {
			a.toggleShortcut(k)
		}
	})
}

// contextMenuRow offers the app's right-click actions on image files.
func (a *app) contextMenuRow(c *ui.Context) {
	hint, label := "未启用", "添加"
	registered := contextMenuRegistered()
	if registered {
		hint, label = "已启用", "移除"
	}
	a.settingRow(c, "图片右键菜单", hint, func() {
		if components.Button(c, label, components.ButtonOutline).Clicked() {
			a.toggleContextMenu(registered)
		}
	})
}

func settingsCard(c *ui.Context, icon *ui.SVG, title string, build func()) {
	t := c.Theme()
	ui.Column(c).FillWidth().Padding(t.Space(3.5)).Gap(t.Space(3)).
		Background(t.Surface).Border(1, t.Border).Radius(t.Radius * 1.5).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(t.Space(1.5)).Children(func() {
			components.Icon(c, icon).Size(15, 15).TextColor(t.Accent).Shrink(0)
			components.Text(c, title).FontSize(12.5).FontWeight(600)
		})
		ui.Divider(c)
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

// resizeNote explains what the chosen mode keeps or changes.
func resizeNote(m resize.Mode) string {
	switch m {
	case resize.ByHeight:
		return "保持宽高比，按高度缩放"
	case resize.ByPercent:
		return "按原图尺寸的百分比缩放"
	case resize.Custom:
		return "按适配方式缩放或裁切"
	default:
		return "保持宽高比，按宽度缩放"
	}
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

// cropCustom shows the two ratio fields.
const cropCustom = "custom"

var cropPresets = []string{"1:1", "4:3", "3:2", "16:9", "3:4", "4:5", "9:16", cropCustom}

func cropPresetLabel(v string) string {
	if v == cropCustom {
		return "自定义"
	}
	return v
}

func cropAnchorLabel(v cropAnchor) string {
	switch v {
	case anchorSubject:
		return "主体中心"
	case anchorCustom:
		return "自定义位置"
	default:
		return "画面中心"
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
