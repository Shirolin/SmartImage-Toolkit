// Command smartimage is the native desktop workbench for SmartImage, built
// with MyGo and Onevra. It keeps one file queue and applies the operation of
// the selected page: convert, resize, trim or crop.
package main

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/oneo-me/onevra/source/components"
	"github.com/oneo-me/onevra/source/shells/sidebar"
	"github.com/oneo-me/onevra/source/theme"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/resize"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops/trim"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

type page int

const (
	pageConvert page = iota
	pageResize
	pageEdge
	pageSettings
)

type edgeMode int

const (
	edgeTrim edgeMode = iota
	edgeCrop
)

type status int

const (
	statusQueued status = iota
	statusRunning
	statusSuccess
	statusSkipped
	statusError
	statusCanceled
)

// opResult is one file's outcome for one operation. The zero value means the
// file has not been processed by that operation.
type opResult struct {
	status     status
	output     string
	outputSize int64
	reason     string
	width      int
	height     int
}

type fileItem struct {
	path string
	name string
	size int64

	width, height int
	thumb         *ui.Bitmap

	results map[output.Op]opResult
}

func (f *fileItem) result(op output.Op) opResult {
	if f.results == nil {
		return opResult{}
	}
	return f.results[op]
}

func (f *fileItem) setResult(op output.Op, r opResult) {
	if f.results == nil {
		f.results = make(map[output.Op]opResult)
	}
	f.results[op] = r
}

type launch struct {
	paths    []string
	quick    imageio.Format
	hasQuick bool
}

type app struct {
	shell *sidebar.Shell
	win   *mygo.Window
	page  page
	edge  edgeMode

	settings settings.Settings
	format   imageio.Format

	resizeMode    resize.Mode
	resizeWidth   float64
	resizeHeight  float64
	resizePercent float64
	resizeFit     resize.Fit
	resizeFormat  string

	trimThreshold float64
	trimSides     trim.Sides
	trimFormat    string

	cropTop    float64
	cropBottom float64
	cropLeft   float64
	cropRight  float64
	cropFormat string

	files []*fileItem
	index map[string]*fileItem
	list  components.ListState

	busy       bool
	cancel     context.CancelFunc
	done       int
	total      int
	summaries  map[output.Op]string
	outputDirs map[output.Op]string
	notice     string

	gen      int
	thumbSem chan struct{}
}

func main() {
	mygo.App.SetName("SmartImage")
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}

	launchArgs := parseLaunch(os.Args[1:])
	prefs := settings.Load()
	format, err := imageio.ParseFormat(prefs.Format)
	if err != nil {
		format = imageio.WebP
		prefs.Format = string(format)
	}

	a := &app{
		page:          pageConvert,
		settings:      prefs,
		format:        format,
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
		thumbSem:      make(chan struct{}, 2),
	}
	a.list.Key = func(i int) any {
		if i < 0 || i >= len(a.files) {
			return i
		}
		return a.files[i].path
	}

	mygo.Theme.SetSource(mygo.ThemeSystem)
	mygo.App.OnSecondInstance(a.secondInstance)
	mygo.App.WhenReady(func() { a.start(launchArgs) })
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

func parseLaunch(args []string) launch {
	var l launch
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--quick" && i+1 < len(args):
			if f, err := imageio.ParseFormat(args[i+1]); err == nil {
				l.quick, l.hasQuick = f, true
				i++
			}
		case strings.HasPrefix(arg, "--quick="):
			if f, err := imageio.ParseFormat(strings.TrimPrefix(arg, "--quick=")); err == nil {
				l.quick, l.hasQuick = f, true
			}
		case strings.HasPrefix(arg, "-"):
			// Unknown flags are ignored so a future launcher can add its own.
		default:
			l.paths = append(l.paths, arg)
		}
	}
	return l
}

func (a *app) start(l launch) {
	a.shell = sidebar.NewShell(sidebar.ShellOptions{
		Title:        "SmartImage",
		Width:        1080,
		Height:       760,
		MinWidth:     880,
		MinHeight:    620,
		StateKey:     "smartimage-main",
		LeftWidth:    220,
		LeftMinWidth: 180,
		LeftMaxWidth: 320,
		Left:         a.sidebar,
		Content:      a.content,
		ContentTitle: a.titlebar,
		Theme:        theme.Onevra,
	})
	a.win = a.shell.Window()
	a.win.OnFileDrop(func(e *mygo.FileDropEvent) { a.addTargets(e.Paths, nil) })
	a.win.OnClose(func(e *mygo.CloseEvent) {
		if !a.busy {
			return
		}
		e.PreventDefault()
		go func() {
			_, _ = mygo.Dialog.Message(mygo.MessageOptions{
				Parent:  a.win,
				Type:    mygo.MessageInfo,
				Title:   "正在处理",
				Message: "请先取消当前任务，再关闭窗口。",
				Buttons: []string{"知道了"},
			})
		}()
	})
	a.win.OnClosed(func() { mygo.App.Quit() })

	if l.hasQuick {
		a.applyQuickFormat(l.quick)
	}
	a.addTargets(l.paths, func() {
		if l.hasQuick {
			a.startConvert()
		}
	})
}

func (a *app) secondInstance(args []string, _ string) {
	l := parseLaunch(args)
	if a.win == nil {
		return
	}
	a.win.Update(func() {
		if l.hasQuick {
			a.applyQuickFormat(l.quick)
		}
	})
	a.addTargets(l.paths, func() {
		if l.hasQuick {
			a.startConvert()
		}
		a.win.Show()
		a.win.Focus()
	})
}

func (a *app) applyQuickFormat(f imageio.Format) {
	if a.busy {
		return
	}
	a.page = pageConvert
	a.setConvertFormat(f)
}

func (a *app) setPage(p page) {
	a.page = p
	if a.win != nil {
		a.win.Invalidate()
	}
}

func (a *app) setEdgeMode(m edgeMode) {
	a.edge = m
	if a.win != nil {
		a.win.Invalidate()
	}
}

func (a *app) currentOp() output.Op {
	switch a.page {
	case pageResize:
		return output.Resize
	case pageEdge:
		if a.edge == edgeCrop {
			return output.Crop
		}
		return output.Trim
	default:
		return output.Convert
	}
}

func (a *app) update(fn func()) {
	if a.win == nil {
		fn()
		return
	}
	a.win.Update(fn)
}
