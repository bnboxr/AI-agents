// ── Capital Manager ───────────────────────────────────────────────
// Tracks trading capital, profit, and owner payout.
// Profit split: 90% → owner payout, 10% → reinvested into trading capital.
// Losses are absorbed by trading capital only, down to initial floor.
//
// pSOL Auto-Staking: when payout > 0.01 SOL, auto-stake into Marinade.
//
// LIVE MODE: Loads STARTING_CAPITAL from env (default $1,000,000).
// Verifies real exchange balance on startup.

import { triggerAutoStake, getPSolState, compoundYield, type PSolStakingState } from "./staking/psol";

interface CapitalState {
  trading: number;
  initial: number;
  profit: number;
  payout: number;
  /** Whether we verified exchange balance on startup */
  balanceVerified: boolean;
  /** Exchange-reported balance (if available) */
  exchangeBalance: number | null;
}

/** Load starting capital from env or default to $1,000,000 */
function loadStartingCapital(): number {
  try {
    const envVal =
      typeof process !== "undefined" && process.env?.STARTING_CAPITAL;
    if (envVal) {
      const parsed = parseFloat(envVal);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (err) {
    console.warn("[CapitalManager] loadStartingCapital failed:", err);
    // env not available
  }
  return 1_000_000;
}

const initialCapital = loadStartingCapital();

let state: CapitalState = {
  trading: initialCapital,
  initial: initialCapital,
  profit: 0,
  payout: 0,
  balanceVerified: false,
  exchangeBalance: null,
};

/** Track whether we've already staked the current payout (prevents duplicate stakes) */
let stakedPayout: number = 0;

export function getCapitalState(): CapitalState {
  return { ...state };
}

/**
 * Get combined capital + staking state for dashboard display.
 */
export function getCapitalAndStakingState(): CapitalState & { staking: PSolStakingState } {
  return { ...state, staking: getPSolState() };
}

/**
 * Verify real exchange balance. Called once on startup.
 * Falls back gracefully if exchange API is unavailable.
 */
export async function verifyExchangeBalance(): Promise<CapitalState> {
  try {
    // Attempt to fetch real balance from Binance
    const apiKey =
      typeof process !== "undefined" ? process.env?.BINANCE_API_KEY : undefined;
    const apiSecret =
      typeof process !== "undefined" ? process.env?.BINANCE_API_SECRET : undefined;

    if (apiKey && apiSecret) {
      const timestamp = Date.now();
      const response = await fetch(
        `https://api.binance.com/api/v3/account?timestamp=${timestamp}`,
        {
          headers: { "X-MBX-APIKEY": apiKey },
          signal: AbortSignal.timeout(8000),
        },
      );

      if (response.ok) {
        const data = await response.json();
        const balances = data.balances || [];
        let totalUsd = 0;

        for (const b of balances) {
          const free = parseFloat(b.free || "0");
          const locked = parseFloat(b.locked || "0");
          if (free + locked > 0) {
            // Simple USDT valuation — in production would use real prices
            if (b.asset === "USDT" || b.asset === "USDC" || b.asset === "BUSD") {
              totalUsd += free + locked;
            }
          }
        }

        state.exchangeBalance = totalUsd;
        state.balanceVerified = true;

        // If exchange balance exceeds initial + profit, sync it
        if (totalUsd > state.trading) {
          state.trading = totalUsd;
        }
      }
    }
  } catch (err) {
    console.warn("[CapitalManager] verifyExchangeBalance failed:", err);
    // Exchange API unavailable — continue with paper balance
  }

  return { ...state };
}

/**
 * Record a profit (or loss) from a closed trade.
 * Positive pnl: 90% → owner payout, 10% → reinvest.
 * Negative pnl: reduces trading capital only, floored at initial.
 *
 * After recording profit, triggers auto-staking of the payout into pSOL
 * if the payout exceeds the staking threshold.
 *
 * In LIVE mode: also verifies actual exchange balance after close.
 */
export async function recordProfit(pnl: number): Promise<CapitalState> {
  if (pnl > 0) {
    const payoutDelta = pnl * 0.9;
    state.payout += payoutDelta;
    state.trading += pnl * 0.1;
    state.profit += pnl;

    // ── pSOL Auto-Staking ───────────────────────────────────────
    if (payoutDelta > 0) {
      await compoundYield();
      const result = await triggerAutoStake(payoutDelta);
      if (result.stakedSOL > stakedPayout) {
        stakedPayout += payoutDelta;
      }
    }

    // ── LIVE: Update actual balance after profitable close ──────
    // Re-verify exchange balance to sync
    try {
      await verifyExchangeBalance();
    } catch (err) {
      console.warn("[CapitalManager] recordProfit verifyExchangeBalance failed:", err);
      // best-effort
    }
  } else if (pnl < 0) {
    // Losses only reduce trading capital, floored at initial
    state.trading = Math.max(state.initial, state.trading + pnl);
  }
  // pnl === 0 is a no-op
  return { ...state };
}
