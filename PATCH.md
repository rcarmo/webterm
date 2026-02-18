# Bug: Render loop dies silently on uncaught exception

## Summary

The `requestAnimationFrame` render loop in `Terminal.startRenderLoop()` has no error handling. If `renderer.render()`, `wasmTerm.getCursor()`, or any other expression in the loop body throws an exception, the `requestAnimationFrame(loop)` call at the end of the function is never reached. The loop stops permanently and the canvas is never repainted, even though the terminal remains fully functional underneath.

## Symptoms

- The terminal canvas freezes — no visual updates.
- Keyboard input continues to flow normally to the backend (the WebSocket and `write()` path are unaffected).
- A full page reload recovers immediately because a fresh `Terminal` instance starts a new render loop.
- The stall is intermittent and not correlated with any specific user interaction (no resize, no focus change required). It can happen at any time during normal terminal output.

## Root cause

`startRenderLoop()` currently looks like this:

```typescript
private startRenderLoop(): void {
    const loop = () => {
      if (!this.isDisposed && this.isOpen) {
        this.renderer!.render(
          this.snapshotBuffer,
          false,
          this.viewportY,
          this,
          this.scrollbarOpacity
        );

        const cursor = this.wasmTerm!.getCursor();
        if (cursor.y !== this.lastCursorY) {
          this.lastCursorY = cursor.y;
          this.cursorMoveEmitter.fire();
        }

        this.animationFrameId = requestAnimationFrame(loop);
      }
    };
    loop();
  }
```

The entire body — WASM calls, renderer canvas operations, cursor queries, event emitter dispatch — runs unprotected. Any exception (a WASM trap surfacing as a JS error, a canvas context issue, an unexpected `null` from `getLine()` / `getCursor()`, a listener throwing in `cursorMoveEmitter.fire()`) kills the loop with no log output and no recovery.

Because `write()` pushes data directly into the WASM buffer synchronously and does not depend on the render loop, all subsequent terminal state updates succeed silently — the user just never sees them.

## Proposed fix

Wrap the render loop body in `try/catch` so that `requestAnimationFrame(loop)` is always reached:

```typescript
private startRenderLoop(): void {
    const loop = () => {
      if (!this.isDisposed && this.isOpen) {
        try {
          this.renderer!.render(
            this.snapshotBuffer,
            false,
            this.viewportY,
            this,
            this.scrollbarOpacity
          );

          const cursor = this.wasmTerm!.getCursor();
          if (cursor.y !== this.lastCursorY) {
            this.lastCursorY = cursor.y;
            this.cursorMoveEmitter.fire();
          }
        } catch (e) {
          console.error('[ghostty-web] render loop error (recovering):', e);
        }

        this.animationFrameId = requestAnimationFrame(loop);
      }
    };
    loop();
  }
```

This keeps the loop alive across transient failures and logs the error so the underlying cause can be diagnosed. The next frame will call `render()` again normally — most renderer errors are frame-specific (e.g., a particular combination of dirty rows and viewport state) and resolve on the next pass.

## Impact

- **Without the fix:** a single exception permanently freezes the terminal display until the user reloads the page.
- **With the fix:** the frame is skipped, an error is logged to the console, and the next frame renders normally. There is no performance cost in the non-error path (try/catch in modern JS engines is zero-overhead when no exception is thrown).
