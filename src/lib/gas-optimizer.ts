import { createServerFn } from "@tanstack/react-start";
import { CHAINS } from "./chains";

// ── Types ────────────────────────────────────────────────────────────

export interface GasSnapshot {
  chainId: string;
  gwei: number;
  timestamp: number;
  hour: number; // 0-23 UTC
}

export interface GasHeatmapCell {
  chainId: string;
  chainName: string;
  hour: number;
  avgGwei: number;
  minGwei: number;
  maxGwei: number;
  sampleCount: number;
}

export interface CheapWindow {
  chainId: string;
  chainName: string;
  startHour: number;
  endHour: number;
  avgGwei: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface GasSavings {
  chainId: string;
  chainName: string;
  totalTxScheduled: number;
  estimatedSavingsGwei: number;
  estimatedSavingsUSD: number;
}

export interface GasOptimizerState {
  currentPrices: Record<string, { gwei: number; timestamp: number } | null>;
  heatmap: GasHeatmapCell[];
  cheapWindows: CheapWindow[];
  savings: GasSavings[];
  autoScheduleEnabled: boolean;
  lastUpdated: number;
}

// ── In-Memory Ring Buffer (24 hours) ────────────────────────────────

const RING_BUFFER_SIZE = 1440; // 24h * 60 samples (1 per minute theoretical)
const gasHistory: GasSnapshot[] = [];
let autoScheduleEnabled = false;

// Savings tracker
const savingsTracker: Map<string, { totalTx: number; totalGweiSaved: number }> = new Map();

// Last fetched timestamp per chain (rate limiting)
const lastFetchTime: Map<string, number> = new Map();
const FETCH_COOLDOWN = 30_000; // 30s between fetches per chain

// ── Gas Price Fetching ──────────────────────────────────────────────

const GAS_PRICE_ESTIMATES: Record<string, number> = {
  ethereum: 25,
  bnb: 3,
  polygon: 150,
  arbitrum: 0.1,
  optimism: 0.01,
  base: 0.01,
  avalanche: 30,
  fantom: 5,
  gnosis: 2,
  zksync: 0.05,
  linea: 0.01,
  scroll: 0.1,
  mantle: 0.02,
  celo: 0.5,
  moonbeam: 10,
  solana: 0.00001,
  near: 0.0001,
  aptos: 0.0001,
  sui: 0.0001,
  tron: 10,
};

async function fetchGasPrice(chainId: string): Promise<number | null> {
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain) return null;

  // Rate limit
  const lastFetch = lastFetchTime.get(chainId);
  if (lastFetch && Date.now() - lastFetch < FETCH_COOLDOWN) {
    // Return latest snapshot if available
    const latest = gasHistory.filter((s) => s.chainId === chainId).pop();
    return latest?.gwei ?? GAS_PRICE_ESTIMATES[chainId] ?? null;
  }

  lastFetchTime.set(chainId, Date.now());

  try {
    if (chain.type === "evm" && chain.rpc) {
      const res = await fetch(chain.rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.result) {
        const gwei = parseInt(data.result, 16) / 1e9;
        return Math.round(gwei * 100) / 100;
      }
    }
  } catch {
    // Fall through to estimate
  }

  // Fallback: use estimate with small random jitter
  const base = GAS_PRICE_ESTIMATES[chainId];
  if (base !== undefined) {
    return base * (0.9 + Math.random() * 0.2);
  }
  return null;
}

// ── Snapshot Recording ──────────────────────────────────────────────

function recordSnapshot(snapshot: GasSnapshot): void {
  gasHistory.push(snapshot);

  // Trim to ring buffer size
  while (gasHistory.length > RING_BUFFER_SIZE) {
    gasHistory.shift();
  }
}

// ── Heatmap Computation ─────────────────────────────────────────────

function computeHeatmap(): GasHeatmapCell[] {
  const cells: GasHeatmapCell[] = [];
  const now = Date.now();
  const cutoff = now - 24 * 3600 * 1000;

  const recentSnapshots = gasHistory.filter((s) => s.timestamp >= cutoff);

  for (const chain of CHAINS) {
    for (let hour = 0; hour < 24; hour++) {
      const hourSnapshots = recentSnapshots.filter(
        (s) => s.chainId === chain.id && s.hour === hour
      );

      if (hourSnapshots.length > 0) {
        const gweis = hourSnapshots.map((s) => s.gwei);
        cells.push({
          chainId: chain.id,
          chainName: chain.name,
          hour,
          avgGwei: gweis.reduce((a, b) => a + b, 0) / gweis.length,
          minGwei: Math.min(...gweis),
          maxGwei: Math.max(...gweis),
          sampleCount: hourSnapshots.length,
        });
      }
    }
  }

  return cells;
}

// ── Cheap Window Detection ──────────────────────────────────────────

function findCheapWindows(heatmap: GasHeatmapCell[]): CheapWindow[] {
  const windows: CheapWindow[] = [];

  for (const chain of CHAINS) {
    const chainCells = heatmap
      .filter((c) => c.chainId === chain.id)
      .sort((a, b) => a.avgGwei - b.avgGwei);

    if (chainCells.length === 0) continue;

    // Find contiguous cheap windows (2+ hours below median)
    const allGweis = chainCells.map((c) => c.avgGwei);
    const medianGwei =
      allGweis.length > 0
        ? allGweis.sort((a, b) => a - b)[Math.floor(allGweis.length / 2)]
        : 0;

    // Get all cells below median
    const cheapCells = chainCells.filter((c) => c.avgGwei <= medianGwei);

    // Group into contiguous blocks
    if (cheapCells.length > 0) {
      const sorted = [...cheapCells].sort((a, b) => a.hour - b.hour);

      let windowStart = sorted[0].hour;
      let windowEnd = sorted[0].hour;
      let totalGwei = sorted[0].avgGwei;
      let count = 1;

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].hour === windowEnd + 1 || (windowEnd === 23 && sorted[i].hour === 0)) {
          windowEnd = sorted[i].hour;
          totalGwei += sorted[i].avgGwei;
          count++;
        } else {
          // Close window
          if (count >= 2) {
            windows.push({
              chainId: chain.id,
              chainName: chain.name,
              startHour: windowStart,
              endHour: windowEnd,
              avgGwei: totalGwei / count,
              confidence: count >= 4 ? "high" : count >= 2 ? "medium" : "low",
            });
          }
          windowStart = sorted[i].hour;
          windowEnd = sorted[i].hour;
          totalGwei = sorted[i].avgGwei;
          count = 1;
        }
      }

      // Close final window
      if (count >= 2) {
        windows.push({
          chainId: chain.id,
          chainName: chain.name,
          startHour: windowStart,
          endHour: windowEnd,
          avgGwei: totalGwei / count,
          confidence: count >= 4 ? "high" : count >= 2 ? "medium" : "low",
        });
      }
    }
  }

  return windows.sort((a, b) => a.avgGwei - b.avgGwei).slice(0, 10);
}

// ── Current Prices ──────────────────────────────────────────────────

function getCurrentPrices() {
  const prices: Record<string, { gwei: number; timestamp: number } | null> = {};
  const now = Date.now();

  for (const chain of CHAINS) {
    const latest = gasHistory.filter((s) => s.chainId === chain.id).pop();
    if (latest && now - latest.timestamp < 600_000) {
      // Within 10 min
      prices[chain.id] = { gwei: latest.gwei, timestamp: latest.timestamp };
    } else {
      // Use estimate
      const est = GAS_PRICE_ESTIMATES[chain.id];
      prices[chain.id] = est !== undefined ? { gwei: est, timestamp: now } : null;
    }
  }

  return prices;
}

// ── Savings Computation ─────────────────────────────────────────────

function computeSavings(): GasSavings[] {
  const result: GasSavings[] = [];
  for (const chain of CHAINS) {
    const saved = savingsTracker.get(chain.id);
    result.push({
      chainId: chain.id,
      chainName: chain.name,
      totalTxScheduled: saved?.totalTx ?? 0,
      estimatedSavingsGwei: saved?.totalGweiSaved ?? 0,
      estimatedSavingsUSD: (saved?.totalGweiSaved ?? 0) * 0.0000001, // Rough ETH→USD for gwei
    });
  }
  return result;
}

// ── Core Public API ─────────────────────────────────────────────────

/**
 * Record a new gas snapshot. Called periodically (e.g., every 5 min from scheduler).
 */
export async function recordGasSnapshot(): Promise<GasSnapshot[]> {
  const now = Date.now();
  const hour = new Date(now).getUTCHours();
  const snapshots: GasSnapshot[] = [];

  for (const chain of CHAINS) {
    const gwei = await fetchGasPrice(chain.id);
    if (gwei !== null) {
      const snapshot: GasSnapshot = {
        chainId: chain.id,
        gwei,
        timestamp: now,
        hour,
      };
      recordSnapshot(snapshot);
      snapshots.push(snapshot);
    }
  }

  return snapshots;
}

/**
 * Get the full gas optimizer state.
 */
export function getGasOptimizerState(): GasOptimizerState {
  const heatmap = computeHeatmap();
  const cheapWindows = findCheapWindows(heatmap);
  const currentPrices = getCurrentPrices();
  const savings = computeSavings();

  return {
    currentPrices,
    heatmap,
    cheapWindows,
    savings,
    autoScheduleEnabled,
    lastUpdated: gasHistory.length > 0 ? gasHistory[gasHistory.length - 1].timestamp : Date.now(),
  };
}

/**
 * Toggle auto-schedule mode.
 */
export function setAutoSchedule(enabled: boolean): void {
  autoScheduleEnabled = enabled;
}

/**
 * Find the next cheap window for a given chain.
 */
export function findNextCheapWindow(chainId: string): CheapWindow | null {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const heatmap = computeHeatmap();
  const windows = findCheapWindows(heatmap);

  const chainWindows = windows
    .filter((w) => w.chainId === chainId)
    .sort((a, b) => a.avgGwei - b.avgGwei);

  if (chainWindows.length === 0) return null;

  // Find the closest window in the future (wrap around)
  let best = chainWindows[0];
  let bestDist = 25;
  for (const w of chainWindows) {
    let dist = w.startHour - currentHour;
    if (dist <= 0) dist += 24;
    if (dist < bestDist) {
      bestDist = dist;
      best = w;
    }
  }

  return best;
}

/**
 * Track a scheduled transaction for gas savings.
 * Called when the orchestrator schedules a task during a cheap window.
 */
export function trackScheduledTx(
  chainId: string,
  estimatedGwei: number,
  peakGwei: number
): void {
  const existing = savingsTracker.get(chainId);
  const saved = peakGwei - estimatedGwei;
  if (saved > 0) {
    savingsTracker.set(chainId, {
      totalTx: (existing?.totalTx ?? 0) + 1,
      totalGweiSaved: (existing?.totalGweiSaved ?? 0) + saved,
    });
  }
}

/**
 * Get the peak & current gas for a chain to estimate savings.
 */
export function getGasSavingsOpportunity(chainId: string): { current: number; peak: number; savings: number } | null {
  const heatmap = computeHeatmap();
  const chainCells = heatmap.filter((c) => c.chainId === chainId);
  if (chainCells.length === 0) return null;

  const current = getCurrentPrices()[chainId]?.gwei ?? 0;
  const peak = Math.max(...chainCells.map((c) => c.maxGwei));

  return {
    current,
    peak,
    savings: peak - current,
  };
}

// ── Server Functions ────────────────────────────────────────────────

export const fetchGasState = createServerFn({ method: "GET" }).handler(async (): Promise<GasOptimizerState> => {
  // Refresh snapshots on each call
  await recordGasSnapshot();
  return getGasOptimizerState();
});

export const toggleAutoSchedule = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { enabled: boolean })
  .handler(async ({ data }) => {
    setAutoSchedule(data.enabled);
    return { success: true, autoScheduleEnabled };
  });
