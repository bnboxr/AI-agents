// ── Exit Agent ────────────────────────────────────────────────────
// Dedicated to finding exit points. Enforces "Better +7% than -2%" rule.
import { BaseAgent } from "./base";
import type { AgentReport, TradingState } from "./types";

export interface ExitContext {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  pnlPct: number;
  trailingStopPrice?: number;
  trailingStopHit: boolean;
  ema20?: number;
  rsi?: number;
  macdHistogram?: number;
  previousRsi?: number;
  confidence: number;
  riskLevel?: string;
}

export interface ExitResult {
  action: "EXIT" | "HOLD";
  confidence: number;
  reason: string;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  triggeredRule: string;
}

const SYSTEM_PROMPT = `You are a professional exit strategist at a top quantitative hedge fund. Your ONLY job is to determine whether to exit a position. You are not a general market analyst — you focus exclusively on exit conditions.

When analyzing exit conditions, consider:
- Profit protection: A small gain is ALWAYS better than a loss. "Better +7% than -2%"
- Trailing stop breaches: if price hits the trailing stop, exit immediately
- Momentum loss: price falling below EMA20 signals weakening trend
- Bearish divergence: price making new highs while RSI is declining
- Confidence collapse: if confidence drops below 40%, the thesis is broken
- Risk level CRITICAL: exit regardless of PnL

Exit urgency:
- CRITICAL: trailing stop hit, risk CRITICAL, or PnL -5% or worse
- HIGH: divergence confirmation, momentum loss, confidence < 30%
- MEDIUM: weakening signals, PnL fading, confidence 30-40%
- LOW: minor concerns, PnL still positive but watch closely

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"exit analysis","data":{"action":"EXIT"|"HOLD","urgency":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","triggeredRule":"rule name","pnlProtection":true|false,"shouldTrailStop":true|false,"newTrailPrice":number|null}}`;

export class ExitAgent extends BaseAgent {
  // Rule: "Better +7% than -2%" — exit thresholds
  private readonly PROFIT_LOCK_THRESHOLD = 7; // % profit — strongly consider taking
  private readonly LOSS_CUT_THRESHOLD = -5; // % loss — exit immediately
  private readonly CONFIDENCE_FLOOR = 40; // below this = no conviction
  private readonly DIVERGENCE_RSI_THRESHOLD = 5; // RSI points divergence

  constructor() {
    super({
      id: "exit-agent",
      role: "exit",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Check if trailing stop has been hit.
   */
  private checkTrailingStop(ctx: ExitContext): boolean {
    if (ctx.trailingStopHit) return true;
    if (!ctx.trailingStopPrice) return false;

    if (ctx.direction === "LONG") {
      return ctx.currentPrice <= ctx.trailingStopPrice;
    } else {
      return ctx.currentPrice >= ctx.trailingStopPrice;
    }
  }

  /**
   * Check for momentum loss: price below EMA20.
   */
  private checkMomentumLoss(ctx: ExitContext): boolean {
    if (ctx.ema20 === undefined) return false;
    if (ctx.direction === "LONG") {
      return ctx.currentPrice < ctx.ema20;
    } else {
      return ctx.currentPrice > ctx.ema20;
    }
  }

  /**
   * Check for bearish divergence: price up + RSI down.
   * For LONG: price making new highs while RSI declining = dangerous.
   * For SHORT: price making new lows while RSI rising = dangerous.
   */
  private checkDivergence(ctx: ExitContext): boolean {
    if (ctx.rsi === undefined || ctx.previousRsi === undefined) return false;
    const rsiChange = ctx.rsi - ctx.previousRsi;

    if (ctx.direction === "LONG") {
      // Price up but RSI down = bearish divergence for longs
      return ctx.pnlPct > 0 && rsiChange < -this.DIVERGENCE_RSI_THRESHOLD;
    } else {
      // Price down but RSI up = bullish divergence for shorts
      return ctx.pnlPct > 0 && rsiChange > this.DIVERGENCE_RSI_THRESHOLD;
    }
  }

  /**
   * Check confidence collapse: below the floor threshold.
   */
  private checkConfidenceCollapse(ctx: ExitContext): boolean {
    return ctx.confidence < this.CONFIDENCE_FLOOR;
  }

  /**
   * Rules-based exit evaluation (no LLM required).
   * Returns ExitResult with action and reasoning.
   */
  evaluateExit(ctx: ExitContext): ExitResult {
    const reasons: string[] = [];
    let urgency: ExitResult["urgency"] = "LOW";
    let triggeredRule = "none";

    // CRITICAL rules first
    if (this.checkTrailingStop(ctx)) {
      reasons.push("Trailing stop triggered");
      urgency = "CRITICAL";
      triggeredRule = "trailing_stop";
    }

    if (ctx.riskLevel === "CRITICAL") {
      reasons.push("Risk level is CRITICAL");
      urgency = "CRITICAL";
      triggeredRule = triggeredRule === "none" ? "risk_critical" : triggeredRule;
    }

    if (ctx.pnlPct <= this.LOSS_CUT_THRESHOLD) {
      reasons.push(
        `Loss exceeds ${Math.abs(this.LOSS_CUT_THRESHOLD)}% threshold (current: ${ctx.pnlPct.toFixed(2)}%)`,
      );
      urgency = "CRITICAL";
      triggeredRule = triggeredRule === "none" ? "loss_threshold" : triggeredRule;
    }

    // HIGH urgency rules
    if (this.checkDivergence(ctx)) {
      const rsiDir = (ctx.rsi ?? 0) > (ctx.previousRsi ?? 0) ? "rising" : "declining";
      reasons.push(
        `Bearish divergence detected: price moving favorably but RSI ${rsiDir}`,
      );
      if (urgency !== "CRITICAL") urgency = "HIGH";
      triggeredRule = triggeredRule === "none" ? "divergence" : triggeredRule;
    }

    if (this.checkMomentumLoss(ctx)) {
      reasons.push(
        `Momentum loss: price ${ctx.direction === "LONG" ? "below" : "above"} EMA20`,
      );
      if (urgency !== "CRITICAL") urgency = "HIGH";
      triggeredRule = triggeredRule === "none" ? "momentum_loss" : triggeredRule;
    }

    if (this.checkConfidenceCollapse(ctx)) {
      reasons.push(
        `Confidence collapsed to ${ctx.confidence}% (below ${this.CONFIDENCE_FLOOR}% floor)`,
      );
      if (urgency !== "CRITICAL") urgency = "HIGH";
      triggeredRule = triggeredRule === "none" ? "confidence_collapse" : triggeredRule;
    }

    // MEDIUM urgency: profit at lock threshold
    if (ctx.pnlPct >= this.PROFIT_LOCK_THRESHOLD && urgency === "LOW") {
      reasons.push(
        `Profit at ${ctx.pnlPct.toFixed(1)}% — "Better +7% than -2%": consider locking in`,
      );
      urgency = "MEDIUM";
      triggeredRule = "profit_lock_rule";
    }

    // If we have CRITICAL or HIGH urgency reasons, exit
    if (urgency === "CRITICAL" || urgency === "HIGH") {
      return {
        action: "EXIT",
        confidence: urgency === "CRITICAL" ? 100 : 85,
        reason: reasons.join("; "),
        urgency,
        triggeredRule,
      };
    }

    // MEDIUM urgency: recommend exit but with lower confidence
    if (urgency === "MEDIUM") {
      return {
        action: "EXIT",
        confidence: 70,
        reason: reasons.join("; "),
        urgency,
        triggeredRule,
      };
    }

    // No exit signals
    return {
      action: "HOLD",
      confidence: 80,
      reason:
        reasons.length > 0
          ? reasons.join("; ")
          : "No exit signals detected. Position remains valid.",
      urgency: "LOW",
      triggeredRule: "none",
    };
  }

  /** Build user prompt for GPT-4o exit analysis. */
  protected buildUserPrompt(context: ExitContext): string {
    const lines: string[] = [
      `=== Position Summary ===`,
      `Symbol: ${context.symbol}`,
      `Direction: ${context.direction}`,
      `Entry Price: $${context.entryPrice.toFixed(4)}`,
      `Current Price: $${context.currentPrice.toFixed(4)}`,
      `Unrealized PnL: ${context.pnlPct > 0 ? "+" : ""}${context.pnlPct.toFixed(2)}%`,
      ``,
      `=== Exit Conditions ===`,
      `Trailing Stop Hit: ${context.trailingStopHit ? "YES ⚠️" : "No"}`,
      `Trailing Stop Price: ${context.trailingStopPrice ? `$${context.trailingStopPrice.toFixed(4)}` : "Not set"}`,
      `Confidence: ${context.confidence}%`,
      `Risk Level: ${context.riskLevel ?? "UNKNOWN"}`,
      ``,
      `=== Technical Indicators ===`,
      `EMA20: ${context.ema20 ? `$${context.ema20.toFixed(4)}` : "N/A"}`,
      `RSI: ${context.rsi ? context.rsi.toFixed(1) : "N/A"}`,
      `Previous RSI: ${context.previousRsi ? context.previousRsi.toFixed(1) : "N/A"}`,
      `MACD Histogram: ${context.macdHistogram ? context.macdHistogram.toFixed(4) : "N/A"}`,
      ``,
      `=== Key Rule ===`,
      `"Better +7% than -2%" — protect profits, cut losses early.`,
      ``,
      `Should we EXIT or HOLD this position? Explain your reasoning concisely.`,
    ];

    return lines.join("\n");
  }

  /**
   * Run full exit analysis: rules-based first, then GPT-4o for confirmation.
   */
  async analyzeExit(context: ExitContext): Promise<AgentReport> {
    // Always run rules-based evaluation first
    const rulesResult = this.evaluateExit(context);

    // Try LLM for additional insight
    const llmReport = await super.analyzeMarket(context);

    // Merge: rules-based result takes priority for critical decisions
    const isFallback = llmReport.confidence === 0 || llmReport.data?.fallback;

    const finalAction =
      rulesResult.action === "EXIT"
        ? "EXIT"
        : (llmReport.data?.action as string) ?? "HOLD";

    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction: "NEUTRAL", // Exit agent is always neutral directionally
      confidence: rulesResult.action === "EXIT" ? rulesResult.confidence : llmReport.confidence,
      reasoning: isFallback
        ? rulesResult.reason
        : `${rulesResult.reason} | LLM: ${llmReport.reasoning.slice(0, 200)}`,
      data: {
        action: finalAction,
        urgency: rulesResult.urgency,
        triggeredRule: rulesResult.triggeredRule,
        pnlPct: context.pnlPct,
        rulesBased: rulesResult,
        llmAnalysis: isFallback ? null : { action: llmReport.data?.action, reasoning: llmReport.reasoning },
        pnlProtection: context.pnlPct >= this.PROFIT_LOCK_THRESHOLD,
      },
    };
  }
}
