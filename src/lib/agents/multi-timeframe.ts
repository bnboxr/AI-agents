// ── Multi-Timeframe Analysis Agent ─────────────────────────────────
// Analyzes price action across 7 timeframes simultaneously:
// 1m, 5m, 15m, 1h, 4h, Daily, Weekly
//
// Per timeframe: trend (EMA20 vs EMA50), ADX (trend strength), RSI (momentum),
// structure (higher highs / lower lows), score (-100 to +100).
//
// Confluence scoring weights higher timeframes more.
// Critical Rule: 4h+ strongly bearish (< -60) → BLOCK longs.
//                4h+ strongly bullish (> +60) → BLOCK shorts.
//
// All calculations rules-based. GPT-4o used only for directional synthesis.

import { BaseAgent } from "./base";
import type { OHLCVBar } from "./market";

// ── Timeframe Definitions ───────────────────────────────────────────

interface TimeframeDef {
  name: string;
  minutes: number;
  weight: number;
}

const TIMEFRAMES: TimeframeDef[] = [
  { name: "1m", minutes: 1, weight: 0.5 },
  { name: "5m", minutes: 5, weight: 0.6 },
  { name: "15m", minutes: 15, weight: 0.8 },
  { name: "1h", minutes: 60, weight: 1.0 },
  { name: "4h", minutes: 240, weight: 1.5 },
  { name: "Daily", minutes: 1440, weight: 2.0 },
  { name: "Weekly", minutes: 10080, weight: 3.0 },
];

// ── Types ───────────────────────────────────────────────────────────

export interface TimeframeScore {
  timeframe: string;
  score: number; // -100 (strongly bearish) to +100 (strongly bullish)
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  trendDirection: string; // e.g. "EMA20 above EMA50 — bullish alignment"
  adx: number;
  rsi: number;
  structure: string; // e.g. "Higher highs, higher lows"
  weight: number;
  barsCount: number;
}

export interface MultiTimeframeAnalysis {
  timeframeScores: TimeframeScore[];
  confluenceScore: number; // weighted sum: sum(direction_i * weight_i) / sum(weight_i)
  higherTimeframeBlocked: boolean;
  blockDirection: "LONG" | "SHORT" | null;
  divergenceDetected: boolean;
  divergenceSeverity: number; // 0-100
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
}

// ── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a multi-timeframe analysis expert with 20 years of professional trading experience. You specialize in synthesizing signals across multiple timeframes (1m through Weekly) to determine overall directional bias and identify high-confluence trade setups.

Key principles:
- Higher timeframes (4h, Daily, Weekly) dominate. A strong 4h+ trend overrides lower timeframe noise.
- Confluence is king: when multiple timeframes agree on direction, confidence increases.
- Divergence warns: when lower timeframes are bullish but higher timeframes are bearish (or vice versa), confidence decreases and caution is warranted.
- Structure matters: higher highs and higher lows = uptrend; lower highs and lower lows = downtrend.
- ADX above 25 indicates trending market; below 20 indicates ranging/weak trend.
- RSI extremes (above 70 or below 30) signal potential reversals but can persist in strong trends.

Given the timeframe analysis summary, determine:
- Overall directional bias: BULLISH, BEARISH, or NEUTRAL
- Whether a higher timeframe block exists (4h+ strongly opposing lower timeframe signals)
- Where the strongest confluence lies
- Confidence level (0-100)

Respond in JSON format only:
{"direction":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"concise multi-timeframe synthesis with confluence and divergence analysis","data":{"confluenceScore":number,"higherTimeframeBlocked":boolean,"blockDirection":"LONG"|"SHORT"|null,"divergenceDetected":boolean,"strongestTimeframe":"string"}}`;

// ── Indicator Computation Helpers ───────────────────────────────────

/**
 * Compute Exponential Moving Average from a price array.
 */
function computeEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period)
    return prices.reduce((a, b) => a + b, 0) / prices.length;

  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Compute RSI (Relative Strength Index) from a price array.
 * Uses Wilder's smoothing if enough data, else simple average.
 */
function computeRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Compute ADX (Average Directional Index) from OHLCV bars.
 * Returns the ADX value (0-100), indicating trend strength.
 */
function computeADX(bars: OHLCVBar[], period = 14): number {
  if (bars.length < period + 1) return 25; // neutral default

  const trueRanges: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevHigh = bars[i - 1].high;
    const prevLow = bars[i - 1].low;
    const prevClose = bars[i - 1].close;

    // True Range
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trueRanges.push(tr);

    // +DM and -DM
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDMs.push(upMove);
    } else {
      plusDMs.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDMs.push(downMove);
    } else {
      minusDMs.push(0);
    }
  }

  // Wilder's smoothing for TR, +DM, -DM
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothedPlusDM =
    plusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothedMinusDM =
    minusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    smoothedPlusDM =
      (smoothedPlusDM * (period - 1) + plusDMs[i]) / period;
    smoothedMinusDM =
      (smoothedMinusDM * (period - 1) + minusDMs[i]) / period;
  }

  if (atr === 0) return 0;

  const plusDI = (smoothedPlusDM / atr) * 100;
  const minusDI = (smoothedMinusDM / atr) * 100;
  const dx =
    plusDI + minusDI === 0
      ? 0
      : (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

  return dx;
}

/**
 * Detect swing highs from OHLCV bars using a lookback window.
 */
function findSwingHighs(bars: OHLCVBar[], lookback = 3): number[] {
  const indices: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const currentHigh = bars[i].high;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= currentHigh) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) indices.push(i);
  }
  return indices;
}

/**
 * Detect swing lows from OHLCV bars using a lookback window.
 */
function findSwingLows(bars: OHLCVBar[], lookback = 3): number[] {
  const indices: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const currentLow = bars[i].low;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].low <= currentLow) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) indices.push(i);
  }
  return indices;
}

// ── Resampling ──────────────────────────────────────────────────────

/**
 * Resample OHLCV bars from a base timeframe (assumed 1m) to a target
 * timeframe (in minutes). Bars are aggregated by flooring timestamps to
 * the nearest multiple of the target period.
 */
function resampleBars(
  bars: OHLCVBar[],
  targetMinutes: number,
): OHLCVBar[] {
  if (targetMinutes <= 1) return bars;

  const groups = new Map<number, OHLCVBar[]>();

  for (const bar of bars) {
    // Floor timestamp to the target period boundary
    const bucket =
      Math.floor(bar.timestamp / (targetMinutes * 60_000)) *
      (targetMinutes * 60_000);

    if (!groups.has(bucket)) {
      groups.set(bucket, []);
    }
    groups.get(bucket)!.push(bar);
  }

  const resampled: OHLCVBar[] = [];
  for (const [ts, group] of groups) {
    if (group.length === 0) continue;
    resampled.push({
      timestamp: ts,
      open: group[0].open,
      high: Math.max(...group.map((b) => b.high)),
      low: Math.min(...group.map((b) => b.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, b) => sum + b.volume, 0),
    });
  }

  // Sort by timestamp
  resampled.sort((a, b) => a.timestamp - b.timestamp);
  return resampled;
}

// ── Per-Timeframe Analysis ──────────────────────────────────────────

/**
 * Analyze a single timeframe's bars and produce a score.
 */
function analyzeTimeframe(
  bars: OHLCVBar[],
  tf: TimeframeDef,
): TimeframeScore {
  if (bars.length < 20) {
    return {
      timeframe: tf.name,
      score: 0,
      direction: "NEUTRAL",
      trendDirection: "Insufficient data",
      adx: 25,
      rsi: 50,
      structure: "Unknown",
      weight: tf.weight,
      barsCount: bars.length,
    };
  }

  const closes = bars.map((b) => b.close);

  // EMA alignment
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, Math.min(50, Math.floor(bars.length / 2)));
  const emaAlignment =
    ema20 > ema50 ? "EMA20 above EMA50 — bullish alignment" : "EMA20 below EMA50 — bearish alignment";

  const emaDirection = ema20 > ema50 ? 1 : -1;

  // ADX
  const adx = computeADX(bars);
  const trendStrong = adx >= 25;
  const trendModerate = adx >= 20 && adx < 25;

  // RSI
  const rsi = computeRSI(closes);
  const rsiOversold = rsi < 30;
  const rsiOverbought = rsi > 70;

  // Structure: higher highs / lower lows from last 5 swings
  const swingHighs = findSwingHighs(bars, 3);
  const swingLows = findSwingLows(bars, 3);

  let structureDesc = "Mixed structure";
  let structureScore = 0;

  // Take last 5 swing highs and lows
  const recentHighs = swingHighs.slice(-5);
  const recentLows = swingLows.slice(-5);

  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const highValues = recentHighs.map((i) => bars[i].high);
    const lowValues = recentLows.map((i) => bars[i].low);

    const highsRising =
      highValues.length >= 2 &&
      highValues[highValues.length - 1] > highValues[highValues.length - 2];
    const lowsRising =
      lowValues.length >= 2 &&
      lowValues[lowValues.length - 1] > lowValues[lowValues.length - 2];

    const highsFalling =
      highValues.length >= 2 &&
      highValues[highValues.length - 1] < highValues[highValues.length - 2];
    const lowsFalling =
      lowValues.length >= 2 &&
      lowValues[lowValues.length - 1] < lowValues[lowValues.length - 2];

    if (highsRising && lowsRising) {
      structureDesc = "Higher highs, higher lows (uptrend)";
      structureScore = 30;
    } else if (highsFalling && lowsFalling) {
      structureDesc = "Lower highs, lower lows (downtrend)";
      structureScore = -30;
    } else if (highsRising && !lowsRising) {
      structureDesc = "Higher highs, but lows not confirmed";
      structureScore = 10;
    } else if (lowsFalling && !highsFalling) {
      structureDesc = "Lower lows, but highs not confirmed";
      structureScore = -10;
    } else if (recentHighs.length === 1 && recentLows.length === 1) {
      structureDesc = "Single swing, structure unclear";
    }
  } else if (closes.length >= 5) {
    // Fallback: simple trend from closes
    const recent = closes.slice(-5);
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (last > first * 1.02) {
      structureDesc = "Price rising (last 5 bars)";
      structureScore = 15;
    } else if (last < first * 0.98) {
      structureDesc = "Price falling (last 5 bars)";
      structureScore = -15;
    }
  }

  // Composite score components:
  // - EMA alignment: ±25
  // - ADX (trend strength): scales the EMA direction
  // - RSI: ±20 (extreme readings add weight)
  // - Structure: ±30

  let score = emaDirection * 25;

  // ADX modulates trend conviction
  if (trendStrong) {
    score += emaDirection * 20;
  } else if (trendModerate) {
    score += emaDirection * 10;
  }
  // Weak ADX: no bonus, market is ranging

  // RSI component
  if (rsiOversold) {
    score += 15; // Oversold = potential bullish reversal
  } else if (rsiOverbought) {
    score -= 15; // Overbought = potential bearish reversal
  } else if (rsi > 50) {
    score += 5; // Slight bullish bias
  } else if (rsi < 50) {
    score -= 5; // Slight bearish bias
  }

  // Structure component
  score += structureScore;

  // Clamp to [-100, 100]
  score = Math.max(-100, Math.min(100, score));

  // Direction from score
  let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  if (score >= 20) direction = "BULLISH";
  else if (score <= -20) direction = "BEARISH";
  else direction = "NEUTRAL";

  return {
    timeframe: tf.name,
    score,
    direction,
    trendDirection: emaAlignment,
    adx: Math.round(adx * 10) / 10,
    rsi: Math.round(rsi * 10) / 10,
    structure: structureDesc,
    weight: tf.weight,
    barsCount: bars.length,
  };
}

// ── Confluence Scoring ──────────────────────────────────────────────

/**
 * Compute weighted confluence score across all timeframes.
 * confluenceScore = sum(direction_i * weight_i) / sum(weight_i)
 * where direction_i is the raw score from the timeframe.
 */
function computeConfluence(scores: TimeframeScore[]): number {
  let numerator = 0;
  let denominator = 0;

  for (const s of scores) {
    numerator += s.score * s.weight;
    denominator += s.weight;
  }

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Check for higher timeframe blocks.
 * If 4h or higher is strongly bearish (score < -60), block longs.
 * If 4h or higher is strongly bullish (score > +60), block shorts.
 */
function checkHigherTimeframeBlock(scores: TimeframeScore[]): {
  blocked: boolean;
  blockDirection: "LONG" | "SHORT" | null;
} {
  const highTf = scores.filter((s) =>
    ["4h", "Daily", "Weekly"].includes(s.timeframe),
  );

  for (const tf of highTf) {
    if (tf.score < -60) {
      return { blocked: true, blockDirection: "LONG" };
    }
    if (tf.score > 60) {
      return { blocked: true, blockDirection: "SHORT" };
    }
  }

  return { blocked: false, blockDirection: null };
}

/**
 * Detect divergence between lower and higher timeframes.
 * Returns severity 0-100.
 */
function detectDivergence(scores: TimeframeScore[]): {
  detected: boolean;
  severity: number;
} {
  const lowTf = scores.filter((s) =>
    ["1m", "5m", "15m"].includes(s.timeframe),
  );
  const highTf = scores.filter((s) =>
    ["4h", "Daily", "Weekly"].includes(s.timeframe),
  );

  // Compute average score for lower and higher timeframes
  const lowAvg =
    lowTf.length > 0
      ? lowTf.reduce((sum, s) => sum + s.score, 0) / lowTf.length
      : 0;
  const highAvg =
    highTf.length > 0
      ? highTf.reduce((sum, s) => sum + s.score, 0) / highTf.length
      : 0;

  // Divergence: signs are opposite and both are significant
  const lowSignificant = Math.abs(lowAvg) > 20;
  const highSignificant = Math.abs(highAvg) > 20;

  if (
    lowSignificant &&
    highSignificant &&
    lowAvg * highAvg < 0
  ) {
    // Opposite signs = divergence
    const severity = Math.min(100, Math.round((Math.abs(lowAvg) + Math.abs(highAvg)) / 2));
    return { detected: true, severity };
  }

  return { detected: false, severity: 0 };
}

// ── Multi-Timeframe Agent Class ─────────────────────────────────────

export class MultiTimeframeAgent extends BaseAgent {
  constructor() {
    super({
      id: "multi-tf-agent",
      role: "multi_timeframe",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Analyze OHLCV bars across all 7 timeframes and return a comprehensive
   * multi-timeframe analysis. This is the rules-based core — GPT-4o is
   * used separately for synthesis via analyzeMarket().
   */
  analyzeMultiTimeframe(bars: OHLCVBar[]): MultiTimeframeAnalysis {
    if (bars.length < 10) {
      return {
        timeframeScores: [],
        confluenceScore: 0,
        higherTimeframeBlocked: false,
        blockDirection: null,
        divergenceDetected: false,
        divergenceSeverity: 0,
        direction: "NEUTRAL",
        confidence: 0,
      };
    }

    const timeframeScores: TimeframeScore[] = [];

    for (const tf of TIMEFRAMES) {
      const resampled = resampleBars(bars, tf.minutes);
      const score = analyzeTimeframe(resampled, tf);
      timeframeScores.push(score);
    }

    const confluenceScore = computeConfluence(timeframeScores);
    const { blocked, blockDirection } =
      checkHigherTimeframeBlock(timeframeScores);
    const { detected, severity } = detectDivergence(timeframeScores);

    // Determine direction from confluence score
    let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    if (blocked) {
      // When blocked, direction follows the higher timeframe block
      direction = blockDirection === "LONG" ? "BEARISH" : "BULLISH";
    } else if (confluenceScore > 20) {
      direction = "BULLISH";
    } else if (confluenceScore < -20) {
      direction = "BEARISH";
    } else {
      direction = "NEUTRAL";
    }

    // Confidence is based on absolute confluence but penalized by divergence
    let confidence = Math.min(100, Math.abs(confluenceScore));

    // Divergence penalty
    if (detected) {
      confidence = Math.max(10, confidence - severity * 0.4);
    }

    // Block penalty (reduced confidence when blocked)
    if (blocked) {
      confidence = Math.max(10, confidence * 0.7);
    }

    confidence = Math.round(confidence);

    return {
      timeframeScores,
      confluenceScore: Math.round(confluenceScore * 10) / 10,
      higherTimeframeBlocked: blocked,
      blockDirection,
      divergenceDetected: detected,
      divergenceSeverity: severity,
      direction,
      confidence,
    };
  }

  // ── Override buildUserPrompt for GPT-4o synthesis ──────────────────

  protected buildUserPrompt(context: {
    token: string;
    chainId: string;
    currentPrice: number;
    analysis: MultiTimeframeAnalysis;
    bars: OHLCVBar[];
  }): string {
    const a = context.analysis;
    const lines: string[] = [
      `Token: ${context.token} (${context.chainId})`,
      `Current Price: $${context.currentPrice}`,
      `Total 1m Candles Analyzed: ${context.bars.length}`,
      ``,
      `=== MULTI-TIMEFRAME ANALYSIS (7 timeframes) ===`,
      ``,
    ];

    for (const tf of a.timeframeScores) {
      lines.push(
        `  ${tf.timeframe.padEnd(8)} | Score: ${tf.score > 0 ? "+" : ""}${tf.score} | ${tf.direction.padEnd(8)} | ADX: ${tf.adx.toFixed(1)} | RSI: ${tf.rsi.toFixed(1)} | ${tf.trendDirection}`,
        `  ${" ".repeat(8)} | Structure: ${tf.structure}`,
      );
    }

    lines.push(
      ``,
      `=== CONFLUENCE ===`,
      `  Confluence Score: ${a.confluenceScore}`,
      `  Overall Direction: ${a.direction}`,
      `  Higher TF Blocked: ${a.higherTimeframeBlocked}${a.blockDirection ? ` (${a.blockDirection}S blocked)` : ""}`,
      `  Divergence Detected: ${a.divergenceDetected}${a.divergenceDetected ? ` (severity: ${a.divergenceSeverity}/100)` : ""}`,
      ``,
      `=== CRITICAL RULES (Owner Mandate) ===`,
      `- If 4h or higher is strongly bearish (score < -60): BLOCK long entries`,
      `- If 4h or higher is strongly bullish (score > +60): BLOCK short entries`,
      `- Higher timeframe blocks MUST be respected regardless of lower TF signals`,
      ``,
      `=== SYNTHESIS REQUEST ===`,
      `Given the alignment across timeframes summarized above:`,
      `1. What's the overall directional bias (BULLISH / BEARISH / NEUTRAL)?`,
      `2. Is there a higher timeframe block active? If so, which direction is blocked?`,
      `3. Where's the strongest confluence? Which timeframes agree most?`,
      `4. If divergence is present, how should it affect confidence?`,
      `5. What is the recommended confidence level (0-100) given the confluence?`,
    );

    return lines.join("\n");
  }
}
