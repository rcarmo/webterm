/**
 * ghostty-web terminal client for webterm.
 *
 * Implements the WebSocket protocol compatible with local_server.py:
 * - Client → Server: ["stdin", data], ["resize", {width, height}], ["ping", data]
 * - Server → Client: ["stdout", data], ["pong", data], or binary frames
 */

import { Terminal, FitAddon, Ghostty, type ITerminalOptions, type ITheme } from "ghostty-web";

/** Maximum queued messages before oldest are dropped */
const MAX_MESSAGE_QUEUE_SIZE = 1000;
/** How often to run periodic resource cleanup (ms) */
const RESOURCE_CLEANUP_INTERVAL_MS = 30_000;
/** Maximum bytes to buffer while the tab is hidden (256 KB) */
const MAX_HIDDEN_BUFFER_BYTES = 256 * 1024;

/** Batch stdin writes to reduce per-keystroke overhead and avoid WS/PTY backlogs */
const STDIN_BATCH_DELAY_MS = 10;
/** Flush stdin batch when it gets large (e.g. paste) */
const STDIN_BATCH_MAX_CHARS = 8192;

const BELL_EMOJI = "🔔";

/** Shared Ghostty WASM instance (loaded once, reused across all terminals) */
let sharedGhostty: Ghostty | null = null;

/** Load or reuse the shared Ghostty WASM instance */
async function getSharedGhostty(): Promise<Ghostty> {
  if (!sharedGhostty) {
    const wasmPath = getWasmPath();
    console.log("[webterm] Loading shared Ghostty WASM:", wasmPath);
    sharedGhostty = await Ghostty.load(wasmPath);
  }
  return sharedGhostty;
}

/** Shared TextDecoder (stateless for UTF-8, safe to share) */
const sharedTextDecoder = new TextDecoder();

/** Default font stack - prefers system monospace, falls back through programming fonts */
const DEFAULT_FONT_FAMILY =
  'ui-monospace, "SFMono-Regular", "FiraCode Nerd Font", "FiraMono Nerd Font", ' +
  '"Fira Code", "Roboto Mono", Menlo, Monaco, Consolas, "Liberation Mono", ' +
  '"DejaVu Sans Mono", "Courier New", monospace';

/** Predefined terminal themes */
const THEMES: Record<string, ITheme> = {
  // Tango - default theme (GNOME/xterm.js colors)
  tango: {
    background: "#000000",
    foreground: "#d3d7cf",
    cursor: "#d3d7cf",
    cursorAccent: "#000000",
    selectionBackground: "#d3d7cf",
    selectionForeground: "#000000",
    black: "#2e3436",
    red: "#cc0000",
    green: "#4e9a06",
    yellow: "#c4a000",
    blue: "#3465a4",
    magenta: "#75507b",
    cyan: "#06989a",
    white: "#d3d7cf",
    brightBlack: "#555753",
    brightRed: "#ef2929",
    brightGreen: "#8ae234",
    brightYellow: "#fce94f",
    brightBlue: "#729fcf",
    brightMagenta: "#ad7fa8",
    brightCyan: "#34e2e2",
    brightWhite: "#eeeeec",
  },
  // Classic xterm (VGA colors, pure black background)
  xterm: {
    background: "#000000",
    foreground: "#e5e5e5",
    cursor: "#e5e5e5",
    cursorAccent: "#000000",
    selectionBackground: "#e5e5e5",
    selectionForeground: "#000000",
    black: "#000000",
    red: "#cd0000",
    green: "#00cd00",
    yellow: "#cdcd00",
    blue: "#0000cd",
    magenta: "#cd00cd",
    cyan: "#00cdcd",
    white: "#e5e5e5",
    brightBlack: "#4d4d4d",
    brightRed: "#ff0000",
    brightGreen: "#00ff00",
    brightYellow: "#ffff00",
    brightBlue: "#0000ff",
    brightMagenta: "#ff00ff",
    brightCyan: "#00ffff",
    brightWhite: "#ffffff",
  },
  // Monokai Classic
  monokai: {
    background: "#272822",
    foreground: "#fdfff1",
    cursor: "#fdfff1",
    cursorAccent: "#272822",
    selectionBackground: "#fdfff1",
    selectionForeground: "#272822",
    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#e6db74",
    blue: "#fd971f",
    magenta: "#ae81ff",
    cyan: "#66d9ef",
    white: "#fdfff1",
    brightBlack: "#6e7066",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#e6db74",
    brightBlue: "#fd971f",
    brightMagenta: "#ae81ff",
    brightCyan: "#66d9ef",
    brightWhite: "#fdfff1",
  },
  // Monokai Pro
  "monokai-pro": {
    background: "#2d2a2e",
    foreground: "#fcfcfa",
    cursor: "#fcfcfa",
    cursorAccent: "#2d2a2e",
    selectionBackground: "#fcfcfa",
    selectionForeground: "#2d2a2e",
    black: "#403e41",
    red: "#ff6188",
    green: "#a9dc76",
    yellow: "#ffd866",
    blue: "#fc9867",
    magenta: "#ab9df2",
    cyan: "#78dce8",
    white: "#fcfcfa",
    brightBlack: "#727072",
    brightRed: "#ff6188",
    brightGreen: "#a9dc76",
    brightYellow: "#ffd866",
    brightBlue: "#fc9867",
    brightMagenta: "#ab9df2",
    brightCyan: "#78dce8",
    brightWhite: "#fcfcfa",
  },
  // Monokai Pro Ristretto (warmer variant)
  ristretto: {
    background: "#2d2525",
    foreground: "#fff1f3",
    cursor: "#fff1f3",
    cursorAccent: "#2d2525",
    selectionBackground: "#fff1f3",
    selectionForeground: "#2d2525",
    black: "#2c2525",
    red: "#fd6883",
    green: "#adda78",
    yellow: "#f9cc6c",
    blue: "#f38d70",
    magenta: "#a8a9eb",
    cyan: "#85dacc",
    white: "#f9f8f5",
    brightBlack: "#655761",
    brightRed: "#fd6883",
    brightGreen: "#adda78",
    brightYellow: "#f9cc6c",
    brightBlue: "#f38d70",
    brightMagenta: "#a8a9eb",
    brightCyan: "#85dacc",
    brightWhite: "#f9f8f5",
  },
  // Dark themes
  dark: {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#aeafad",
    cursorAccent: "#1e1e1e",
    selectionBackground: "#d4d4d4",
    selectionForeground: "#1e1e1e",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#383a42",
    cursor: "#526eff",
    cursorAccent: "#ffffff",
    selectionBackground: "#383a42",
    selectionForeground: "#ffffff",
    black: "#000000",
    red: "#e45649",
    green: "#50a14f",
    yellow: "#c18401",
    blue: "#4078f2",
    magenta: "#a626a4",
    cyan: "#0184bc",
    white: "#a0a1a7",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#d19a66",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  dracula: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#f8f8f2",
    selectionForeground: "#282a36",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  catppuccin: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#cdd6f4",
    selectionForeground: "#1e1e2e",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  nord: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#d8dee9",
    selectionForeground: "#2e3440",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
  gruvbox: {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#ebdbb2",
    selectionForeground: "#282828",
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
  solarized: {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#839496",
    cursorAccent: "#002b36",
    selectionBackground: "#839496",
    selectionForeground: "#002b36",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  tokyo: {
    background: "#1a1b26",
    foreground: "#a9b1d6",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#a9b1d6",
    selectionForeground: "#1a1b26",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
  // Miasma - earthy warm tones
  miasma: {
    background: "#222222",
    foreground: "#c2c2b0",
    cursor: "#c2c2b0",
    cursorAccent: "#222222",
    selectionBackground: "#c2c2b0",
    selectionForeground: "#222222",
    black: "#000000",
    red: "#685742",
    green: "#5f875f",
    yellow: "#b36d43",
    blue: "#78824b",
    magenta: "#bb7744",
    cyan: "#c9a554",
    white: "#d7c483",
    brightBlack: "#666666",
    brightRed: "#685742",
    brightGreen: "#5f875f",
    brightYellow: "#b36d43",
    brightBlue: "#78824b",
    brightMagenta: "#bb7744",
    brightCyan: "#c9a554",
    brightWhite: "#d7c483",
  },
  // GitHub Dark Dimmed
  github: {
    background: "#1c2128",
    foreground: "#adbac7",
    cursor: "#adbac7",
    cursorAccent: "#1c2128",
    selectionBackground: "#adbac7",
    selectionForeground: "#1c2128",
    black: "#545d68",
    red: "#f47067",
    green: "#57ab5a",
    yellow: "#c69026",
    blue: "#539bf5",
    magenta: "#b083f0",
    cyan: "#39c5cf",
    white: "#909dab",
    brightBlack: "#636e7b",
    brightRed: "#ff938a",
    brightGreen: "#6bc46d",
    brightYellow: "#daaa3f",
    brightBlue: "#6cb6ff",
    brightMagenta: "#dcbdfb",
    brightCyan: "#56d4dd",
    brightWhite: "#cdd9e5",
  },
  // Gotham - dark blue-cyan
  gotham: {
    background: "#0c1014",
    foreground: "#99d1ce",
    cursor: "#99d1ce",
    cursorAccent: "#0c1014",
    selectionBackground: "#99d1ce",
    selectionForeground: "#0c1014",
    black: "#0c1014",
    red: "#c23127",
    green: "#2aa889",
    yellow: "#edb443",
    blue: "#195466",
    magenta: "#4e5166",
    cyan: "#33859e",
    white: "#99d1ce",
    brightBlack: "#0c1014",
    brightRed: "#c23127",
    brightGreen: "#2aa889",
    brightYellow: "#edb443",
    brightBlue: "#195466",
    brightMagenta: "#4e5166",
    brightCyan: "#33859e",
    brightWhite: "#99d1ce",
  },
};


/** Configuration options passed via data attributes or window config */
interface TerminalConfig {
  fontFamily?: string;
  fontSize?: number;
  scrollback?: number;
  theme?: ITheme;
}

/** Parse configuration from element data attributes */
function parseConfig(element: HTMLElement): TerminalConfig {
  const config: TerminalConfig = {};

  if (element.dataset.fontFamily) {
    let fontFamily = element.dataset.fontFamily;
    // Resolve CSS variables - Canvas 2D context doesn't understand var(--name) syntax
    if (fontFamily.startsWith("var(")) {
      const varMatch = fontFamily.match(/var\(([^)]+)\)/);
      if (varMatch) {
        const varName = varMatch[1].trim();
        const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (resolved) {
          fontFamily = resolved;
        } else {
          console.warn(`[webterm] CSS variable ${varName} not found, using default font`);
          fontFamily = DEFAULT_FONT_FAMILY;
        }
      }
    }
    config.fontFamily = fontFamily;
  }
  if (element.dataset.fontSize) {
    config.fontSize = parseInt(element.dataset.fontSize, 10);
  }
  if (element.dataset.scrollback) {
    config.scrollback = parseInt(element.dataset.scrollback, 10);
  }
  if (element.dataset.theme) {
    const themeName = element.dataset.theme.toLowerCase();
    if (themeName in THEMES) {
      config.theme = THEMES[themeName];
    } else {
      // Try parsing as JSON for custom themes
      try {
        config.theme = JSON.parse(element.dataset.theme) as ITheme;
      } catch (e) {
        console.warn(`[webterm] Unknown theme "${element.dataset.theme}"`, e);
      }
    }
  }

  return config;
}

/** Get WASM path based on script location */
function getWasmPath(): string {
  // Try to find the script element and derive path from it
  const scripts = document.querySelectorAll('script[src*="terminal.js"]');
  if (scripts.length > 0) {
    const scriptSrc = (scripts[0] as HTMLScriptElement).src;
    const basePath = scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1);
    return basePath + 'ghostty-vt.wasm';
  }
  // Fallback to common static paths
  return '/static/js/ghostty-vt.wasm';
}

/**
 * WebTerminal - wraps ghostty-web with WebSocket communication.
 */
/** Detect if running on a mobile/touch device */
function isMobileDevice(): boolean {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) ||
    ("ontouchstart" in window && navigator.maxTouchPoints > 0)
  );
}

const SHIFT_KEY_MAP: Record<string, string> = {
  "`": "~",
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
  "-": "_",
  "=": "+",
  "[": "{",
  "]": "}",
  "\\": "|",
  ";": ":",
  "'": "\"",
  ",": "<",
  ".": ">",
  "/": "?",
};

const CTRL_KEY_MAP: Record<string, string> = {
  "2": "@",
  "3": "[",
  "4": "\\",
  "5": "]",
  "6": "^",
  "7": "_",
  "8": "?",
};

const FN_NORMAL_KEYS = [
  "\x1bOP",
  "\x1bOQ",
  "\x1bOR",
  "\x1bOS",
  "\x1b[15~",
  "\x1b[17~",
  "\x1b[18~",
  "\x1b[19~",
  "\x1b[20~",
  "\x1b[21~",
];

const FN_SHIFT_KEYS = [
  "\x1b[23~",
  "\x1b[24~",
  "\x1b[25~",
  "\x1b[26~",
  "\x1b[28~",
  "\x1b[29~",
  "\x1b[31~",
  "\x1b[32~",
  "\x1b[33~",
  "\x1b[34~",
];

function applyShiftModifier(key: string): string {
  if (key.length !== 1) {
    return key;
  }
  if (key >= "a" && key <= "z") {
    return key.toUpperCase();
  }
  return SHIFT_KEY_MAP[key] ?? key;
}

function applyCtrlModifier(key: string): string {
  if (key.length !== 1) {
    return key;
  }
  const mapped = CTRL_KEY_MAP[key] ?? key;
  if (mapped === "?") {
    return "\x7f";
  }
  const code = mapped.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) {
    return String.fromCharCode(code - 64);
  }
  return key;
}

function applyFnModifier(key: string, useShift: boolean): string | null {
  if (key.length !== 1) {
    return null;
  }
  const index = "1234567890".indexOf(key);
  if (index < 0) {
    return null;
  }
  return useShift ? FN_SHIFT_KEYS[index] : FN_NORMAL_KEYS[index];
}

function applyAltModifier(text: string): string {
  if (!text || text.startsWith("\x1b")) {
    return text;
  }
  return `\x1b${text}`;
}

function applyModifiers(
  text: string,
  useShift: boolean,
  useCtrl: boolean,
  useAlt: boolean,
  useFn: boolean
): string {
  if (text.length !== 1) {
    return text;
  }
  if (useFn) {
    const fnApplied = applyFnModifier(text, useShift);
    if (fnApplied) {
      return useAlt ? applyAltModifier(fnApplied) : fnApplied;
    }
  }
  if (useCtrl) {
    const ctrlApplied = applyCtrlModifier(text);
    if (ctrlApplied !== text) {
      return useAlt ? applyAltModifier(ctrlApplied) : ctrlApplied;
    }
  }
  if (useShift) {
    const shifted = applyShiftModifier(text);
    return useAlt ? applyAltModifier(shifted) : shifted;
  }
  return useAlt ? applyAltModifier(text) : text;
}

class WebTerminal {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private socket: WebSocket | null = null;
  private socketGeneration = 0;
  private element: HTMLElement;
  private wsUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatIntervalMs = 15000;
  private stallTimeoutMs = 45000;
  private heartbeatTimer: number | undefined;
  private lastMessageAt = 0;
  private lastPongAt = 0;
  private messageQueue: [string, unknown][] = [];

  // Stdin batching (coalesces key repeats into fewer WS frames)
  private pendingStdin = "";
  private pendingStdinTimer: number | undefined;

  private lastValidSize: { cols: number; rows: number } | null = null;
  private mobileInput: HTMLTextAreaElement | null = null;
  private mobileKeybar: HTMLElement | null = null;
  private ctrlActive = false;
  private altActive = false;
  private shiftActive = false;
  private fnActive = false;
  private pendingCtrl = false;
  private pendingAlt = false;
  private pendingShift = false;
  private pendingFn = false;
  private fontFamily: string;
  private fontSize: number;
  private cleanupTimer: number | undefined;
  private resizeObserver: ResizeObserver | null = null;
  private mobileKeybarStyle: HTMLStyleElement | null = null;
  private boundHandlers: { target: EventTarget; type: string; handler: EventListener; options?: boolean | AddEventListenerOptions }[] = [];
  private isTabHidden = false;
  private hiddenBuffer: Uint8Array[] = [];
  private hiddenBufferBytes = 0;
  private baseTitle: string;
  private bellActive = false;
  private routeKey: string;
  private static sharedTextEncoder = new TextEncoder();

  private constructor(
    container: HTMLElement,
    wsUrl: string,
    terminal: Terminal,
    fitAddon: FitAddon,
    fontFamily: string,
    fontSize: number,
    routeKey: string,
    baseTitle: string
  ) {
    this.element = container;
    this.wsUrl = wsUrl;
    this.terminal = terminal;
    this.fitAddon = fitAddon;
    this.fontFamily = fontFamily;
    this.fontSize = fontSize;
    this.routeKey = routeKey;
    this.baseTitle = baseTitle;
  }

  /** Register an event listener that will be removed on dispose */
  private addTrackedListener(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, handler, options);
    this.boundHandlers.push({ target, type, handler, options });
  }

  private bellStorageKey(): string | null {
    if (!this.routeKey) {
      return null;
    }
    return `webterm:bell:${this.routeKey}`;
  }

  private setBellActive(): void {
    if (!this.bellActive) {
      this.bellActive = true;
      document.title = `${BELL_EMOJI} ${this.baseTitle}`;
    }
    const key = this.bellStorageKey();
    if (key) {
      localStorage.setItem(key, String(Date.now()));
    }
  }

  private clearBellState(): void {
    const key = this.bellStorageKey();
    if (key) {
      localStorage.removeItem(key);
    }
    if (!this.bellActive) {
      return;
    }
    this.bellActive = false;
    document.title = this.baseTitle;
  }

  /** Create and initialize a WebTerminal instance */
  static async create(
    container: HTMLElement,
    wsUrl: string,
    config: TerminalConfig
  ): Promise<WebTerminal> {
    const ghostty = await getSharedGhostty();
    
    // Build terminal options
    const themeToUse = config.theme ?? THEMES.tango;
    const fontFamily = config.fontFamily?.trim() || DEFAULT_FONT_FAMILY;
    const fontSize = config.fontSize ?? 16;

    const defaultScrollback = isMobileDevice() ? 200 : 1000;
    const options: ITerminalOptions = {
      fontFamily,
      fontSize,
      scrollback: config.scrollback ?? defaultScrollback,
      cursorBlink: true,
      cursorStyle: "block",
      theme: themeToUse,
      ghostty,
    };

    const terminal = new Terminal(options);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Open terminal (initializes rendering - WASM already loaded)
    terminal.open(container);

    const routeKey = container.dataset.sessionRouteKey
      ?? new URLSearchParams(window.location.search).get("route_key")
      ?? "";
    const rawTitle = container.dataset.sessionName?.trim() || document.title;
    const baseTitle = rawTitle.startsWith(`${BELL_EMOJI} `)
      ? rawTitle.slice(BELL_EMOJI.length + 1)
      : rawTitle;
    const instance = new WebTerminal(
      container,
      wsUrl,
      terminal,
      fitAddon,
      fontFamily,
      fontSize,
      routeKey,
      baseTitle
    );
    instance.initialize();
    return instance;
  }

  /** Initialize event handlers and connect */
  private initialize(): void {
    // Wait for fonts to load before fitting to ensure correct measurements
    //
    // FONT INITIALIZATION (ghostty-web):
    // The font stack is set in two places:
    // 1. At Terminal construction time via ITerminalOptions.fontFamily
    // 2. After web fonts load via terminal.loadFonts()
    //    - Re-measures font metrics and triggers a full re-render
    this.waitForFonts().then(() => {
      if (typeof (this.terminal as unknown as { loadFonts?: () => void }).loadFonts === "function") {
        (this.terminal as unknown as { loadFonts: () => void }).loadFonts();
      }
      this.fit();
    });
    
    // Setup resize observer (we use our own fit method, not FitAddon's)
    this.setupResizeObserver();

    // Handle window resize (some browsers don't trigger ResizeObserver on window resize)
    this.addTrackedListener(window, "resize", () => {
      this.fit();
    });

    // Handle terminal input
    this.terminal.onData((data) => {
      this.clearBellState();
      this.sendStdin(data);
    });

    this.terminal.onBell(() => {
      this.setBellActive();
    });

    // Handle resize
    this.terminal.onResize((size) => {
      if (this.isValidSize(size.cols, size.rows)) {
        this.lastValidSize = { cols: size.cols, rows: size.rows };
        this.send(["resize", { width: size.cols, height: size.rows }]);
      }
    });

    // Setup mobile keyboard support
    this.setupMobileKeyboard();
    this.setupTouchSelection();

    // Setup mobile extended keybar (only on mobile devices)
    if (isMobileDevice()) {
      this.setupMobileKeybar();
    }

    this.isTabHidden = document.hidden;

    // Start periodic resource cleanup
    this.startResourceCleanup();

    // Connect WebSocket
    this.connect();
    if (document.hasFocus()) {
      this.clearBellState();
    }

    const restoreFocus = () => {
      this.clearBellState();
      if (isMobileDevice()) {
        this.focusMobileInput();
      } else {
        this.terminal.focus();
      }
    };

    // Focus terminal when returning to the tab
    this.addTrackedListener(document, "visibilitychange", () => {
      if (document.hidden) {
        this.isTabHidden = true;
        this.stopHeartbeatWatchdog();
      } else {
        this.isTabHidden = false;
        this.refreshConnection();
        restoreFocus();
      }
    });

    // Restore focus when browser window regains focus
    this.addTrackedListener(window, "focus", () => {
      restoreFocus();
    });

    // Safari can restore tabs via bfcache without a focus event.
    this.addTrackedListener(window, "pageshow", () => {
      restoreFocus();
    });
  }

  /** Setup mobile keyboard input via hidden textarea */
  private setupMobileKeyboard(): void {
    // Create hidden textarea for mobile keyboard input
    const textarea = document.createElement("textarea");
    textarea.setAttribute("autocapitalize", "off");
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
    textarea.setAttribute("spellcheck", "false");
    textarea.setAttribute("inputmode", "text");
    textarea.setAttribute("enterkeyhint", "send");
    // iOS requires the element to be "visible" and interactive for keyboard
    // Use opacity near-zero but not zero, and keep it in the visible area
    textarea.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      opacity: 0.01;
      z-index: 1;
      color: transparent;
      background: transparent;
      border: none;
      outline: none;
      resize: none;
      font-size: 16px;
      caret-color: transparent;
      pointer-events: none;
    `;
    // Font size 16px prevents iOS auto-zoom on focus
    
    this.element.style.position = "relative";
    this.element.appendChild(textarea);
    this.mobileInput = textarea;

    const applyMobileModifiers = (text: string): string =>
      applyModifiers(
        text,
        this.shiftActive || this.pendingShift,
        this.ctrlActive || this.pendingCtrl,
        this.altActive || this.pendingAlt,
        this.fnActive || this.pendingFn
      );

    const handleMobileInput = (text: string, e?: Event) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!text) {
        return;
      }
      this.sendStdin(applyMobileModifiers(text));
      textarea.value = "";
      this.deactivateModifiers();
      this.pendingCtrl = false;
      this.pendingAlt = false;
      this.pendingShift = false;
      this.pendingFn = false;
    };

    // Handle special keys via beforeinput to intercept before browser modifies textarea
    textarea.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertText" && e.data) {
        handleMobileInput(e.data, e);
        return;
      }

      let seq: string | null = null;
      switch (e.inputType) {
        case "insertLineBreak": // Enter key
          seq = "\r";
          break;
        case "deleteContentBackward": // Backspace
          seq = "\x7f";
          break;
        case "deleteContentForward": // Delete
          seq = "\x1b[3~";
          break;
      }
      if (seq) {
        handleMobileInput(seq, e);
      }
    });

    // Handle input from mobile keyboard (regular text only, special keys handled above)
    textarea.addEventListener("input", () => {
      handleMobileInput(textarea.value);
    });

    // Handle special navigation keys via keydown (not covered by beforeinput)
    // Check both physical keyboard modifiers (e.ctrlKey/e.shiftKey) and mobile keybar flags
    textarea.addEventListener("keydown", (e) => {
      const isCtrl = e.ctrlKey || this.ctrlActive;
      const isShift = e.shiftKey || this.shiftActive;
      const isAlt = e.altKey || this.altActive;
      const isFn = this.fnActive;

      // Handle Ctrl+key combinations (these don't fire input events)
      if (isCtrl && e.key.length === 1 && !e.altKey && !e.metaKey) {
        const ctrlApplied = applyCtrlModifier(e.key);
        if (ctrlApplied !== e.key) {
          e.preventDefault();
          e.stopPropagation();
          const toSend = isAlt ? applyAltModifier(ctrlApplied) : ctrlApplied;
          this.sendStdin(toSend); // Ctrl+A=0x01, Ctrl+C=0x03, etc.
          this.deactivateModifiers(); // Clear modifiers after physical Ctrl+key
          return;
        }
      }
      if (isFn && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        const fnApplied = applyFnModifier(e.key, isShift);
        if (fnApplied) {
          e.preventDefault();
          e.stopPropagation();
          this.sendStdin(fnApplied);
          this.deactivateModifiers();
          return;
        }
      }

      let seq: string | null = null;
      switch (e.key) {
        case "Escape":
          seq = "\x1b";
          break;
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowRight":
        case "ArrowLeft": {
          const dir = e.key === "ArrowUp" ? "A" : e.key === "ArrowDown" ? "B" : e.key === "ArrowRight" ? "C" : "D";
          if (isCtrl && isShift) {
            seq = `\x1b[1;6${dir}`;
          } else if (isCtrl) {
            seq = `\x1b[1;5${dir}`;
          } else if (isShift) {
            seq = `\x1b[1;2${dir}`;
          } else {
            seq = `\x1b[${dir}`;
          }
          break;
        }
        case "Tab":
          if (isShift) {
            seq = "\x1b[Z"; // Back-tab
          } else {
            seq = "\t";
          }
          e.preventDefault();
          break;
      }
      if (seq) {
        e.preventDefault();
        e.stopPropagation();
        this.sendStdin(isAlt ? applyAltModifier(seq) : seq);
        // Always clear modifiers after any key
        this.deactivateModifiers();
      }
    });

    // Apply keybar modifiers to physical keyboard input even when the textarea isn't focused.
    this.addTrackedListener(
      document,
      "keydown",
      ((event: KeyboardEvent) => {
      if (!this.ctrlActive && !this.shiftActive && !this.altActive && !this.fnActive) {
        return;
      }
      if (event.target === this.mobileInput) {
        return;
      }

      const useCtrl = this.ctrlActive;
      const useShift = this.shiftActive;
      const useAlt = this.altActive;
      const useFn = this.fnActive;
      let handled = false;

      if (event.key.length === 1 && !event.altKey && !event.metaKey) {
        const toSend = applyModifiers(event.key, useShift, useCtrl, useAlt, useFn);
        event.preventDefault();
        event.stopPropagation();
        this.sendStdin(toSend);
        handled = true;
      } else {
        let seq: string | null = null;
        switch (event.key) {
          case "Escape":
            seq = "\x1b";
            break;
          case "ArrowUp":
          case "ArrowDown":
          case "ArrowRight":
          case "ArrowLeft": {
            const dir =
              event.key === "ArrowUp"
                ? "A"
                : event.key === "ArrowDown"
                  ? "B"
                  : event.key === "ArrowRight"
                    ? "C"
                    : "D";
            if (useCtrl && useShift) {
              seq = `\x1b[1;6${dir}`;
            } else if (useCtrl) {
              seq = `\x1b[1;5${dir}`;
            } else if (useShift) {
              seq = `\x1b[1;2${dir}`;
            } else {
              seq = `\x1b[${dir}`;
            }
            break;
          }
          case "Tab":
            if (useShift) {
              seq = "\x1b[Z";
            } else {
              seq = "\t";
            }
            break;
        }

        if (seq) {
          event.preventDefault();
          event.stopPropagation();
          this.sendStdin(useAlt ? applyAltModifier(seq) : seq);
          handled = true;
        }
      }

      if (handled) {
        this.deactivateModifiers();
      }
      }) as EventListener,
      { capture: true }
    );

    // Focus textarea on touch/click to show mobile keyboard
    // iOS requires focus() to be called synchronously within the gesture
    // Don't call terminal.focus() as it steals focus and dismisses keyboard
    const focusTextarea = () => {
      this.mobileInput?.focus();
    };

    this.addTrackedListener(this.element, "touchend", focusTextarea, { passive: true });
    this.addTrackedListener(this.element, "click", focusTextarea);
  }

  private setupTouchSelection(): void {
    const canvas = this.element.querySelector("canvas");
    if (!canvas) return;

    const dispatchMouse = (type: "mousedown" | "mousemove" | "mouseup", touch: Touch) => {
      const rect = canvas.getBoundingClientRect();
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
      });
      canvas.dispatchEvent(event);
    };

    this.addTrackedListener(
      canvas,
      "touchstart",
      ((e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        dispatchMouse("mousedown", e.touches[0]);
        e.preventDefault();
      }) as EventListener,
      { passive: false }
    );

    this.addTrackedListener(
      canvas,
      "touchmove",
      ((e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        dispatchMouse("mousemove", e.touches[0]);
        e.preventDefault();
      }) as EventListener,
      { passive: false }
    );

    this.addTrackedListener(
      canvas,
      "touchend",
      ((e: TouchEvent) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        dispatchMouse("mouseup", touch);
        e.preventDefault();
      }) as EventListener,
      { passive: false }
    );
  }

  /** Setup draggable mobile extended keyboard bar */
  private setupMobileKeybar(): void {
    const keybar = document.createElement("div");
    keybar.className = "mobile-keybar";
    keybar.innerHTML = `
      <button class="keybar-drag" title="Drag to move">⋮⋮</button>
      <button data-key="\\x1b" title="Escape">Esc</button>
      <button data-modifier="ctrl" title="Ctrl modifier">Ctrl</button>
      <button data-modifier="alt" title="Alt modifier">Alt</button>
      <button data-modifier="fn" title="Fn modifier">Fn</button>
      <button data-key="\\x09" title="Tab">Tab</button>
      <button data-modifier="shift" title="Shift modifier">⇧</button>
      <button data-key="\\x1b[A" title="Up">↑</button>
      <button data-key="\\x1b[B" title="Down">↓</button>
      <button data-key="\\x1b[D" title="Left">←</button>
      <button data-key="\\x1b[C" title="Right">→</button>
      <button data-key="\\x0d" title="Return" class="keybar-return">⏎</button>
    `;

    // Inject styles
    const style = document.createElement("style");
    style.textContent = `
      .mobile-keybar {
        position: fixed;
        bottom: 80px;
        right: 0;
        display: grid;
        grid-template-columns: repeat(6, auto);
        gap: 4px;
        padding: 6px;
        background: rgba(40, 40, 40, 0.95);
        border-radius: 8px 0 0 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        z-index: 10000;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      .mobile-keybar button {
        min-width: 36px;
        height: 32px;
        padding: 0 8px;
        border: 1px solid #555;
        border-radius: 4px;
        background: #333;
        color: #eee;
        font-size: 13px;
        font-family: system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }
      .mobile-keybar button:active {
        background: #555;
      }
      .mobile-keybar button.active {
        background: #0066cc;
        border-color: #0088ff;
      }
      .mobile-keybar .keybar-drag {
        min-width: 24px;
        padding: 0 4px;
        cursor: grab;
        color: #888;
      }
      .mobile-keybar .keybar-drag:active {
        cursor: grabbing;
      }
      .mobile-keybar .keybar-return {
        grid-column: 6;
        grid-row: 2;
      }
    `;
    document.head.appendChild(style);
    this.mobileKeybarStyle = style;
    document.body.appendChild(keybar);
    this.mobileKeybar = keybar;

    // Handle key button presses
    keybar.querySelectorAll("button[data-key]").forEach((btn) => {
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        let key = (btn as HTMLElement).dataset.key || "";
        // Unescape the key sequences
        key = key.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        key = key.replace(/\\x1b/g, "\x1b");

        const useShift = this.shiftActive;
        const useCtrl = this.ctrlActive;
        const useAlt = this.altActive;
        const useFn = this.fnActive;
        const useShiftForFn = useShift || this.pendingShift;
        // Handle Shift+Tab -> Back-Tab (CSI Z)
        if (useShift && key === "\x09") {
          key = "\x1b[Z";
        }
        // Handle Ctrl+Shift+Arrow keys (CSI 1;6 X)
        else if (useCtrl && useShift && key.startsWith("\x1b[") && key.length === 3) {
          const dir = key[2];
          key = `\x1b[1;6${dir}`;
        }
        // Handle Shift+Arrow keys (CSI 1;2 X)
        else if (useShift && key.startsWith("\x1b[") && key.length === 3) {
          const dir = key[2]; // A, B, C, or D
          key = `\x1b[1;2${dir}`;
        }
        // Handle Ctrl+Arrow keys (CSI 1;5 X)
        else if (useCtrl && key.startsWith("\x1b[") && key.length === 3) {
          const dir = key[2];
          key = `\x1b[1;5${dir}`;
        }
        if (useFn && key.length === 1) {
          const fnApplied = applyFnModifier(key, useShiftForFn);
          if (fnApplied) {
            key = fnApplied;
          }
        }
        if (key.length === 1) {
          key = applyModifiers(key, useShift, useCtrl, useAlt, useFn);
        } else if (useAlt) {
          key = applyAltModifier(key);
        }

        this.sendStdin(key);
        this.deactivateModifiers();
      });
    });

    // Handle modifier toggles
    keybar.querySelectorAll("button[data-modifier]").forEach((btn) => {
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const modifier = (btn as HTMLElement).dataset.modifier;
        if (modifier === "ctrl") {
          this.ctrlActive = !this.ctrlActive;
          this.pendingCtrl = this.ctrlActive;
          btn.classList.toggle("active", this.ctrlActive);
        } else if (modifier === "alt") {
          this.altActive = !this.altActive;
          this.pendingAlt = this.altActive;
          btn.classList.toggle("active", this.altActive);
        } else if (modifier === "shift") {
          this.shiftActive = !this.shiftActive;
          this.pendingShift = this.shiftActive;
          btn.classList.toggle("active", this.shiftActive);
        } else if (modifier === "fn") {
          this.fnActive = !this.fnActive;
          this.pendingFn = this.fnActive;
          btn.classList.toggle("active", this.fnActive);
        }
        this.focusMobileInput();
      });
    });

    // Setup drag functionality
    this.setupKeybarDrag(keybar);
  }

  /** Make the keybar draggable */
  private setupKeybarDrag(keybar: HTMLElement): void {
    const dragHandle = keybar.querySelector(".keybar-drag") as HTMLElement;
    if (!dragHandle) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;

      const rect = keybar.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;

      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = startX - touch.clientX;
      const deltaY = startY - touch.clientY;

      const newRight = Math.max(0, Math.min(window.innerWidth - 100, startRight + deltaX));
      const newBottom = Math.max(0, Math.min(window.innerHeight - 50, startBottom + deltaY));

      keybar.style.right = `${newRight}px`;
      keybar.style.bottom = `${newBottom}px`;

      e.preventDefault();
    };

    const onTouchEnd = () => {
      isDragging = false;
    };

    this.addTrackedListener(dragHandle, "touchstart", onTouchStart as EventListener, { passive: false });
    this.addTrackedListener(document, "touchmove", onTouchMove as EventListener, { passive: false });
    this.addTrackedListener(document, "touchend", onTouchEnd as EventListener);
  }

  /** Deactivate all modifiers */
  private deactivateModifiers(): void {
    this.ctrlActive = false;
    this.altActive = false;
    this.shiftActive = false;
    this.fnActive = false;
    this.pendingCtrl = false;
    this.pendingAlt = false;
    this.pendingShift = false;
    this.pendingFn = false;
    this.mobileKeybar?.querySelectorAll("button[data-modifier]").forEach((btn) => {
      btn.classList.remove("active");
    });
  }

  /** Focus the mobile input to show keyboard */
  private focusMobileInput(): void {
    // For programmatic focus (not from user gesture), this may not show keyboard on iOS
    this.mobileInput?.focus();
  }

  /** Wait for fonts to be loaded */
  private async waitForFonts(): Promise<void> {
    if (!("fonts" in document)) {
      return;
    }
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font loading errors
    }
  }

  /** 
   * Custom fit method that doesn't reserve space for scrollbar.
   * The FitAddon subtracts 15px for a scrollbar, but ghostty-web
   * uses canvas rendering without a visible scrollbar.
   */
  private fit(): void {
    // Try to get metrics from renderer (private but accessible at runtime)
    const termAny = this.terminal as unknown as Record<string, unknown>;
    const renderer = termAny.renderer as { getMetrics?: () => { width: number; height: number } } | undefined;
    
    let cellWidth: number;
    let cellHeight: number;
    
    if (renderer?.getMetrics) {
      const metrics = renderer.getMetrics();
      if (metrics && metrics.width > 0 && metrics.height > 0) {
        cellWidth = metrics.width;
        cellHeight = metrics.height;
      } else {
        // Fall back to measuring
        const dims = this.measureCellSize();
        if (!dims) {
          this.fitAddon.fit();
          return;
        }
        cellWidth = dims.width;
        cellHeight = dims.height;
      }
    } else {
      // Fall back to measuring
      const dims = this.measureCellSize();
      if (!dims) {
        this.fitAddon.fit();
        return;
      }
      cellWidth = dims.width;
      cellHeight = dims.height;
    }

    const style = window.getComputedStyle(this.element);
    const paddingTop = parseInt(style.paddingTop) || 0;
    const paddingBottom = parseInt(style.paddingBottom) || 0;
    const paddingLeft = parseInt(style.paddingLeft) || 0;
    const paddingRight = parseInt(style.paddingRight) || 0;

    const availableWidth = this.element.clientWidth - paddingLeft - paddingRight;
    const availableHeight = this.element.clientHeight - paddingTop - paddingBottom;

    if (availableWidth <= 0 || availableHeight <= 0) {
      return;
    }

    const cols = Math.max(2, Math.floor(availableWidth / cellWidth));
    const rows = Math.max(1, Math.floor(availableHeight / cellHeight));

    if (cols !== this.terminal.cols || rows !== this.terminal.rows) {
      this.terminal.resize(cols, rows);
    }
  }

  /** Measure cell size by creating a test character */
  private measureCellSize(): { width: number; height: number } | null {
    const testElement = document.createElement('span');
    testElement.style.visibility = 'hidden';
    testElement.style.position = 'absolute';
    testElement.style.fontFamily = this.fontFamily;
    testElement.style.fontSize = `${this.fontSize}px`;
    testElement.style.lineHeight = 'normal';
    testElement.textContent = 'W';
    
    document.body.appendChild(testElement);
    const width = testElement.offsetWidth;
    const height = testElement.offsetHeight;
    document.body.removeChild(testElement);
    
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  }

  /** Setup resize observer for container */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      // Debounce resize events
      if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = window.setTimeout(() => {
        this.fit();
      }, 100);
    });
    this.resizeObserver.observe(this.element);
  }

  private resizeDebounceTimer: number | undefined;

  /** Validate terminal dimensions */
  private isValidSize(cols: number, rows: number): boolean {
    return cols >= 2 && cols <= 500 && rows >= 1 && rows <= 500;
  }

  /** Connect to WebSocket server */
  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    const gen = ++this.socketGeneration;
    this.socket = new WebSocket(this.wsUrl);
    this.socket.binaryType = "arraybuffer";

    this.socket.addEventListener("open", () => {
      if (gen !== this.socketGeneration) return;
      this.reconnectAttempts = 0;
      if (!this.isTabHidden) {
        this.startHeartbeatWatchdog();
      }
      this.element.classList.add("-connected");
      this.element.classList.remove("-disconnected");

      // Flush any batched stdin and process queued messages
      this.flushStdin();
      this.processMessageQueue();

      // Send initial size
      const cols = this.terminal.cols;
      const rows = this.terminal.rows;
      if (this.isValidSize(cols, rows)) {
        this.lastValidSize = { cols, rows };
        this.send(["resize", { width: cols, height: rows }]);
      }

      // Focus terminal
      this.terminal.focus();
    });

    this.socket.addEventListener("close", () => {
      if (gen !== this.socketGeneration) return;
      this.stopHeartbeatWatchdog();
      this.element.classList.remove("-connected");
      this.element.classList.add("-disconnected");
      this.scheduleReconnect();
    });

    this.socket.addEventListener("error", () => {
      // Error handling - close event will follow
    });

    this.socket.addEventListener("message", (event) => {
      if (gen !== this.socketGeneration) return;
      this.handleMessage(event.data);
    });
  }

  /** Handle incoming WebSocket message */
  private handleTextMessage(data: string): void {
    try {
      const envelope = JSON.parse(data) as [string, unknown];
      const [type, payload] = envelope;

      switch (type) {
        case "stdout":
          if (this.isTabHidden) {
            this.bufferWhileHidden(payload as string);
          } else {
            this.terminal.write(payload as string);
          }
          break;
        case "pong":
          this.lastPongAt = Date.now();
          break;
        default:
          console.debug("Unknown message type:", type);
      }
    } catch {
      if (this.isTabHidden) {
        this.bufferWhileHidden(data);
      } else {
        this.terminal.write(data);
      }
    }
  }

  /** Handle incoming WebSocket message */
  private handleMessage(data: string | ArrayBuffer | Blob): void {
    this.lastMessageAt = Date.now();
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      if (this.isTabHidden) {
        this.bufferWhileHidden(bytes);
      } else {
        this.terminal.write(bytes);
      }
      return;
    }
    if (data instanceof Blob) {
      void data.text().then((text) => {
        this.lastMessageAt = Date.now();
        this.handleTextMessage(text);
      }).catch(() => {
        // Ignore blob decode failures; reconnect watchdog will recover if needed.
      });
      return;
    }
    this.handleTextMessage(data);
  }

  private startHeartbeatWatchdog(): void {
    this.stopHeartbeatWatchdog();
    const now = Date.now();
    this.lastMessageAt = now;
    this.lastPongAt = now;
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      const now = Date.now();
      const lastInbound = Math.max(this.lastMessageAt, this.lastPongAt);
      if (now - lastInbound > this.stallTimeoutMs) {
        console.warn("WebSocket inbound stream stalled; reconnecting");
        this.socket.close();
        return;
      }
      this.send(["ping", String(now)]);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** Start periodic resource cleanup to prevent memory leaks */
  private startResourceCleanup(): void {
    this.cleanupTimer = window.setInterval(() => {
      this.trimMessageQueue();
    }, RESOURCE_CLEANUP_INTERVAL_MS);
  }

  /** Stop periodic resource cleanup */
  private stopResourceCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /** Drop oldest messages when the queue exceeds the cap */
  private trimMessageQueue(): void {
    if (this.messageQueue.length > MAX_MESSAGE_QUEUE_SIZE) {
      const dropped = this.messageQueue.length - MAX_MESSAGE_QUEUE_SIZE;
      this.messageQueue = this.messageQueue.slice(-MAX_MESSAGE_QUEUE_SIZE);
      console.warn(`[webterm] Trimmed ${dropped} stale messages from queue`);
    }
  }

  /** Buffer terminal data while the tab is hidden instead of writing to WASM */
  private bufferWhileHidden(data: string | Uint8Array): void {
    const chunk = typeof data === "string"
      ? WebTerminal.sharedTextEncoder.encode(data)
      : data;
    while (
      this.hiddenBufferBytes + chunk.byteLength > MAX_HIDDEN_BUFFER_BYTES &&
      this.hiddenBuffer.length > 0
    ) {
      const evicted = this.hiddenBuffer.shift()!;
      this.hiddenBufferBytes -= evicted.byteLength;
    }
    this.hiddenBuffer.push(chunk);
    this.hiddenBufferBytes += chunk.byteLength;
  }

  /** Discard hidden buffer and reconnect to get clean state from server replay */
  private refreshConnection(): void {
    this.hiddenBuffer.length = 0;
    this.hiddenBufferBytes = 0;
    this.reconnectAttempts = 0;
    this.stopHeartbeatWatchdog();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connect();
  }

  /** Queue stdin data for batched sending */
  private sendStdin(data: string): void {
    if (!data) {
      return;
    }

    this.pendingStdin += data;

    // Flush immediately for large payloads (e.g. paste) to avoid excessive buffering.
    if (this.pendingStdin.length >= STDIN_BATCH_MAX_CHARS) {
      this.flushStdin();
      return;
    }

    if (this.pendingStdinTimer) {
      return;
    }

    this.pendingStdinTimer = window.setTimeout(() => {
      this.pendingStdinTimer = undefined;
      this.flushStdin();
    }, STDIN_BATCH_DELAY_MS);
  }

  private flushStdin(): void {
    if (this.pendingStdinTimer) {
      clearTimeout(this.pendingStdinTimer);
      this.pendingStdinTimer = undefined;
    }
    if (!this.pendingStdin) {
      return;
    }
    const chunk = this.pendingStdin;
    this.pendingStdin = "";
    this.send(["stdin", chunk]);
  }

  /** Send message to server with queueing support */
  private send(message: [string, unknown]): void {
    // Preserve ordering: flush any pending stdin before non-stdin messages (resize/ping/etc).
    if (message[0] !== "stdin" && this.pendingStdin) {
      this.flushStdin();
    }

    if (this.messageQueue.length >= MAX_MESSAGE_QUEUE_SIZE) {
      this.messageQueue = this.messageQueue.slice(-Math.floor(MAX_MESSAGE_QUEUE_SIZE / 2));
      console.warn("[webterm] Message queue overflow; trimmed old messages");
    }
    this.messageQueue.push(message);
    this.processMessageQueue();
  }

  /** Process queued messages when WebSocket is ready */
  private processMessageQueue(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      try {
        if (message) {
          this.socket.send(JSON.stringify(message));
        }
      } catch (e) {
        console.error("Failed to send message:", e, message);
        if (message) {
          this.messageQueue.unshift(message);
        }
        break;
      }
    }
  }

  /** Schedule reconnection attempt */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      console.log(`[webterm] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect();
    }, delay);
  }

  /** Clean up resources */
  dispose(): void {
    this.stopResourceCleanup();
    this.stopHeartbeatWatchdog();
    if (this.pendingStdinTimer) {
      clearTimeout(this.pendingStdinTimer);
      this.pendingStdinTimer = undefined;
    }
    this.pendingStdin = "";
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = undefined;
    }
    this.socket?.close();
    this.socket = null;
    this.messageQueue.length = 0;
    this.hiddenBuffer.length = 0;
    this.hiddenBufferBytes = 0;
    // Remove all tracked event listeners
    for (const { target, type, handler, options } of this.boundHandlers) {
      target.removeEventListener(type, handler, options);
    }
    this.boundHandlers.length = 0;
    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.mobileInput) {
      this.mobileInput.remove();
      this.mobileInput = null;
    }
    if (this.mobileKeybar) {
      this.mobileKeybar.remove();
      this.mobileKeybar = null;
    }
    if (this.mobileKeybarStyle) {
      this.mobileKeybarStyle.remove();
      this.mobileKeybarStyle = null;
    }
    this.fitAddon.dispose();
    this.terminal.dispose();
  }

  /** Set terminal theme dynamically (accesses private renderer) */
  setTheme(theme: ITheme): void {
    // Use the Terminal's options proxy so handleOptionChange fires,
    // which updates the renderer theme AND triggers a re-render.
    (this.terminal as unknown as { options: { theme: ITheme } }).options.theme = theme;
  }

  /** Get a named theme from the built-in themes */
  static getTheme(name: string): ITheme | undefined {
    return THEMES[name.toLowerCase()];
  }
}

// Store instances for potential external access
const instances: Map<HTMLElement, WebTerminal> = new Map();

// Periodically sweep stale terminal instances whose containers were removed from the DOM
setInterval(() => {
  for (const [el, terminal] of instances) {
    if (!el.isConnected) {
      terminal.dispose();
      instances.delete(el);
      console.log("[webterm] Cleaned up stale terminal instance");
    }
  }
}, RESOURCE_CLEANUP_INTERVAL_MS);

/** Initialize all terminal containers on page load */
async function initTerminals(): Promise<void> {
  const containers = document.querySelectorAll<HTMLElement>(".webterm-terminal");

  for (const el of containers) {
    const wsUrl = el.dataset.sessionWebsocketUrl;
    if (!wsUrl) {
      console.error("[webterm] Missing data-session-websocket-url on terminal container");
      continue;
    }

    const config = parseConfig(el);
    try {
      const terminal = await WebTerminal.create(el, wsUrl, config);
      instances.set(el, terminal);
    } catch (e) {
      console.error("[webterm] Failed to create terminal:", e);
    }
  }
}

// Auto-initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initTerminals());
} else {
  initTerminals();
}

// Export for potential external use
export { WebTerminal, initTerminals, instances, THEMES };
