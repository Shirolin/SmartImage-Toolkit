//go:build !windows

package main

import "errors"

var errNoShortcuts = errors.New("仅 Windows 支持此操作")

func shortcutPath(shortcutKind) (string, error) { return "", errNoShortcuts }

func createShortcutAt(string, string) error { return errNoShortcuts }

type contextMenu struct{}

var imageMenu contextMenu

func (contextMenu) registered(string) bool { return false }

func (contextMenu) register(string) error { return errNoShortcuts }

func (contextMenu) unregister() error { return errNoShortcuts }
