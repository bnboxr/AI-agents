// ── Capital Manager ───────────────────────────────────────────────
// Tracks trading capital, profit, and owner payout.
// Profit split: 90% → owner payout, 10% → reinvested into trading capital.
// Losses are absorbed by trading capital only, down to initial floor.

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

export function getCapitalState(): CapitalState {
  return { ...state };
}

export function recordProfit(pnl: number): CapitalState {
  if (pnl > 0) {
    state.payout += pnl * 0.9;
    state.trading += pnl * 0.1;
    state.profit += pnl;
  } else if (pnl < 0) {
    // Losses only reduce trading capital, floored at initial
    state.trading = Math.max(state.initial, state.trading + pnl);
  }
  // pnl === 0 is a no-op
  return { ...state };
}
