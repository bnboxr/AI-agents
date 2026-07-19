// ── Pattern Recognition Agent ─────────────────────────────────────
import { BaseAgent } from "./base";
import type { OHLCVBar } from "./market";

export interface PriceExtrema {
  highs: Array<{ index: number; price: number; timestamp: number }>;
  lows: Array<{ index: number; price: number; timestamp: number }>;
}

export interface DetectedPattern {
  type: "HEAD_AND_SHOULDERS" | "INVERSE_HEAD_AND_SHOULDERS" | "DOUBLE_TOP" | "DOUBLE_BOTTOM" | "ASCENDING_TRIANGLE" | "DESCENDING_TRIANGLE" | "SYMMETRICAL_TRIANGLE" | "BULLISH_FLAG" | "BEARISH_FLAG" | "NONE";
  confidence: number; // 0-100
  startIndex: number;
  endIndex: number;
  target?: number; // price target if pattern completes
  description: string;
}

const SYSTEM_PROMPT = `You are a professional chart pattern analyst with 30 years of experience in technical analysis. You confirm algorithmic pattern detections in OHLCV price data.

Review the detected pattern(s) and the price data context:
- Confirm or reject the algorithmic detection
- Adjust confidence based on pattern quality (clearness, volume confirmation, context)
- Determine direction: LONG for bullish patterns, SHORT for bearish, NEUTRAL if unconvincing
- Provide reasoning for your confirmation

Key pattern criteria:
- Head & Shoulders: three peaks, middle highest, neckline break confirms (bearish reversal)
- Inverse H&S: three troughs, middle lowest, neckline break confirms (bullish reversal)
- Double Top: two similar highs with valley between, breaks support (bearish)
- Double Bottom: two similar lows with peak between, breaks resistance (bullish)
- Ascending Triangle: flat top, rising lows (bullish continuation)
- Descending Triangle: flat bottom, falling highs (bearish continuation)
- Bullish Flag: sharp rise, then downward channel (bullish continuation)
- Bearish Flag: sharp drop, then upward channel (bearish continuation)

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"pattern analysis","data":{"confirmedPattern":"pattern name","patternConfidence":0-100,"target":number|null,"patternQuality":"POOR"|"FAIR"|"GOOD"|"EXCELLENT"}}`;

export class PatternRecognitionAgent extends BaseAgent {
  // Window size for extrema detection (lookback bars)
  private readonly EXTREMA_WINDOW = 5;
  // Minimum bars needed for pattern detection
  private readonly MIN_BARS = 30;
  // Tolerance for price similarity (e.g., two tops within X%)
  private readonly PRICE_TOLERANCE = 0.03; // 3%

  constructor() {
    super({
      id: "pattern-agent",
      role: "pattern",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /** Find local highs and lows in a price series. */
  findExtrema(bars: OHLCVBar[]): PriceExtrema {
    const highs: PriceExtrema["highs"] = [];
    const lows: PriceExtrema["lows"] = [];
    const w = this.EXTREMA_WINDOW;

    for (let i = w; i < bars.length - w; i++) {
      const slice = bars.slice(i - w, i + w + 1);
      const midHigh = slice[w].high;
      const midLow = slice[w].low;

      const isLocalHigh = slice.every((b) => b.high <= midHigh);
      const isLocalLow = slice.every((b) => b.low >= midLow);

      if (isLocalHigh) {
        highs.push({
          index: i,
          price: midHigh,
          timestamp: bars[i].timestamp,
        });
      }
      if (isLocalLow) {
        lows.push({
          index: i,
          price: midLow,
          timestamp: bars[i].timestamp,
        });
      }
    }

    return { highs, lows };
  }

  /** Detect Head & Shoulders pattern (bearish reversal). */
  detectHeadAndShoulders(
    bars: OHLCVBar[],
    extrema: PriceExtrema,
  ): DetectedPattern | null {
    const { highs } = extrema;
    if (highs.length < 3) return null;

    // Look for three peaks: left shoulder, head, right shoulder
    // Head must be highest, shoulders roughly equal
    for (let i = 0; i < highs.length - 2; i++) {
      const leftShoulder = highs[i];
      const head = highs[i + 1];
      const rightShoulder = highs[i + 2];

      // Head must be higher than both shoulders
      if (head.price <= leftShoulder.price || head.price <= rightShoulder.price) {
        continue;
      }

      // Shoulders must be roughly equal (within tolerance)
      const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
      if (shoulderDiff > this.PRICE_TOLERANCE) continue;

      // Shoulders must be below head by at least tolerance
      const headAboveLeft = (head.price - leftShoulder.price) / leftShoulder.price;
      if (headAboveLeft < this.PRICE_TOLERANCE) continue;

      // Find neckline (lowest point between shoulders)
      const necklineLow = Math.min(
        ...bars.slice(leftShoulder.index, rightShoulder.index).map((b) => b.low),
      );

      // Compute target
      const patternHeight = head.price - necklineLow;
      const target = necklineLow - patternHeight;

      return {
        type: "HEAD_AND_SHOULDERS",
        confidence: 60,
        startIndex: leftShoulder.index,
        endIndex: rightShoulder.index,
        target,
        description: `Head & Shoulders: L-shoulder $${leftShoulder.price.toFixed(2)}, Head $${head.price.toFixed(2)}, R-shoulder $${rightShoulder.price.toFixed(2)}. Neckline at $${necklineLow.toFixed(2)}.`,
      };
    }

    return null;
  }

  /** Detect Inverse Head & Shoulders (bullish reversal). */
  detectInverseHeadAndShoulders(
    bars: OHLCVBar[],
    extrema: PriceExtrema,
  ): DetectedPattern | null {
    const { lows } = extrema;
    if (lows.length < 3) return null;

    for (let i = 0; i < lows.length - 2; i++) {
      const leftShoulder = lows[i];
      const head = lows[i + 1];
      const rightShoulder = lows[i + 2];

      // Head must be lower than both shoulders
      if (head.price >= leftShoulder.price || head.price >= rightShoulder.price) {
        continue;
      }

      // Shoulders roughly equal
      const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
      if (shoulderDiff > this.PRICE_TOLERANCE) continue;

      // Head below shoulders by at least tolerance
      const headBelowLeft = (leftShoulder.price - head.price) / leftShoulder.price;
      if (headBelowLeft < this.PRICE_TOLERANCE) continue;

      const necklineHigh = Math.max(
        ...bars.slice(leftShoulder.index, rightShoulder.index).map((b) => b.high),
      );

      const patternHeight = necklineHigh - head.price;
      const target = necklineHigh + patternHeight;

      return {
        type: "INVERSE_HEAD_AND_SHOULDERS",
        confidence: 60,
        startIndex: leftShoulder.index,
        endIndex: rightShoulder.index,
        target,
        description: `Inverse H&S: L-shoulder $${leftShoulder.price.toFixed(2)}, Head $${head.price.toFixed(2)}, R-shoulder $${rightShoulder.price.toFixed(2)}. Neckline at $${necklineHigh.toFixed(2)}.`,
      };
    }

    return null;
  }

  /** Detect Double Top (bearish reversal). */
  detectDoubleTop(
    bars: OHLCVBar[],
    extrema: PriceExtrema,
  ): DetectedPattern | null {
    const { highs } = extrema;
    if (highs.length < 2) return null;

    for (let i = 0; i < highs.length - 1; i++) {
      const top1 = highs[i];
      const top2 = highs[i + 1];

      const diff = Math.abs(top1.price - top2.price) / top1.price;
      if (diff > this.PRICE_TOLERANCE) continue;

      // Must be at least 5 bars apart
      if (top2.index - top1.index < 5) continue;

      // Find valley between the two tops
      const midBars = bars.slice(top1.index, top2.index);
      const valley = Math.min(...midBars.map((b) => b.low));

      const patternHeight = top1.price - valley;
      const target = valley - patternHeight;

      return {
        type: "DOUBLE_TOP",
        confidence: 55,
        startIndex: top1.index,
        endIndex: top2.index,
        target,
        description: `Double Top: $${top1.price.toFixed(2)} and $${top2.price.toFixed(2)}. Valley at $${valley.toFixed(2)}.`,
      };
    }

    return null;
  }

  /** Detect Double Bottom (bullish reversal). */
  detectDoubleBottom(
    bars: OHLCVBar[],
    extrema: PriceExtrema,
  ): DetectedPattern | null {
    const { lows } = extrema;
    if (lows.length < 2) return null;

    for (let i = 0; i < lows.length - 1; i++) {
      const bottom1 = lows[i];
      const bottom2 = lows[i + 1];

      const diff = Math.abs(bottom1.price - bottom2.price) / bottom1.price;
      if (diff > this.PRICE_TOLERANCE) continue;

      if (bottom2.index - bottom1.index < 5) continue;

      const midBars = bars.slice(bottom1.index, bottom2.index);
      const peak = Math.max(...midBars.map((b) => b.high));

      const patternHeight = peak - bottom1.price;
      const target = peak + patternHeight;

      return {
        type: "DOUBLE_BOTTOM",
        confidence: 55,
        startIndex: bottom1.index,
        endIndex: bottom2.index,
        target,
        description: `Double Bottom: $${bottom1.price.toFixed(2)} and $${bottom2.price.toFixed(2)}. Peak at $${peak.toFixed(2)}.`,
      };
    }

    return null;
  }

  /** Detect Triangle patterns (ascending, descending, symmetrical). */
  detectTriangle(bars: OHLCVBar[], extrema: PriceExtrema): DetectedPattern | null {
    const { highs, lows } = extrema;

    // Need at least 3 highs and 3 lows in recent range
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);
    if (recentHighs.length < 3 || recentLows.length < 3) return null;

    // Check for flat top (ascending triangle) or flat bottom (descending)
    const highPrices = recentHighs.map((h) => h.price);
    const lowPrices = recentLows.map((l) => l.price);

    const highRange = Math.max(...highPrices) - Math.min(...highPrices);
    const lowRange = Math.max(...lowPrices) - Math.min(...lowPrices);
    const avgHigh = highPrices.reduce((a, b) => a + b, 0) / highPrices.length;
    const avgLow = lowPrices.reduce((a, b) => a + b, 0) / lowPrices.length;

    const highFlat = highRange / avgHigh < this.PRICE_TOLERANCE;
    const lowFlat = lowRange / avgLow < this.PRICE_TOLERANCE;

    // Ascending triangle: flat top, rising lows
    if (highFlat && lowPrices[0] <= lowPrices[lowPrices.length - 1]) {
      const breakout = avgHigh;
      return {
        type: "ASCENDING_TRIANGLE",
        confidence: 50,
        startIndex: recentLows[0].index,
        endIndex: recentHighs[recentHighs.length - 1].index,
        target: breakout + (breakout - avgLow),
        description: `Ascending Triangle: flat resistance ~$${avgHigh.toFixed(2)}, rising support from $${lowPrices[0].toFixed(2)} to $${lowPrices[lowPrices.length - 1].toFixed(2)}.`,
      };
    }

    // Descending triangle: flat bottom, falling highs
    if (lowFlat && highPrices[0] >= highPrices[highPrices.length - 1]) {
      const breakdown = avgLow;
      const patternHeight = avgHigh - avgLow;
      return {
        type: "DESCENDING_TRIANGLE",
        confidence: 50,
        startIndex: recentHighs[0].index,
        endIndex: recentLows[recentLows.length - 1].index,
        target: breakdown - patternHeight,
        description: `Descending Triangle: falling resistance from $${highPrices[0].toFixed(2)} to $${highPrices[highPrices.length - 1].toFixed(2)}, flat support ~$${avgLow.toFixed(2)}.`,
      };
    }

    // Symmetrical triangle: converging highs and lows
    const highsConverging = highPrices[0] > highPrices[highPrices.length - 1];
    const lowsConverging = lowPrices[0] < lowPrices[lowPrices.length - 1];

    if (highsConverging && lowsConverging) {
      return {
        type: "SYMMETRICAL_TRIANGLE",
        confidence: 40,
        startIndex: recentLows[0].index,
        endIndex: recentHighs[recentHighs.length - 1].index,
        description: `Symmetrical Triangle: converging highs and lows. Breakout direction unclear.`,
      };
    }

    return null;
  }

  /** Detect Flag patterns (bullish/bearish). */
  detectFlag(bars: OHLCVBar[]): DetectedPattern | null {
    if (bars.length < 20) return null;

    // Look for a sharp move (pole) followed by consolidation (flag)
    const poleLength = Math.floor(bars.length / 3);
    const poleBars = bars.slice(0, poleLength);
    const flagBars = bars.slice(poleLength);

    const poleStart = poleBars[0].close;
    const poleEnd = poleBars[poleBars.length - 1].close;
    const poleChange = ((poleEnd - poleStart) / poleStart) * 100;

    // Sharp move threshold
    if (Math.abs(poleChange) < 3) return null;

    // Check consolidation: flag should be a narrow range
    const flagHighs = flagBars.map((b) => b.high);
    const flagLows = flagBars.map((b) => b.low);
    const flagHigh = Math.max(...flagHighs);
    const flagLow = Math.min(...flagLows);
    const flagRange = ((flagHigh - flagLow) / flagLow) * 100;

    // Flag should be narrow (< 5% range)
    if (flagRange > 5) return null;

    if (poleChange > 0) {
      // Bullish flag: sharp up, then slight downward/sideways consolidation
      const flagMid = (flagHigh + flagLow) / 2;
      const target = flagHigh + (poleEnd - poleStart);
      return {
        type: "BULLISH_FLAG",
        confidence: 55,
        startIndex: 0,
        endIndex: bars.length - 1,
        target,
        description: `Bullish Flag: ${poleChange.toFixed(1)}% pole, consolidating in $${flagLow.toFixed(2)}-$${flagHigh.toFixed(2)} range.`,
      };
    } else {
      // Bearish flag: sharp down, then slight upward/sideways consolidation
      const flagMid = (flagHigh + flagLow) / 2;
      const target = flagLow + (poleEnd - poleStart); // continuation downward
      return {
        type: "BEARISH_FLAG",
        confidence: 55,
        startIndex: 0,
        endIndex: bars.length - 1,
        target,
        description: `Bearish Flag: ${Math.abs(poleChange).toFixed(1)}% pole drop, consolidating in $${flagLow.toFixed(2)}-$${flagHigh.toFixed(2)} range.`,
      };
    }
  }

  /** Run all algorithmic pattern detectors and return the best match. */
  detectPatterns(bars: OHLCVBar[]): DetectedPattern[] {
    if (bars.length < this.MIN_BARS) return [];

    const extrema = this.findExtrema(bars);
    const patterns: DetectedPattern[] = [];

    const hns = this.detectHeadAndShoulders(bars, extrema);
    if (hns) patterns.push(hns);

    const ihns = this.detectInverseHeadAndShoulders(bars, extrema);
    if (ihns) patterns.push(ihns);

    const dt = this.detectDoubleTop(bars, extrema);
    if (dt) patterns.push(dt);

    const db = this.detectDoubleBottom(bars, extrema);
    if (db) patterns.push(db);

    const tri = this.detectTriangle(bars, extrema);
    if (tri) patterns.push(tri);

    const flag = this.detectFlag(bars);
    if (flag) patterns.push(flag);

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    return patterns;
  }

  /** Build user prompt for GPT-4o pattern confirmation. */
  protected buildUserPrompt(context: {
    token: string;
    chainId: string;
    currentPrice: number;
    patterns: DetectedPattern[];
    bars: OHLCVBar[];
  }): string {
    const lines: string[] = [
      `Token: ${context.token} (${context.chainId})`,
      `Current Price: $${context.currentPrice}`,
      `Data: ${context.bars.length} OHLCV bars (newest last)`,
      "",
    ];

    if (context.patterns.length === 0) {
      lines.push("No algorithmic patterns detected. Confirm: is price action truly patternless?");
    } else {
      lines.push(`Algorithmically detected ${context.patterns.length} pattern(s):`);
      for (const p of context.patterns) {
        lines.push(`  - ${p.type} (confidence: ${p.confidence}%): ${p.description}`);
        if (p.target) lines.push(`    Target: $${p.target.toFixed(4)}`);
      }
    }

    lines.push("");
    lines.push("Recent price data (last 12 bars):");
    for (const bar of context.bars.slice(-12)) {
      lines.push(
        `  ${new Date(bar.timestamp).toISOString()} | O:${bar.open} H:${bar.high} L:${bar.low} C:${bar.close} V:${bar.volume}`,
      );
    }

    lines.push(
      "",
      "Confirm, reject, or adjust the detected patterns. Rate pattern quality.",
    );

    return lines.join("\n");
  }
}
