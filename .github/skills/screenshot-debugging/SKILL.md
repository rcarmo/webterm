# Screenshot Debugging Skill

## Purpose
Diagnose terminal screenshot corruption caused by incomplete escape-sequence handling.

## When to Use
- SVG screenshot shows stale or overlaid content after clear/redraw.
- Behavior differs between live terminal output and screenshot snapshots.
- Issues appear inside tmux/vim/less or other full-screen TUIs.

## Procedure
1. **Reproduce and capture raw output**
   - Capture PTY output around the failing action (e.g., `clear` inside tmux).
   - Ensure capture includes the full sequence before and after the command.

2. **Replay into the emulator**
   - Feed captured bytes into the same emulator used for screenshots (pyte + AltScreen).
   - Inspect the rendered buffer for stale cells or overlay.

3. **Scan for unhandled escape modes**
   - Look for private modes: `?47`, `?1047`, `?1048`, `?1049`.
   - Check erase semantics: `ED` (`J`), `EL` (`K`), `ECH` (`X`).
   - Verify C1 controls are normalized to 7-bit ESC equivalents.

4. **Fix emulator handling**
   - Update AltScreen to recognize any missing alternate buffer modes (e.g., `?47`).
   - Ensure mode toggles save/restore the main buffer and mark dirty lines.

5. **Add regression coverage**
   - Add a focused test that replays the sequence and asserts the buffer is cleared.
   - Include any new mode variants in existing parameterized tests.

6. **Verify**
   - Run `make check`.
   - Re-test the real scenario and confirm screenshots match the live terminal.

## Minimal Capture Snippet (PTY -> pyte)
```python
import os, pty, select, time, pyte
from webterm.alt_screen import AltScreen

def read_all(fd, timeout=0.5):
    out = b""
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if not r:
            continue
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        out += data
    return out

screen = AltScreen(80, 24)
stream = pyte.ByteStream(screen)
stream.feed(raw_bytes)
```

## Notes
- tmux often uses `DECSET ?47` (legacy alt buffer) instead of `?1049`.
- Always validate with real output captures, not just synthetic sequences.
