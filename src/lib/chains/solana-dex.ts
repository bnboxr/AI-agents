// ── Solana DEX Integration — Jupiter Aggregator ────────────────────────
// Uses Jupiter Quote API v6 for token swaps on Solana.
// Supports SOL, USDC, USDT (SPL tokens).
// Paper mode: simulates swap execution with real Jupiter quotes.
// Integrates with existing DexAdapter pattern.

import { getSolanaAddress, getSolanaBalance, fetchSolPrice } from "./solana-wallet";

// ── Types ──────────────────────────────────────────────────────────────

export interface SolanaToken {
  symbol: string;
  mint: string;
  decimals: number;
  name: string;
  logoURI?: string;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: unknown[];
  slippageBps: number;
  swapMode: string;
}

export interface SolanaSwapResult {
  success: boolean;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpactPct: number;
  txSignature?: string;
  quote?: JupiterQuote;
  error?: string;
  isPaper: boolean;
}

// ── Supported Tokens ───────────────────────────────────────────────────

const SOL_MINT = "So11111111111111111111111111111111111111112"; // Wrapped SOL
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const SOLANA_TOKENS: SolanaToken[] = [
  { symbol: "SOL", mint: SOL_MINT, decimals: 9, name: "Solana" },
  { symbol: "USDC", mint: USDC_MINT, decimals: 6, name: "USD Coin" },
  { symbol: "USDT", mint: USDT_MINT, decimals: 6, name: "Tether USD" },
];

// Jupiter Quote API base
const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6";

// ── Helpers ────────────────────────────────────────────────────────────

function getTokenMint(symbol: string): string {
  const upper = symbol.toUpperCase();
  const token = SOLANA_TOKENS.find((t) => t.symbol === upper);
  if (!token) throw new Error(`Unknown Solana token: ${symbol}`);
  return token.mint;
}

function getTokenDecimals(symbol: string): number {
  const upper = symbol.toUpperCase();
  const token = SOLANA_TOKENS.find((t) => t.symbol === upper);
  if (!token) throw new Error(`Unknown Solana token: ${symbol}`);
  return token.decimals;
}

// ── Quote Fetching ─────────────────────────────────────────────────────

/**
 * Fetch a swap quote from Jupiter API.
 * @param inputSymbol - "SOL", "USDC", or "USDT"
 * @param outputSymbol - "SOL", "USDC", or "USDT"
 * @param amount - Amount in input token's native units (e.g., SOL amount, not lamports)
 * @param slippageBps - Slippage tolerance in basis points (default 50 = 0.5%)
 */
export async function getJupiterQuote(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
  slippageBps = 50,
): Promise<JupiterQuote> {
  const inputMint = getTokenMint(inputSymbol);
  const outputMint = getTokenMint(outputSymbol);
  const decimals = getTokenDecimals(inputSymbol);
  const amountRaw = Math.floor(amount * 10 ** decimals);

  const url = new URL(`${JUPITER_QUOTE_API}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amountRaw.toString());
  url.searchParams.set("slippageBps", slippageBps.toString());

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter quote failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return (await res.json()) as JupiterQuote;
}

// ── Swap Execution (Paper Mode) ─────────────────────────────────────────

/**
 * Simulate a Solana swap via Jupiter.
 * In paper mode: fetches a real Jupiter quote but does not sign/submit.
 * Returns the simulated swap result with real price data.
 */
export async function solanaSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
  slippageBps = 50,
): Promise<SolanaSwapResult> {
  const inputUpper = inputSymbol.toUpperCase();
  const outputUpper = outputSymbol.toUpperCase();

  try {
    // Validate tokens
    getTokenMint(inputUpper);
    getTokenMint(outputUpper);

    // Fetch real quote from Jupiter
    const quote = await getJupiterQuote(inputUpper, outputUpper, amount, slippageBps);

    const outDecimals = getTokenDecimals(outputUpper);
    const outputAmount = Number(quote.outAmount) / 10 ** outDecimals;
    const priceImpact = parseFloat(quote.priceImpactPct);

    // Get SOL price for USD valuation
    let solPrice = 170;
    try {
      solPrice = await fetchSolPrice();
    } catch { /* fallback */ }

    return {
      success: true,
      inputToken: inputUpper,
      outputToken: outputUpper,
      inputAmount: amount,
      outputAmount,
      priceImpactPct: priceImpact,
      quote,
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

// ── Paper Mode Swap (with simulated balance) ────────────────────────────

interface PaperBalance {
  sol: number;
  usdc: number;
  usdt: number;
}

export type { PaperBalance };

let paperBalances: PaperBalance = {
  sol: 10,
  usdc: 10000,
  usdt: 10000,
};

/**
 * Execute a paper-mode swap that updates simulated balances.
 * Uses real Jupiter quotes for price discovery.
 */
export async function solanaPaperSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
  slippageBps = 50,
): Promise<SolanaSwapResult & { updatedBalances: PaperBalance }> {
  const result = await solanaSwap(inputSymbol, outputSymbol, amount, slippageBps);

  if (result.success) {
    const inputUpper = inputSymbol.toUpperCase();
    const outputUpper = outputSymbol.toUpperCase();

    // Deduct input
    const inputKey = inputUpper.toLowerCase() as keyof PaperBalance;
    if (paperBalances[inputKey] !== undefined) {
      paperBalances[inputKey] -= amount;
    }

    // Credit output (with 0.3% Jupiter fee)
    const feeMultiplier = 0.997;
    const outputKey = outputUpper.toLowerCase() as keyof PaperBalance;
    if (paperBalances[outputKey] !== undefined) {
      paperBalances[outputKey] += result.outputAmount * feeMultiplier;
    }
  }

  return { ...result, updatedBalances: { ...paperBalances } };
}

/**
 * Get current paper balances.
 */
export function getSolanaPaperBalances(): PaperBalance {
  return { ...paperBalances };
}

/**
 * Reset paper balances to defaults.
 */
export function resetSolanaPaperBalances(): void {
  paperBalances = { sol: 10, usdc: 10000, usdt: 10000 };
}

// ── Token Price Fetching ────────────────────────────────────────────────

/**
 * Fetch SOL price from cached/solana-wallet helper.
 */
export { fetchSolPrice } from "./solana-wallet";

/**
 * Get estimated USDC/USDT value of SOL tokens (1:1 stablecoin).
 */
export function estimateSolValue(solAmount: number, solPrice: number): number {
  return solAmount * solPrice;
}

// ── DexAdapter-compatible interface ─────────────────────────────────────

/**
 * Interface compatible with the existing DexAdapter pattern.
 */
export class SolanaDexAdapter {
  name = "Jupiter (Solana)";
  isEnabled = true;
  isLive = false;
  isPaper = true;

  async getQuote(inputSymbol: string, outputSymbol: string, amount: number): Promise<JupiterQuote> {
    return getJupiterQuote(inputSymbol, outputSymbol, amount);
  }

  async swap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<SolanaSwapResult> {
    return solanaSwap(inputSymbol, outputSymbol, amount);
  }

  async paperSwap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<SolanaSwapResult & { updatedBalances: PaperBalance }> {
    return solanaPaperSwap(inputSymbol, outputSymbol, amount);
  }

  getBalances(): PaperBalance {
    return getSolanaPaperBalances();
  }

  async getSolanaAddress(): Promise<string> {
    return getSolanaAddress();
  }

  async getSolBalance(): Promise<number> {
    const info = await getSolanaBalance();
    return info.balanceSol;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

let instance: SolanaDexAdapter | null = null;

export function getSolanaDexAdapter(): SolanaDexAdapter {
  if (!instance) {
    instance = new SolanaDexAdapter();
  }
  return instance;
}
