// ── Capital Manager ───────────────────────────────────────────────
// Tracks trading capital, profit, and owner payout.
// Profit split: 90% → owner payout, 10% → reinvested into trading capital.
// Losses are absorbed by trading capital only, down to initial floor.
//
// pSOL Auto-Staking: when payout > 0.01 SOL, auto-stake into Marinade.

import { createHmac } from "crypto";
import { triggerAutoStake, getPSolState, compoundYield, type PSolStakingState } from "./staking/psol";

interface CapitalState {
  trading: number;
  initial: number;
  profit: number;
  payout: number;
}

let state: CapitalState = {
  trading: 10,
  initial: 10,
  profit: 0,
  payout: 0,
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
 * Record a profit (or loss) from a closed trade.
 * Positive pnl: 90% → owner payout, 10% → reinvest.
 * Negative pnl: reduces trading capital only, floored at initial.
 *
 * After recording profit, triggers auto-staking of the payout into pSOL
 * if the payout exceeds the staking threshold.
 */
export async function recordProfit(pnl: number): Promise<CapitalState> {
  if (pnl > 0) {
    const payoutDelta = pnl * 0.9;
    state.payout += payoutDelta;
    state.trading += pnl * 0.1;
    state.profit += pnl;

    // ── pSOL Auto-Staking ───────────────────────────────────────
    // Only stake the NEW payout (delta), not the entire accumulated payout.
    // This prevents re-staking already-staked amounts.
    if (payoutDelta > 0) {
      // Compound any pending yield first (lazy compound)
      await compoundYield();

      // Trigger auto-stake with the new payout delta
      const result = await triggerAutoStake(payoutDelta);
      if (result.stakedSOL > stakedPayout) {
        stakedPayout += payoutDelta;
      }
    }
  } else if (pnl < 0) {
    // Losses only reduce trading capital, floored at initial
    state.trading = Math.max(state.initial, state.trading + pnl);
  }
  // pnl === 0 is a no-op
  return { ...state };
}
