//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestImageMenuRepairsCommandsAndCleansUp(t *testing.T) {
	testPath := fmt.Sprintf(`Software\SmartImage.ContextMenu.Test.%d`, os.Getpid())
	root, _, err := registry.CreateKey(registry.CURRENT_USER, testPath, registry.ALL_ACCESS)
	if err != nil {
		t.Fatal(err)
	}
	menu := contextMenu{root: root}
	t.Cleanup(func() {
		_ = menu.unregister()
		for _, class := range contextMenuClasses {
			base := `Software\Classes\SystemFileAssociations\` + class
			_ = registry.DeleteKey(root, base+`\shell`)
			_ = registry.DeleteKey(root, base)
		}
		_ = registry.DeleteKey(root, `Software\Classes\SystemFileAssociations`)
		_ = registry.DeleteKey(root, `Software\Classes`)
		_ = registry.DeleteKey(root, `Software`)
		_ = root.Close()
		_ = registry.DeleteKey(registry.CURRENT_USER, testPath)
	})

	current := filepath.Join(t.TempDir(), "Current Install", "SmartImage.exe")
	old := filepath.Join(t.TempDir(), "Old Install", "SmartImage.exe")
	if err := menu.register(old); err != nil {
		t.Fatal(err)
	}
	if menu.registered(current) {
		t.Fatal("commands pointing at an old install appear enabled")
	}
	if err := menu.register(current); err != nil {
		t.Fatal(err)
	}
	if !menu.registered(current) {
		t.Fatal("registration did not repair the commands")
	}
	for _, class := range []string{"image", ".png", ".webp"} {
		key, err := registry.OpenKey(root, contextMenuKey(class, "SmartImageWebP")+`\command`, registry.QUERY_VALUE)
		if err != nil {
			t.Fatal(err)
		}
		command, _, err := key.GetStringValue("")
		key.Close()
		if want := `"` + current + `" --quick webp "%1"`; err != nil || command != want {
			t.Fatalf("%s command = %q, %v; want %q", class, command, err, want)
		}
	}
	for range 2 {
		if err := menu.unregister(); err != nil {
			t.Fatal(err)
		}
	}
	for _, class := range contextMenuClasses {
		for _, verb := range contextMenuVerbs {
			path := contextMenuKey(class, verb.key)
			if key, err := registry.OpenKey(root, path, registry.READ); err == nil {
				key.Close()
				t.Errorf("%s survived removal", path)
			} else if err != registry.ErrNotExist {
				t.Errorf("checking removal of %s: %v", path, err)
			}
		}
	}
}
