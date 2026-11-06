// Package output resolves where an operation writes and what it names the
// result. It never touches the file system; allocation stays in pipeline.
package output

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/Shirolin/SmartImage-Toolkit/internal/imageio"
	"github.com/Shirolin/SmartImage-Toolkit/internal/settings"
)

// Op identifies the operation that produced an output.
type Op string

// Operations.
const (
	Convert Op = "convert"
	Resize  Op = "resize"
	Trim    Op = "trim"
	Crop    Op = "crop"
	Center  Op = "center"
	Pad     Op = "pad"
	Matting Op = "matting"
	Split   Op = "split"
)

// DefaultSubfolder is the folder used when the location policy is Subfolder
// and the user did not override the name.
func (op Op) DefaultSubfolder() string {
	switch op {
	case Convert:
		return "converted"
	case Resize:
		return "resized"
	case Trim:
		return "trimmed"
	case Crop:
		return "cropped"
	case Center:
		return "centered"
	case Pad:
		return "pad-aspect"
	case Matting:
		return "matting"
	case Split:
		return "split"
	}
	return "output"
}

// Suffix is appended to the base name of operation outputs. Convert adds it
// only when the target extension equals the source extension, so converting
// PNG to WebP keeps the original name.
func (op Op) Suffix() string {
	switch op {
	case Resize:
		return "_resized"
	case Center:
		return "_centered"
	case Pad:
		return "_pad"
	case Matting:
		return "_nobg"
	}
	return ""
}

// Policy is the user's output preference.
type Policy struct {
	Location  settings.Location
	Subfolder string
	CustomDir string
}

// FromSettings builds a policy from persisted preferences.
func FromSettings(s settings.Settings) Policy {
	return Policy{Location: s.Location, Subfolder: s.Subfolder, CustomDir: s.CustomDir}
}

// Target returns the directory, base name and normalized extension for a
// source file and operation. Callers pass the result to pipeline.AllocateFilePath.
func (p Policy) Target(src, targetExt string, op Op) (dir, base, ext string, err error) {
	location := p.Location
	if location == "" {
		location = settings.SameDir
	}
	dir = filepath.Dir(src)
	switch location {
	case settings.SameDir:
	case settings.Subfolder:
		name := strings.TrimSpace(p.Subfolder)
		if name == "" {
			name = op.DefaultSubfolder()
		}
		dir = filepath.Join(dir, name)
	case settings.CustomDir:
		if strings.TrimSpace(p.CustomDir) == "" {
			return "", "", "", errors.New("尚未选择输出目录")
		}
		dir = p.CustomDir
	default:
		return "", "", "", fmt.Errorf("未知的输出位置: %q", p.Location)
	}

	ext = imageio.NormalizeExt(targetExt)
	base = strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))
	sourceExt := imageio.NormalizeExt(filepath.Ext(src))

	suffix := op.Suffix()
	if op == Convert && sourceExt == ext {
		// Converting to the source format must not overwrite the original.
		suffix = "_optimized"
	}
	return dir, base + suffix, ext, nil
}
