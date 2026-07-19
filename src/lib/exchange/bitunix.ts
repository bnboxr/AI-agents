// ── Bitunix Exchange Adapter ─────────────────────────────────────────
// Bitunix REST: https://api.bitunix.com/api/v1
// WebSocket: wss://ws.bitunix.com/ws
// Paper mode default — no real API keys needed.

import type {
  ExchangeAdapter,
  OrderBook,
  OrderBookLevel,
  OrderRequest,
  OrderResult,
  Balance,
  AssetBalance,
  Order,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────

const BITUNIX_REST = "https://api.bitunix.com/api/v1";
const BITUNIX_WS = "wss://ws.bitunix.com/ws";
const REQUEST_TIMEOUT = 8_000;

// ── Bitunix Symbol Mapping ─────────────────────────────────────────

// Bitunix uses "/" separator in symbols: "BTC/USDT"
function getBitunixPair(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper.includes("/")) return upper;
  if (upper.endsWith("USDT")) {
    const base = upper.slice(0, -4);
    return `${base}/USDT`;
  }
  return `${upper}/USDT`;
}

function getRawSymbol(bitunixPair: string): string {
  return bitunixPair.replace("/", "");
}

// ── Paper Trading State ────────────────────────────────────────────

const paperOrders = new Map<string, Order>();
const paperBalances: AssetBalance[] = [
  { asset: "USDT", free: 100_000, locked: 0, usdValue: 100_000 },
  { asset: "BTC", free: 0.8, locked: 0, usdValue: 0 },
  { asset: "ETH", free: 10, locked: 0, usdValue: 0 },
  { asset: "SOL", free: 150, locked: 0, usdValue: 0 },
  { asset: "XRP", free: 10_000, locked: 0, usdValue: 0 },
];
let paperOrderCounter = 0;

// ── Helpers ────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Real price fetch from Bitunix REST ─────────────────────────────

async function fetchBitunixPrice(symbol: string): Promise<number> {
  const pair = getBitunixPair(symbol);
  const rawPair = getRawSymbol(pair);

  try {
    // Try Bitunix REST API
    const res = await fetchWithTimeout(
      `${BITUNIX_REST}/market/ticker?symbol=${rawPair}`,
    );
    if (res.ok) {
      const data = await res.json() as { data?: { last?: string; close?: string } };
      const price = parseFloat(data?.data?.last ?? data?.data?.close ?? "0");
      if (price > 0) return price;
    }
    // Fallback: try CoinGecko-style pricing via existing infrastructure
    const fallbackRes = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${getCoingeckoId(pair)}&vs_currencies=usd`,
    );
    if (fallbackRes.ok) {
      const fbData = await fallbackRes.json() as Record<string, { usd: number }>;
      const cgId = getCoingeckoId(pair);
      if (fbData[cgId]?.usd) return fbData[cgId].usd;
    }
  } catch {
    // Fall through to final fallback
  }

  throw new Error(`No price available for ${symbol} on Bitunix`);
}

function getCoingeckoId(pair: string): string {
  const base = pair.split("/")[0]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    btc: "bitcoin", eth: "ethereum", sol: "solana", bnb: "binancecoin",
    xrp: "ripple", ada: "cardano", doge: "dogecoin", avax: "avalanche-2",
    dot: "polkadot", matic: "matic-network", link: "chainlink",
    uni: "uniswap", aave: "aave", arb: "arbitrum", op: "optimism",
    near: "near", sui: "sui", apt: "aptos",
  };
  return map[base] ?? base;
}

// ── Paper Trading Engine ───────────────────────────────────────────

async function paperPlaceOrder(orderReq: OrderRequest): Promise<OrderResult> {
  const pair = getBitunixPair(orderReq.symbol);
  let fillPrice: number;

  try {
    fillPrice = await fetchBitunixPrice(pair);
  } catch {
    // Fallback: use a simulated price for paper trading
    fillPrice = getFallbackPrice(pair);
  }

  // Apply realistic slippage (0.08% — Bitunix has wider spreads typically)
  const slippage = orderReq.type === "MARKET" ? 0.0008 : 0;
  const slippageDir = orderReq.side === "BUY" ? 1 : -1;
  const execPrice = fillPrice * (1 + slippage * slippageDir);

  paperOrderCounter++;
  const orderId = `paper_bitunix_${Date.now()}_${paperOrderCounter}`;

  const order: Order = {
    orderId,
    symbol: pair,
    side: orderReq.side,
    type: orderReq.type,
    quantity: orderReq.quantity,
    filledQuantity: orderReq.quantity,
    price: orderReq.price ?? execPrice,
    avgPrice: execPrice,
    status: "FILLED",
    timestamp: Date.now(),
    isPaper: true,
  };

  paperOrders.set(orderId, order);

  // Update paper balances
  const quoteAmount = orderReq.quantity * execPrice;
  const baseAsset = pair.split("/")[0] ?? "UNKNOWN";
  const quoteAsset = "USDT";

  let baseBal = paperBalances.find((b) => b.asset === baseAsset);
  let quoteBal = paperBalances.find((b) => b.asset === quoteAsset);

  if (!baseBal) {
    baseBal = { asset: baseAsset, free: 0, locked: 0, usdValue: 0 };
    paperBalances.push(baseBal);
  }
  if (!quoteBal) {
    quoteBal = { asset: quoteAsset, free: 0, locked: 0, usdValue: 0 };
    paperBalances.push(quoteBal);
  }

  if (orderReq.side === "BUY") {
    quoteBal.free -= quoteAmount;
    baseBal.free += orderReq.quantity;
  } else {
    baseBal.free -= orderReq.quantity;
    quoteBal.free += quoteAmount;
  }

  const result: OrderResult = {
    orderId,
    symbol: pair,
    side: orderReq.side,
    type: orderReq.type,
    quantity: orderReq.quantity,
    filledQuantity: orderReq.quantity,
    avgPrice: execPrice,
    status: "FILLED",
    fee: quoteAmount * 0.001, // 0.1% fee
    feeAsset: "USDT",
    timestamp: Date.now(),
    isPaper: true,
  };

  return result;
}

// Fallback prices for paper trading when APIs are unavailable
function getFallbackPrice(pair: string): number {
  const base = pair.split("/")[0] ?? "";
  const fallbacks: Record<string, number> = {
    BTC: 67_000, ETH: 3_500, SOL: 170, BNB: 600, XRP: 0.60,
    ADA: 0.45, DOGE: 0.12, AVAX: 35, DOT: 7, MATIC: 0.70,
    LINK: 14, UNI: 8, AAVE: 100, ARB: 1.2, OP: 2.5,
    NEAR: 5, SUI: 1.5, APT: 9,
  };
  return fallbacks[base] ?? 100;
}

// ── BitunixAdapter Class ───────────────────────────────────────────

class BitunixAdapter implements ExchangeAdapter {
  name = "Bitunix";
  wsEndpoint = BITUNIX_WS;
  isEnabled = true;
  isLive = false;
  private apiKey: string | null = null;
  private secretKey: string | null = null;

  constructor() {
    this.apiKey = process.env.BITUNIX_API_KEY ?? null;
    this.secretKey = process.env.BITUNIX_SECRET_KEY ?? null;
    this.isLive = !!(this.apiKey && this.secretKey);
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  async getPrice(symbol: string): Promise<number> {
    return fetchBitunixPrice(symbol);
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const pair = getBitunixPair(symbol);
    const rawPair = getRawSymbol(pair);

    try {
      const res = await fetchWithTimeout(
        `${BITUNIX_REST}/market/depth?symbol=${rawPair}&limit=${Math.min(depth, 50)}`,
      );
      if (!res.ok) {
        throw new Error(`Bitunix order book fetch failed: ${res.status}`);
      }
      const data = await res.json() as {
        data?: { bids?: [string, string][]; asks?: [string, string][] };
      };

      const bids: OrderBookLevel[] = (data?.data?.bids ?? []).map(
        ([price, qty]) => ({
          price: parseFloat(price),
          quantity: parseFloat(qty),
        }),
      );
      const asks: OrderBookLevel[] = (data?.data?.asks ?? []).map(
        ([price, qty]) => ({
          price: parseFloat(price),
          quantity: parseFloat(qty),
        }),
      );

      return { symbol: rawPair, bids, asks, timestamp: Date.now() };
    } catch (err) {
      console.error(`[Bitunix] OrderBook error for ${rawPair}:`, err);
      return { symbol: rawPair, bids: [], asks: [], timestamp: Date.now() };
    }
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    if (!this.isLive) {
      return paperPlaceOrder(order);
    }
    throw new Error("Live Bitunix trading not yet implemented. Use paper mode.");
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = paperOrders.get(orderId);
    if (order) {
      order.status = "CANCELLED";
      paperOrders.set(orderId, order);
      return;
    }
    throw new Error(`Order ${orderId} not found or live cancellation not implemented.`);
  }

  async getBalance(): Promise<Balance> {
    if (!this.isLive) {
      for (const bal of paperBalances) {
        if (bal.asset === "USDT") {
          bal.usdValue = bal.free + bal.locked;
        } else {
          try {
            const price = await this.getPrice(`${bal.asset}/USDT`);
            bal.usdValue = (bal.free + bal.locked) * price;
          } catch {
            bal.usdValue = 0;
          }
        }
      }
      const totalUsd = paperBalances.reduce((sum, b) => sum + b.usdValue, 0);
      return {
        assets: [...paperBalances],
        totalUsdValue: totalUsd,
        timestamp: Date.now(),
        isPaper: true,
      };
    }
    throw new Error("Live Bitunix balance fetch not yet implemented.");
  }

  async getOpenOrders(): Promise<Order[]> {
    return Array.from(paperOrders.values()).filter(
      (o) => o.status === "PENDING" || o.status === "PARTIALLY_FILLED",
    );
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let instance: BitunixAdapter | null = null;

export function getBitunixAdapter(): BitunixAdapter {
  if (!instance) {
    instance = new BitunixAdapter();
  }
  return instance;
}

export { BitunixAdapter };
