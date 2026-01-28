# Feature: WASM terminal should respect theme palette for ANSI colors

## Summary

The WASM terminal parser/renderer has a hardcoded color palette (Tomorrow Night) that doesn't respect the theme passed to the Terminal constructor. When an application sends ANSI color codes, they get resolved to Tomorrow Night RGB values regardless of the configured theme.

## Current Behavior

When creating a terminal with a custom theme:
```typescript
const terminal = new Terminal({
  theme: {
    background: '#002b36',  // solarized
    foreground: '#839496',
    green: '#859900',
    // ...
  }
});
```

The WASM parser still outputs Tomorrow Night colors (e.g., `#b5bd68` for green instead of `#859900`), because the internal WASM module resolves ANSI codes to its built-in palette.

The renderer uses the theme for canvas background/cursor/selection, but text colors come pre-resolved from WASM.

## Expected Behavior

ANSI color codes should resolve to the user's configured theme palette, not the hardcoded Tomorrow Night palette.

## Workaround

We currently patch `renderer.renderCell` to intercept and remap colors from Tomorrow Night → custom theme using a color map. This works but requires knowing the exact Tomorrow Night palette values and adds overhead to every cell render.

## Proposed Solutions

1. **Pass theme palette to WASM** - Allow the palette to be configured when initializing the WASM module
2. **Return color indices** - Have WASM return ANSI color indices (0-15) rather than resolved RGB, letting the renderer resolve them
3. **Document the internal palette** - At minimum, document that Tomorrow Night is the hardcoded palette so consumers can build their own remapping

Option 2 would be cleanest as it separates parsing from rendering.

## Environment

- ghostty-web: 0.4.0
- Browser: All

---
*Filed from textual-webterm project where we encountered this while implementing theme support*
