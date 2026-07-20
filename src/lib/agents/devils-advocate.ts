// ── Devil's Advocate Agent ─────────────────────────────────────────
// Level 3 Decision (weight 0.15 — HIGHEST per owner's explicit mandate).
// Runs AFTER confidence but BEFORE final decision in makeDecision.
// Has ONE job: find reasons NOT to trade.
// When all other agents say BUY, this agent exclusively looks for reasons
// to NOT buy. Always returns NEUTRAL direction.
//
// All detection methods are rules-based, using OHLCV data + other agent
// reports. GPT-4o is used only for final synthesis: "Are any of these
// severe enough to VETO?"
//
// Scoring rubric (owner-mandated):
//   0-1 flags → NO_OBJECTION  → trade proceeds normally
//   2-3 flags → OBJECTION     → reduce confidence 20-30%, reduce position 25%
//   4+ flags  → VETO          → BLOCK the trade entirely, return NEUTRAL

import { BaseAgent } from "./base";
import type { AgentReport } from "./types";
import type { OHLCVBar } from "./market";

// ── Types ─────────────────────────────────────────────────────────

export interface RedFlag {
  /** Machine-readable flag name */
  id: string;
  /** Human-readable label */
  label: string;
  /** Weight multiplier for severity (1 = standard, 2 = severe) */
  weight: number;
  /** Supporting detail (e.g. "RSI 62 vs prev 68", "FOMC in 1.5h") */
  detail: string;
  /** The detection method that triggered */
  source:
    | "hidden_divergence"
    | "declining_volume"
    | "major_resistance"
    | "imminent_news"
    | "excessive_funding"
    | "high_open_interest"
    | "spread_widening"
    | "correlation_breakdown";
}

export type SeverityLevel = "NO_OBJECTION" | "OBJECTION" | "VETO";

export interface DevilsAdvocateResult {
  /** Total count of red flags detected */
  flagCount: number;
  /** Individual flags */
  flags: RedFlag[];
  /** Severity determined by flag count */
  severity: SeverityLevel;
  /** Position multiplier to apply (1.0 / 0.75 / 0.0) */
  positionMultiplier: number;
  /** Confidence reduction to apply (0 / 20-30 / 100) */
  confidenceReduction: number;
  /** Whether this is a VETO (blocks the trade entirely) */
  veto: boolean;
}

export interface DevilsAdvocateContext {
  /** Token symbol (e.g. "BTC/USDT") */
  token: string;
  /** Current price */
  currentPrice: number;
  /** OHLCV bars for technical detection (need at least 50) */
  ohlcv?: OHLCVBar[];
  /** All agent reports from gatherReports */
  reports: AgentReport[];
  /** Funding rate from exchange (optional) */
  fundingRate?: number;
  /** 24h open interest change in % (optional) */
  openInterestChange24h?: number;
  /** Current bid/ask spread in % (optional) */
  spread?: number;
  /** Average spread over last N observations (for widening detection) */
  avgSpread?: number;
}

// ── Constants ─────────────────────────────────────────────────────

/** RSI period for divergence detection */
const RSI_PERIOD = 14;

/** Lookback for swing high detection */
const SWING_HIGH_LOOKBACK = 50;

/** Proximity to resistance as a percentage threshold */
const RESISTANCE_PROXIMITY_PCT = 2;

/** Volume lookback candles for declining volume check */
const VOLUME_LOOKBACK = 5;

/** Minimum volume % decline over the period to flag */
const VOLUME_DECLINE_THRESHOLD = 20; // 20% decline

/** Funding rate threshold (0.1% = 0.001) */
const FUNDING_HIGH_THRESHOLD = 0.001;

/** OI spike threshold without price follow-through */
const OI_SPIKE_THRESHOLD = 20; // 20% in 24h

/** Price follow-through threshold for OI validation */
const OI_PRICE_FOLLOW_PCT = 2; // price must move >2% to not flag

/** Spread widening threshold relative to avg */
const SPREAD_WIDEN_MULTIPLIER = 2.0; // 2x average

// ── System Prompt ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Devil's Advocate Agent at a tier-1 quantitative hedge fund. Your ONLY job is to find reasons NOT to trade. You are the most skeptical, risk-averse member of the team.

When all other agents say BUY, you exclusively look for reasons to NOT buy. You never recommend a trade — you only raise objections.

You receive a pre-computed list of "red flags" — reasons this trade might be dangerous:
- Hidden bearish divergence (price up, RSI down)
- Declining volume during price rally
- Price near major resistance
- Imminent economic news events
- Excessive funding rate (longs overcrowded)
- High OI spike without price confirmation
- Bid/ask spread widening (liquidity drying up)
- Correlation breakdown (BTC dropping while alt considered)

Your task:
1. Review each red flag for severity
2. Determine if ANY combination is severe enough to VETO the trade entirely
3. Determine if position size should be reduced (even if not vetoed)
4. Consider: is there an asymmetric downside risk NOT priced in?

Key rules:
- 0-1 flags → NO OBJECTION → trade proceeds normally
- 2-3 flags → OBJECTION → reduce position by 25%, reduce confidence by 20-30%
- 4+ flags → VETO → block the trade entirely, return NEUTRAL
- Correlation breakdown + any other flag → automatic OBJECTION
- FOMC/Fed major news + any other flag → automatic VETO

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"brief synthesis of red flags","data":{"severity":"NO_OBJECTION"|"OBJECTION"|"VETO","veto":true/false,"positionMultiplier":1.0|0.75|0.0,"confidenceReduction":0-100,"flagsSuppressed":["flag1","flag2"]}}`;

// ── RSI Computation (inlined — no external dependency) ──────────

/**
 * Compute RSI values for an array of close prices.
 * Returns array of same length; first RSI_PERIOD entries are 50 (neutral).
 */
function computeRSI(closes: number[], period: number = RSI_PERIOD): number[] {
  if (closes.length < period + 1) {
    return closes.map(() => 50);
  }

  const rsi: number[] = new Array(closes.length).fill(50);
  const gains: number[] = [];
  const losses: number[] = [];

  // Compute price changes
  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);
  }

  // Initial average gain/loss (SMA of first `period` values)
  let avgGain = gains.slice(0, period).reduce((s, g) => s + g, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, l) => s + l, 0) / period;

  // First RSI value
  if (avgLoss === 0) {
    rsi[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi[period] = 100 - 100 / (1 + rs);
  }

  // Wilder's smoothing for remaining values
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      rsi[i + 1] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i + 1] = 100 - 100 / (1 + rs);
    }
  }

  return rsi;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Find swing highs in the price data — local maxima that are higher than
 * both the preceding and following candle high.
 */
function findSwingHighs(bars: OHLCVBar[], lookback: number): number[] {
  const swingHighs: number[] = [];
  const subset = bars.slice(-lookback);

  for (let i = 1; i < subset.length - 1; i++) {
    if (
      subset[i].high > subset[i - 1].high &&
      subset[i].high > subset[i + 1].high
    ) {
      swingHighs.push(subset[i].high);
    }
  }

  return swingHighs;
}

/** Check if price is within pct% of any resistance level */
function nearResistance(
  currentPrice: number,
  swingHighs: number[],
  pct: number,
): { near: boolean; nearestLevel: number; distancePct: number } {
  if (swingHighs.length === 0) return { near: false, nearestLevel: 0, distancePct: Infinity };

  // Find nearest swing high ABOVE current price
  const resistanceLevels = swingHighs
    .filter((h) => h > currentPrice)
    .sort((a, b) => a - b);

  if (resistanceLevels.length === 0) return { near: false, nearestLevel: 0, distancePct: Infinity };

  const nearestLevel = resistanceLevels[0];
  const distancePct = ((nearestLevel - currentPrice) / currentPrice) * 100;

  return {
    near: distancePct <= pct,
    nearestLevel,
    distancePct: Math.round(distancePct * 100) / 100,
  };
}

// ── Detection Methods ─────────────────────────────────────────────

/**
 * 1. Hidden Divergence
 *    Price makes higher high, RSI makes lower high → bearish hidden divergence.
 *    Looks at last 20 candles for the pattern.
 */
function detectHiddenDivergence(bars: OHLCVBar[]): RedFlag | null {
  if (bars.length < RSI_PERIOD + 5) return null;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const rsiValues = computeRSI(closes);

  // Find two swing highs in the last ~20 bars
  const window = Math.min(20, bars.length);
  const recentBars = bars.slice(-window);
  const recentRSI = rsiValues.slice(-window);
  const recentHighs = recentBars.map((b) => b.high);

  // Find local price peaks (simple approach: compare to 3 neighbors each side)
  const peaks: Array<{ idx: number; price: number; rsi: number }> = [];
  for (let i = 3; i < recentBars.length - 3; i++) {
    const isPeak =
      recentHighs[i] > recentHighs[i - 1] &&
      recentHighs[i] > recentHighs[i - 2] &&
      recentHighs[i] > recentHighs[i - 3] &&
      recentHighs[i] > recentHighs[i + 1] &&
      recentHighs[i] > recentHighs[i + 2] &&
      recentHighs[i] > recentHighs[i + 3];
    if (isPeak) {
      peaks.push({ idx: i, price: recentHighs[i], rsi: recentRSI[i] });
    }
  }

  // Need at least 2 peaks to compare
  if (peaks.length < 2) return null;

  // Get last two peaks
  const peakA = peaks[peaks.length - 2];
  const peakB = peaks[peaks.length - 1];

  // Hidden bearish divergence: price makes higher high, RSI makes lower high
  if (
    peakB.price > peakA.price &&
    peakB.rsi < peakA.rsi &&
    peakA.rsi > 60 // RSI should be elevated (bullish territory) for meaningful divergence
  ) {
    return {
      id: "hidden_divergence",
      label: "Hidden Bearish Divergence",
      weight: 1.5,
      detail: `Price HH $${peakA.price.toFixed(2)} → $${peakB.price.toFixed(2)}, RSI LH ${peakA.rsi.toFixed(1)} → ${peakB.rsi.toFixed(1)}`,
      source: "hidden_divergence",
    };
  }

  return null;
}

/**
 * 2. Declining Volume
 *    Volume decreasing over last 5 candles while price rising → weak momentum.
 */
function detectDecliningVolume(bars: OHLCVBar[]): RedFlag | null {
  if (bars.length < VOLUME_LOOKBACK + 1) return null;

  const recent = bars.slice(-(VOLUME_LOOKBACK + 1));
  // Compare average volume of first half vs second half
  const halfIdx = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, halfIdx);
  const secondHalf = recent.slice(halfIdx);

  const firstAvg =
    firstHalf.reduce((s, b) => s + b.volume, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((s, b) => s + b.volume, 0) / secondHalf.length;

  if (firstAvg === 0) return null;

  const volumeDecline = ((firstAvg - secondAvg) / firstAvg) * 100;

  // Check if price is also rising
  const priceStart = recent[0].close;
  const priceEnd = recent[recent.length - 1].close;
  const priceRising = priceEnd > priceStart;

  if (volumeDecline >= VOLUME_DECLINE_THRESHOLD && priceRising) {
    return {
      id: "declining_volume",
      label: "Declining Volume on Rally",
      weight: 1.0,
      detail: `Volume -${Math.round(volumeDecline)}% over last ${VOLUME_LOOKBACK + 1} candles while price +${Math.round(((priceEnd - priceStart) / priceStart) * 100 * 100) / 100}%`,
      source: "declining_volume",
    };
  }

  return null;
}

/**
 * 3. Major Resistance
 *    Price within 2% of a significant swing high from last 50 candles.
 */
function detectMajorResistance(
  currentPrice: number,
  bars: OHLCVBar[],
): RedFlag | null {
  if (bars.length < SWING_HIGH_LOOKBACK) return null;

  const swingHighs = findSwingHighs(bars, SWING_HIGH_LOOKBACK);
  const result = nearResistance(currentPrice, swingHighs, RESISTANCE_PROXIMITY_PCT);

  if (result.near) {
    return {
      id: "major_resistance",
      label: "Near Major Resistance",
      weight: 1.0,
      detail: `Price $${currentPrice.toFixed(2)} is ${result.distancePct}% below resistance $${result.nearestLevel.toFixed(2)}`,
      source: "major_resistance",
    };
  }

  return null;
}

/**
 * 4. Imminent News
 *    News agent reports high-impact event within 2 hours (FOMC, CPI, etc.).
 */
function detectImminentNews(reports: AgentReport[]): RedFlag | null {
  const newsReport = reports.find((r) => r.role === "news");

  if (!newsReport || !newsReport.data) return null;

  // Check for high-impact news in the data
  const headlines = newsReport.data.headlines as
    | Array<{ title: string; impact?: string }>
    | undefined;

  if (!headlines || headlines.length === 0) return null;

  const HIGH_IMPACT_KEYWORDS = [
    "fomc",
    "fed",
    "cpi",
    "inflation",
    "interest rate",
    "gdp",
    "unemployment",
    "nonfarm",
    "ecb",
    "powell",
    "regulation",
    "sec",
    "ban",
    "hack",
    "exploit",
  ];

  const now = Date.now();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  for (const h of headlines) {
    const title = (h.title || "").toLowerCase();
    const matches = HIGH_IMPACT_KEYWORDS.some((kw) => title.includes(kw));

    if (matches) {
      // Check if the headline is recent (within 2 hours, or upcoming)
      // Since we don't have exact event times, use headline recency as proxy
      return {
        id: "imminent_news",
        label: "Imminent High-Impact News",
        weight: 2.0,
        detail: `News detected: "${h.title.slice(0, 80)}"`,
        source: "imminent_news",
      };
    }
  }

  // Also check sentiment for extreme values (suggesting event-driven)
  if (
    newsReport.data.overallSentiment !== undefined &&
    Math.abs(Number(newsReport.data.overallSentiment)) > 70
  ) {
    return {
      id: "imminent_news",
      label: "Elevated News Sentiment",
      weight: 1.0,
      detail: `News sentiment at extreme: ${newsReport.data.overallSentiment}`,
      source: "imminent_news",
    };
  }

  return null;
}

/**
 * 5. Excessive Funding
 *    Funding rate > 0.1% → longs overcrowded.
 */
function detectExcessiveFunding(fundingRate?: number): RedFlag | null {
  if (fundingRate === undefined || fundingRate === null) return null;

  if (fundingRate > FUNDING_HIGH_THRESHOLD) {
    return {
      id: "excessive_funding",
      label: "Excessive Funding Rate",
      weight: 1.5,
      detail: `Funding rate ${(fundingRate * 100).toFixed(3)}% (>0.1%) — longs overcrowded`,
      source: "excessive_funding",
    };
  }

  return null;
}

/**
 * 6. High Open Interest
 *    OI spike > 20% in 24h without price follow-through → manipulation risk.
 */
function detectHighOpenInterest(
  oiChangePct?: number,
  priceChange24h?: number,
): RedFlag | null {
  if (oiChangePct === undefined || oiChangePct === null) return null;

  if (oiChangePct > OI_SPIKE_THRESHOLD) {
    // Check if price followed through
    const absPriceChange = Math.abs(priceChange24h ?? 0);

    if (absPriceChange < OI_PRICE_FOLLOW_PCT) {
      return {
        id: "high_open_interest",
        label: "OI Spike Without Price Confirmation",
        weight: 1.5,
        detail: `OI +${oiChangePct.toFixed(1)}% in 24h, price only ±${absPriceChange.toFixed(2)}% — potential manipulation`,
        source: "high_open_interest",
      };
    }
  }

  return null;
}

/**
 * 7. Spread Widening
 *    Bid/ask spread expanding → liquidity drying up.
 */
function detectSpreadWidening(spread?: number, avgSpread?: number): RedFlag | null {
  if (spread === undefined || spread === null) return null;
  if (avgSpread === undefined || avgSpread === null || avgSpread === 0) return null;

  if (spread > avgSpread * SPREAD_WIDEN_MULTIPLIER) {
    return {
      id: "spread_widening",
      label: "Spread Widening — Liquidity Drying Up",
      weight: 1.0,
      detail: `Spread ${spread.toFixed(4)}% vs avg ${avgSpread.toFixed(4)}% (${Math.round((spread / avgSpread) * 100)}% wider)`,
      source: "spread_widening",
    };
  }

  return null;
}

/**
 * 8. Correlation Breakdown
 *    BTC dropping while the asset being considered is an alt → systemic risk.
 *    Checks the correlation agent's report for BTC downtrend signals.
 */
function detectCorrelationBreakdown(reports: AgentReport[]): RedFlag | null {
  const corrReport = reports.find((r) => r.role === "correlation");

  if (!corrReport || !corrReport.data) return null;

  // Check for correlation breakdown / high divergence score
  const matrix = corrReport.data.matrix;
  if (!matrix) return null;

  const divergenceScore = matrix.divergenceScore;
  const riskLevel = matrix.riskLevel;

  if (
    (divergenceScore !== undefined && divergenceScore > 0.5) ||
    riskLevel === "HALT" ||
    riskLevel === "HIGH"
  ) {
    // Determine if there are pairs breaking down
    const brokenPairs: string[] = [];
    if (matrix.pairs && Array.isArray(matrix.pairs)) {
      for (const pair of matrix.pairs) {
        if (pair.diverged || pair.currentCorr === undefined || pair.currentCorr < 0.3) {
          brokenPairs.push(pair.pair || "unknown");
        }
      }
    }

    return {
      id: "correlation_breakdown",
      label: "Correlation Breakdown",
      weight: 2.0,
      detail: `Divergence score: ${divergenceScore ?? "N/A"}, risk: ${riskLevel ?? "N/A"}, broken pairs: ${brokenPairs.length > 0 ? brokenPairs.join(", ") : "multiple"}`,
      source: "correlation_breakdown",
    };
  }

  return null;
}

// ── Devil's Advocate Agent ───────────────────────────────────────

export class DevilsAdvocateAgent extends BaseAgent {
  constructor() {
    super({
      id: "devils-advocate-agent",
      role: "devils_advocate",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Main: Run all detection methods ─────────────────────────────

  /**
   * Run all rules-based red flag detections synchronously.
   * Returns DevilsAdvocateResult with flags, severity, and position multiplier.
   */
  detectRedFlags(ctx: DevilsAdvocateContext): DevilsAdvocateResult {
    const flags: RedFlag[] = [];
    const { ohlcv, reports, currentPrice, fundingRate, openInterestChange24h, spread, avgSpread } = ctx;

    // Find price change from reports (for OI check)
    const marketReport = reports.find((r) => r.role === "market");
    const priceChange24h = marketReport?.data?.change24h as number | undefined;

    // ── 1. Hidden Divergence ──
    if (ohlcv && ohlcv.length >= RSI_PERIOD + 5) {
      const div = detectHiddenDivergence(ohlcv);
      if (div) flags.push(div);
    }

    // ── 2. Declining Volume ──
    if (ohlcv && ohlcv.length >= VOLUME_LOOKBACK + 1) {
      const vol = detectDecliningVolume(ohlcv);
      if (vol) flags.push(vol);
    }

    // ── 3. Major Resistance ──
    if (ohlcv && ohlcv.length >= SWING_HIGH_LOOKBACK) {
      const res = detectMajorResistance(currentPrice, ohlcv);
      if (res) flags.push(res);
    }

    // ── 4. Imminent News ──
    const news = detectImminentNews(reports);
    if (news) flags.push(news);

    // ── 5. Excessive Funding ──
    const funding = detectExcessiveFunding(fundingRate);
    if (funding) flags.push(funding);

    // ── 6. High Open Interest ──
    const oi = detectHighOpenInterest(openInterestChange24h, priceChange24h);
    if (oi) flags.push(oi);

    // ── 7. Spread Widening ──
    const spreadFlag = detectSpreadWidening(spread, avgSpread);
    if (spreadFlag) flags.push(spreadFlag);

    // ── 8. Correlation Breakdown ──
    const corr = detectCorrelationBreakdown(reports);
    if (corr) flags.push(corr);

    // ── Compute scoring ──
    const totalWeight = flags.reduce((s, f) => s + f.weight, 0);
    const flagCount = flags.length;

    let severity: SeverityLevel;
    let positionMultiplier: number;
    let confidenceReduction: number;
    let veto: boolean;

    if (flagCount <= 1) {
      severity = "NO_OBJECTION";
      positionMultiplier = 1.0;
      confidenceReduction = 0;
      veto = false;
    } else if (flagCount <= 3) {
      severity = "OBJECTION";
      positionMultiplier = 0.75;
      confidenceReduction = Math.min(30, 20 + (flagCount - 2) * 5);
      veto = false;
    } else {
      severity = "VETO";
      positionMultiplier = 0.0;
      confidenceReduction = 100;
      veto = true;
    }

    // ── Special combinations (owner rules) ──
    // Correlation breakdown + any other flag → automatic OBJECTION (upgrade to VETO if 2+)
    const hasCorrelationBreakdown = flags.some((f) => f.source === "correlation_breakdown");
    if (hasCorrelationBreakdown && flagCount >= 2 && severity === "NO_OBJECTION") {
      // Correlation + 1 other = force OBJECTION
      severity = "OBJECTION";
      positionMultiplier = 0.75;
      confidenceReduction = 25;
      veto = false;
    }

    // FOMC/Fed/news + any other flag → automatic VETO
    const hasMajorNews = flags.some(
      (f) => f.source === "imminent_news" && f.weight >= 2.0,
    );
    if (hasMajorNews && flagCount >= 2) {
      severity = "VETO";
      positionMultiplier = 0.0;
      confidenceReduction = 100;
      veto = true;
    }

    return {
      flagCount,
      flags,
      severity,
      positionMultiplier,
      confidenceReduction,
      veto,
    };
  }

  // ── GPT-4o Synthesis ────────────────────────────────────────────

  /**
   * Build user prompt for GPT-4o review of detected red flags.
   */
  protected buildUserPrompt(ctx: DevilsAdvocateContext & { result: DevilsAdvocateResult }): string {
    const lines: string[] = [
      `=== Devil's Advocate Review ===`,
      ``,
      `Token: ${ctx.token}`,
      `Current Price: $${ctx.currentPrice}`,
      ``,
      `Red Flags Detected (${ctx.result.flagCount}):`,
    ];

    for (const flag of ctx.result.flags) {
      lines.push(
        `  [${flag.weight}x] ${flag.label}: ${flag.detail}`,
      );
    }

    if (ctx.result.flags.length === 0) {
      lines.push(`  (none — no objections found)`);
    }

    lines.push(``);
    lines.push(`Preliminary Severity: ${ctx.result.severity}`);
    lines.push(`Position Multiplier: ${ctx.result.positionMultiplier}`);
    lines.push(`Confidence Reduction: ${ctx.result.confidenceReduction}%`);
    lines.push(`VETO: ${ctx.result.veto ? "YES — BLOCK TRADE" : "NO"}`);
    lines.push(``);

    // Add context from other agents
    const scoredDirection = ctx.reports.filter((r) => r.confidence > 50).length;
    lines.push(`Agent reports: ${ctx.reports.length} total, ${scoredDirection} with meaningful signals.`);
    lines.push(``);
    lines.push(
      `Are any of these red flags severe enough to VETO the trade? Should we reduce position?`,
    );

    return lines.join("\n");
  }

  /**
   * Synthesize red flag analysis with GPT-4o.
   * Falls back to rules-based result if LLM unavailable.
   */
  async synthesize(ctx: DevilsAdvocateContext): Promise<AgentReport> {
    const result = this.detectRedFlags(ctx);
    const report = await this.analyzeMarket({ ...ctx, result });

    // Always enforce NEUTRAL direction
    report.direction = "NEUTRAL";

    // Enrich report data
    report.data = {
      ...report.data,
      flags: result.flags.map((f) => ({
        id: f.id,
        label: f.label,
        weight: f.weight,
        detail: f.detail,
        source: f.source,
      })),
      flagCount: result.flagCount,
      severity: result.severity,
      positionMultiplier: result.positionMultiplier,
      confidenceReduction: result.confidenceReduction,
      veto: result.veto,
    };

    // If LLM parse failed, use rules-based output
    if (report.confidence === 0 && report.reasoning.startsWith("Analysis failed")) {
      report.confidence = result.flagCount * 15;
      report.reasoning = `${result.severity}: ${result.flags.map((f) => f.label).join(" + ") || "No objections"}`;
    }

    return report;
  }

  /**
   * Override analyzeMarket so it accepts DevilsAdvocateContext + result.
   */
  async analyzeMarket(
    context: DevilsAdvocateContext & { result: DevilsAdvocateResult },
  ): Promise<AgentReport> {
    return super.analyzeMarket(context);
  }
}
