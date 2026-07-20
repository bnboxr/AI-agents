import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────

interface TerminalProps {
  className?: string;
}

// ── Constants ─────────────────────────────────────────────────────

const TERMINAL_BG = "#0a0f1a";

const xtermTheme = {
  background: TERMINAL_BG,
  foreground: "#c0caf5",
  cursor: "#00bcd4",
  cursorAccent: TERMINAL_BG,
  selectionBackground: "rgba(0, 188, 212, 0.3)",
  selectionForeground: "#e0e6ed",
  black: "#1a1b26",
  brightBlack: "#414868",
  red: "#f7768e",
  brightRed: "#f7768e",
  green: "#9ece6a",
  brightGreen: "#9ece6a",
  yellow: "#e0af68",
  brightYellow: "#e0af68",
  blue: "#7aa2f7",
  brightBlue: "#7aa2f7",
  magenta: "#bb9af7",
  brightMagenta: "#bb9af7",
  cyan: "#7dcfff",
  brightCyan: "#7dcfff",
  white: "#a9b1d6",
  brightWhite: "#c0caf5",
};

// ── Component ─────────────────────────────────────────────────────

export default function Terminal({ className = "" }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if we're on client side (SSR guard)
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // ── Initialize terminal ────────────────────────────────────────

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || terminalRef.current) return;

    try {
      // Dynamic imports — these only work in browser
      const [{ Terminal: XTerm }, { FitAddon }, { WebLinksAddon }] =
        await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-web-links"),
        ]);

      // Load xterm CSS
      const cssId = "xterm-css";
      if (!document.getElementById(cssId)) {
        const link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href =
          "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.css";
        document.head.appendChild(link);
      }

      const term = new XTerm({
        theme: xtermTheme,
        fontSize: 14,
        fontFamily:
          '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
        cursorBlink: true,
        cursorStyle: "bar",
        allowProposedApi: true,
        allowTransparency: false,
        scrollback: 5000,
        tabStopWidth: 4,
        convertEol: true,
        cols: 80,
        rows: 24,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      term.open(containerRef.current);

      // Fit after a short delay to let the container render
      setTimeout(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      }, 150);

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      // ── Connect WebSocket ────────────────────────────────────

      connectWebSocket(term, fitAddon);

      // ── Resize observer ──────────────────────────────────────

      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimeoutRef.current)
          clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = setTimeout(() => {
          try {
            fitAddon.fit();
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  cols: term.cols,
                  rows: term.rows,
                }),
              );
            }
          } catch {
            // ignore
          }
        }, 100);
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // ── Cleanup ──────────────────────────────────────────────

      return () => {
        resizeObserver.disconnect();
        if (resizeTimeoutRef.current)
          clearTimeout(resizeTimeoutRef.current);
        term.dispose();
        if (wsRef.current) {
          wsRef.current.close();
        }
      };
    } catch (err: any) {
      console.error("[Terminal] Init error:", err);
      setError(err.message || "Failed to initialize terminal");
    }
  }, []);

  // ── WebSocket connection ──────────────────────────────────────

  function connectWebSocket(term: any, fitAddon: any) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws/terminal`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setConnected(true);
      setError(null);

      // Send initial size
      try {
        ws.send(
          JSON.stringify({
            cols: term.cols,
            rows: term.rows,
          }),
        );
      } catch {
        // ignore
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else if (typeof event.data === "string") {
        term.write(event.data);
      } else if (event.data instanceof Blob) {
        // Blob — read as arraybuffer
        event.data.arrayBuffer().then((buf: ArrayBuffer) => {
          term.write(new Uint8Array(buf));
        });
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.write("\r\n\x1b[31m═══ Connection closed ═══\x1b[0m\r\n");
    };

    ws.onerror = () => {
      setError("WebSocket connection failed");
    };

    // ── Forward terminal input to WebSocket ────────────────────

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // On resize, send new dimensions
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cols, rows }));
      }
    });
  }

  // ── Run init once on client ────────────────────────────────────

  useEffect(() => {
    if (!isClient) return;

    let cleanup: (() => void) | undefined;

    initTerminal().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  }, [isClient, initTerminal]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Terminal header bar */}
      <div className="flex items-center gap-2 px-3 py-2 glass-card rounded-b-none border-b-0">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            connected
              ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]"
              : error
                ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]"
                : "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]"
          }`}
        />
        <span className="text-xs text-mono text-gray-400">
          bash — /home/team/shared/site
        </span>
        <span className="text-[10px] text-mono ml-auto text-gray-500">
          {connected ? "connected" : error ? "error" : "connecting..."}
        </span>
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-b-xl overflow-hidden border border-dark-border border-t-0"
        style={{ backgroundColor: TERMINAL_BG }}
      />

      {error && (
        <div className="text-xs text-red-400 mt-1 px-2 font-mono">
          {error}
        </div>
      )}
    </div>
  );
}
