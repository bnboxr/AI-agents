// ── Chain Balance Tracking ──────────────────────────────────────────
// Per-chain balance with DB persistence.
// Tracks native balance, USD value, trades, and PnL per testnet chain.
// Used by the Agent Training dashboard and anti-drain system.

import { sql, isDbAvailable } from "./db";
import { SUPPORTED_CHAINS } from "./chains-config";

export interface ChainBalance {
  chainId: string;
  chainName: string;
  nativeBalance: number;      // ETH/MATIC etc from faucets
  usdValue: number;           // USD equivalent
  initialBalance: number;
  currentBalance: number;
  totalTrades: number;
  totalPnL: number;
  lastFaucetClaim: number;    // timestamp
  faucetsUsed: string[];      // which faucets claimed this cycle
}

// ── In-memory cache ──────────────────────────────────────────────────

const chainBalances = new Map<string, ChainBalance>();

/** Default native token prices (USD) — updated periodically from CoinGecko */
const NATIVE_PRICES: Record<string, number> = {
  ETH: 3400,
  MATIC: 0.55,
  SOL: 170,
  ATOM: 6.5,
};

/** Get the native token price in USD for a chain */
export function getNativeTokenPrice(chainId: string): number {
  const cfg = SUPPORTED_CHAINS[chainId];
  if (!cfg) return 0;
  return NATIVE_PRICES[cfg.nativeToken.toUpperCase()] ?? 0;
}

/** Get or create a chain balance entry */
export function getChainBalance(chainId: string): ChainBalance {
  const existing = chainBalances.get(chainId);
  if (existing) return existing;

  const cfg = SUPPORTED_CHAINS[chainId];
  const defaultBalance: ChainBalance = {
    chainId,
    chainName: cfg?.name ?? chainId,
    nativeBalance: 0,
    usdValue: 0,
    initialBalance: 0,
    currentBalance: 0,
    totalTrades: 0,
    totalPnL: 0,
    lastFaucetClaim: 0,
    faucetsUsed: [],
  };
  chainBalances.set(chainId, defaultBalance);
  return defaultBalance;
}

/** Set initial balance for a chain (call after faucet claim) */
export function setInitialBalance(chainId: string, nativeAmount: number): void {
  const cfg = SUPPORTED_CHAINS[chainId];
  const price = getNativeTokenPrice(chainId);
  const usdValue = nativeAmount * price;

  const balance: ChainBalance = {
    chainId,
    chainName: cfg?.name ?? chainId,
    nativeBalance: nativeAmount,
    usdValue,
    initialBalance: usdValue,
    currentBalance: usdValue,
    totalTrades: 0,
    totalPnL: 0,
    lastFaucetClaim: Date.now(),
    faucetsUsed: [],
  };
  chainBalances.set(chainId, balance);
  persistChainBalance(balance);
}

/** Update after a trade (positive amount = credit, negative = debit) */
export async function updateChainBalance(
  chainId: string,
  pnlUsd: number,
): Promise<ChainBalance> {
  const bal = getChainBalance(chainId);
  bal.totalTrades++;
  bal.totalPnL += pnlUsd;
  bal.currentBalance += pnlUsd;
  bal.usdValue = bal.currentBalance;

  chainBalances.set(chainId, bal);
  persistChainBalance(bal);
  return bal;
}

/** Get all chain balances (only testnets) */
export function getAllChainBalances(): ChainBalance[] {
  // Ensure all testnet chains have an entry
  for (const [id, cfg] of Object.entries(SUPPORTED_CHAINS)) {
    if (cfg.testnet) {
      getChainBalance(id);
    }
  }
  return Array.from(chainBalances.values()).filter(
    (b) => SUPPORTED_CHAINS[b.chainId]?.testnet,
  );
}

/** Reset a chain balance (e.g., after 24h reset) */
export function resetChainBalance(chainId: string): void {
  chainBalances.delete(chainId);
}

// ── DB Persistence ───────────────────────────────────────────────────

async function persistChainBalance(bal: ChainBalance): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    await sql`
      INSERT INTO chain_balances (chain_id, chain_name, native_balance, usd_value,
        initial_balance, current_balance, total_trades, total_pnl,
        last_faucet_claim, faucets_used, updated_at)
      VALUES (${bal.chainId}, ${bal.chainName}, ${bal.nativeBalance}, ${bal.usdValue},
        ${bal.initialBalance}, ${bal.currentBalance}, ${bal.totalTrades}, ${bal.totalPnL},
        ${bal.lastFaucetClaim}, ${JSON.stringify(bal.faucetsUsed)}, now())
      ON CONFLICT (chain_id) DO UPDATE SET
        native_balance = EXCLUDED.native_balance,
        usd_value = EXCLUDED.usd_value,
        current_balance = EXCLUDED.current_balance,
        total_trades = EXCLUDED.total_trades,
        total_pnl = EXCLUDED.total_pnl,
        last_faucet_claim = EXCLUDED.last_faucet_claim,
        faucets_used = EXCLUDED.faucets_used,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (err) {
    console.warn("[ChainBalance] persist failed:", err);
  }
}

/** Load chain balances from DB into memory */
export async function loadChainBalancesFromDb(): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    const result = await sql.query("SELECT * FROM chain_balances");
    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      const bal: ChainBalance = {
        chainId: r.chain_id as string,
        chainName: r.chain_name as string,
        nativeBalance: (r.native_balance as number) ?? 0,
        usdValue: (r.usd_value as number) ?? 0,
        initialBalance: (r.initial_balance as number) ?? 0,
        currentBalance: (r.current_balance as number) ?? 0,
        totalTrades: (r.total_trades as number) ?? 0,
        totalPnL: (r.total_pnl as number) ?? 0,
        lastFaucetClaim: (r.last_faucet_claim as number) ?? 0,
        faucetsUsed: typeof r.faucets_used === "string"
          ? JSON.parse(r.faucets_used as string)
          : (r.faucets_used as string[]) ?? [],
      };
      chainBalances.set(bal.chainId, bal);
    }
    console.log(`[ChainBalance] Loaded ${result.rows.length} chain balances from DB`);
  } catch (err) {
    console.warn("[ChainBalance] loadFromDb failed:", err);
  }
}
