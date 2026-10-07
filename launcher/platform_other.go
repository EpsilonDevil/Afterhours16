//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

func fatal(msg string) {
	logf("fatal: %s", msg)
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}

func hideWindow(cmd *exec.Cmd) {}

func platformPythons() []python {
	return []python{{exe: "python3"}, {exe: "python"}}
}

func findBrowser() string {
	if b := os.Getenv("AFTERHOURS16_BROWSER"); b != "" {
		return b
	}
	for _, b := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"} {
		if p, err := exec.LookPath(b); err == nil {
			return p
		}
		if st, err := os.Stat(b); err == nil && !st.IsDir() {
			return b
		}
	}
	return ""
}

func openDefault(url string) {
	for _, c := range []string{"xdg-open", "open"} {
		if p, err := exec.LookPath(c); err == nil {
			_ = exec.Command(p, url).Start()
			return
		}
	}
	fmt.Println("Open", url)
}

func offerPython(root string) (python, error) {
	fmt.Fprintln(os.Stderr, "Afterhours 16 needs Python 3.10+ (python3). Install it from your package manager or python.org.")
	return python{}, errors.New("python missing")
}
