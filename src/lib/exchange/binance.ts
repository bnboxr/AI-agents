// ── Binance Exchange Adapter ─────────────────────────────────────────
// Wraps existing WebSocket infrastructure and adds REST trading endpoints.
// Paper mode default — live mode requires API key check.
//
// REST API: https://api.binance.com/api/v3
// WebSocket: wss://stream.binance.com:9443/ws (managed by ws/market-data.ts)

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
import { getPrice as getCachedPrice } from "~/lib/ws/price-context";

// ── Constants ──────────────────────────────────────────────────────

const BINANCE_REST = "https://api.binance.com/api/v3";
const BINANCE_WS = "wss://stream.binance.com:9443/ws";
const REQUEST_TIMEOUT = 8_000;

// ── Paper Trading State ────────────────────────────────────────────

/**
 * Parse paper trading balances from PAPER_BALANCES environment variable.
 *
 * Format: JSON string, e.g. `{"USDT":5000,"BTC":0.1,"ETH":0,"SOL":0,"BNB":0}`
 *
 * If the env var is not set or fails to parse, modest defaults are used:
 *   USDT: 1000 (realistic starting capital for a new account)
 *   All other assets: 0 (must be acquired through paper trading)
 */
function parsePaperBalances(): AssetBalance[] {
  const envBalances = process.env.PAPER_BALANCES;
  if (envBalances) {
    try {
      const parsed = JSON.parse(envBalances) as Record<string, unknown>;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([asset, amount]) => ({
          asset,
          free: typeof amount === 'number' ? amount : 0,
          locked: 0,
          usdValue: asset === 'USDT' ? (typeof amount === 'number' ? amount : 0) : 0,
        }));
      }
    } catch (err) {
      console.warn("[Binance] PAPER_BALANCES parse failed — using defaults:", err);
    }
  }
  // Modest defaults for a new account
  return [
    { asset: "USDT", free: 1_000, locked: 0, usdValue: 1_000 },
    { asset: "BTC", free: 0, locked: 0, usdValue: 0 },
    { asset: "ETH", free: 0, locked: 0, usdValue: 0 },
    { asset: "SOL", free: 0, locked: 0, usdValue: 0 },
    { asset: "BNB", free: 0, locked: 0, usdValue: 0 },
  ];
}

const paperOrders = new Map<string, Order>();
const paperBalances: AssetBalance[] = parsePaperBalances();
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

function getPair(symbol: string): string {
  // Normalize to Binance format: "BTCUSDT"
  const upper = symbol.toUpperCase();
  if (upper.endsWith("USDT")) return upper;
  return `${upper}USDT`;
}

// ── Real price fetch from Binance REST ─────────────────────────────

async function fetchBinancePrice(symbol: string): Promise<number> {
  const pair = getPair(symbol);
  try {
    const res = await fetchWithTimeout(`${BINANCE_REST}/ticker/price?symbol=${pair}`);
    if (!res.ok) {
      // Fall back to WebSocket cache
      const cached = getCachedPrice(symbol.replace("USDT", ""));
      if (cached !== null) return cached;
      throw new Error(`Binance price fetch failed: ${res.status}`);
    }
    const data = await res.json() as { price: string };
    return parseFloat(data.price);
  } catch (err) {
    console.warn("[Binance] fetchBinancePrice failed:", err);
    const cached = getCachedPrice(symbol.replace("USDT", ""));
    if (cached !== null) return cached;
    throw new Error(`No price available for ${symbol}`);
  }
}

// ── Paper Trading Engine ───────────────────────────────────────────

async function paperPlaceOrder(orderReq: OrderRequest): Promise<OrderResult> {
  const pair = getPair(orderReq.symbol);
  let fillPrice: number;

  try {
    fillPrice = await fetchBinancePrice(pair);
  } catch (err) {
    console.warn("[Binance] paperPlaceOrder fetchBinancePrice failed:", err);
    throw new Error(`Cannot get price for ${pair}`);
  }

  // Apply realistic slippage (0.05% for market, 0% for limit)
  const slippage = orderReq.type === "MARKET" ? 0.0005 : 0;
  const slippageDir = orderReq.side === "BUY" ? 1 : -1;
  const execPrice = fillPrice * (1 + slippage * slippageDir);

  paperOrderCounter++;
  const orderId = `paper_binance_${Date.now()}_${paperOrderCounter}`;

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
  const baseAsset = pair.replace("USDT", "");
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

// ── BinanceAdapter Class ───────────────────────────────────────────

class BinanceAdapter implements ExchangeAdapter {
  name = "Binance";
  role: ExchangeRole = "data";
  wsEndpoint = BINANCE_WS;
  isEnabled = true;
  isLive = false;
  private apiKey: string | null = null;
  private secretKey: string | null = null;

  constructor() {
    // Check env for live keys
    this.apiKey = process.env.BINANCE_API_KEY ?? null;
    this.secretKey = process.env.BINANCE_SECRET_KEY ?? null;
    this.isLive = !!(this.apiKey && this.secretKey);
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  async getPrice(symbol: string): Promise<number> {
    return fetchBinancePrice(symbol);
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const pair = getPair(symbol);
    try {
      const res = await fetchWithTimeout(
        `${BINANCE_REST}/depth?symbol=${pair}&limit=${Math.min(depth, 100)}`,
      );
      if (!res.ok) {
        throw new Error(`Binance order book fetch failed: ${res.status}`);
      }
      const data = await res.json() as {
        bids: [string, string][];
        asks: [string, string][];
      };

      const bids: OrderBookLevel[] = (data.bids ?? []).map(
        ([price, qty]) => ({
          price: parseFloat(price),
          quantity: parseFloat(qty),
        }),
      );
      const asks: OrderBookLevel[] = (data.asks ?? []).map(
        ([price, qty]) => ({
          price: parseFloat(price),
          quantity: parseFloat(qty),
        }),
      );

      return { symbol: pair, bids, asks, timestamp: Date.now() };
    } catch (err) {
      console.error(`[Binance] OrderBook error for ${pair}:`, err);
      return { symbol: pair, bids: [], asks: [], timestamp: Date.now() };
    }
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    // Binance is data-only — reject all trading requests
    return {
      orderId: `rejected_${Date.now()}`,
      symbol: getPair(order.symbol),
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      filledQuantity: 0,
      avgPrice: 0,
      status: "REJECTED",
      fee: 0,
      feeAsset: "USDT",
      timestamp: Date.now(),
      isPaper: !this.isLive,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = paperOrders.get(orderId);
    if (order) {
      order.status = "CANCELLED";
      paperOrders.set(orderId, order);
      return;
    }
    // Live mode placeholder
    throw new Error(`Order ${orderId} not found or live cancellation not implemented.`);
  }

  async getBalance(): Promise<Balance> {
    if (!this.isLive) {
      // Update USD values for paper balance
      for (const bal of paperBalances) {
        if (bal.asset === "USDT") {
          bal.usdValue = bal.free + bal.locked;
        } else {
          try {
            const price = await this.getPrice(`${bal.asset}USDT`);
            bal.usdValue = (bal.free + bal.locked) * price;
          } catch (err) {
            console.warn("[Binance] getBalance price fetch failed:", err);
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
    throw new Error("Live Binance balance fetch not yet implemented.");
  }

  async getOpenOrders(): Promise<Order[]> {
    return Array.from(paperOrders.values()).filter(
      (o) => o.status === "PENDING" || o.status === "PARTIALLY_FILLED",
    );
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let instance: BinanceAdapter | null = null;

export function getBinanceAdapter(): BinanceAdapter {
  if (!instance) {
    instance = new BinanceAdapter();
  }
  return instance;
}

export { BinanceAdapter };
