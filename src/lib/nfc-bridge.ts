/**
 * NFC Bridge — Web NFC + Desktop NFC Reader integration
 *
 * Two-mode NFC support:
 * 1. Web NFC API (Android Chrome) — browser-native NFC read/write
 * 2. Desktop NFC Bridge — WebSocket connection to local nfc-bridge service
 *    for USB NFC readers (ACR122U) on Windows/macOS/Linux
 */

// ── Types ────────────────────────────────────────────────────────────

export interface NFCBridgeStatus {
  supported: boolean;
  type: "web-nfc" | "desktop-bridge" | "none";
  readerName?: string;
  desktopConnected?: boolean;
}

export interface NFCWriteResult {
  success: boolean;
  error?: string;
}

export interface NDEFRecordInput {
  recordType: "text" | "url" | "mime" | "empty";
  data: string;
  mediaType?: string;
}

// ── Web NFC Support Detection ────────────────────────────────────────

/**
 * Check if the browser supports the Web NFC API.
 * Web NFC is currently only supported in Chrome on Android.
 */
export function checkNFCWebSupport(): boolean {
  try {
    return typeof window !== "undefined" && "NDEFReader" in window;
  } catch {
    return false;
  }
}

/**
 * Get the current NFC status — checks Web NFC support and desktop bridge.
 */
export function getNFCStatus(): NFCBridgeStatus {
  const webSupported = checkNFCWebSupport();

  if (webSupported) {
    return { supported: true, type: "web-nfc" };
  }

  // Desktop status will be updated asynchronously — start as none
  return { supported: false, type: "none" };
}

// ── Web NFC — Write NDEF Message ─────────────────────────────────────

/**
 * Write an NDEF message to an NFC tag via Web NFC API.
 * Only works in Chrome on Android with Web NFC enabled.
 */
export async function writeNFCMessage(
  records: NDEFRecordInput[]
): Promise<NFCWriteResult> {
  try {
    if (!checkNFCWebSupport()) {
      return {
        success: false,
        error: "Web NFC not supported in this browser. Use Chrome on Android.",
      };
    }

    // @ts-ignore — NDEFReader is not in standard TypeScript libs yet
    const ndef = new window.NDEFReader();
    await ndef.scan();

    const ndefRecords = records.map((r) => {
      switch (r.recordType) {
        case "url":
          return { recordType: "url", data: r.data };
        case "text":
          return { recordType: "text", data: r.data };
        case "mime":
          return { recordType: "mime-type", data: r.data, mediaType: r.mediaType || "application/json" };
        default:
          return { recordType: "empty" };
      }
    });

    await ndef.write({ records: ndefRecords });
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "NFC write failed",
    };
  }
}

/**
 * Read an NFC tag via Web NFC API (alias for readNFCTag).
 * Used by the HSMC Pay PWA for customer-side NFC payment detection.
 */
export const readNFCMessage = readNFCTag;

/**
 * Read an NFC tag via Web NFC API.
 * Returns the parsed NDEF message from a tapped NFC tag.
 */
export async function readNFCTag(): Promise<NFCWriteResult & { ndefMessage?: unknown }> {
  try {
    if (!checkNFCWebSupport()) {
      return {
        success: false,
        error: "Web NFC not supported in this browser. Use Chrome on Android.",
      };
    }

    // @ts-ignore
    const ndef = new window.NDEFReader();
    await ndef.scan();

    return new Promise((resolve) => {
      // @ts-ignore
      ndef.addEventListener("reading", ({ message, serialNumber }: any) => {
        const records: Array<{ recordType: string; data: string }> = [];
        for (const record of message.records) {
          if (record.recordType === "text") {
            const decoder = new TextDecoder(record.encoding || "utf-8");
            records.push({ recordType: "text", data: decoder.decode(record.data) });
          } else if (record.recordType === "url") {
            const decoder = new TextDecoder();
            records.push({ recordType: "url", data: decoder.decode(record.data) });
          } else {
            records.push({ recordType: record.recordType || "unknown", data: "" });
          }
        }
        resolve({ success: true, ndefMessage: { serialNumber, records } });
      });

      // @ts-ignore
      ndef.addEventListener("readingerror", () => {
        resolve({ success: false, error: "Failed to read NFC tag" });
      });
    });
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "NFC read failed",
    };
  }
}

// ── Desktop NFC Bridge ───────────────────────────────────────────────

/**
 * Connection state for the desktop NFC bridge WebSocket.
 */
let desktopWS: WebSocket | null = null;
let desktopConnected = false;
let desktopReaderName: string | null = null;

/** Registered message handlers */
type NFCTagHandler = (payload: {
  uid: string;
  ndefMessage: Array<{ tnf: number; type: string; payload: string }> | null;
  timestamp: number;
}) => void;

let nfcTagHandlers: Set<NFCTagHandler> = new Set();
let desktopStatusHandlers: Set<(connected: boolean, reader: string | null) => void> = new Set();

/**
 * Check if the desktop NFC bridge is running.
 * Calls GET http://localhost:9876/status
 */
export async function checkDesktopReader(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("http://localhost:9876/status", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    return data.connected === true;
  } catch {
    return false;
  }
}

/**
 * Get detailed status from the desktop NFC bridge.
 */
export async function getDesktopBridgeStatus(): Promise<{
  connected: boolean;
  reader: string | null;
  clients: number;
  uptime: number;
} | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("http://localhost:9876/status", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Connect to the desktop NFC bridge WebSocket.
 * Returns control objects to interact with the bridge.
 */
export function connectDesktopNFCBridge(): {
  ws: WebSocket;
  status: Promise<NFCBridgeStatus>;
} {
  const ws = new WebSocket("ws://localhost:9876");

  ws.onopen = () => {
    desktopConnected = true;
    desktopWS = ws;
    console.log("[NFC-Bridge] Connected to desktop NFC bridge");
  };

  ws.onclose = () => {
    desktopConnected = false;
    desktopWS = null;
    console.log("[NFC-Bridge] Disconnected from desktop NFC bridge");
    // Notify status handlers
    for (const handler of desktopStatusHandlers) {
      handler(false, null);
    }
  };

  ws.onerror = (err) => {
    console.warn("[NFC-Bridge] WebSocket error:", err);
    desktopConnected = false;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "status":
          desktopConnected = msg.connected;
          desktopReaderName = msg.reader || null;
          for (const handler of desktopStatusHandlers) {
            handler(msg.connected, msg.reader || null);
          }
          break;

        case "reader-connected":
          desktopReaderName = msg.reader;
          for (const handler of desktopStatusHandlers) {
            handler(true, msg.reader);
          }
          break;

        case "reader-disconnected":
          desktopReaderName = null;
          for (const handler of desktopStatusHandlers) {
            handler(false, null);
          }
          break;

        case "nfc-tag":
          for (const handler of nfcTagHandlers) {
            handler({
              uid: msg.uid || "unknown",
              ndefMessage: msg.ndefMessage || null,
              timestamp: msg.timestamp || Date.now(),
            });
          }
          break;

        case "pong":
          // Keep-alive response — no action needed
          break;
      }
    } catch {
      // Ignore non-JSON messages
    }
  };

  const statusPromise = getDesktopBridgeStatus().then((status) => {
    if (status) {
      return {
        supported: status.connected,
        type: "desktop-bridge" as const,
        desktopConnected: status.connected,
        readerName: status.reader,
      };
    }
    return {
      supported: false,
      type: "none" as const,
    };
  });

  return { ws, status: statusPromise };
}

/**
 * Register a handler for NFC tag detection via desktop bridge.
 */
export function onDesktopNFCTag(handler: NFCTagHandler): () => void {
  nfcTagHandlers.add(handler);
  return () => {
    nfcTagHandlers.delete(handler);
  };
}

/**
 * Register a handler for desktop bridge status changes.
 */
export function onDesktopBridgeStatus(
  handler: (connected: boolean, reader: string | null) => void
): () => void {
  desktopStatusHandlers.add(handler);
  return () => {
    desktopStatusHandlers.delete(handler);
  };
}

/**
 * Disconnect from the desktop NFC bridge.
 */
export function disconnectDesktopNFCBridge(): void {
  if (desktopWS) {
    try {
      desktopWS.close();
    } catch {
      // ignore
    }
    desktopWS = null;
  }
  desktopConnected = false;
  desktopReaderName = null;
}

/**
 * Get current desktop bridge connection state (synchronous).
 */
export function getDesktopBridgeState(): {
  connected: boolean;
  readerName: string | null;
} {
  return {
    connected: desktopConnected,
    readerName: desktopReaderName,
  };
}
