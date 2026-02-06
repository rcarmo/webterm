# pyte Patches

webterm uses [pyte](https://github.com/selectel/pyte) (v0.8.2) as a headless terminal emulator to capture screen state for SVG screenshots. pyte doesn't implement several standard escape sequences, so `AltScreen` in `alt_screen.py` monkeypatches pyte at import time and provides additional methods.

## Patch 1: CSI S / CSI T — Scroll Up & Down (SU/SD)

**Status:** Primary fix for ghost content in screenshots.

### Problem

When `TERM=xterm-256color`, tmux uses `CSI n S` (Scroll Up) to shift content upward — for example, when Ink-based CLI apps (GitHub Copilot CLI) issue `/clear`. pyte does not implement CSI S or CSI T, silently ignoring the sequences. Old content remains in the screen buffer, appearing as ghost lines in SVG screenshots.

Real terminals (Ghostty, iTerm2, etc.) handle CSI S/T correctly, so the issue only manifests in pyte-rendered screenshots.

### Root cause

pyte's CSI dispatch table has no entry for `"S"` (SU — Scroll Up) or `"T"` (SD — Scroll Down). The `xterm-256color` terminfo entry includes `indn=\E[%p1%dS` and `rin=\E[%p1%dT`, so tmux sends these when the outer terminal advertises support. With simpler TERM values (e.g. `xterm-color`), tmux falls back to DECSTBM + index, which pyte handles correctly.

### Fix

At module load time, `alt_screen.py` patches pyte's dispatch tables and event set:

```python
pyte.ByteStream.csi["S"] = "scroll_up"
pyte.ByteStream.csi["T"] = "scroll_down"
pyte.Stream.csi["S"] = "scroll_up"
pyte.Stream.csi["T"] = "scroll_down"
pyte.Stream.events = pyte.Stream.events | frozenset(["scroll_up", "scroll_down"])
```

`AltScreen` implements `scroll_up(count)` and `scroll_down(count)`, which shift buffer lines within the current scroll region (respecting DECSTBM margins) and blank the vacated rows.

### Verification

```python
from webterm.alt_screen import AltScreen
import pyte

screen = AltScreen(80, 24)
stream = pyte.ByteStream(screen)

# Fill screen with content
for i in range(24):
    stream.feed(f"Line {i}\r\n".encode())

# CSI 6 S — scroll up 6 lines (top 6 lines lost, bottom 6 blanked)
stream.feed(b"\x1b[6S")

# Lines 6-23 shifted to rows 0-17, rows 18-23 are blank
assert screen.display[0].strip() == "Line 6"
assert screen.display[17].strip() == "Line 23"
assert screen.display[18].strip() == ""
```

## Patch 2: Alternate Screen Buffer (DECSET/DECRST 1049)

**Status:** Core feature, implemented since v1.0.

### Problem

pyte doesn't implement private mode 1049 (or 47/1047/1048) for alternate screen buffers. Full-screen programs (tmux, vim, less) switch to an alternate buffer on entry and restore the main buffer on exit. Without this, exiting vim inside tmux would leave vim's screen content overlaid on the shell prompt in screenshots.

### Fix

`AltScreen` overrides `set_mode()` and `reset_mode()` to intercept private modes 47/1047/1048/1049. On entry, it deep-copies the current buffer and cursor; on exit, it restores them. The saved buffer is invalidated on resize.

## Patch 3: Ink Partial Clear Expansion (best-effort)

**Status:** Secondary defense; largely superseded by Patch 1.

### Problem

Ink-based CLI frameworks erase their previous output using repeated `EL2 + CUU1` (erase line + cursor up) pairs. When `/clear` resets Ink's internal line counter, the next frame erases fewer lines than needed. In a real terminal the old content has scrolled into the scrollback buffer, but pyte's fixed-size screen retains it.

### Fix

`AltScreen.expand_clear_sequences(data)` pre-processes incoming bytes before feeding to pyte. It detects runs of 3+ `EL2+CUU1` pairs that don't reach row 0 and extends them to cover all lines above the cursor.

Both `TerminalSession._update_screen()` and `DockerExecSession._update_screen()` call this method after C1 normalization and before `stream.feed()`.

### Why this is safe

- Only triggers on runs of **3 or more** `EL2+CUU1` pairs (normal editing uses 1–2).
- Only adds erase operations for lines that would already be empty in a real terminal.
- Short runs (< 3 pairs) and runs that already reach row 0 are left unchanged.

## Related

- `docs/tmux-da-response-filtering.md` — filtering Device Attributes responses from tmux.
- `docs/ROADMAP.md` — future Go reimplementation would replace pyte entirely.
- `WEBTERM_SCREENSHOT_FORCE_REDRAW` env var — sends SIGWINCH to force app redraw before screenshots.
