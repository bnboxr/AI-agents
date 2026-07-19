// ── Volume Agent ────────────────────────────────────────────────────
// Level 1 Intelligence Agent: Rules-based volume analysis + GPT-4o synthesis.
// Analyzes OHLCV data for OBV, Volume Delta, Volume Climax,
// Accumulation/Distribution patterns, and anchored VWAP.
//
// Scoring: -100 (bearish) to +100 (bullish) based on signal confluence.

import { BaseAgent } from "./base";
import type { AgentReport, AgentRole } from "./types";
import type { OHLCVBar } from "./market";

// ── Volume Analysis Types ───────────────────────────────────────────

export interface VolumeAnalysis {
  /** On-Balance Volume (cumulative) */
  obv: number;
  /** OBV trend: rising, falling, or flat */
  obvTrend: "RISING" | "FALLING" | "FLAT";
  /** Current volume vs 20-period average */
  volumeDelta: number;
  /** Delta classification */
  deltaClass: "HIGH" | "NORMAL" | "LOW";
  /** Volume climax detected */
  climax: boolean;
  /** Accumulation/Distribution classification */
  adPattern: "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL";
  /** Anchored VWAP from session start */
  vwap: number;
  /** Price relative to VWAP */
  vwapPosition: "ABOVE" | "BELOW" | "AT";
  /** Composite score: -100 to +100 */
  compositeScore: number;
  /** Individual signal scores */
  scores: {
    obvScore: number;
    deltaScore: number;
    climaxScore: number;
    adScore: number;
    vwapScore: number;
  };
}

export interface VolumeContext {
  token: string;
  chainId: string;
  currentPrice: number;
  ohlcv: OHLCVBar[];
  analysis: VolumeAnalysis;
}

// ── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional volume analyst specializing in crypto markets. Your job is to interpret volume patterns to detect accumulation, distribution, and potential reversals.

You receive pre-computed volume metrics:
- OBV (On-Balance Volume): cumulative volume × price direction. Rising OBV = smart money accumulating. Falling OBV = distribution.
- Volume Delta: current volume relative to 20-period average. >2x = HIGH (potential climax), <0.5x = LOW (low interest).
- Volume Climax: volume >3x average + large candle → potential exhaustion/reversal.
- Accumulation/Distribution: price up on rising volume = accumulation (bullish). Price up on falling volume = distribution (bearish).
- VWAP: volume-weighted average price from session start. Price above VWAP on volume = bullish (institutional buying).

Synthesize all signals into a directional view. Consider signal confluence — multiple signals aligning = higher confidence.

Respond with JSON only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"2-3 sentence synthesis of volume signals","data":{"obvTrend":"<trend>","deltaClass":"LOW"|"NORMAL"|"HIGH","climax":true|false,"adPattern":"<pattern>","vwapPosition":"ABOVE"|"BELOW"|"AT","compositeScore":<-100 to 100>}}`;

// ── Volume Analysis Engine ─────────────────────────────────────────

/**
 * Compute On-Balance Volume from OHLCV bars.
 * OBV = cumulative sum of (close > prev_close ? +volume : close < prev_close ? -volume : 0)
 */
export function computeOBV(bars: OHLCVBar[]): { obv: number; obvTrend: "RISING" | "FALLING" | "FLAT" } {
  if (bars.length < 2) return { obv: 0, obvTrend: "FLAT" };

  let obv = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    if (curr.close > prev.close) {
      obv += curr.volume;
    } else if (curr.close < prev.close) {
      obv -= curr.volume;
    }
  }

  // Determine trend by comparing last N/3 bars OBV contribution vs first N/3
  const third = Math.floor(bars.length / 3);
  if (third < 2) return { obv, obvTrend: "FLAT" };

  let earlyObv = 0;
  let lateObv = 0;
  for (let i = 1; i <= third; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    earlyObv += curr.close > prev.close ? curr.volume : curr.close < prev.close ? -curr.volume : 0;
  }
  for (let i = bars.length - third; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    lateObv += curr.close > prev.close ? curr.volume : curr.close < prev.close ? -curr.volume : 0;
  }

  const change = lateObv - earlyObv;
  const obvTrend =
    change > Math.abs(earlyObv) * 0.1 ? "RISING" : change < -Math.abs(earlyObv) * 0.1 ? "FALLING" : "FLAT";

  return { obv, obvTrend };
}

/**
 * Compute volume delta: current volume vs 20-period average.
 */
export function computeVolumeDelta(bars: OHLCVBar[]): { delta: number; deltaClass: "HIGH" | "NORMAL" | "LOW" } {
  if (bars.length < 2) return { delta: 1, deltaClass: "NORMAL" };

  const current = bars[bars.length - 1].volume;
  const lookback = Math.min(20, bars.length - 1);
  const startIdx = bars.length - 1 - lookback;
  let sum = 0;
  for (let i = startIdx; i < bars.length - 1; i++) {
    sum += bars[i].volume;
  }
  const avg = sum / lookback;
  if (avg === 0) return { delta: 1, deltaClass: "NORMAL" };

  const delta = current / avg;
  let deltaClass: "HIGH" | "NORMAL" | "LOW";
  if (delta > 2.0) deltaClass = "HIGH";
  else if (delta < 0.5) deltaClass = "LOW";
  else deltaClass = "NORMAL";

  return { delta, deltaClass };
}

/**
 * Detect Volume Climax: volume > 3x average AND the current candle body
 * (|close - open|) is > 1.5x the average candle body.
 */
export function detectVolumeClimax(bars: OHLCVBar[]): boolean {
  if (bars.length < 20) return false;

  const current = bars[bars.length - 1];
  const lookback = Math.min(20, bars.length - 1);
  const startIdx = bars.length - 1 - lookback;
  let volSum = 0;
  let bodySum = 0;
  for (let i = startIdx; i < bars.length - 1; i++) {
    volSum += bars[i].volume;
    bodySum += Math.abs(bars[i].close - bars[i].open);
  }
  const avgVol = volSum / lookback;
  const avgBody = bodySum / lookback;
  if (avgVol === 0) return false;

  const currentBody = Math.abs(current.close - current.open);
  return current.volume > 3 * avgVol && currentBody > 1.5 * avgBody;
}

/**
 * Detect Accumulation/Distribution pattern.
 * - Accumulation (bullish): price up + rising volume
 * - Distribution (bearish): price up + falling volume OR price down + rising volume
 * - Also check: price down on falling volume = neutral (no conviction selling)
 */
export function detectAccumDist(bars: OHLCVBar[]): "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL" {
  if (bars.length < 10) return "NEUTRAL";

  // Compare last 5 bars vs prior 5 bars
  const half = Math.floor(bars.length / 2);
  if (half < 5) return "NEUTRAL";

  const recent = bars.slice(-half);
  const prior = bars.slice(0, half);

  const recentAvgPrice = recent.reduce((s, b) => s + b.close, 0) / recent.length;
  const priorAvgPrice = prior.reduce((s, b) => s + b.close, 0) / prior.length;
  const recentAvgVol = recent.reduce((s, b) => s + b.volume, 0) / recent.length;
  const priorAvgVol = prior.reduce((s, b) => s + b.volume, 0) / prior.length;

  const priceChange = recentAvgPrice - priorAvgPrice;
  const volChange = priorAvgVol > 0 ? (recentAvgVol - priorAvgVol) / priorAvgVol : 0;

  if (priceChange > 0 && volChange > 0.05) return "ACCUMULATION";
  if (priceChange > 0 && volChange < -0.05) return "DISTRIBUTION";
  if (priceChange < 0 && volChange > 0.05) return "DISTRIBUTION"; // selling pressure on volume
  return "NEUTRAL";
}

/**
 * Compute anchored VWAP from the session start (first bar).
 * VWAP = Σ(price_i × volume_i) / Σ(volume_i)
 * Using typical price: (high + low + close) / 3
 */
export function computeAnchoredVWAP(bars: OHLCVBar[], currentPrice: number): { vwap: number; vwapPosition: "ABOVE" | "BELOW" | "AT" } {
  if (bars.length < 2) return { vwap: 0, vwapPosition: "AT" };

  let cumPriceVolume = 0;
  let cumVolume = 0;
  for (const bar of bars) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumPriceVolume += typicalPrice * bar.volume;
    cumVolume += bar.volume;
  }

  const vwap = cumVolume > 0 ? cumPriceVolume / cumVolume : currentPrice;
  const threshold = currentPrice * 0.005; // 0.5% band

  let vwapPosition: "ABOVE" | "BELOW" | "AT";
  if (currentPrice > vwap + threshold) vwapPosition = "ABOVE";
  else if (currentPrice < vwap - threshold) vwapPosition = "BELOW";
  else vwapPosition = "AT";

  return { vwap, vwapPosition };
}

/**
 * Compute the composite volume score from -100 (strongly bearish) to +100 (strongly bullish).
 */
export function computeVolumeScore(analysis: VolumeAnalysis): number {
  const { scores } = analysis;
  // Weighted confluence
  const weights = {
    obvScore: 0.25,
    deltaScore: 0.10,
    climaxScore: 0.15,
    adScore: 0.30,
    vwapScore: 0.20,
  };

  const weighted =
    scores.obvScore * weights.obvScore +
    scores.deltaScore * weights.deltaScore +
    scores.climaxScore * weights.climaxScore +
    scores.adScore * weights.adScore +
    scores.vwapScore * weights.vwapScore;

  return Math.round(Math.min(100, Math.max(-100, weighted)));
}

/**
 * Full volume analysis on OHLCV data.
 */
export function analyzeVolume(bars: OHLCVBar[], currentPrice: number): VolumeAnalysis {
  const obvResult = computeOBV(bars);
  const deltaResult = computeVolumeDelta(bars);
  const climax = detectVolumeClimax(bars);
  const adPattern = detectAccumDist(bars);
  const vwapResult = computeAnchoredVWAP(bars, currentPrice);

  // ── Individual Signal Scores ──────────────────────────────────────

  // OBV score: rising = bullish, falling = bearish
  let obvScore = 0;
  if (obvResult.obvTrend === "RISING") obvScore = 60;
  else if (obvResult.obvTrend === "FALLING") obvScore = -60;

  // Delta score: HIGH volume confirms existing move, LOW = indecision
  let deltaScore = 0;
  const lastBar = bars[bars.length - 1];
  const prevBar = bars.length >= 2 ? bars[bars.length - 2] : null;
  const priceDirection = prevBar ? (lastBar.close > prevBar.close ? "UP" : "DOWN") : "FLAT";
  if (deltaResult.deltaClass === "HIGH" && priceDirection === "UP") deltaScore = 50;
  else if (deltaResult.deltaClass === "HIGH" && priceDirection === "DOWN") deltaScore = -50;
  else if (deltaResult.deltaClass === "LOW") deltaScore = -15; // low volume = weak conviction

  // Climax score: heavy volume + large candle → potential exhaustion
  let climaxScore = 0;
  if (climax) {
    // Climax can be bullish or bearish depending on direction
    if (priceDirection === "UP") climaxScore = -40; // buying climax → potential top
    else climaxScore = 40; // selling climax → potential bottom
  }

  // A/D score
  let adScore = 0;
  if (adPattern === "ACCUMULATION") adScore = 70;
  else if (adPattern === "DISTRIBUTION") adScore = -70;

  // VWAP score
  let vwapScore = 0;
  if (vwapResult.vwapPosition === "ABOVE" && deltaResult.deltaClass === "HIGH") vwapScore = 50;
  else if (vwapResult.vwapPosition === "ABOVE") vwapScore = 30;
  else if (vwapResult.vwapPosition === "BELOW" && deltaResult.deltaClass === "HIGH") vwapScore = -50;
  else if (vwapResult.vwapPosition === "BELOW") vwapScore = -30;

  const scores = { obvScore, deltaScore, climaxScore, adScore, vwapScore };
  const compositeScore = computeVolumeScore({
    obv: obvResult.obv,
    obvTrend: obvResult.obvTrend,
    volumeDelta: deltaResult.delta,
    deltaClass: deltaResult.deltaClass,
    climax,
    adPattern,
    vwap: vwapResult.vwap,
    vwapPosition: vwapResult.vwapPosition,
    compositeScore: 0, // placeholder
    scores,
  });

  return {
    obv: obvResult.obv,
    obvTrend: obvResult.obvTrend,
    volumeDelta: deltaResult.delta,
    deltaClass: deltaResult.deltaClass,
    climax,
    adPattern,
    vwap: vwapResult.vwap,
    vwapPosition: vwapResult.vwapPosition,
    compositeScore,
    scores,
  };
}

// ── Agent Class ────────────────────────────────────────────────────

export class VolumeAgent extends BaseAgent {
  constructor() {
    super({
      id: "volume-agent",
      role: "volume" as AgentRole,
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Overrides ────────────────────────────────────────────────────

  protected buildUserPrompt(context: VolumeContext): string {
    const { token, chainId, currentPrice, analysis } = context;
    const lines: string[] = [
      `Token: ${token} (${chainId})`,
      `Current Price: $${currentPrice}`,
      "",
      "── Volume Analysis ──",
      `OBV Trend: ${analysis.obvTrend} (cumulative OBV: ${analysis.obv.toFixed(0)})`,
      `Volume Delta: ${analysis.volumeDelta.toFixed(2)}x average (${analysis.deltaClass})`,
      `Volume Climax Detected: ${analysis.climax ? "YES" : "no"}`,
      `Accumulation/Distribution: ${analysis.adPattern}`,
      `Anchored VWAP: $${analysis.vwap.toFixed(2)} — Price is ${analysis.vwapPosition} VWAP`,
      "",
      `Composite Score: ${analysis.compositeScore} / 100 (${analysis.compositeScore > 30 ? "bullish bias" : analysis.compositeScore < -30 ? "bearish bias" : "neutral"})`,
      "",
      "Signal breakdown:",
      `  OBV: ${analysis.scores.obvScore}`,
      `  Delta: ${analysis.scores.deltaScore}`,
      `  Climax: ${analysis.scores.climaxScore}`,
      `  A/D: ${analysis.scores.adScore}`,
      `  VWAP: ${analysis.scores.vwapScore}`,
      "",
      "Volume profile: OBV trending X, delta Yx avg, VWAP Z. Accumulation or distribution?",
    ];
    return lines.join("\n");
  }

  /** Run rules-based analysis, then either fast-path or call GPT-4o. */
  async analyzeMarket(context?: any): Promise<AgentReport> {
    // Accept both raw ohlcv bars and a pre-packaged VolumeContext
    let token: string;
    let chainId: string;
    let currentPrice: number;
    let bars: OHLCVBar[];
    let analysis: VolumeAnalysis;

    if (context && context.analysis) {
      // Pre-computed analysis passed in
      token = context.token || "UNKNOWN";
      chainId = context.chainId || "unknown";
      currentPrice = context.currentPrice || 0;
      bars = context.ohlcv || [];
      analysis = context.analysis;
    } else if (context && context.ohlcv) {
      token = context.token || "UNKNOWN";
      chainId = context.chainId || "unknown";
      currentPrice = context.currentPrice || 0;
      bars = context.ohlcv;
      analysis = analyzeVolume(bars, currentPrice);
    } else {
      return this.fallbackReport("No OHLCV data provided for volume analysis.");
    }

    if (bars.length < 10) {
      return this.fallbackReport(
        `Insufficient OHLCV data (${bars.length} bars, need 10+). Returning neutral.`,
      );
    }

    // Fast path: strong composite score with high confidence → skip LLM
    if (Math.abs(analysis.compositeScore) > 50) {
      const direction = analysis.compositeScore > 50 ? "LONG" : "SHORT";
      const confidence = Math.min(90, Math.abs(analysis.compositeScore));
      const signalDesc =
        analysis.compositeScore > 50
          ? `${analysis.adPattern} detected with ${analysis.obvTrend} OBV`
          : `${analysis.adPattern} detected with ${analysis.obvTrend} OBV`;

      return {
        agentId: this.id,
        role: this.role,
        timestamp: Date.now(),
        direction,
        confidence,
        reasoning: `Volume signals: ${signalDesc}. Delta ${analysis.volumeDelta.toFixed(1)}x avg (${analysis.deltaClass}), VWAP ${analysis.vwapPosition}. Composite score ${analysis.compositeScore}/100 — ${direction === "LONG" ? "bullish confluence" : "bearish confluence"}.${analysis.climax ? " Volume climax detected — watch for reversal." : ""}`,
        data: {
          analysis,
          fastPath: true,
        },
      };
    }

    // Near-neutral: skip LLM
    if (Math.abs(analysis.compositeScore) < 20) {
      return {
        agentId: this.id,
        role: this.role,
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: Math.max(35, 50 - Math.abs(analysis.compositeScore)),
        reasoning: `Volume signals are mixed. OBV ${analysis.obvTrend}, delta ${analysis.deltaClass}, A/D ${analysis.adPattern}, VWAP ${analysis.vwapPosition}. No strong directional bias.`,
        data: {
          analysis,
          fastPath: true,
        },
      };
    }

    // Moderate signal → GPT-4o synthesis
    const volumeCtx: VolumeContext = { token, chainId, currentPrice, ohlcv: bars, analysis };
    return super.analyzeMarket(volumeCtx);
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: VolumeAgent | null = null;

export function getVolumeAgent(): VolumeAgent {
  if (!_instance) {
    _instance = new VolumeAgent();
  }
  return _instance;
}
