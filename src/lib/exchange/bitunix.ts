// ── Bitunix Exchange Adapter ─────────────────────────────────────────
// Bitunix REST: https://api.bitunix.com/api/v1
// WebSocket: wss://ws.bitunix.com/ws
// Live mode requires BITUNIX_API_KEY + BITUNIX_SECRET_KEY. When they are
// missing, live methods THROW (owner hard rule: never simulate, never
// fabricate). Paper mode remains available and is always labelled isPaper.
//
// ⚠ LIVE-VERIFICATION REQUIRED BEFORE REAL MONEY (owner decision gating):
//   Bitunix's official docs (https://bitunix.com/api — JS-rendered) were NOT
//   reachable in this session. The v2 HMAC scheme implemented here matches
//   the standard convention: headers X-BX-APIKEY, X-BX-TIMESTAMP (ms),
//   X-BX-SIGNATURE = HEX(HMAC_SHA256(secret, timestamp + method + path + body)).
//   The concat is centralized in `signRequest` below — VERIFY it against
//   docs.bitunix.com before enabling with real funds.

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
  PerpetualOrderRequest,
  PerpetualPosition,
} from "./types";
import { requireEnv } from "~/lib/env-guard";

// ── Constants ──────────────────────────────────────────────────────

const BITUNIX_REST =
  process.env.BITUNIX_REST_OVERRIDE ?? "https://api.bitunix.com/api/v1";
const BITUNIX_FUTURES_REST = "https://fapi.bitunix.com";
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

/** Paper balance entries — lazily populated from unified-balance on first access. */
const paperBalances: AssetBalance[] = [];

/** Track paper spot positions for PnL calculation. Key = symbol (e.g., "BTCUSDT"). */
const paperSpotPositions = new Map<string, {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
}>();

let paperOrderCounter = 0;
let _paperBalancesInitialized = false;

/** Lazily initialize paperBalances from unified-balance. */
function ensurePaperBalances(): void {
  if (_paperBalancesInitialized) return;
  try {
    // Dynamic import to avoid circular deps at module init time
    const { getSyncBalance } = require("../unified-balance");
    const bal = getSyncBalance();
    paperBalances.length = 0;
    paperBalances.push({
      asset: "USDT",
      free: bal.usdt,
      locked: 0,
      usdValue: bal.usdt,
    });
    _paperBalancesInitialized = true;
  } catch {
    // Fallback: use hardcoded $1M
    paperBalances.push({
      asset: "USDT",
      free: 1_000_000,
      locked: 0,
      usdValue: 1_000_000,
    });
    _paperBalancesInitialized = true;
  }
}

// ── Paper Perpetuals State ──────────────────────────────────────────

const paperPerpetualPositions = new Map<string, PerpetualPosition>();
let paperPerpetualCounter = 0;

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

// ── Bitunix HMAC signing (v2 scheme — VERIFY AGAINST OFFICIAL DOCS) ──
//
// ⚠ The exact concat `timestamp + method + path + body` is the standard
// Bitunix v2 convention but could NOT be confirmed against
// https://bitunix.com/api in this session (JS-rendered docs). Verify
// against the official docs before enabling with real funds. The signing
// logic is centralized here so a correction is a one-line change.

/**
 * Compute the X-BX-SIGNATURE value for a Bitunix private API request.
 *
 * @param secret    Bitunix secret key (BITUNIX_SECRET_KEY)
 * @param timestamp epoch millis (the same value sent in X-BX-TIMESTAMP)
 * @param method    uppercase HTTP method, e.g. "POST", "GET"
 * @param path      request path, including query string for GET, e.g.
 *                  "/api/v1/futures/order" or "/api/v1/futures/positions?symbol=BTCUSDT"
 * @param body      canonical JSON request body ("" for GET/DELETE without body)
 * @returns         lowercase hex HMAC-SHA256 digest
 */
export function bitunixHmacSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
): string {
  const payload = `${timestamp}${method}${path}${body}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Build headers + body for a signed Bitunix request. `timestamp` belongs in
 * the header ONLY (X-BX-TIMESTAMP) — never inside the JSON body.
 */
function signRequest(
  apiKey: string,
  secret: string,
  method: "GET" | "POST",
  path: string,
  bodyJson?: string,
): { headers: Record<string, string>; bodyJson: string } {
  const timestamp = String(Date.now());
  const body = bodyJson ?? "";
  return {
    headers: {
      "X-BX-APIKEY": apiKey,
      "X-BX-TIMESTAMP": timestamp,
      "X-BX-SIGNATURE": bitunixHmacSignature(secret, timestamp, method, path, body),
      "Content-Type": "application/json",
    },
    bodyJson: body,
  };
}

/** Shared error-detail extraction for failed Bitunix responses. */
async function bitunixErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return `HTTP ${res.status}`;
  try {
    const j = JSON.parse(text) as { code?: string; msg?: string; message?: string };
    if (j.code && j.code !== "0") return `code ${j.code}: ${j.msg ?? j.message ?? ""}`;
    return `HTTP ${res.status}: ${text.slice(0, 300)}`;
  } catch {
    return `HTTP ${res.status}: ${text.slice(0, 300)}`;
  }
}

/** Map a Bitunix order-status string to the shared OrderResult status. */
function mapBitunixStatus(status: string | undefined): OrderResult["status"] {
  switch (status) {
    case "FILLED":
      return "FILLED";
    case "PARTIALLY_FILLED":
      return "PARTIALLY_FILLED";
    case "NEW":
    case "PENDING":
      return "PENDING";
    case "CANCELED":
    case "REJECTED":
    case "EXPIRED":
      return "REJECTED";
    default:
      return "PENDING";
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
  } catch (err) {
    console.warn("[Bitunix] fetchBitunixPrice failed:", err);
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
  ensurePaperBalances();
  const pair = getBitunixPair(orderReq.symbol);
  const rawPair = getRawSymbol(pair);
  let fillPrice: number;

  try {
    fillPrice = await fetchBitunixPrice(pair);
  } catch (err) {
    console.warn("[Bitunix] paperPlaceOrder fetchBitunixPrice failed:", err);
    // Fallback: use a simulated price for paper trading
    fillPrice = getFallbackPrice(pair);
  }

  // Apply realistic slippage: 0.05% for market orders
  const slippage = orderReq.type === "MARKET" ? 0.0005 : 0;
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
  const fee = quoteAmount * 0.001; // 0.1% fee
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
    quoteBal.free -= (quoteAmount + fee);
    baseBal.free += orderReq.quantity;
    // Track position
    paperSpotPositions.set(rawPair, {
      symbol: rawPair,
      side: "LONG",
      quantity: orderReq.quantity,
      entryPrice: execPrice,
    });
  } else {
    baseBal.free -= orderReq.quantity;
    quoteBal.free += (quoteAmount - fee);
    // Track position
    paperSpotPositions.set(rawPair, {
      symbol: rawPair,
      side: "SHORT",
      quantity: orderReq.quantity,
      entryPrice: execPrice,
    });
  }

  const result: OrderResult = {
    orderId,
    symbol: rawPair,
    side: orderReq.side,
    type: orderReq.type,
    quantity: orderReq.quantity,
    filledQuantity: orderReq.quantity,
    avgPrice: execPrice,
    status: "FILLED",
    fee,
    feeAsset: "USDT",
    timestamp: Date.now(),
    isPaper: true,
  };

  return result;
}

/** Close an existing paper spot position and return PnL. */
async function paperCloseOrder(symbol: string): Promise<OrderResult & { realizedPnl: number; exitPrice: number }> {
  ensurePaperBalances();
  const rawSymbol = symbol.includes("/") ? getRawSymbol(symbol) : symbol;
  const pair = rawSymbol.includes("/") ? rawSymbol : `${rawSymbol.slice(0, -4)}/${rawSymbol.slice(-4)}`;
  
  const pos = paperSpotPositions.get(rawSymbol);
  if (!pos) {
    throw new Error(`No open paper position for ${rawSymbol}`);
  }

  let exitPrice: number;
  try {
    exitPrice = await fetchBitunixPrice(pair);
  } catch {
    exitPrice = getFallbackPrice(pair);
  }

  // Apply slippage for market exit
  const exitSide = pos.side === "LONG" ? "SELL" : "BUY";
  const slippage = 0.0005; // 0.05%
  const slippageDir = exitSide === "SELL" ? -1 : 1; // SELL gets slightly lower price
  const execPrice = exitPrice * (1 + slippage * slippageDir);

  // Calculate PnL
  const realizedPnl = pos.side === "LONG"
    ? (execPrice - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - execPrice) * pos.quantity;

  const closingValue = pos.quantity * execPrice;
  const fee = closingValue * 0.001; // 0.1% fee

  // Update balances
  const quoteBal = paperBalances.find((b) => b.asset === "USDT");
  const baseAsset = pair.split("/")[0] ?? "UNKNOWN";
  const baseBal = paperBalances.find((b) => b.asset === baseAsset);

  if (quoteBal) {
    if (pos.side === "LONG") {
      quoteBal.free += (closingValue - fee);
    } else {
      // For SHORT: return initial value + PnL
    }
  }
  if (baseBal && pos.side === "SHORT") {
    baseBal.free += pos.quantity;
  }

  // Remove position
  paperSpotPositions.delete(rawSymbol);

  paperOrderCounter++;
  const orderId = `paper_bitunix_close_${Date.now()}_${paperOrderCounter}`;

  return {
    orderId,
    symbol: rawSymbol,
    side: exitSide,
    type: "MARKET",
    quantity: pos.quantity,
    filledQuantity: pos.quantity,
    avgPrice: execPrice,
    status: "FILLED",
    fee,
    feeAsset: "USDT",
    timestamp: Date.now(),
    isPaper: true,
    realizedPnl,
    exitPrice: execPrice,
  };
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
  role: ExchangeRole = "trading";
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
    // LIVE spot order — real signed request (path VERIFY against docs).
    const apiKey = requireEnv("BITUNIX_API_KEY");
    const secret = requireEnv("BITUNIX_SECRET_KEY");
    const pair = getBitunixPair(order.symbol);
    const rawPair = getRawSymbol(pair);

    const body: Record<string, unknown> = {
      symbol: rawPair,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
    };
    if (order.type === "LIMIT") {
      if (!order.price) {
        throw new Error(`[Bitunix] LIMIT spot order for ${rawPair} requires a price.`);
      }
      body.price = order.price;
    }

    // ⚠ SIGNATURE CONCAT + SPOT ORDER PATH must be verified against
    // https://bitunix.com/api before enabling with real funds.
    const path = "/api/v1/spot/order";
    const { headers, bodyJson } = signRequest(apiKey, secret, "POST", path, JSON.stringify(body));

    const res = await fetchWithTimeout(`${BITUNIX_REST}${path}`, {
      method: "POST",
      headers,
      body: bodyJson,
    });
    if (!res.ok) {
      throw new Error(`[Bitunix] spot order failed: ${await bitunixErrorDetail(res)}`);
    }
    const data = (await res.json()) as {
      code?: string;
      data?: {
        orderId?: string;
        symbol?: string;
        side?: string;
        type?: string;
        origQty?: string;
        executedQty?: string;
        avgPrice?: string;
        status?: string;
        fee?: string;
        feeAsset?: string;
      };
    };
    if (data.code && data.code !== "0") {
      throw new Error(`[Bitunix] spot order error: code=${data.code}`);
    }
    const d = data.data ?? {};
    const timestamp = Date.now();
    return {
      orderId: d.orderId ?? `unknown_${timestamp}`,
      symbol: d.symbol ?? rawPair,
      side: (d.side as "BUY" | "SELL") ?? order.side,
      type: (d.type as "MARKET" | "LIMIT") ?? order.type,
      quantity: parseFloat(d.origQty ?? "0") || order.quantity,
      filledQuantity: parseFloat(d.executedQty ?? "0"),
      avgPrice: parseFloat(d.avgPrice ?? "0"),
      status: mapBitunixStatus(d.status),
      fee: parseFloat(d.fee ?? "0"),
      feeAsset: d.feeAsset ?? "USDT",
      timestamp,
      isPaper: false,
    };
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

  /** Close an existing paper spot position by symbol. Returns order result with PnL. */
  async closePaperPosition(symbol: string): Promise<OrderResult & { realizedPnl: number; exitPrice: number }> {
    return paperCloseOrder(symbol);
  }

  /** Get all open paper spot positions. */
  getPaperSpotPositions(): Array<{ symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number }> {
    return Array.from(paperSpotPositions.values());
  }

  async getBalance(): Promise<Balance> {
    if (!this.isLive) {
      ensurePaperBalances();
      for (const bal of paperBalances) {
        if (bal.asset === "USDT") {
          bal.usdValue = bal.free + bal.locked;
        } else {
          try {
            const price = await this.getPrice(`${bal.asset}/USDT`);
            bal.usdValue = (bal.free + bal.locked) * price;
          } catch (err) {
            console.warn("[Bitunix] getBalance price fetch failed:", err);
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

  // ── Perpetuals ──────────────────────────────────────────────────

  async placePerpetualOrder(request: PerpetualOrderRequest): Promise<OrderResult> {
    if (!this.isLive) {
      return this.paperPlacePerpetualOrder(request);
    }
    // LIVE futures order — real signed request. Timestamp belongs in the
    // X-BX-TIMESTAMP header ONLY (v2 scheme), never inside the body.
    const apiKey = requireEnv("BITUNIX_API_KEY");
    const secret = requireEnv("BITUNIX_SECRET_KEY");
    const pair = getBitunixPair(request.symbol);
    const rawPair = getRawSymbol(pair);

    const body: Record<string, unknown> = {
      symbol: rawPair,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      leverage: request.leverage,
      marginMode: request.marginMode,
    };

    if (request.type === "LIMIT" && request.price) body.price = request.price;
    if (request.reduceOnly) body.reduceOnly = true;
    if (request.stopLossPrice) body.stopLossPrice = request.stopLossPrice;
    if (request.takeProfitPrice) body.takeProfitPrice = request.takeProfitPrice;

    // ⚠ SIGNATURE CONCAT must be verified against the official docs.
    const path = "/api/v1/futures/order";
    const { headers, bodyJson } = signRequest(apiKey, secret, "POST", path, JSON.stringify(body));

    const res = await fetchWithTimeout(`${BITUNIX_FUTURES_REST}${path}`, {
      method: "POST",
      headers,
      body: bodyJson,
    });
    if (!res.ok) {
      throw new Error(`[Bitunix] futures order failed: ${await bitunixErrorDetail(res)}`);
    }

    const data = await res.json() as {
      code?: string;
      data?: {
        orderId?: string;
        symbol?: string;
        side?: string;
        type?: string;
        origQty?: string;
        executedQty?: string;
        avgPrice?: string;
        status?: string;
        fee?: string;
        feeAsset?: string;
      };
    };

    if (data.code && data.code !== "0") {
      throw new Error(`[Bitunix] futures order error: code=${data.code}`);
    }

    const d = data.data ?? {};
    const timestamp = Date.now();
    return {
      orderId: d.orderId ?? `unknown_${timestamp}`,
      symbol: d.symbol ?? rawPair,
      side: (d.side as "BUY" | "SELL") ?? request.side,
      type: (d.type as "MARKET" | "LIMIT") ?? request.type,
      quantity: parseFloat(d.origQty ?? "0") || request.quantity,
      filledQuantity: parseFloat(d.executedQty ?? "0"),
      avgPrice: parseFloat(d.avgPrice ?? "0"),
      status: mapBitunixStatus(d.status),
      fee: parseFloat(d.fee ?? "0"),
      feeAsset: d.feeAsset ?? "USDT",
      timestamp,
      isPaper: false,
    };
  }

  async getPerpetualPositions(symbol?: string): Promise<PerpetualPosition[]> {
    if (!this.isLive) {
      return this.paperGetPerpetualPositions(symbol);
    }

    // LIVE positions — real signed GET. Timestamp lives in the header.
    const apiKey = requireEnv("BITUNIX_API_KEY");
    const secret = requireEnv("BITUNIX_SECRET_KEY");

    const pathBase = "/api/v1/futures/positions";
    const query = symbol
      ? `symbol=${encodeURIComponent(getRawSymbol(getBitunixPair(symbol)))}`
      : "";
    const path = query ? `${pathBase}?${query}` : pathBase;

    // ⚠ SIGNATURE CONCAT + query-in-path convention must be verified.
    const { headers } = signRequest(apiKey, secret, "GET", path);

    const res = await fetchWithTimeout(`${BITUNIX_FUTURES_REST}${path}`, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`[Bitunix] positions fetch failed: ${await bitunixErrorDetail(res)}`);
    }

    const data = await res.json() as {
      code?: string;
      data?: Array<{
        symbol?: string;
        positionSide?: string;
        positionAmt?: string;
        entryPrice?: string;
        markPrice?: string;
        leverage?: string;
        marginType?: string;
        unrealizedProfit?: string;
        liquidationPrice?: string;
        isolatedMargin?: string;
      }>;
    };

    if (data.code && data.code !== "0") {
      throw new Error(`[Bitunix] positions error: code=${data.code}`);
    }

    return (data.data ?? []).map((p) => {
      const qty = Math.abs(parseFloat(p.positionAmt ?? "0"));
      const side: "LONG" | "SHORT" = parseFloat(p.positionAmt ?? "0") > 0 ? "LONG" : "SHORT";
      return {
        symbol: p.symbol ?? "",
        side,
        quantity: qty,
        entryPrice: parseFloat(p.entryPrice ?? "0"),
        markPrice: parseFloat(p.markPrice ?? "0"),
        leverage: parseFloat(p.leverage ?? "1"),
        marginMode: (p.marginType === "isolated" ? "isolated" : "cross") as "isolated" | "cross",
        unrealizedPnl: parseFloat(p.unrealizedProfit ?? "0"),
        liquidationPrice: parseFloat(p.liquidationPrice ?? "0"),
        marginUsed: parseFloat(p.isolatedMargin ?? "0"),
      };
    });
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (!this.isLive) {
      // Paper mode: silently record leverage (applied when opening position)
      console.log(`[Bitunix] Paper leverage set: ${symbol} ${leverage}x`);
      return;
    }

    // LIVE — real signed request; timestamp in header only.
    const apiKey = requireEnv("BITUNIX_API_KEY");
    const secret = requireEnv("BITUNIX_SECRET_KEY");
    const pair = getBitunixPair(symbol);
    const rawPair = getRawSymbol(pair);

    const body = { symbol: rawPair, leverage };
    // ⚠ SIGNATURE CONCAT must be verified against the official docs.
    const path = "/api/v1/futures/leverage";
    const { headers, bodyJson } = signRequest(apiKey, secret, "POST", path, JSON.stringify(body));

    const res = await fetchWithTimeout(`${BITUNIX_FUTURES_REST}${path}`, {
      method: "POST",
      headers,
      body: bodyJson,
    });
    if (!res.ok) {
      throw new Error(`[Bitunix] setLeverage failed: ${await bitunixErrorDetail(res)}`);
    }
  }

  async closePerpetualPosition(symbol: string): Promise<OrderResult> {
    const pair = getBitunixPair(symbol);
    const rawPair = getRawSymbol(pair);

    if (!this.isLive) {
      return this.paperClosePerpetualPosition(rawPair, Date.now());
    }

    // LIVE — real signed close request; timestamp in header only.
    const apiKey = requireEnv("BITUNIX_API_KEY");
    const secret = requireEnv("BITUNIX_SECRET_KEY");

    const body = {
      symbol: rawPair,
      side: "SELL",
      type: "MARKET",
      quantity: 0, // close all
      reduceOnly: true,
    };
    // ⚠ SIGNATURE CONCAT must be verified against the official docs.
    const path = "/api/v1/futures/order";
    const { headers, bodyJson } = signRequest(apiKey, secret, "POST", path, JSON.stringify(body));

    const res = await fetchWithTimeout(`${BITUNIX_FUTURES_REST}${path}`, {
      method: "POST",
      headers,
      body: bodyJson,
    });
    if (!res.ok) {
      throw new Error(`[Bitunix] close position failed: ${await bitunixErrorDetail(res)}`);
    }

    const data = await res.json() as {
      code?: string;
      data?: { orderId?: string; avgPrice?: string; executedQty?: string; fee?: string };
    };

    if (data.code && data.code !== "0") {
      throw new Error(`[Bitunix] close position error: code=${data.code}`);
    }

    const d = data.data ?? {};
    const timestamp = Date.now();
    return {
      orderId: d.orderId ?? `close_${timestamp}`,
      symbol: rawPair,
      side: "SELL",
      type: "MARKET",
      quantity: parseFloat(d.executedQty ?? "0"),
      filledQuantity: parseFloat(d.executedQty ?? "0"),
      avgPrice: parseFloat(d.avgPrice ?? "0"),
      status: "FILLED",
      fee: parseFloat(d.fee ?? "0"),
      feeAsset: "USDT",
      timestamp,
      isPaper: false,
    };
  }

  // ── Paper Perpetuals Simulation ──────────────────────────────────

  private async paperPlacePerpetualOrder(request: PerpetualOrderRequest): Promise<OrderResult> {
    const pair = getBitunixPair(request.symbol);
    const rawPair = getRawSymbol(pair);
    let fillPrice: number;

    try {
      fillPrice = await fetchBitunixPrice(pair);
    } catch {
      fillPrice = getFallbackPrice(pair);
    }

    const slippage = request.type === "MARKET" ? 0.0008 : 0;
    const slippageDir = request.side === "BUY" ? 1 : -1;
    const execPrice = fillPrice * (1 + slippage * slippageDir);

    paperPerpetualCounter++;
    const orderId = `paper_perp_bitunix_${Date.now()}_${paperPerpetualCounter}`;

    // Calculate margin requirements
    const notionalValue = request.quantity * execPrice;
    const marginUsed = notionalValue / request.leverage;
    const liquidationPrice = this.computeLiquidationPrice(
      execPrice,
      request.side,
      request.leverage,
      request.marginMode,
    );

    // Track position
    const position: PerpetualPosition = {
      symbol: rawPair,
      side: request.side === "BUY" ? "LONG" : "SHORT",
      quantity: request.quantity,
      entryPrice: execPrice,
      markPrice: execPrice,
      leverage: request.leverage,
      marginMode: request.marginMode,
      unrealizedPnl: 0,
      liquidationPrice,
      marginUsed,
    };
    paperPerpetualPositions.set(rawPair, position);

    // Update balances: lock margin from USDT
    const quoteBal = paperBalances.find((b) => b.asset === "USDT");
    if (quoteBal) {
      quoteBal.free -= marginUsed;
      quoteBal.locked += marginUsed;
    }

    const result: OrderResult = {
      orderId,
      symbol: rawPair,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      filledQuantity: request.quantity,
      avgPrice: execPrice,
      status: "FILLED",
      fee: notionalValue * 0.0006, // 0.06% taker fee
      feeAsset: "USDT",
      timestamp: Date.now(),
      isPaper: true,
    };

    return result;
  }

  private paperGetPerpetualPositions(symbol?: string): PerpetualPosition[] {
    // Update mark prices before returning
    this.updatePaperPerpetualPnL();
    if (symbol) {
      const pair = getBitunixPair(symbol);
      const rawPair = getRawSymbol(pair);
      const pos = paperPerpetualPositions.get(rawPair);
      return pos ? [pos] : [];
    }
    return Array.from(paperPerpetualPositions.values());
  }

  private async paperClosePerpetualPosition(symbol: string, timestamp: number): Promise<OrderResult> {
    const pos = paperPerpetualPositions.get(symbol);
    if (!pos) {
      throw new Error(`No open perpetual position for ${symbol}`);
    }

    let exitPrice: number;
    try {
      exitPrice = await fetchBitunixPrice(symbol);
    } catch {
      exitPrice = pos.markPrice;
    }

    // Realize PnL
    const pnl = pos.side === "LONG"
      ? (exitPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - exitPrice) * pos.quantity;

    // Return margin + PnL to free balance
    const quoteBal = paperBalances.find((b) => b.asset === "USDT");
    if (quoteBal) {
      quoteBal.locked -= pos.marginUsed;
      quoteBal.free += pos.marginUsed + pnl;
    }

    paperPerpetualPositions.delete(symbol);

    return {
      orderId: `close_perp_${timestamp}`,
      symbol,
      side: pos.side === "LONG" ? "SELL" : "BUY",
      type: "MARKET",
      quantity: pos.quantity,
      filledQuantity: pos.quantity,
      avgPrice: exitPrice,
      status: "FILLED",
      fee: pos.quantity * exitPrice * 0.0006,
      feeAsset: "USDT",
      timestamp,
      isPaper: true,
    };
  }

  /** Compute liquidation price based on side, leverage, and margin mode. */
  private computeLiquidationPrice(
    entryPrice: number,
    side: "BUY" | "SELL",
    leverage: number,
    // Kept for signature symmetry with callers; liq calc below is mode-independent.
    _marginMode: "isolated" | "cross",
  ): number {
    // Maintenance margin rate: ~0.5% for most pairs
    const mmr = 0.005;
    if (side === "BUY") {
      // LONG: liq = entry * (1 - 1/leverage + mmr)
      return entryPrice * (1 - 1 / leverage + mmr);
    } else {
      // SHORT: liq = entry * (1 + 1/leverage - mmr)
      return entryPrice * (1 + 1 / leverage - mmr);
    }
  }

  /** Update unrealized PnL for all paper perpetual positions based on current prices. */
  private async updatePaperPerpetualPnL(): Promise<void> {
    for (const [symbol, pos] of paperPerpetualPositions) {
      try {
        const currentPrice = await fetchBitunixPrice(symbol);
        pos.markPrice = currentPrice;

        if (pos.side === "LONG") {
          pos.unrealizedPnl = (currentPrice - pos.entryPrice) * pos.quantity;
        } else {
          pos.unrealizedPnl = (pos.entryPrice - currentPrice) * pos.quantity;
        }

        // Check liquidation
        const liqPrice = this.computeLiquidationPrice(pos.entryPrice, pos.side === "LONG" ? "BUY" : "SELL", pos.leverage, pos.marginMode);
        pos.liquidationPrice = liqPrice;

        if (
          (pos.side === "LONG" && currentPrice <= liqPrice) ||
          (pos.side === "SHORT" && currentPrice >= liqPrice)
        ) {
          // Position liquidated — auto-close with zero margin returned
          const quoteBal = paperBalances.find((b) => b.asset === "USDT");
          if (quoteBal) {
            quoteBal.locked -= pos.marginUsed;
            // Margin lost to liquidation
          }
          console.warn(`[Bitunix] ⚠️ Paper liquidation: ${symbol} at ${currentPrice} (liq: ${liqPrice})`);
          paperPerpetualPositions.delete(symbol);
        }
      } catch {
        // Keep stale mark price if fetch fails
      }
    }
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
