# Architecture

## Overview

`webterm` is a Go HTTP/WebSocket server that hosts one or more terminal sessions and renders screenshot/telemetry surfaces for a dashboard UI.

```
Browser (terminal.js + ghostty-vt.wasm)
        │
        │ WS / HTTP / SSE
        ▼
webterm/server.go (LocalServer)
        │
        ├── session_manager.go      (route/app/session registry)
        ├── terminal_session.go     (PTY-backed local sessions)
        ├── docker_exec_session.go  (Docker exec-backed sessions)
        ├── docker_watcher.go       (container add/remove discovery)
        ├── docker_stats.go         (CPU sampling + sparkline data)
        ├── svg_exporter.go         (terminal snapshot -> SVG)
        └── png_exporter.go         (terminal snapshot -> PNG via coverage blending)
```

## Packages

- `cmd/webterm`: CLI entrypoint
- `webterm`: server/runtime/domain logic
- `internal/terminalstate`: Go terminal emulator wrapper (`go-te`) used for screenshots
- `webterm/coverage_table.go`: coverage map for approximate PNG rendering

## Runtime data flow

1. Browser connects to `/ws/{route_key}`.
2. `SessionManager` resolves or creates a session.
3. Session reads PTY output and updates:
   - live WS stream (`stdout`)
   - replay buffer (reconnect support)
   - terminal-state tracker (`go-te`) for screenshots
4. Dashboard pulls `/screenshot.png` (default) or `/screenshot.svg` when `WEBTERM_SCREENSHOT_MODE=svg`, and listens on `/events` for activity.

## Static assets

Assets live in `webterm/static`:

- `js/terminal.ts` source
- `js/terminal.js` bundled client
- `js/ghostty-vt.wasm`
- `monospace.css`, icons, `manifest.json`

The server resolves static files from:

1. `WEBTERM_STATIC_PATH` (if set)
2. local repository-relative fallbacks rooted at `webterm/static`
3. embedded assets bundled into the Go binary

## Docker integration

- **Compose mode** loads services from a compose manifest (see `prod.compose.yaml`) and creates tiles for services carrying `webterm-command`.
- **Watch mode** subscribes to Docker events and adds/removes tiles at runtime.
- `webterm-theme` controls tile theme; default theme applies if unset. Available themes: `tango`, `xterm`, `monokai`, `monokai-pro`, `ristretto`, `dark`, `light`, `dracula`, `catppuccin`, `nord`, `gruvbox`, `solarized`, `tokyo`, `miasma`, `github`, `gotham`.

## Reliability notes

- WebSocket writes are serialized through a sender queue.
- Session-manager maps are lock-protected and race-tested.
- Replay buffers are bounded to avoid unbounded memory growth.
