package main

// go test ./... (in launcher/): the health check that tells our game service from anything else on the port

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func healthOn(t *testing.T, body string) int {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(s.Close)
	return s.Listener.Addr().(*net.TCPAddr).Port
}

func TestIsOurs(t *testing.T) {
	for _, c := range []struct {
		body string
		want bool
	}{
		{`{"ready": true, "app": "rimrift"}`, true},                           // the service from 0.4.8.6 on
		{`{"ready": true, "app": "afterhours16"}`, true},                      // one from before the update, still running
		{`{"ready": true, "schema_version": 12, "version": "0.4.8.6"}`, true}, // any build of ours reports its schema
		{`{"ready": true, "app": "something-else"}`, false},
		{`{"ready": false, "app": "rimrift"}`, false},
		{`not json`, false},
	} {
		if got := isOurs(healthOn(t, c.body)); got != c.want {
			t.Errorf("isOurs(%s) = %v, want %v", c.body, got, c.want)
		}
	}
	if isOurs(freePort()) {
		t.Error("nothing listening: not ours")
	}
}
