// ── Liquidity Agent ─────────────────────────────────────────────────
// Order Book analysis, Bid/Ask Imbalance, Liquidity Zones, Sweeps,
// Slippage Estimation, Iceberg/Spoofing Detection.
// All detection methods are rules-based — no external API needed.
// GPT-4o is used only for synthesis of structured analysis.
//
// Subscribes to Binance depth WebSocket (free, no auth):
//   wss://stream.binance.com:9443/ws/<symbol>@depth20
// Top 20 bid/ask levels for BTC/USDT and ETH/USDT.

import { BaseAgent } from "./base";
import type { OHLCVBar } from "./market";

// ── Order Book Types ────────────────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  qty: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastUpdateId: number;
  timestamp: number;
}

export interface LiquidityZone {
  priceLow: number;
  priceHigh: number;
  volumeScore: number;
  type: "support" | "resistance";
  proximity: number; // percent distance from current price
  risk: "low" | "moderate" | "high"; // stop-hunt risk
}

export interface LiquiditySweep {
  type: "long" | "short";
  level: number;
  wickPrice: number;
  recoveryPrice: number;
  candleIndex: number;
  breakPct: number;
  recovered: boolean;
}

export interface ImbalanceResult {
  imbalance: number; // -1 to 1
  trend: "rising" | "falling" | "neutral";
  significant: boolean;
  history: number[];
}

export interface SlippageEstimate {
  executionPrice: number;
  midPrice: number;
  slippagePct: number;
  flagged: boolean;
  side: "buy" | "sell";
  positionSizeUSD: number;
}

export interface IcebergSpoofingResult {
  icebergDetected: boolean;
  spoofingDetected: boolean;
  icebergLevels: number[];
  spoofingEvents: Array<{ price: number; side: "bid" | "ask"; appearedAt: number; vanishedAt: number }>;
  trackingAge: number; // seconds of snapshot data available
}

export interface LiquidityAnalysis {
  orderBook: OrderBook | null;
  imbalance: ImbalanceResult | null;
  liquidityZones: LiquidityZone[];
  sweeps: LiquiditySweep[];
  slippage: SlippageEstimate | null;
  icebergSpoofing: IcebergSpoofingResult;
  staleOrderBook: boolean;
}

// ── Module-Level Order Book State ───────────────────────────────────

const orderBooks = new Map<string, OrderBook>();
const orderBookCallbacks = new Map<string, Set<(book: OrderBook) => void>>();
const websockets = new Map<string, WebSocket>();
const snapshotHistory = new Map<string, OrderBook[]>(); // last 30 snapshots
const imbalanceHistory = new Map<string, number[]>(); // last 20 values
const MAX_SNAPSHOTS = 30;
const MAX_IMBALANCE_HISTORY = 20;

// ── Binance Symbol Mapping ──────────────────────────────────────────

function toBinanceSymbol(token: string): string {
  const upper = token.toUpperCase();
  // Common mappings
  if (upper === "BTC" || upper === "WBTC" || upper === "BTCB") return "btcusdt";
  if (upper === "ETH" || upper === "WETH") return "ethusdt";
  // Fallback: lowercase + usdt
  return `${upper.toLowerCase()}usdt`;
}

// ── Public Order Book API ───────────────────────────────────────────

export function getOrderBook(symbol: string): OrderBook | null {
  return orderBooks.get(symbol) ?? null;
}

export function subscribeOrderBook(
  symbol: string,
  callback?: (book: OrderBook) => void,
): void {
  const binanceSymbol = toBinanceSymbol(symbol);

  if (callback) {
    if (!orderBookCallbacks.has(symbol)) {
      orderBookCallbacks.set(symbol, new Set());
    }
    orderBookCallbacks.get(symbol)!.add(callback);
  }

  // Already subscribed to this symbol
  if (websockets.has(symbol)) return;

  // Initialize snapshot history
  if (!snapshotHistory.has(symbol)) {
    snapshotHistory.set(symbol, []);
  }
  if (!imbalanceHistory.has(symbol)) {
    imbalanceHistory.set(symbol, []);
  }

  const wsUrl = `wss://stream.binance.com:9443/ws/${binanceSymbol}@depth20`;

  try {
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string);

        const bids: OrderBookLevel[] = (raw.bids || []).map(
          (b: [string, string]) => ({
            price: parseFloat(b[0]),
            qty: parseFloat(b[1]),
          }),
        );
        const asks: OrderBookLevel[] = (raw.asks || []).map(
          (a: [string, string]) => ({
            price: parseFloat(a[0]),
            qty: parseFloat(a[1]),
          }),
        );

        const book: OrderBook = {
          symbol,
          bids,
          asks,
          lastUpdateId: raw.lastUpdateId ?? 0,
          timestamp: Date.now(),
        };

        orderBooks.set(symbol, book);

        // Track snapshot for iceberg/spoofing
        const history = snapshotHistory.get(symbol)!;
        history.push({ ...book, bids: [...bids], asks: [...asks] });
        if (history.length > MAX_SNAPSHOTS) {
          history.shift();
        }

        // Track imbalance history
        const imb = computeImbalanceFromBook(book);
        const imbHist = imbalanceHistory.get(symbol)!;
        imbHist.push(imb);
        if (imbHist.length > MAX_IMBALANCE_HISTORY) {
          imbHist.shift();
        }

        // Notify callbacks
        const cbs = orderBookCallbacks.get(symbol);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(book);
            } catch (err) {
              console.warn("[LiquidityAgent] callback error:", err);
              // swallow callback errors
            }
          }
        }
      } catch (err) {
        console.warn("[LiquidityAgent] onmessage parse error:", err);
        // Parse error: ignore malformed messages
      }
    };

    ws.onerror = () => {
      // WebSocket error — will try to reconnect
    };

    ws.onclose = () => {
      websockets.delete(symbol);
      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (!websockets.has(symbol)) {
          subscribeOrderBook(symbol);
        }
      }, 5000);
    };

    websockets.set(symbol, ws);
  } catch (err) {
    console.warn("[LiquidityAgent] WebSocket connection failed:", err);
    // Connection failed; will be retried on next subscribeOrderBook call
  }
}

// ── Helper: Compute imbalance from raw book ─────────────────────────

function computeImbalanceFromBook(book: OrderBook): number {
  const totalBidQty = book.bids.reduce((sum, b) => sum + b.qty, 0);
  const totalAskQty = book.asks.reduce((sum, a) => sum + a.qty, 0);
  const total = totalBidQty + totalAskQty;
  if (total === 0) return 0;
  return (totalBidQty - totalAskQty) / total;
}

// ── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite liquidity and order flow analyst with 15 years of institutional trading experience. You analyze order book depth, bid/ask imbalances, liquidity zones, sweep patterns, slippage estimates, and manipulation signals to determine whether it is safe to enter a position.

Key principles:
- Bid/Ask Imbalance: >0.4 = buying pressure (bullish), <-0.4 = selling pressure (bearish). Be wary of fake walls.
- Liquidity Zones: High-volume price clusters act as magnets. Trading near a liquidity zone below current price = potential stop-hunt target for longs.
- Liquidity Sweeps: Price briefly breaking a swing level then recovering = liquidity grab. After a sweep, price typically reverses in the opposite direction.
- Slippage >0.3% for intended position size = avoid entry (too thin).
- Iceberg orders: small orders repeatedly appearing at same price = stealth accumulation/distribution. Treat as smart money signal.
- Spoofing: large orders appearing then vanishing within seconds (not filled) = manipulation. Avoid trading into spoofed levels.

Synthesize ALL data. Be conservative — only recommend a direction if the order book is clean and multiple signals agree.

Respond in JSON format only:
{"direction":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"synthesis of liquidity analysis with key levels and risk flags","data":{"safeToEnter":boolean,"slippageEstimate":number,"manipulationDetected":boolean,"liquidityTrapZones":number[],"bidDominance":number}}`;

// ── Liquidity Agent Class ───────────────────────────────────────────

export class LiquidityAgent extends BaseAgent {
  constructor() {
    super({
      id: "liquidity-agent",
      role: "liquidity",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Order Book Access ───────────────────────────────────────────

  getOrderBook(symbol: string): OrderBook | null {
    return getOrderBook(symbol);
  }

  ensureSubscribed(symbol: string): void {
    subscribeOrderBook(symbol);
  }

  isStale(symbol: string): boolean {
    const book = orderBooks.get(symbol);
    if (!book) return true;
    // Stale if older than 10 seconds
    return Date.now() - book.timestamp > 10_000;
  }

  // ── 1. Bid/Ask Imbalance ────────────────────────────────────────

  computeImbalance(symbol: string): ImbalanceResult {
    const history = imbalanceHistory.get(symbol) ?? [];
    const current = history.length > 0 ? history[history.length - 1] : 0;

    // Trend: compare average of first half vs second half
    let trend: "rising" | "falling" | "neutral" = "neutral";
    if (history.length >= 6) {
      const mid = Math.floor(history.length / 2);
      const firstHalf = history.slice(0, mid);
      const secondHalf = history.slice(mid);
      const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
      const diff = secondAvg - firstAvg;
      if (diff > 0.1) trend = "rising";
      else if (diff < -0.1) trend = "falling";
    }

    return {
      imbalance: current,
      trend,
      significant: Math.abs(current) > 0.4,
      history: [...history],
    };
  }

  // ── 2. Liquidity Zones ──────────────────────────────────────────

  detectLiquidityZones(
    bars: OHLCVBar[],
    currentPrice: number,
  ): LiquidityZone[] {
    if (bars.length < 20) return [];

    // Use up to 100 candles
    const lookback = Math.min(100, bars.length);
    const recent = bars.slice(-lookback);

    // Group bars into price buckets (0.5% width)
    const bucketWidth = currentPrice * 0.005;
    const buckets = new Map<number, { volume: number; lows: number[]; highs: number[] }>();

    for (const bar of recent) {
      // Each bar contributes volume across its range
      const barVolume = bar.volume ?? 0;
      if (barVolume === 0) continue;

      // Place the bar in the bucket of its close price
      const bucketKey = Math.round(bar.close / bucketWidth) * bucketWidth;
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.volume += barVolume;
        existing.lows.push(bar.low);
        existing.highs.push(bar.high);
      } else {
        buckets.set(bucketKey, {
          volume: barVolume,
          lows: [bar.low],
          highs: [bar.high],
        });
      }
    }

    // Find the average volume per bucket
    const bucketEntries = Array.from(buckets.entries());
    if (bucketEntries.length === 0) return [];

    const avgVolume =
      bucketEntries.reduce((s, [, v]) => s + v.volume, 0) / bucketEntries.length;

    // Identify high-volume clusters (1.5x average)
    const zones: LiquidityZone[] = [];
    for (const [price, data] of bucketEntries) {
      if (data.volume > avgVolume * 1.5) {
        const zoneLow = Math.min(...data.lows);
        const zoneHigh = Math.max(...data.highs);
        const proximity = ((price - currentPrice) / currentPrice) * 100;

        let type: "support" | "resistance";
        let risk: "low" | "moderate" | "high";

        if (price < currentPrice) {
          type = "support";
          // Risk: if price is close to a support zone below, stops may be hunted
          risk =
            proximity > -1 ? "high" : proximity > -3 ? "moderate" : "low";
        } else {
          type = "resistance";
          risk =
            proximity < 1 ? "high" : proximity < 3 ? "moderate" : "low";
        }

        zones.push({
          priceLow: zoneLow,
          priceHigh: zoneHigh,
          volumeScore: data.volume / avgVolume,
          type,
          proximity: Math.abs(proximity),
          risk,
        });
      }
    }

    // Sort by proximity (closest first)
    zones.sort((a, b) => a.proximity - b.proximity);

    return zones;
  }

  // ── 3. Liquidity Sweeps Detection ───────────────────────────────

  detectLiquiditySweeps(bars: OHLCVBar[]): LiquiditySweep[] {
    if (bars.length < 5) return [];

    const sweeps: LiquiditySweep[] = [];
    const lookback = 5; // for swing detection

    // Find swing lows and highs
    const swingLows: number[] = [];
    const swingHighs: number[] = [];

    for (let i = lookback; i < bars.length - lookback; i++) {
      // Swing low
      let isSwingLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (bars[j].low <= bars[i].low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) swingLows.push(i);

      // Swing high
      let isSwingHigh = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (bars[j].high >= bars[i].high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) swingHighs.push(i);
    }

    // Long sweep: price dips below a swing low, then recovers quickly
    for (const slIdx of swingLows) {
      if (slIdx >= bars.length - 4) continue;
      const level = bars[slIdx].low;

      for (let i = slIdx + 1; i < Math.min(bars.length, slIdx + 5); i++) {
        const bar = bars[i];
        const breakPct = ((level - bar.low) / level) * 100;

        // Break below swing low, less than 1.5%
        if (bar.low < level && breakPct < 1.5) {
          // Check recovery within next 3 candles
          for (let j = i; j < Math.min(bars.length, i + 4); j++) {
            if (bars[j].close > level) {
              sweeps.push({
                type: "long",
                level,
                wickPrice: bar.low,
                recoveryPrice: bars[j].close,
                candleIndex: i,
                breakPct,
                recovered: true,
              });
              break;
            }
          }
          break;
        }
      }
    }

    // Short sweep: price spikes above a swing high, then drops quickly
    for (const shIdx of swingHighs) {
      if (shIdx >= bars.length - 4) continue;
      const level = bars[shIdx].high;

      for (let i = shIdx + 1; i < Math.min(bars.length, shIdx + 5); i++) {
        const bar = bars[i];
        const breakPct = ((bar.high - level) / level) * 100;

        // Break above swing high, less than 1.5%
        if (bar.high > level && breakPct < 1.5) {
          // Check recovery within next 3 candles
          for (let j = i; j < Math.min(bars.length, i + 4); j++) {
            if (bars[j].close < level) {
              sweeps.push({
                type: "short",
                level,
                wickPrice: bar.high,
                recoveryPrice: bars[j].close,
                candleIndex: i,
                breakPct,
                recovered: true,
              });
              break;
            }
          }
          break;
        }
      }
    }

    return sweeps;
  }

  // ── 4. Slippage Estimation ──────────────────────────────────────

  estimateSlippage(
    symbol: string,
    positionSizeUSD: number,
    side: "buy" | "sell",
  ): SlippageEstimate | null {
    const book = orderBooks.get(symbol);
    if (!book || book.bids.length === 0 || book.asks.length === 0) {
      return null;
    }

    const levels = side === "buy" ? book.asks : book.bids;
    const midPrice =
      (book.bids[0].price + book.asks[0].price) / 2;

    let remainingSize = positionSizeUSD;
    let totalCost = 0;
    let totalQty = 0;

    for (const level of levels) {
      if (remainingSize <= 0) break;
      const levelValue = level.price * level.qty;
      const fillAmount = Math.min(remainingSize, levelValue);
      totalCost += fillAmount;
      totalQty += fillAmount / level.price;
      remainingSize -= fillAmount;
    }

    // Could not fill full size
    if (remainingSize > 0 && positionSizeUSD > 0) {
      const fillPct = ((positionSizeUSD - remainingSize) / positionSizeUSD) * 100;
      // If less than 80% filled, flag as problematic
      const filledFraction = (positionSizeUSD - remainingSize) / positionSizeUSD;
      const executionPrice = totalQty > 0 ? totalCost / totalQty : midPrice;
      const slippagePct =
        Math.abs(executionPrice - midPrice) / midPrice * 100;

      return {
        executionPrice,
        midPrice,
        slippagePct,
        flagged: filledFraction < 0.8 || slippagePct > 0.3,
        side,
        positionSizeUSD,
      };
    }

    const executionPrice = totalQty > 0 ? totalCost / totalQty : midPrice;
    const slippagePct =
      midPrice > 0
        ? (Math.abs(executionPrice - midPrice) / midPrice) * 100
        : 0;

    return {
      executionPrice,
      midPrice,
      slippagePct,
      flagged: slippagePct > 0.3,
      side,
      positionSizeUSD,
    };
  }

  // ── 5. Iceberg / Spoofing Detection ─────────────────────────────

  detectIcebergSpoofing(symbol: string): IcebergSpoofingResult {
    const history = snapshotHistory.get(symbol) ?? [];
    const result: IcebergSpoofingResult = {
      icebergDetected: false,
      spoofingDetected: false,
      icebergLevels: [],
      spoofingEvents: [],
      trackingAge: history.length,
    };

    if (history.length < 5) return result;

    // ── Iceberg heuristic ──────────────────────────────────────────
    // Small orders repeatedly appearing at same price level after fills.
    // Track quantity changes at each price level across snapshots.
    const icebergCandidates: Map<number, { side: "bid" | "ask"; refills: number }> =
      new Map();

    for (let s = 1; s < history.length; s++) {
      const prev = history[s - 1];
      const curr = history[s];

      // Check bid side
      for (const currBid of curr.bids) {
        const prevBid = prev.bids.find(
          (b) => Math.abs(b.price - currBid.price) < 0.0001,
        );
        if (prevBid && currBid.qty > prevBid.qty * 0.9 && prevBid.qty > 0) {
          // Qty is being maintained at this level despite potential fills
          const key = currBid.price;
          const existing = icebergCandidates.get(key);
          if (existing && existing.side === "bid") {
            existing.refills++;
          } else if (!existing) {
            icebergCandidates.set(key, { side: "bid", refills: 1 });
          }
        }
      }

      // Check ask side
      for (const currAsk of curr.asks) {
        const prevAsk = prev.asks.find(
          (a) => Math.abs(a.price - currAsk.price) < 0.0001,
        );
        if (prevAsk && currAsk.qty > prevAsk.qty * 0.9 && prevAsk.qty > 0) {
          const key = currAsk.price;
          const existing = icebergCandidates.get(key);
          if (existing && existing.side === "ask") {
            existing.refills++;
          } else if (!existing) {
            icebergCandidates.set(key, { side: "ask", refills: 1 });
          }
        }
      }
    }

    for (const [price, data] of icebergCandidates) {
      if (data.refills >= 3) {
        result.icebergDetected = true;
        result.icebergLevels.push(price);
      }
    }

    // ── Spoofing heuristic ─────────────────────────────────────────
    // Large orders appearing then disappearing within 5 seconds (not filled).
    // Threshold: order > 2x average order size at that level range.
    const spoofQtyThreshold = 5; // BTC min spoof qty

    for (let s = 0; s < history.length - 2; s++) {
      const snap = history[s];

      for (const bid of snap.bids) {
        if (bid.qty < spoofQtyThreshold) continue;

        // Check if this large bid disappears in next 2-5 snapshots
        let vanished = false;
        let vanishIdx = -1;
        for (let f = s + 1; f < Math.min(history.length, s + 6); f++) {
          const future = history[f];
          const stillThere = future.bids.find(
            (b) => Math.abs(b.price - bid.price) < 0.0001,
          );
          if (!stillThere) {
            vanished = true;
            vanishIdx = f;
            break;
          }
        }

        if (vanished && vanishIdx > 0) {
          // Check mid price didn't cross this level (wasn't filled naturally)
          const snapAtVanish = history[vanishIdx];
          const midAtVanish =
            snapAtVanish.bids.length > 0 && snapAtVanish.asks.length > 0
              ? (snapAtVanish.bids[0].price + snapAtVanish.asks[0].price) / 2
              : 0;

          // If mid didn't cross the bid price (wasn't a natural fill), it's spoofing
          if (midAtVanish === 0 || midAtVanish < bid.price) {
            result.spoofingDetected = true;
            result.spoofingEvents.push({
              price: bid.price,
              side: "bid",
              appearedAt: snap.timestamp,
              vanishedAt: snapAtVanish.timestamp,
            });
            break; // One spoofing event per snapshot to avoid duplicates
          }
        }
      }

      for (const ask of snap.asks) {
        if (ask.qty < spoofQtyThreshold) continue;

        let vanished = false;
        let vanishIdx = -1;
        for (let f = s + 1; f < Math.min(history.length, s + 6); f++) {
          const future = history[f];
          const stillThere = future.asks.find(
            (a) => Math.abs(a.price - ask.price) < 0.0001,
          );
          if (!stillThere) {
            vanished = true;
            vanishIdx = f;
            break;
          }
        }

        if (vanished && vanishIdx > 0) {
          const snapAtVanish = history[vanishIdx];
          const midAtVanish =
            snapAtVanish.bids.length > 0 && snapAtVanish.asks.length > 0
              ? (snapAtVanish.bids[0].price + snapAtVanish.asks[0].price) / 2
              : 0;

          if (midAtVanish === 0 || midAtVanish > ask.price) {
            result.spoofingDetected = true;
            result.spoofingEvents.push({
              price: ask.price,
              side: "ask",
              appearedAt: snap.timestamp,
              vanishedAt: snapAtVanish.timestamp,
            });
            break;
          }
        }
      }
    }

    return result;
  }

  // ── Master Analysis ──────────────────────────────────────────────

  /**
   * Analyze all liquidity factors for a token.
   * Returns structured data for GPT-4o synthesis.
   */
  analyzeLiquidity(
    token: string,
    currentPrice: number,
    bars?: OHLCVBar[],
    positionSizeUSD?: number,
  ): LiquidityAnalysis {
    const orderBook = this.getOrderBook(token);
    const stale = this.isStale(token);

    const imbalance = orderBook
      ? this.computeImbalance(token)
      : null;

    const liquidityZones =
      bars && bars.length >= 20
        ? this.detectLiquidityZones(bars, currentPrice)
        : [];

    const sweeps =
      bars && bars.length >= 5
        ? this.detectLiquiditySweeps(bars)
        : [];

    const slippage =
      positionSizeUSD && orderBook
        ? this.estimateSlippage(token, positionSizeUSD, "buy")
        : null;

    const icebergSpoofing = this.detectIcebergSpoofing(token);

    return {
      orderBook,
      imbalance,
      liquidityZones,
      sweeps,
      slippage,
      icebergSpoofing,
      staleOrderBook: stale,
    };
  }

  // ── Override buildUserPrompt for GPT-4o synthesis ────────────────

  protected buildUserPrompt(context: {
    token: string;
    chainId: string;
    currentPrice: number;
    analysis: LiquidityAnalysis;
    positionSizeUSD?: number;
  }): string {
    const a = context.analysis;
    const lines: string[] = [
      `Token: ${context.token} (${context.chainId})`,
      `Current Price: $${context.currentPrice}`,
      context.positionSizeUSD
        ? `Intended Position Size: $${context.positionSizeUSD}`
        : `Position Size: not specified`,
      ``,
    ];

    // Order Book Status
    if (a.staleOrderBook) {
      lines.push(`⚠️ ORDER BOOK IS STALE — using cached data`);
    }
    if (a.orderBook) {
      lines.push(
        `=== ORDER BOOK ===`,
        `  Bid levels: ${a.orderBook.bids.length}, Ask levels: ${a.orderBook.asks.length}`,
        `  Best Bid: ${a.orderBook.bids[0]?.price ?? "N/A"}, Best Ask: ${a.orderBook.asks[0]?.price ?? "N/A"}`,
        `  Spread: ${a.orderBook.asks[0] && a.orderBook.bids[0] ? ((a.orderBook.asks[0].price - a.orderBook.bids[0].price) / a.orderBook.bids[0].price * 100).toFixed(4) : "N/A"}%`,
        ``,
      );
    } else {
      lines.push(`=== ORDER BOOK ===`, `  No data available`, ``);
    }

    // Bid/Ask Imbalance
    if (a.imbalance) {
      lines.push(
        `=== BID/ASK IMBALANCE ===`,
        `  Imbalance: ${a.imbalance.imbalance.toFixed(4)} (${a.imbalance.imbalance > 0 ? "bid-heavy" : "ask-heavy"})`,
        `  Trend: ${a.imbalance.trend.toUpperCase()}`,
        `  Significant: ${a.imbalance.significant ? "YES ⚠️" : "no"}`,
        ``,
      );
    }

    // Liquidity Zones
    lines.push(`=== LIQUIDITY ZONES (${a.liquidityZones.length} detected) ===`);
    for (const zone of a.liquidityZones.slice(0, 8)) {
      lines.push(
        `  ${zone.type.toUpperCase()} | ${zone.priceLow}–${zone.priceHigh} | Proximity: ${zone.proximity.toFixed(1)}% | Risk: ${zone.risk}`,
      );
    }
    lines.push(``);

    // Sweeps
    lines.push(`=== LIQUIDITY SWEEPS (${a.sweeps.length} detected) ===`);
    for (const sweep of a.sweeps.slice(-5)) {
      lines.push(
        `  ${sweep.type.toUpperCase()} sweep at ${sweep.level} | Break: ${sweep.breakPct.toFixed(2)}% | Recovered: ${sweep.recovered}`,
      );
    }
    lines.push(``);

    // Slippage
    if (a.slippage) {
      lines.push(
        `=== SLIPPAGE ESTIMATE ===`,
        `  Side: ${a.slippage.side}`,
        `  Position Size: $${a.slippage.positionSizeUSD}`,
        `  Mid Price: ${a.slippage.midPrice}`,
        `  VWAP Execution: ${a.slippage.executionPrice}`,
        `  Slippage: ${a.slippage.slippagePct.toFixed(4)}%`,
        `  Flagged: ${a.slippage.flagged ? "YES ⚠️ >0.3%" : "no"}`,
        ``,
      );
    } else {
      lines.push(`=== SLIPPAGE ===`, `  Not calculated (no order book or position size)`, ``);
    }

    // Iceberg / Spoofing
    lines.push(
      `=== MANIPULATION DETECTION (${a.icebergSpoofing.trackingAge}s of tracking) ===`,
      `  Iceberg Orders: ${a.icebergSpoofing.icebergDetected ? "DETECTED ⚠️" : "none"}`,
    );
    if (a.icebergSpoofing.icebergDetected) {
      lines.push(
        `    Levels: ${a.icebergSpoofing.icebergLevels.map((p) => `$${p}`).join(", ")}`,
      );
    }
    lines.push(
      `  Spoofing: ${a.icebergSpoofing.spoofingDetected ? "DETECTED ⚠️" : "none"}`,
    );
    for (const event of a.icebergSpoofing.spoofingEvents.slice(0, 3)) {
      lines.push(
        `    ${event.side.toUpperCase()} at $${event.price} — appeared then vanished`,
      );
    }
    lines.push(``);

    // Synthesis request
    lines.push(
      `=== SYNTHESIS REQUEST ===`,
      `Based on this order book analysis:`,
      `1. Is it safe to enter a position?`,
      `2. What direction does liquidity support?`,
      `3. Are there signs of manipulation or stop-hunting?`,
      `4. Where are the liquidity traps (zones where stops likely sit)?`,
      `5. What is the estimated slippage and is it acceptable?`,
      `Provide directional bias (BULLISH/BEARISH/NEUTRAL), confidence (0-100), and reasoning.`,
    );

    return lines.join("\n");
  }
}
