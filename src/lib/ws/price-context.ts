// ── Price Context Provider ──────────────────────────────────────────
// Wraps market-data WebSocket manager with a shared PriceContext.
// Provides synchronous cache reads, reactive subscriptions, and
// historical data from the in-memory ring buffer.
//
// This replaces direct CoinGecko REST calls for agent price feeds.

import {
  getPrice as wsGetPrice,
  getPriceEntry,
  subscribeToPrices as wsSubscribe,
  getPriceHistory as wsGetHistory,
  startMarketData,
  stopMarketData,
  getMarketDataState,
  type PriceTick,
  type PriceCallback,
} from "./market-data";
import { getRobustMultiPrices } from "../price-feeds";

// Re-export types for consumers
export type { PriceTick, PriceCallback } from "./market-data";

// ── Default symbols to track ──────────────────────────────────────

export const DEFAULT_SYMBOLS = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE",
  "AVAX", "DOT", "MATIC", "LINK", "UNI", "AAVE",
  "ARB", "OP", "NEAR", "SUI", "APT",
];

// ── Startup flag ──────────────────────────────────────────────────

let started = false;

/**
 * Initialize the price context and start WebSocket streams.
 * Idempotent — safe to call multiple times.
 */
export function initPriceContext(symbols?: string[]): void {
  if (started) return;
  started = true;

  const syms = symbols ?? DEFAULT_SYMBOLS;
  console.log(`[PriceContext] Initializing with ${syms.length} symbols...`);
  startMarketData(syms);
}

/**
 * Shutdown the price context.
 */
export function shutdownPriceContext(): void {
  if (!started) return;
  stopMarketData();
  started = false;
}

/**
 * Get the latest price for a symbol (synchronous cache read).
 * Returns null if no data yet.
 */
export function getPrice(symbol: string): number | null {
  return wsGetPrice(symbol);
}

/**
 * Get multiple prices at once from cache.
 * Uses CoinGecko REST as fallback for symbols not in WebSocket cache.
 */
export async function getPrices(symbols: string[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();

  const wsSymbols: string[] = [];
  const missing: string[] = [];

  for (const sym of symbols) {
    const upper = sym.toUpperCase();
    const price = wsGetPrice(upper);
    if (price !== null) {
      result.set(upper, price);
      wsSymbols.push(upper);
    } else {
      missing.push(upper);
    }
  }

  // Try CoinGecko fallback for missing symbols
  if (missing.length > 0) {
    const cgIds = missing
      .map((s) => {
        // Map common symbols to CoinGecko IDs
        const map: Record<string, string> = {
          BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
          XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", AVAX: "avalanche-2",
          DOT: "polkadot", MATIC: "matic-network", LINK: "chainlink", UNI: "uniswap",
          AAVE: "aave", ARB: "arbitrum", OP: "optimism", NEAR: "near", SUI: "sui", APT: "aptos",
        };
        return map[s] ?? s.toLowerCase();
      })
      .filter(Boolean);

    if (cgIds.length > 0) {
      try {
        const prices = await getRobustMultiPrices(cgIds);
        for (const sym of missing) {
          const cgId = ({ BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", AVAX: "avalanche-2", DOT: "polkadot", MATIC: "matic-network", LINK: "chainlink", UNI: "uniswap", AAVE: "aave", ARB: "arbitrum", OP: "optimism", NEAR: "near", SUI: "sui", APT: "aptos" } as Record<string, string>)[sym];
          if (cgId && prices[cgId]) {
            result.set(sym, prices[cgId]!.usd);
          } else {
            result.set(sym, null);
          }
        }
      } catch (err) {
        console.warn("[PriceContext] getPrices fallback failed:", err);
        for (const sym of missing) {
          result.set(sym, null);
        }
      }
    }
  }

  return result;
}

/**
 * Get the cached price along with its timestamp.
 */
export function getPriceWithTimestamp(symbol: string): { price: number; timestamp: number } | null {
  return getPriceEntry(symbol);
}

/**
 * Subscribe to real-time price ticks.
 * Returns an unsubscribe function.
 */
export function subscribeToPrices(callback: PriceCallback): () => void {
  return wsSubscribe(callback);
}

/**
 * Get price history from the ring buffer (last N ticks).
 */
export function getPriceHistory(symbol: string, limit = 100): PriceTick[] {
  return wsGetHistory(symbol, limit);
}

/**
 * Get the market data connection state.
 */
export function getState() {
  return getMarketDataState();
}

/**
 * Check if price context is initialized and receiving data.
 */
export function isInitialized(): boolean {
  return started;
}

/**
 * Get a map of all cached prices (symbol → price).
 */
export function getAllCachedPrices(): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const sym of DEFAULT_SYMBOLS) {
    const price = wsGetPrice(sym);
    if (price !== null) {
      prices[sym] = price;
    }
  }
  return prices;
}
