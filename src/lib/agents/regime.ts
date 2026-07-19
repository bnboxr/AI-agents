// ── Regime Detection Agent ─────────────────────────────────────────
// Rules-based market regime classification using OHLCV data.
// GPT-4o is used only for synthesis and strategic recommendations.
// All classification is synchronous — no API calls needed.

import { BaseAgent } from "./base";
import type { OHLCVBar } from "./market";

// ── Regime Types ───────────────────────────────────────────────────

export type MarketRegime =
  | "trending_up"
  | "trending_down"
  | "ranging"
  | "high_volatility"
  | "low_volatility"
  | "bull_market"
  | "bear_market"
  | "consolidation";

export interface RegimeClassification {
  regime: MarketRegime;
  adx: number;
  volatility: number;       // ATR as % of price
  trendStrength: number;    // 0-100
  activeStrategies: string[];
  disabledStrategies: string[];
  parameters: RegimeParameters;
}

export interface RegimeParameters {
  positionSizeMultiplier: number;  // 0-1.0, fraction of normal size
  allowLongs: boolean;
  allowShorts: boolean;
  stopMultiplier: number;         // multiple of ATR for stops
  strategyMode: "trend" | "scalp" | "mean_reversion" | "breakout" | "wait";
  description: string;
}

// ── Default parameters per regime ──────────────────────────────────

const REGIME_PARAMS: Record<MarketRegime, RegimeParameters> = {
  trending_up: {
    positionSizeMultiplier: 1.0,
    allowLongs: true,
    allowShorts: false,
    stopMultiplier: 2.0,
    strategyMode: "trend",
    description: "Standard position size, trailing stops, don't short",
  },
  trending_down: {
    positionSizeMultiplier: 0.75,
    allowLongs: false,
    allowShorts: true,
    stopMultiplier: 2.5,
    strategyMode: "trend",
    description: "Reduced longs, prefer shorts, wider stops",
  },
  ranging: {
    positionSizeMultiplier: 0.5,
    allowLongs: true,
    allowShorts: true,
    stopMultiplier: 1.5,
    strategyMode: "scalp",
    description: "Scalp only, tight stops, mean-reversion strategies",
  },
  high_volatility: {
    positionSizeMultiplier: 0.5,
    allowLongs: true,
    allowShorts: true,
    stopMultiplier: 3.0,
    strategyMode: "breakout",
    description: "Reduce position 50%, wider stops, probe mode",
  },
  low_volatility: {
    positionSizeMultiplier: 1.0,
    allowLongs: true,
    allowShorts: true,
    stopMultiplier: 1.5,
    strategyMode: "breakout",
    description: "Standard sizing, expect breakout",
  },
  bull_market: {
    positionSizeMultiplier: 1.0,
    allowLongs: true,
    allowShorts: false,
    stopMultiplier: 2.0,
    strategyMode: "trend",
    description: "Price above EMA200, macro positive, trending up on daily",
  },
  bear_market: {
    positionSizeMultiplier: 0.5,
    allowLongs: false,
    allowShorts: true,
    stopMultiplier: 2.5,
    strategyMode: "trend",
    description: "Price below EMA200, macro negative, trending down on daily",
  },
  consolidation: {
    positionSizeMultiplier: 0.25,
    allowLongs: true,
    allowShorts: true,
    stopMultiplier: 1.0,
    strategyMode: "wait",
    description: "Wait or scalp with tiny positions",
  },
};

// ── Helper: Compute EMA ────────────────────────────────────────────

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

// ── Helper: Compute ATR ────────────────────────────────────────────

function computeATR(bars: OHLCVBar[], period: number = 14): number {
  if (bars.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }
  if (trueRanges.length === 0) return 0;
  // Simple moving average of TRs, capped to requested period
  const window = trueRanges.slice(-Math.min(period, trueRanges.length));
  return window.reduce((a, b) => a + b, 0) / window.length;
}

// ── Helper: Compute ADX ────────────────────────────────────────────

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

    const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    tr.push(trueRange);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    const pdm = upMove > downMove && upMove > 0 ? upMove : 0;
    const ndm = downMove > upMove && downMove > 0 ? downMove : 0;
    plusDM.push(pdm);
    minusDM.push(ndm);
  }

  // Use Wilder's smoothing (EMA with alpha = 1/period)
  const smooth = (values: number[]): number[] => {
    if (values.length < period) return values;
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    result.push(sum);
    for (let i = period; i < values.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / period + values[i]);
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

  // ADX is smoothed DX
  if (dx.length < period) return dx.length > 0 ? dx.reduce((a, b) => a + b, 0) / dx.length : 0;
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 1 / period;
  for (let i = period; i < dx.length; i++) {
    adx = adx + k * (dx[i] - adx);
  }
  return adx;
}

// ── Helper: Detect higher highs / lower lows structure ─────────────

function detectStructure(bars: OHLCVBar[]): {
  higherHighs: boolean;
  lowerLows: boolean;
} {
  if (bars.length < 10) return { higherHighs: false, lowerLows: false };

  // Look at last 20 bars for swing points
  const window = bars.slice(-Math.min(20, bars.length));
  const highs = window.map((b) => b.high);
  const lows = window.map((b) => b.low);

  // Find local swing highs (peaks)
  const swingHighs: number[] = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] &&
        highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
      swingHighs.push(highs[i]);
    }
  }

  // Find local swing lows (troughs)
  const swingLows: number[] = [];
  for (let i = 2; i < lows.length - 2; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] &&
        lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
      swingLows.push(lows[i]);
    }
  }

  let higherHighs = false;
  let lowerLows = false;

  if (swingHighs.length >= 2) {
    const recent = swingHighs.slice(-3);
    higherHighs = recent[recent.length - 1] > recent[0];
  }

  if (swingLows.length >= 2) {
    const recent = swingLows.slice(-3);
    lowerLows = recent[recent.length - 1] < recent[0];
  }

  return { higherHighs, lowerLows };
}

// ── Helper: Compute Bollinger Bands width ──────────────────────────

function computeBollingerWidth(prices: number[], period: number = 20): number {
  if (prices.length < period) return 0;
  const window = prices.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance = window.reduce((sum, p) => sum + (p - mean) ** 2, 0) / window.length;
  const stdDev = Math.sqrt(variance);
  return mean > 0 ? (stdDev * 2 / mean) * 100 : 0;
}

// ── Core: Classify Market Regime (rules-based, synchronous) ────────

export function classifyRegime(
  bars: OHLCVBar[],
  currentPrice: number,
): RegimeClassification {
  if (bars.length < 20) {
    return {
      regime: "consolidation",
      adx: 0,
      volatility: 0,
      trendStrength: 0,
      activeStrategies: ["wait"],
      disabledStrategies: ["trend_following", "mean_reversion", "breakout", "scalp"],
      parameters: REGIME_PARAMS.consolidation,
    };
  }

  const closes = bars.map((b) => b.close);

  // Compute indicators
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const ema200 = computeEMA(closes, 200);
  const atr = computeATR(bars, 14);
  const adx = computeADX(bars, 14);

  // ATR as percentage of price
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  // Compute 20-period average ATR for comparison
  const atr20Avg = computeATR(bars.slice(-40), 20);
  const atr20AvgPct = currentPrice > 0 ? (atr20Avg / currentPrice) * 100 : 0;

  // Trend strength based on EMA alignment
  const emaAligned = ema20 > ema50 && ema50 > ema200;
  const emaMisaligned = ema20 < ema50 && ema50 < ema200;

  // Structure
  const { higherHighs, lowerLows } = detectStructure(bars);

  // Bollinger Band width (for consolidation detection)
  const bbWidth = computeBollingerWidth(closes, 20);

  // Price relative to EMAs
  const aboveEMA50 = currentPrice > ema50;
  const aboveEMA200 = currentPrice > ema200;

  // Price oscillation band (for ranging detection)
  const recentBars = bars.slice(-20);
  const recentHigh = Math.max(...recentBars.map((b) => b.high));
  const recentLow = Math.min(...recentBars.map((b) => b.low));
  const rangePct = recentLow > 0 ? ((recentHigh - recentLow) / recentLow) * 100 : 100;
  const isNarrowRange = rangePct < 3;

  // BB tightening (consolidation signal)
  // Look at BB width over last 20 periods vs earlier
  const olderCloses = closes.slice(0, Math.max(0, closes.length - 20));
  const newerCloses = closes.slice(-20);
  const olderBBWidth = olderCloses.length >= 20 ? computeBollingerWidth(olderCloses, 20) : bbWidth;
  const newerBBWidth = newerCloses.length >= 10 ? computeBollingerWidth(newerCloses, Math.min(20, newerCloses.length)) : bbWidth;
  const bbTightening = olderBBWidth > 0 && newerBBWidth < olderBBWidth * 0.8;

  // ── Regime Classification ────────────────────────────────────────

  let regime: MarketRegime = "ranging";
  const activeStrategies: string[] = [];
  const disabledStrategies: string[] = [];

  // High Volatility check (priority — safety first)
  if (atr20AvgPct > 0 && atrPct > atr20AvgPct * 2) {
    regime = "high_volatility";
  }
  // Low Volatility check
  else if (atr20AvgPct > 0 && atrPct < atr20AvgPct * 0.5) {
    regime = "low_volatility";
  }
  // Consolidation check (sideways for 20+ candles, tightening BB)
  else if (isNarrowRange && bbTightening && adx < 20) {
    regime = "consolidation";
  }
  // Trending Up
  else if (aboveEMA50 && ema20 > ema50 && higherHighs && !lowerLows && adx > 25) {
    regime = "trending_up";
  }
  // Trending Down
  else if (!aboveEMA50 && ema20 < ema50 && lowerLows && !higherHighs && adx > 25) {
    regime = "trending_down";
  }
  // Bull Market (broader: above EMA200, daily uptrend)
  else if (aboveEMA200 && emaAligned && adx > 20 && currentPrice > ema200 * 1.02) {
    regime = "bull_market";
  }
  // Bear Market (broader: below EMA200, daily downtrend)
  else if (!aboveEMA200 && emaMisaligned && adx > 20 && currentPrice < ema200 * 0.98) {
    regime = "bear_market";
  }
  // Ranging (default fallback: ADX < 20)
  else if (adx < 20 || isNarrowRange) {
    regime = "ranging";
  }
  // Mixed signals — default to ranging
  else {
    regime = "ranging";
  }

  // ── Strategy Selection per Regime ────────────────────────────
  const params = REGIME_PARAMS[regime];

  if (params.allowLongs) activeStrategies.push("long_positions");
  else disabledStrategies.push("long_positions");

  if (params.allowShorts) activeStrategies.push("short_positions");
  else disabledStrategies.push("short_positions");

  if (params.strategyMode === "trend") {
    activeStrategies.push("trend_following", "breakout");
    disabledStrategies.push("mean_reversion", "scalp");
  } else if (params.strategyMode === "scalp") {
    activeStrategies.push("scalp", "mean_reversion");
    disabledStrategies.push("trend_following");
  } else if (params.strategyMode === "mean_reversion") {
    activeStrategies.push("mean_reversion", "scalp");
    disabledStrategies.push("trend_following", "breakout");
  } else if (params.strategyMode === "breakout") {
    activeStrategies.push("breakout", "trend_following");
    disabledStrategies.push("mean_reversion");
  } else {
    // wait mode
    disabledStrategies.push("trend_following", "mean_reversion", "breakout", "scalp");
  }

  // Trend strength score (0-100)
  let trendStrength = 0;
  if (adx > 25) trendStrength += 30;
  if (adx > 35) trendStrength += 20;
  if (adx > 50) trendStrength += 20;
  if (emaAligned || emaMisaligned) trendStrength += 20;
  if (higherHighs || lowerLows) trendStrength += 10;
  trendStrength = Math.min(100, trendStrength);

  return {
    regime,
    adx: Math.round(adx * 100) / 100,
    volatility: Math.round(atrPct * 100) / 100,
    trendStrength,
    activeStrategies,
    disabledStrategies,
    parameters: params,
  };
}

// ── GPT-4o System Prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior market regime analyst at a quantitative hedge fund. Your role is to synthesize market structure data into actionable strategic recommendations.

Given the current market structure metrics (ADX, volatility, trend alignment, ATR patterns), you must:

1. Confirm or override the rules-based regime classification
2. Recommend which trading strategies should be active and which should be disabled
3. Provide a clear, concise reasoning for your assessment

Focus on risk-adjusted strategy selection. Be specific about what to do and what to avoid.

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"concise regime analysis with strategy recommendations","data":{"confirmedRegime":"string","activeStrategies":["strategy1"],"disabledStrategies":["strategy2"],"riskAdjustment":"none"|"reduce"|"increase"|"pause"}}`;

// ── RegimeDetectionAgent Class ─────────────────────────────────────

export class RegimeDetectionAgent extends BaseAgent {
  constructor() {
    super({
      id: "regime-agent",
      role: "regime",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Run rules-based regime classification (synchronous, no API call).
   */
  detectRegime(
    bars: OHLCVBar[],
    currentPrice: number,
  ): RegimeClassification {
    return classifyRegime(bars, currentPrice);
  }

  /**
   * Build user prompt for GPT-4o synthesis.
   */
  protected buildUserPrompt(context: {
    token: string;
    chainId: string;
    currentPrice: number;
    classification: RegimeClassification;
  }): string {
    const c = context.classification;
    const lines: string[] = [
      `Token: ${context.token} (${context.chainId})`,
      `Current Price: $${context.currentPrice}`,
      ``,
      `Rules-Based Classification:`,
      `  Detected Regime: ${c.regime.replace(/_/g, " ")}`,
      `  ADX: ${c.adx}`,
      `  Volatility (ATR%): ${c.volatility}%`,
      `  Trend Strength: ${c.trendStrength}/100`,
      `  Active Strategies: ${c.activeStrategies.join(", ") || "none"}`,
      `  Disabled Strategies: ${c.disabledStrategies.join(", ") || "none"}`,
      `  Parameters: positionSize=${c.parameters.positionSizeMultiplier}x, longs=${c.parameters.allowLongs}, shorts=${c.parameters.allowShorts}, mode=${c.parameters.strategyMode}`,
      ``,
      `Based on current market structure (ADX: ${c.adx}, volatility: ${c.volatility}%, trend strength: ${c.trendStrength}), what regime are we in? What strategies should be active?`,
    ];

    return lines.join("\n");
  }

  /**
   * Synthesize regime analysis with GPT-4o.
   * Falls back to rules-based classification if LLM is unavailable.
   */
  async synthesize(
    token: string,
    chainId: string,
    currentPrice: number,
    classification: RegimeClassification,
  ): Promise<{
    direction: "LONG" | "SHORT" | "NEUTRAL";
    confidence: number;
    reasoning: string;
    confirmedRegime: string;
    activeStrategies: string[];
    disabledStrategies: string[];
    riskAdjustment: string;
  }> {
    const report = await this.analyzeMarket({
      token,
      chainId,
      currentPrice,
      classification,
    });

    return {
      direction: report.direction,
      confidence: report.confidence,
      reasoning: report.reasoning,
      confirmedRegime: report.data?.confirmedRegime || classification.regime,
      activeStrategies: report.data?.activeStrategies || classification.activeStrategies,
      disabledStrategies: report.data?.disabledStrategies || classification.disabledStrategies,
      riskAdjustment: report.data?.riskAdjustment || "none",
    };
  }
}
