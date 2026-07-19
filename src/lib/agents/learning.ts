// ── Learning Agent ────────────────────────────────────────────────
// Tracks performance across market conditions and recommends parameter adjustments.
import { BaseAgent } from "./base";
import type { AgentReport, OrchestratorDecision } from "./types";

export type MarketCondition = "trending_up" | "trending_down" | "sideways" | "volatile";

export interface TradeRecord {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  marketCondition: MarketCondition;
  confidence: number;
  timestamp: number;
}

export interface ConditionStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  totalPnl: number;
}

export interface LearningAdjustments {
  positionSizeAdjustment: number; // e.g. -0.25 means reduce 25%
  stopLossAdjustment: number;     // e.g. 0.20 means widen 20%
  takeProfitAdjustment: number;
  recommendedMaxConfidence: number;
  avoidConditions: MarketCondition[];
  summary: string;
}

const SYSTEM_PROMPT = `You are a quantitative performance analyst with expertise in trading system optimization. Your job is to analyze trading performance data and recommend parameter adjustments to improve profitability.

Analyze the provided performance statistics across market conditions and determine:
- Position sizing adjustments (reduce when win rate is poor, increase when consistent)
- Stop loss adjustments (widen in volatile conditions, tighten when losing)
- Which market conditions to avoid entirely
- Overall confidence in the current strategy

Key optimization rules:
- Win rate < 40% → reduce position size, widen stops
- Win rate > 65% → can increase position slightly
- High volatility regime → tighten stops to protect capital
- Sideways markets → reduce exposure, avoid large positions
- After 3+ consecutive losses in a condition → avoid that condition temporarily

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"performance analysis summary","data":{"positionSizeAdjustment":number,"stopLossAdjustment":number,"takeProfitAdjustment":number,"recommendedMaxConfidence":number,"avoidConditions":["condition1"],"summary":"detailed analysis"}}`;

export class LearningAgent extends BaseAgent {
  private trades: TradeRecord[] = [];
  private readonly MAX_TRADES = 500;
  private tradeIdCounter = 0;

  // Per-condition stats cache
  private conditionStats: Map<MarketCondition, ConditionStats> = new Map();

  constructor() {
    super({
      id: "learning-agent",
      role: "learning",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /** Record a completed trade and update performance stats. */
  recordTrade(trade: Omit<TradeRecord, "id">): TradeRecord {
    const record: TradeRecord = {
      id: `trade-${++this.tradeIdCounter}-${Date.now()}`,
      ...trade,
    };

    this.trades.push(record);

    // Enforce max trades cap
    if (this.trades.length > this.MAX_TRADES) {
      this.trades = this.trades.slice(-this.MAX_TRADES);
    }

    // Update condition stats
    this.updateConditionStats(record);

    return record;
  }

  /** Update in-memory stats for a given market condition. */
  private updateConditionStats(trade: TradeRecord): void {
    const existing = this.conditionStats.get(trade.marketCondition) ?? {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      totalPnl: 0,
    };

    existing.totalTrades++;
    if (trade.pnlPct > 0) {
      existing.wins++;
      existing.totalPnl += trade.pnlPct;
    } else {
      existing.losses++;
      existing.totalPnl += trade.pnlPct;
    }

    // Recalculate win rate
    existing.winRate =
      existing.totalTrades > 0
        ? Math.round((existing.wins / existing.totalTrades) * 10000) / 100
        : 0;

    // Recalculate average win/loss from all trades in this condition
    const conditionTrades = this.trades.filter(
      (t) => t.marketCondition === trade.marketCondition,
    );
    const wins = conditionTrades.filter((t) => t.pnlPct > 0);
    const losses = conditionTrades.filter((t) => t.pnlPct < 0);

    existing.avgWin =
      wins.length > 0
        ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length
        : 0;
    existing.avgLoss =
      losses.length > 0
        ? losses.reduce((s, t) => s + Math.abs(t.pnlPct), 0) / losses.length
        : 0;

    this.conditionStats.set(trade.marketCondition, existing);
  }

  /** Get stats for a specific market condition. */
  getConditionStats(condition: MarketCondition): ConditionStats {
    return (
      this.conditionStats.get(condition) ?? {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        totalPnl: 0,
      }
    );
  }

  /** Get overall win rate across all conditions. */
  getOverallWinRate(): number {
    if (this.trades.length === 0) return 50;
    const wins = this.trades.filter((t) => t.pnlPct > 0).length;
    return Math.round((wins / this.trades.length) * 10000) / 100;
  }

  /** Get overall average PnL. */
  getOverallAvgPnl(): number {
    if (this.trades.length === 0) return 0;
    const total = this.trades.reduce((s, t) => s + t.pnlPct, 0);
    return Math.round((total / this.trades.length) * 100) / 100;
  }

  /**
   * Rules-based recommended adjustments.
   * Returns parameter tweaks based on win rate and market conditions.
   */
  getRecommendedAdjustments(): LearningAdjustments {
    const overallWinRate = this.getOverallWinRate();
    let positionSizeAdjustment = 0;
    let stopLossAdjustment = 0;
    let takeProfitAdjustment = 0;
    let recommendedMaxConfidence = 85;
    const avoidConditions: MarketCondition[] = [];

    // Win rate < 40% → reduce position 25%, widen stop 20%
    if (overallWinRate < 40) {
      positionSizeAdjustment = -0.25;
      stopLossAdjustment = 0.2; // widen
      recommendedMaxConfidence = 60;
    }
    // Win rate > 65% → can increase position 10%
    else if (overallWinRate > 65) {
      positionSizeAdjustment = 0.1;
      recommendedMaxConfidence = 90;
    }

    // Check per-condition: high volatility → tighten stops 15%
    const volatileStats = this.getConditionStats("volatile");
    if (volatileStats.totalTrades >= 3) {
      if (volatileStats.winRate < 40) {
        stopLossAdjustment = Math.min(stopLossAdjustment - 0.15, -0.15); // tighten
        avoidConditions.push("volatile");
      }
    }

    // Sideways: if losing, avoid
    const sidewaysStats = this.getConditionStats("sideways");
    if (sidewaysStats.totalTrades >= 3 && sidewaysStats.winRate < 45) {
      avoidConditions.push("sideways");
      if (positionSizeAdjustment === 0) positionSizeAdjustment = -0.1;
    }

    // Trending down: if losing more than average, avoid
    const downStats = this.getConditionStats("trending_down");
    if (downStats.totalTrades >= 3 && downStats.winRate < 35) {
      avoidConditions.push("trending_down");
    }

    const summary = this.buildAdjustmentSummary(
      overallWinRate,
      positionSizeAdjustment,
      stopLossAdjustment,
      avoidConditions,
    );

    return {
      positionSizeAdjustment,
      stopLossAdjustment,
      takeProfitAdjustment,
      recommendedMaxConfidence,
      avoidConditions,
      summary,
    };
  }

  /** Build a human-readable summary of adjustments. */
  private buildAdjustmentSummary(
    winRate: number,
    posAdj: number,
    slAdj: number,
    avoid: MarketCondition[],
  ): string {
    const parts: string[] = [];
    parts.push(`Overall win rate: ${winRate}% over ${this.trades.length} trades.`);

    if (posAdj !== 0) {
      parts.push(
        posAdj > 0
          ? `Increase position size by ${Math.round(posAdj * 100)}%.`
          : `Reduce position size by ${Math.round(Math.abs(posAdj) * 100)}%.`,
      );
    }

    if (slAdj !== 0) {
      parts.push(
        slAdj > 0
          ? `Widen stop loss by ${Math.round(slAdj * 100)}%.`
          : `Tighten stop loss by ${Math.round(Math.abs(slAdj) * 100)}%.`,
      );
    }

    if (avoid.length > 0) {
      parts.push(`Avoid trading in: ${avoid.join(", ")}.`);
    }

    if (parts.length === 1) {
      parts.push("No adjustments needed — performance is within acceptable range.");
    }

    return parts.join(" ");
  }

  /** Build user prompt for GPT-4o performance analysis. */
  protected buildUserPrompt(context?: {
    includeDetails?: boolean;
  }): string {
    const overallWinRate = this.getOverallWinRate();
    const overallAvgPnl = this.getOverallAvgPnl();

    const lines: string[] = [
      `=== Performance Summary ===`,
      `Total trades recorded: ${this.trades.length}`,
      `Overall win rate: ${overallWinRate}%`,
      `Overall average PnL: ${overallAvgPnl}%`,
      ``,
      `=== Condition Breakdown ===`,
    ];

    const conditions: MarketCondition[] = [
      "trending_up",
      "trending_down",
      "sideways",
      "volatile",
    ];

    for (const cond of conditions) {
      const stats = this.getConditionStats(cond);
      lines.push(`${cond}:`);
      lines.push(`  Trades: ${stats.totalTrades}, Win Rate: ${stats.winRate}%`);
      lines.push(
        `  Avg Win: ${stats.avgWin.toFixed(2)}%, Avg Loss: ${stats.avgLoss.toFixed(2)}%`,
      );
      lines.push(`  Total PnL: ${stats.totalPnl.toFixed(2)}%`);
      lines.push("");
    }

    lines.push("=== Recent Trades (last 10) ===");
    for (const t of this.trades.slice(-10)) {
      lines.push(
        `  ${t.direction} ${t.symbol} | Condition: ${t.marketCondition} | PnL: ${t.pnlPct > 0 ? "+" : ""}${t.pnlPct.toFixed(2)}% | Confidence: ${t.confidence}%`,
      );
    }

    lines.push("");
    lines.push(
      "Based on this performance data, what improvements do you recommend?",
    );
    lines.push("Focus on: position sizing, stop placement, market condition selection, and confidence thresholds.");

    return lines.join("\n");
  }

  /**
   * Run GPT-4o analysis of performance and return recommendations.
   */
  async analyzePerformance(): Promise<AgentReport> {
    if (this.trades.length < 5) {
      return this.fallbackReport(
        `Insufficient trade data (${this.trades.length}/5 minimum). Collect more trades before analysis.`,
      );
    }

    const report = await super.analyzeMarket({ includeDetails: true });

    // Enrich with rules-based adjustments
    const adjustments = this.getRecommendedAdjustments();
    report.data = {
      ...report.data,
      adjustments,
      overallWinRate: this.getOverallWinRate(),
      overallAvgPnl: this.getOverallAvgPnl(),
      totalTrades: this.trades.length,
    };

    return report;
  }
}
