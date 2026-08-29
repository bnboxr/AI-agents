// ── Trading Signals Library ─────────────────────────────────────────
// Generates AI trading signals, caches daily signal, and manages
// Stripe-gated premium access for the /signals page.
//
// Uses:
//  - CoinGecko API for live prices
//  - Technical indicators (RSI, MACD, EMA, SMA) from ~/lib/indicators
//  - Revenue signal store from ~/lib/revenue/trading-data

import { createServerFn } from "@tanstack/react-start";
import {
  computeRSI,
  computeEMA,
  computeSMA,
  computeMACD,
} from "~/lib/indicators";
import {
  createSignal,
  getSignalHistory as getRevenueSignalHistory,
  calculateQualityMetrics,
} from "~/lib/revenue/trading-data";
import type { TradingSignal as RevenueTradingSignal } from "~/lib/revenue/trading-data";

// ── Types ──────────────────────────────────────────────────────────

export interface TradingSignal {
  id: string;
  pair: string; // "BTC/USDT", "ETH/USDT", etc.
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number; // 0-100
  reasoning: string; // AI analysis summary
  timestamp: number;
  status: "active" | "hit" | "miss" | "expired";
}

export interface SignalStats {
  totalSignals: number;
  hitCount: number;
  missCount: number;
  winRate: number;
  avgReturn: number;
}

// ── Supported Trading Pairs ────────────────────────────────────────

const TRADING_PAIRS = [
  { symbol: "BTC", coingeckoId: "bitcoin", pair: "BTC/USDT" },
  { symbol: "ETH", coingeckoId: "ethereum", pair: "ETH/USDT" },
  { symbol: "SOL", coingeckoId: "solana", pair: "SOL/USDT" },
  { symbol: "BNB", coingeckoId: "binancecoin", pair: "BNB/USDT" },
  { symbol: "MATIC", coingeckoId: "matic-network", pair: "MATIC/USDT" },
  { symbol: "AVAX", coingeckoId: "avalanche-2", pair: "AVAX/USDT" },
  { symbol: "LINK", coingeckoId: "chainlink", pair: "LINK/USDT" },
  { symbol: "XRP", coingeckoId: "ripple", pair: "XRP/USDT" },
];

// ── Daily Signal Cache ─────────────────────────────────────────────

let _dailySignalCache: {
  signal: TradingSignal;
  timestamp: number;
} | null = null;
const DAILY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── Market Data Fetching ───────────────────────────────────────────

async function fetchCoinGeckoPrices(): Promise<
  Map<string, { price: number; change24h: number }>
> {
  const ids = TRADING_PAIRS.map((p) => p.coingeckoId).join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  );
  if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
  const data = (await res.json()) as Record<
    string,
    { usd: number; usd_24h_change?: number }
  >;
  const map = new Map<string, { price: number; change24h: number }>();
  for (const pair of TRADING_PAIRS) {
    const d = data[pair.coingeckoId];
    if (d?.usd) {
      map.set(pair.pair, {
        price: d.usd,
        change24h: d.usd_24h_change ?? 0,
      });
    }
  }
  return map;
}

async function fetchHistoricalPrices(
  coingeckoId: string
): Promise<number[]> {
  // Fetch 7 days of daily prices for technical analysis
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=7`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { prices: [number, number][] };
  return (data.prices ?? []).map((p) => p[1]);
}

// ── Confidence Computation ─────────────────────────────────────────

/**
 * "Agent consensus" simulation using multiple technical indicators.
 * Each indicator votes LONG/SHORT/NEUTRAL with a confidence level.
 * The final confidence is a weighted blend of all indicator votes.
 */
interface IndicatorVote {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number; // 0-100
  label: string;
}

function analyzeWithIndicators(
  prices: number[],
  change24h: number,
  currentPrice: number
): { direction: "LONG" | "SHORT"; confidence: number; reasoning: string } {
  const votes: IndicatorVote[] = [];

  if (prices.length >= 14) {
    // RSI vote (14-period)
    const rsi = computeRSI(prices, 14);
    if (rsi < 35) {
      votes.push({
        direction: "LONG",
        confidence: Math.round(2 * (35 - rsi)),
        label: `RSI oversold (${rsi.toFixed(1)})`,
      });
    } else if (rsi > 65) {
      votes.push({
        direction: "SHORT",
        confidence: Math.round(2 * (rsi - 65)),
        label: `RSI overbought (${rsi.toFixed(1)})`,
      });
    } else {
      votes.push({
        direction: "NEUTRAL",
        confidence: 50,
        label: `RSI neutral (${rsi.toFixed(1)})`,
      });
    }
  }

  if (prices.length >= 26) {
    // MACD vote
    const macd = computeMACD(prices);
    if (macd.histogram > 0 && macd.value > macd.signal) {
      votes.push({
        direction: "LONG",
        confidence: Math.min(80, 50 + Math.abs(macd.histogram) * 200),
        label: "MACD bullish crossover",
      });
    } else if (macd.histogram < 0 && macd.value < macd.signal) {
      votes.push({
        direction: "SHORT",
        confidence: Math.min(80, 50 + Math.abs(macd.histogram) * 200),
        label: "MACD bearish crossover",
      });
    } else {
      votes.push({
        direction: "NEUTRAL",
        confidence: 45,
        label: "MACD neutral",
      });
    }
  }

  // EMA trend (EMA-12 vs EMA-26)
  if (prices.length >= 26) {
    const ema12 = computeEMA(prices, 12);
    const ema26 = computeEMA(prices, 26);
    if (ema12 > ema26) {
      votes.push({
        direction: "LONG",
        confidence: 55,
        label: `EMA12 > EMA26 (bullish trend)`,
      });
    } else {
      votes.push({
        direction: "SHORT",
        confidence: 55,
        label: `EMA12 < EMA26 (bearish trend)`,
      });
    }
  }

  // Price vs SMA-20
  if (prices.length >= 20) {
    const sma20 = computeSMA(prices, 20);
    if (currentPrice > sma20) {
      votes.push({
        direction: "LONG",
        confidence: 50,
        label: `Price above SMA20`,
      });
    } else {
      votes.push({
        direction: "SHORT",
        confidence: 50,
        label: `Price below SMA20`,
      });
    }
  }

  // 24h momentum
  if (change24h > 5) {
    votes.push({
      direction: "LONG",
      confidence: Math.min(70, 40 + change24h * 2),
      label: `Strong 24h momentum (+${change24h.toFixed(1)}%)`,
    });
  } else if (change24h < -5) {
    votes.push({
      direction: "SHORT",
      confidence: Math.min(70, 40 + Math.abs(change24h) * 2),
      label: `Strong 24h decline (${change24h.toFixed(1)}%)`,
    });
  }

  // Tally votes
  let longVotes = 0;
  let longConfSum = 0;
  let shortVotes = 0;
  let shortConfSum = 0;
  const reasoningParts: string[] = [];

  for (const v of votes) {
    reasoningParts.push(`${v.label} → ${v.direction} (${v.confidence}%)`);
    if (v.direction === "LONG") {
      longVotes++;
      longConfSum += v.confidence;
    } else if (v.direction === "SHORT") {
      shortVotes++;
      shortConfSum += v.confidence;
    }
  }

  const totalVotes = longVotes + shortVotes || 1;
  const direction = longVotes >= shortVotes ? "LONG" : "SHORT";
  const avgConf =
    direction === "LONG"
      ? longConfSum / longVotes
      : shortConfSum / shortVotes;

  // Weight: majority * average confidence
  const majorityPct = (Math.max(longVotes, shortVotes) / totalVotes) * 100;
  const confidence = Math.round((avgConf * 0.5 + majorityPct * 0.5));

  const reasoning = `Multi-indicator consensus (${votes.length} signals):\n${reasoningParts.join("\n")}\n→ ${direction} with ${confidence}% confidence (${longVotes}L / ${shortVotes}S)`;

  return { direction, confidence, reasoning };
}

// ── Signal Generator ───────────────────────────────────────────────

export function generateSignal(): Promise<TradingSignal> {
  return generateSignalImpl();
}

async function generateSignalImpl(): Promise<TradingSignal> {
  // Fetch live prices
  const priceMap = await fetchCoinGeckoPrices();
  if (priceMap.size === 0) {
    throw new Error("No market data available");
  }

  // Pick the best pair based on volatility
  let bestPair = TRADING_PAIRS[0].pair;
  let bestVolatility = 0;

  for (const pair of TRADING_PAIRS) {
    const info = priceMap.get(pair.pair);
    if (info && Math.abs(info.change24h) > Math.abs(bestVolatility)) {
      bestVolatility = info.change24h;
      bestPair = pair.pair;
    }
  }

  const bestPairConfig = TRADING_PAIRS.find((p) => p.pair === bestPair)!;
  const priceInfo = priceMap.get(bestPair);
  if (!priceInfo) {
    throw new Error("Could not get price data");
  }

  const currentPrice = priceInfo.price;
  const change24h = priceInfo.change24h;

  // Fetch historical prices for indicator analysis
  const histPrices = await fetchHistoricalPrices(bestPairConfig.coingeckoId);

  // Analyze
  const analysis = analyzeWithIndicators(
    histPrices.length > 0 ? histPrices : [currentPrice],
    change24h,
    currentPrice
  );

  // Calculate SL/TP
  const volatility = Math.max(1.5, Math.abs(change24h) * 0.3);
  let stopLoss: number;
  let takeProfit: number;

  if (analysis.direction === "LONG") {
    stopLoss = currentPrice * (1 - volatility / 100);
    takeProfit = currentPrice * (1 + volatility * 1.5 / 100);
  } else {
    stopLoss = currentPrice * (1 + volatility / 100);
    takeProfit = currentPrice * (1 - volatility * 1.5 / 100);
  }

  const now = Date.now();
  const signal: TradingSignal = {
    id: `sig-${now}-${Math.random().toString(36).slice(2, 6)}`,
    pair: bestPair,
    direction: analysis.direction,
    entryPrice: Math.round(currentPrice * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
    timestamp: now,
    status: "active",
  };

  // Also create in revenue store for tracking
  createSignal({
    symbol: bestPair.replace("/", ""),
    direction: analysis.direction === "LONG" ? "BUY" : "SELL",
    confidence: analysis.confidence,
    entry: signal.entryPrice,
    sl: signal.stopLoss,
    tp: signal.takeProfit,
    timeframe: "1h",
    strategy: "MULTI_INDICATOR_CONSENSUS",
    reasoning: analysis.reasoning,
  });

  return signal;
}

// ── Daily Signal ───────────────────────────────────────────────────

export async function getDailySignal(): Promise<TradingSignal | null> {
  const now = Date.now();
  if (
    _dailySignalCache &&
    now - _dailySignalCache.timestamp < DAILY_CACHE_TTL
  ) {
    return _dailySignalCache.signal;
  }

  try {
    const signal = await generateSignalImpl();
    _dailySignalCache = { signal, timestamp: now };
    return signal;
  } catch (err) {
    console.warn("[TradingSignals] getDailySignal failed:", err);
    // Return stale cache if available
    if (_dailySignalCache) return _dailySignalCache.signal;
    return null;
  }
}

// ── Signal History ─────────────────────────────────────────────────

export async function getSignalHistory(
  limit: number = 20
): Promise<TradingSignal[]> {
  // Get history from revenue store and convert format
  const revenueHistory = getRevenueSignalHistory(undefined, limit);

  return revenueHistory.map((rs: RevenueTradingSignal) => ({
    id: rs.id,
    pair: rs.symbol.includes("USDT")
      ? `${rs.symbol.replace("USDT", "")}/USDT`
      : rs.symbol,
    direction: rs.direction === "BUY" ? "LONG" : "SHORT",
    entryPrice: rs.entry,
    stopLoss: rs.sl,
    takeProfit: rs.tp,
    confidence: rs.confidence,
    reasoning: rs.reasoning,
    timestamp: rs.timestamp,
    status: mapRevenueStatus(rs.status, rs.outcomePnl),
  }));
}

function mapRevenueStatus(
  status: string,
  _outcomePnl?: number
): "active" | "hit" | "miss" | "expired" {
  switch (status) {
    case "hit_tp":
      return "hit";
    case "hit_sl":
      return "miss";
    case "expired":
      return "expired";
    case "cancelled":
      return "miss";
    default:
      return "active";
  }
}

// ── Signal Stats ───────────────────────────────────────────────────

export function getSignalStats(): SignalStats {
  const metrics = calculateQualityMetrics();
  const total = metrics.hitTP + metrics.hitSL;

  return {
    totalSignals: total,
    hitCount: metrics.hitTP,
    missCount: metrics.hitSL,
    winRate: metrics.winRate,
    avgReturn: metrics.avgProfit - metrics.avgLoss,
  };
}

// ── Premium Access ─────────────────────────────────────────────────

// Server-side premium gate. There is no real server-side Stripe verification
// wired in this environment (no Stripe secret key / webhook), so a session cannot
// be honestly proven to be premium-paid. Returning true for an arbitrary sessionId
// would be a free pass — the exact mock this removes. Honest behavior: locked.
//
// ⚠ LEAD/OWNER DECISION REQUIRED: to perform REAL unlocks, wire a server-side
// Stripe session check (STRIPE_SECRET_KEY + Stripe webhook) and verify the checkout
// session here. Until then this returns false so the paywall is genuinely enforced.
export function hasUnlockedPremium(_sessionId?: string): boolean {
  return false; // honestly locked — real verification not yet wired
}

// Client-side gate. There is no trustworthy client-side verification path: trusting
// a localStorage flag was a local bypass (any value unlocked premium) and is removed.
// Always returns false (locked) until a real server/webhook verification exists.
export function hasUnlockedPremiumClient(_sessionId?: string): boolean {
  return false; // honestly locked — real verification requires server webhook/secret
}

// ── Stripe ─────────────────────────────────────────────────────────

// Real Stripe payment link for the "HSMC Trading Signal — Premium" product (5.00 RON).
// This is an opaque checkout slug — it must NOT be reconstructed as
// `buy.stripe.com/<price_id>` (that 404s) and never given away via
// `prefilled_promo_code=free`.
export const STRIPE_SIGNAL_LINK_DEFAULT =
  "https://buy.stripe.com/14AfZh7Ax71h0Jv39Bfbq01";

// Single canonical Stripe Price ID for the signal product (lowercase `qKp`).
export const STRIPE_SIGNAL_PRICE_ID = "price_1TvhyEDMSAUyHlnSAFC30qKp";

export function getStripeCheckoutUrl(_sessionId?: string): string {
  if (typeof process !== "undefined" && process.env?.STRIPE_SIGNAL_LINK) {
    return process.env.STRIPE_SIGNAL_LINK;
  }
  return STRIPE_SIGNAL_LINK_DEFAULT;
}

// ── Server Function: get daily signal ──────────────────────────────

export const fetchDailySignal = createServerFn({ method: "GET" }).handler(
  async () => {
    const signal = await getDailySignal();
    return signal;
  }
);

export const fetchSignalHistory = createServerFn({ method: "GET" }).handler(
  async () => {
    const history = await getSignalHistory(20);
    const stats = getSignalStats();
    return { history, stats };
  }
);

