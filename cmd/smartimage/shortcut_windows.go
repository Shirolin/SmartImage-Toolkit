//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

// The shortcut is a .lnk written through the shell's IShellLink object, so it
// carries the app icon, working directory and a description like the
// installer's own shortcuts. Only the few vtable slots used here are needed,
// which keeps the app free of a COM wrapper dependency.

type guid struct {
	data1 uint32
	data2 uint16
	data3 uint16
	data4 [8]byte
}

var (
	clsidShellLink = guid{0x00021401, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidShellLink   = guid{0x000214F9, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidPersistFile = guid{0x0000010B, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}

	folderPrograms = guid{0xA77F5D77, 0x2E2B, 0x44C3, [8]byte{0xA6, 0xA2, 0xAB, 0xA6, 0x01, 0x05, 0x4A, 0x51}}
	folderDesktop  = guid{0xB4BFCC3A, 0xDB2C, 0x424C, [8]byte{0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41}}

	ole32   = syscall.NewLazyDLL("ole32.dll")
	shell32 = syscall.NewLazyDLL("shell32.dll")

	procCoInitializeEx       = ole32.NewProc("CoInitializeEx")
	procCoUninitialize       = ole32.NewProc("CoUninitialize")
	procCoCreateInstance     = ole32.NewProc("CoCreateInstance")
	procCoTaskMemFree        = ole32.NewProc("CoTaskMemFree")
	procSHGetKnownFolderPath = shell32.NewProc("SHGetKnownFolderPath")
)

const (
	coinitApartmentThreaded = 2
	clsctxInprocServer      = 1

	vtQueryInterface = 0
	vtRelease        = 2

	vtSetDescription      = 7
	vtSetWorkingDirectory = 9
	vtSetIconLocation     = 17
	vtSetPath             = 20

	vtPersistSave = 6
)

// withCOM runs fn inside a COM apartment and balances the initialization.
func withCOM(fn func() error) error {
	hr, _, _ := procCoInitializeEx.Call(0, coinitApartmentThreaded)
	if int32(hr) >= 0 {
		defer procCoUninitialize.Call()
	}
	return fn()
}

// comCall invokes vtable slot method on obj and returns its HRESULT.
func comCall(obj unsafe.Pointer, method int, args ...uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(obj)
	slot := (*[32]uintptr)(vtbl)[method]
	r, _, _ := syscall.SyscallN(slot, append([]uintptr{uintptr(obj)}, args...)...)
	return r
}

func failed(hr uintptr) bool { return int32(hr) < 0 }

// knownFolder resolves one of the shell's per-user folders, which follows
// redirections such as a OneDrive-managed desktop.
func knownFolder(id *guid) (string, error) {
	var path *uint16
	var resolveErr error
	err := withCOM(func() error {
		hr, _, _ := procSHGetKnownFolderPath.Call(
			uintptr(unsafe.Pointer(id)), 0, 0, uintptr(unsafe.Pointer(&path)))
		if failed(hr) || path == nil {
			resolveErr = fmt.Errorf("0x%08x", uint32(hr))
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if resolveErr != nil {
		return "", fmt.Errorf("无法定位系统文件夹（%v）", resolveErr)
	}
	defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(path)))
	return utf16String(path), nil
}

func utf16String(p *uint16) string {
	var units []uint16
	for ptr := unsafe.Pointer(p); ; ptr = unsafe.Add(ptr, 2) {
		v := *(*uint16)(ptr)
		if v == 0 {
			break
		}
		units = append(units, v)
	}
	return string(utf16.Decode(units))
}

// shortcutPath is where the app's Start menu or desktop .lnk lives. The
// installer uses the same names, so both see each other's shortcut.
func shortcutPath(k shortcutKind) (string, error) {
	id := &folderPrograms
	if k == shortcutDesktop {
		id = &folderDesktop
	}
	dir, err := knownFolder(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "SmartImage.lnk"), nil
}

// createShortcutAt writes a .lnk at link that launches target with the icon,
// working directory and description set.
func createShortcutAt(link, target string) error {
	return withCOM(func() error {
		var linkObj unsafe.Pointer
		hr, _, _ := procCoCreateInstance.Call(
			uintptr(unsafe.Pointer(&clsidShellLink)), 0, clsctxInprocServer,
			uintptr(unsafe.Pointer(&iidShellLink)), uintptr(unsafe.Pointer(&linkObj)))
		if failed(hr) || linkObj == nil {
			return fmt.Errorf("创建快捷方式对象失败（0x%08x）", uint32(hr))
		}
		defer comCall(linkObj, vtRelease)

		targetPtr, err := syscall.UTF16PtrFromString(target)
		if err != nil {
			return err
		}
		workDir, err := syscall.UTF16PtrFromString(filepath.Dir(target))
		if err != nil {
			return err
		}
		desc, err := syscall.UTF16PtrFromString("SmartImage 图像处理工作台")
		if err != nil {
			return err
		}
		comCall(linkObj, vtSetPath, uintptr(unsafe.Pointer(targetPtr)), 0)
		comCall(linkObj, vtSetWorkingDirectory, uintptr(unsafe.Pointer(workDir)))
		comCall(linkObj, vtSetDescription, uintptr(unsafe.Pointer(desc)))
		comCall(linkObj, vtSetIconLocation, uintptr(unsafe.Pointer(targetPtr)), 0)

		var persist unsafe.Pointer
		hr = comCall(linkObj, vtQueryInterface,
			uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&persist)))
		if failed(hr) || persist == nil {
			return fmt.Errorf("读取快捷方式写入接口失败（0x%08x）", uint32(hr))
		}
		defer comCall(persist, vtRelease)

		linkPtr, err := syscall.UTF16PtrFromString(link)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
			return err
		}
		hr = comCall(persist, vtPersistSave, uintptr(unsafe.Pointer(linkPtr)), 1)
		if failed(hr) {
			return fmt.Errorf("写入快捷方式文件失败（0x%08x）", uint32(hr))
		}
		return nil
	})
}
