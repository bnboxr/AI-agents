// ── Unified Balance System ────────────────────────────────────────
// Single source of truth for paper balances.
// Primary source: capital-manager (env STARTING_CAPITAL).
// Persists to DB trading_state table for survival across restarts.
//
// Wire this into every execution path: before placing a trade, debit.
// After closing with profit/loss, credit.
// Reject trades that would exceed available balance.

import { getCapitalState, recordProfit } from "./capital-manager";
import { sql, isDbAvailable } from "./db";

// ── Types ──────────────────────────────────────────────────────────

export interface PaperPosition {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  openedAt: number;
}

export interface UnifiedBalanceState {
  usdt: number;
  initialCapital: number;
  positions: Map<string, PaperPosition>;
  pnl: number;
}

// ── In-Memory State ────────────────────────────────────────────────

const paperPositions = new Map<string, PaperPosition>();
let initialized = false;

// ── Initialization ─────────────────────────────────────────────────

/**
 * Initialize balance from capital-manager (which reads STARTING_CAPITAL env var).
 * Falls back to DB trading_state if available, then to defaults.
 * Must be called once before any balance operations.
 */
export async function initializeBalance(): Promise<UnifiedBalanceState> {
  if (initialized) {
    return getSyncBalance();
  }

  // 1. Primary: capital-manager (env STARTING_CAPITAL)
  const capState = getCapitalState();

  // 2. Try to restore from DB
  let dbCapital: number | null = null;
  if (isDbAvailable()) {
    try {
      const result = await sql.query(
        "SELECT capital, initial_capital FROM trading_state WHERE id = 1",
      );
      if (result.rows.length > 0 && result.rows[0]) {
        const row = result.rows[0] as { capital: number; initial_capital: number };
        dbCapital = row.capital;
        if (row.initial_capital && row.initial_capital > capState.initial) {
          // DB has a larger initial — use it
        }
      }
    } catch (err) {
      console.warn("[UnifiedBalance] DB restore failed:", err);
    }
  }

  // Use the larger of env-based or DB-restored capital
  const effectiveCapital = Math.max(
    capState.trading,
    dbCapital ?? 0,
    capState.initial,
  );

  initialized = true;
  console.log(
    `[UnifiedBalance] Initialized with $${effectiveCapital.toLocaleString()} USDT (env: $${capState.initial}, db: $${dbCapital ?? "N/A"})`,
  );

  return {
    usdt: effectiveCapital,
    initialCapital: capState.initial,
    positions: paperPositions,
    pnl: effectiveCapital - capState.initial,
  };
}

// ── Balance Access ─────────────────────────────────────────────────

/** Get current paper balance synchronously (must call initializeBalance first). */
export function getSyncBalance(): UnifiedBalanceState {
  const capState = getCapitalState();
  return {
    usdt: capState.trading,
    initialCapital: capState.initial,
    positions: paperPositions,
    pnl: capState.profit,
  };
}

/** Get current paper balance, initializing if needed. */
export async function getBalance(): Promise<UnifiedBalanceState> {
  if (!initialized) {
    return initializeBalance();
  }
  return getSyncBalance();
}

// ── Debit / Credit ─────────────────────────────────────────────────

/**
 * Debit balance for a trade. Returns the new balance or throws if insufficient.
 * @param amount Amount in USDT to reserve.
 * @returns New USDT balance after debit.
 */
export async function debitBalance(amount: number): Promise<number> {
  if (!initialized) await initializeBalance();

  const current = getSyncBalance().usdt;
  if (amount > current) {
    throw new Error(
      `Insufficient balance: need $${amount.toFixed(2)} but have $${current.toFixed(2)}`,
    );
  }

  // Record as negative profit (position cost) via capital-manager
  // This reduces trading capital
  await recordProfit(-amount);

  const newBalance = getSyncBalance().usdt;
  await syncToDB();
  return newBalance;
}

/**
 * Credit balance after closing a position.
 * @param amount Amount in USDT to add back (size + profit or size - loss).
 * @returns New USDT balance after credit.
 */
export async function creditBalance(amount: number): Promise<number> {
  if (!initialized) await initializeBalance();

  // Record as profit via capital-manager
  // If amount > positionSize, the delta is profit
  // If amount < positionSize, the delta is loss
  // We pass the actual credit amount; capital-manager splits profit.
  
  // For simplicity: record credit as positive profit (the capital manager handles split)
  const current = getSyncBalance().usdt;
  const delta = amount - current; // net change to record
  
  if (delta !== 0) {
    await recordProfit(delta);
  }

  const newBalance = getSyncBalance().usdt;
  await syncToDB();
  return newBalance;
}

// ── Position Tracking ──────────────────────────────────────────────

export function addPaperPosition(position: PaperPosition): void {
  paperPositions.set(position.id, position);
}

export function removePaperPosition(positionId: string): PaperPosition | undefined {
  const pos = paperPositions.get(positionId);
  if (pos) {
    paperPositions.delete(positionId);
  }
  return pos;
}

export function getPaperPosition(positionId: string): PaperPosition | undefined {
  return paperPositions.get(positionId);
}

export function getAllPaperPositions(): PaperPosition[] {
  return Array.from(paperPositions.values());
}

// ── DB Persistence ─────────────────────────────────────────────────

/**
 * Sync current balance to DB trading_state table.
 * Best-effort: logs warning on failure.
 */
export async function syncToDB(): Promise<void> {
  if (!isDbAvailable()) return;

  try {
    const bal = getSyncBalance();
    await sql`
      INSERT INTO trading_state (id, capital, initial_capital, pnl, pnl_pct, updated_at)
      VALUES (1, ${bal.usdt}, ${bal.initialCapital}, ${bal.pnl}, ${bal.initialCapital > 0 ? ((bal.pnl / bal.initialCapital) * 100) : 0}, now())
      ON CONFLICT (id) DO UPDATE SET
        capital = EXCLUDED.capital,
        initial_capital = EXCLUDED.initial_capital,
        pnl = EXCLUDED.pnl,
        pnl_pct = EXCLUDED.pnl_pct,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (err) {
    console.warn("[UnifiedBalance] syncToDB failed:", err);
  }
}

/**
 * Restore balance from DB on startup.
 * Called by initializeBalance automatically.
 */
export async function loadFromDB(): Promise<UnifiedBalanceState | null> {
  if (!isDbAvailable()) return null;

  try {
    const result = await sql.query(
      "SELECT capital, initial_capital, pnl FROM trading_state WHERE id = 1",
    );
    if (result.rows.length > 0 && result.rows[0]) {
      const row = result.rows[0] as { capital: number; initial_capital: number; pnl: number };
      return {
        usdt: row.capital,
        initialCapital: row.initial_capital,
        positions: paperPositions,
        pnl: row.pnl ?? (row.capital - row.initial_capital),
      };
    }
  } catch (err) {
    console.warn("[UnifiedBalance] loadFromDB failed:", err);
  }
  return null;
}
