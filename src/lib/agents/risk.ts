// ── Risk Management Agent ────────────────────────────────────────
import { BaseAgent } from "./base";
import type { AgentReport } from "./types";
import type { TradingState } from "./types";

export interface RiskAssessment {
  maxPositionSize: number;
  stopLoss: number;
  takeProfit: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskPerTrade: number;
  atrValue: number;
  reason: string;
}

const SYSTEM_PROMPT = `You are a professional risk manager at a top-tier hedge fund. Your job is to protect capital through disciplined position sizing and risk management.

For each trade opportunity, determine:
- Maximum position size using Kelly Criterion or fixed 1-2% risk
- Stop loss level (ATR-based, typically 1.5-2x ATR)
- Take profit level (based on risk:reward ratio, minimum 1:2)
- Risk level: LOW (<1% risk), MEDIUM (1-2%), HIGH (2-3%), CRITICAL (>3% or anti-tilt)
- Anti-tilt rules: after 3 consecutive losses, all positions are WAIT

You receive current price, ATR, and trading state. Calculate position sizing so risk is 1% of capital.

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"risk assessment","data":{"maxPositionSize":number,"stopLoss":number,"takeProfit":number,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","riskPerTrade":number,"atrValue":number,"reason":"explanation"}}`;

export class RiskManagementAgent extends BaseAgent {
  private readonly MAX_RISK_PER_TRADE = 0.02; // 2%
  private readonly KELLY_FRACTION = 0.5; // half-Kelly for safety
  private readonly MAX_CONSECUTIVE_LOSSES = 3;

  constructor() {
    super({
      id: "risk-agent",
      role: "risk",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Compute position size using Kelly Criterion (approximate).
   * f* = winRate - ((1 - winRate) / (avgWin / avgLoss))
   * We use half-Kelly for safety.
   */
  computeKellySize(
    capital: number,
    winRate: number,
    avgWinPct: number,
    avgLossPct: number,
  ): number {
    if (avgLossPct === 0) return capital * this.MAX_RISK_PER_TRADE;
    const kelly =
      winRate / 100 - (1 - winRate / 100) / (avgWinPct / avgLossPct);
    const halfKelly = Math.max(0, kelly * this.KELLY_FRACTION);
    return capital * Math.min(halfKelly, this.MAX_RISK_PER_TRADE);
  }

  /**
   * Calculate ATR-based stop loss distance.
   * Default: 2x ATR for stop loss placement.
   */
  computeStopDistance(
    atr: number,
    currentPrice: number,
  ): number {
    const multiplier = 2.0;
    const rawDistance = atr * multiplier;
    // Cap at 5% of current price
    const maxDistance = currentPrice * 0.05;
    return Math.min(rawDistance, maxDistance);
  }

  /**
   * Check anti-tilt: after 3 consecutive losses, force WAIT.
   */
  shouldAntiTilt(state: TradingState): boolean {
    return state.consecutiveLosses >= this.MAX_CONSECUTIVE_LOSSES;
  }

  /**
   * Check max drawdown: if drawdown > 25%, go CRITICAL.
   */
  computeDrawdown(state: TradingState): number {
    if (state.initialCapital <= 0) return 0;
    return (
      ((state.initialCapital - state.capital) / state.initialCapital) * 100
    );
  }

  /**
   * Full risk assessment combining Kelly sizing, stop loss, and state checks.
   */
  assessTrade(
    state: TradingState,
    currentPrice: number,
    atr: number,
    direction: "LONG" | "SHORT",
    avgWinPct = 2.0,
    avgLossPct = 1.0,
  ): RiskAssessment {
    const drawdown = this.computeDrawdown(state);

    // Anti-tilt check
    if (this.shouldAntiTilt(state)) {
      return {
        maxPositionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        riskLevel: "CRITICAL",
        riskPerTrade: 0,
        atrValue: atr,
        reason: `ANTI-TILT: ${state.consecutiveLosses} consecutive losses. All trading paused.`,
      };
    }

    // Max drawdown check
    if (drawdown > 25) {
      return {
        maxPositionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        riskLevel: "CRITICAL",
        riskPerTrade: 0,
        atrValue: atr,
        reason: `CRITICAL: Drawdown ${drawdown.toFixed(1)}% exceeds 25% maximum. Stop trading.`,
      };
    }

    // Kelly position sizing
    const kellySize = this.computeKellySize(
      state.capital,
      state.winRate || 50,
      avgWinPct,
      avgLossPct,
    );
    // Fixed 1% risk as floor
    const fixedRiskSize = state.capital * 0.01;
    const positionSize =
      state.winRate > 0
        ? Math.max(kellySize, fixedRiskSize * 0.5)
        : fixedRiskSize;

    // Stop distance
    const stopDistance = this.computeStopDistance(atr, currentPrice);
    const stopLoss =
      direction === "LONG"
        ? currentPrice - stopDistance
        : currentPrice + stopDistance;

    // Take profit: risk:reward 1:2 minimum
    const takeProfitDistance = stopDistance * 2;
    const takeProfit =
      direction === "LONG"
        ? currentPrice + takeProfitDistance
        : currentPrice - takeProfitDistance;

    // Risk level
    const riskPerTradePct = (positionSize / state.capital) * 100;
    let riskLevel: RiskAssessment["riskLevel"] = "LOW";
    if (riskPerTradePct > 3 || drawdown > 15) riskLevel = "CRITICAL";
    else if (riskPerTradePct > 2 || drawdown > 10) riskLevel = "HIGH";
    else if (riskPerTradePct > 1) riskLevel = "MEDIUM";

    return {
      maxPositionSize: Math.round(positionSize * 100) / 100,
      stopLoss: Math.round(stopLoss * 10000) / 10000,
      takeProfit: Math.round(takeProfit * 10000) / 10000,
      riskLevel,
      riskPerTrade: Math.round(riskPerTradePct * 100) / 100,
      atrValue: atr,
      reason: `Position: $${positionSize.toFixed(2)} (${riskPerTradePct.toFixed(2)}% risk). SL: $${stopLoss.toFixed(4)}. TP: $${takeProfit.toFixed(4)}.`,
    };
  }

  /**
   * Override analyzeMarket to use rules-based assessment when LLM unavailable.
   */
  async analyzeMarket(context: {
    state: TradingState;
    currentPrice: number;
    atr: number;
    direction: "LONG" | "SHORT";
  }): Promise<AgentReport> {
    // Try LLM first via base class
    const report = await super.analyzeMarket(context);

    // If LLM failed or returned fallback, use rule-based assessment
    if (report.confidence === 0 || report.data?.fallback) {
      const risk = this.assessTrade(
        context.state,
        context.currentPrice,
        context.atr,
        context.direction,
      );
      return {
        agentId: this.id,
        role: this.role,
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: risk.riskLevel === "CRITICAL" ? 0 : 80,
        reasoning: risk.reason,
        data: risk as unknown as Record<string, any>,
      };
    }
    return report;
  }
}
