//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	messageBoxW = user32.NewProc("MessageBoxW")
)

const (
	mbOK          = 0x00000000
	mbYesNoCancel = 0x00000003
	mbIconError   = 0x00000010
	mbIconQuest   = 0x00000020
	mbIconInfo    = 0x00000040
	idYes         = 6
	idNo          = 7
)

func msgBox(text, title string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	r, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
	return int(r)
}

func fatal(msg string) {
	logf("fatal: %s", msg)
	msgBox(msg, "Afterhours 16", mbOK|mbIconError)
	os.Exit(1)
}

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

func platformPythons() []python {
	c := []python{{exe: "py", args: []string{"-3"}}, {exe: "python"}, {exe: "python3"}}
	// standard per-user and all-users install folders (newest first), in case PATH wasn't updated
	var found []string
	for _, base := range []string{
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Python"),
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramFiles(x86)"),
	} {
		if base == "" {
			continue
		}
		m, _ := filepath.Glob(filepath.Join(base, "Python3*", "python.exe"))
		found = append(found, m...)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(found)))
	for _, f := range found {
		c = append(c, python{exe: f})
	}
	return c
}

func findBrowser() string {
	pf, pf86, local := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")
	for _, p := range []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf, `BraveSoftware\Brave-Browser\Application\brave.exe`),
		filepath.Join(local, `BraveSoftware\Brave-Browser\Application\brave.exe`),
	} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func openDefault(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// offerPython asks to install Python with winget (built into Windows 10/11), or opens python.org.
func offerPython(root string) (python, error) {
	r := msgBox("Afterhours 16 runs its game service on Python 3.10 or newer (free, about 30 MB), and it isn't installed yet.\n\n"+
		"Yes  — install it now automatically (Windows Package Manager)\n"+
		"No   — open the python.org download page\n"+
		"Cancel — quit", "Afterhours 16 — one-time setup", mbYesNoCancel|mbIconQuest)
	switch r {
	case idYes:
		if _, err := exec.LookPath("winget"); err != nil {
			msgBox("Windows Package Manager (winget) isn't available on this PC.\n\nThe python.org download page will open instead. Install Python (tick \"Add python.exe to PATH\"), then start Afterhours 16 again.", "Afterhours 16", mbOK|mbIconInfo)
			openDefault("https://www.python.org/downloads/windows/")
			return python{}, errors.New("no winget")
		}
		// "start /wait" gives winget its own visible console so the install progress shows
		cmd := exec.Command("cmd", "/c", "start", "Installing Python for Afterhours 16", "/wait",
			"winget", "install", "-e", "--id", "Python.Python.3.12", "--scope", "user",
			"--accept-package-agreements", "--accept-source-agreements")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		logf("running winget install Python.Python.3.12")
		if err := cmd.Run(); err != nil {
			logf("winget: %v", err)
		}
		if py, err := findPython(root, ""); err == nil {
			return py, nil
		}
		msgBox("Python was installed. Please start Afterhours 16 again.", "Afterhours 16", mbOK|mbIconInfo)
		return python{}, errors.New("restart needed")
	case idNo:
		openDefault("https://www.python.org/downloads/windows/")
	}
	return python{}, errors.New("python missing")
}
