// Package imageio decodes and encodes the image formats SmartImage supports.
//
// Decoding always returns pixels in display orientation: EXIF orientation is
// applied for JPEG/TIFF and the irot/imir transforms for WebP/AVIF. Callers can
// therefore treat the returned bounds as the upright coordinate space.
package imageio

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/avif"
	"github.com/gen2brain/jpegli"
	"github.com/gen2brain/webp"
)

// Format is a supported output format. JPEG covers the CLI's "mozjpeg"
// target: output is written by jpegli, the modern libjpeg-compatible encoder.
type Format string

// Output formats.
const (
	WebP Format = "webp"
	PNG  Format = "png"
	AVIF Format = "avif"
	JPEG Format = "mozjpeg"
)

// Formats lists the output formats in the order the UI offers them.
var Formats = []Format{WebP, PNG, AVIF, JPEG}

// Ext returns the normalized file extension, dot included.
func (f Format) Ext() string {
	switch f {
	case WebP:
		return ".webp"
	case PNG:
		return ".png"
	case AVIF:
		return ".avif"
	case JPEG:
		return ".jpg"
	}
	return ""
}

// Label returns the user-facing name of the format.
func (f Format) Label() string {
	switch f {
	case WebP:
		return "WebP"
	case PNG:
		return "PNG"
	case AVIF:
		return "AVIF"
	case JPEG:
		return "JPEG (jpegli)"
	}
	return string(f)
}

// ParseFormat maps a command-line name to a Format.
func ParseFormat(s string) (Format, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "webp":
		return WebP, nil
	case "png":
		return PNG, nil
	case "avif":
		return AVIF, nil
	case "mozjpeg", "jpg", "jpeg":
		return JPEG, nil
	}
	return "", fmt.Errorf("不支持的输出格式: %q", s)
}

var supportedExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".jfif": true,
	".png": true, ".bmp": true, ".tif": true, ".tiff": true,
	".gif": true, ".webp": true, ".avif": true,
}

// NormalizeExt lowercases ext and folds .jpeg/.jfif into .jpg.
func NormalizeExt(ext string) string {
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") && ext != "" {
		ext = "." + ext
	}
	switch ext {
	case ".jpeg", ".jfif":
		return ".jpg"
	}
	return ext
}

// IsSupported reports whether path has a supported image extension.
func IsSupported(path string) bool {
	return supportedExts[NormalizeExt(filepath.Ext(path))]
}

// FormatOfExt maps a normalized extension to a writable output format.
func FormatOfExt(ext string) (Format, bool) {
	switch NormalizeExt(ext) {
	case ".webp":
		return WebP, true
	case ".png":
		return PNG, true
	case ".avif":
		return AVIF, true
	case ".jpg":
		return JPEG, true
	}
	return "", false
}

// PreserveFormat picks the output format for "keep the source format". Inputs
// such as GIF, BMP and TIFF have no encoder here and fall back to PNG.
func PreserveFormat(srcExt string) Format {
	if f, ok := FormatOfExt(srcExt); ok {
		return f
	}
	return PNG
}

// DecodeFile opens path and decodes it in display orientation.
func DecodeFile(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Decode(f, filepath.Ext(path))
}

// Decode decodes r according to ext and applies its orientation.
func Decode(r io.Reader, ext string) (image.Image, error) {
	switch NormalizeExt(ext) {
	case ".webp":
		return webp.Decode(r, webp.Options{AutoRotate: true})
	case ".avif":
		return avif.Decode(r, avif.Options{AutoRotate: true})
	default:
		// imaging covers JPEG, PNG, GIF, BMP and TIFF and applies EXIF
		// orientation for JPEG/TIFF through imaging.AutoOrientation.
		img, err := imaging.Decode(r, imaging.AutoOrientation(true))
		if err != nil {
			return nil, fmt.Errorf("无法解码图像: %w", err)
		}
		return img, nil
	}
}

// Encode writes img to w in format f.
//
// JPEG has no alpha channel, so transparent pixels are composited onto white
// instead of being reduced to a black background.
func Encode(w io.Writer, img image.Image, f Format) error {
	switch f {
	case WebP:
		return webp.Encode(w, img, webp.Options{Quality: 80, Method: 6, Exact: true})
	case PNG:
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		return enc.Encode(w, img)
	case AVIF:
		return avif.Encode(w, img, avif.Options{
			Quality:      75,
			QualityAlpha: 75,
			Speed:        6,
		})
	case JPEG:
		return jpegli.Encode(w, flatten(img, color.White), &jpegli.EncodingOptions{
			Quality:           85,
			ChromaSubsampling: image.YCbCrSubsampleRatio444,
		})
	}
	return errors.New("不支持的输出格式")
}

// flatten composites img over background, returning img unchanged when it is
// already opaque.
func flatten(img image.Image, background color.Color) image.Image {
	if opaque(img) {
		return img
	}
	b := img.Bounds()
	dst := image.NewRGBA(b)
	draw.Draw(dst, b, &image.Uniform{C: background}, image.Point{}, draw.Src)
	draw.Draw(dst, b, img, b.Min, draw.Over)
	return dst
}

func opaque(img image.Image) bool {
	switch im := img.(type) {
	case *image.YCbCr, *image.Gray, *image.CMYK:
		return true
	case *image.NRGBA:
		for i := 3; i < len(im.Pix); i += 4 {
			if im.Pix[i] != 0xff {
				return false
			}
		}
		return true
	case *image.RGBA:
		for i := 3; i < len(im.Pix); i += 4 {
			if im.Pix[i] != 0xff {
				return false
			}
		}
		return true
	case *image.NRGBA64:
		for i := 6; i < len(im.Pix); i += 8 {
			if im.Pix[i] != 0xff || im.Pix[i+1] != 0xff {
				return false
			}
		}
		return true
	case *image.RGBA64:
		for i := 6; i < len(im.Pix); i += 8 {
			if im.Pix[i] != 0xff || im.Pix[i+1] != 0xff {
				return false
			}
		}
		return true
	}
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a != 0xffff {
				return false
			}
		}
	}
	return true
}
