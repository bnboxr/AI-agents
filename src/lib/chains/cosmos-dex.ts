// ── Cosmos DEX Integration — Osmosis ─────────────────────────────────
// Uses Osmosis (largest Cosmos DEX) for token swaps.
// Supported pairs: ATOM/USDC, ATOM/OSMO
// Paper mode: simulated swap execution with real ATOM/USD price.
// Integrates with existing DexAdapter pattern.

import { getCosmosAddress, getCosmosBalance, fetchAtomPrice } from "./cosmos-wallet";

// ── Types ──────────────────────────────────────────────────────────────

export interface CosmosSwapResult {
  success: boolean;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpactPct: number;
  txSignature?: string;
  error?: string;
  isPaper: boolean;
}

// ── Supported Pairs ────────────────────────────────────────────────────

export const COSMOS_PAIRS = [
  { base: "ATOM", quote: "USDC", baseName: "ATOM", quoteName: "USDC" },
  { base: "ATOM", quote: "OSMO", baseName: "ATOM", quoteName: "OSMO" },
] as const;

export interface CosmosPair {
  base: string;
  quote: string;
  baseName: string;
  quoteName: string;
}

// ── Osmosis Constants ──────────────────────────────────────────────────

// Default Osmosis REST API
const DEFAULT_OSMOSIS_RPC = "https://rpc.osmosis.zone";

// OSMO CoinGecko ID
const OSMO_COINGECKO_ID = "osmosis";

// ── OSMO Price ─────────────────────────────────────────────────────────

let cachedOsmoPrice: { price: number; ts: number } | null = null;
const OSMO_PRICE_CACHE_TTL = 30_000;

async function fetchOsmoPrice(): Promise<number> {
  const now = Date.now();
  if (cachedOsmoPrice && (now - cachedOsmoPrice.ts) < OSMO_PRICE_CACHE_TTL) {
    return cachedOsmoPrice.price;
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${OSMO_COINGECKO_ID}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd: number }>;
      const price = data[OSMO_COINGECKO_ID]?.usd ?? 0;
      cachedOsmoPrice = { price, ts: now };
      return price;
    }
  } catch (err) {
    console.warn("[CosmosDex] CoinGecko OSMO price fetch failed:", (err as Error).message);
  }

  return cachedOsmoPrice?.price ?? 0.35; // ~$0.35 fallback
}

// ── Price Fetching ──────────────────────────────────────────────────────

/**
 * Get estimated swap output for a Cosmos pair.
 * Uses ATOM/USD price from CoinGecko + configured slippage.
 */
async function getCosmosSwapQuote(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
): Promise<{ outputAmount: number; priceImpactPct: number; atomPrice: number }> {
  const inputUpper = inputSymbol.toUpperCase();
  const outputUpper = outputSymbol.toUpperCase();

  const atomPrice = await fetchAtomPrice();

  let outputAmount: number;
  let priceImpactPct: number;

  if (inputUpper === "ATOM") {
    if (outputUpper === "USDC") {
      // ATOM → USDC: rate = ATOM price in USD
      outputAmount = amount * atomPrice * 0.997; // 0.3% Osmosis fee
      priceImpactPct = Math.min((amount * atomPrice / 10_000) * 100, 5);
    } else if (outputUpper === "OSMO") {
      // ATOM → OSMO
      const osmoPrice = await fetchOsmoPrice();
      if (osmoPrice <= 0) throw new Error("OSMO price unavailable");
      const atomOsmoRate = atomPrice / osmoPrice;
      outputAmount = amount * atomOsmoRate * 0.997;
      priceImpactPct = Math.min((amount * atomPrice / 10_000) * 100, 5);
    } else {
      outputAmount = amount * atomPrice * 0.99;
      priceImpactPct = 1;
    }
  } else if (inputUpper === "USDC") {
    if (outputUpper === "ATOM") {
      outputAmount = (amount / atomPrice) * 0.997;
      priceImpactPct = Math.min((amount / 10_000) * 100, 5);
    } else {
      outputAmount = (amount / atomPrice) * 0.99;
      priceImpactPct = 1;
    }
  } else if (inputUpper === "OSMO") {
    if (outputUpper === "ATOM") {
      const osmoPrice = await fetchOsmoPrice();
      if (osmoPrice <= 0) throw new Error("OSMO price unavailable");
      outputAmount = (amount * osmoPrice / atomPrice) * 0.997;
      priceImpactPct = Math.min((amount * osmoPrice / 10_000) * 100, 5);
    } else {
      outputAmount = amount * 0.99;
      priceImpactPct = 1;
    }
  } else {
    outputAmount = amount * 0.99;
    priceImpactPct = 1;
  }

  return { outputAmount, priceImpactPct, atomPrice };
}

// ── Swap Execution (Paper Mode) ─────────────────────────────────────────

/**
 * Simulate a Cosmos DEX swap via Osmosis.
 * In paper mode: fetches real ATOM price but does not sign/submit.
 */
export async function cosmosSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
): Promise<CosmosSwapResult> {
  const inputUpper = inputSymbol.toUpperCase();
  const outputUpper = outputSymbol.toUpperCase();

  try {
    const { outputAmount, priceImpactPct } = await getCosmosSwapQuote(
      inputUpper,
      outputUpper,
      amount,
    );

    return {
      success: true,
      inputToken: inputUpper,
      outputToken: outputUpper,
      inputAmount: amount,
      outputAmount,
      priceImpactPct,
      isPaper: true,
    };
  } catch (err) {
    return {
      success: false,
      inputToken: inputUpper,
      outputToken: outputUpper,
      inputAmount: amount,
      outputAmount: 0,
      priceImpactPct: 0,
      error: (err as Error).message,
      isPaper: true,
    };
  }
}

// ── Paper Mode Swap (with simulated balances) ───────────────────────────

export interface CosmosPaperBalance {
  atom: number;
  usdc: number;
  osmo: number;
}

let paperBalances: CosmosPaperBalance = {
  atom: 100,
  usdc: 10000,
  osmo: 500,
};

export { paperBalances as cosmosPaperBalances };

/**
 * Execute a paper-mode swap that updates simulated balances.
 */
export async function cosmosPaperSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
): Promise<CosmosSwapResult & { updatedBalances: CosmosPaperBalance }> {
  const result = await cosmosSwap(inputSymbol, outputSymbol, amount);

  if (result.success) {
    const inputUpper = inputSymbol.toUpperCase();
    const outputUpper = outputSymbol.toUpperCase();
    const inputKey = inputUpper.toLowerCase() as keyof CosmosPaperBalance;
    const outputKey = outputUpper.toLowerCase() as keyof CosmosPaperBalance;

    if (isNaN(paperBalances[inputKey])) {
      paperBalances[inputKey] = 0;
    }
    if (isNaN(paperBalances[outputKey])) {
      paperBalances[outputKey] = 0;
    }

    paperBalances[inputKey] -= amount;
    paperBalances[outputKey] += result.outputAmount;
  }

  return { ...result, updatedBalances: { ...paperBalances } };
}

/**
 * Get current paper balances.
 */
export function getCosmosPaperBalances(): CosmosPaperBalance {
  return { ...paperBalances };
}

/**
 * Reset paper balances to defaults.
 */
export function resetCosmosPaperBalances(): void {
  paperBalances = { atom: 100, usdc: 10000, osmo: 500 };
}

// ── Token Price Fetching ────────────────────────────────────────────────

export { fetchAtomPrice } from "./cosmos-wallet";

/**
 * Get estimated USD value of ATOM tokens.
 */
export function estimateAtomValue(atomAmount: number, atomPrice: number): number {
  return atomAmount * atomPrice;
}

// ── DexAdapter-compatible interface ─────────────────────────────────────

/**
 * Interface compatible with the existing DexAdapter pattern.
 */
export class CosmosDexAdapter {
  name = "Osmosis (Cosmos)";
  isEnabled = true;
  isLive = false;
  isPaper = true;

  async swap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<CosmosSwapResult> {
    return cosmosSwap(inputSymbol, outputSymbol, amount);
  }

  async paperSwap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<CosmosSwapResult & { updatedBalances: CosmosPaperBalance }> {
    return cosmosPaperSwap(inputSymbol, outputSymbol, amount);
  }

  getBalances(): CosmosPaperBalance {
    return getCosmosPaperBalances();
  }

  async getCosmosAddress(): Promise<string> {
    return getCosmosAddress();
  }

  async getAtomBalance(): Promise<number> {
    const info = await getCosmosBalance();
    return info.balanceAtom;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

let instance: CosmosDexAdapter | null = null;

export function getCosmosDexAdapter(): CosmosDexAdapter {
  if (!instance) {
    instance = new CosmosDexAdapter();
  }
  return instance;
}
