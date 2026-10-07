// Afterhours16 launcher.
//
// Double-click Afterhours16.exe and the game opens fullscreen in its own window:
//  1. finds Python 3.10+ (offers to install it with winget on Windows if missing),
//  2. starts the local game service hidden, with --exit-when-idle so it stops by itself
//     shortly after the game window closes,
//  3. opens Microsoft Edge or Google Chrome as a chromeless, fullscreen app window with its own
//     profile (data/browser-profile) so nothing else from your browser shows up,
//  4. waits for the service to stop, then exits.
//
// Options (command line or data/launcher.json): -windowed, -kiosk, -port N, -browser PATH, -python PATH.
// Built from the standard library only: GOOS=windows go build -ldflags "-H windowsgui".
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const version = "0.4.4"

type config struct {
	Windowed bool   `json:"windowed"`
	Kiosk    bool   `json:"kiosk"`
	Port     int    `json:"port"`
	Browser  string `json:"browser"`
	Python   string `json:"python"`
	IdleExit int    `json:"idle_exit_seconds"`
}

var logw io.Writer = io.Discard

func logf(f string, a ...any) {
	fmt.Fprintf(logw, time.Now().Format("15:04:05 ")+f+"\n", a...)
}

func main() {
	root, err := gameRoot()
	if err != nil {
		fatal("Afterhours 16 can't find its files.\n\nKeep Afterhours16.exe inside the Afterhours16 folder (next to the \"server\" and \"client\" folders).")
	}
	data := filepath.Join(root, "data")
	_ = os.MkdirAll(data, 0o755)
	if f, err := os.Create(filepath.Join(data, "launcher.log")); err == nil {
		logw = f
		defer f.Close()
	}
	logf("Afterhours16 launcher %s in %s", version, root)

	cfg := config{Port: 8765, IdleExit: 45}
	if b, err := os.ReadFile(filepath.Join(data, "launcher.json")); err == nil {
		if err := json.Unmarshal(b, &cfg); err != nil {
			logf("launcher.json ignored: %v", err)
		}
	}
	flag.BoolVar(&cfg.Windowed, "windowed", cfg.Windowed, "open in a window instead of fullscreen")
	flag.BoolVar(&cfg.Kiosk, "kiosk", cfg.Kiosk, "kiosk mode (no way out except Alt+F4)")
	flag.IntVar(&cfg.Port, "port", cfg.Port, "local port for the game service")
	flag.StringVar(&cfg.Browser, "browser", cfg.Browser, "path to msedge.exe / chrome.exe")
	flag.StringVar(&cfg.Python, "python", cfg.Python, "path to python.exe")
	flag.Parse()
	if cfg.IdleExit < 15 {
		cfg.IdleExit = 15
	}

	// 1. is a game service already running (second launch)? reuse it
	port := cfg.Port
	var server *exec.Cmd
	if isOurs(port) {
		logf("service already running on %d", port)
	} else {
		if !portFree(port) {
			port = freePort()
			logf("port %d busy, using %d", cfg.Port, port)
		}
		py, err := findPython(root, cfg.Python)
		if err != nil {
			logf("python: %v", err)
			py, err = offerPython(root)
			if err != nil {
				os.Exit(1)
			}
		}
		logf("python: %s %v", py.exe, py.args)
		slog, _ := os.Create(filepath.Join(data, "server.log"))
		args := append(append([]string{}, py.args...), "-m", "server.app", "--port", strconv.Itoa(port), "--exit-when-idle", strconv.Itoa(cfg.IdleExit))
		server = exec.Command(py.exe, args...)
		server.Dir = root
		if slog != nil {
			server.Stdout, server.Stderr = slog, slog
		}
		hideWindow(server)
		if err := server.Start(); err != nil {
			fatal("Couldn't start the game service:\n" + err.Error())
		}
		if !waitHealthy(port, 25*time.Second) {
			_ = server.Process.Kill()
			tail := readTail(filepath.Join(data, "server.log"), 1200)
			fatal("The game service didn't start.\n\n" + tail + "\n\nDetails are in data\\server.log")
		}
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/?launcher=1", port)
	var window *exec.Cmd

	// 2. browser window
	b := cfg.Browser
	if b == "" {
		b = findBrowser()
	}
	if b == "" {
		logf("no Edge/Chrome found, using the default browser")
		openDefault(url)
	} else {
		args := []string{
			"--app=" + url,
			"--user-data-dir=" + filepath.Join(data, "browser-profile"),
			"--no-first-run", "--no-default-browser-check", "--disable-sync",
			"--disable-features=Translate,TranslateUI,msEdgeSidebarV2,msUndersideButton,HardwareMediaKeyHandling",
			"--autoplay-policy=no-user-gesture-required",
			"--disable-pinch", "--overscroll-history-navigation=0",
			"--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
			"--hide-crash-restore-bubble", "--disable-session-crashed-bubble",
			"--ignore-gpu-blocklist", "--enable-gpu-rasterization",
			"--window-size=1600,900",
		}
		if cfg.Kiosk {
			args = append(args, "--kiosk")
		} else if !cfg.Windowed {
			args = append(args, "--start-fullscreen")
		}
		logf("browser: %s", b)
		cmd := exec.Command(b, args...)
		if err := cmd.Start(); err != nil {
			logf("browser start failed: %v", err)
			openDefault(url)
		} else {
			window = cmd
		}
	}

	// 3. the service stops on its own once the window has been closed for a while, or right away
	//    (exit code 3) when the player picks "Quit to desktop"; then the game window is closed too
	if server != nil {
		err := server.Wait()
		logf("service exited: %v", err)
		var ee *exec.ExitError
		if errors.As(err, &ee) && ee.ExitCode() == 3 && window != nil && window.Process != nil {
			time.Sleep(300 * time.Millisecond)
			_ = window.Process.Kill()
		}
	}
}

// ---------------- helpers ----------------

func gameRoot() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exe)
	for _, d := range []string{dir, filepath.Dir(dir), filepath.Join(dir, "Afterhours16")} {
		if st, err := os.Stat(filepath.Join(d, "server", "app.py")); err == nil && !st.IsDir() {
			return d, nil
		}
	}
	if wd, err := os.Getwd(); err == nil {
		if _, err := os.Stat(filepath.Join(wd, "server", "app.py")); err == nil {
			return wd, nil
		}
	}
	return "", errors.New("server/app.py not found")
}

func isOurs(port int) bool {
	c := http.Client{Timeout: 800 * time.Millisecond}
	r, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return false
	}
	defer r.Body.Close()
	var h map[string]any
	if json.NewDecoder(r.Body).Decode(&h) != nil {
		return false
	}
	return h["ready"] == true && (h["app"] == "afterhours16" || h["schema_version"] != nil)
}

func portFree(port int) bool {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

func freePort() int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 8766
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func waitHealthy(port int, d time.Duration) bool {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		if isOurs(port) {
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	return false
}

type python struct {
	exe  string
	args []string
}

// checkPython runs the interpreter and returns its absolute path if it's 3.10+ with sqlite3.
func checkPython(p python) (string, bool) {
	args := append(append([]string{}, p.args...), "-c", "import sys, sqlite3; print(sys.version_info[0]*100+sys.version_info[1]); print(sys.executable)")
	cmd := exec.Command(p.exe, args...)
	hideWindow(cmd)
	done := make(chan struct{})
	var out []byte
	var err error
	go func() { out, err = cmd.Output(); close(done) }()
	select {
	case <-done:
	case <-time.After(12 * time.Second):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return "", false
	}
	if err != nil {
		return "", false
	}
	lines := strings.Fields(strings.ReplaceAll(string(out), "\r", ""))
	if len(lines) < 2 {
		return "", false
	}
	v, _ := strconv.Atoi(lines[0])
	exe := strings.TrimSpace(strings.Join(lines[1:], " "))
	if v < 310 {
		logf("python %s too old (%d)", p.exe, v)
		return "", false
	}
	return exe, true
}

func findPython(root, prefer string) (python, error) {
	cands := []python{}
	if prefer != "" {
		cands = append(cands, python{exe: prefer})
	}
	// a Python bundled next to the game (python/python.exe) wins
	for _, rel := range []string{"python/python.exe", "python/bin/python3", "runtime/python.exe"} {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if _, err := os.Stat(p); err == nil {
			cands = append(cands, python{exe: p})
		}
	}
	cands = append(cands, platformPythons()...)
	for _, c := range cands {
		if exe, ok := checkPython(c); ok {
			if _, err := os.Stat(exe); err == nil {
				return python{exe: exe}, nil
			}
			return c, nil
		}
	}
	return python{}, errors.New("no Python 3.10+ found")
}

func readTail(path string, n int) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	if len(b) > n {
		b = b[len(b)-n:]
	}
	return strings.TrimSpace(string(b))
}
