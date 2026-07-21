/**
 * HSMC Desktop NFC Bridge
 *
 * WebSocket server (port 9876) that bridges USB NFC readers (ACR122U or similar)
 * to the HSMC POS web application. Reads NDEF messages from tapped NFC tags
 * and forwards them to connected WebSocket clients.
 *
 * Status endpoint: GET http://localhost:9876/status
 *
 * Usage: npm start
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

// ── Configuration ──────────────────────────────────────────────────────

const WS_PORT = 9876;
const HTTP_PORT = 9876; // same port for status HTTP endpoint

// ── State ──────────────────────────────────────────────────────────────

/** @type {import('nfc-pcsc').NFC | null} */
let nfc = null;

/** @type {import('nfc-pcsc').Reader | null} */
let currentReader = null;

let readerConnected = false;
let readerName = null;

/** @type {Set<WebSocket>} */
const clients = new Set();

// ── Logging ────────────────────────────────────────────────────────────

const LOG_PREFIX = "[NFC-Bridge]";

function log(msg, ...args) {
  console.log(`${LOG_PREFIX} ${msg}`, ...args);
}

function warn(msg, ...args) {
  console.warn(`${LOG_PREFIX} ⚠️  ${msg}`, ...args);
}

function error(msg, ...args) {
  console.error(`${LOG_PREFIX} ❌ ${msg}`, ...args);
}

// ── NDEF Parsing ───────────────────────────────────────────────────────

/**
 * Extracts NDEF message from a detected NFC tag.
 * Returns an array of NDEF records if parsing succeeds, null otherwise.
 */
function extractNDEFMessage(tag) {
  try {
    // nfc-pcsc exposes NDEF data via tag.ndefMessage (array of records)
    if (tag.ndefMessage && Array.isArray(tag.ndefMessage)) {
      return tag.ndefMessage.map((record) => ({
        tnf: record.tnf,
        type: record.type ? String.fromCharCode(...record.type) : "",
        payload: record.payload ? Buffer.from(record.payload).toString("utf-8") : "",
      }));
    }

    // Fallback: try to read raw data and parse NDEF manually
    if (tag.data && tag.data.length > 0) {
      log("Raw tag data detected, attempting NDEF parse...");
      // Return raw data as fallback (hex encoded)
      const hexData = Buffer.from(tag.data).toString("hex");
      return [{ tnf: 0, type: "raw", payload: hexData }];
    }

    return null;
  } catch (err) {
    error("NDEF extraction error:", err.message);
    return null;
  }
}

// ── NFC Reader Setup ───────────────────────────────────────────────────

async function initNFCReader() {
  try {
    const { NFC } = await import("nfc-pcsc");
    nfc = new NFC();

    nfc.on("reader", async (reader) => {
      log(`Reader detected: ${reader.reader.name}`);
      currentReader = reader;
      readerConnected = true;
      readerName = reader.reader.name;
      broadcast({ type: "reader-connected", reader: readerName });

      // Handle card detection
      reader.on("card", async (card) => {
        log(`Card detected: ${card.uid || card.uidHex || "unknown"}`);

        try {
          const ndefMessage = extractNDEFMessage(card);

          broadcast({
            type: "nfc-tag",
            uid: card.uid || card.uidHex,
            timestamp: Date.now(),
            ndefMessage,
          });

          if (ndefMessage) {
            log(
              `NDEF records: ${ndefMessage.length}`,
              ndefMessage.map((r) => r.type).join(", ")
            );
          }
        } catch (err) {
          error("Card processing error:", err.message);
        }
      });

      // Handle card removal
      reader.on("card.off", (card) => {
        log(`Card removed: ${card.uid || card.uidHex || "unknown"}`);
        broadcast({ type: "nfc-tag-removed", uid: card.uid });
      });

      // Handle reader errors
      reader.on("error", (err) => {
        error(`Reader error: ${err.message}`);
        broadcast({ type: "reader-error", error: err.message });
      });

      // Handle reader disconnected
      reader.on("end", () => {
        log(`Reader disconnected: ${readerName}`);
        readerConnected = false;
        readerName = null;
        currentReader = null;
        broadcast({ type: "reader-disconnected" });
      });
    });

    nfc.on("error", (err) => {
      error(`NFC system error: ${err.message}`);
      readerConnected = false;
      readerName = null;
      currentReader = null;
      broadcast({ type: "reader-error", error: err.message });
    });

    log("NFC reader initialized. Waiting for ACR122U...");
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND" || err.message?.includes("Cannot find module")) {
      warn(
        "nfc-pcsc not installed. Run: npm install nfc-pcsc"
      );
      warn("Bridge will run without NFC reader support.");
    } else {
      error("Failed to initialize NFC reader:", err.message);
      warn("Bridge will run without NFC reader support.");
    }
  }
}

// ── WebSocket Broadcasting ─────────────────────────────────────────────

/**
 * Broadcast a message to all connected WebSocket clients.
 * @param {object} data
 */
function broadcast(data) {
  const message = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch (err) {
        error("Broadcast error:", err.message);
      }
    }
  }
}

// ── HTTP Server (WebSocket + status endpoint) ──────────────────────────

const httpServer = createServer((req, res) => {
  // CORS headers for local development
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Status endpoint
  if (req.method === "GET" && (req.url === "/status" || req.url === "/")) {
    const status = {
      connected: readerConnected,
      reader: readerName,
      clients: clients.size,
      uptime: Math.floor(process.uptime()),
      version: "1.0.0",
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status));
    return;
  }

  // 404 for other routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// Attach WebSocket server to HTTP server
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress || "unknown";
  log(`Client connected: ${clientIp}`);
  clients.add(ws);

  // Send current status to new client
  ws.send(
    JSON.stringify({
      type: "status",
      connected: readerConnected,
      reader: readerName,
    })
  );

  ws.on("close", () => {
    log(`Client disconnected: ${clientIp}`);
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    error(`Client error (${clientIp}):`, err.message);
    clients.delete(ws);
  });

  // Handle incoming messages (ping/pong, manual commands)
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      } else if (msg.type === "status-request") {
        ws.send(
          JSON.stringify({
            type: "status",
            connected: readerConnected,
            reader: readerName,
            clients: clients.size,
          })
        );
      }
    } catch {
      // Ignore non-JSON messages
    }
  });
});

// ── Start ──────────────────────────────────────────────────────────────

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(`HSMC Desktop NFC Bridge v1.0.0`);
  log(`WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
  log(`Status endpoint: http://127.0.0.1:${HTTP_PORT}/status`);
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Initialize NFC reader (non-blocking — server runs regardless)
  initNFCReader().catch((err) => {
    error("NFC init error:", err.message);
  });
});

// ── Graceful Shutdown ──────────────────────────────────────────────────

function shutdown() {
  log("Shutting down...");
  if (currentReader) {
    try {
      currentReader.close();
    } catch (err) {
      // ignore
    }
  }
  if (nfc) {
    try {
      nfc.close();
    } catch (err) {
      // ignore
    }
  }
  for (const ws of clients) {
    try {
      ws.close();
    } catch (err) {
      // ignore
    }
  }
  httpServer.close(() => {
    log("Server stopped.");
    process.exit(0);
  });

  // Force exit after 3s
  setTimeout(() => {
    log("Force exit.");
    process.exit(1);
  }, 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
  error("Uncaught exception:", err.message);
  // Don't crash — keep the server running
});
