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

const paperOrders = new Map<string, Order>();
const paperBalances: AssetBalance[] = [
  { asset: "USDT", free: 100_000, locked: 0, usdValue: 100_000 },
  { asset: "BTC", free: 1.5, locked: 0, usdValue: 0 },
  { asset: "ETH", free: 15, locked: 0, usdValue: 0 },
  { asset: "SOL", free: 200, locked: 0, usdValue: 0 },
  { asset: "BNB", free: 50, locked: 0, usdValue: 0 },
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
  } catch {
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
  } catch {
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
    if (!this.isLive) {
      return paperPlaceOrder(order);
    }
    // Live mode — placeholder for real API integration
    throw new Error("Live Binance trading not yet implemented. Use paper mode.");
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
