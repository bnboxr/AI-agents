// ── LP Auto-Compounder ──────────────────────────────────────────
// Paper-mode simulation of LP deposits, fee tracking, and auto-compounding.
// Targets: Aerodrome on Base (best APY), Curve+Convex for USDC.
//
// All values are simulated/polled — NO real on-chain transactions.

// ── Types ──────────────────────────────────────────────────────

export interface LPPosition {
  id: string;
  pair: string;            // e.g. "USDC/ETH", "USDC/USDT"
  dex: "aerodrome" | "curve" | "convex";
  chain: string;           // "base", "ethereum"
  deposited: number;       // USD value deposited
  feesEarned: number;      // USD fees accumulated
  apy: number;             // current estimated APY %
  createdAt: number;
  lastCompound: number;
  compoundCount: number;
  status: "active" | "closed";
}

export interface LPYieldState {
  positions: LPPosition[];
  totalDeposited: number;
  totalFeesEarned: number;
  blendedAPY: number;
  lastUpdate: number;
  paperMode: boolean;
}

// APY reference data (updated periodically — these are realistic ranges)
const POOL_APY_REFERENCE: Record<string, { base: number; range: number; dex: LPPosition["dex"]; chain: string }> = {
  "USDC/ETH":      { base: 18, range: 12, dex: "aerodrome", chain: "base" },
  "USDC/WETH":     { base: 18, range: 12, dex: "aerodrome", chain: "base" },
  "ETH/USDC":      { base: 22, range: 18, dex: "aerodrome", chain: "base" },
  "USDC/USDT":     { base: 8, range: 4, dex: "curve", chain: "ethereum" },
  "DAI/USDC":      { base: 6, range: 3, dex: "curve", chain: "ethereum" },
  "USDC/DAI/USDT": { base: 7, range: 3, dex: "curve", chain: "ethereum" },
  "FRAX/USDC":     { base: 5, range: 3, dex: "convex", chain: "ethereum" },
  "crvUSD/USDC":   { base: 9, range: 5, dex: "convex", chain: "ethereum" },
};

// Pool simulation parameters
const FEE_RATE: Record<string, number> = {
  aerodrome: 0.002,    // 0.2% average
  curve: 0.0004,       // 0.04%
  convex: 0.0006,      // 0.06% (boosted)
};

const COMPOUND_FREQUENCY_MS = 24 * 60 * 60 * 1000; // daily

// ── In-memory state ──────────────────────────────────────────

let _state: LPYieldState = {
  positions: [],
  totalDeposited: 0,
  totalFeesEarned: 0,
  blendedAPY: 0,
  lastUpdate: Date.now(),
  paperMode: true,
};

// ── Internal helpers ──────────────────────────────────────────

function apyForPair(pair: string): { apy: number; dex: LPPosition["dex"]; chain: string } {
  const ref = POOL_APY_REFERENCE[pair];
  if (ref) {
    // Add small random variation to simulate live APY fluctuation
    const variation = (Math.random() - 0.5) * ref.range;
    return { apy: +(ref.base + variation).toFixed(2), dex: ref.dex, chain: ref.chain };
  }
  // Unknown pair — default to Aerodrome on Base
  return { apy: +(10 + Math.random() * 15).toFixed(2), dex: "aerodrome", chain: "base" };
}

function simulateFees(position: LPPosition, hoursElapsed: number): number {
  const hourlyRate = position.apy / 100 / 365 / 24; // APY → hourly
  const fees = position.deposited * hourlyRate * hoursElapsed;
  return +(fees * (0.9 + Math.random() * 0.2)).toFixed(6); // ±10% randomness
}

function recalcBlendedAPY(): void {
  if (_state.positions.length === 0) {
    _state.blendedAPY = 0;
    return;
  }
  const activePositions = _state.positions.filter((p) => p.status === "active");
  if (activePositions.length === 0) {
    _state.blendedAPY = 0;
    return;
  }
  const totalWeight = activePositions.reduce((sum, p) => sum + p.deposited, 0);
  if (totalWeight === 0) {
    _state.blendedAPY = 0;
    return;
  }
  const weightedAPY = activePositions.reduce((sum, p) => sum + p.apy * p.deposited, 0);
  _state.blendedAPY = +(weightedAPY / totalWeight).toFixed(2);
}

// ── Public API ────────────────────────────────────────────────

/**
 * Simulate an LP deposit into a pair.
 * Paper mode only — no on-chain transaction.
 */
export function depositLP(
  pair: string,
  amount: number,
): LPPosition {
  const { apy, dex, chain } = apyForPair(pair);
  const position: LPPosition = {
    id: `lp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pair,
    dex,
    chain,
    deposited: amount,
    feesEarned: 0,
    apy,
    createdAt: Date.now(),
    lastCompound: Date.now(),
    compoundCount: 0,
    status: "active",
  };

  _state.positions.push(position);
  _state.totalDeposited += amount;
  _state.lastUpdate = Date.now();
  recalcBlendedAPY();

  return position;
}

/**
 * Get current estimated LP yield data.
 * Simulates fee accrual over time since last check.
 */
export function getLPYield(): LPYieldState {
  const now = Date.now();

  // Simulate fee accrual for all active positions
  for (const pos of _state.positions) {
    if (pos.status !== "active") continue;
    const hoursSinceCheck = (now - _state.lastUpdate) / (1000 * 60 * 60);
    if (hoursSinceCheck > 0) {
      const newFees = simulateFees(pos, Math.min(hoursSinceCheck, 24)); // cap at 24h between checks
      pos.feesEarned += newFees;
      pos.apy = apyForPair(pos.pair).apy; // refresh APY each poll
      _state.totalFeesEarned += newFees;
    }
  }

  _state.lastUpdate = now;
  recalcBlendedAPY();
  return { ..._state, positions: _state.positions.map((p) => ({ ...p })) };
}

/**
 * Compound: reinvest earned fees back into the position.
 * Paper mode — simulates increasing deposit by fee amount.
 */
export function compound(positionId?: string): LPYieldState {
  const now = Date.now();

  // First, accrue any pending fees
  getLPYield();

  const targets = positionId
    ? _state.positions.filter((p) => p.id === positionId && p.status === "active")
    : _state.positions.filter((p) => p.status === "active");

  for (const pos of targets) {
    if (pos.feesEarned <= 0) continue;
    // Compound: add fees to deposited, reset fee counter
    pos.deposited += pos.feesEarned;
    _state.totalDeposited += pos.feesEarned;
    pos.feesEarned = 0;
    pos.lastCompound = now;
    pos.compoundCount++;
  }

  _state.lastUpdate = now;
  recalcBlendedAPY();
  return { ..._state, positions: _state.positions.map((p) => ({ ...p })) };
}

/**
 * Close a position and return final value.
 */
export function closePosition(positionId: string): { deposited: number; fees: number; total: number } | null {
  const pos = _state.positions.find((p) => p.id === positionId);
  if (!pos || pos.status !== "active") return null;

  // Accrue final fees
  getLPYield();

  pos.status = "closed";
  _state.totalDeposited -= pos.deposited;
  _state.lastUpdate = Date.now();
  recalcBlendedAPY();

  return {
    deposited: pos.deposited,
    fees: pos.feesEarned,
    total: pos.deposited + pos.feesEarned,
  };
}

/**
 * Get raw state (for dashboard polling).
 */
export function getLPState(): LPYieldState {
  // Always accrue on read
  return getLPYield();
}

/**
 * Reset all LP state (for testing / paper mode reset).
 */
export function resetLPState(): void {
  _state = {
    positions: [],
    totalDeposited: 0,
    totalFeesEarned: 0,
    blendedAPY: 0,
    lastUpdate: Date.now(),
    paperMode: true,
  };
}
