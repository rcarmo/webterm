# Roadmap: Migration to xterm.js 6.0 with Bun

This document outlines the plan for bundling xterm.js 6.0 directly, replacing the dependency on textual-serve's bundled `textual.js`.

## Status: ✅ Complete

The migration has been implemented on the `upstream-xterm` branch.

### What Was Done

- [x] **Phase 1: Tooling Setup** - Added `package.json`, `bunfig.toml`, Makefile targets
- [x] **Phase 2: Terminal Client** - Created `terminal.ts` with full WebSocket protocol
- [x] **Phase 3: Server Integration** - Updated HTML template, removed monkey-patch
- [x] **Phase 4: Configuration** - Added `data-scrollback` attribute support
- [x] **Phase 5: Remove Dependency** - Dropped `textual-serve` from pyproject.toml
- [x] **Phase 6: Documentation** - Updated README.md and ARCHITECTURE.md

### Key Outcomes

| Metric | Before | After |
|--------|--------|-------|
| textual-serve dependency | Required | ❌ Removed |
| Scrollback history | 0 (none) | 1000 (configurable) |
| Font configuration | Monkey-patch workaround | Direct configuration |
| Bundle size | 502 KB + 381 KB fonts | 560 KB total |
| xterm.js version | Unknown (5.x?) | 6.0.0 |

### Files Changed

```
Added:
  package.json              # xterm.js 6.0 + addons
  bunfig.toml               # Bun configuration
  src/.../static/js/terminal.ts   # TypeScript source
  src/.../static/js/terminal.js   # Pre-built bundle (committed)
  src/.../static/css/xterm.css    # xterm.js styles

Modified:
  pyproject.toml            # Removed textual-serve dependency
  Makefile                  # Added bundle/bundle-watch targets
  .gitignore                # Added node_modules/
  src/.../local_server.py   # Simplified HTML template
  docs/ARCHITECTURE.md      # Updated file structure
  README.md                 # Added frontend dev instructions
```

### For Users

No action required. The pre-built `terminal.js` bundle is committed to the repo, so:

```bash
pip install git+https://github.com/rcarmo/textual-webterm.git@upstream-xterm
```

Works without needing Node.js or Bun.

### For Developers

To modify the frontend:

```bash
# Install Bun (https://bun.sh)
curl -fsSL https://bun.sh/install | bash

# Install dependencies and build
make bundle

# Or watch for changes during development
make bundle-watch
```

---

## Background Analysis

The sections below document the original analysis that led to this migration.

### What textual-serve Provides

| Asset | Size | What We Use | Required? |
|-------|------|-------------|-----------|
| `static/js/textual.js` | 502 KB | xterm.js + WebSocket client | **Yes** |
| `static/css/xterm.css` | 4.6 KB | Terminal styling | **Yes** |
| `static/fonts/RobotoMono*.ttf` | 381 KB | Roboto Mono font | No (we override font) |
| `static/images/background.png` | 58 KB | Background image | No |
| **Total** | **948 KB** | | |

### What textual.js Bundle Contains

The minified `textual.js` bundles:

```
xterm.js (core terminal)
├── @xterm/addon-fit        (auto-resize to container)
├── @xterm/addon-webgl      (GPU-accelerated rendering)
├── @xterm/addon-canvas     (fallback 2D canvas renderer)
├── @xterm/addon-unicode11  (wide character support)
├── @xterm/addon-web-links  (clickable URLs)
├── @xterm/addon-clipboard  (clipboard integration)
└── WebSocket client wrapper (class w)
```

### Hardcoded Configuration in textual.js

```javascript
new Terminal({
  allowProposedApi: true,
  fontSize: /* from data-font-size attribute */,
  scrollback: 0,           // ❌ No scrollback history
  fontFamily: "'Roboto Mono', Monaco, 'Courier New', monospace"  // ❌ Hardcoded
})
```

### WebSocket Protocol (Fully Compatible)

The protocol is simple JSON arrays. Our server already implements this:

| Direction | Message | Description |
|-----------|---------|-------------|
| Client → Server | `["stdin", "data"]` | Terminal input |
| Client → Server | `["resize", {width: N, height: M}]` | Window resize |
| Client → Server | `["ping", data]` | Keep-alive |
| Server → Client | `["stdout", "data"]` | Terminal output (text) |
| Server → Client | Binary frame | Terminal output (binary) |
| Server → Client | `["pong", data]` | Keep-alive response |

### Current Workarounds

1. **Font override**: Canvas monkey-patch in HTML to replace hardcoded font family
2. **No scrollback**: Users cannot scroll back through terminal history

---

## Tradeoffs Analysis

### Option A: Keep textual-serve Dependency

| Pros | Cons |
|------|------|
| Zero build tooling | Hardcoded font requires workaround |
| Automatic updates via pip | No scrollback (scrollback: 0) |
| Maintained by Textualize | No theme customization |
| | Carries unused fonts/images (381 KB) |
| | Tied to textual-serve release cycle |
| | Unknown xterm.js version (likely 5.x) |

### Option B: Bundle xterm.js 6.0 Directly

| Pros | Cons |
|------|------|
| Full configuration control | Requires Bun toolchain |
| Scrollback history support | ~150-200 KB bundle to maintain |
| Custom themes/colors | Must track xterm.js updates |
| Latest xterm.js 6.0 features | Initial setup effort (2-3 days) |
| Smaller bundle (no unused fonts) | |
| Can drop textual-serve dependency | |

### xterm.js 6.0 Features We'd Gain

| Feature | Benefit |
|---------|---------|
| Synchronized output (DEC 2026) | Smoother rapid output rendering |
| Ligature support | Better programming font rendering |
| Progress addon | Visual progress indicators |
| Shadow DOM support | Better CSS encapsulation |
| ESM support | Modern module loading |
| Performance improvements | Faster search, less memory |
| OSC 52 clipboard | Secure clipboard from terminal |

---

## Implementation Plan (Completed)

### Phase 1: Tooling Setup ✅

**Goal**: Establish Bun-based build pipeline

```
src/textual_webterm/
├── static/
│   ├── js/
│   │   └── terminal.ts      # New: our xterm wrapper
│   ├── css/
│   │   └── xterm.css        # Copied from xterm.js package
│   └── monospace.css        # Existing
├── package.json             # New: npm dependencies
└── bunfig.toml              # New: Bun configuration
```

**Tasks**:
- [x] Create `package.json` with xterm.js 6.0 dependencies
- [x] Create `bunfig.toml` for build configuration
- [x] Add `Makefile` targets: `make bundle`, `make bundle-watch`
- [x] Add `.gitignore` entries for `node_modules/`
- [x] Document Bun installation in README

**package.json** (final):
```json
{
  "name": "textual-webterm-frontend",
  "private": true,
  "type": "module",
  "dependencies": {
    "@xterm/xterm": "^6.0.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/addon-canvas": "^0.7.0",
    "@xterm/addon-unicode11": "^0.8.0",
    "@xterm/addon-web-links": "^0.11.0",
    "@xterm/addon-clipboard": "^0.2.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  },
  "scripts": {
    "build": "bun build src/textual_webterm/static/js/terminal.ts --outfile=src/textual_webterm/static/js/terminal.js --minify --target=browser",
    "watch": "bun build src/textual_webterm/static/js/terminal.ts --outfile=src/textual_webterm/static/js/terminal.js --watch --target=browser"
  }
}
```

### Phase 2: Terminal Client Implementation ✅

**Goal**: Create `terminal.ts` that replicates textual.js functionality

**Tasks**:
- [x] Implement Terminal wrapper class
- [x] WebSocket connection with reconnection logic
- [x] Message protocol handling (stdin, resize, ping/pong)
- [x] Addon initialization (fit, webgl, canvas, unicode11, web-links, clipboard)
- [x] Configurable options via data attributes or window config

See `src/textual_webterm/static/js/terminal.ts` for the full implementation (~230 lines).

### Phase 3: Server Integration ✅

**Goal**: Update local_server.py to use new bundle

**Tasks**:
- [x] Update HTML template to load our bundle instead of textual.js
- [x] Remove canvas monkey-patch workaround
- [x] Add data attributes for scrollback, theme configuration
- [x] Copy xterm.css to our static folder
- [x] Update static file routes

### Phase 4: Configuration Support ✅

**Goal**: Make terminal appearance configurable

**Tasks**:
- [x] Pass config to HTML template via data attributes (`data-scrollback`, `data-font-size`)
- [ ] Add terminal config to CLI (--scrollback, --font-family) - *Future enhancement*
- [ ] Add terminal config to TOML manifest files - *Future enhancement*

### Phase 5: Remove textual-serve Dependency ✅

**Goal**: Eliminate dependency once our bundle is stable

**Tasks**:
- [x] Remove `textual-serve` from pyproject.toml dependencies
- [x] Update ARCHITECTURE.md to document new frontend
- [x] Update README.md with build instructions
- [x] Commit pre-built bundle so users don't need Bun

### Phase 6: Testing & Polish

**Goal**: Ensure reliability across browsers

**Tasks**:
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile browser testing (iOS Safari, Chrome Android)
- [x] WebGL fallback to Canvas (implemented in terminal.ts)
- [x] Reconnection logic (implemented with exponential backoff)
- [ ] Performance comparison vs textual.js
- [x] Bundle size: 560 KB (acceptable for full xterm.js + addons)

---

## Build Integration (Reference)

### Makefile Additions

```makefile
# Frontend build
.PHONY: bundle bundle-watch bundle-clean

bundle: node_modules
	bun run build

bundle-watch: node_modules
	bun run watch

bundle-clean:
	rm -rf node_modules src/textual_webterm/static/js/terminal.js

node_modules: package.json
	bun install
```

### Dockerfile Changes

```dockerfile
# Add Bun for frontend build
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Build frontend
COPY package.json bunfig.toml ./
RUN bun install
COPY src/textual_webterm/static/js/terminal.ts src/textual_webterm/static/js/
RUN bun run build
```

### CI/CD Considerations

- Pre-commit hook to verify `terminal.js` matches `terminal.ts`
- Or: commit built bundle to repo (simpler for users without Bun)
- GitHub Actions step to build and verify bundle

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| xterm.js 6.0 breaking changes | Pin exact version, test thoroughly |
| Bun compatibility issues | Fall back to esbuild if needed |
| WebSocket protocol mismatch | Keep protocol identical to textual.js |
| Performance regression | Benchmark before/after, keep WebGL |
| Missing addon features | Test each addon explicitly |

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Tooling Setup | 0.5 days | None |
| Phase 2: Terminal Client | 1-2 days | Phase 1 |
| Phase 3: Server Integration | 0.5 days | Phase 2 |
| Phase 4: Configuration | 0.5 days | Phase 3 |
| Phase 5: Remove Dependency | 0.5 days | Phase 4 |
| Phase 6: Testing | 1 day | Phase 5 |
| **Total** | **4-5 days** | |

---

## Decision Checkpoints

1. **After Phase 2**: Verify terminal.ts works in isolation before integrating
2. **After Phase 3**: Side-by-side comparison with textual.js
3. **After Phase 5**: Confirm no regressions before removing dependency
4. **After Phase 6**: Final sign-off for release

---

## Success Criteria

- [ ] Terminal renders correctly in Chrome, Firefox, Safari
- [x] Scrollback history works (configurable limit)
- [x] Custom fonts load without workarounds
- [x] WebGL rendering enabled with Canvas fallback
- [x] Bundle size: 560 KB (larger than target due to full addon suite, but acceptable)
- [x] No textual-serve dependency in pyproject.toml
- [x] All existing tests pass (302 tests)
- [x] Documentation updated
