// Production server for the built site. The TanStack Start build emits a portable
// fetch handler (dist/server/server.js) plus static client assets (dist/client);
// this wraps them in a Bun server on port 3000 — static files first, SSR for the
// rest. Run `bun run build` before starting. Restart it with `bun run publish`.
//
// Starting a new instance supersedes the old one: it frees the port no matter
// which user owns the current server (provisioning starts it as `engine`; a team
// member's `bun run publish` runs as their own user), so publish never collides
// with an already-running server. Every sandbox user has passwordless sudo, so
// the takeover works across user boundaries.
import handler from "./dist/server/server.js";
import { startOrchestrator, getState } from "./src/lib/orchestrator/orchestrator";
import { getAgentState, getActivities } from "./src/lib/agent-runner";
import { CHAINS } from "./src/lib/chains";
import { agentBus } from "./src/lib/agent-bus";
import { runMigrations } from "./src/lib/db/migrations";
import { initPriceContext, getState as getPriceState } from "./src/lib/ws/price-context";
import { runKillSwitchChecks } from "./src/lib/risk-engine";
import {
  openTerminalSession,
  handleTerminalMessage,
  closeTerminalSession,
  isTerminalSession,
} from "./src/lib/terminal-server";
import type { AgentBusEvent, AgentBusEvents } from "./src/lib/agent-bus";
import type { ServerWebSocket } from "bun";

// Pinned, NOT read from the environment. The published preview URL
// (<label>.<PUBLIC_SITE_DOMAIN>) is reverse-proxied to 0.0.0.0:3000 inside the
// sandbox, so the default site MUST bind there. Bun auto-loads .env files, so
// honouring process.env.PORT/HOST would let a stray env var or a .env in the site
// dir silently move the site off :3000 (or onto loopback) and break the public URL.
const PORT = 3000;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

// Free PORT regardless of which user owns the current listener. lsof runs under
// sudo so it can see (and the kill can signal) a process owned by another user;
// the loop waits for the socket to actually release before we bind.
const freePort =
  `for _ in $(seq 1 25); do ` +
  `pids=$(lsof -t -iTCP:${String(PORT)} -sTCP:LISTEN 2>/dev/null || true); ` +
  `if [ -z "$pids" ]; then exit 0; fi; ` +
  `kill $pids 2>/dev/null || true; sleep 0.2; ` +
  `done`;

// ── WebSocket client registry ────────────────────────────────────────

const wsClients = new Set<ServerWebSocket<unknown>>();

function broadcast(data: Record<string, unknown>): void {
  const payload = JSON.stringify(data);
  for (const ws of wsClients) {
    try {
      ws.send(payload);
    } catch {
      wsClients.delete(ws);
    }
  }
}

function buildInitPayload() {
  const statuses = CHAINS.map((c) => getAgentState(c.id));
  const activities = getActivities().slice(0, 50);
  const orchState = getState();
  return {
    type: "init",
    statuses,
    activities,
    orchestrator: orchState,
    timestamp: Date.now(),
  };
}

// ── Agent bus → WebSocket bridge ─────────────────────────────────────

agentBus.on("scan_started", (payload) => {
  broadcast({ type: "scan_started", ...payload });
});

agentBus.on("scan_completed", (payload) => {
  broadcast({ type: "scan_completed", ...payload });
});

agentBus.on("opportunity_found", (payload) => {
  broadcast({ type: "opportunity_found", ...payload });
});

agentBus.on("agent_status_change", (payload) => {
  broadcast({ type: "agent_status_change", ...payload });
});

agentBus.on("activity", (payload) => {
  broadcast({ type: "activity", ...payload });
});

// ── Heartbeat ────────────────────────────────────────────────────────

let heartbeatId: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatId) return;
  heartbeatId = setInterval(() => {
    const state = getState();
    const statuses = CHAINS.map((c) => getAgentState(c.id));
    const marketState = getPriceState();
    broadcast({
      type: "heartbeat",
      timestamp: Date.now(),
      orchestrator: state,
      statuses,
      marketData: marketState,
    });
  }, 10_000);
}

// ── Run DB migrations ───────────────────────────────────────────────

runMigrations().catch((err) => {
  console.error("[DB] Migration runner failed:", err);
});

// ── Start real-time market data (Binance WebSocket) ──────────────────

initPriceContext();
console.log("[MarketData] Real-time price streams initializing...");

// ── Kill Switch Monitoring Loop ───────────────────────────────────────

setInterval(() => {
  try {
    runKillSwitchChecks();
  } catch (e) {
    console.error("[KILL SWITCH] Monitor error:", e);
  }
}, 1000);

// ── Start orchestrator ───────────────────────────────────────────────

startOrchestrator();

// ── Server ───────────────────────────────────────────────────────────

for (let attempt = 1; ; attempt++) {
  await Bun.$`sudo sh -c ${freePort}`.quiet().nothrow();
  try {
    Bun.serve({
      port: PORT,
      hostname: HOST,
      websocket: {
        open(ws) {
          // Terminal session: hand off to terminal-server
          const data = ws.data as { kind?: string } | undefined;
          if (data?.kind === "terminal") {
            openTerminalSession(ws);
            return;
          }

          // Agent data websocket
          wsClients.add(ws);
          // Send full initial state on connect
          try {
            ws.send(JSON.stringify(buildInitPayload()));
          } catch {
            wsClients.delete(ws);
          }
          if (wsClients.size === 1) startHeartbeat();
        },
        message(ws, msg) {
          // Only terminal sessions handle incoming messages
          if (isTerminalSession(ws)) {
            handleTerminalMessage(ws, msg);
          }
          // Agent WS messages from client are ignored (server-push only)
        },
        close(ws) {
          // Clean up terminal session if applicable
          if (isTerminalSession(ws)) {
            closeTerminalSession(ws);
            return;
          }

          // Agent data websocket cleanup
          wsClients.delete(ws);
          if (wsClients.size === 0 && heartbeatId) {
            clearInterval(heartbeatId);
            heartbeatId = null;
          }
        },
      },
      fetch(req, server) {
        const { pathname } = new URL(req.url);

        // WebSocket upgrade — sync, no await needed
        if (pathname === "/ws") {
          if (server.upgrade(req)) return;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // Terminal PTY WebSocket
        if (pathname === "/ws/terminal") {
          if (server.upgrade(req, { data: { kind: "terminal" } })) return;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // For everything else, delegate to async handler
        return handleHttp(req);
      },
    });
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    await Bun.sleep(200);
  }
}

async function handleHttp(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname !== "/") {
    const file = Bun.file(CLIENT_DIR + pathname);
    if (await file.exists()) return new Response(file);
  }
  return (handler as { fetch: (r: Request) => Response | Promise<Response> }).fetch(req);
}

console.log(`team-site serving on http://${HOST}:${String(PORT)}`);
