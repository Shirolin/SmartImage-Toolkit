package settings

import (
	"os"
	"runtime"
	"testing"
)

func isolateConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	switch runtime.GOOS {
	case "windows":
		t.Setenv("APPDATA", dir)
	case "darwin":
		t.Setenv("HOME", dir)
	default:
		t.Setenv("XDG_CONFIG_HOME", dir)
	}
	return dir
}

func TestSaveLoadRoundTrip(t *testing.T) {
	isolateConfigDir(t)

	want := Settings{
		Format:      "avif",
		Location:    Subfolder,
		Subfolder:   "out",
		CustomDir:   "",
		Concurrency: 8,
	}
	if err := Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got := Load()
	if got != want {
		t.Fatalf("Load = %+v, want %+v", got, want)
	}
}

func TestLoadFallsBackToDefaults(t *testing.T) {
	dir := isolateConfigDir(t)
	path := dir + string(os.PathSeparator) + "SmartImage"
	if err := os.MkdirAll(path, 0o777); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+string(os.PathSeparator)+"settings.json", []byte("{bad json"), 0o666); err != nil {
		t.Fatal(err)
	}
	if got := Load(); got != Default() {
		t.Fatalf("Load = %+v, want defaults", got)
	}
}

func TestNormalizeClampsConcurrency(t *testing.T) {
	got := Settings{Concurrency: 99}.normalized()
	if got.Concurrency != 16 {
		t.Fatalf("concurrency = %d, want 16", got.Concurrency)
	}
}
