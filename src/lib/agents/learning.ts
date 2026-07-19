// ── Learning Agent ────────────────────────────────────────────────
// Tracks performance across market conditions and recommends parameter adjustments.
// Implements continuous auto-weight adjustment and pattern discovery.
import { BaseAgent } from "./base";
import type { AgentReport, AgentRole } from "./types";

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

export interface AgentAccuracy {
  role: AgentRole;
  wins: number;
  trades: number;
  accuracy: number;
}

export interface DiscoveredPattern {
  id: string;
  description: string;
  condition: string;       // e.g. "rsi > 70 AND volume declining"
  modifier: "confidence_boost" | "confidence_penalty" | "position_reduce" | "position_increase" | "avoid" | "favor";
  value: number;            // e.g. -15 for 15% penalty
  role: AgentRole;         // which agent this pattern affects
  discoveredAt: number;
}

export interface WeightAdjustment {
  role: AgentRole;
  oldWeight: number;
  newWeight: number;
  reason: string;
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
  private weightAdjustmentCounter = 0;
  private patternDiscoveryCounter = 0;

  // Per-condition stats cache
  private conditionStats: Map<MarketCondition, ConditionStats> = new Map();

  // Per-agent accuracy tracking for auto-weight adjustment
  private agentAccuracyMap: Map<AgentRole, { wins: number; trades: number }> = new Map();

  // Discovered patterns from GPT-4o analysis
  private discoveredPatterns: DiscoveredPattern[] = [];
  private patternIdCounter = 0;

  // Last weight adjustment for audit trail
  private lastWeightAdjustments: WeightAdjustment[] = [];

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

  /**
   * Record a closed trade with per-agent signal data.
   * Tracks which agents contributed to the decision and whether their
   * direction aligned with the outcome (for weight adjustment).
   */
  recordTradeWithSignals(
    trade: Omit<TradeRecord, "id">,
    agentSignals: Array<{ role: AgentRole; direction: "LONG" | "SHORT" | "NEUTRAL" }>,
  ): TradeRecord {
    const record = this.recordTrade(trade);

    // Update per-agent accuracy: agent wins if direction matches profitable outcome
    const isWin = trade.pnlPct > 0;
    for (const signal of agentSignals) {
      if (signal.direction === "NEUTRAL") continue;

      const existing = this.agentAccuracyMap.get(signal.role) ?? {
        wins: 0,
        trades: 0,
      };
      existing.trades++;

      // Agent "wins" if its signal direction aligned with a profitable outcome
      // LONG + win = correct, SHORT + win (price went down) = correct
      const signalCorrect =
        (signal.direction === "LONG" && isWin) ||
        (signal.direction === "SHORT" && !isWin);
      if (signalCorrect) {
        existing.wins++;
      }

      this.agentAccuracyMap.set(signal.role, existing);
    }

    return record;
  }

  /**
   * Get per-agent accuracy statistics.
   */
  getAgentAccuracies(): AgentAccuracy[] {
    const accuracies: AgentAccuracy[] = [];
    for (const [role, stats] of this.agentAccuracyMap) {
      if (stats.trades === 0) continue;
      accuracies.push({
        role,
        wins: stats.wins,
        trades: stats.trades,
        accuracy: Math.round((stats.wins / stats.trades) * 10000) / 100,
      });
    }
    return accuracies.sort((a, b) => b.accuracy - a.accuracy);
  }

  /**
   * Auto-Weight Adjustment: recalculate agent weights based on actual accuracy.
   * Called after every 20 closed trades.
   *
   * Formula:
   *   agentAccuracy = agentWins / agentTrades
   *   avgAccuracy   = sum(allAgentAccuracies) / agentCount
   *   newWeight     = baseWeight * (agentAccuracy / avgAccuracy)
   * Capped at ±50% of base weight.
   */
  adjustWeights(baseWeights: Record<AgentRole, number>): WeightAdjustment[] | null {
    const accuracies = this.getAgentAccuracies();
    if (accuracies.length === 0) return null;

    // Calculate average accuracy across all agents with data
    const sumAccuracy = accuracies.reduce((s, a) => s + a.accuracy, 0);
    const avgAccuracy = sumAccuracy / accuracies.length;

    if (avgAccuracy === 0) return null;

    const adjustments: WeightAdjustment[] = [];

    for (const { role, accuracy } of accuracies) {
      const baseWeight = baseWeights[role];
      if (baseWeight === undefined || baseWeight === 0) continue;

      const ratio = accuracy / avgAccuracy;
      let newWeight = baseWeight * ratio;

      // Cap at ±50% of base weight
      const minWeight = baseWeight * 0.5;
      const maxWeight = baseWeight * 1.5;
      newWeight = Math.max(minWeight, Math.min(maxWeight, newWeight));

      // Round to 4 decimal places
      newWeight = Math.round(newWeight * 10000) / 10000;

      adjustments.push({
        role,
        oldWeight: baseWeights[role],
        newWeight,
        reason: `accuracy=${accuracy}% vs avg=${Math.round(avgAccuracy * 100) / 100}% (ratio=${Math.round(ratio * 100) / 100})`,
      });
    }

    this.weightAdjustmentCounter++;
    this.lastWeightAdjustments = adjustments;

    console.log(
      `[Learning] Weight adjustment #${this.weightAdjustmentCounter}: ` +
        `${accuracies.length} agents evaluated (avg accuracy: ${Math.round(avgAccuracy * 100) / 100}%)`,
    );

    return adjustments;
  }

  /**
   * Pattern Discovery: every 50 trades, call GPT-4o to discover patterns
   * that correlate with wins/losses. Stores results as scoring modifiers.
   */
  async discoverPatterns(): Promise<DiscoveredPattern[]> {
    if (this.trades.length < 50) {
      console.log(
        `[Learning] Pattern discovery skipped: only ${this.trades.length} trades (need 50)`,
      );
      return [];
    }

    const last50 = this.trades.slice(-50);

    // Build prompt with trade data
    const tradeLines = last50.map((t, i) => {
      const outcome = t.pnlPct > 0 ? "WIN" : "LOSS";
      return `#${i + 1}: ${t.direction} ${t.symbol} | Condition: ${t.marketCondition} | PnL: ${t.pnlPct > 0 ? "+" : ""}${t.pnlPct.toFixed(2)}% | Confidence: ${t.confidence}% | Outcome: ${outcome}`;
    });

    const winCount = last50.filter((t) => t.pnlPct > 0).length;
    const lossCount = last50.length - winCount;

    const prompt = [
      `Here are the last ${last50.length} trades with their market conditions and outcomes.`,
      `Wins: ${winCount} | Losses: ${lossCount} | Win rate: ${Math.round((winCount / last50.length) * 100)}%`,
      ``,
      `=== TRADE LOG ===`,
      ...tradeLines,
      ``,
      `=== ANALYSIS REQUEST ===`,
      `What patterns correlate with wins? What correlates with losses? Any new rules to add?`,
      ``,
      `Respond in JSON format only:`,
      `{"patterns":[{"description":"pattern name","condition":"detectable condition","modifier":"confidence_boost|confidence_penalty|position_reduce|position_increase|avoid|favor","value":-15,"role":"market|technical|pattern|risk|news|macro|smart_money|liquidity|regime|multi_timeframe|correlation|sentiment|volume|probability|confidence","confidence":75}],"summary":"overall analysis"}`,
    ].join("\n");

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log("[Learning] Pattern discovery skipped: no OpenAI API key");
        return [];
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are a quantitative trading pattern analyst. Analyze trade logs to find patterns that correlate with winning and losing trades. Be specific and data-driven. Identify actionable rules the system can use as scoring modifiers.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 800,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        console.error(`[Learning] Pattern discovery API error: ${res.status}`);
        return [];
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const text = data.choices?.[0]?.message?.content || "";

      // Parse the response
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      const patterns: DiscoveredPattern[] = [];
      const rawPatterns: Array<{
        description: string;
        condition: string;
        modifier: string;
        value: number;
        role: string;
        confidence: number;
      }> = parsed.patterns || [];

      for (const p of rawPatterns) {
        if (p.confidence < 60) continue; // Only keep high-confidence patterns
        const pattern: DiscoveredPattern = {
          id: `pattern-${++this.patternIdCounter}-${Date.now()}`,
          description: p.description,
          condition: p.condition,
          modifier: p.modifier as DiscoveredPattern["modifier"],
          value: p.value,
          role: p.role as AgentRole,
          discoveredAt: Date.now(),
        };
        patterns.push(pattern);
        this.discoveredPatterns.push(pattern);
      }

      // Keep only the 50 most recent patterns
      if (this.discoveredPatterns.length > 50) {
        this.discoveredPatterns = this.discoveredPatterns.slice(-50);
      }

      this.patternDiscoveryCounter++;
      console.log(
        `[Learning] Pattern discovery #${this.patternDiscoveryCounter}: ` +
          `${patterns.length} patterns found (${parsed.summary || "no summary"})`,
      );

      return patterns;
    } catch (err) {
      console.error("[Learning] Pattern discovery error:", err);
      return [];
    }
  }

  /**
   * Get all discovered patterns (for orchestrator to apply as scoring modifiers).
   */
  getDiscoveredPatterns(): DiscoveredPattern[] {
    return [...this.discoveredPatterns];
  }

  /**
   * Get the last weight adjustments (for DB logging and audit).
   */
  getLastWeightAdjustments(): WeightAdjustment[] {
    return [...this.lastWeightAdjustments];
  }

  /**
   * Check if auto-weight adjustment is due (every 20 closed trades).
   */
  isWeightAdjustmentDue(): boolean {
    return this.trades.length > 0 && this.trades.length % 20 === 0;
  }

  /**
   * Check if pattern discovery is due (every 50 closed trades or first 50+).
   */
  isPatternDiscoveryDue(): boolean {
    return this.trades.length >= 50 && this.trades.length % 50 === 0;
  }

  /**
   * Apply a discovered pattern as a scoring modifier.
   * Returns a confidence adjustment value for a given agent role.
   */
  applyPatternModifiers(role: AgentRole, context: Record<string, any>): number {
    let totalModifier = 0;
    for (const pattern of this.discoveredPatterns) {
      if (pattern.role !== role) continue;

      // Simple condition check: if the pattern's condition string appears
      // in the context values, apply the modifier
      // In production, this would be a proper expression evaluator
      const contextStr = JSON.stringify(context).toLowerCase();
      const conditionLower = pattern.condition.toLowerCase();

      // Check if the condition keywords are present in context
      const keywords = conditionLower
        .split(/and|or|,|&+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const allKeywordsMatch = keywords.every((kw) => contextStr.includes(kw));
      if (!allKeywordsMatch) continue;

      switch (pattern.modifier) {
        case "confidence_boost":
          totalModifier += pattern.value;
          break;
        case "confidence_penalty":
          totalModifier += pattern.value; // value is negative
          break;
        case "position_reduce":
          // Handled separately in position sizing
          break;
        case "position_increase":
          break;
        case "avoid":
          // Handled by returning a strong negative signal
          totalModifier -= Math.abs(pattern.value);
          break;
        case "favor":
          totalModifier += Math.abs(pattern.value);
          break;
      }
    }

    // Clamp total modifier to ±30
    return Math.max(-30, Math.min(30, totalModifier));
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
