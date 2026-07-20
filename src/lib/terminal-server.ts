// Terminal PTY server — uses `script` (util-linux) to create a real PTY
// for a bash shell, then bridges it with a WebSocket connection.
//
// This module is SERVER-ONLY. It's imported by serve.ts (which runs with Bun
// directly), never by client code. node-pty was the original plan but gyp
// compilation requires `make` which isn't available in the sandbox; `script`
// provides an equivalent PTY via the OS without native compilation.

import type { ServerWebSocket, Subprocess } from "bun";

// ── Constants ────────────────────────────────────────────────────────

const WORK_DIR = "/home/team/shared/site";
const SHELL = "/bin/bash";

// ── Session map ──────────────────────────────────────────────────────

interface TerminalSession {
  proc: Subprocess<"pipe", "pipe", "pipe">;
}

// Track active terminal sessions keyed by WebSocket
const sessions = new WeakMap<ServerWebSocket<unknown>, TerminalSession>();

// ── PTY spawn ────────────────────────────────────────────────────────

function spawnShell(): Subprocess<"pipe", "pipe", "pipe"> {
  // `script` creates a PTY pair. The child (bash) runs on the slave side;
  // `script` relays between the PTY master and its own stdin/stdout.
  // Flags:
  //   -q  quiet — suppress start/stop messages
  //   -f  flush after each write
  //   -c  command to run in the PTY
  //   /dev/null  typescript file (we don't need a log)
  const proc = Bun.spawn(
    [
      "script",
      "-q",
      "-f",
      "-c",
      `cd ${WORK_DIR} && exec ${SHELL} --login`,
      "/dev/null",
    ],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        // Prevent Python/node from buffering output
        PYTHONUNBUFFERED: "1",
        // Force line-buffering for common tools
        FORCE_COLOR: "1",
      },
    },
  );

  // Log stderr from the script process (diagnostics only)
  const stderrReader = proc.stderr.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        if (value.length > 0) {
          // Only log real stderr, filter empty chunks
          const text = new TextDecoder().decode(value);
          if (text.trim()) {
            console.error(`[terminal-pty] ${text.trim()}`);
          }
        }
      }
    } catch {
      // Process closed
    }
  })();

  return proc;
}

// ── WebSocket → PTY input bridge ─────────────────────────────────────

function writeToPty(session: TerminalSession, data: string | Uint8Array): void {
  try {
    const writer = session.proc.stdin.getWriter();
    if (typeof data === "string") {
      writer.write(new TextEncoder().encode(data));
    } else {
      writer.write(data);
    }
    writer.releaseLock();
  } catch {
    // Process may have exited
  }
}

// ── PTY output → WebSocket bridge ────────────────────────────────────

async function streamPtyToWs(
  proc: Subprocess<"pipe", "pipe", "pipe">,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const reader = proc.stdout.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        try {
          ws.send(value);
        } catch {
          break; // WebSocket closed
        }
      }
    }
  } catch {
    // Stream ended
  }
  // Process exited — close the WebSocket
  try {
    ws.close();
  } catch {
    // Already closed
  }
}

// ── Resize handler ───────────────────────────────────────────────────

/**
 * Send terminal resize escape sequence to the PTY.
 * The escape sequence \x1b[8;{rows};{cols}t requests the terminal
 * to resize to the given dimensions. Since the child process (bash)
 * is connected to a real PTY, it will respond to this.
 */
function sendResize(
  session: TerminalSession,
  cols: number,
  rows: number,
): void {
  // ANSI escape sequence to set terminal size
  // \x1b[8;{rows};{cols}t
  const resizeSeq = `\x1b[8;${rows};${cols}t`;
  writeToPty(session, resizeSeq);

  // Also try stty as a fallback for the PTY device
  // This works because bash running in the PTY will process this
  // as a command if at a prompt, but is non-destructive otherwise
  try {
    const sttyCmd = `stty rows ${rows} cols ${cols} 2>/dev/null\n`;
    writeToPty(session, sttyCmd);
  } catch {
    // ignore
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Handle a new WebSocket terminal connection.
 * Call this from serve.ts's websocket open callback when path is /ws/terminal.
 */
export function openTerminalSession(ws: ServerWebSocket<unknown>): void {
  try {
    const proc = spawnShell();
    const session: TerminalSession = { proc };

    sessions.set(ws, session);

    // Start streaming output
    streamPtyToWs(proc, ws);

    // Send initial newline to get a prompt
    setTimeout(() => {
      writeToPty(session, "\n");
    }, 300);
  } catch (err) {
    console.error("[terminal] Failed to spawn shell:", err);
    try {
      ws.send(
        new TextEncoder().encode(
          `\r\n\x1b[31mFailed to spawn shell: ${err}\x1b[0m\r\n`,
        ),
      );
      ws.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Handle an incoming WebSocket message for a terminal session.
 * Call this from serve.ts's websocket message callback.
 */
export function handleTerminalMessage(
  ws: ServerWebSocket<unknown>,
  message: string | Uint8Array,
): void {
  const session = sessions.get(ws);
  if (!session) return;

  // Check if it's a resize message (JSON with cols/rows)
  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message);
      if (
        typeof parsed.cols === "number" &&
        typeof parsed.rows === "number" &&
        parsed.cols > 0 &&
        parsed.rows > 0
      ) {
        sendResize(session, parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — regular terminal input
    }
  }

  writeToPty(session, message);
}

/**
 * Clean up a terminal session when the WebSocket closes.
 * Call this from serve.ts's websocket close callback.
 */
export function closeTerminalSession(ws: ServerWebSocket<unknown>): void {
  const session = sessions.get(ws);
  if (!session) return;

  try {
    session.proc.kill("SIGTERM");
    // Force kill after a short grace period
    setTimeout(() => {
      try {
        session.proc.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }, 500);
  } catch {
    // Process already dead
  }

  sessions.delete(ws);
}

// ── Type guard for serve.ts ──────────────────────────────────────────

/**
 * Check if a WebSocket connection is a terminal session.
 */
export function isTerminalSession(
  ws: ServerWebSocket<unknown>,
): boolean {
  return sessions.has(ws);
}
