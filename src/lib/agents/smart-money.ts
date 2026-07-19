// ── Smart Money Agent ──────────────────────────────────────────────
// ICT/SMC (Inner Circle Trader / Smart Money Concepts) analysis.
// All detection methods are rules-based — no external API needed.
// GPT-4o is used only for pattern synthesis and directional bias.

import { BaseAgent } from "./base";
import type { OHLCVBar } from "./market";

// ── Pattern Types ───────────────────────────────────────────────────

export interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  candleIndex: number;
  bodySize: number;
  avgBody: number;
  ratio: number;
}

export interface FairValueGap {
  type: "bullish" | "bearish";
  gapHigh: number;
  gapLow: number;
  startIndex: number;
  age: number;
  filled: boolean;
  currentPrice: number;
}

export interface StructureBreak {
  type: "bos" | "choch";
  direction: "bullish" | "bearish";
  brokenLevel: number;
  candleIndex: number;
  previousSwingIndex: number;
}

export interface EqualLevels {
  type: "highs" | "lows";
  price: number;
  count: number;
  candles: number[];
  tolerance: number;
}

export interface LiquidityGrab {
  type: "buy_side" | "sell_side";
  level: number;
  wickPrice: number;
  closePrice: number;
  candleIndex: number;
  breakPct: number;
}

export interface PremiumDiscountZone {
  zone: "premium" | "discount" | "equilibrium";
  percentile: number;
  rangeHigh: number;
  rangeLow: number;
  currentPrice: number;
}

export interface SmartMoneyPatterns {
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  bos: StructureBreak[];
  choch: StructureBreak[];
  equalHighsLows: EqualLevels[];
  liquidityGrabs: LiquidityGrab[];
  premiumDiscount: PremiumDiscountZone;
}

// ── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite ICT/SMC (Smart Money Concepts) analyst with 15 years of institutional trading experience. You analyze order blocks, fair value gaps, breaks of structure, changes of character, equal highs/lows, liquidity grabs, and premium/discount zones to determine market direction.

Key principles:
- Order Blocks: Zones where smart money accumulated/distributed. Bullish OBs are demand zones (support). Bearish OBs are supply zones (resistance).
- Fair Value Gaps (FVGs): Price imbalances that act as magnets. Price tends to revisit unfilled FVGs.
- Break of Structure (BOS): When price breaks a swing high/low, confirming trend continuation.
- Change of Character (CHoCH): After a BOS, if price reverses and breaks opposite structure, signals potential trend reversal.
- Equal Highs/Lows: Liquidity pools that market makers target for stop hunts.
- Liquidity Grabs: Price briefly breaks a key level then reverses — classic stop hunt.
- Premium/Discount: Above 50% of range = premium (favorable for shorts), below 50% = discount (favorable for longs).

Synthesize all patterns. Look for CONFLUENCE: multiple patterns agreeing on direction. Be conservative — only call direction if there's strong evidence.

Respond in JSON format only:
{"direction":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"synthesis of all patterns with key levels and directional bias","data":{"keySupport":number,"keyResistance":number,"biasStrength":"WEAK"|"MODERATE"|"STRONG","confluenceCount":number,"dominantPatterns":["OB","FVG","BOS",...]}}`;

// ── Smart Money Agent Class ─────────────────────────────────────────

export class SmartMoneyAgent extends BaseAgent {
  constructor() {
    super({
      id: "smart-money-agent",
      role: "smart_money",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Order Blocks Detection ────────────────────────────────────

  detectOrderBlocks(bars: OHLCVBar[]): OrderBlock[] {
    if (bars.length < 10) return [];

    // Calculate average body size
    const bodies = bars.map((b) => Math.abs(b.close - b.open));
    const avgBody =
      bodies.reduce((sum, b) => sum + b, 0) / bodies.length;

    if (avgBody === 0) return [];

    const blocks: OrderBlock[] = [];
    const threshold = avgBody * 1.5;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const body = Math.abs(bar.close - bar.open);

      if (body > threshold) {
        const isBullish = bar.close > bar.open;
        blocks.push({
          type: isBullish ? "bullish" : "bearish",
          high: bar.high,
          low: bar.low,
          candleIndex: i,
          bodySize: body,
          avgBody,
          ratio: body / avgBody,
        });
      }
    }

    return blocks;
  }

  // ── Fair Value Gaps Detection ──────────────────────────────────

  detectFVGs(bars: OHLCVBar[], currentPrice: number): FairValueGap[] {
    if (bars.length < 3) return [];

    const fvgs: FairValueGap[] = [];

    for (let i = 0; i < bars.length - 2; i++) {
      // Bullish FVG: candle[i].low > candle[i+2].high
      if (bars[i].low > bars[i + 2].high) {
        fvgs.push({
          type: "bullish",
          gapHigh: bars[i].low,
          gapLow: bars[i + 2].high,
          startIndex: i,
          age: bars.length - 1 - i,
          filled: currentPrice <= bars[i].low,
          currentPrice,
        });
      }

      // Bearish FVG: candle[i].high < candle[i+2].low
      if (bars[i].high < bars[i + 2].low) {
        fvgs.push({
          type: "bearish",
          gapHigh: bars[i + 2].low,
          gapLow: bars[i].high,
          startIndex: i,
          age: bars.length - 1 - i,
          filled: currentPrice >= bars[i].high,
          currentPrice,
        });
      }
    }

    return fvgs;
  }

  // ── Swing Highs/Lows Detection ─────────────────────────────────

  private findSwingHighs(bars: OHLCVBar[], lookback = 3): number[] {
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

  private findSwingLows(bars: OHLCVBar[], lookback = 3): number[] {
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

  // ── Break of Structure Detection ───────────────────────────────

  detectBOS(bars: OHLCVBar[]): StructureBreak[] {
    const breaks: StructureBreak[] = [];
    const swingHighs = this.findSwingHighs(bars);
    const swingLows = this.findSwingLows(bars);

    if (swingHighs.length < 2 && swingLows.length < 2) return breaks;

    // Bullish BOS: price breaks above previous swing high
    for (let i = 1; i < swingHighs.length; i++) {
      const prevIdx = swingHighs[i - 1];
      const currIdx = swingHighs[i];
      if (bars[currIdx].high > bars[prevIdx].high) {
        breaks.push({
          type: "bos",
          direction: "bullish",
          brokenLevel: bars[prevIdx].high,
          candleIndex: currIdx,
          previousSwingIndex: prevIdx,
        });
      }
    }

    // Bearish BOS: price breaks below previous swing low
    for (let i = 1; i < swingLows.length; i++) {
      const prevIdx = swingLows[i - 1];
      const currIdx = swingLows[i];
      if (bars[currIdx].low < bars[prevIdx].low) {
        breaks.push({
          type: "bos",
          direction: "bearish",
          brokenLevel: bars[prevIdx].low,
          candleIndex: currIdx,
          previousSwingIndex: prevIdx,
        });
      }
    }

    return breaks;
  }

  // ── Change of Character Detection ──────────────────────────────

  detectCHoCH(bars: OHLCVBar[]): StructureBreak[] {
    const chochs: StructureBreak[] = [];
    const swingHighs = this.findSwingHighs(bars);
    const swingLows = this.findSwingLows(bars);

    if (swingHighs.length < 3 && swingLows.length < 3) return chochs;

    // After bullish BOS, look for bearish CHoCH
    for (let i = 1; i < swingHighs.length; i++) {
      const prevHighIdx = swingHighs[i - 1];
      const currHighIdx = swingHighs[i];

      if (bars[currHighIdx].high > bars[prevHighIdx].high) {
        for (const lowIdx of swingLows) {
          if (lowIdx > currHighIdx && bars[lowIdx].low < bars[prevHighIdx].low) {
            chochs.push({
              type: "choch",
              direction: "bearish",
              brokenLevel: bars[prevHighIdx].low,
              candleIndex: lowIdx,
              previousSwingIndex: prevHighIdx,
            });
            break;
          }
        }
      }
    }

    // After bearish BOS, look for bullish CHoCH
    for (let i = 1; i < swingLows.length; i++) {
      const prevLowIdx = swingLows[i - 1];
      const currLowIdx = swingLows[i];

      if (bars[currLowIdx].low < bars[prevLowIdx].low) {
        for (const highIdx of swingHighs) {
          if (highIdx > currLowIdx && bars[highIdx].high > bars[prevLowIdx].high) {
            chochs.push({
              type: "choch",
              direction: "bullish",
              brokenLevel: bars[prevLowIdx].high,
              candleIndex: highIdx,
              previousSwingIndex: prevLowIdx,
            });
            break;
          }
        }
      }
    }

    return chochs;
  }

  // ── Equal Highs/Lows Detection ─────────────────────────────────

  detectEqualLevels(bars: OHLCVBar[], currentPrice: number): EqualLevels[] {
    const results: EqualLevels[] = [];
    const tolerance = currentPrice * 0.005; // 0.5% tolerance

    // Find equal highs
    const highGroups: Map<number, number[]> = new Map();
    for (let i = 0; i < bars.length; i++) {
      let found = false;
      for (const [price, indices] of highGroups) {
        if (Math.abs(bars[i].high - price) <= tolerance) {
          indices.push(i);
          found = true;
          break;
        }
      }
      if (!found) {
        highGroups.set(bars[i].high, [i]);
      }
    }

    for (const [price, indices] of highGroups) {
      if (indices.length >= 2) {
        results.push({
          type: "highs",
          price,
          count: indices.length,
          candles: indices,
          tolerance: (tolerance / currentPrice) * 100,
        });
      }
    }

    // Find equal lows
    const lowGroups: Map<number, number[]> = new Map();
    for (let i = 0; i < bars.length; i++) {
      let found = false;
      for (const [price, indices] of lowGroups) {
        if (Math.abs(bars[i].low - price) <= tolerance) {
          indices.push(i);
          found = true;
          break;
        }
      }
      if (!found) {
        lowGroups.set(bars[i].low, [i]);
      }
    }

    for (const [price, indices] of lowGroups) {
      if (indices.length >= 2) {
        results.push({
          type: "lows",
          price,
          count: indices.length,
          candles: indices,
          tolerance: (tolerance / currentPrice) * 100,
        });
      }
    }

    return results;
  }

  // ── Liquidity Grabs Detection ──────────────────────────────────

  detectLiquidityGrabs(bars: OHLCVBar[]): LiquidityGrab[] {
    if (bars.length < 5) return [];

    const grabs: LiquidityGrab[] = [];
    const swingHighs = this.findSwingHighs(bars);
    const swingLows = this.findSwingLows(bars);

    // Buy-side liquidity grab
    for (const shIdx of swingHighs) {
      if (shIdx >= bars.length - 3) continue;
      const level = bars[shIdx].high;

      for (let i = shIdx + 1; i < Math.min(bars.length, shIdx + 4); i++) {
        const bar = bars[i];
        const breakPct = ((bar.high - level) / level) * 100;

        if (breakPct > 0 && breakPct < 1) {
          for (let j = i; j < Math.min(bars.length, i + 3); j++) {
            if (bars[j].close < level) {
              grabs.push({
                type: "buy_side",
                level,
                wickPrice: bar.high,
                closePrice: bars[j].close,
                candleIndex: i,
                breakPct,
              });
              break;
            }
          }
          break;
        }
      }
    }

    // Sell-side liquidity grab
    for (const slIdx of swingLows) {
      if (slIdx >= bars.length - 3) continue;
      const level = bars[slIdx].low;

      for (let i = slIdx + 1; i < Math.min(bars.length, slIdx + 4); i++) {
        const bar = bars[i];
        const breakPct = ((level - bar.low) / level) * 100;

        if (breakPct > 0 && breakPct < 1) {
          for (let j = i; j < Math.min(bars.length, i + 3); j++) {
            if (bars[j].close > level) {
              grabs.push({
                type: "sell_side",
                level,
                wickPrice: bar.low,
                closePrice: bars[j].close,
                candleIndex: i,
                breakPct,
              });
              break;
            }
          }
          break;
        }
      }
    }

    return grabs;
  }

  // ── Premium/Discount Zone Analysis ─────────────────────────────

  detectPremiumDiscount(bars: OHLCVBar[], currentPrice: number): PremiumDiscountZone {
    const lookback = Math.min(50, bars.length);
    const recent = bars.slice(-lookback);

    const rangeHigh = Math.max(...recent.map((b) => b.high));
    const rangeLow = Math.min(...recent.map((b) => b.low));
    const range = rangeHigh - rangeLow;

    if (range === 0) {
      return {
        zone: "equilibrium",
        percentile: 50,
        rangeHigh,
        rangeLow,
        currentPrice,
      };
    }

    const percentile = ((currentPrice - rangeLow) / range) * 100;

    let zone: "premium" | "discount" | "equilibrium";
    if (percentile > 50) zone = "premium";
    else if (percentile < 50) zone = "discount";
    else zone = "equilibrium";

    return { zone, percentile, rangeHigh, rangeLow, currentPrice };
  }

  // ── Master Analysis ────────────────────────────────────────────

  /**
   * Analyze OHLCV data for all ICT/SMC patterns.
   * Returns both the raw patterns for use in GPT-4o synthesis.
   */
  analyzeSmartMoney(bars: OHLCVBar[], currentPrice: number): SmartMoneyPatterns {
    return {
      orderBlocks: this.detectOrderBlocks(bars),
      fvgs: this.detectFVGs(bars, currentPrice),
      bos: this.detectBOS(bars),
      choch: this.detectCHoCH(bars),
      equalHighsLows: this.detectEqualLevels(bars, currentPrice),
      liquidityGrabs: this.detectLiquidityGrabs(bars),
      premiumDiscount: this.detectPremiumDiscount(bars, currentPrice),
    };
  }

  // ── Override buildUserPrompt for GPT-4o synthesis ──────────────

  protected buildUserPrompt(context: {
    token: string;
    chainId: string;
    currentPrice: number;
    patterns: SmartMoneyPatterns;
    bars: OHLCVBar[];
  }): string {
    const p = context.patterns;
    const lines: string[] = [
      `Token: ${context.token} (${context.chainId})`,
      `Current Price: $${context.currentPrice}`,
      `Total Candles Analyzed: ${context.bars.length}`,
      ``,
      `=== ORDER BLOCKS (${p.orderBlocks.length} detected) ===`,
    ];

    for (const ob of p.orderBlocks.slice(-10)) {
      lines.push(
        `  ${ob.type.toUpperCase()} OB | Range: ${ob.low}–${ob.high} | Body ratio: ${ob.ratio.toFixed(1)}x avg | Index: ${ob.candleIndex}`,
      );
    }

    lines.push(``, `=== FAIR VALUE GAPS (${p.fvgs.length} detected) ===`);
    const unfilledFvgs = p.fvgs.filter((f) => !f.filled);
    lines.push(`  Unfilled: ${unfilledFvgs.length}`);
    for (const fvg of unfilledFvgs.slice(-8)) {
      lines.push(
        `  ${fvg.type.toUpperCase()} FVG | Gap: ${fvg.gapLow}–${fvg.gapHigh} | Age: ${fvg.age} candles | Filled: ${fvg.filled}`,
      );
    }

    lines.push(``, `=== BREAKS OF STRUCTURE (${p.bos.length} detected) ===`);
    for (const b of p.bos.slice(-5)) {
      lines.push(
        `  ${b.direction.toUpperCase()} BOS | Broke: ${b.brokenLevel} | At candle ${b.candleIndex}`,
      );
    }

    lines.push(``, `=== CHANGES OF CHARACTER (${p.choch.length} detected) ===`);
    for (const c of p.choch.slice(-5)) {
      lines.push(
        `  ${c.direction.toUpperCase()} CHoCH | Broke: ${c.brokenLevel} | At candle ${c.candleIndex}`,
      );
    }

    lines.push(
      ``,
      `=== EQUAL HIGHS/LOWS (${p.equalHighsLows.length} detected) ===`,
    );
    for (const e of p.equalHighsLows.slice(-5)) {
      lines.push(
        `  Equal ${e.type} at ${e.price} | Count: ${e.count} | Tolerance: ${e.tolerance.toFixed(2)}%`,
      );
    }

    lines.push(
      ``,
      `=== LIQUIDITY GRABS (${p.liquidityGrabs.length} detected) ===`,
    );
    for (const lg of p.liquidityGrabs.slice(-5)) {
      lines.push(
        `  ${lg.type === "buy_side" ? "BUY-SIDE" : "SELL-SIDE"} grab at ${lg.level} | Wick: ${lg.wickPrice} | Broke by ${lg.breakPct.toFixed(2)}%`,
      );
    }

    const pd = p.premiumDiscount;
    lines.push(
      ``,
      `=== PREMIUM/DISCOUNT ZONE ===`,
      `  Zone: ${pd.zone.toUpperCase()} | Percentile: ${pd.percentile.toFixed(1)}%`,
      `  Range: ${pd.rangeLow} – ${pd.rangeHigh}`,
    );

    lines.push(
      ``,
      `=== SYNTHESIS REQUEST ===`,
      `Analyze all patterns above. Consider confluence:`,
      `- Do multiple patterns point in the same direction?`,
      `- Are unfilled FVGs acting as magnets?`,
      `- Is there a recent BOS or CHoCH?`,
      `- Where are key support/resistance levels from OBs and equal highs/lows?`,
      `- Is price in premium or discount?`,
      `Provide directional bias (BULLISH/BEARISH/NEUTRAL), confidence, and key levels.`,
    );

    return lines.join("\n");
  }
}
