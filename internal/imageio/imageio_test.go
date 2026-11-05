package imageio

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

// testImage is a small gradient with a transparent corner, so alpha fidelity
// is exercised alongside color fidelity.
func testImage() *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, 64, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 64; x++ {
			a := uint8(255)
			if x < 16 && y < 16 {
				a = uint8(x * 16)
			}
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(x * 4),
				G: uint8(y * 5),
				B: uint8((x + y) * 2),
				A: a,
			})
		}
	}
	return img
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	for _, format := range Formats {
		t.Run(string(format), func(t *testing.T) {
			var buf bytes.Buffer
			if err := Encode(&buf, testImage(), format); err != nil {
				t.Fatalf("Encode: %v", err)
			}
			got, err := Decode(bytes.NewReader(buf.Bytes()), format.Ext())
			if err != nil {
				t.Fatalf("Decode: %v", err)
			}
			if b := got.Bounds(); b.Dx() != 64 || b.Dy() != 48 {
				t.Fatalf("bounds = %v, want 64x48", b)
			}

			// Sample an opaque interior pixel; lossy encoders move it a little,
			// so allow a visible-but-small error.
			r, g, b, a := got.At(40, 32).RGBA()
			wantR, wantG, wantB := uint32(40*4*257), uint32(32*5*257), uint32((40+32)*2*257)
			if absDiff(r, wantR) > 20*257 || absDiff(g, wantG) > 20*257 || absDiff(b, wantB) > 20*257 {
				t.Fatalf("pixel = (%d,%d,%d), want near (%d,%d,%d)", r>>8, g>>8, b>>8, wantR>>8, wantG>>8, wantB>>8)
			}
			if format != JPEG && a != 0xffff {
				t.Fatalf("alpha = %d, want opaque", a)
			}
		})
	}
}

func TestEncodeJPEGFlattensTransparency(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 8, 8)) // fully transparent black
	var buf bytes.Buffer
	if err := Encode(&buf, img, JPEG); err != nil {
		t.Fatalf("Encode: %v", err)
	}
	got, err := Decode(bytes.NewReader(buf.Bytes()), ".jpg")
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	r, g, b, _ := got.At(4, 4).RGBA()
	if r < 0xe000 || g < 0xe000 || b < 0xe000 {
		t.Fatalf("transparent pixel = (%d,%d,%d), want near white", r>>8, g>>8, b>>8)
	}
}

func TestParseFormat(t *testing.T) {
	for name, want := range map[string]Format{
		"webp": WebP, "PNG": PNG, "avif": AVIF, "mozjpeg": JPEG, "jpg": JPEG, "jpeg": JPEG,
	} {
		got, err := ParseFormat(name)
		if err != nil || got != want {
			t.Fatalf("ParseFormat(%q) = %q, %v; want %q", name, got, err, want)
		}
	}
	if _, err := ParseFormat("gif"); err == nil {
		t.Fatal("ParseFormat(gif) succeeded, want error")
	}
}

// TestDecodeAppliesExifOrientation locks the pipeline's core promise: a
// landscape JPEG tagged orientation 6 decodes to portrait bounds.
func TestDecodeAppliesExifOrientation(t *testing.T) {
	var raw bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 40, 20))
	if err := jpeg.Encode(&raw, img, nil); err != nil {
		t.Fatal(err)
	}

	got, err := Decode(bytes.NewReader(withOrientation(t, raw.Bytes(), 6)), ".jpg")
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if b := got.Bounds(); b.Dx() != 20 || b.Dy() != 40 {
		t.Fatalf("bounds = %dx%d, want 20x40", b.Dx(), b.Dy())
	}
}

// withOrientation inserts an APP1 EXIF segment containing only the Orientation
// tag into a JPEG stream.
func withOrientation(t *testing.T, jpg []byte, orientation uint16) []byte {
	t.Helper()
	if len(jpg) < 2 || jpg[0] != 0xff || jpg[1] != 0xd8 {
		t.Fatal("not a JPEG stream")
	}

	tiff := make([]byte, 26)
	copy(tiff, "MM\x00\x2a")
	binary.BigEndian.PutUint32(tiff[4:], 8) // IFD0 offset
	binary.BigEndian.PutUint16(tiff[8:], 1) // one entry
	binary.BigEndian.PutUint16(tiff[10:], 0x0112)
	binary.BigEndian.PutUint16(tiff[12:], 3) // SHORT
	binary.BigEndian.PutUint32(tiff[14:], 1)
	binary.BigEndian.PutUint16(tiff[18:], orientation)

	payload := append([]byte("Exif\x00\x00"), tiff...)
	segment := make([]byte, 4+len(payload))
	segment[0], segment[1] = 0xff, 0xe1
	binary.BigEndian.PutUint16(segment[2:], uint16(len(payload)+2))
	copy(segment[4:], payload)

	out := append([]byte{}, jpg[:2]...)
	out = append(out, segment...)
	out = append(out, jpg[2:]...)
	return out
}

func absDiff(a, b uint32) uint32 {
	if a > b {
		return a - b
	}
	return b - a
}
