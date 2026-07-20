// ── Strategy Agent ──────────────────────────────────────────────────
// Level 2 Analysis. Runs 5 sub-strategies internally with weighted voting.
// GPT-4o synthesis resolves conflicts and provides final reasoning.
// All sub-strategy scoring is rules-based (synchronous).

import { BaseAgent } from "./base";
import type { OHLCVBar } from "./market";

// ── Sub-strategy vote types ──────────────────────────────────────────

export type StrategyVote = "BUY" | "SELL" | "WAIT";

export interface SubStrategyResult {
  name: string;
  vote: StrategyVote;
  confidence: number; // 0-100
  reasoning: string;
  weight: number; // voting weight
}

export interface StrategyVoteResult {
  votes: SubStrategyResult[];
  winningStrategy: string;
  /// Raw weighted scores before final direction
  buyScore: number;
  sellScore: number;
  waitScore: number;
  /// Conflicts detected between sub-strategies
  conflicts: string[];
}

// ── Helper: compute EMA ──────────────────────────────────────────────

function computeEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) {
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// ── Helper: compute RSI ──────────────────────────────────────────────

function computeRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  const recent = changes.slice(-period);
  let gains = 0;
  let losses = 0;
  for (const c of recent) {
    if (c > 0) gains += c;
    else losses += Math.abs(c);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── Helper: compute ADX ──────────────────────────────────────────────

function computeADX(bars: OHLCVBar[], period: number = 14): number {
  if (bars.length < period + 2) return 0;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevHigh = bars[i - 1].high;
    const prevLow = bars[i - 1].low;
    const prevClose = bars[i - 1].close;

    const trueRange = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    tr.push(trueRange);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    const pdm = upMove > downMove && upMove > 0 ? upMove : 0;
    const ndm = downMove > upMove && downMove > 0 ? downMove : 0;
    plusDM.push(pdm);
    minusDM.push(ndm);
  }

  const smooth = (values: number[]): number[] => {
    if (values.length < period) return values;
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    result.push(sum);
    for (let i = period; i < values.length; i++) {
      result.push(
        result[result.length - 1] - result[result.length - 1] / period + values[i],
      );
    }
    return result;
  };

  const smoothTR = smooth(tr);
  const smoothPDM = smooth(plusDM);
  const smoothNDM = smooth(minusDM);

  if (smoothTR.length < 2) return 0;

  const diPlus: number[] = [];
  const diMinus: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    diPlus.push(smoothTR[i] > 0 ? (smoothPDM[i] / smoothTR[i]) * 100 : 0);
    diMinus.push(smoothTR[i] > 0 ? (smoothNDM[i] / smoothTR[i]) * 100 : 0);
  }

  const dx: number[] = [];
  for (let i = 0; i < diPlus.length; i++) {
    const sum = diPlus[i] + diMinus[i];
    dx.push(sum > 0 ? (Math.abs(diPlus[i] - diMinus[i]) / sum) * 100 : 0);
  }

  if (dx.length < period) return dx.length > 0 ? dx.reduce((a, b) => a + b, 0) / dx.length : 0;
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 1 / period;
  for (let i = period; i < dx.length; i++) {
    adx = adx + k * (dx[i] - adx);
  }
  return adx;
}

// ── Helper: Bollinger Bands ──────────────────────────────────────────

function computeBollingerBands(
  prices: number[],
  period: number = 20,
  stdMultiplier: number = 2,
): { upper: number; middle: number; lower: number } {
  if (prices.length < period) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return { upper: avg, middle: avg, lower: avg };
  }
  const window = prices.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance =
    window.reduce((sum, p) => sum + (p - mean) ** 2, 0) / window.length;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + stdMultiplier * stdDev,
    middle: mean,
    lower: mean - stdMultiplier * stdDev,
  };
}

// ── Helper: compute ATR ──────────────────────────────────────────────

function computeATR(bars: OHLCVBar[], period: number = 14): number {
  if (bars.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trueRanges.push(tr);
  }
  if (trueRanges.length === 0) return 0;
  const window = trueRanges.slice(-Math.min(period, trueRanges.length));
  return window.reduce((a, b) => a + b, 0) / window.length;
}

// ── Sub-Strategy 1: Trend Following ──────────────────────────────────

function scoreTrendFollowing(
  closes: number[],
  bars: OHLCVBar[],
  currentPrice: number,
): SubStrategyResult {
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const adx = computeADX(bars, 14);

  // EMA alignment scoring
  const bullishAlignment = ema9 > ema21 && ema21 > ema50;
  const bearishAlignment = ema9 < ema21 && ema21 < ema50;

  // Price relative to EMAs
  const aboveEma9 = currentPrice > ema9;
  const aboveEma21 = currentPrice > ema21;
  const aboveEma50 = currentPrice > ema50;

  let confidence = 0;
  let vote: StrategyVote = "WAIT";

  if (bullishAlignment && adx > 25) {
    vote = "BUY";
    confidence = 50;
    // Stronger trend = higher confidence
    if (adx > 35) confidence += 15;
    if (adx > 50) confidence += 15;
    if (aboveEma9 && aboveEma21) confidence += 10;
    if (aboveEma50) confidence += 10;
    confidence = Math.min(100, confidence);
  } else if (bearishAlignment && adx > 25) {
    vote = "SELL";
    confidence = 50;
    if (adx > 35) confidence += 15;
    if (adx > 50) confidence += 15;
    if (!aboveEma9 && !aboveEma21) confidence += 10;
    if (!aboveEma50) confidence += 10;
    confidence = Math.min(100, confidence);
  } else if (adx < 20) {
    // No clear trend — weak signal
    const bias =
      currentPrice > ema21
        ? "BUY"
        : currentPrice < ema21
          ? "SELL"
          : "WAIT";
    if (bias === "WAIT") {
      vote = "WAIT";
      confidence = 60;
    } else {
      vote = bias;
      confidence = 30;
    }
  } else {
    // Mixed signals — mild directional bias
    const emaScore =
      (aboveEma9 ? 1 : -1) + (aboveEma21 ? 1 : -1) + (aboveEma50 ? 1 : -1);
    if (emaScore >= 2) {
      vote = "BUY";
      confidence = 45;
    } else if (emaScore <= -2) {
      vote = "SELL";
      confidence = 45;
    } else {
      vote = "WAIT";
      confidence = 50;
    }
  }

  const adxLabel = adx > 50 ? "strong trend" : adx > 25 ? "moderate trend" : "weak trend";
  return {
    name: "Trend Following",
    vote,
    confidence: Math.round(confidence),
    reasoning: `EMA9=${ema9.toFixed(2)} EMA21=${ema21.toFixed(2)} EMA50=${ema50.toFixed(2)} | ADX=${adx.toFixed(1)} (${adxLabel}) | ${bullishAlignment ? "bullish alignment" : bearishAlignment ? "bearish alignment" : "mixed"}`,
    weight: 0.30,
  };
}

// ── Sub-Strategy 2: Mean Reversion ───────────────────────────────────

function scoreMeanReversion(
  closes: number[],
  currentPrice: number,
): SubStrategyResult {
  const rsi = computeRSI(closes, 14);
  const bb = computeBollingerBands(closes, 20, 2);
  const bbPct =
    bb.upper > bb.lower
      ? ((currentPrice - bb.lower) / (bb.upper - bb.lower)) * 100
      : 50;

  // BB touch detection: price near band
  const nearLowerBand = bbPct < 10; // oversold — mean revert UP
  const nearUpperBand = bbPct > 90; // overbought — mean revert DOWN
  const inLowerHalf = bbPct < 50;
  const inUpperHalf = bbPct > 50;

  let vote: StrategyVote = "WAIT";
  let confidence = 0;

  // Strong mean reversion signals
  if (rsi < 30 || nearLowerBand) {
    vote = "BUY";
    confidence = 55;
    if (rsi < 25) confidence += 20;
    if (nearLowerBand) confidence += 15;
    if (rsi < 30 && nearLowerBand) confidence += 10;
    confidence = Math.min(100, confidence);
  } else if (rsi > 70 || nearUpperBand) {
    vote = "SELL";
    confidence = 55;
    if (rsi > 75) confidence += 20;
    if (nearUpperBand) confidence += 15;
    if (rsi > 70 && nearUpperBand) confidence += 10;
    confidence = Math.min(100, confidence);
  } else if (rsi < 40 && inLowerHalf) {
    vote = "BUY";
    confidence = 35;
  } else if (rsi > 60 && inUpperHalf) {
    vote = "SELL";
    confidence = 35;
  } else {
    vote = "WAIT";
    confidence = 45;
  }

  const rsiLabel =
    rsi > 70 ? "overbought" : rsi < 30 ? "oversold" : "neutral";
  return {
    name: "Mean Reversion",
    vote,
    confidence: Math.round(confidence),
    reasoning: `RSI=${rsi.toFixed(1)} (${rsiLabel}) | BB position=${bbPct.toFixed(0)}% (bands: ${bb.lower.toFixed(2)}-${bb.upper.toFixed(2)}) | ${nearLowerBand ? "near lower band" : nearUpperBand ? "near upper band" : "mid-range"}`,
    weight: 0.15,
  };
}

// ── Sub-Strategy 3: Breakout ─────────────────────────────────────────

function scoreBreakout(
  bars: OHLCVBar[],
  currentPrice: number,
): SubStrategyResult {
  if (bars.length < 30) {
    return {
      name: "Breakout",
      vote: "WAIT",
      confidence: 0,
      reasoning: "Insufficient data (need 30+ candles).",
      weight: 0.20,
    };
  }

  // Recent range: high/low of last 20 bars (excluding most recent 5)
  const lookback = Math.min(20, bars.length - 5);
  const rangeBars = bars.slice(-lookback - 5, -5);
  const rangeHigh = Math.max(...rangeBars.map((b) => b.high));
  const rangeLow = Math.min(...rangeBars.map((b) => b.low));
  const rangeSize =
    rangeLow > 0 ? ((rangeHigh - rangeLow) / rangeLow) * 100 : 0;

  // Volume surge check
  const recentVol = bars.slice(-5).reduce((sum, b) => sum + b.volume, 0) / 5;
  const avgVol =
    bars.slice(-25, -5).reduce((sum, b) => sum + b.volume, 0) / 20;
  const volSurge = avgVol > 0 ? recentVol / avgVol : 1;

  // Breakout detection
  const breakoutUp = currentPrice > rangeHigh;
  const breakoutDown = currentPrice < rangeLow;
  const nearTop = currentPrice > rangeHigh * 0.98;
  const nearBottom = currentPrice < rangeLow * 1.02;

  let vote: StrategyVote = "WAIT";
  let confidence = 0;

  if (breakoutUp && volSurge > 1.3) {
    vote = "BUY";
    confidence = 60;
    if (volSurge > 2.0) confidence += 20;
    if (rangeSize < 5) confidence += 10; // tight range breakout stronger
    confidence = Math.min(100, confidence);
  } else if (breakoutDown && volSurge > 1.3) {
    vote = "SELL";
    confidence = 60;
    if (volSurge > 2.0) confidence += 20;
    if (rangeSize < 5) confidence += 10;
    confidence = Math.min(100, confidence);
  } else if (nearTop && volSurge > 1.0) {
    vote = "BUY";
    confidence = 40;
  } else if (nearBottom && volSurge > 1.0) {
    vote = "SELL";
    confidence = 40;
  } else {
    vote = "WAIT";
    confidence = 30;
  }

  const volLabel = volSurge > 2 ? "massive surge" : volSurge > 1.3 ? "elevated" : "normal";
  return {
    name: "Breakout",
    vote,
    confidence: Math.round(confidence),
    reasoning: `Range: ${rangeLow.toFixed(2)}-${rangeHigh.toFixed(2)} (${rangeSize.toFixed(1)}%) | Price: ${currentPrice.toFixed(2)} | Vol surge: ${volSurge.toFixed(1)}x (${volLabel}) | ${breakoutUp ? "BREAKOUT UP" : breakoutDown ? "BREAKOUT DOWN" : "inside range"}`,
    weight: 0.20,
  };
}

// ── Sub-Strategy 4: Scalping ─────────────────────────────────────────

function scoreScalping(
  bars: OHLCVBar[],
  currentPrice: number,
): SubStrategyResult {
  // Short-term momentum: use last 3-5 candles for micro-trend
  if (bars.length < 10) {
    return {
      name: "Scalping",
      vote: "WAIT",
      confidence: 0,
      reasoning: "Insufficient data (need 10+ candles).",
      weight: 0.10,
    };
  }

  const recent5 = bars.slice(-5);
  const recent3 = bars.slice(-3);

  // Momentum: compare close 3 bars ago vs now
  const momentum5 =
    recent5.length >= 5
      ? ((recent5[4].close - recent5[0].close) / recent5[0].close) * 100
      : 0;
  const momentum3 =
    recent3.length >= 3
      ? ((recent3[2].close - recent3[0].close) / recent3[0].close) * 100
      : 0;

  // Consecutive direction
  const upBars3 = recent3.filter((b) => b.close > b.open).length;
  const upBars5 = recent5.filter((b) => b.close > b.open).length;

  // Volume increase on recent bars
  const avgVolRecent3 =
    recent3.reduce((s, b) => s + b.volume, 0) / 3;
  const avgVolPrev5 =
    bars.slice(-8, -3).reduce((s, b) => s + b.volume, 0) / 5;
  const volRatio = avgVolPrev5 > 0 ? avgVolRecent3 / avgVolPrev5 : 1;

  let vote: StrategyVote = "WAIT";
  let confidence = 0;

  const strongBullish = momentum3 > 0.5 && upBars3 >= 3 && volRatio > 0.8;
  const strongBearish = momentum3 < -0.5 && upBars3 === 0 && volRatio > 0.8;
  const mildBullish = momentum3 > 0 && momentum5 > 0;
  const mildBearish = momentum3 < 0 && momentum5 < 0;

  if (strongBullish) {
    vote = "BUY";
    confidence = 65;
    if (momentum5 > 1.5) confidence += 15;
    confidence = Math.min(100, confidence);
  } else if (strongBearish) {
    vote = "SELL";
    confidence = 65;
    if (momentum5 < -1.5) confidence += 15;
    confidence = Math.min(100, confidence);
  } else if (mildBullish) {
    vote = "BUY";
    confidence = 45;
  } else if (mildBearish) {
    vote = "SELL";
    confidence = 45;
  } else {
    vote = "WAIT";
    confidence = 50;
  }

  return {
    name: "Scalping",
    vote,
    confidence: Math.round(confidence),
    reasoning: `Momentum3=${momentum3.toFixed(2)}% Momentum5=${momentum5.toFixed(2)}% | Up bars: ${upBars3}/3 (last3), ${upBars5}/5 (last5) | Vol ratio: ${volRatio.toFixed(1)}x`,
    weight: 0.10,
  };
}

// ── Sub-Strategy 5: Swing ────────────────────────────────────────────

function scoreSwing(
  closes: number[],
  bars: OHLCVBar[],
  currentPrice: number,
): SubStrategyResult {
  // Multi-timeframe alignment: simulate 1h and 4h by using different EMA windows
  // Longer EMAs approximate higher timeframes

  const ema20 = computeEMA(closes, 20); // ~1h equivalent
  const ema50 = computeEMA(closes, 50); // ~4h equivalent
  const ema100 = computeEMA(closes, 100);
  const ema200 = computeEMA(closes, 200);

  const shortTrend = currentPrice > ema20;
  const mediumTrend = currentPrice > ema50;
  const longTrend = currentPrice > ema100;
  const macroTrend = currentPrice > ema200;

  const allBullish = shortTrend && mediumTrend && longTrend && macroTrend;
  const allBearish = !shortTrend && !mediumTrend && !longTrend && !macroTrend;

  // ADX for trend strength context
  const adx = computeADX(bars, 14);

  // MACD-like: diff between fast/slow EMAs
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdLine = ema12 - ema26;
  const macdSignal = computeEMA(
    (() => {
      // simulate MACD line history with limited data
      return [macdLine];
    })(),
    1,
  ); // simplified — just use current

  let vote: StrategyVote = "WAIT";
  let confidence = 0;

  if (allBullish && adx > 25) {
    vote = "BUY";
    confidence = 70;
    if (adx > 35) confidence += 15;
    if (macdLine > 0) confidence += 10;
    confidence = Math.min(100, confidence);
  } else if (allBearish && adx > 25) {
    vote = "SELL";
    confidence = 70;
    if (adx > 35) confidence += 15;
    if (macdLine < 0) confidence += 10;
    confidence = Math.min(100, confidence);
  } else if (shortTrend && mediumTrend) {
    vote = "BUY";
    confidence = 55;
    if (longTrend) confidence += 15;
  } else if (!shortTrend && !mediumTrend) {
    vote = "SELL";
    confidence = 55;
    if (!longTrend) confidence += 15;
  } else {
    vote = "WAIT";
    confidence = 40;
  }

  const tfLabel = allBullish
    ? "all bullish"
    : allBearish
      ? "all bearish"
      : shortTrend !== mediumTrend
        ? "mixed"
        : shortTrend
          ? "mostly bullish"
          : "mostly bearish";

  return {
    name: "Swing",
    vote,
    confidence: Math.round(confidence),
    reasoning: `Multi-TF: ${tfLabel} | EMA20 ${shortTrend ? ">" : "<"} EMA50 ${mediumTrend ? ">" : "<"} EMA200 ${macroTrend ? ">" : "<"} | ADX=${adx.toFixed(1)} | MACD=${macdLine > 0 ? "+" : ""}${macdLine.toFixed(4)}`,
    weight: 0.25,
  };
}

// ── Weighted Voting ──────────────────────────────────────────────────

function runWeightedVote(
  subResults: SubStrategyResult[],
): {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  voteResult: StrategyVoteResult;
} {
  let buyScore = 0;
  let sellScore = 0;
  let waitScore = 0;
  let totalWeight = 0;

  for (const r of subResults) {
    const weightedConf = r.confidence * r.weight;
    if (r.vote === "BUY") buyScore += weightedConf;
    else if (r.vote === "SELL") sellScore += weightedConf;
    else waitScore += weightedConf;
    totalWeight += r.weight;
  }

  // Normalize to 0-100 scale
  if (totalWeight > 0) {
    buyScore = (buyScore / totalWeight);
    sellScore = (sellScore / totalWeight);
    waitScore = (waitScore / totalWeight);
  }

  // Detect conflicts: BUY vs SELL with both above 40 confidence
  const conflicts: string[] = [];
  const buyers = subResults.filter((r) => r.vote === "BUY" && r.confidence >= 40);
  const sellers = subResults.filter((r) => r.vote === "SELL" && r.confidence >= 40);
  if (buyers.length > 0 && sellers.length > 0) {
    conflicts.push(
      `BUY agents (${buyers.map((b) => b.name).join(", ")}) vs SELL agents (${sellers.map((s) => s.name).join(", ")})`,
    );
  }
  // Detect split between trend and mean reversion
  const trendVote = subResults.find((r) => r.name === "Trend Following");
  const mrVote = subResults.find((r) => r.name === "Mean Reversion");
  if (
    trendVote &&
    mrVote &&
    trendVote.vote !== mrVote.vote &&
    trendVote.vote !== "WAIT" &&
    mrVote.vote !== "WAIT"
  ) {
    conflicts.push(
      `Trend Following (${trendVote.vote}) conflicts with Mean Reversion (${mrVote.vote})`,
    );
  }

  // Find winning strategy (highest confidence among non-WAIT)
  const decisiveVotes = subResults.filter((r) => r.vote !== "WAIT");
  decisiveVotes.sort((a, b) => b.confidence - a.confidence);
  const winningStrategy =
    decisiveVotes.length > 0 ? decisiveVotes[0].name : "None (all WAIT)";

  // Determine direction
  const maxScore = Math.max(buyScore, sellScore, waitScore);
  let direction: "LONG" | "SHORT" | "NEUTRAL";
  let confidence: number;

  if (maxScore === waitScore || maxScore < 30) {
    direction = "NEUTRAL";
    confidence = maxScore < 30 ? Math.round(maxScore) : Math.round(waitScore);
  } else if (buyScore >= sellScore) {
    direction = "LONG";
    confidence = Math.round(buyScore);
  } else {
    direction = "SHORT";
    confidence = Math.round(sellScore);
  }

  return {
    direction,
    confidence: Math.min(100, Math.max(0, confidence)),
    voteResult: {
      votes: subResults,
      winningStrategy,
      buyScore: Math.round(buyScore * 100) / 100,
      sellScore: Math.round(sellScore * 100) / 100,
      waitScore: Math.round(waitScore * 100) / 100,
      conflicts,
    },
  };
}

// ── GPT-4o System Prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior multi-strategy portfolio manager at a quantitative hedge fund. You receive votes from 5 algorithmic sub-strategies and must synthesize them into a final trading decision.

The 5 strategies are:
1. Trend Following (30% weight) — EMA alignment + ADX
2. Swing (25% weight) — Multi-timeframe alignment (1h/4h)
3. Breakout (20% weight) — Price breaking range + volume surge
4. Mean Reversion (15% weight) — RSI extremes + Bollinger Band touches
5. Scalping (10% weight) — Short-term momentum (1m/5m)

Your job:
1. Evaluate the weighted vote result and individual strategy reasoning
2. Identify any strategy conflicts and explain how to resolve them
3. Weight trend-following strategies higher in trending markets, mean-reversion higher in ranging markets
4. Provide a final direction and confidence based on the weighted evidence
5. If there are serious conflicts, explain your tie-breaking logic

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"concise synthesis with conflict resolution if needed","data":{"resolvedConflicts":["explanation of each resolved conflict"]}}`;

// ── Strategy Agent Context ───────────────────────────────────────────

export interface StrategyAgentContext {
  token: string;
  chainId: string;
  currentPrice: number;
  bars: OHLCVBar[];
  /** Optional: pre-identified regime to influence strategy weighting */
  regime?: string;
}

// ── StrategyAgent Class ──────────────────────────────────────────────

export class StrategyAgent extends BaseAgent {
  constructor() {
    super({
      id: "strategy-agent",
      role: "strategy",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Run all 5 sub-strategies and compute the weighted vote.
   * This is rules-based, synchronous — no API call.
   */
  runSubStrategies(
    bars: OHLCVBar[],
    currentPrice: number,
    regime?: string,
  ): StrategyVoteResult {
    const closes = bars.map((b) => b.close);

    const results: SubStrategyResult[] = [
      scoreTrendFollowing(closes, bars, currentPrice),
      scoreSwing(closes, bars, currentPrice),
      scoreBreakout(bars, currentPrice),
      scoreMeanReversion(closes, currentPrice),
      scoreScalping(bars, currentPrice),
    ];

    // Apply regime-based weight adjustments
    if (regime) {
      const r = regime.toLowerCase();
      if (r.includes("trending") || r.includes("bull") || r.includes("bear")) {
        // Boost trend following & swing in trending regimes
        const tf = results.find((s) => s.name === "Trend Following");
        if (tf) tf.weight = 0.35;
        const sw = results.find((s) => s.name === "Swing");
        if (sw) sw.weight = 0.30;
        const bo = results.find((s) => s.name === "Breakout");
        if (bo) bo.weight = 0.15;
        const mr = results.find((s) => s.name === "Mean Reversion");
        if (mr) mr.weight = 0.10;
        const sc = results.find((s) => s.name === "Scalping");
        if (sc) sc.weight = 0.10;
      } else if (r.includes("ranging") || r.includes("consolidation")) {
        // Boost mean reversion & scalping in ranging regimes
        const tf = results.find((s) => s.name === "Trend Following");
        if (tf) tf.weight = 0.15;
        const sw = results.find((s) => s.name === "Swing");
        if (sw) sw.weight = 0.15;
        const bo = results.find((s) => s.name === "Breakout");
        if (bo) bo.weight = 0.20;
        const mr = results.find((s) => s.name === "Mean Reversion");
        if (mr) mr.weight = 0.30;
        const sc = results.find((s) => s.name === "Scalping");
        if (sc) sc.weight = 0.20;
      }
    }

    const { voteResult } = runWeightedVote(results);
    return voteResult;
  }

  /**
   * Build user prompt for GPT-4o synthesis.
   */
  protected buildUserPrompt(context: StrategyAgentContext): string {
    const { currentPrice, bars, token, chainId, regime } = context;
    const voteResult = this.runSubStrategies(bars, currentPrice, regime);
    const { direction, confidence } = runWeightedVote(voteResult.votes);

    const lines: string[] = [
      `Token: ${token} (${chainId}) @ $${currentPrice}`,
      regime ? `Market Regime: ${regime}` : "",
      ``,
      `Weighted Vote Result:`,
      `  Direction: ${direction}`,
      `  Confidence: ${confidence}%`,
      `  Buy Score: ${voteResult.buyScore}`,
      `  Sell Score: ${voteResult.sellScore}`,
      `  Wait Score: ${voteResult.waitScore}`,
      `  Winning Strategy: ${voteResult.winningStrategy}`,
      ``,
      `Individual Strategy Votes:`,
      ...voteResult.votes.map(
        (v) =>
          `  [${v.name}] (weight: ${(v.weight * 100).toFixed(0)}%) → ${v.vote} (${v.confidence}%): ${v.reasoning}`,
      ),
      ``,
    ];

    if (voteResult.conflicts.length > 0) {
      lines.push("⚠️ CONFLICTS DETECTED:");
      lines.push(...voteResult.conflicts.map((c) => `  - ${c}`));
      lines.push("");
    }

    lines.push(
      `Given these strategy votes${voteResult.conflicts.length > 0 ? " and the detected conflicts" : ""}, what's the best course? Resolve any conflicts with your reasoning.`,
    );

    return lines.filter(Boolean).join("\n");
  }

  /**
   * Compute rules-based strategy vote (synchronous, no API call).
   * Returns weighted vote result with direction and confidence.
   */
  private computeVote(context: StrategyAgentContext): {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    confidence: number;
    voteResult: StrategyVoteResult;
  } {
    const voteResult = this.runSubStrategies(
      context.bars,
      context.currentPrice,
      context.regime,
    );
    const weightedVote = runWeightedVote(voteResult.votes);
    return {
      direction: weightedVote.direction,
      confidence: weightedVote.confidence,
      voteResult,
    };
  }

  /**
   * Run strategy analysis and return an AgentReport.
   * Uses rules-based sub-strategy voting + GPT-4o synthesis.
   * Falls back to pure rules-based vote if LLM is unavailable.
   */
  async analyzeMarket(context: StrategyAgentContext): Promise<{
    agentId: string;
    role: "strategy";
    timestamp: number;
    direction: "LONG" | "SHORT" | "NEUTRAL";
    confidence: number;
    reasoning: string;
    data: Record<string, any>;
  }> {
    // Run sub-strategies first (always synchronous)
    const { direction: rulesDirection, confidence: rulesConfidence, voteResult } =
      this.computeVote(context);

    // Try GPT-4o synthesis via BaseAgent
    let llmDirection: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
    let llmConfidence = 0;
    let llmReasoning = "";

    try {
      const report = await super.analyzeMarket(context);
      llmDirection = report.direction;
      llmConfidence = report.confidence;
      llmReasoning = report.reasoning;
    } catch {
      // GPT-4o unavailable — use rules-based fallback
    }

    // If LLM gave us a valid direction, use it; otherwise use rules-based
    const useLLM = llmConfidence > 0 && llmDirection !== "NEUTRAL";
    const finalDirection = useLLM ? llmDirection : rulesDirection;
    const finalConfidence = useLLM ? llmConfidence : rulesConfidence;
    const finalReasoning = useLLM
      ? llmReasoning
      : `[Rules-based] ${rulesConfidence}% ${rulesDirection} — winning strategy: ${voteResult.winningStrategy}. ${
          voteResult.conflicts.length > 0
            ? `Conflicts: ${voteResult.conflicts.join("; ")}`
            : "No conflicts."
        }`;

    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction: finalDirection,
      confidence: finalConfidence,
      reasoning: finalReasoning,
      data: {
        votes: voteResult,
        winningStrategy: voteResult.winningStrategy,
      } as Record<string, any>,
    };
  }
}
