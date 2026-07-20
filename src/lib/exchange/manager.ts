// ── Exchange Manager ─────────────────────────────────────────────────
// Central registry for all exchange adapters. Handles ON/OFF toggles,
// best-price queries across exchanges, and arbitrage detection.
//
// Exchanges register themselves; manager queries only enabled ones.

import type {
  ExchangeAdapter,
  ExchangeRole,
  ArbitrageOpportunity,
  ExchangeConfig,
  OrderBook,
  OrderRequest,
  OrderResult,
  Balance,
  Order,
} from "./types";
import { getBinanceAdapter } from "./binance";
import { getBitunixAdapter } from "./bitunix";
import { getDexAdapter } from "./dex";
import { createServerFn } from "@tanstack/react-start";

// ── Exchange Registry ──────────────────────────────────────────────

const exchanges = new Map<string, ExchangeAdapter>();

// Register built-in exchanges
exchanges.set("binance", getBinanceAdapter());
exchanges.set("bitunix", getBitunixAdapter());
exchanges.set("dex", getDexAdapter());

// Placeholder entries for to-be-built exchanges
const PLACEHOLDER_EXCHANGES: ExchangeConfig[] = [
  { exchangeId: "bybit", name: "Bybit", role: "data", enabled: false, isLive: false, apiKeyConfigured: false },
  { exchangeId: "coinbase", name: "Coinbase", role: "data", enabled: false, isLive: false, apiKeyConfigured: false },
];

// ── Exchange Config Store ──────────────────────────────────────────

const exchangeConfigs = new Map<string, ExchangeConfig>();

function ensureConfig(exchangeId: string): ExchangeConfig {
  let config = exchangeConfigs.get(exchangeId);
  if (!config) {
    const adapter = exchanges.get(exchangeId);
    const placeholder = PLACEHOLDER_EXCHANGES.find((p) => p.exchangeId === exchangeId);
    config = {
      exchangeId,
      name: adapter?.name ?? placeholder?.name ?? exchangeId,
      role: adapter?.role ?? placeholder?.role ?? "both",
      enabled: adapter?.isEnabled ?? placeholder?.enabled ?? false,
      isLive: adapter?.isLive ?? false,
      apiKeyConfigured: adapter?.isLive ?? false,
    };
    exchangeConfigs.set(exchangeId, config);
  }
  return config;
}

// Sync adapter state to config
function syncAdapterToConfig(exchangeId: string): void {
  const adapter = exchanges.get(exchangeId);
  if (!adapter) return;
  exchangeConfigs.set(exchangeId, {
    exchangeId,
    name: adapter.name,
    role: adapter.role,
    enabled: adapter.isEnabled,
    isLive: adapter.isLive,
    apiKeyConfigured: adapter.isLive,
  });
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Register a new exchange adapter at runtime.
 */
export function registerExchange(id: string, adapter: ExchangeAdapter): void {
  exchanges.set(id, adapter);
  syncAdapterToConfig(id);
}

/**
 * Get all exchange configurations (including placeholders).
 */
export function getAllExchangeConfigs(): ExchangeConfig[] {
  const configs: ExchangeConfig[] = [];

  for (const [id] of exchanges) {
    configs.push(ensureConfig(id));
  }

  for (const placeholder of PLACEHOLDER_EXCHANGES) {
    if (!exchanges.has(placeholder.exchangeId)) {
      configs.push({ ...placeholder, enabled: exchangeConfigs.get(placeholder.exchangeId)?.enabled ?? placeholder.enabled });
    }
  }

  return configs;
}

/**
 * Get only enabled exchange adapters.
 * @param role Optional filter — returns only exchanges matching the given role.
 */
export function getActiveExchanges(role?: ExchangeRole): ExchangeAdapter[] {
  const active: ExchangeAdapter[] = [];
  for (const [id, adapter] of exchanges) {
    const config = ensureConfig(id);
    if (!config.enabled) continue;
    if (role && adapter.role !== role && adapter.role !== "both") continue;
    active.push(adapter);
  }
  return active;
}

/**
 * Get only exchanges with trading capability (role "trading" or "both").
 */
export function getTradingExchanges(): ExchangeAdapter[] {
  return getActiveExchanges("trading");
}

/**
 * Get only exchanges with data capability (role "data" or "both").
 */
export function getDataExchanges(): ExchangeAdapter[] {
  return getActiveExchanges("data");
}

/**
 * Toggle an exchange ON/OFF.
 */
export function setExchangeEnabled(exchangeId: string, enabled: boolean): ExchangeConfig {
  const adapter = exchanges.get(exchangeId);
  if (adapter) {
    adapter.setEnabled(enabled);
    syncAdapterToConfig(exchangeId);
    return ensureConfig(exchangeId);
  }

  // Handle placeholder exchanges (Bybit, Coinbase)
  const placeholder = PLACEHOLDER_EXCHANGES.find((p) => p.exchangeId === exchangeId);
  if (placeholder) {
    placeholder.enabled = enabled;
    const config = ensureConfig(exchangeId);
    config.enabled = enabled;
    exchangeConfigs.set(exchangeId, config);
    return config;
  }

  throw new Error(`Exchange "${exchangeId}" not found`);
}

/**
 * Get the adapter for a specific exchange.
 */
export function getExchange(id: string): ExchangeAdapter | null {
  return exchanges.get(id) ?? null;
}

// ── Best Price Query ───────────────────────────────────────────────

/**
 * Query all active exchanges for the best price on a symbol.
 * Returns the best bid (highest) and best ask (lowest) across exchanges.
 */
export async function getBestPrice(symbol: string): Promise<{
  bestBid: { price: number; exchange: string };
  bestAsk: { price: number; exchange: string };
  prices: { exchange: string; price: number }[];
}> {
  const active = getActiveExchanges();
  const prices: { exchange: string; price: number }[] = [];

  for (const adapter of active) {
    try {
      const price = await adapter.getPrice(symbol);
      prices.push({ exchange: adapter.name, price });
    } catch (err) {
      console.warn(`[ExchangeManager] ${adapter.name} price fetch failed for ${symbol}:`, err);
    }
  }

  if (prices.length === 0) {
    throw new Error(`No active exchange returned a price for ${symbol}`);
  }

  const bestBid = prices.reduce((best, p) => (p.price > best.price ? p : best), prices[0]);
  const bestAsk = prices.reduce((best, p) => (p.price < best.price ? p : best), prices[0]);

  return {
    bestBid: { price: bestBid.price, exchange: bestBid.exchange },
    bestAsk: { price: bestAsk.price, exchange: bestAsk.exchange },
    prices,
  };
}

// ── Arbitrage Detection ────────────────────────────────────────────

/**
 * Scan all active exchanges for arbitrage opportunities on a symbol.
 * An arbitrage exists when the lowest ask on one exchange is lower than
 * the highest bid on another, after accounting for fees.
 */
export async function detectArbitrage(
  symbol: string,
  minSpreadPct = 0.3,
): Promise<ArbitrageOpportunity[]> {
  const active = getActiveExchanges();
  if (active.length < 2) return [];

  const opportunities: ArbitrageOpportunity[] = [];

  // Get order books from all exchanges
  const books: { exchange: string; adapter: ExchangeAdapter; book: OrderBook | null }[] = [];

  for (const adapter of active) {
    try {
      const book = await adapter.getOrderBook(symbol, 5);
      books.push({ exchange: adapter.name, adapter, book });
    } catch (err) {
      console.warn(`[ExchangeManager] ${adapter.name} order book fetch failed:`, err);
    }
  }

  // Compare each pair of exchanges
  for (let i = 0; i < books.length; i++) {
    for (let j = i + 1; j < books.length; j++) {
      const a = books[i];
      const b = books[j];

      if (!a.book?.asks.length || !b.book?.bids.length) continue;

      // Check: buy on exchange A (lowest ask) → sell on exchange B (highest bid)
      const buyPrice = a.book.asks[0].price;
      const sellPrice = b.book.bids[0].price;

      const spread = ((sellPrice - buyPrice) / buyPrice) * 100;
      const effectiveSpread = spread - 0.2; // deduct 0.1% fee per side

      if (effectiveSpread >= minSpreadPct) {
        opportunities.push({
          buyExchange: a.exchange,
          sellExchange: b.exchange,
          symbol,
          buyPrice,
          sellPrice,
          spreadPct: Math.round(effectiveSpread * 1000) / 1000,
          potentialProfit: effectiveSpread,
          timestamp: Date.now(),
        });
      }

      // Check reverse: buy on B → sell on A
      if (a.book?.bids.length && b.book?.asks.length) {
        const buyPriceB = b.book.asks[0].price;
        const sellPriceA = a.book.bids[0].price;
        const spreadB = ((sellPriceA - buyPriceB) / buyPriceB) * 100;
        const effectiveSpreadB = spreadB - 0.2;

        if (effectiveSpreadB >= minSpreadPct) {
          opportunities.push({
            buyExchange: b.exchange,
            sellExchange: a.exchange,
            symbol,
            buyPrice: buyPriceB,
            sellPrice: sellPriceA,
            spreadPct: Math.round(effectiveSpreadB * 1000) / 1000,
            potentialProfit: effectiveSpreadB,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  // Sort by highest spread first
  opportunities.sort((a, b) => b.spreadPct - a.spreadPct);
  return opportunities;
}

// ── Server Functions ───────────────────────────────────────────────

export const getExchangeConfigs = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExchangeConfig[]> => {
    return getAllExchangeConfigs();
  },
);

export const toggleExchange = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { exchangeId: string; enabled: boolean } }): Promise<ExchangeConfig> => {
    return setExchangeEnabled(data.exchangeId, data.enabled);
  },
);

export const queryBestPrice = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { symbol: string } }) => {
    return getBestPrice(data.symbol);
  },
);

export const scanArbitrage = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { symbol: string; minSpreadPct?: number } }) => {
    return detectArbitrage(data.symbol, data.minSpreadPct);
  },
);

// ── Aggregate Exchange Operations ──────────────────────────────────

/**
 * Place an order on the best-priced trading exchange for the given symbol.
 * Only uses exchanges with role "trading" or "both".
 */
export async function placeOrderBestExchange(order: OrderRequest): Promise<OrderResult> {
  const trading = getTradingExchanges();
  if (trading.length === 0) throw new Error("No trading-capable exchanges active");

  // Get prices from all exchanges
  let bestExchange: ExchangeAdapter | null = null;
  let bestPrice = order.side === "BUY" ? Infinity : -Infinity;

  for (const adapter of trading) {
    try {
      const price = await adapter.getPrice(order.symbol);
      if (order.side === "BUY" && price < bestPrice) {
        bestPrice = price;
        bestExchange = adapter;
      } else if (order.side === "SELL" && price > bestPrice) {
        bestPrice = price;
        bestExchange = adapter;
      }
    } catch (err) {
      console.warn("[ExchangeManager] smartRoute price check failed:", err);
      // skip failed exchanges
    }
  }

  if (!bestExchange) throw new Error("No exchange returned a valid price");

  return bestExchange.placeOrder(order);
}

/**
 * Get aggregated balances across all active exchanges.
 */
export async function getAggregatedBalance(): Promise<Balance> {
  const active = getActiveExchanges();
  const assetMap = new Map<string, AssetBalance>();

  for (const adapter of active) {
    try {
      const balance = await adapter.getBalance();
      for (const asset of balance.assets) {
        const existing = assetMap.get(asset.asset);
        if (existing) {
          existing.free += asset.free;
          existing.locked += asset.locked;
          existing.usdValue += asset.usdValue;
        } else {
          assetMap.set(asset.asset, { ...asset });
        }
      }
    } catch (err) {
      console.warn(`[ExchangeManager] ${adapter.name} balance fetch failed:`, err);
    }
  }

  const assets = Array.from(assetMap.values());
  const totalUsd = assets.reduce((sum, a) => sum + a.usdValue, 0);

  return {
    assets,
    totalUsdValue: totalUsd,
    timestamp: Date.now(),
    isPaper: true,
  };
}
