// ── Strategy Prioritizer — Capital-Aware Strategy Engine ─────────────
// Determines which revenue strategies are eligible based on current capital.
// Provides next-milestone guidance and recommended capital allocation.
//
// Used by the orchestrator to decide what to run based on liquid balance.
// No Math.random() — deterministic based on capital thresholds.

// ── Types ──────────────────────────────────────────────────────────────

export interface Strategy {
  name: string;
  minCapital: number; // minimum USD capital required
  expectedReturn: string;
  risk: "low" | "medium" | "high";
}

// ── Strategy Registry ──────────────────────────────────────────────────

const STRATEGIES: Strategy[] = [
  {
    name: "Airdrop Farming",
    minCapital: 0,
    expectedReturn: "$50-$500+/airdrop",
    risk: "low",
  },
  {
    name: "Micro-Yield (AAVE)",
    minCapital: 1,
    expectedReturn: "5-8% APY",
    risk: "low",
  },
  {
    name: "LP Fees",
    minCapital: 5,
    expectedReturn: "10-50% APY",
    risk: "medium",
  },
  {
    name: "Spot Trading",
    minCapital: 10,
    expectedReturn: "Variable",
    risk: "high",
  },
  {
    name: "Perpetuals",
    minCapital: 50,
    expectedReturn: "Variable",
    risk: "high",
  },
  {
    name: "Flash Loan Arb",
    minCapital: 100,
    expectedReturn: "0.1-2%/trade",
    risk: "medium",
  },
  {
    name: "Solana DEX (Jupiter)",
    minCapital: 10,
    expectedReturn: "Variable",
    risk: "medium",
  },
  {
    name: "XRP DEX (XRPL)",
    minCapital: 10,
    expectedReturn: "Variable",
    risk: "medium",
  },
  {
    name: "TRON DEX (SunSwap)",
    minCapital: 10,
    expectedReturn: "Variable",
    risk: "medium",
  },
  {
    name: "Cosmos DEX (Osmosis)",
    minCapital: 10,
    expectedReturn: "Variable",
    risk: "medium",
  },
];

// ── Allocation presets by capital bracket ─────────────────────────────

interface AllocationBracket {
  minCapital: number;
  maxCapital: number;
  allocations: { name: string; pct: number }[];
}

const ALLOCATION_BRACKETS: AllocationBracket[] = [
  // Tier 0: $0-$5 — only airdrop farming (100%)
  {
    minCapital: 0,
    maxCapital: 5,
    allocations: [{ name: "Airdrop Farming", pct: 1.0 }],
  },
  // Tier 1: $5-$50 — airdrop (60%) + micro-yield (40%)
  {
    minCapital: 5,
    maxCapital: 50,
    allocations: [
      { name: "Airdrop Farming", pct: 0.6 },
      { name: "Micro-Yield (AAVE)", pct: 0.3 },
      { name: "LP Fees", pct: 0.1 },
    ],
  },
  // Tier 2: $50-$500 — diversify into LP, spot, perps + Solana
  {
    minCapital: 50,
    maxCapital: 500,
    allocations: [
      { name: "Airdrop Farming", pct: 0.1 },
      { name: "Micro-Yield (AAVE)", pct: 0.1 },
      { name: "LP Fees", pct: 0.2 },
      { name: "Spot Trading", pct: 0.2 },
      { name: "Perpetuals", pct: 0.2 },
      { name: "Solana DEX (Jupiter)", pct: 0.1 },
      { name: "XRP DEX (XRPL)", pct: 0.05 },
      { name: "TRON DEX (SunSwap)", pct: 0.05 },
      { name: "Cosmos DEX (Osmosis)", pct: 0.05 },
    ],
  },
  // Tier 3: $500+ — full suite including flash loan arb + Solana
  {
    minCapital: 500,
    maxCapital: Number.POSITIVE_INFINITY,
    allocations: [
      { name: "Airdrop Farming", pct: 0.05 },
      { name: "Micro-Yield (AAVE)", pct: 0.1 },
      { name: "LP Fees", pct: 0.1 },
      { name: "Spot Trading", pct: 0.2 },
      { name: "Perpetuals", pct: 0.25 },
      { name: "Flash Loan Arb", pct: 0.15 },
      { name: "Solana DEX (Jupiter)", pct: 0.05 },
      { name: "XRP DEX (XRPL)", pct: 0.05 },
      { name: "TRON DEX (SunSwap)", pct: 0.05 },
      { name: "Cosmos DEX (Osmosis)", pct: 0.05 },
    ],
  },
];

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get all strategies eligible at the given capital level.
 * A strategy is eligible if capital >= its minCapital.
 */
export function getEligibleStrategies(capital: number): Strategy[] {
  return STRATEGIES.filter((s) => capital >= s.minCapital);
}

/**
 * Get the next strategy milestone beyond current capital.
 * Returns the strategy with the smallest minCapital that's still
 * greater than the current capital, plus how much more is needed.
 */
export function getNextMilestone(capital: number): { strategy: Strategy; needed: number } | null {
  const next = STRATEGIES.filter((s) => s.minCapital > capital).sort(
    (a, b) => a.minCapital - b.minCapital,
  )[0];

  if (!next) return null;

  return {
    strategy: next,
    needed: next.minCapital - capital,
  };
}

/**
 * Get recommended capital allocation as an array of { name, pct }.
 * Percentages sum to 1.0. Strategies not in the current bracket
 * get 0% allocation.
 */
export function getStrategyAllocation(capital: number): { name: string; pct: number }[] {
  // Find the bracket that matches current capital
  const bracket = ALLOCATION_BRACKETS.find(
    (b) => capital >= b.minCapital && capital < b.maxCapital,
  );

  if (!bracket) {
    // Above all brackets — use the highest tier
    const last = ALLOCATION_BRACKETS[ALLOCATION_BRACKETS.length - 1];
    return last.allocations.map((a) => ({ ...a }));
  }

  return bracket.allocations.map((a) => ({ ...a }));
}

/**
 * Get a human-readable summary of the current capital position.
 */
export function getCapitalSummary(capital: number): {
  eligible: string[];
  nextMilestone: string | null;
  highestRisk: string;
} {
  const eligible = getEligibleStrategies(capital);
  const next = getNextMilestone(capital);

  let highestRisk = "none";
  if (eligible.some((s) => s.risk === "high")) highestRisk = "high";
  else if (eligible.some((s) => s.risk === "medium")) highestRisk = "medium";
  else if (eligible.length > 0) highestRisk = "low";

  return {
    eligible: eligible.map((s) => s.name),
    nextMilestone: next
      ? `${next.strategy.name} (need $${next.needed.toFixed(2)} more)`
      : null,
    highestRisk,
  };
}

/**
 * Get the absolute capital allocation in USD for a given strategy and total capital.
 * Returns 0 if the strategy is not in the current allocation bracket.
 */
export function getAllocationUsd(capital: number, strategyName: string): number {
  const allocations = getStrategyAllocation(capital);
  const match = allocations.find((a) => a.name === strategyName);
  return match ? capital * match.pct : 0;
}
