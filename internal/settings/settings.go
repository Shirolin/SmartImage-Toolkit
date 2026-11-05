// Package settings persists the desktop app's user preferences.
package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Location selects where operation outputs are written.
type Location string

const (
	// SameDir writes next to the source file.
	SameDir Location = "same_dir"
	// Subfolder writes into a subfolder of the source directory.
	Subfolder Location = "subfolder"
	// CustomDir writes into one chosen directory.
	CustomDir Location = "custom_dir"
)

// Settings is the persisted preference set.
type Settings struct {
	Format      string   `json:"format"`
	Location    Location `json:"location"`
	Subfolder   string   `json:"subfolder"`
	CustomDir   string   `json:"custom_dir"`
	Concurrency int      `json:"concurrency"`
}

// Default returns the initial preferences.
func Default() Settings {
	return Settings{
		Format:      "webp",
		Location:    SameDir,
		Concurrency: 5,
	}
}

// Dir returns the directory that holds the settings file.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "SmartImage"), nil
}

// Path returns the settings file path.
func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

// Load reads the stored settings, falling back to defaults for missing or
// invalid fields. A missing file is not an error.
func Load() Settings {
	s := Default()
	path, err := Path()
	if err != nil {
		return s
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return Default()
	}
	return s.normalized()
}

func (s Settings) normalized() Settings {
	d := Default()
	switch s.Location {
	case SameDir, Subfolder, CustomDir:
	default:
		s.Location = d.Location
	}
	if s.Format == "" {
		s.Format = d.Format
	}
	// An empty Subfolder means "use the operation's default name".
	if s.Concurrency < 1 {
		s.Concurrency = d.Concurrency
	}
	if s.Concurrency > 16 {
		s.Concurrency = 16
	}
	return s
}

// Save writes the settings atomically.
func Save(s Settings) error {
	s = s.normalized()
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o777); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "settings.json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o666); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
