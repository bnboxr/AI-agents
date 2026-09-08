/**
 * POS Blockchain Watcher — Monitors PaymentSettlement contract for PaymentReceived events
 *
 * Polls the Polygon chain every 5 seconds for new payment events.
 * When found, calls confirmPaymentSession() to update the POS state.
 * This closes the gap: previously the POS only polled an in-memory Map.
 * Master wallet architecture — no per-merchant tracking.
 */

import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { polygonAmoy, polygon } from "viem/chains";
import { confirmPaymentSession } from "./pos-service";
import { requireEnv } from "./env-guard";

// ── Config ─────────────────────────────────────────────────────────────
// No silent demo defaults: the contract address and RPC come from env only
// and THROW when absent (owner hard rule: no zero-address / /v2/demo RPC).

function getContractAddress(): string {
  return requireEnv("VITE_POS_CONTRACT_ADDRESS");
}

function getRpcUrl(): string {
  return requireEnv("VITE_POLYGON_RPC");
}

const CHAIN =
  (typeof process !== "undefined" && process.env?.VITE_POS_NETWORK) === "mainnet"
    ? polygon
    : polygonAmoy;

const POLL_INTERVAL = 5000; // 5 seconds

// ── Client (created on start, after env guards pass) ───────────────────

let publicClient: PublicClient | null = null;
let contractAddress = "";

// ── Event Signature ────────────────────────────────────────────────────

const PAYMENT_RECEIVED_EVENT = parseAbiItem(
  "event PaymentReceived(uint256 indexed id, address indexed payer, address token, uint256 amount, uint256 timestamp, string sessionId)"
);

// ── Watcher State ──────────────────────────────────────────────────────

let watcherInterval: ReturnType<typeof setInterval> | null = null;
let lastBlock = 0n;
let isRunning = false;
const seenTxIds = new Set<string>(); // Deduplicate

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Start monitoring the blockchain for PaymentReceived events.
 * Idempotent — calling multiple times is safe.
 *
 * Requires VITE_POS_CONTRACT_ADDRESS + VITE_POLYGON_RPC (else refuses to
 * start — no demo fallback; errors surface in the console).
 */
export function startPaymentWatcher(): void {
  if (isRunning) {
    console.log("[POS Watcher] Already running");
    return;
  }

  let rpcUrl: string;
  try {
    rpcUrl = getRpcUrl();
    contractAddress = getContractAddress();
  } catch (err) {
    console.error(
      "[POS Watcher] Refusing to start — live settlement config missing:",
      (err as Error).message,
    );
    return;
  }

  publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl),
  });

  isRunning = true;
  console.log(`[POS Watcher] Starting on ${CHAIN.name} — contract ${contractAddress.slice(0, 10)}...`);

  // Initial poll immediately
  pollForPayments();

  // Then poll every POLL_INTERVAL ms
  watcherInterval = setInterval(pollForPayments, POLL_INTERVAL);
}

/**
 * Stop the blockchain watcher.
 */
export function stopPaymentWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
  isRunning = false;
  lastBlock = 0n;
  console.log("[POS Watcher] Stopped");
}

/**
 * Check if the watcher is currently running.
 */
export function isWatcherRunning(): boolean {
  return isRunning;
}

// ── Internal Poll Logic ────────────────────────────────────────────────

async function pollForPayments(): Promise<void> {
  // No contract configured → the watcher was never started (guards above
  // refuse to start without VITE_POS_CONTRACT_ADDRESS). Never poll a
  // zero-address silently.
  if (!publicClient || !contractAddress) {
    console.error("[POS Watcher] Poll skipped — watcher not started (missing VITE_POS_CONTRACT_ADDRESS / VITE_POLYGON_RPC).");
    return;
  }

  try {
    const currentBlock = await publicClient.getBlockNumber();

    // On first run, start watching from 10 blocks ago to catch recent payments
    if (lastBlock === 0n) {
      lastBlock = currentBlock - 10n > 0n ? currentBlock - 10n : 0n;
      console.log(`[POS Watcher] Starting from block ${lastBlock} (current: ${currentBlock})`);
    }

    // No new blocks since last poll
    if (currentBlock < lastBlock) return;

    const logs = await publicClient.getLogs({
      address: contractAddress as `0x${string}`,
      event: PAYMENT_RECEIVED_EVENT,
      fromBlock: lastBlock,
      toBlock: currentBlock,
    });

    for (const log of logs) {
      const { sessionId, payer, amount } =
        log.args as unknown as {
          sessionId: string;
          payer: string;
          token: string;
          amount: bigint;
        };

      // Deduplicate by transaction hash
      if (seenTxIds.has(log.transactionHash)) continue;
      seenTxIds.add(log.transactionHash);

      // Trim sessionId — Solidity sometimes pads strings
      const cleanSessionId = (sessionId || "").replace(/\0/g, "").trim();

      if (!cleanSessionId) {
        console.warn("[POS Watcher] PaymentReceived with empty sessionId, tx:", log.transactionHash);
        continue;
      }

      console.log(
        `[POS Watcher] 💰 Payment detected! session=${cleanSessionId} tx=${log.transactionHash.slice(0, 10)}... amount=${amount} payer=${payer.slice(0, 8)}...`
      );

      // Confirm the payment in the POS session
      confirmPaymentSession(cleanSessionId, log.transactionHash, payer).catch((err) => {
        console.warn("[POS Watcher] Failed to confirm session:", cleanSessionId, err);
      });
    }

    lastBlock = currentBlock + 1n;
  } catch (err) {
    console.warn("[POS Watcher] Poll error:", err);
    // Don't crash the watcher — will retry on next interval
  }
}
