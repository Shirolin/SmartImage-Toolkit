// Package matting removes image backgrounds with a local ONNX model. The
// model runs in a separate worker process (worker/matting) so native runtime
// failures cannot take the workbench down; this package owns the protocol,
// output rules and the batch lifecycle.
package matting

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/ops"
	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
	"github.com/Shirolin/SmartImage-Toolkit/internal/pipeline"
)

// magic starts every worker's stdout so a wrong executable fails fast.
const magic = "SIM1\n"

// maxFrame bounds one protocol frame; a 100 MP RGBA image is under half this.
const maxFrame = 512 << 20

// startTimeout allows a cold disk to page in a large model.
const startTimeout = 2 * time.Minute

// Config is the operation input. WorkerPath and ModelPath are resolved by the
// caller; Format is "original" or an imageio format name.
type Config struct {
	WorkerPath string
	ModelPath  string
	Feather    int
	Format     string
	Policy     output.Policy
}

// Engine is one running matting worker.
type Engine struct {
	cmd    *exec.Cmd
	in     io.WriteCloser
	out    *bufio.Reader
	stderr *tailBuffer

	mu   sync.Mutex
	dead bool
}

// StartEngine launches the worker and waits for its ready marker. The model
// loads before the marker, so a bad model fails here, not mid-batch.
func StartEngine(workerPath, modelPath string) (*Engine, error) {
	if workerPath == "" {
		return nil, errors.New("抠图引擎未安装：找不到 matting-worker")
	}
	if modelPath == "" {
		return nil, errors.New("抠图模型未安装")
	}
	cmd := exec.Command(workerPath, "--model", modelPath)
	hideWindow(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	logs := &tailBuffer{limit: 8 << 10}
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("无法启动抠图引擎: %w", err)
	}
	e := &Engine{cmd: cmd, in: in, out: bufio.NewReaderSize(out, 64<<10), stderr: logs}

	ready := make(chan error, 1)
	go func() {
		buf := make([]byte, len(magic))
		_, err := io.ReadFull(e.out, buf)
		if err == nil && string(buf) != magic {
			err = fmt.Errorf("抠图引擎返回了未知协议: %q", buf)
		}
		ready <- err
	}()
	select {
	case err := <-ready:
		if err != nil {
			e.kill()
			return nil, e.startError(err)
		}
		return e, nil
	case <-time.After(startTimeout):
		e.kill()
		return nil, errors.New("抠图引擎加载超时，请检查模型文件是否损坏")
	}
}

func (e *Engine) startError(err error) error {
	if tail := e.stderr.String(); tail != "" {
		return fmt.Errorf("抠图引擎启动失败: %v（%s）", err, tail)
	}
	return fmt.Errorf("抠图引擎启动失败: %v", err)
}

// Process turns one upright image into straight-alpha RGBA.
func (e *Engine) Process(ctx context.Context, img image.Image) (*image.NRGBA, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.dead {
		return nil, errors.New("抠图引擎已退出，请重试")
	}

	var frame bytes.Buffer
	if err := png.Encode(&frame, img); err != nil {
		return nil, fmt.Errorf("无法准备图片: %w", err)
	}
	if frame.Len() > maxFrame {
		return nil, errors.New("图片过大，抠图最多支持 512 MB 的中间图像")
	}

	done := make(chan reply, 1)
	go func() { done <- e.roundTrip(frame.Bytes()) }()
	select {
	case r := <-done:
		if r.err != nil {
			e.markDead()
		}
		return r.img, r.err
	case <-ctx.Done():
		// Process holds e.mu; mark the engine dead directly instead of
		// calling kill, which would lock the mutex again.
		e.dead = true
		if e.cmd.Process != nil {
			_ = e.cmd.Process.Kill()
		}
		return nil, ctx.Err()
	}
}

func (e *Engine) roundTrip(payload []byte) reply {
	defer func() {
		if p := recover(); p != nil {
			e.markDead()
		}
	}()
	buf := binary.LittleEndian.AppendUint32(nil, uint32(len(payload)))
	if _, err := e.in.Write(buf); err != nil {
		return reply{err: fmt.Errorf("抠图引擎写入失败: %w", err)}
	}
	if _, err := e.in.Write(payload); err != nil {
		return reply{err: fmt.Errorf("抠图引擎写入失败: %w", err)}
	}
	var lenBuf [4]byte
	if _, err := io.ReadFull(e.out, lenBuf[:]); err != nil {
		return reply{err: e.closedError(err)}
	}
	n := binary.LittleEndian.Uint32(lenBuf[:])
	if n == 0 || n > maxFrame {
		return reply{err: errors.New("抠图引擎返回了无效数据")}
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(e.out, body); err != nil {
		return reply{err: e.closedError(err)}
	}
	switch body[0] {
	case 0:
		if len(body) < 9 {
			return reply{err: errors.New("抠图引擎返回了无效图像")}
		}
		w := binary.LittleEndian.Uint32(body[1:5])
		h := binary.LittleEndian.Uint32(body[5:9])
		if uint64(w)*uint64(h)*4 != uint64(len(body)-9) {
			return reply{err: errors.New("抠图引擎返回了无效图像")}
		}
		img := &image.NRGBA{Pix: body[9:], Stride: 4 * int(w), Rect: image.Rect(0, 0, int(w), int(h))}
		return reply{img: img}
	case 1:
		return reply{err: fmt.Errorf("抠图失败: %s", string(body[1:]))}
	default:
		return reply{err: errors.New("抠图引擎返回了未知响应")}
	}
}

type reply struct {
	img *image.NRGBA
	err error
}

func (e *Engine) closedError(err error) error {
	if tail := e.stderr.String(); tail != "" {
		return fmt.Errorf("抠图引擎意外退出: %v（%s）", err, tail)
	}
	return fmt.Errorf("抠图引擎意外退出: %v", err)
}

func (e *Engine) markDead() {
	e.mu.Lock()
	e.dead = true
	e.mu.Unlock()
}

func (e *Engine) kill() {
	e.markDead()
	if e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
	}
}

// Close stops the worker. A worker that already died is not an error.
func (e *Engine) Close() {
	_ = e.in.Close()
	done := make(chan struct{})
	go func() {
		_ = e.cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		e.kill()
		<-done
	}
}

// Run matting on one file with a fresh engine. Batch callers should use
// RunAll so the model loads once.
func Run(ctx context.Context, src string, cfg Config) ops.Result {
	engine, err := StartEngine(cfg.WorkerPath, cfg.ModelPath)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error()}
	}
	defer engine.Close()
	return RunWith(ctx, engine, src, cfg)
}

// RunWith processes one file through an existing engine.
func RunWith(ctx context.Context, engine *Engine, src string, cfg Config) ops.Result {
	src = filepath.Clean(src)
	srcExt := imageio.NormalizeExt(filepath.Ext(src))

	var inputSize int64
	if info, err := os.Stat(src); err == nil {
		inputSize = info.Size()
	}
	format, note, err := targetFormat(cfg.Format, srcExt)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	if err := ctx.Err(); err != nil {
		return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
	}
	img, err := imageio.DecodeFile(src)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: fmt.Sprintf("图片文件解析失败: %v", err), InputSize: inputSize}
	}

	result, err := engine.Process(ctx, img)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
		}
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	if cfg.Feather > 0 {
		featherAlpha(result, cfg.Feather)
	}

	dir, base, outExt, err := cfg.Policy.Target(src, format.Ext(), output.Matting)
	if err != nil {
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	out, outSize, err := pipeline.Emit(ctx, dir, base, outExt, result, format)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return ops.Result{Status: ops.StatusCanceled, File: src, InputSize: inputSize}
		}
		return ops.Result{Status: ops.StatusError, File: src, Reason: err.Error(), InputSize: inputSize}
	}
	b := result.Bounds()
	return ops.Result{
		Status: ops.StatusSuccess, File: src, Output: out,
		Reason: note, InputSize: inputSize, OutputSize: outSize,
		Width: b.Dx(), Height: b.Dy(),
	}
}

// RunAll processes paths through one engine, sequentially: the model and its
// thread pool are shared, and cancellation kills the worker.
func RunAll(ctx context.Context, paths []string, cfg Config, progress ops.Progress) []ops.Result {
	engine, err := StartEngine(cfg.WorkerPath, cfg.ModelPath)
	if err != nil {
		results := make([]ops.Result, len(paths))
		for i, src := range paths {
			results[i] = ops.Result{Status: ops.StatusError, File: src, Reason: err.Error()}
		}
		return results
	}
	defer engine.Close()
	return ops.RunAll(ctx, paths, 1, func(ctx context.Context, src string) ops.Result {
		return RunWith(ctx, engine, src, cfg)
	}, progress)
}

// featherAlpha softens mask edges with a separable box blur. It touches only
// the alpha channel, so the subject's colors stay untouched.
func featherAlpha(img *image.NRGBA, radius int) {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	if radius < 1 || w == 0 || h == 0 {
		return
	}
	tmp := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		row := y * img.Stride
		for x := 0; x < w; x++ {
			sum, n := 0, 0
			for dx := -radius; dx <= radius; dx++ {
				x2 := x + dx
				if x2 < 0 || x2 >= w {
					continue
				}
				sum += int(img.Pix[row+4*x2+3])
				n++
			}
			tmp[y*w+x] = uint8(sum / n)
		}
	}
	for y := 0; y < h; y++ {
		row := y * img.Stride
		for x := 0; x < w; x++ {
			sum, n := 0, 0
			for dy := -radius; dy <= radius; dy++ {
				y2 := y + dy
				if y2 < 0 || y2 >= h {
					continue
				}
				sum += int(tmp[y2*w+x])
				n++
			}
			img.Pix[row+4*x+3] = uint8(sum / n)
		}
	}
}

// targetFormat keeps alpha: formats without an alpha channel fall back to PNG.
// The returned note explains a forced fallback to the user.
func targetFormat(choice, srcExt string) (imageio.Format, string, error) {
	if choice == "" || choice == "original" {
		switch srcExt {
		case ".webp":
			return imageio.WebP, "", nil
		case ".avif":
			return imageio.AVIF, "", nil
		default:
			return imageio.PNG, "", nil
		}
	}
	f, err := imageio.ParseFormat(choice)
	if err != nil {
		return "", "", err
	}
	if f == imageio.JPEG {
		return imageio.PNG, "JPEG 不支持透明，已输出 PNG", nil
	}
	return f, "", nil
}

// tailBuffer keeps the last bytes of a worker's stderr for error messages.
type tailBuffer struct {
	mu    sync.Mutex
	limit int
	buf   []byte
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buf = append(b.buf, p...)
	if len(b.buf) > b.limit {
		b.buf = b.buf[len(b.buf)-b.limit:]
	}
	return len(p), nil
}

func (b *tailBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(bytes.TrimSpace(b.buf))
}
