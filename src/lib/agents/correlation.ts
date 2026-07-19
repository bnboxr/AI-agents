// ── Correlation Agent ──────────────────────────────────────────────
// Real-time cross-asset correlation computation with breakdown detection.
// Replaces hardcoded correlations in macro.ts with live Pearson ρ.
//
// Data: Yahoo Finance v8 for 90d history; Binance WS for incremental updates.
// Pure TypeScript — no new dependencies.

import { BaseAgent } from "./base";
import type { AgentReport } from "./types";
import { getPrice } from "../ws/price-context";

// ── Types ──────────────────────────────────────────────────────────

export interface PricePoint {
  timestamp: number;
  close: number;
}

export interface CorrelationPairData {
  pair: string; // e.g. "BTC-ETH", "BTC-QQQ"
  symbolA: string;
  symbolB: string;
  baseline: number; // 90d Pearson ρ
  short: number; // 7d Pearson ρ
  windows: {
    "1h": number;
    "4h": number;
    "24h": number;
    "7d": number;
  };
  delta: number; // short - baseline
  breakdown: "NORMAL" | "REDUCE_25" | "REDUCE_50" | "HALT";
  signFlipped: boolean;
  expectedRange: { min: number; max: number };
}

export interface CorrelationMatrix {
  pairs: CorrelationPairData[];
  divergenceScore: number; // 0-100
  riskLevel: "NORMAL" | "REDUCE_25" | "REDUCE_50" | "PROBE_ONLY" | "HALT";
  positionMultiplier: number;
  timestamp: number;
  dataAvailable: boolean;
}

// ── Pair Definitions ───────────────────────────────────────────────

interface PairDef {
  pair: string;
  symbolA: string;
  symbolB: string;
  yahooA: string; // Yahoo Finance symbol
  yahooB: string;
  expectedMin: number;
  expectedMax: number;
  weight: number;
}

const PAIR_DEFS: PairDef[] = [
  {
    pair: "BTC-ETH",
    symbolA: "BTC",
    symbolB: "ETH",
    yahooA: "BTC-USD",
    yahooB: "ETH-USD",
    expectedMin: 0.75,
    expectedMax: 0.9,
    weight: 0.1,
  },
  {
    pair: "BTC-QQQ",
    symbolA: "BTC",
    symbolB: "QQQ",
    yahooA: "BTC-USD",
    yahooB: "QQQ",
    expectedMin: 0.45,
    expectedMax: 0.65,
    weight: 0.25,
  },
  {
    pair: "BTC-SPX",
    symbolA: "BTC",
    symbolB: "SPX",
    yahooA: "BTC-USD",
    yahooB: "SPY",
    expectedMin: 0.35,
    expectedMax: 0.55,
    weight: 0.2,
  },
  {
    pair: "BTC-GOLD",
    symbolA: "BTC",
    symbolB: "GOLD",
    yahooA: "BTC-USD",
    yahooB: "GLD",
    expectedMin: -0.15,
    expectedMax: 0.25,
    weight: 0.15,
  },
  {
    pair: "DXY-CRYPTO",
    symbolA: "DXY",
    symbolB: "BTC",
    yahooA: "UUP", // DXY proxy ETF
    yahooB: "BTC-USD",
    expectedMin: -0.65,
    expectedMax: -0.4,
    weight: 0.3,
  },
];

// Collect unique Yahoo symbols to fetch
const ALL_YAHOO_SYMBOLS = [
  ...new Set(PAIR_DEFS.flatMap((p) => [p.yahooA, p.yahooB])),
];

// ── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a cross-asset correlation analyst. Your job is to detect regime changes and systemic risk by analyzing real-time correlation breakdowns between crypto and traditional assets.

Key relationships:
- BTC ↔ ETH: normally 0.75-0.90 correlation. Divergence below 0.60 signals a crypto-specific event.
- BTC ↔ QQQ (Nasdaq): normally 0.45-0.65. Above 0.70 means macro-dominated; breakdown means divergence.
- BTC ↔ SPX (S&P 500): normally 0.35-0.55. Clean macro risk-on/risk-off proxy.
- BTC ↔ Gold: normally -0.15 to +0.25 (near zero). "Digital gold" narrative unproven.
- DXY ↔ Crypto: normally -0.40 to -0.65. THE strongest macro signal. DXY up → crypto down.

Analyze the provided correlation matrix and answer:
1. Any correlation breakdowns? Which pairs are diverging from their long-term baselines?
2. Is this indicating systemic risk (all correlations breaking down together) or a crypto-specific event (only crypto pairs affected)?
3. What is the appropriate risk adjustment?

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"concise correlation analysis","data":{"riskLevel":"NORMAL"|"REDUCE_25"|"REDUCE_50"|"PROBE_ONLY"|"HALT","systemicRisk":true|false,"cryptoSpecific":true|false,"divergenceScore":0-100,"breakdownCount":0,"worstPair":""}}`;

// ── Circular Buffer ────────────────────────────────────────────────

const MAX_HISTORY = 2200; // 90 days at 1h ≈ 2160 bars, with buffer

// ── Math Helpers ───────────────────────────────────────────────────

/** Compute Pearson correlation coefficient between two equal-length arrays. */
export function pearsonR(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (den === 0 || !isFinite(den)) return 0;
  const r = num / den;
  return isFinite(r) ? r : 0;
}

/** Compute log returns from an array of prices (most recent last). */
export function logReturns(prices: number[]): number[] {
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      rets.push(Math.log(prices[i] / prices[i - 1]));
    } else {
      rets.push(0);
    }
  }
  return rets;
}

/** Align two price series by timestamp, returning matched close prices. */
function alignByTimestamp(
  a: PricePoint[],
  b: PricePoint[],
): { pricesA: number[]; pricesB: number[] } {
  const mapB = new Map<number, number>();
  for (const p of b) {
    // Round to nearest hour for alignment
    const key = Math.round(p.timestamp / 3600) * 3600;
    mapB.set(key, p.close);
  }

  const pricesA: number[] = [];
  const pricesB: number[] = [];

  for (const p of a) {
    const key = Math.round(p.timestamp / 3600) * 3600;
    const match = mapB.get(key);
    if (match !== undefined && match > 0 && p.close > 0) {
      pricesA.push(p.close);
      pricesB.push(match);
    }
  }

  return { pricesA, pricesB };
}

// ── CorrelationAgent ───────────────────────────────────────────────

export class CorrelationAgent extends BaseAgent {
  private priceCache: Map<string, PricePoint[]> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private lastMatrix: CorrelationMatrix | null = null;
  private lastComputeTime = 0;
  private readonly COMPUTE_TTL_MS = 60_000; // Recompute at most every 60s
  private wsUnsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: "correlation-agent",
      role: "correlation",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Initialization ──────────────────────────────────────────────

  /** Fetch 90d of 1h data from Yahoo Finance for all symbols. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    console.log("[CorrelationAgent] Initializing — fetching 90d history...");

    // Fetch all symbols in parallel
    const results = await Promise.allSettled(
      ALL_YAHOO_SYMBOLS.map((sym) => this.fetchYahooHistory(sym)),
    );

    let fetched = 0;
    for (let i = 0; i < ALL_YAHOO_SYMBOLS.length; i++) {
      const sym = ALL_YAHOO_SYMBOLS[i];
      const result = results[i];
      if (result.status === "fulfilled" && result.value.length > 0) {
        this.priceCache.set(sym, result.value);
        fetched++;
      } else {
        console.warn(
          `[CorrelationAgent] Failed to fetch ${sym}: ${result.status === "rejected" ? result.reason : "empty data"}`,
        );
        this.priceCache.set(sym, []);
      }
    }

    // Subscribe to Binance WS for BTC and ETH incremental updates
    try {
      const { subscribeToPrices } = await import("../ws/price-context");
      this.wsUnsubscribe = subscribeToPrices((tick) => {
        if (tick.symbol === "BTC") {
          this.updatePrice("BTC-USD", tick.price, tick.timestamp);
        } else if (tick.symbol === "ETH") {
          this.updatePrice("ETH-USD", tick.price, tick.timestamp);
        }
      });
    } catch (err) {
      console.warn("[CorrelationAgent] Could not subscribe to Binance WS:", err);
    }

    this.initialized = true;
    console.log(
      `[CorrelationAgent] Initialized — ${fetched}/${ALL_YAHOO_SYMBOLS.length} symbols loaded`,
    );

    // Compute initial matrix
    this.computeMatrix();
  }

  // ── Yahoo Finance Fetch ─────────────────────────────────────────

  private async fetchYahooHistory(symbol: string): Promise<PricePoint[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1h&range=90d`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: {
              quote?: Array<{
                close?: (number | null)[];
              }>;
            };
          }>;
        };
      };

      const result = data.chart?.result?.[0];
      if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) {
        throw new Error("No data in response");
      }

      const timestamps = result.timestamp;
      const closes = result.indicators.quote[0].close;

      const points: PricePoint[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c !== null && c > 0 && isFinite(c)) {
          points.push({ timestamp: timestamps[i], close: c });
        }
      }

      return points;
    } catch (err) {
      throw err;
    }
  }

  // ── Incremental Update from Binance WS ──────────────────────────

  /** Update the price cache incrementally. Called by Binance WS subscription. */
  updatePrice(yahooSymbol: string, price: number, timestamp: number): void {
    const cache = this.priceCache.get(yahooSymbol);
    if (!cache) return;

    const point: PricePoint = { timestamp, close: price };

    // Avoid duplicate timestamps within 30 seconds
    const last = cache[cache.length - 1];
    if (last && Math.abs(last.timestamp - timestamp) < 30) {
      // Update the last entry rather than adding a duplicate
      cache[cache.length - 1] = point;
      return;
    }

    cache.push(point);

    // Circular buffer: trim oldest
    while (cache.length > MAX_HISTORY) {
      cache.shift();
    }
  }

  /** Manually append a price point (for ETFs updated via periodic polling). */
  appendPrice(symbol: string, price: number, timestamp: number): void {
    let cache = this.priceCache.get(symbol);
    if (!cache) {
      cache = [];
      this.priceCache.set(symbol, cache);
    }

    const last = cache[cache.length - 1];
    if (last && Math.abs(last.timestamp - timestamp) < 30) {
      cache[cache.length - 1] = { timestamp, close: price };
      return;
    }

    cache.push({ timestamp, close: price });
    while (cache.length > MAX_HISTORY) {
      cache.shift();
    }
  }

  // ── Correlation Computation ─────────────────────────────────────

  /**
   * Compute the full correlation matrix synchronously.
   * Returns cached result if within TTL.
   */
  getMatrix(): CorrelationMatrix {
    const now = Date.now();
    if (
      this.lastMatrix &&
      now - this.lastComputeTime < this.COMPUTE_TTL_MS
    ) {
      return this.lastMatrix;
    }
    return this.computeMatrix();
  }

  private computeMatrix(): CorrelationMatrix {
    const now = Date.now();
    const pairs: CorrelationPairData[] = [];
    let hasData = false;

    for (const def of PAIR_DEFS) {
      const dataA = this.priceCache.get(def.yahooA);
      const dataB = this.priceCache.get(def.yahooB);

      if (!dataA || !dataB || dataA.length < 10 || dataB.length < 10) {
        // Insufficient data — use expected midpoint as fallback
        const fallbackRho = (def.expectedMin + def.expectedMax) / 2;
        pairs.push({
          pair: def.pair,
          symbolA: def.symbolA,
          symbolB: def.symbolB,
          baseline: fallbackRho,
          short: fallbackRho,
          windows: { "1h": fallbackRho, "4h": fallbackRho, "24h": fallbackRho, "7d": fallbackRho },
          delta: 0,
          breakdown: "NORMAL",
          signFlipped: false,
          expectedRange: { min: def.expectedMin, max: def.expectedMax },
        });
        continue;
      }

      hasData = true;

      // Align by timestamp to get matched close prices
      const { pricesA, pricesB } = alignByTimestamp(dataA, dataB);

      if (pricesA.length < 5) {
        const fallbackRho = (def.expectedMin + def.expectedMax) / 2;
        pairs.push({
          pair: def.pair,
          symbolA: def.symbolA,
          symbolB: def.symbolB,
          baseline: fallbackRho,
          short: fallbackRho,
          windows: { "1h": fallbackRho, "4h": fallbackRho, "24h": fallbackRho, "7d": fallbackRho },
          delta: 0,
          breakdown: "NORMAL",
          signFlipped: false,
          expectedRange: { min: def.expectedMin, max: def.expectedMax },
        });
        continue;
      }

      // Compute log returns for the full series
      const returnsA = logReturns(pricesA);
      const returnsB = logReturns(pricesB);

      // Baseline: use all available data
      const baseline = pearsonR(returnsA, returnsB);

      // Windowed correlations (approximate bar counts: 1h ≈ 1 bar, 4h ≈ 4 bars, 24h ≈ 24 bars, 7d ≈ 168 bars)
      // Take most recent N returns for each window
      const windowSizes: Record<string, number> = {
        "1h": Math.min(1, returnsA.length),
        "4h": Math.min(4, returnsA.length),
        "24h": Math.min(24, returnsA.length),
        "7d": Math.min(168, returnsA.length),
      };

      const windows: CorrelationPairData["windows"] = {
        "1h": 0,
        "4h": 0,
        "24h": 0,
        "7d": 0,
      };

      for (const [key, size] of Object.entries(windowSizes)) {
        const sliceA = returnsA.slice(-size);
        const sliceB = returnsB.slice(-size);
        windows[key as keyof typeof windows] =
          sliceA.length >= 2 ? pearsonR(sliceA, sliceB) : baseline;
      }

      const short = windows["7d"];
      const delta = short - baseline;
      const signFlipped =
        (baseline > 0 && short < 0) || (baseline < 0 && short > 0);

      // Breakdown detection
      let breakdown: CorrelationPairData["breakdown"] = "NORMAL";
      if (signFlipped) {
        breakdown = "HALT";
      } else if (Math.abs(delta) >= 0.3) {
        breakdown = "REDUCE_50";
      } else if (Math.abs(delta) >= 0.15) {
        breakdown = "REDUCE_25";
      }

      pairs.push({
        pair: def.pair,
        symbolA: def.symbolA,
        symbolB: def.symbolB,
        baseline: Math.round(baseline * 10000) / 10000,
        short: Math.round(short * 10000) / 10000,
        windows: {
          "1h": Math.round(windows["1h"] * 10000) / 10000,
          "4h": Math.round(windows["4h"] * 10000) / 10000,
          "24h": Math.round(windows["24h"] * 10000) / 10000,
          "7d": Math.round(windows["7d"] * 10000) / 10000,
        },
        delta: Math.round(delta * 10000) / 10000,
        breakdown,
        signFlipped,
        expectedRange: { min: def.expectedMin, max: def.expectedMax },
      });
    }

    // Divergence score: weighted sum of |delta| normalized to 0-100
    let divergenceScore = 0;
    let totalWeight = 0;
    for (let i = 0; i < pairs.length; i++) {
      const def = PAIR_DEFS[i];
      const pair = pairs[i];
      // Normalize |delta| to 0-100: |delta| of 0.5 → ~100
      const normalizedDelta = Math.min(100, (Math.abs(pair.delta) / 0.5) * 100);
      divergenceScore += normalizedDelta * def.weight;
      totalWeight += def.weight;
    }
    if (totalWeight > 0) {
      divergenceScore = Math.round((divergenceScore / totalWeight) * 100) / 100;
    }

    // Overall risk level
    let riskLevel: CorrelationMatrix["riskLevel"] = "NORMAL";
    const hasHalt = pairs.some((p) => p.breakdown === "HALT");
    const hasReduce50 = pairs.some((p) => p.breakdown === "REDUCE_50");
    const hasReduce25 = pairs.some((p) => p.breakdown === "REDUCE_25");

    if (hasHalt) riskLevel = "HALT";
    else if (hasReduce50) riskLevel = "REDUCE_50";
    else if (hasReduce25) riskLevel = "REDUCE_25";
    else if (divergenceScore > 30) riskLevel = "PROBE_ONLY";

    // Position multiplier: 1.0 at score ≤ 15, 0.0 at score > 75
    let positionMultiplier = 1.0;
    if (divergenceScore <= 15) {
      positionMultiplier = 1.0;
    } else if (divergenceScore >= 75) {
      positionMultiplier = 0.0;
    } else {
      positionMultiplier =
        Math.round((1.0 - (divergenceScore - 15) / 60) * 10000) / 10000;
    }

    // Risk level can override
    if (riskLevel === "HALT") positionMultiplier = 0;
    else if (riskLevel === "REDUCE_50") positionMultiplier = Math.min(positionMultiplier, 0.5);
    else if (riskLevel === "REDUCE_25") positionMultiplier = Math.min(positionMultiplier, 0.75);

    this.lastMatrix = {
      pairs,
      divergenceScore,
      riskLevel,
      positionMultiplier,
      timestamp: now,
      dataAvailable: hasData,
    };
    this.lastComputeTime = now;

    return this.lastMatrix;
  }

  // ── GPT-4o Synthesis ────────────────────────────────────────────

  protected buildUserPrompt(context: { matrix: CorrelationMatrix }): string {
    const m = context.matrix;
    const lines: string[] = [
      `Correlation Matrix (${new Date(m.timestamp).toISOString()}):`,
      `Divergence Score: ${m.divergenceScore}/100 | Risk Level: ${m.riskLevel} | Position Multiplier: ${m.positionMultiplier}`,
      `Data Available: ${m.dataAvailable ? "YES" : "NO (using expected midpoints)"}`,
      "",
    ];

    for (const p of m.pairs) {
      lines.push(
        `${p.pair} (${p.symbolA} ↔ ${p.symbolB}):`,
        `  Baseline: ${p.baseline.toFixed(3)} | 7d: ${p.short.toFixed(3)} | Δ: ${p.delta.toFixed(3)}`,
        `  Windows: 1h=${p.windows["1h"].toFixed(3)} 4h=${p.windows["4h"].toFixed(3)} 24h=${p.windows["24h"].toFixed(3)}`,
        `  Expected Range: [${p.expectedRange.min}, ${p.expectedRange.max}]`,
        `  Breakdown: ${p.breakdown}${p.signFlipped ? " ⚠ SIGN FLIP" : ""}`,
        "",
      );
    }

    lines.push("Analyze the matrix above for breakdowns, systemic risk, and crypto-specific events.");

    return lines.join("\n");
  }

  /** Override analyzeMarket to use correlation matrix as context. */
  async analyzeMarket(context?: any): Promise<AgentReport> {
    const matrix = context?.matrix ?? this.getMatrix();

    // If no data available, return fallback
    if (!matrix.dataAvailable) {
      return this.fallbackReport(
        "Correlation data not yet available. Yahoo Finance fetch may have failed. Using expected midpoints.",
      );
    }

    // If no breakdowns, skip LLM call — return fast
    if (matrix.riskLevel === "NORMAL" && matrix.divergenceScore <= 15) {
      return {
        agentId: this.id,
        role: this.role,
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: 95,
        reasoning: `All correlations within normal ranges. Divergence score: ${matrix.divergenceScore}. No breakdowns detected.`,
        data: {
          matrix,
          riskLevel: matrix.riskLevel,
          divergenceScore: matrix.divergenceScore,
          positionMultiplier: matrix.positionMultiplier,
          systemicRisk: false,
          cryptoSpecific: false,
          breakdownCount: 0,
        },
      };
    }

    return super.analyzeMarket({ matrix });
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: CorrelationAgent | null = null;

export function getCorrelationAgent(): CorrelationAgent {
  if (!_instance) {
    _instance = new CorrelationAgent();
  }
  return _instance;
}
