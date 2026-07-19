import { createServerFn } from "@tanstack/react-start";
import { CHAINS } from "./chains";
import { AGENTS } from "./agents";
import { agentBus } from "./agent-bus";
import { sql, isDbAvailable } from "./db";

// ── Types ──────────────────────────────────────────────────────────

export interface RiskLimits {
  maxDrawdownPct: number;        // per agent, default 20%
  maxExposurePerChain: number;   // USD, default 50,000
  stopLossPct: number;           // default 10%
  marketCrashThresholdPct: number; // default 15% drop in 1h
  maxRiskScore: number;          // 1-10, pause agent if > 8
}

export interface AgentRiskState {
  chainId: string;
  agentName: string;
  icon: string;
  peakValue: number;        // highest portfolio value seen
  currentValue: number;     // current estimated portfolio value
  drawdownPct: number;      // current drawdown %
  exposureUsd: number;      // current exposure in USD
  volatilityPct: number;    // recent volatility %
  riskScore: number;        // 1-10 composite
  status: 'active' | 'paused' | 'stopped';
  lastUpdated: number;
  pauseReason?: string;
}

export interface RiskSystemState {
  limits: RiskLimits;
  agents: Record<string, AgentRiskState>;
  circuitBreakerTripped: boolean;
  circuitBreakerReason: string;
  killSwitchTripped: boolean;
  killSwitchReason: string;
  marketDropPct: number;
  lastMarketCheck: number;
  totalExposure: number;
  activeAgentCount: number;
  pausedAgentCount: number;
  overallRiskScore: number;
  lastUpdated: number;
}

// ── Default Limits ───────────────────────────────────────────────────

const DEFAULT_LIMITS: RiskLimits = {
  maxDrawdownPct: 20,
  maxExposurePerChain: 50_000,
  stopLossPct: 10,
  marketCrashThresholdPct: 15,
  maxRiskScore: 8,
};

// ── In-Memory State ─────────────────────────────────────────────────

let currentLimits: RiskLimits = { ...DEFAULT_LIMITS };

const agentRisk: Record<string, AgentRiskState> = {};

let circuitBreakerTripped = false;
let circuitBreakerReason = "";
let marketDropPct = 0;
let lastMarketCheck = Date.now();

// ── Kill Switch State ────────────────────────────────────────────────
// More severe than circuit breaker: requires manual reset.
// Triggered by API failures, corrupt data, massive spreads, extreme vol, news shocks.

let killSwitchTripped = false;
let killSwitchReason = "";
let killSwitchTimestamp = 0;

/** Timestamp of last successful API health check (Binance WS + CoinGecko) */
let lastApiHealthCheck = Date.now();

/** Track last price for corrupt data detection */
let lastKnownPrice: number | null = null;

/** Track last news sentiment for shock detection */
let lastNewsSentiment: number | null = null;

/** Current tracked price for corrupt data detection (no-arg mode) */
let currentTrackedPrice: number | null = null;

/** Current tracked sentiment for news shock detection (no-arg mode) */
let currentTrackedSentiment: number | null = null;

/** Current ATR as % of price for extreme volatility detection */
let currentTrackedAtrPct: number | null = null;

/** Normal/baseline ATR as % of price */
let normalTrackedAtrPct: number | null = null;

/** Current tracked spread as % of price */
let currentTrackedSpreadPct: number | null = null;

// Track historical prices for market crash detection
interface PricePoint {
  timestamp: number;
  price: number;
}
const marketPriceHistory: PricePoint[] = [];

// ── Initialize agent state ──────────────────────────────────────────

function ensureAgentState(chainId: string): AgentRiskState {
  if (!agentRisk[chainId]) {
    const agent = AGENTS[chainId];
    const chain = CHAINS.find((c) => c.id === chainId);
    const initialValue = 10_000 + Math.random() * 40_000;
    agentRisk[chainId] = {
      chainId,
      agentName: agent?.name ?? "Unknown",
      icon: agent?.icon ?? "🤖",
      peakValue: initialValue,
      currentValue: initialValue,
      drawdownPct: 0,
      exposureUsd: initialValue * 0.5,
      volatilityPct: Math.random() * 5,
      riskScore: 3 + Math.floor(Math.random() * 4),
      status: "active",
      lastUpdated: Date.now(),
    };
  }
  return agentRisk[chainId];
}

// Initialize all agents
for (const chain of CHAINS) {
  ensureAgentState(chain.id);
}

// ── Market price tracking ───────────────────────────────────────────

/** Record a market price snapshot for crash detection */
export function recordMarketPrice(price: number): void {
  const now = Date.now();
  marketPriceHistory.push({ timestamp: now, price });

  // Keep only last 2 hours
  const cutoff = now - 2 * 60 * 60 * 1000;
  while (marketPriceHistory.length > 0 && marketPriceHistory[0].timestamp < cutoff) {
    marketPriceHistory.shift();
  }

  // Check for crash: >15% drop in 1 hour
  const oneHourAgo = now - 60 * 60 * 1000;
  const oldPoints = marketPriceHistory.filter((p) => p.timestamp <= oneHourAgo);
  if (oldPoints.length > 0) {
    const oldPrice = oldPoints[oldPoints.length - 1].price;
    if (oldPrice > 0) {
      marketDropPct = ((oldPrice - price) / oldPrice) * 100;
      lastMarketCheck = now;

      if (marketDropPct >= currentLimits.marketCrashThresholdPct && !circuitBreakerTripped) {
        circuitBreakerTripped = true;
        circuitBreakerReason = `Market drop of ${marketDropPct.toFixed(1)}% detected (>${currentLimits.marketCrashThresholdPct}% threshold in 1h)`;

        // Pause all agents
        for (const state of Object.values(agentRisk)) {
          if (state.status === "active") {
            state.status = "paused";
            state.pauseReason = "Circuit breaker: market crash";
            state.lastUpdated = now;
          }
        }

        // Emit circuit breaker event
        agentBus.emit("activity", {
          activity: {
            id: `circuit-breaker-${now}`,
            chainId: "system",
            agentName: "Circuit Breaker",
            action: circuitBreakerReason,
            timestamp: now,
            type: "info",
          },
        });

        // DB: persist circuit breaker state
        persistRiskSystemState();
      }

      // Auto-recover if market recovers (drop < 5%)
      if (circuitBreakerTripped && marketDropPct < 5) {
        circuitBreakerTripped = false;
        circuitBreakerReason = "";
        agentBus.emit("activity", {
          activity: {
            id: `circuit-recover-${now}`,
            chainId: "system",
            agentName: "Circuit Breaker",
            action: `Circuit breaker reset — market recovered (drop now ${marketDropPct.toFixed(1)}%)`,
            timestamp: now,
            type: "info",
          },
        });

        // DB: persist circuit breaker recovery
        persistRiskSystemState();
      }
    }
  }
}

// ── Risk Score Calculation ──────────────────────────────────────────

/** Calculate risk score (1-10) from drawdown, volatility, and exposure */
function calculateRiskScore(drawdownPct: number, volatilityPct: number, exposureRatio: number): number {
  // Drawdown component: 0-4 points
  const ddScore = Math.min(4, (drawdownPct / currentLimits.maxDrawdownPct) * 4);

  // Volatility component: 0-3 points
  const volScore = Math.min(3, volatilityPct / 10 * 3);

  // Exposure component: 0-3 points
  const expScore = Math.min(3, exposureRatio * 3);

  return Math.round(Math.min(10, Math.max(1, ddScore + volScore + expScore)));
}

// ── Core: Update Risk Metrics ───────────────────────────────────────

/**
 * Persist risk_system_state to DB. Fire-and-forget.
 */
function persistRiskSystemState(): void {
  if (!isDbAvailable()) return;
  sql`
    INSERT INTO risk_system_state (id, circuit_breaker_tripped, circuit_breaker_reason, market_drop_pct, last_market_check, total_exposure, overall_risk_score, updated_at)
    VALUES (1, ${circuitBreakerTripped}, ${circuitBreakerReason || null}, ${marketDropPct}, ${lastMarketCheck > 0 ? new Date(lastMarketCheck).toISOString() : null}, ${0}, ${5}, now())
    ON CONFLICT (id) DO UPDATE SET
      circuit_breaker_tripped = EXCLUDED.circuit_breaker_tripped,
      circuit_breaker_reason = EXCLUDED.circuit_breaker_reason,
      market_drop_pct = EXCLUDED.market_drop_pct,
      last_market_check = EXCLUDED.last_market_check,
      updated_at = EXCLUDED.updated_at
  `.catch((err) => console.error("[DB] persistRiskSystemState UPSERT failed:", err));
}

/**
 * Called after each agent scan to update risk metrics.
 * Hook into agent-runner's internalScan.
 */
export async function updateRiskMetrics(
  chainId: string,
  options?: {
    currentValue?: number;
    volatilityPct?: number;
  }
): Promise<AgentRiskState> {
  const state = ensureAgentState(chainId);
  const now = Date.now();

  if (options?.currentValue !== undefined) {
    state.currentValue = options.currentValue;
    if (state.currentValue > state.peakValue) {
      state.peakValue = state.currentValue;
    }
  }

  // Simulate slight value fluctuations for demo
  const noise = (Math.random() - 0.5) * 500;
  state.currentValue = Math.max(0, state.currentValue + noise);
  if (state.currentValue > state.peakValue) {
    state.peakValue = state.currentValue;
  }

  // Update volatility
  state.volatilityPct = options?.volatilityPct ?? (1 + Math.random() * 6);

  // Calculate drawdown
  state.drawdownPct = state.peakValue > 0
    ? ((state.peakValue - state.currentValue) / state.peakValue) * 100
    : 0;

  // Exposure: random allocation between 20-80% of current value
  state.exposureUsd = state.currentValue * (0.2 + Math.random() * 0.6);
  if (state.exposureUsd > currentLimits.maxExposurePerChain) {
    state.exposureUsd = currentLimits.maxExposurePerChain;
  }

  // Risk score
  const exposureRatio = currentLimits.maxExposurePerChain > 0
    ? state.exposureUsd / currentLimits.maxExposurePerChain
    : 0;
  state.riskScore = calculateRiskScore(state.drawdownPct, state.volatilityPct, exposureRatio);

  // Auto-pause if drawdown exceeds threshold
  if (state.drawdownPct >= currentLimits.maxDrawdownPct && state.status === "active") {
    state.status = "paused";
    state.pauseReason = `Drawdown ${state.drawdownPct.toFixed(1)}% exceeded limit ${currentLimits.maxDrawdownPct}%`;
    agentBus.emit("activity", {
      activity: {
        id: `risk-pause-${chainId}-${now}`,
        chainId,
        agentName: state.agentName,
        action: state.pauseReason,
        timestamp: now,
        type: "info",
      },
    });
  }

  // Auto-pause if risk score too high
  if (state.riskScore > currentLimits.maxRiskScore && state.status === "active") {
    state.status = "paused";
    state.pauseReason = `Risk score ${state.riskScore} exceeded max ${currentLimits.maxRiskScore}`;
    agentBus.emit("activity", {
      activity: {
        id: `risk-pause-score-${chainId}-${now}`,
        chainId,
        agentName: state.agentName,
        action: state.pauseReason,
        timestamp: now,
        type: "info",
      },
    });
  }

  state.lastUpdated = now;

  // Write-through to DB: UPSERT risk_states
  if (isDbAvailable()) {
    sql`
      INSERT INTO risk_states (chain_id, agent_name, peak_value, current_value, drawdown_pct, exposure_usd, volatility_pct, risk_score, status, pause_reason, updated_at)
      VALUES (${chainId}, ${state.agentName}, ${state.peakValue}, ${state.currentValue}, ${state.drawdownPct}, ${state.exposureUsd}, ${state.volatilityPct}, ${state.riskScore}, ${state.status}, ${state.pauseReason ?? null}, now())
      ON CONFLICT (chain_id) DO UPDATE SET
        agent_name = EXCLUDED.agent_name,
        peak_value = EXCLUDED.peak_value,
        current_value = EXCLUDED.current_value,
        drawdown_pct = EXCLUDED.drawdown_pct,
        exposure_usd = EXCLUDED.exposure_usd,
        volatility_pct = EXCLUDED.volatility_pct,
        risk_score = EXCLUDED.risk_score,
        status = EXCLUDED.status,
        pause_reason = EXCLUDED.pause_reason,
        updated_at = EXCLUDED.updated_at
    `.catch((err) => console.error("[DB] updateRiskMetrics UPSERT failed:", err));
  }

  return state;
}

// ── Core: Check Risk Before Dispatch ────────────────────────────────

/**
 * Called before the orchestrator dispatcher executes a task.
 * Returns { allowed: boolean, reason?: string }
 */
export async function checkRiskLimits(
  chainId: string,
  amount?: number
): Promise<{ allowed: boolean; reason?: string }> {
  const state = ensureAgentState(chainId);

  // Circuit breaker check
  if (circuitBreakerTripped) {
    return { allowed: false, reason: `Circuit breaker active: ${circuitBreakerReason}` };
  }

  // Agent paused check
  if (state.status !== "active") {
    return { allowed: false, reason: `Agent paused: ${state.pauseReason ?? "unknown reason"}` };
  }

  // Exposure check
  if (amount !== undefined) {
    const newExposure = state.exposureUsd + amount;
    if (newExposure > currentLimits.maxExposurePerChain) {
      return {
        allowed: false,
        reason: `Exposure $${newExposure.toLocaleString()} would exceed limit $${currentLimits.maxExposurePerChain.toLocaleString()}`,
      };
    }
  }

  return { allowed: true };
}

// ── Stop-Loss Check ─────────────────────────────────────────────────

/**
 * Check if a position should be auto-exited based on stop-loss.
 */
export function checkStopLoss(chainId: string, positionLossPct: number): boolean {
  return positionLossPct >= currentLimits.stopLossPct;
}

// ── Kill Switch: Emergency Triggers ──────────────────────────────────

/**
 * Update API health check timestamp. Call this whenever Binance WS or
 * CoinGecko returns a successful response.
 */
export function markApiHealthy(): void {
  lastApiHealthCheck = Date.now();
}

/**
 * Check if APIs have been unavailable for too long.
 * Returns true if both Binance WS + CoinGecko have been silent for > 60s.
 */
export function isApiUnavailable(): boolean {
  const elapsed = Date.now() - lastApiHealthCheck;
  return elapsed > 60_000;
}

/**
 * Record the latest known good price for corrupt data detection.
 */
export function recordLastPrice(price: number): void {
  lastKnownPrice = price;
}

/**
 * Check for corrupt data: price changes > 50% in one tick.
 * If called with no argument, uses internally tracked current price (from recordCurrentPrice).
 */
export function isCorruptData(currentPrice?: number): boolean {
  const price = currentPrice ?? currentTrackedPrice;
  if (price === null || lastKnownPrice === null || lastKnownPrice <= 0) return false;
  const changePct = Math.abs((price - lastKnownPrice) / lastKnownPrice) * 100;
  return changePct > 50;
}

/**
 * Record the current tracked price for no-arg corrupt data checks.
 */
export function recordCurrentPrice(price: number): void {
  currentTrackedPrice = price;
}

/**
 * Record latest news sentiment for shock detection.
 * Call after each news sentiment update.
 */
export function recordNewsSentiment(sentiment: number): void {
  lastNewsSentiment = sentiment;
}

/**
 * Record the current tracked sentiment for no-arg news shock checks.
 */
export function recordCurrentSentiment(sentiment: number): void {
  currentTrackedSentiment = sentiment;
}

/**
 * Check for unexpected news: sentiment swung > 80% negative in one update.
 * If called with no argument, uses internally tracked sentiment (from recordCurrentSentiment).
 */
export function isNewsShock(currentSentiment?: number): boolean {
  const sentiment = currentSentiment ?? currentTrackedSentiment;
  if (lastNewsSentiment === null || sentiment === null) return false;
  const swing = lastNewsSentiment - sentiment;
  return swing > 80;
}

/**
 * Check for extreme volatility: ATR spikes > 5x normal.
 * If called with no arguments, uses internally tracked ATR values (from recordAtr).
 * @param currentAtrPct Current ATR as % of price
 * @param normalAtrPct Baseline/normal ATR as % of price
 */
export function isExtremeVolatility(currentAtrPct?: number, normalAtrPct?: number): boolean {
  const atr = currentAtrPct ?? currentTrackedAtrPct;
  const normal = normalAtrPct ?? normalTrackedAtrPct;
  if (atr === null || normal === null || normal <= 0) return false;
  return atr > normal * 5;
}

/**
 * Record current ATR values for no-arg extreme volatility checks.
 */
export function recordAtr(currentAtrPct: number, normalAtrPct: number): void {
  currentTrackedAtrPct = currentAtrPct;
  normalTrackedAtrPct = normalAtrPct;
}

/**
 * Check for massive spread on major pairs.
 * If called with no argument, uses internally tracked spread (from recordSpread).
 * @param spreadPct Bid/ask spread as % of price
 */
export function isMassiveSpread(spreadPct?: number): boolean {
  const spread = spreadPct ?? currentTrackedSpreadPct;
  if (spread === null) return false;
  return spread > 5;
}

/**
 * Record current spread for no-arg massive spread checks.
 */
export function recordSpread(spreadPct: number): void {
  currentTrackedSpreadPct = spreadPct;
}

/**
 * Activate the kill switch. Closes all positions, sets circuitBreakerTripped,
 * logs reason with timestamp, sends alert via agent bus.
 * Must be called synchronously — no async operations inside.
 */
export function activateKillSwitch(reason: string): void {
  if (killSwitchTripped) return; // Already tripped

  killSwitchTripped = true;
  killSwitchReason = reason;
  killSwitchTimestamp = Date.now();

  // Also trip the circuit breaker
  circuitBreakerTripped = true;
  circuitBreakerReason = `KILL SWITCH: ${reason}`;

  // Pause all agents
  const now = Date.now();
  for (const state of Object.values(agentRisk)) {
    if (state.status === "active") {
      state.status = "paused";
      state.pauseReason = `Kill switch: ${reason}`;
      state.lastUpdated = now;
    }
  }

  // Emit activity event for alerting
  agentBus.emit("activity", {
    activity: {
      id: `kill-switch-${now}`,
      chainId: "system",
      agentName: "Kill Switch",
      action: `KILL SWITCH ACTIVATED: ${reason}`,
      timestamp: now,
      type: "info",
    },
  });

  console.error(`[KILL SWITCH] ACTIVATED at ${new Date(now).toISOString()}: ${reason}`);

  // Persist
  persistRiskSystemState();
}

// ── Kill Switch Server Functions ─────────────────────────────────────

/**
 * Manually trigger the kill switch. Closes all positions and halts all trading.
 * Requires manual resetKillSwitch() to resume.
 */
export const triggerKillSwitch = createServerFn({ method: "POST" }).handler(async ({
  data,
}: {
  data: { reason: string };
}): Promise<{ success: boolean; reason: string }> => {
  if (killSwitchTripped) {
    return { success: false, reason: "Kill switch already active" };
  }
  activateKillSwitch(data.reason);
  return { success: true, reason: `Kill switch activated: ${data.reason}` };
});

/**
 * Reset the kill switch. Manual override to resume trading after a kill switch event.
 * Only resets the kill switch — circuit breaker state is separately managed.
 */
export const resetKillSwitch = createServerFn({ method: "POST" }).handler(async (): Promise<{
  success: boolean;
  reason: string;
}> => {
  if (!killSwitchTripped) {
    return { success: false, reason: "Kill switch is not active" };
  }

  killSwitchTripped = false;
  killSwitchReason = "";
  killSwitchTimestamp = 0;

  // Reset circuit breaker that was tripped by kill switch
  if (circuitBreakerReason.startsWith("KILL SWITCH:")) {
    circuitBreakerTripped = false;
    circuitBreakerReason = "";
  }

  const now = Date.now();
  agentBus.emit("activity", {
    activity: {
      id: `kill-switch-reset-${now}`,
      chainId: "system",
      agentName: "Kill Switch",
      action: "Kill switch manually reset — trading resumed",
      timestamp: now,
      type: "info",
    },
  });

  persistRiskSystemState();

  return { success: true, reason: "Kill switch reset successfully. Trading resumed." };
});

/**
 * Get kill switch state (for external checks).
 */
export function isKillSwitchActive(): boolean {
  return killSwitchTripped || circuitBreakerTripped;
}

export function getKillSwitchReason(): string {
  return killSwitchTripped ? killSwitchReason : circuitBreakerReason;
}

/**
 * Unified kill switch monitoring check. Calls all individual trigger checks synchronously.
 * No async operations, no API calls — all checks read from internally tracked state.
 * Returns immediately on first tripped trigger (short-circuit).
 */
export function runKillSwitchChecks(): { tripped: boolean; trigger?: string } {
  if (killSwitchTripped) return { tripped: false };

  if (isApiUnavailable()) {
    activateKillSwitch("API unavailable: no data for >60s");
    return { tripped: true, trigger: "API_UNAVAILABLE" };
  }
  if (isCorruptData()) {
    activateKillSwitch("Corrupt data: price moved >50% in one tick");
    return { tripped: true, trigger: "CORRUPT_DATA" };
  }
  if (isMassiveSpread()) {
    activateKillSwitch("Massive spread detected");
    return { tripped: true, trigger: "MASSIVE_SPREAD" };
  }
  if (isExtremeVolatility()) {
    activateKillSwitch("Extreme volatility: ATR >5x normal");
    return { tripped: true, trigger: "EXTREME_VOLATILITY" };
  }
  if (isNewsShock()) {
    activateKillSwitch("News shock: sentiment swing >80 points");
    return { tripped: true, trigger: "NEWS_SHOCK" };
  }

  return { tripped: false };
}

// ── Server Functions ────────────────────────────────────────────────

/**
 * Get full risk system state. Exported as raw function for loader use
 * and as createServerFn for client RPC.
 */
export async function getRiskStateRaw(): Promise<RiskSystemState> {
  // Update all agent states to ensure freshness
  const agents: Record<string, AgentRiskState> = {};
  let activeCount = 0;
  let pausedCount = 0;

  for (const chain of CHAINS) {
    const state = ensureAgentState(chain.id);
    agents[chain.id] = { ...state };
    if (state.status === "active") activeCount++;
    if (state.status === "paused") pausedCount++;
  }

  // Total exposure
  const totalExposure = Object.values(agents).reduce((sum, a) => sum + a.exposureUsd, 0);

  // Overall risk score (weighted average)
  const overallRiskScore = Object.values(agents).length > 0
    ? Math.round(Object.values(agents).reduce((sum, a) => sum + a.riskScore, 0) / Object.values(agents).length)
    : 5;

  return {
    limits: { ...currentLimits },
    agents,
    circuitBreakerTripped,
    circuitBreakerReason,
    killSwitchTripped,
    killSwitchReason,
    marketDropPct,
    lastMarketCheck,
    totalExposure,
    activeAgentCount: activeCount,
    pausedAgentCount: pausedCount,
    overallRiskScore,
    lastUpdated: Date.now(),
  };
}

export const getRiskState = createServerFn({ method: "GET" }).handler(async (): Promise<RiskSystemState> => {
  return getRiskStateRaw();
});

/** Set risk limits */
export const setRiskLimits = createServerFn({ method: "POST" }).handler(async ({
  data,
}: {
  data: { limits: Partial<RiskLimits> };
}): Promise<{ success: boolean; limits: RiskLimits }> => {
  currentLimits = { ...currentLimits, ...data.limits };
  return { success: true, limits: { ...currentLimits } };
});

/** Reset the circuit breaker */
export const resetCircuitBreaker = createServerFn({ method: "POST" }).handler(async (): Promise<{
  success: boolean;
  reason: string;
}> => {
  if (!circuitBreakerTripped) {
    return { success: false, reason: "Circuit breaker is not tripped" };
  }
  circuitBreakerTripped = false;
  circuitBreakerReason = "";

  persistRiskSystemState();

  const now = Date.now();
  agentBus.emit("activity", {
    activity: {
      id: `circuit-reset-${now}`,
      chainId: "system",
      agentName: "Circuit Breaker",
      action: "Circuit breaker manually reset by user",
      timestamp: now,
      type: "info",
    },
  });

  return { success: true, reason: "Circuit breaker reset successfully" };
});

/** Pause or resume a specific agent */
export const toggleAgentRiskStatus = createServerFn({ method: "POST" }).handler(async ({
  data,
}: {
  data: { chainId: string; status: "active" | "paused" };
}): Promise<AgentRiskState> => {
  const state = ensureAgentState(data.chainId);
  state.status = data.status;
  state.pauseReason = data.status === "paused" ? "Manually paused by user" : undefined;
  state.lastUpdated = Date.now();

  const now = Date.now();
  agentBus.emit("activity", {
    activity: {
      id: `risk-toggle-${data.chainId}-${now}`,
      chainId: data.chainId,
      agentName: state.agentName,
      action: data.status === "paused"
        ? `Agent ${state.agentName} paused by user`
        : `Agent ${state.agentName} resumed by user`,
      timestamp: now,
      type: "info",
    },
  });

  // DB: persist risk state update
  if (isDbAvailable()) {
    sql`
      INSERT INTO risk_states (chain_id, agent_name, peak_value, current_value, drawdown_pct, exposure_usd, volatility_pct, risk_score, status, pause_reason, updated_at)
      VALUES (${state.chainId}, ${state.agentName}, ${state.peakValue}, ${state.currentValue}, ${state.drawdownPct}, ${state.exposureUsd}, ${state.volatilityPct}, ${state.riskScore}, ${state.status}, ${state.pauseReason ?? null}, now())
      ON CONFLICT (chain_id) DO UPDATE SET
        agent_name = EXCLUDED.agent_name,
        status = EXCLUDED.status,
        pause_reason = EXCLUDED.pause_reason,
        updated_at = EXCLUDED.updated_at
    `.catch((err) => console.error("[DB] toggleAgentRiskStatus UPSERT failed:", err));
  }

  return { ...state };
});

/** Simulate a market crash for testing */
export const simulateMarketCrash = createServerFn({ method: "POST" }).handler(async ({
  data,
}: {
  data: { dropPct: number };
}): Promise<{ success: boolean }> => {
  const now = Date.now();
  // Add a high price point 30 minutes ago
  marketPriceHistory.push({ timestamp: now - 30 * 60 * 1000, price: 100 });
  // Add current crashed price
  const crashedPrice = 100 * (1 - data.dropPct / 100);
  marketPriceHistory.push({ timestamp: now, price: crashedPrice });
  recordMarketPrice(crashedPrice);
  return { success: true };
});

/** Get limits (raw, for loader) */
export async function getLimitsRaw(): Promise<RiskLimits> {
  return { ...currentLimits };
}
