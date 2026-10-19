//go:build !windows

package main

import "testing"

// RIMRIFT_BROWSER picks the browser; AFTERHOURS16_BROWSER (its name before the rename) still works, and loses to it
func TestBrowserEnv(t *testing.T) {
	t.Setenv("RIMRIFT_BROWSER", "")
	t.Setenv("AFTERHOURS16_BROWSER", "/opt/old/chrome")
	if got := findBrowser(); got != "/opt/old/chrome" {
		t.Errorf("AFTERHOURS16_BROWSER fallback: got %q", got)
	}
	t.Setenv("RIMRIFT_BROWSER", "/opt/new/chrome")
	if got := findBrowser(); got != "/opt/new/chrome" {
		t.Errorf("RIMRIFT_BROWSER: got %q", got)
	}
}
