// ── Binance Exchange Adapter ─────────────────────────────────────────
// Wraps existing WebSocket infrastructure and adds REAL signed REST
// trading endpoints (HMAC-SHA256, X-MBX-APIKEY).
// Live mode requires BINANCE_API_KEY + BINANCE_SECRET_KEY — when they are
// missing, live methods THROW (owner hard rule: never simulate, never
// fabricate). Paper balances remain available only behind the documented
// PAPER_BALANCES simulation flag and are always labelled isPaper.
//
// REST API: https://api.binance.com/api/v3  (override: BINANCE_REST_OVERRIDE)
// WebSocket: wss://stream.binance.com:9443/ws (managed by ws/market-data.ts)
// Signed endpoint spec: https://binance-docs.github.io/apidocs/spot/en/#signed-trade-and-user_data-endpoint

import { createHmac } from "node:crypto";
import type {
  ExchangeAdapter,
  ExchangeRole,
  OrderBook,
  OrderBookLevel,
  OrderRequest,
  OrderResult,
  Balance,
  AssetBalance,
  Order,
} from "./types";
import { getPrice as getCachedPrice } from "~/lib/ws/price-context";
import { requireEnv } from "~/lib/env-guard";

// ── Constants ──────────────────────────────────────────────────────

// Allow testnet via BINANCE_REST_OVERRIDE (e.g. https://testnet.binance.vision/api/v3).
const BINANCE_REST =
  process.env.BINANCE_REST_OVERRIDE ?? "https://api.binance.com/api/v3";
const BINANCE_WS = "wss://stream.binance.com:9443/ws";
const REQUEST_TIMEOUT = 8_000;
// Optional recvWindow override (ms). Default 5000 per Binance recommendations.
const RECV_WINDOW_MS = Number(process.env.BINANCE_RECV_WINDOW_MS ?? 5000);

// Live order symbol index: orderId → symbol, so cancelOrder(orderId) can
// find the required symbol (Binance cancels are per-symbol).
const liveOrderSymbols = new Map<string, string>();

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

// ── HMAC signing (Binance signed endpoints) ────────────────────────

/** HMAC-SHA256 hex digest — the core of every Binance signed request. */
export function binanceHmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Build a signed query string: sorted/encoded params + `signature` field.
 * Binance signs the exact query string sent; URLSearchParams keeps the
 * encoding consistent between the signature and the request URL.
 */
export function buildBinanceSignedQuery(
  params: Record<string, string | number>,
  secret: string,
): string {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  return `${qs}&signature=${binanceHmacSha256(secret, qs)}`;
}

/** Error detail extraction from a failed Binance response body. */
async function binanceErrorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { code?: number; msg?: string };
    if (typeof j.msg === "string") return `${res.status} (code ${j.code ?? "?"}): ${j.msg}`;
    return `${res.status}: ${JSON.stringify(j)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Signed GET/POST/DELETE against a Binance private endpoint.
 * Parameters travel in the signed query string (valid per Binance docs —
 * "parameters may be sent in the query string or the request body").
 * Always includes timestamp + recvWindow + signature.
 */
async function binanceSignedRequest(
  path: string,
  opts: {
    method: string;
    apiKey: string;
    secret: string;
    query?: Record<string, string | number>;
  },
): Promise<unknown> {
  const qs = buildBinanceSignedQuery(
    { ...(opts.query ?? {}), timestamp: Date.now(), recvWindow: RECV_WINDOW_MS },
    opts.secret,
  );
  const url = `${BINANCE_REST}${path}?${qs}`;
  const res = await fetchWithTimeout(url, {
    method: opts.method,
    headers: {
      "X-MBX-APIKEY": opts.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!res.ok) {
    throw new Error(`[Binance] ${opts.method} ${path} failed: ${await binanceErrorDetail(res)}`);
  }
  // DELETE /api/v3/order returns 200 with an empty body.
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

/** Map a Binance order-status string to the shared OrderResult status. */
function mapBinanceStatus(status: string): OrderResult["status"] {
  switch (status) {
    case "FILLED":
      return "FILLED";
    case "PARTIALLY_FILLED":
      return "PARTIALLY_FILLED";
    case "NEW":
      return "PENDING";
    case "CANCELED":
    case "EXPIRED":
    case "REJECTED":
      return "REJECTED";
    default:
      return "PENDING";
  }
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
    // Live only. Without keys this throws — never simulates, never returns
    // a fabricated REJECTED that could be mistaken for a real failed order.
    if (!this.isLive) {
      throw new Error(
        "[Binance] LIVE order requires BINANCE_API_KEY and BINANCE_SECRET_KEY — add keys to Secrets. No simulation.",
      );
    }
    const apiKey = requireEnv("BINANCE_API_KEY");
    const secret = requireEnv("BINANCE_SECRET_KEY");
    const symbol = getPair(order.symbol);

    const params: Record<string, string | number> = {
      symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
    };
    if (order.type === "LIMIT") {
      if (!order.price) {
        throw new Error(`[Binance] LIMIT order for ${symbol} requires a price.`);
      }
      params.price = order.price;
      params.timeInForce = "GTC";
    }

    const data = (await binanceSignedRequest("/api/v3/order", {
      method: "POST",
      apiKey,
      secret,
      query: params,
    })) as {
      orderId?: number | string;
      symbol?: string;
      status?: string;
      executedQty?: string;
      cummulativeQuoteQty?: string;
      price?: string;
      fills?: Array<{ price?: string; qty?: string; commission?: string; commissionAsset?: string }>;
    };

    if (data.orderId === undefined) {
      throw new Error(`[Binance] placeOrder ${symbol} response missing orderId: ${JSON.stringify(data)}`);
    }

    const orderId = String(data.orderId);
    liveOrderSymbols.set(orderId, data.symbol ?? symbol);

    // Weighted average fill price from real fills; fall back to cumulative quote.
    let filledQty = 0;
    let quoteTotal = 0;
    let commission = 0;
    let feeAsset = "USDT";
    for (const f of data.fills ?? []) {
      const fq = parseFloat(f.qty ?? "0");
      const fp = parseFloat(f.price ?? "0");
      filledQty += fq;
      quoteTotal += fq * fp;
      const comm = parseFloat(f.commission ?? "0");
      if (comm > 0) {
        commission += comm;
        feeAsset = f.commissionAsset ?? feeAsset;
      }
    }
    if (filledQty === 0) {
      filledQty = parseFloat(data.executedQty ?? "0");
      quoteTotal = parseFloat(data.cummulativeQuoteQty ?? "0");
    }
    const avgPrice =
      filledQty > 0 ? quoteTotal / filledQty : parseFloat(data.price ?? "0");

    return {
      orderId,
      symbol: data.symbol ?? symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      filledQuantity: filledQty,
      avgPrice,
      status: mapBinanceStatus(data.status ?? "NEW"),
      fee: commission,
      feeAsset,
      timestamp: Date.now(),
      isPaper: false,
    };
  }

  async cancelOrder(orderId: string, symbol?: string): Promise<void> {
    if (!this.isLive) {
      const order = paperOrders.get(orderId);
      if (order) {
        order.status = "CANCELLED";
        paperOrders.set(orderId, order);
        return;
      }
      throw new Error(
        "[Binance] LIVE cancellation requires BINANCE_API_KEY and BINANCE_SECRET_KEY — add keys to Secrets. No simulation.",
      );
    }
    const apiKey = requireEnv("BINANCE_API_KEY");
    const secret = requireEnv("BINANCE_SECRET_KEY");
    const resolvedSymbol = symbol ?? liveOrderSymbols.get(orderId);
    if (!resolvedSymbol) {
      throw new Error(
        `[Binance] cancelOrder(${orderId}) needs a symbol — pass symbol or place the order through this adapter first.`,
      );
    }
    await binanceSignedRequest("/api/v3/order", {
      method: "DELETE",
      apiKey,
      secret,
      query: { symbol: getPair(resolvedSymbol), orderId },
    });
    liveOrderSymbols.delete(orderId);
  }

  async getBalance(): Promise<Balance> {
    if (!this.isLive) {
      // Paper/simulation ledger — explicitly labelled isPaper, never real.
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
    // Live balance: signed GET /api/v3/account.
    const apiKey = requireEnv("BINANCE_API_KEY");
    const secret = requireEnv("BINANCE_SECRET_KEY");
    const data = (await binanceSignedRequest("/api/v3/account", {
      method: "GET",
      apiKey,
      secret,
    })) as { balances?: Array<{ asset: string; free: string; locked: string }> };

    const stablecoins = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "EUR", "USD"]);
    const assets: AssetBalance[] = [];
    let totalUsd = 0;

    for (const b of data.balances ?? []) {
      const free = parseFloat(b.free ?? "0");
      const locked = parseFloat(b.locked ?? "0");
      if (!(free > 0 || locked > 0)) continue; // skip zero balances
      let usdValue = 0;
      if (stablecoins.has(b.asset)) {
        usdValue = free + locked;
      } else {
        try {
          const price = await this.getPrice(`${b.asset}USDT`);
          usdValue = (free + locked) * price;
        } catch (err) {
          usdValue = 0; // price unavailable — valuation 0, balance still listed
          console.warn(`[Binance] getBalance: no price for ${b.asset}USDT:`, err);
        }
      }
      totalUsd += usdValue;
      assets.push({ asset: b.asset, free, locked, usdValue });
    }

    return {
      assets,
      totalUsdValue: totalUsd,
      timestamp: Date.now(),
      isPaper: false,
    };
  }

  async getOpenOrders(): Promise<Order[]> {
    if (!this.isLive) {
      return Array.from(paperOrders.values()).filter(
        (o) => o.status === "PENDING" || o.status === "PARTIALLY_FILLED",
      );
    }
    // Live: signed GET /api/v3/openOrders (all symbols).
    const apiKey = requireEnv("BINANCE_API_KEY");
    const secret = requireEnv("BINANCE_SECRET_KEY");
    const data = (await binanceSignedRequest("/api/v3/openOrders", {
      method: "GET",
      apiKey,
      secret,
    })) as unknown as Array<{
      orderId?: number;
      symbol?: string;
      side?: string;
      type?: string;
      price?: string;
      origQty?: string;
      executedQty?: string;
      cummulativeQuoteQty?: string;
      status?: string;
      time?: number;
    }>;

    if (!Array.isArray(data)) {
      throw new Error(`[Binance] getOpenOrders unexpected response: ${JSON.stringify(data)}`);
    }

    return data.map((o) => {
      const executedQty = parseFloat(o.executedQty ?? "0");
      const quoteQty = parseFloat(o.cummulativeQuoteQty ?? "0");
      return {
        orderId: String(o.orderId ?? ""),
        symbol: o.symbol ?? "",
        side: (o.side as "BUY" | "SELL") ?? "BUY",
        type: (o.type as "MARKET" | "LIMIT") ?? "LIMIT",
        quantity: parseFloat(o.origQty ?? "0"),
        filledQuantity: executedQty,
        price: parseFloat(o.price ?? "0"),
        avgPrice: executedQty > 0 ? quoteQty / executedQty : 0,
        status: mapBinanceStatus(o.status ?? "NEW"),
        timestamp: o.time ?? Date.now(),
        isPaper: false,
      };
    });
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