import { createServerFn } from "@tanstack/react-start";
import { CHAINS } from "./chains";
import { AGENTS } from "./agents";
import { agentBus } from "./agent-bus";

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
