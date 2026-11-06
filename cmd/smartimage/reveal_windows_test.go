//go:build windows

package main

import "testing"

func TestRevealCommandLineQuotesThePathOnly(t *testing.T) {
	got := revealCommandLine(`D:\pics\My File.png`)
	want := `explorer.exe /select,"D:\pics\My File.png"`
	if got != want {
		t.Fatalf("command line = %q, want %q", got, want)
	}
}
