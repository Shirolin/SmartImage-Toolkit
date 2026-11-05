package ops

import (
	"image"
	"image/color"
)

// Fill names the color that pads an image. The composition operations share
// it so "background" means the same thing everywhere.
type Fill string

// Fill choices offered by the UI.
const (
	FillAuto        Fill = "auto"
	FillTransparent Fill = "transparent"
	FillWhite       Fill = "white"
	FillBlack       Fill = "black"
)

// Color resolves the fill for an image. FillAuto samples the top-left pixel,
// which is the border color the trim and center detectors already trust.
func (f Fill) Color(img image.Image) color.NRGBA {
	switch f {
	case FillWhite:
		return color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	case FillBlack:
		return color.NRGBA{A: 255}
	case FillAuto:
		if img != nil {
			b := img.Bounds()
			if b.Dx() > 0 && b.Dy() > 0 {
				return color.NRGBAModel.Convert(img.At(b.Min.X, b.Min.Y)).(color.NRGBA)
			}
		}
	}
	return color.NRGBA{}
}
