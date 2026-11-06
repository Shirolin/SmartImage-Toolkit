package main

import (
	"os"
)

// shortcutKind is a place the app can be pinned to.
type shortcutKind int

const (
	shortcutStartMenu shortcutKind = iota
	shortcutDesktop
)

func (k shortcutKind) label() string {
	if k == shortcutDesktop {
		return "桌面"
	}
	return "开始菜单"
}

// shortcutExists reports whether the app's shortcut is present there.
func shortcutExists(k shortcutKind) bool {
	path, err := shortcutPath(k)
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

// toggleShortcut adds the missing shortcut or removes the present one.
func (a *app) toggleShortcut(k shortcutKind) {
	path, err := shortcutPath(k)
	if err != nil {
		a.notice = k.label() + "快捷方式不可用：" + err.Error()
	} else if _, statErr := os.Stat(path); statErr == nil {
		if err := os.Remove(path); err != nil {
			a.notice = "移除" + k.label() + "快捷方式失败：" + err.Error()
		} else {
			a.notice = k.label() + "快捷方式已移除。"
		}
	} else {
		target, err := os.Executable()
		if err == nil {
			err = createShortcutAt(path, target)
		}
		if err != nil {
			a.notice = "添加" + k.label() + "快捷方式失败：" + err.Error()
		} else {
			a.notice = k.label() + "快捷方式已添加。"
		}
	}
	if a.win != nil {
		a.win.Invalidate()
	}
}
