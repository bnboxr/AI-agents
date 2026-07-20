// ── XRP DEX Integration — XRPL Native Order Book ─────────────────────
// Uses XRPL's native order book DEX (book_offers RPC).
// Supported pairs: XRP/USD (via USD gateway), XRP/BTC
// Paper mode: real order book quotes from XRPL.
// Integrates with existing DexAdapter pattern.

import { getXrpAddress, getXrpBalance, fetchXrpPrice } from "./xrp-wallet";

// @ts-expect-error — xrpl types
import { Client } from "xrpl";

// ── Types ──────────────────────────────────────────────────────────────

export interface XrpOrderBookLevel {
  price: number;
  amount: number; // in XRP
  total: number;  // cumulative
}

export interface XrpOrderBook {
  bids: XrpOrderBookLevel[];
  asks: XrpOrderBookLevel[];
  spread: number;
  midPrice: number;
}

export interface XrpSwapResult {
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

export const XRP_PAIRS = [
  { base: "XRP", quote: "USD", baseName: "XRP", quoteName: "USD" },
  { base: "XRP", quote: "BTC", baseName: "XRP", quoteName: "BTC" },
] as const;

export interface XrpPair {
  base: string;
  quote: string;
  baseName: string;
  quoteName: string;
}

// ── XRPL Native DEX Constants ──────────────────────────────────────────

// Bitstamp USD issuer on XRPL (well-known gateway)
const BITSTAMP_USD_ISSUER = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
const BITSTAMP_BTC_ISSUER = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";

// XRP native currency (no issuer)
const XRP_CURRENCY = "XRP";

// Default XRPL RPC
const DEFAULT_XRPL_RPC = "wss://s1.ripple.com";

// ── Order Book Fetching ────────────────────────────────────────────────

/**
 * Fetch the XRPL native order book for a given pair.
 * Uses the `book_offers` RPC command.
 */
export async function getXrpOrderBook(
  baseCurrency: string,
  quoteCurrency: string,
  rpcUrl?: string,
  limit = 20,
): Promise<XrpOrderBook> {
  const client = new Client(rpcUrl ?? DEFAULT_XRPL_RPC);

  try {
    await client.connect();

    // Determine the taker_gets / taker_pays based on the pair
    // For XRP/USD: taker_gets = XRP, taker_pays = USD (Bitstamp)
    let takerGets: Record<string, unknown>;
    let takerPays: Record<string, unknown>;

    if (baseCurrency === "XRP") {
      takerGets = { currency: XRP_CURRENCY };
    } else if (baseCurrency === "BTC") {
      takerGets = { currency: baseCurrency, issuer: BITSTAMP_BTC_ISSUER };
    } else {
      takerGets = { currency: baseCurrency, issuer: BITSTAMP_USD_ISSUER };
    }

    if (quoteCurrency === "XRP") {
      takerPays = { currency: XRP_CURRENCY };
    } else if (quoteCurrency === "BTC") {
      takerPays = { currency: quoteCurrency, issuer: BITSTAMP_BTC_ISSUER };
    } else {
      takerPays = { currency: quoteCurrency, issuer: BITSTAMP_USD_ISSUER };
    }

    const response = await client.request({
      command: "book_offers",
      taker_gets: takerGets as any,
      taker_pays: takerPays as any,
      limit,
    });

    const offers = (response.result as Record<string, unknown>).offers as Array<Record<string, unknown>>;

    // Parse bids (buying base, paying quote) and asks (selling base, getting quote)
    const bids: XrpOrderBookLevel[] = [];
    const asks: XrpOrderBookLevel[] = [];
    let bidTotal = 0;
    let askTotal = 0;

    if (offers) {
      for (const offer of offers) {
        const takerGetsAmount = typeof offer.TakerGets === "string"
          ? Number(offer.TakerGets)
          : typeof offer.TakerGets === "object" && offer.TakerGets
            ? Number((offer.TakerGets as Record<string, unknown>).value ?? 0)
            : 0;
        const takerPaysAmount = typeof offer.TakerPays === "string"
          ? Number(offer.TakerPays)
          : typeof offer.TakerPays === "object" && offer.TakerPays
            ? Number((offer.TakerPays as Record<string, unknown>).value ?? 0)
            : 0;

        if (takerGetsAmount <= 0 || takerPaysAmount <= 0) continue;

        const price = takerPaysAmount / takerGetsAmount;

        // XRPL book_offers returns asks (selling base for quote)
        const level: XrpOrderBookLevel = {
          price,
          amount: takerGetsAmount / 1_000_000, // drops → XRP
          total: 0,
        };

        askTotal += level.amount;
        level.total = askTotal;
        asks.push(level);
      }
    }

    // Now fetch bids (reverse direction)
    const bidResponse = await client.request({
      command: "book_offers",
      taker_gets: takerPays as any,
      taker_pays: takerGets as any,
      limit,
    });

    const bidOffers = (bidResponse.result as Record<string, unknown>).offers as Array<Record<string, unknown>>;
    if (bidOffers) {
      for (const offer of bidOffers) {
        const takerGetsAmount = typeof offer.TakerGets === "string"
          ? Number(offer.TakerGets)
          : typeof offer.TakerGets === "object" && offer.TakerGets
            ? Number((offer.TakerGets as Record<string, unknown>).value ?? 0)
            : 0;
        const takerPaysAmount = typeof offer.TakerPays === "string"
          ? Number(offer.TakerPays)
          : typeof offer.TakerPays === "object" && offer.TakerPays
            ? Number((offer.TakerPays as Record<string, unknown>).value ?? 0)
            : 0;

        if (takerGetsAmount <= 0 || takerPaysAmount <= 0) continue;

        const price = takerGetsAmount / takerPaysAmount; // bid price: how much quote to buy 1 base

        const level: XrpOrderBookLevel = {
          price,
          amount: takerPaysAmount / 1_000_000,
          total: 0,
        };

        bidTotal += level.amount;
        level.total = bidTotal;
        bids.push(level);
      }
    }

    // Sort bids descending, asks ascending
    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);

    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const spread = bestAsk > 0 ? bestAsk - bestBid : 0;
    const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk);

    return { bids, asks, spread, midPrice };
  } catch (err) {
    console.warn("[XrpDex] Failed to fetch order book:", (err as Error).message);
    return { bids: [], asks: [], spread: 0, midPrice: 0 };
  } finally {
    try { await client.disconnect(); } catch { /* ignore */ }
  }
}

// ── Swap Execution (Paper Mode) ─────────────────────────────────────────

/**
 * Simulate an XRPL DEX swap.
 * In paper mode: fetches real order book quotes but does not sign/submit.
 * Returns the simulated swap result with real price data.
 */
export async function xrpSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
  rpcUrl?: string,
): Promise<XrpSwapResult> {
  const inputUpper = inputSymbol.toUpperCase();
  const outputUpper = outputSymbol.toUpperCase();

  try {
    const orderBook = await getXrpOrderBook(inputUpper, outputUpper, rpcUrl);

    if (orderBook.midPrice <= 0) {
      return {
        success: false,
        inputToken: inputUpper,
        outputToken: outputUpper,
        inputAmount: amount,
        outputAmount: 0,
        priceImpactPct: 0,
        error: "No liquidity available",
        isPaper: true,
      };
    }

    // Calculate output based on mid price with 0.3% fee
    const feeMultiplier = 0.997;
    let outputAmount: number;
    let priceImpactPct: number;

    if (inputUpper === "XRP") {
      // Selling XRP for quote
      outputAmount = amount * orderBook.midPrice * feeMultiplier;

      // Simulate price impact based on order book depth
      const askDepth = orderBook.asks.reduce((sum, a) => sum + a.amount, 0);
      priceImpactPct = askDepth > 0
        ? Math.min((amount / askDepth) * 2, 10) // crude impact model
        : 1;
    } else {
      // Buying XRP with quote
      outputAmount = (amount / orderBook.midPrice) * feeMultiplier;

      const bidDepth = orderBook.bids.reduce((sum, b) => sum + b.amount, 0);
      priceImpactPct = bidDepth > 0
        ? Math.min((outputAmount / bidDepth) * 2, 10)
        : 1;
    }

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

// ── Paper Mode Swap (with simulated balance) ────────────────────────────

export interface PaperBalance {
  xrp: number;
  usd: number;
  btc: number;
}

let paperBalances: PaperBalance = {
  xrp: 1000,
  usd: 10000,
  btc: 0.1,
};

export { paperBalances as xrpPaperBalances };

/**
 * Execute a paper-mode swap that updates simulated balances.
 * Uses real XRPL order book quotes for price discovery.
 */
export async function xrpPaperSwap(
  inputSymbol: string,
  outputSymbol: string,
  amount: number,
  rpcUrl?: string,
): Promise<XrpSwapResult & { updatedBalances: PaperBalance }> {
  const result = await xrpSwap(inputSymbol, outputSymbol, amount, rpcUrl);

  if (result.success) {
    const inputUpper = inputSymbol.toUpperCase();
    const outputUpper = outputSymbol.toUpperCase();
    const inputKey = inputUpper.toLowerCase() as keyof PaperBalance;
    const outputKey = outputUpper.toLowerCase() as keyof PaperBalance;

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
export function getXrpPaperBalances(): PaperBalance {
  return { ...paperBalances };
}

/**
 * Reset paper balances to defaults.
 */
export function resetXrpPaperBalances(): void {
  paperBalances = { xrp: 1000, usd: 10000, btc: 0.1 };
}

// ── Token Price Fetching ────────────────────────────────────────────────

export { fetchXrpPrice } from "./xrp-wallet";

/**
 * Get estimated USD value of XRP tokens.
 */
export function estimateXrpValue(xrpAmount: number, xrpPrice: number): number {
  return xrpAmount * xrpPrice;
}

// ── DexAdapter-compatible interface ─────────────────────────────────────

/**
 * Interface compatible with the existing DexAdapter pattern.
 */
export class XrpDexAdapter {
  name = "XRPL Native DEX";
  isEnabled = true;
  isLive = false;
  isPaper = true;

  async getOrderBook(base: string, quote: string): Promise<XrpOrderBook> {
    return getXrpOrderBook(base, quote);
  }

  async swap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<XrpSwapResult> {
    return xrpSwap(inputSymbol, outputSymbol, amount);
  }

  async paperSwap(
    inputSymbol: string,
    outputSymbol: string,
    amount: number,
  ): Promise<XrpSwapResult & { updatedBalances: PaperBalance }> {
    return xrpPaperSwap(inputSymbol, outputSymbol, amount);
  }

  getBalances(): PaperBalance {
    return getXrpPaperBalances();
  }

  async getXrpAddress(): Promise<string> {
    return getXrpAddress();
  }

  async getXrpBalance(): Promise<number> {
    const info = await getXrpBalance();
    return info.balanceXrp;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

let instance: XrpDexAdapter | null = null;

export function getXrpDexAdapter(): XrpDexAdapter {
  if (!instance) {
    instance = new XrpDexAdapter();
  }
  return instance;
}
