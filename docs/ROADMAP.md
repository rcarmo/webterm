# Roadmap: Migration to xterm.js 6.0 with Bun

This document outlines the plan for bundling xterm.js 6.0 directly, replacing the dependency on textual-serve's bundled `textual.js`.

## Current State Analysis

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

## Implementation Plan

### Phase 1: Tooling Setup

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
- [ ] Create `package.json` with xterm.js 6.0 dependencies
- [ ] Create `bunfig.toml` for build configuration
- [ ] Add `Makefile` targets: `make bundle`, `make bundle-watch`
- [ ] Add `.gitignore` entries for `node_modules/`
- [ ] Document Bun installation in README

**package.json** (draft):
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
    "typescript": "^5.3.0"
  },
  "scripts": {
    "build": "bun build src/textual_webterm/static/js/terminal.ts --outdir=src/textual_webterm/static/js --minify --target=browser",
    "watch": "bun build src/textual_webterm/static/js/terminal.ts --outdir=src/textual_webterm/static/js --watch --target=browser"
  }
}
```

### Phase 2: Terminal Client Implementation

**Goal**: Create `terminal.ts` that replicates textual.js functionality

**Tasks**:
- [ ] Implement Terminal wrapper class
- [ ] WebSocket connection with reconnection logic
- [ ] Message protocol handling (stdin, resize, ping/pong)
- [ ] Addon initialization (fit, webgl, canvas, unicode11, web-links, clipboard)
- [ ] Configurable options via data attributes or window config

**terminal.ts** (draft structure):
```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';

interface TerminalConfig {
  fontFamily?: string;
  fontSize?: number;
  scrollback?: number;
  theme?: object;
}

class WebTerminal {
  private terminal: Terminal;
  private socket: WebSocket | null = null;
  private fitAddon: FitAddon;
  
  constructor(container: HTMLElement, wsUrl: string, config: TerminalConfig = {}) {
    this.terminal = new Terminal({
      allowProposedApi: true,
      fontFamily: config.fontFamily ?? 'ui-monospace, "Fira Code", monospace',
      fontSize: config.fontSize ?? 16,
      scrollback: config.scrollback ?? 1000,
      theme: config.theme,
    });
    
    // Initialize addons
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebglAddon());
    this.terminal.loadAddon(new CanvasAddon());
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.loadAddon(new ClipboardAddon());
    
    this.terminal.open(container);
    this.connect(wsUrl);
  }
  
  // ... WebSocket handling, resize, etc.
}

// Auto-initialize on page load
window.addEventListener('load', () => {
  document.querySelectorAll('.textual-terminal').forEach(el => {
    const wsUrl = el.dataset.sessionWebsocketUrl;
    const config = {
      fontSize: parseInt(el.dataset.fontSize ?? '16'),
      scrollback: parseInt(el.dataset.scrollback ?? '1000'),
      fontFamily: el.dataset.fontFamily,
    };
    new WebTerminal(el as HTMLElement, wsUrl, config);
  });
});
```

### Phase 3: Server Integration

**Goal**: Update local_server.py to use new bundle

**Tasks**:
- [ ] Update HTML template to load our bundle instead of textual.js
- [ ] Remove canvas monkey-patch workaround
- [ ] Add data attributes for scrollback, theme configuration
- [ ] Copy xterm.css to our static folder (or bundle inline)
- [ ] Update static file routes

**HTML template changes**:
```html
<!-- Before -->
<script src="/static/js/textual.js"></script>

<!-- After -->
<link rel="stylesheet" href="/static-webterm/xterm.css">
<script src="/static-webterm/terminal.js"></script>
```

### Phase 4: Configuration Support

**Goal**: Make terminal appearance configurable

**Tasks**:
- [ ] Add terminal config to CLI (--scrollback, --font-family)
- [ ] Add terminal config to TOML manifest files
- [ ] Pass config to HTML template via data attributes
- [ ] Document configuration options

**Config schema addition**:
```toml
[terminal]
scrollback = 5000
font_family = "ui-monospace, 'Fira Code', monospace"
font_size = 16
theme = "dark"  # or custom theme object
```

### Phase 5: Remove textual-serve Dependency

**Goal**: Eliminate dependency once our bundle is stable

**Tasks**:
- [ ] Remove `textual-serve` from pyproject.toml dependencies
- [ ] Update ARCHITECTURE.md to document new frontend
- [ ] Update README.md with build instructions
- [ ] Ensure Docker build includes Bun for bundling
- [ ] Add CI step to verify bundle is up-to-date

**pyproject.toml change**:
```toml
# Remove this line:
textual-serve = "^1.1.0"
```

### Phase 6: Testing & Polish

**Goal**: Ensure reliability across browsers

**Tasks**:
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile browser testing (iOS Safari, Chrome Android)
- [ ] WebGL fallback to Canvas testing
- [ ] Reconnection logic testing
- [ ] Performance comparison vs textual.js
- [ ] Bundle size verification (target: <200 KB minified)

---

## Build Integration

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
- [ ] Scrollback history works (configurable limit)
- [ ] Custom fonts load without workarounds
- [ ] WebGL rendering enabled with Canvas fallback
- [ ] Bundle size ≤ 200 KB (minified + gzipped)
- [ ] No textual-serve dependency in pyproject.toml
- [ ] All existing tests pass
- [ ] Documentation updated
