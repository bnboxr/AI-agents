// ── Probability Agent ─────────────────────────────────────────────
// Level 2 Analysis: Computes Bayesian success probability, confidence intervals,
// Monte Carlo simulations, and validates Kelly fraction from Risk Agent.
// GPT-4o is used only for synthesis and risk-adjustment recommendations.
// All computations are synchronous — no API calls needed for core math.

import { BaseAgent } from "./base";
import type { AgentReport } from "./types";
import type { OHLCVBar } from "./market";
import type { TradeRecord, MarketCondition, ConditionStats } from "./learning";
import type { RiskAssessment } from "./risk";

// ── Types ─────────────────────────────────────────────────────────

export interface ProbabilityResult {
  /** Bayesian posterior probability of success (0-100) */
  bayesianProb: number;
  /** 95% confidence interval [lower, upper] for expected PnL */
  confidenceInterval: { lower: number; upper: number };
  /** Whether confidence interval includes negative (risky) */
  intervalIncludesNegative: boolean;
  /** Monte Carlo simulation: probability of profit after 24h */
  monteCarloProb: number;
  /** Monte Carlo raw result array (1000 simulations) */
  monteCarloResults: number[];
  /** Kelly fraction from risk agent */
  kellyFraction: number;
  /** Whether Kelly fraction exceeds safe threshold (>0.25) */
  kellyOverBet: boolean;
  /** Final probability score (0-100) */
  probability: number;
  /** Direction derived from probability */
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** Number of trades used in computation */
  tradesUsed: number;
  /** The market condition detected for Bayesian prior */
  marketCondition: MarketCondition;
}

// ── Constants ─────────────────────────────────────────────────────

const MC_SIMULATIONS = 1000;
const MC_HORIZON_HOURS = 24;
const MC_STEPS_PER_HOUR = 4; // 15-min steps
const KELLY_SAFE_THRESHOLD = 0.25;

// ── System Prompt ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a quantitative probability analyst at a top-tier hedge fund. Your specialty is Bayesian inference, Monte Carlo simulation, and probabilistic risk assessment.

Given computed probabilities from multiple frameworks (Bayesian, Monte Carlo, confidence intervals, Kelly criterion), you must:

1. Synthesize these into a single risk-adjusted probability score
2. Explain which framework is most reliable given the data
3. Flag any discrepancies between frameworks
4. Recommend whether to trust the probability or reduce exposure

Key principles:
- If Bayesian and Monte Carlo agree → trust the probability
- If they diverge by >20% → reduce confidence and investigate
- If Kelly fraction > 0.25 → flag as over-betting
- If confidence interval includes negative → trade is risky

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"synthesis of probability frameworks","data":{"trustBayesian":true/false,"trustMonteCarlo":true/false,"frameworkAlignment":"high"|"medium"|"low","recommendation":"proceed"|"reduce"|"wait"}}`;

// ── ProbabilityAgent Class ────────────────────────────────────────

export class ProbabilityAgent extends BaseAgent {
  // Trade history feed (populated externally or during report gathering)
  private tradeHistory: TradeRecord[] = [];
  private conditionStats: Map<MarketCondition, ConditionStats> = new Map();

  constructor() {
    super({
      id: "probability-agent",
      role: "probability",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Public: Feed trade history ──────────────────────────────────

  /**
   * Set trade history and condition stats from the Learning Agent.
   * Called by the orchestrator before computeProbability.
   */
  feedTradeData(
    trades: TradeRecord[],
    stats: Map<MarketCondition, ConditionStats>,
  ): void {
    this.tradeHistory = trades;
    this.conditionStats = stats;
  }

  // ── 1. Bayesian Success Probability ─────────────────────────────

  /**
   * Compute P(win | condition) using Bayes' theorem.
   *
   * P(win | condition) = [P(condition | win) * P(win)] / P(condition)
   *
   * Where:
   *   P(condition | win) = (wins in condition) / (total wins)
   *   P(win) = total wins / total trades
   *   P(condition) = trades in condition / total trades
   */
  computeBayesianProbability(condition: MarketCondition): number {
    const stats = this.conditionStats.get(condition);

    if (!stats || stats.totalTrades === 0 || this.tradeHistory.length === 0) {
      // No data → use uninformative prior (50%)
      return 50;
    }

    const totalTrades = this.tradeHistory.length;
    const totalWins = this.tradeHistory.filter((t) => t.pnlPct > 0).length;

    // P(win)
    const pWin = totalWins / totalTrades;

    // P(condition)
    const pCondition = stats.totalTrades / totalTrades;

    // P(condition | win): proportion of winning trades that occurred in this condition
    const winsInCondition = stats.wins;
    const pConditionGivenWin =
      totalWins > 0 ? winsInCondition / totalWins : 0;

    // P(win | condition) = [P(condition | win) * P(win)] / P(condition)
    if (pCondition === 0) return 50;

    const posterior = (pConditionGivenWin * pWin) / pCondition;

    // Clamp and convert to percentage
    return Math.round(Math.min(100, Math.max(0, posterior * 100)) * 100) / 100;
  }

  // ── 2. Confidence Interval (95%) ────────────────────────────────

  /**
   * Compute 95% confidence interval for mean PnL using last N trades.
   * CI = mean ± 1.96 * stdDev / sqrt(N)
   */
  computeConfidenceInterval(n: number = 20): {
    lower: number;
    upper: number;
    includesNegative: boolean;
    mean: number;
    stdDev: number;
  } {
    const trades = this.tradeHistory.slice(-n);

    if (trades.length < 3) {
      return {
        lower: -Infinity,
        upper: Infinity,
        includesNegative: true,
        mean: 0,
        stdDev: 0,
      };
    }

    const pnlValues = trades.map((t) => t.pnlPct);
    const mean = pnlValues.reduce((s, v) => s + v, 0) / pnlValues.length;

    // Sample standard deviation
    const variance =
      pnlValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
      (pnlValues.length - 1);
    const stdDev = Math.sqrt(variance);

    const marginOfError = 1.96 * (stdDev / Math.sqrt(pnlValues.length));
    const lower = mean - marginOfError;
    const upper = mean + marginOfError;

    return {
      lower: Math.round(lower * 100) / 100,
      upper: Math.round(upper * 100) / 100,
      includesNegative: lower < 0,
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
    };
  }

  // ── 3. Monte Carlo Simulation ───────────────────────────────────

  /**
   * Simulate 1000 random walks based on current ATR and trend.
   * Returns probability of profitable outcome after 24h.
   *
   * Simplified model:
   *   mcResult = direction * (trendScore/100) * (1 - volatility/10)
   *
   * Each simulation adds random noise scaled by ATR.
   */
  runMonteCarlo(params: {
    currentPrice: number;
    atr: number;
    trendScore: number;     // 0-100 (from regime agent or price action)
    direction: 1 | -1;      // 1 for LONG, -1 for SHORT
    volatility: number;     // ATR as % of price
    daysBack?: number;      // use historical drift from last N days
    bars?: OHLCVBar[];      // for computing drift
  }): { probabilityOfProfit: number; results: number[] } {
    const {
      currentPrice,
      atr,
      trendScore,
      direction,
      volatility,
    } = params;

    const steps = MC_HORIZON_HOURS * MC_STEPS_PER_HOUR; // 96 steps
    const stepATR = atr / Math.sqrt(365 * 24); // hourly ATR scaled to 15-min
    const results: number[] = [];

    // Compute drift from trend score
    // Stronger trend → more drift bias; higher volatility dampens it
    const driftPerStep =
      direction * (trendScore / 100) * (1 - Math.min(volatility / 10, 0.9)) *
      stepATR *
      0.5;

    for (let sim = 0; sim < MC_SIMULATIONS; sim++) {
      let price = currentPrice;

      for (let step = 0; step < steps; step++) {
        // Random component: normal-ish using Box-Muller on 2 uniform randoms
        const u1 = Math.random();
        const u2 = Math.random();
        const randNormal =
          Math.sqrt(-2 * Math.log(u1 || 0.0001)) *
          Math.cos(2 * Math.PI * u2);

        // Price change: drift + random shock
        const change = driftPerStep + randNormal * stepATR;
        price = price * (1 + change / currentPrice);
      }

      const pnlPct = ((price - currentPrice) / currentPrice) * 100;
      results.push(Math.round(pnlPct * 100) / 100);
    }

    // Count profitable outcomes
    const profitable = results.filter((r) => r > 0).length;
    const probabilityOfProfit =
      Math.round((profitable / MC_SIMULATIONS) * 10000) / 100;

    return { probabilityOfProfit, results };
  }

  // ── 4. Kelly Fraction Check ─────────────────────────────────────

  /**
   * Read Kelly fraction from Risk Agent's assessment and validate.
   * Flags if Kelly fraction > 0.25 (over-betting).
   *
   * The Kelly fraction is computed as:
   *   halfKelly = max(0, kelly * 0.5)  where 0.5 = half-Kelly safety factor
   */
  validateKellyFraction(riskData: RiskAssessment | undefined): {
    kellyFraction: number;
    isOverBet: boolean;
    riskPerTrade: number;
  } {
    if (!riskData) {
      return { kellyFraction: 0, isOverBet: false, riskPerTrade: 0 };
    }

    const riskPerTrade = riskData.riskPerTrade ?? 0;
    // Kelly fraction as percentage of capital risked
    // The risk agent already applies half-Kelly, so we check the riskPerTrade/capital ratio
    // riskPerTrade is already a percentage. We compare to our threshold.
    const kellyFraction = riskPerTrade / 100; // Convert from percent to fraction

    return {
      kellyFraction: Math.round(kellyFraction * 10000) / 10000,
      isOverBet: kellyFraction > KELLY_SAFE_THRESHOLD,
      riskPerTrade,
    };
  }

  // ── 5. Scoring ──────────────────────────────────────────────────

  /**
   * Compute final probability score (0-100) and direction.
   *
   * Weighted combination:
   *   - Bayesian: 40%
   *   - Monte Carlo: 35%
   *   - Kelly penalty: subtract up to 15%
   *   - Confidence Interval penalty: subtract up to 10% if includes negative
   *
   * Direction:
   *   BULLISH if >60%, BEARISH if <40%, NEUTRAL otherwise
   */
  computeFinalScore(result: ProbabilityResult): {
    probability: number;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  } {
    let score = result.bayesianProb * 0.4 + result.monteCarloProb * 0.35;

    // Default prior contribution (30% weight to avoid extreme swings with low data)
    score += 50 * 0.25;

    // Kelly penalty
    if (result.kellyOverBet) {
      score -= 15;
    }

    // Confidence interval penalty
    if (result.intervalIncludesNegative) {
      score -= 10;
    }

    // If no trade data, default to 50
    if (result.tradesUsed === 0) {
      score = 50;
    }

    // Clamp
    score = Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;

    let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    if (score > 60) direction = "BULLISH";
    else if (score < 40) direction = "BEARISH";
    else direction = "NEUTRAL";

    return { probability: score, direction };
  }

  // ── Main: Compute full probability analysis ─────────────────────

  /**
   * Run the complete probability pipeline (synchronous, no API call).
   */
  computeProbability(params: {
    currentPrice: number;
    atr: number;
    trendScore: number;
    direction: "LONG" | "SHORT" | "NEUTRAL";
    marketCondition: MarketCondition;
    riskData?: RiskAssessment;
    bars?: OHLCVBar[];
  }): ProbabilityResult {
    const {
      currentPrice,
      atr,
      trendScore,
      direction,
      marketCondition,
      riskData,
      bars,
    } = params;

    // 1. Bayesian
    const bayesianProb = this.computeBayesianProbability(marketCondition);

    // 2. Confidence Interval
    const ci = this.computeConfidenceInterval(20);

    // 3. Monte Carlo
    const mcDirection = direction === "SHORT" ? -1 : 1;
    const volatility = currentPrice > 0 ? (atr / currentPrice) * 100 : 2;
    const mc = this.runMonteCarlo({
      currentPrice,
      atr,
      trendScore,
      direction: mcDirection as 1 | -1,
      volatility,
      bars,
    });

    // 4. Kelly validation
    const kelly = this.validateKellyFraction(riskData);

    // 5. Final score
    const result: ProbabilityResult = {
      bayesianProb,
      confidenceInterval: { lower: ci.lower, upper: ci.upper },
      intervalIncludesNegative: ci.includesNegative,
      monteCarloProb: mc.probabilityOfProfit,
      monteCarloResults: mc.results,
      kellyFraction: kelly.kellyFraction,
      kellyOverBet: kelly.isOverBet,
      probability: 0, // filled below
      direction: "NEUTRAL", // filled below
      tradesUsed: this.tradeHistory.length,
      marketCondition,
    };

    const final = this.computeFinalScore(result);
    result.probability = final.probability;
    result.direction = final.direction;

    return result;
  }

  // ── GPT-4o Synthesis ────────────────────────────────────────────

  /**
   * Build user prompt for GPT-4o probability synthesis.
   */
  protected buildUserPrompt(result: ProbabilityResult): string {
    const lines: string[] = [
      `=== Probability Analysis Results ===`,
      ``,
      `Bayesian Success Probability: ${result.bayesianProb}%`,
      `  Condition: ${result.marketCondition}`,
      `  Trades in condition: ${this.conditionStats.get(result.marketCondition)?.totalTrades ?? 0}`,
      ``,
      `95% Confidence Interval: [${result.confidenceInterval.lower}, ${result.confidenceInterval.upper}]`,
      `  Includes negative: ${result.intervalIncludesNegative ? "YES ⚠️" : "NO ✓"}`,
      ``,
      `Monte Carlo Simulation (${MC_SIMULATIONS} runs, ${MC_HORIZON_HOURS}h horizon):`,
      `  Probability of profit: ${result.monteCarloProb}%`,
      ``,
      `Kelly Fraction: ${result.kellyFraction}`,
      `  Over-betting: ${result.kellyOverBet ? "YES ⚠️" : "NO ✓"}`,
      ``,
      `Final Computed Probability: ${result.probability}%`,
      `Direction: ${result.direction}`,
      ``,
      `Bayesian prob: ${result.bayesianProb}%, Monte Carlo: ${result.monteCarloProb}% chance of profit, Kelly: ${result.kellyFraction}. Risk-adjusted probability?`,
    ];
    return lines.join("\n");
  }

  /**
   * Synthesize probability analysis with GPT-4o.
   * Falls back to computed score if LLM unavailable.
   */
  async synthesize(result: ProbabilityResult): Promise<AgentReport> {
    const report = await this.analyzeMarket(result);

    // Enrich report data with computed probabilities
    report.data = {
      ...report.data,
      bayesianProbability: result.bayesianProb,
      monteCarloProbability: result.monteCarloProb,
      confidenceIntervalLower: result.confidenceInterval.lower,
      confidenceIntervalUpper: result.confidenceInterval.upper,
      intervalIncludesNegative: result.intervalIncludesNegative,
      kellyFraction: result.kellyFraction,
      kellyOverBet: result.kellyOverBet,
      computedProbability: result.probability,
      computedDirection: result.direction,
      marketCondition: result.marketCondition,
      tradesUsed: result.tradesUsed,
    };

    return report;
  }

  /**
   * Override analyzeMarket so it accepts ProbabilityResult directly.
   */
  async analyzeMarket(context: ProbabilityResult): Promise<AgentReport> {
    return super.analyzeMarket(context);
  }
}
