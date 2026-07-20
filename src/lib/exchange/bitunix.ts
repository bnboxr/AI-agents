// ── Bitunix Exchange Adapter ─────────────────────────────────────────
// Bitunix REST: https://api.bitunix.com/api/v1
// WebSocket: wss://ws.bitunix.com/ws
// Paper mode default — no real API keys needed.

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

// ── Constants ──────────────────────────────────────────────────────

const BITUNIX_REST = "https://api.bitunix.com/api/v1";
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
const paperBalances: AssetBalance[] = [
  { asset: "USDT", free: 100_000, locked: 0, usdValue: 100_000 },
  { asset: "BTC", free: 0.8, locked: 0, usdValue: 0 },
  { asset: "ETH", free: 10, locked: 0, usdValue: 0 },
  { asset: "SOL", free: 150, locked: 0, usdValue: 0 },
  { asset: "XRP", free: 10_000, locked: 0, usdValue: 0 },
];
let paperOrderCounter = 0;

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
  const pair = getBitunixPair(orderReq.symbol);
  let fillPrice: number;

  try {
    fillPrice = await fetchBitunixPrice(pair);
  } catch (err) {
    console.warn("[Bitunix] paperPlaceOrder fetchBitunixPrice failed:", err);
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
    // Live mode: use Bitunix futures REST API
    try {
      const pair = getBitunixPair(request.symbol);
      const rawPair = getRawSymbol(pair);
      const timestamp = Date.now();

      const body: Record<string, unknown> = {
        symbol: rawPair,
        side: request.side,
        type: request.type,
        quantity: request.quantity,
        leverage: request.leverage,
        marginMode: request.marginMode,
        timestamp,
      };

      if (request.type === "LIMIT" && request.price) body.price = request.price;
      if (request.reduceOnly) body.reduceOnly = true;
      if (request.stopLossPrice) body.stopLossPrice = request.stopLossPrice;
      if (request.takeProfitPrice) body.takeProfitPrice = request.takeProfitPrice;

      const queryString = new URLSearchParams(
        Object.entries(body).map(([k, v]) => [k, String(v)]),
      ).toString();

      const res = await fetch(`${BITUNIX_FUTURES_REST}/api/v1/futures/order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BX-APIKEY": this.apiKey ?? "",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Bitunix futures order failed (${res.status}): ${errText}`);
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
        throw new Error(`Bitunix futures error: ${data.code}`);
      }

      const d = data.data ?? {};
      return {
        orderId: d.orderId ?? `unknown_${timestamp}`,
        symbol: d.symbol ?? rawPair,
        side: (d.side as "BUY" | "SELL") ?? request.side,
        type: (d.type as "MARKET" | "LIMIT") ?? request.type,
        quantity: parseFloat(d.origQty ?? "0") || request.quantity,
        filledQuantity: parseFloat(d.executedQty ?? "0"),
        avgPrice: parseFloat(d.avgPrice ?? "0"),
        status: (d.status === "FILLED" ? "FILLED" : d.status === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : "PENDING") as OrderResult["status"],
        fee: parseFloat(d.fee ?? "0"),
        feeAsset: d.feeAsset ?? "USDT",
        timestamp,
        isPaper: false,
      };
    } catch (err) {
      console.error("[Bitunix] placePerpetualOrder live error:", err);
      throw err;
    }
  }

  async getPerpetualPositions(symbol?: string): Promise<PerpetualPosition[]> {
    if (!this.isLive) {
      return this.paperGetPerpetualPositions(symbol);
    }

    try {
      const params = new URLSearchParams({ timestamp: Date.now().toString() });
      if (symbol) {
        const pair = getBitunixPair(symbol);
        params.set("symbol", getRawSymbol(pair));
      }

      const res = await fetch(
        `${BITUNIX_FUTURES_REST}/api/v1/futures/positions?${params.toString()}`,
        {
          headers: {
            "X-BX-APIKEY": this.apiKey ?? "",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        },
      );

      if (!res.ok) throw new Error(`Bitunix positions fetch failed: ${res.status}`);

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
        throw new Error(`Bitunix positions error: ${data.code}`);
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
    } catch (err) {
      console.error("[Bitunix] getPerpetualPositions live error:", err);
      throw err;
    }
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (!this.isLive) {
      // Paper mode: silently record leverage (applied when opening position)
      console.log(`[Bitunix] Paper leverage set: ${symbol} ${leverage}x`);
      return;
    }

    try {
      const pair = getBitunixPair(symbol);
      const rawPair = getRawSymbol(pair);
      const timestamp = Date.now();

      const res = await fetch(`${BITUNIX_FUTURES_REST}/api/v1/futures/leverage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BX-APIKEY": this.apiKey ?? "",
        },
        body: JSON.stringify({ symbol: rawPair, leverage, timestamp }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Bitunix setLeverage failed (${res.status}): ${errText}`);
      }
    } catch (err) {
      console.error("[Bitunix] setLeverage error:", err);
      throw err;
    }
  }

  async closePerpetualPosition(symbol: string): Promise<OrderResult> {
    const pair = getBitunixPair(symbol);
    const rawPair = getRawSymbol(pair);
    const timestamp = Date.now();

    if (!this.isLive) {
      return this.paperClosePerpetualPosition(rawPair, timestamp);
    }

    try {
      const res = await fetch(`${BITUNIX_FUTURES_REST}/api/v1/futures/order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BX-APIKEY": this.apiKey ?? "",
        },
        body: JSON.stringify({
          symbol: rawPair,
          side: "SELL",
          type: "MARKET",
          quantity: 0, // close all
          reduceOnly: true,
          timestamp,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Bitunix close position failed (${res.status}): ${errText}`);
      }

      const data = await res.json() as {
        code?: string;
        data?: { orderId?: string; avgPrice?: string; executedQty?: string; fee?: string };
      };

      const d = data.data ?? {};
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
    } catch (err) {
      console.error("[Bitunix] closePerpetualPosition error:", err);
      throw err;
    }
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
    marginMode: "isolated" | "cross",
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
