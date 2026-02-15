package webterm

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type failingSSEWriter struct {
	header   http.Header
	writeErr error
}

func (w *failingSSEWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *failingSSEWriter) WriteHeader(int) {}

func (w *failingSSEWriter) Write([]byte) (int, error) {
	return 0, w.writeErr
}

func (w *failingSSEWriter) Flush() {}

func newServerForTests(t *testing.T, withLanding bool) (*LocalServer, *httptest.Server, *syncSessionMap) {
	t.Helper()
	config := Config{
		Apps: []App{{Name: "Shell", Slug: "shell", Command: "/bin/sh", Terminal: true}},
	}
	options := ServerOptions{}
	if withLanding {
		options.LandingApps = []App{{Name: "Shell", Slug: "shell", Command: "/bin/sh", Terminal: true}}
	}
	server := NewLocalServer(config, options)
	sessions := &syncSessionMap{m: map[string]*fakeSession{}}
	server.sessionManager.SetSessionFactory(func(app App, sessionID string) Session {
		s := newFakeSession()
		sessions.mu.Lock()
		sessions.m[sessionID] = s
		sessions.mu.Unlock()
		return s
	})
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)
	return server, httpServer, sessions
}

type syncSessionMap struct {
	mu sync.Mutex
	m  map[string]*fakeSession
}

func TestHealthAndTilesEndpoints(t *testing.T) {
	_, httpServer, _ := newServerForTests(t, true)
	resp, err := http.Get(httpServer.URL + "/health")
	if err != nil {
		t.Fatalf("health request error = %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if !strings.Contains(string(body), "Local server is running") {
		t.Fatalf("unexpected health response: %q", string(body))
	}

	resp, err = http.Get(httpServer.URL + "/tiles")
	if err != nil {
		t.Fatalf("tiles request error = %v", err)
	}
	var tiles []map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&tiles); err != nil {
		t.Fatalf("decode tiles: %v", err)
	}
	_ = resp.Body.Close()
	if len(tiles) != 1 || tiles[0]["slug"] != "shell" {
		t.Fatalf("unexpected tiles: %+v", tiles)
	}
}

func TestWebSocketPingResizeAndStdin(t *testing.T) {
	server, httpServer, sessions := newServerForTests(t, false)
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws/shell"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("ws dial error = %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON([]any{"ping", "ok"}); err != nil {
		t.Fatalf("write ping: %v", err)
	}
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read pong: %v", err)
	}
	var pong []any
	if err := json.Unmarshal(payload, &pong); err != nil {
		t.Fatalf("decode pong: %v", err)
	}
	if pong[0] != "pong" || pong[1] != "ok" {
		t.Fatalf("unexpected pong payload: %v", pong)
	}

	if err := conn.WriteJSON([]any{"resize", map[string]any{"width": 100, "height": 40}}); err != nil {
		t.Fatalf("write resize: %v", err)
	}
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) && server.sessionManager.GetSessionByRouteKey("shell") == nil {
		time.Sleep(10 * time.Millisecond)
	}
	if session := server.sessionManager.GetSessionByRouteKey("shell"); session == nil {
		t.Fatalf("expected session to be created on resize")
	}

	if err := conn.WriteJSON([]any{"stdin", "ls\n"}); err != nil {
		t.Fatalf("write stdin: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	found := false
	sessions.mu.Lock()
	for _, session := range sessions.m {
		session.mu.Lock()
		if len(session.received) > 0 && string(session.received[0]) == "ls\n" {
			found = true
		}
		session.mu.Unlock()
	}
	sessions.mu.Unlock()
	if !found {
		t.Fatalf("expected stdin to reach session")
	}
}

func TestWebSocketReplayOnReconnect(t *testing.T) {
	_, httpServer, sessions := newServerForTests(t, false)
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws/shell"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("first dial error = %v", err)
	}
	if err := conn.WriteJSON([]any{"resize", map[string]any{"width": 80, "height": 24}}); err != nil {
		t.Fatalf("resize write: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	_ = conn.Close()

	sessions.mu.Lock()
	for _, session := range sessions.m {
		session.mu.Lock()
		session.replay = []byte("abc\x1b[?1;10;0cdef")
		session.mu.Unlock()
	}
	sessions.mu.Unlock()

	conn2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("second dial error = %v", err)
	}
	defer conn2.Close()
	_ = conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	msgType, replay, err := conn2.ReadMessage()
	if err != nil {
		t.Fatalf("read replay: %v", err)
	}
	if msgType != websocket.BinaryMessage {
		t.Fatalf("expected binary replay message, got %d", msgType)
	}
	if string(replay) != "abcdef" {
		t.Fatalf("unexpected replay payload: %q", string(replay))
	}
}

func TestScreenshotAndETag(t *testing.T) {
	server, httpServer, _ := newServerForTests(t, false)
	if _, err := server.sessionManager.NewSession("shell", "sid", "shell", 80, 24); err != nil {
		t.Fatalf("NewSession error = %v", err)
	}
	resp, err := http.Get(httpServer.URL + "/screenshot.svg?route_key=shell")
	if err != nil {
		t.Fatalf("screenshot request error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	etag := resp.Header.Get("ETag")
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if etag == "" || !strings.Contains(string(body), "<svg") {
		t.Fatalf("expected svg body and etag")
	}

	req, _ := http.NewRequest(http.MethodGet, httpServer.URL+"/screenshot.svg?route_key=shell", nil)
	req.Header.Set("If-None-Match", etag)
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("etag request error = %v", err)
	}
	_ = resp2.Body.Close()
	if resp2.StatusCode != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", resp2.StatusCode)
	}
}

func TestScreenshotCreatesSessionFromRequestedRoute(t *testing.T) {
	_, httpServer, _ := newServerForTests(t, false)
	resp, err := http.Get(httpServer.URL + "/screenshot.svg?route_key=shell")
	if err != nil {
		t.Fatalf("screenshot request error = %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%q", resp.StatusCode, string(body))
	}
	if !strings.Contains(string(body), "<svg") {
		t.Fatalf("expected svg body")
	}
}

func TestRootTerminalPageAndSparklineValidation(t *testing.T) {
	_, httpServer, _ := newServerForTests(t, false)
	resp, err := http.Get(httpServer.URL + "/?route_key=shell")
	if err != nil {
		t.Fatalf("root request error = %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	text := string(body)
	if !strings.Contains(text, "/static/js/terminal.js") || !strings.Contains(text, "data-session-websocket-url") {
		t.Fatalf("unexpected root page: %q", text)
	}

	respStatic, err := http.Get(httpServer.URL + "/static/manifest.json")
	if err != nil {
		t.Fatalf("static request error = %v", err)
	}
	_ = respStatic.Body.Close()
	if respStatic.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for static manifest, got %d", respStatic.StatusCode)
	}

	resp2, err := http.Get(httpServer.URL + "/cpu-sparkline.svg")
	if err != nil {
		t.Fatalf("sparkline request error = %v", err)
	}
	_ = resp2.Body.Close()
	if resp2.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing container, got %d", resp2.StatusCode)
	}
}

func TestMarkRouteActivityBroadcastsWithoutBlockingGlobalLock(t *testing.T) {
	server := NewLocalServer(Config{}, ServerOptions{})
	ready := make(chan string, 1)
	full := make(chan string, 1)
	full <- "occupied"

	server.mu.Lock()
	server.sseSubscribers[ready] = struct{}{}
	server.sseSubscribers[full] = struct{}{}
	server.routeLastSSE["route-a"] = time.Now().Add(-time.Second)
	server.mu.Unlock()

	start := time.Now()
	server.markRouteActivity("route-a")
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("markRouteActivity took too long: %s", elapsed)
	}

	select {
	case got := <-ready:
		if got != "route-a" {
			t.Fatalf("unexpected broadcast payload: %q", got)
		}
	default:
		t.Fatalf("expected route activity broadcast")
	}
}

func TestGzipMiddlewareSkipsEventsPath(t *testing.T) {
	server := NewLocalServer(Config{}, ServerOptions{})
	handler := server.gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if got := rr.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected no gzip encoding for SSE path, got %q", got)
	}
	if rr.Body.String() != "ok" {
		t.Fatalf("unexpected body: %q", rr.Body.String())
	}
}

func TestHandleEventsReturnsOnWriteError(t *testing.T) {
	server := NewLocalServer(Config{}, ServerOptions{})
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	writer := &failingSSEWriter{writeErr: errors.New("broken pipe")}
	done := make(chan struct{})
	go func() {
		server.handleEvents(writer, req)
		close(done)
	}()

	deadline := time.Now().Add(250 * time.Millisecond)
	for {
		server.mu.RLock()
		count := len(server.sseSubscribers)
		server.mu.RUnlock()
		if count == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected SSE subscriber to be registered")
		}
		time.Sleep(5 * time.Millisecond)
	}

	server.markRouteActivity("route-a")

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("handleEvents did not exit after write error")
	}

	server.mu.RLock()
	count := len(server.sseSubscribers)
	server.mu.RUnlock()
	if count != 0 {
		t.Fatalf("expected SSE subscriber cleanup after write error, got %d", count)
	}
}
