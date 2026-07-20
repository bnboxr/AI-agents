// ── Anti-Drain Protection ────────────────────────────────────────────
// Enforces strict risk rules for agent training on testnets.
// "Din ce are să facă profit, nu drain."
//
// Core rules:
//   MAX_POSITION_SIZE_PCT: 0.05     — Max 5% of balance per trade
//   MAX_DAILY_DRAWDOWN_PCT: 0.15    — Max 15% loss in 24h → stop
//   CONSECUTIVE_LOSS_LIMIT: 3       — 3 losses in a row → stop 24h
//   PROFIT_LOCK_PCT: 0.10           — At 10% profit → lock half
//   MIN_CONFIDENCE_THRESHOLD: 65    — Confidence below 65% → skip
//
// Size scaling tiers:
//   STARTER: 2% max — first 10 trades
//   PROVING: 3% max — 10-25 trades with 60%+ win rate
//   TRUSTED: 5% max — 25+ trades with 70%+ win rate (never more)

import { sql, isDbAvailable } from "./db";

// ── Constants ────────────────────────────────────────────────────────

export const ANTI_DRAIN_RULES = {
  MAX_POSITION_SIZE_PCT: 0.05,
  MAX_DAILY_DRAWDOWN_PCT: 0.15,
  CONSECUTIVE_LOSS_LIMIT: 3,
  PROFIT_LOCK_PCT: 0.10,
  MIN_CONFIDENCE_THRESHOLD: 65,
  SIZE_SCALING: {
    STARTER: { maxPct: 0.02, minTrades: 0, minWinRate: 0 },
    PROVING: { maxPct: 0.03, minTrades: 10, minWinRate: 0.60 },
    TRUSTED: { maxPct: 0.05, minTrades: 25, minWinRate: 0.70 },
  },
} as const;

export type SizeTier = "STARTER" | "PROVING" | "TRUSTED";

// ── Types ────────────────────────────────────────────────────────────

export interface TradeValidation {
  allowed: boolean;
  reason?: string;
  maxSize?: number;
  tier?: SizeTier;
}

export interface DailyDrawdown {
  blocked: boolean;
  remainingPct: number;
  peakBalance: number;
  currentBalance: number;
}

export interface AntiDrainState {
  chainId: string;
  consecutiveLosses: number;
  consecutiveWins: number;
  totalTrades: number;
  winRate: number;
  peakBalance: number;
  currentBalance: number;
  initialBalance?: number;
  dailyDrawdownPct: number;
  profitLocked: number;
  blockedUntil: number;  // 0 = not blocked
  tier: SizeTier;
}

// ── In-memory state ──────────────────────────────────────────────────

const stateCache = new Map<string, AntiDrainState>();

const TIMESTAMP_24H_MS = 24 * 60 * 60 * 1000;

// ── State Management ─────────────────────────────────────────────────

function getDefaultState(chainId: string): AntiDrainState {
  return {
    chainId,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    totalTrades: 0,
    winRate: 0,
    peakBalance: 0,
    currentBalance: 0,
    dailyDrawdownPct: 0,
    profitLocked: 0,
    blockedUntil: 0,
    tier: "STARTER",
  };
}

export function getAntiDrainState(chainId: string): AntiDrainState {
  const existing = stateCache.get(chainId);
  if (existing) return existing;
  const def = getDefaultState(chainId);
  stateCache.set(chainId, def);
  return def;
}

export function setAntiDrainState(chainId: string, state: Partial<AntiDrainState>): AntiDrainState {
  const current = getAntiDrainState(chainId);
  const updated = { ...current, ...state };
  stateCache.set(chainId, updated);
  return updated;
}

/** Initialize state with a balance (called after faucet claim or first deposit) */
export function initAntiDrain(chainId: string, balance: number): AntiDrainState {
  const state = getAntiDrainState(chainId);
  state.currentBalance = balance;
  if (state.initialBalance === undefined || state.initialBalance === 0) {
    state.initialBalance = balance;
  }
  if (balance > state.peakBalance) {
    state.peakBalance = balance;
  }
  stateCache.set(chainId, state);
  return state;
}

// ── Core Validation ─────────────────────────────────────────────────

/**
 * Validate a trade before execution.
 * Returns { allowed: boolean, reason?: string }
 */
export function validateTrade(
  balance: number,
  size: number,
  confidence: number,
  chainId?: string,
): TradeValidation {
  const state = chainId ? getAntiDrainState(chainId) : getDefaultState("unknown");

  // 1. Check if blocked
  if (state.blockedUntil > 0 && Date.now() < state.blockedUntil) {
    const remainingMs = state.blockedUntil - Date.now();
    const remainingHrs = Math.ceil(remainingMs / (60 * 60 * 1000));
    return {
      allowed: false,
      reason: `Anti-drain block active — ${remainingHrs}h remaining. Consecutive losses: ${state.consecutiveLosses}`,
    };
  }

  // 2. Check confidence threshold
  if (confidence < ANTI_DRAIN_RULES.MIN_CONFIDENCE_THRESHOLD) {
    return {
      allowed: false,
      reason: `Confidence ${confidence}% below ${ANTI_DRAIN_RULES.MIN_CONFIDENCE_THRESHOLD}% minimum`,
      maxSize: getMaxPositionSize(balance, state.totalTrades, state.winRate),
      tier: state.tier,
    };
  }

  // 3. Check max position size
  const maxSize = getMaxPositionSize(balance, state.totalTrades, state.winRate);
  if (size > maxSize) {
    return {
      allowed: false,
      reason: `Position size ${(size / balance * 100).toFixed(1)}% exceeds ${(maxSize / balance * 100).toFixed(1)}% maximum (${state.tier} tier)`,
      maxSize,
      tier: state.tier,
    };
  }

  // 4. Check daily drawdown
  const drawdown = checkDailyDrawdown(chainId ?? "unknown");
  if (drawdown.blocked) {
    return {
      allowed: false,
      reason: `Daily drawdown limit reached: ${drawdown.remainingPct.toFixed(1)}% remaining`,
      maxSize,
      tier: state.tier,
    };
  }

  // 5. Check profit lock (don't trade into locked profit)
  if (state.profitLocked > 0 && (balance - size) < state.profitLocked) {
    return {
      allowed: false,
      reason: `Trade would eat into locked profit ($${state.profitLocked.toFixed(2)} locked)`,
      maxSize: Math.min(maxSize, balance - state.profitLocked),
      tier: state.tier,
    };
  }

  return { allowed: true, maxSize, tier: state.tier };
}

/**
 * Get maximum position size based on trade count and win rate.
 * Scales through three tiers as agents prove themselves.
 */
export function getMaxPositionSize(
  balance: number,
  tradeCount: number,
  winRate: number,
): number {
  const { STARTER, PROVING, TRUSTED } = ANTI_DRAIN_RULES.SIZE_SCALING;

  if (tradeCount >= TRUSTED.minTrades && winRate >= TRUSTED.minWinRate) {
    return balance * TRUSTED.maxPct;
  }
  if (tradeCount >= PROVING.minTrades && winRate >= PROVING.minWinRate) {
    return balance * PROVING.maxPct;
  }
  return balance * STARTER.maxPct;
}

/** Get the current size tier label */
export function getSizeTier(tradeCount: number, winRate: number): SizeTier {
  const { STARTER, PROVING, TRUSTED } = ANTI_DRAIN_RULES.SIZE_SCALING;
  if (tradeCount >= TRUSTED.minTrades && winRate >= TRUSTED.minWinRate) return "TRUSTED";
  if (tradeCount >= PROVING.minTrades && winRate >= PROVING.minWinRate) return "PROVING";
  return "STARTER";
}

/**
 * Check daily drawdown status for a chain.
 * Returns { blocked, remainingPct }.
 */
export function checkDailyDrawdown(chainId: string): DailyDrawdown {
  const state = getAntiDrainState(chainId);
  const { peakBalance, currentBalance } = state;

  if (peakBalance <= 0) {
    return { blocked: false, remainingPct: 100, peakBalance, currentBalance };
  }

  const drawdown = (peakBalance - currentBalance) / peakBalance;
  const remainingPct = Math.max(
    0,
    (ANTI_DRAIN_RULES.MAX_DAILY_DRAWDOWN_PCT - drawdown) * 100,
  );

  return {
    blocked: drawdown >= ANTI_DRAIN_RULES.MAX_DAILY_DRAWDOWN_PCT,
    remainingPct,
    peakBalance,
    currentBalance,
  };
}

/**
 * Record a trade result and update anti-drain state accordingly.
 * Call after each trade execution.
 */
export function recordTradeResult(
  chainId: string,
  pnl: number,
  balance: number,
): AntiDrainState {
  const state = getAntiDrainState(chainId);
  state.totalTrades++;

  // Update PnL tracking
  if (pnl > 0) {
    state.consecutiveWins++;
    state.consecutiveLosses = 0;
  } else if (pnl < 0) {
    state.consecutiveLosses++;
    state.consecutiveWins = 0;
  }

  // Update win rate
  const wins = state.totalTrades - state.consecutiveLosses; // approximate
  state.winRate = state.totalTrades > 0 ? wins / state.totalTrades : 0;

  // Update balance and peak
  state.currentBalance = balance;
  if (balance > state.peakBalance) {
    state.peakBalance = balance;
  }

  // Check and lock profits
  if (
    state.peakBalance > 0 &&
    (balance - state.peakBalance * (1 - ANTI_DRAIN_RULES.PROFIT_LOCK_PCT)) > 0 &&
    state.profitLocked === 0
  ) {
    lockProfit(chainId, balance);
  }

  // Check consecutive loss limit
  if (state.consecutiveLosses >= ANTI_DRAIN_RULES.CONSECUTIVE_LOSS_LIMIT) {
    state.blockedUntil = Date.now() + TIMESTAMP_24H_MS;
    console.warn(
      `[AntiDrain] Chain ${chainId}: BLOCKED for 24h — ${state.consecutiveLosses} consecutive losses`,
    );
  } else {
    state.blockedUntil = 0;
  }

  // Update tier
  state.tier = getSizeTier(state.totalTrades, state.winRate);

  stateCache.set(chainId, state);
  persistAntiDrainState(state);
  return state;
}

/**
 * Lock half of the profit when 10% profit threshold is reached.
 * Locked profit cannot be lost on subsequent trades.
 */
export function lockProfit(chainId: string, currentBalance: number): number {
  const state = getAntiDrainState(chainId);
  if (state.peakBalance <= 0 || state.initialBalance === undefined) {
    state.initialBalance = currentBalance;
  }

  const initialBal = state.initialBalance ?? currentBalance;
  const profit = currentBalance - initialBal;

  if (profit > 0 && profit / initialBal >= ANTI_DRAIN_RULES.PROFIT_LOCK_PCT) {
    const lockAmount = profit / 2;
    state.profitLocked = lockAmount;
    console.log(
      `[AntiDrain] Chain ${chainId}: Profit locked — $${lockAmount.toFixed(2)} (${(lockAmount / currentBalance * 100).toFixed(1)}% of balance)`,
    );
    stateCache.set(chainId, state);
    return lockAmount;
  }
  return 0;
}

/** Reset daily drawdown tracking (call every 24h) */
export function resetDailyDrawdown(chainId: string): void {
  const state = getAntiDrainState(chainId);
  state.peakBalance = state.currentBalance;
  state.dailyDrawdownPct = 0;
  stateCache.set(chainId, state);
}

/** Get all chain anti-drain states */
export function getAllAntiDrainStates(): AntiDrainState[] {
  return Array.from(stateCache.values());
}

// ── DB Persistence ───────────────────────────────────────────────────

async function persistAntiDrainState(state: AntiDrainState): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    await sql`
      INSERT INTO anti_drain_state (chain_id, consecutive_losses, consecutive_wins,
        total_trades, win_rate, peak_balance, current_balance, daily_drawdown_pct,
        profit_locked, blocked_until, tier, updated_at)
      VALUES (${state.chainId}, ${state.consecutiveLosses}, ${state.consecutiveWins},
        ${state.totalTrades}, ${state.winRate}, ${state.peakBalance}, ${state.currentBalance},
        ${state.dailyDrawdownPct}, ${state.profitLocked}, ${state.blockedUntil},
        ${state.tier}, now())
      ON CONFLICT (chain_id) DO UPDATE SET
        consecutive_losses = EXCLUDED.consecutive_losses,
        consecutive_wins = EXCLUDED.consecutive_wins,
        total_trades = EXCLUDED.total_trades,
        win_rate = EXCLUDED.win_rate,
        peak_balance = EXCLUDED.peak_balance,
        current_balance = EXCLUDED.current_balance,
        daily_drawdown_pct = EXCLUDED.daily_drawdown_pct,
        profit_locked = EXCLUDED.profit_locked,
        blocked_until = EXCLUDED.blocked_until,
        tier = EXCLUDED.tier,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (err) {
    console.warn("[AntiDrain] persist failed:", err);
  }
}

/** Load anti-drain states from DB */
export async function loadAntiDrainFromDb(): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    const result = await sql.query("SELECT * FROM anti_drain_state");
    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      const state: AntiDrainState = {
        chainId: r.chain_id as string,
        consecutiveLosses: (r.consecutive_losses as number) ?? 0,
        consecutiveWins: (r.consecutive_wins as number) ?? 0,
        totalTrades: (r.total_trades as number) ?? 0,
        winRate: (r.win_rate as number) ?? 0,
        peakBalance: (r.peak_balance as number) ?? 0,
        currentBalance: (r.current_balance as number) ?? 0,
        dailyDrawdownPct: (r.daily_drawdown_pct as number) ?? 0,
        profitLocked: (r.profit_locked as number) ?? 0,
        blockedUntil: (r.blocked_until as number) ?? 0,
        tier: (r.tier as SizeTier) ?? "STARTER",
      };
      stateCache.set(state.chainId, state);
    }
    console.log(`[AntiDrain] Loaded ${result.rows.length} states from DB`);
  } catch (err) {
    console.warn("[AntiDrain] loadFromDb failed:", err);
  }
}
