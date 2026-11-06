//go:build !windows

package main

import "errors"

var errNoShortcuts = errors.New("仅 Windows 支持此操作")

func shortcutPath(shortcutKind) (string, error) { return "", errNoShortcuts }

func createShortcutAt(string, string) error { return errNoShortcuts }

func contextMenuRegistered() bool { return false }

func registerContextMenu(string) error { return errNoShortcuts }

func unregisterContextMenu() error { return errNoShortcuts }
