import { createServerFn } from "@tanstack/react-start";
import { agentBus } from "./agent-bus";
import { getRiskStateRaw } from "./risk-engine";
import type { AgentBusEvents } from "./agent-bus";

// ── Types ──────────────────────────────────────────────────────────

export type AlertType =
  | "price_flash_crash"
  | "price_pump"
  | "price_threshold"
  | "arbitrage_spread"
  | "yield_rate"
  | "security_wallet_tx"
  | "security_suspicious";

export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  data?: Record<string, unknown>;
}

export interface PriceThreshold {
  id: string;
  token: string;
  direction: "above" | "below";
  price: number;
}

export interface AlertConfig {
  flashCrashPct: number;
  flashCrashWindowMin: number;
  pumpPct: number;
  pumpWindowMin: number;
  arbitrageSpreadPct: number;
  minYieldAPY: number;
  enabledTypes: Record<AlertType, boolean>;
  soundEnabled: boolean;
  userThresholds: PriceThreshold[];
}

// ── Default Config ─────────────────────────────────────────────────

const DEFAULT_CONFIG: AlertConfig = {
  flashCrashPct: 5,
  flashCrashWindowMin: 5,
  pumpPct: 10,
  pumpWindowMin: 5,
  arbitrageSpreadPct: 2,
  minYieldAPY: 10,
  enabledTypes: {
    price_flash_crash: true,
    price_pump: true,
    price_threshold: true,
    arbitrage_spread: true,
    yield_rate: true,
    security_wallet_tx: true,
    security_suspicious: true,
  },
  soundEnabled: true,
  userThresholds: [],
};

// ── In-Memory State ────────────────────────────────────────────────

let currentConfig: AlertConfig = { ...DEFAULT_CONFIG, userThresholds: [] };

// Ring buffer: max 200 alerts
const MAX_ALERTS = 200;
const alertRingBuffer: Alert[] = [];

// Price snapshot buffer: per token, 20 data points at 30s intervals
interface PriceSnapshot {
  token: string;
  timestamp: number;
  price: number;
}

const priceSnapshots: Map<string, PriceSnapshot[]> = new Map();
const MAX_SNAPSHOTS = 20;

let alertIdCounter = 0;

// ── Price Snapshot Management ──────────────────────────────────────

function addPriceSnapshot(token: string, price: number): void {
  if (!priceSnapshots.has(token)) {
    priceSnapshots.set(token, []);
  }
  const snapshots = priceSnapshots.get(token)!;
  snapshots.push({ token, timestamp: Date.now(), price });

  // Trim to max data points
  while (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.shift();
  }
}

function getPriceSnapshots(token: string): PriceSnapshot[] {
  return priceSnapshots.get(token) ?? [];
}

// ── Alert Helpers ──────────────────────────────────────────────────

function generateAlertId(): string {
  alertIdCounter += 1;
  return `alert-${Date.now()}-${alertIdCounter}`;
}

export function pushAlert(
  type: AlertType,
  severity: AlertSeverity,
  title: string,
  message: string,
  data?: Record<string, unknown>,
): Alert {
  const alert: Alert = {
    id: generateAlertId(),
    type,
    severity,
    title,
    message,
    timestamp: Date.now(),
    acknowledged: false,
    data,
  };

  alertRingBuffer.unshift(alert);

  // Trim ring buffer
  while (alertRingBuffer.length > MAX_ALERTS) {
    alertRingBuffer.pop();
  }

  return alert;
}

// ── Core: Price Alert Checking ─────────────────────────────────────

// CoinGecko ID → token symbol mapping for price alert tokens
const PRICE_ALERT_TOKENS: Record<string, string> = {
  ethereum: "ETH",
  bitcoin: "BTC",
  solana: "SOL",
  binancecoin: "BNB",
  "avalanche-2": "AVAX",
  "matic-network": "MATIC",
};

let cachedPrices: Record<string, number> | null = null;
let lastPriceFetch = 0;
const PRICE_CACHE_TTL = 30_000; // 30s

async function fetchRealPrices(): Promise<Record<string, number> | null> {
  const now = Date.now();
  if (cachedPrices && now - lastPriceFetch < PRICE_CACHE_TTL) {
    return cachedPrices;
  }

  const ids = Object.keys(PRICE_ALERT_TOKENS).join(",");
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const prices: Record<string, number> = {};
    for (const [id, token] of Object.entries(PRICE_ALERT_TOKENS)) {
      if (data[id]?.usd) {
        prices[token] = data[id].usd;
      }
    }
    cachedPrices = prices;
    lastPriceFetch = now;
    return prices;
  } catch (err) {
    console.warn("[AlertEngine] CoinGecko price fetch failed:", err);
    return null;
  }
}

/**
 * Called every 30s to update price snapshots and detect alerts.
 * Uses real CoinGecko price data. Returns early if price feed unavailable.
 */
export async function checkPriceAlerts(): Promise<void> {
  const prices = await fetchRealPrices();
  if (!prices || Object.keys(prices).length === 0) {
    console.warn("[AlertEngine] No real price feed available — skipping alert check");
    return;
  }

  const now = Date.now();

  for (const [token, price] of Object.entries(prices)) {
    addPriceSnapshot(token, price);

    const snapshots = getPriceSnapshots(token);
    if (snapshots.length < 2) continue;

    const latestSnapshot = snapshots[snapshots.length - 1];

    // Check flash crash: price drops > flashCrashPct% within flashCrashWindowMin
    if (currentConfig.enabledTypes.price_flash_crash) {
      const windowMs = currentConfig.flashCrashWindowMin * 60 * 1000;
      const windowStart = now - windowMs;
      const windowSnapshots = snapshots.filter((s) => s.timestamp >= windowStart);

      if (windowSnapshots.length >= 2) {
        const maxInWindow = Math.max(...windowSnapshots.map((s) => s.price));
        const dropPct = ((maxInWindow - price) / maxInWindow) * 100;

        if (dropPct >= currentConfig.flashCrashPct) {
          pushAlert(
            "price_flash_crash",
            "critical",
            `${token} Flash Crash Detected`,
            `${token} dropped ${dropPct.toFixed(2)}% in the last ${currentConfig.flashCrashWindowMin} min (from $${maxInWindow.toFixed(2)} to $${price.toFixed(2)})`,
            { token, dropPct, fromPrice: maxInWindow, toPrice: price, windowMin: currentConfig.flashCrashWindowMin },
          );
        }
      }
    }

    // Check pump: price rises > pumpPct% within pumpWindowMin
    if (currentConfig.enabledTypes.price_pump) {
      const windowMs = currentConfig.pumpWindowMin * 60 * 1000;
      const windowStart = now - windowMs;
      const windowSnapshots = snapshots.filter((s) => s.timestamp >= windowStart);

      if (windowSnapshots.length >= 2) {
        const minInWindow = Math.min(...windowSnapshots.map((s) => s.price));
        const risePct = ((price - minInWindow) / minInWindow) * 100;

        if (risePct >= currentConfig.pumpPct) {
          pushAlert(
            "price_pump",
            "warning",
            `${token} Price Surge`,
            `${token} surged ${risePct.toFixed(2)}% in the last ${currentConfig.pumpWindowMin} min (from $${minInWindow.toFixed(2)} to $${price.toFixed(2)})`,
            { token, risePct, fromPrice: minInWindow, toPrice: price, windowMin: currentConfig.pumpWindowMin },
          );
        }
      }
    }

    // Check user-defined price thresholds
    if (currentConfig.enabledTypes.price_threshold) {
      for (const threshold of currentConfig.userThresholds) {
        if (threshold.token !== token) continue;

        let triggered = false;
        let triggerMsg = "";

        if (threshold.direction === "above" && price >= threshold.price) {
          triggered = true;
          triggerMsg = `${token} price ($${price.toFixed(2)}) crossed above threshold $${threshold.price.toFixed(2)}`;
        } else if (threshold.direction === "below" && price <= threshold.price) {
          triggered = true;
          triggerMsg = `${token} price ($${price.toFixed(2)}) dropped below threshold $${threshold.price.toFixed(2)}`;
        }

        if (triggered) {
          pushAlert(
            "price_threshold",
            "info",
            `${token} Price Threshold`,
            triggerMsg,
            { token, thresholdId: threshold.id, price, threshold: threshold.price, direction: threshold.direction },
          );
          // Remove one-shot threshold after triggering
          currentConfig.userThresholds = currentConfig.userThresholds.filter(
            (t) => t.id !== threshold.id,
          );
        }
      }
    }
  }
}

// ── Server Functions ────────────────────────────────────────────────

/** Get all unacknowledged alerts */
export const getAlerts = createServerFn({ method: "GET" }).handler(async (): Promise<Alert[]> => {
  return alertRingBuffer.filter((a) => !a.acknowledged);
});

/** Get full ring buffer history */
export const getAlertHistory = createServerFn({ method: "GET" }).handler(async (): Promise<Alert[]> => {
  return [...alertRingBuffer];
});

/** Set alert configuration */
export const setAlertConfig = createServerFn({ method: "POST" }).handler(async ({
  data,
}: {
  data: { config: Partial<AlertConfig> };
}): Promise<{ success: boolean; config: AlertConfig }> => {
  // Validate numeric inputs
  if (data.config.flashCrashPct !== undefined) {
    if (data.config.flashCrashPct < 0.1 || data.config.flashCrashPct > 100) {
      throw new Error("Flash crash percentage must be between 0.1 and 100");
    }
    currentConfig.flashCrashPct = data.config.flashCrashPct;
  }
  if (data.config.flashCrashWindowMin !== undefined) {
    if (data.config.flashCrashWindowMin < 1 || data.config.flashCrashWindowMin > 1440) {
      throw new Error("Flash crash window must be between 1 and 1440 minutes");
    }
    currentConfig.flashCrashWindowMin = data.config.flashCrashWindowMin;
  }
  if (data.config.pumpPct !== undefined) {
    if (data.config.pumpPct < 0.1 || data.config.pumpPct > 1000) {
      throw new Error("Pump percentage must be between 0.1 and 1000");
    }
    currentConfig.pumpPct = data.config.pumpPct;
  }
  if (data.config.pumpWindowMin !== undefined) {
    if (data.config.pumpWindowMin < 1 || data.config.pumpWindowMin > 1440) {
      throw new Error("Pump window must be between 1 and 1440 minutes");
    }
    currentConfig.pumpWindowMin = data.config.pumpWindowMin;
  }
  if (data.config.arbitrageSpreadPct !== undefined) {
    if (data.config.arbitrageSpreadPct < 0.01 || data.config.arbitrageSpreadPct > 100) {
      throw new Error("Arbitrage spread percentage must be between 0.01 and 100");
    }
    currentConfig.arbitrageSpreadPct = data.config.arbitrageSpreadPct;
  }
  if (data.config.minYieldAPY !== undefined) {
    if (data.config.minYieldAPY < 0 || data.config.minYieldAPY > 10000) {
      throw new Error("Minimum yield APY must be between 0 and 10000");
    }
    currentConfig.minYieldAPY = data.config.minYieldAPY;
  }
  if (data.config.enabledTypes !== undefined) {
    currentConfig.enabledTypes = { ...currentConfig.enabledTypes, ...data.config.enabledTypes };
  }
  if (data.config.soundEnabled !== undefined) {
    currentConfig.soundEnabled = data.config.soundEnabled;
  }
  if (data.config.userThresholds !== undefined) {
    currentConfig.userThresholds = data.config.userThresholds;
  }

  return { success: true, config: { ...currentConfig, userThresholds: [...currentConfig.userThresholds] } };
});

/** Acknowledge a specific alert */
export const acknowledgeAlert = createServerFn({ method: "POST" }).handler(async ({
  data,
}: {
  data: { alertId: string };
}): Promise<{ success: boolean }> => {
  const alert = alertRingBuffer.find((a) => a.id === data.alertId);
  if (!alert) {
    return { success: false };
  }
  alert.acknowledged = true;
  return { success: true };
});

// ── Loader-Friendly Raw Exports ────────────────────────────────────

/** Get current config (raw, suitable for SSR loaders) */
export async function getConfigRaw(): Promise<AlertConfig> {
  return { ...currentConfig, userThresholds: [...currentConfig.userThresholds] };
}

/** Get ring buffer (raw, suitable for SSR loaders) */
export async function getRingBufferRaw(): Promise<Alert[]> {
  return [...alertRingBuffer];
}

// ── Agent Bus Subscriptions ────────────────────────────────────────

// Subscribe to opportunity_found events for arbitrage / yield alerts
agentBus.on("opportunity_found", (payload: AgentBusEvents["opportunity_found"]) => {
  const opp = payload.opportunity;

  if (opp.type === "arbitrage" && currentConfig.enabledTypes.arbitrage_spread) {
    // Stub for Phase 1 — full spread checking in Phase 2
    const spreadEstimate = opp.estimatedProfit > 0 ? (opp.estimatedProfit / 10) * 100 : 0;
    if (spreadEstimate >= currentConfig.arbitrageSpreadPct || opp.confidence === "high") {
      pushAlert(
        "arbitrage_spread",
        "info",
        `Arbitrage on ${payload.chainId}`,
        opp.description,
        { chainId: payload.chainId, agentName: payload.agentName, estimatedProfit: opp.estimatedProfit },
      );
    }
  }

  if (opp.type === "yield" && currentConfig.enabledTypes.yield_rate) {
    pushAlert(
      "yield_rate",
      "info",
      `Yield Opportunity on ${payload.chainId}`,
      opp.description,
      { chainId: payload.chainId, agentName: payload.agentName, estimatedProfit: opp.estimatedProfit },
    );
  }
});

// Subscribe to activity events for security alerts
agentBus.on("activity", (payload: AgentBusEvents["activity"]) => {
  const act = payload.activity;

  // Check for security-related activity patterns
  if (
    currentConfig.enabledTypes.security_suspicious &&
    act.action.toLowerCase().includes("suspicious")
  ) {
    pushAlert(
      "security_suspicious",
      "warning",
      "Suspicious Activity Detected",
      act.action,
      { chainId: act.chainId, agentName: act.agentName },
    );
  }
});

// ── Periodic Price Checking ────────────────────────────────────────

let priceCheckInterval: ReturnType<typeof setInterval> | null = null;

export function startPriceAlertChecking(): void {
  if (priceCheckInterval) return;

  // Run initial check
  checkPriceAlerts().catch(() => {});

  // Then every 30 seconds
  priceCheckInterval = setInterval(() => {
    try {
      // Get market context from risk engine for crash alerts
      getRiskStateRaw()
        .then((riskState) => {
          if (riskState.marketDropPct > 0) {
            // Inject market context into alerts
            const recentCrashAlerts = alertRingBuffer.filter(
              (a) => a.type === "price_flash_crash" && Date.now() - a.timestamp < 120_000,
            );
            if (recentCrashAlerts.length > 0 && riskState.circuitBreakerTripped) {
              // Update latest crash alert with circuit breaker context
              const latest = recentCrashAlerts[0];
              if (latest && latest.message) {
                latest.message += ` [Circuit breaker tripped. Market drop: ${riskState.marketDropPct.toFixed(1)}%]`;
              }
            }
          }
        })
        .catch(() => {
          // Silently ignore — risk engine may not be available
        });

      checkPriceAlerts().catch(() => {});
    } catch (err) {
      console.warn("[AlertEngine] price check failed:", err);
      // Silently ignore errors in automated checking
    }
  }, 30_000);
}

export function stopPriceAlertChecking(): void {
  if (priceCheckInterval) {
    clearInterval(priceCheckInterval);
    priceCheckInterval = null;
  }
}

// Auto-start price checking
startPriceAlertChecking();
