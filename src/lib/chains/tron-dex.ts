// ── TRON DEX Integration — SunSwap ────────────────────────────────────
// Uses SunSwap (TRON's native DEX) for token swaps.
// Supported pairs: TRX/USDT, TRX/USDC
// Paper mode: simulates swap execution with real TRX/USD price.
// Integrates with existing DexAdapter pattern.

import { getTronAddress, getTronBalance, fetchTrxPrice } from "./tron-wallet";
import { TronWeb } from "tronweb";

// ── Types ──────────────────────────────────────────────────────────────

export interface TronSwapResult {
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

export const TRON_PAIRS = [
  { base: "TRX", quote: "USDT", baseName: "TRX", quoteName: "USDT" },
  { base: "TRX", quote: "USDC", baseName: "TRX", quoteName: "USDC" },
] as const;

export interface TronPair {
  base: string;
  quote: string;
  baseName: string;
  quoteName: string;
}

// ── SunSwap Constants ──────────────────────────────────────────────────

// SunSwap V2 Router address on TRON mainnet
const SUNSWAP_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";

// Default TRON RPC
const DEFAULT_TRON_RPC = "https://api.trongrid.io";

// ── Price Fetching (SunSwap uses TRX price from CoinGecko + slippage) ──

/**
 * Get estimated swap output for a TRON pair.
 * Uses TRX/USD price from CoinGecko + configured slippage.
 */
async function getTronSwapQuote(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
): Promise<{ outputAmount: number; priceImpactPct: number; trxPrice: number }> {
  const inputUpper = inputSymbol.toUpperCase();
  const outputUpper = outputSymbol.toUpperCase();

  const trxPrice = await fetchTrxPrice();

  // Calculate output based on TRX price
  let outputAmount: number;
  let priceImpactPct: number;

  if (inputUpper === "TRX") {
    // Selling TRX for USDT/USDC
    if (outputUpper === "USDT" || outputUpper === "USDC") {
      // TRX → stablecoin: rate = TRX price in USD (1:1 for stables)
      outputAmount = amount * trxPrice * 0.997; // 0.3% SunSwap fee
      priceImpactPct = Math.min((amount * trxPrice / 10_000) * 100, 5);
    } else {
      // TRX → other token (future support)
      outputAmount = amount * trxPrice * 0.99;
      priceImpactPct = 1;
    }
  } else {
    // Buying TRX with USDT/USDC
    if (outputUpper === "TRX") {
      outputAmount = (amount / trxPrice) * 0.997;
      priceImpactPct = Math.min((amount / 10_000) * 100, 5);
    } else {
      outputAmount = (amount / trxPrice) * 0.99;
      priceImpactPct = 1;
    }
  }

  return { outputAmount, priceImpactPct, trxPrice };
}

// ── Swap Execution (Paper Mode) ─────────────────────────────────────────

/**
 * Simulate a TRON DEX swap via SunSwap.
 * In paper mode: fetches real TRX price but does not sign/submit.
 * Returns the simulated swap result with real price data.
 */
export async function tronSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
): Promise<TronSwapResult> {
  const inputUpper = inputSymbol.toUpperCase();
  const outputUpper = outputSymbol.toUpperCase();

  try {
    const { outputAmount, priceImpactPct } = await getTronSwapQuote(
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

export interface TronPaperBalance {
  trx: number;
  usdt: number;
  usdc: number;
}

let paperBalances: TronPaperBalance = {
  trx: 10000,
  usdt: 10000,
  usdc: 10000,
};

export { paperBalances as tronPaperBalances };

/**
 * Execute a paper-mode swap that updates simulated balances.
 */
export async function tronPaperSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
): Promise<TronSwapResult & { updatedBalances: TronPaperBalance }> {
  const result = await tronSwap(inputSymbol, outputSymbol, amount);

  if (result.success) {
    const inputUpper = inputSymbol.toUpperCase();
    const outputUpper = outputSymbol.toUpperCase();
    const inputKey = inputUpper.toLowerCase() as keyof TronPaperBalance;
    const outputKey = outputUpper.toLowerCase() as keyof TronPaperBalance;

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
export function getTronPaperBalances(): TronPaperBalance {
  return { ...paperBalances };
}

/**
 * Reset paper balances to defaults.
 */
export function resetTronPaperBalances(): void {
  paperBalances = { trx: 10000, usdt: 10000, usdc: 10000 };
}

// ── Token Price Fetching ────────────────────────────────────────────────

export { fetchTrxPrice } from "./tron-wallet";

/**
 * Get estimated USD value of TRX tokens.
 */
export function estimateTrxValue(trxAmount: number, trxPrice: number): number {
  return trxAmount * trxPrice;
}

// ── DexAdapter-compatible interface ─────────────────────────────────────

/**
 * Interface compatible with the existing DexAdapter pattern.
 */
export class TronDexAdapter {
  name = "SunSwap (TRON)";
  isEnabled = true;
  isLive = false;
  isPaper = true;

  async swap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<TronSwapResult> {
    return tronSwap(inputSymbol, outputSymbol, amount);
  }

  async paperSwap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<TronSwapResult & { updatedBalances: TronPaperBalance }> {
    return tronPaperSwap(inputSymbol, outputSymbol, amount);
  }

  getBalances(): TronPaperBalance {
    return getTronPaperBalances();
  }

  async getTronAddress(): Promise<string> {
    return getTronAddress();
  }

  async getTrxBalance(): Promise<number> {
    const info = await getTronBalance();
    return info.balanceTrx;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

let instance: TronDexAdapter | null = null;

export function getTronDexAdapter(): TronDexAdapter {
  if (!instance) {
    instance = new TronDexAdapter();
  }
  return instance;
}
