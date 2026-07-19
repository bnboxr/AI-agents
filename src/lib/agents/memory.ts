// ── Memory Agent ──────────────────────────────────────────────────
// Stores past trades with full context and recalls similar historical trades.
import { BaseAgent } from "./base";
import type { AgentReport, OrchestratorDecision } from "./types";
import type { MarketCondition } from "./learning";

export interface StoredDecision {
  id: string;
  decision: OrchestratorDecision;
  symbol: string;
  marketCondition: MarketCondition;
  indicators?: Record<string, number>;
  outcome?: {
    pnlPct: number;
    exitedAt: number;
    exitReason: string;
  };
  storedAt: number;
}

export interface SimilarTrade {
  decision: StoredDecision;
  similarityScore: number; // 0-1, higher = more similar
  matchReasons: string[];
}

const SYSTEM_PROMPT = `You are an institutional trading memory analyst with access to a database of past trades. Your job is to analyze past similar trades and extract actionable lessons.

For each query, review the top similar trades and determine:
- What worked well in similar past situations
- What failed and why
- Key patterns or indicators that were predictive
- Recommended adjustments based on historical outcomes
- Overall direction and confidence based on historical precedent

Focus on actionable insights — not just describing what happened, but what we should DO differently.

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"historical analysis","data":{"lessons":["lesson1","lesson2"],"successRate":number,"similarTradeCount":number,"averageOutcome":number,"keyInsight":"most important takeaway"}}`;

export class MemoryAgent extends BaseAgent {
  private decisions: StoredDecision[] = [];
  private readonly MAX_DECISIONS = 500;
  private decisionIdCounter = 0;

  constructor() {
    super({
      id: "memory-agent",
      role: "memory",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /** Store a decision (with optional outcome) for future recall. */
  storeDecision(
    decision: OrchestratorDecision,
    symbol: string,
    marketCondition: MarketCondition,
    indicators?: Record<string, number>,
  ): StoredDecision {
    const stored: StoredDecision = {
      id: `mem-${++this.decisionIdCounter}-${Date.now()}`,
      decision,
      symbol,
      marketCondition,
      indicators,
      storedAt: Date.now(),
    };

    this.decisions.push(stored);

    // Enforce cap
    if (this.decisions.length > this.MAX_DECISIONS) {
      this.decisions = this.decisions.slice(-this.MAX_DECISIONS);
    }

    return stored;
  }

  /** Update a previously stored decision with its outcome. */
  recordOutcome(
    decisionId: string,
    outcome: { pnlPct: number; exitedAt: number; exitReason: string },
  ): boolean {
    const stored = this.decisions.find((d) => d.id === decisionId);
    if (!stored) return false;
    stored.outcome = outcome;
    return true;
  }

  /**
   * Compute a similarity score between two market condition strings.
   * Returns 0-1 where 1 = exact match.
   */
  private conditionSimilarity(a: MarketCondition, b: MarketCondition): number {
    if (a === b) return 1.0;
    // Partial overlaps
    if (a === "trending_up" && b === "trending_down") return 0.3;
    if (a === "trending_down" && b === "trending_up") return 0.3;
    if (a === "volatile" && b !== "volatile") return 0.1;
    if (b === "volatile" && a !== "volatile") return 0.1;
    return 0.2;
  }

  /**
   * Compute similarity between two sets of indicators.
   * Returns 0-1 based on how many indicators are within a reasonable range.
   */
  private indicatorSimilarity(
    a?: Record<string, number>,
    b?: Record<string, number>,
  ): number {
    if (!a || !b) return 0.5; // neutral if one is missing
    const keys = Object.keys(a);
    if (keys.length === 0) return 0.5;

    let totalScore = 0;
    let count = 0;

    for (const key of keys) {
      if (b[key] === undefined) continue;
      const diff = Math.abs(a[key] - b[key]);
      const range = Math.max(Math.abs(a[key]), Math.abs(b[key]), 1);
      const ratio = diff / range;
      // Score: 1.0 if identical, 0.0 if completely different
      const score = Math.max(0, 1 - ratio);
      totalScore += score;
      count++;
    }

    return count > 0 ? totalScore / count : 0.5;
  }

  /**
   * Find top 5 similar past trades for a given symbol and market condition.
   */
  recall(
    symbol: string,
    condition: MarketCondition,
    indicators?: Record<string, number>,
    limit = 5,
  ): SimilarTrade[] {
    const scored: SimilarTrade[] = [];

    for (const stored of this.decisions) {
      const reasons: string[] = [];

      // Symbol match
      const symbolMatch = stored.symbol.toLowerCase() === symbol.toLowerCase();
      if (symbolMatch) reasons.push("same symbol");

      // Condition similarity
      const condSim = this.conditionSimilarity(condition, stored.marketCondition);
      if (condSim === 1.0) reasons.push("same market condition");
      else if (condSim >= 0.3) reasons.push("similar market condition");

      // Indicator similarity
      const indSim = this.indicatorSimilarity(indicators, stored.indicators);

      // Time decay: more recent = slightly higher weight
      const ageHours = (Date.now() - stored.storedAt) / (1000 * 60 * 60);
      const recencyScore = Math.exp(-ageHours / (24 * 7)); // half-life 1 week

      // Composite similarity score
      const similarityScore =
        (symbolMatch ? 0.35 : 0.1) +
        condSim * 0.3 +
        indSim * 0.2 +
        recencyScore * 0.15;

      scored.push({
        decision: stored,
        similarityScore: Math.round(similarityScore * 1000) / 1000,
        matchReasons: reasons,
      });
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.similarityScore - a.similarityScore);

    return scored.slice(0, limit);
  }

  /** Get all stored decisions. */
  getAllDecisions(): StoredDecision[] {
    return [...this.decisions];
  }

  /** Get count of stored decisions. */
  getCount(): number {
    return this.decisions.length;
  }

  /** Build user prompt for GPT-4o historical analysis. */
  protected buildUserPrompt(context: {
    symbol: string;
    condition: MarketCondition;
    similarTrades: SimilarTrade[];
    currentIndicators?: Record<string, number>;
  }): string {
    const lines: string[] = [
      `=== Query Context ===`,
      `Symbol: ${context.symbol}`,
      `Market Condition: ${context.condition}`,
      ``,
    ];

    if (context.currentIndicators) {
      lines.push("Current Indicators:");
      for (const [key, value] of Object.entries(context.currentIndicators)) {
        lines.push(`  ${key}: ${typeof value === "number" ? value.toFixed(4) : value}`);
      }
      lines.push("");
    }

    lines.push(`=== Top ${context.similarTrades.length} Similar Past Trades ===`);

    for (let i = 0; i < context.similarTrades.length; i++) {
      const st = context.similarTrades[i];
      const d = st.decision;
      lines.push("");
      lines.push(
        `--- Similar Trade #${i + 1} (similarity: ${(st.similarityScore * 100).toFixed(0)}%) ---`,
      );
      lines.push(`Symbol: ${d.symbol}`);
      lines.push(`Condition: ${d.marketCondition}`);
      lines.push(
        `Decision: ${d.decision.action} | Direction: ${
          d.decision.agentReports[0]?.direction ?? "NEUTRAL"
        } | Confidence: ${d.decision.confidence}%`,
      );
      lines.push(`Match reasons: ${st.matchReasons.join(", ") || "general similarity"}`);

      if (d.outcome) {
        lines.push(
          `Outcome: ${d.outcome.pnlPct > 0 ? "+" : ""}${d.outcome.pnlPct.toFixed(2)}%`,
        );
        lines.push(`Exit Reason: ${d.outcome.exitReason}`);
      } else {
        lines.push("Outcome: pending / unknown");
      }

      if (d.indicators) {
        lines.push("Indicators at decision time:");
        for (const [key, value] of Object.entries(d.indicators)) {
          lines.push(
            `  ${key}: ${typeof value === "number" ? value.toFixed(4) : value}`,
          );
        }
      }
    }

    lines.push("");
    lines.push("Based on these past 5 similar trades, what can we learn?");
    lines.push("What worked? What didn't? What should we do differently this time?");

    return lines.join("\n");
  }

  /**
   * Run GPT-4o analysis of historical trades for the current context.
   */
  async analyzeHistory(
    symbol: string,
    condition: MarketCondition,
    indicators?: Record<string, number>,
  ): Promise<AgentReport> {
    const similarTrades = this.recall(symbol, condition, indicators, 5);

    if (similarTrades.length === 0) {
      return this.fallbackReport(
        `No similar past trades found for ${symbol} in ${condition} conditions. This may be a novel scenario.`,
      );
    }

    const report = await super.analyzeMarket({
      symbol,
      condition,
      similarTrades,
      currentIndicators: indicators,
    });

    // Enrich with computed data
    const outcomesKnown = similarTrades.filter((t) => t.decision.outcome);
    const avgOutcome =
      outcomesKnown.length > 0
        ? outcomesKnown.reduce((s, t) => s + (t.decision.outcome?.pnlPct ?? 0), 0) /
          outcomesKnown.length
        : 0;
    const winCount = outcomesKnown.filter(
      (t) => (t.decision.outcome?.pnlPct ?? 0) > 0,
    ).length;
    const successRate =
      outcomesKnown.length > 0
        ? Math.round((winCount / outcomesKnown.length) * 100)
        : 0;

    report.data = {
      ...report.data,
      similarTradeCount: similarTrades.length,
      outcomesKnown: outcomesKnown.length,
      averageOutcome: Math.round(avgOutcome * 100) / 100,
      successRate,
    };

    return report;
  }
}
