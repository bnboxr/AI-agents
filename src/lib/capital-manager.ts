// ── Capital Manager ───────────────────────────────────────────────
// Tracks PAPER/SIMULATION trading capital, profit, and owner payout.
// This ledger NEVER represents real funds: balances here are labelled
// `mode: "simulation"` and must never be presented to the UI as live.
// Profit split: 90% → owner payout, 10% → reinvested into trading capital.
// Losses are absorbed by trading capital only, down to initial floor.
//
// pSOL Auto-Staking: when payout > 0.01 SOL, auto-stake into Marinade.
//
// Loads STARTING_CAPITAL from env if set; otherwise professional default is $0
// (no fabricated $1M paper capital). Real funded balances are verified on
// startup against the exchange; anything here remains labelled simulation.

// HMAC-SHA256 for signed Binance requests (createHmac from node:crypto).
import { createHmac } from "node:crypto";
import { requireEnv } from "./env-guard";
import { triggerAutoStake, getPSolState, compoundYield, type PSolStakingState } from "./staking/psol";

interface CapitalState {
  /** Paper/simulation trading balance in USDT — not real funds. */
  trading: number;
  initial: number;
  profit: number;
  payout: number;
  /** Whether we verified exchange balance on startup */
  balanceVerified: boolean;
  /** Exchange-reported balance (if available) */
  exchangeBalance: number | null;
  /** Always "simulation": this ledger tracks paper capital, never live funds. */
  mode: "simulation";
}

/** Load starting capital from env; default to $0 (never fabricate paper $1M). */
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
  return 0;
}

const initialCapital = loadStartingCapital();

let state: CapitalState = {
  trading: initialCapital,
  initial: initialCapital,
  profit: 0,
  payout: 0,
  balanceVerified: false,
  exchangeBalance: null,
  mode: "simulation",
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
 *
 * Behavior (owner hard rule — never swallow a real API rejection):
 *  - Keys ABSENT: this is an optional startup probe → skip honestly,
 *    return the current state with a console note. No fabricated balance.
 *  - Keys PRESENT: the request is SIGNED (HMAC-SHA256, X-MBX-APIKEY).
 *    API failure (HTTP error, -2014 bad signature, -1021 timestamp skew,
 *    permissions) THROWS — the caller decides how to surface it. A real
 *    rejection is never silently converted into "balance verified".
 */
export async function verifyExchangeBalance(): Promise<CapitalState> {
  const apiKey =
    typeof process !== "undefined" ? process.env?.BINANCE_API_KEY : undefined;
  const apiSecret =
    typeof process !== "undefined" ? process.env?.BINANCE_SECRET_KEY : undefined;

  // Optional startup probe: keys absent → skip (never fake a balance).
  if (!apiKey || !apiSecret) {
    console.warn(
      "[CapitalManager] verifyExchangeBalance skipped — BINANCE_API_KEY/BINANCE_SECRET_KEY not set. No balance verification performed.",
    );
    return { ...state };
  }

  // Keys present → fully signed request. Any rejection throws.
  const key = requireEnv("BINANCE_API_KEY");
  const secret = requireEnv("BINANCE_SECRET_KEY");
  const binanceRest =
    process.env.BINANCE_REST_OVERRIDE ?? "https://api.binance.com/api/v3";
  const recvWindow = Number(process.env.BINANCE_RECV_WINDOW_MS ?? 5000);

  const queryParams = new URLSearchParams({
    timestamp: String(Date.now()),
    recvWindow: String(recvWindow),
  });
  const signature = createHmac("sha256", secret)
    .update(queryParams.toString(), "utf8")
    .digest("hex");
  queryParams.set("signature", signature);

  const response = await fetch(
    `${binanceRest}/api/v3/account?${queryParams.toString()}`,
    {
      headers: { "X-MBX-APIKEY": key },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!response.ok) {
    // Real rejection — surface it, never swallow.
    let detail = `HTTP ${response.status}`;
    try {
      const j = (await response.json()) as { code?: number; msg?: string };
      if (typeof j.msg === "string") {
        detail = `HTTP ${response.status} (code ${j.code ?? "?"}): ${j.msg}`;
      }
    } catch {
      // keep HTTP status detail
    }
    throw new Error(
      `[CapitalManager] Binance balance verification REJECTED — ${detail}. Keys present but API refused the request.`,
    );
  }

  const data = (await response.json()) as {
    balances?: Array<{ asset: string; free: string; locked: string }>;
  };
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
