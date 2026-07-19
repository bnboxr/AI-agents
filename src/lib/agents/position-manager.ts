// ── Position Manager + Trailing Stop Agent ──────────────────────────
// Level 4 Execution agent. Runs after the Orchestrator decision to set
// precise execution parameters: dynamic position sizing, trailing stop,
// take profit levels, and scale-in plans.
//
// Integrates with: Risk Agent (base sizing), Regime Agent (multiplier),
// Correlation Agent (multiplier), Confidence Agent (DA multiplier),
// and the Execution Agent (reads position sizing from here).

import { BaseAgent } from "./base";
import type { AgentReport } from "./types";
import type { OrchestratorDecision, TradingState } from "./types";
import type { RegimeClassification } from "./regime";

// ── Public Types ──────────────────────────────────────────────────────

export interface ScaleInStep {
  step: 1 | 2 | 3;
  size: number;           // absolute position size for this step
  triggerDescription: string; // what triggers this step
}

export interface PositionManagerOutput {
  positionSize: number;               // final adjusted position size
  stopLoss: number;                    // initial stop loss price
  takeProfit: number;                  // primary take profit price
  trailingActivated: boolean;          // whether trailing stop is armed
  trailingParams: {
    atrMultiplier: number;             // e.g., 2.0
    breakEvenTrigger: number;          // price where stop moves to entry (ATR * 1.5 from entry)
    profitLockTrigger: number;         // price where profit lock engages (+7%)
    profitLockStop: number;            // stop level after profit lock (+3%)
    currentTrailingStop: number;       // current trailing stop price (initially same as stopLoss)
  };
  takeProfitLevels: {
    tp1: { price: number; sizePct: number }; // partial: 50% at 1:1 RR
    tp2: { price: number; sizePct: number }; // remaining 50% at 3:1 RR
  };
  scaleInPlan: ScaleInStep[];
  direction: "LONG" | "SHORT";
  riskRewardRatio: number;
  maxPositionPct: number;             // capped at 25% of portfolio
}

export interface PositionManagerContext {
  decision: OrchestratorDecision;
  reports: AgentReport[];
  state: TradingState;
  currentPrice: number;
  atr?: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_ATR_MULTIPLIER = 2.0;
const BREAK_EVEN_ATR_MULTIPLIER = 1.5;   // move stop to entry after price moves +1.5 ATR
const PROFIT_LOCK_PCT = 7;                // owner rule: +7% profit → lock
const PROFIT_LOCK_FLOOR_PCT = 3;          // tighten stop to lock +3%
const MAX_POSITION_PCT = 0.25;            // owner rule: max 25% of portfolio
const DEFAULT_RISK_REWARD_RATIO = 3.0;
const TP1_RR = 1.0;                       // first take profit at 1:1 RR
const TP2_RR = 3.0;                       // second take profit at 3:1 RR
const TP1_SIZE_PCT = 0.5;                 // 50% at TP1
const PROBE_STEP1_PCT = 0.25;             // probe mode step 1
const PROBE_STEP2_PCT = 0.50;             // probe mode step 2
const PROBE_STEP3_PCT = 1.0;              // probe mode full size

// ── System Prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior position sizing and trade execution manager at a top quantitative hedge fund. Your role is to take the Orchestrator's trade decision and refine the execution parameters: position size, stop loss, take profit levels, and trailing stop configuration.

You apply dynamic multipliers from other agents:
- Regime agent: adjusts position size based on market regime (0-1.0x)
- Correlation agent: reduces exposure during correlation breakdowns
- Devil's Advocate: applies a confidence haircut when the DA raises valid concerns
- Confidence score: scales position proportionally to conviction

Trailing stop rules:
- ATR-based: stop = entry - (ATR * 2.0) for longs
- Move only in favorable direction (up for longs, down for shorts)
- Break-even: move stop to entry after price moves +1.5 ATR in profit
- Profit lock: if +7% profit, tighten stop to lock +3% minimum

Position sizing capped at 25% of portfolio per owner rules.

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":100,"reasoning":"execution parameters set","data":{"positionSize":number,"stopLoss":number,"takeProfit":number,"trailingActivated":true,"riskRewardRatio":number}}`;

// ── Agent Class ───────────────────────────────────────────────────────

export class PositionManagerAgent extends BaseAgent {
  // Configurable parameters
  private atrMultiplier: number;
  private riskRewardRatio: number;

  constructor() {
    super({
      id: "position-manager-agent",
      role: "position_manager",
      systemPrompt: SYSTEM_PROMPT,
    });
    this.atrMultiplier = DEFAULT_ATR_MULTIPLIER;
    this.riskRewardRatio = DEFAULT_RISK_REWARD_RATIO;
  }

  // ── Public Configuration ──────────────────────────────────────────

  setAtrMultiplier(mult: number): void {
    this.atrMultiplier = mult;
  }

  setRiskRewardRatio(rr: number): void {
    this.riskRewardRatio = rr;
  }

  // ── Core: Compute Position & Execution Parameters ─────────────────

  /**
   * Compute the full position management output given the orchestrator
   * decision, agent reports, trading state, and market data.
   *
   * This is the main entry point called by the Orchestrator after makeDecision().
   */
  computePosition(ctx: PositionManagerContext): PositionManagerOutput {
    const { decision, reports, state, currentPrice, atr } = ctx;

    // ── Determine direction ──────────────────────────────────
    const direction: "LONG" | "SHORT" =
      decision.action === "BUY" ? "LONG" : decision.action === "SELL" ? "SHORT" : "LONG";

    // ── Extract multipliers from agent reports ──────────────
    const regimeMult = this.extractRegimeMultiplier(reports);
    const correlationMult = this.extractCorrelationMultiplier(reports);
    const daMult = this.extractDevilAdvocateMultiplier(reports);
    const confidenceAdj = this.computeConfidenceAdjustment(decision.confidence);

    // ── Dynamic position sizing ──────────────────────────────
    const baseSize = decision.positionSize > 0
      ? decision.positionSize
      : state.capital * 0.01; // fallback: 1% of capital

    let positionSize = baseSize
      * regimeMult
      * correlationMult
      * daMult
      * confidenceAdj;

    // Cap at 25% of portfolio per owner rule
    const maxSize = state.capital * MAX_POSITION_PCT;
    positionSize = Math.min(positionSize, maxSize);

    // Floor: avoid dust positions
    if (positionSize < state.capital * 0.001) {
      positionSize = 0;
    }

    // ── Use ATR from context or fallback to estimate ────────
    const usedAtr = atr ?? this.estimateAtr(currentPrice);

    // ── Stop loss calculation (ATR-based) ────────────────────
    const stopDistance = usedAtr * this.atrMultiplier;
    const stopLoss = direction === "LONG"
      ? currentPrice - stopDistance
      : currentPrice + stopDistance;

    // ── Take profit calculation (Risk/Reward based) ──────────
    const riskAmount = Math.abs(currentPrice - stopLoss);
    const tp1Price = direction === "LONG"
      ? currentPrice + (riskAmount * TP1_RR)
      : currentPrice - (riskAmount * TP1_RR);
    const tp2Price = direction === "LONG"
      ? currentPrice + (riskAmount * TP2_RR)
      : currentPrice - (riskAmount * TP2_RR);

    // ── Trailing stop parameters ──────────────────────────────
    const breakEvenTrigger = direction === "LONG"
      ? currentPrice + (usedAtr * BREAK_EVEN_ATR_MULTIPLIER)
      : currentPrice - (usedAtr * BREAK_EVEN_ATR_MULTIPLIER);

    const profitLockTrigger = direction === "LONG"
      ? currentPrice * (1 + PROFIT_LOCK_PCT / 100)
      : currentPrice * (1 - PROFIT_LOCK_PCT / 100);

    const profitLockStop = direction === "LONG"
      ? currentPrice * (1 + PROFIT_LOCK_FLOOR_PCT / 100)
      : currentPrice * (1 - PROFIT_LOCK_FLOOR_PCT / 100);

    // ── Scale-in plan ────────────────────────────────────────
    const scaleInPlan = this.computeScaleInPlan(
      positionSize,
      state.probeMode,
      decision.confidence,
    );

    return {
      positionSize: Math.round(positionSize * 100) / 100,
      stopLoss: Math.round(stopLoss * 10000) / 10000,
      takeProfit: tp2Price, // primary TP is the final target
      trailingActivated: positionSize > 0,
      trailingParams: {
        atrMultiplier: this.atrMultiplier,
        breakEvenTrigger: Math.round(breakEvenTrigger * 10000) / 10000,
        profitLockTrigger: Math.round(profitLockTrigger * 10000) / 10000,
        profitLockStop: Math.round(profitLockStop * 10000) / 10000,
        currentTrailingStop: Math.round(stopLoss * 10000) / 10000,
      },
      takeProfitLevels: {
        tp1: {
          price: Math.round(tp1Price * 10000) / 10000,
          sizePct: TP1_SIZE_PCT,
        },
        tp2: {
          price: Math.round(tp2Price * 10000) / 10000,
          sizePct: 1 - TP1_SIZE_PCT,
        },
      },
      scaleInPlan,
      direction,
      riskRewardRatio: this.riskRewardRatio,
      maxPositionPct: MAX_POSITION_PCT,
    };
  }

  /**
   * Update the trailing stop based on the current price.
   * Call this every candle / price update while the position is open.
   *
   * Trailing stop rules:
   * 1. Only move in favorable direction (up for longs, down for shorts)
   * 2. Break-even: move to entry after price moves +1.5 ATR in profit
   * 3. Profit lock: if +7%, tighten to lock +3%
   */
  updateTrailingStop(
    currentStop: number,
    entryPrice: number,
    currentPrice: number,
    direction: "LONG" | "SHORT",
    atr: number,
  ): { newStop: number; reason: string } {
    let newStop = currentStop;
    let reason = "No update needed";

    const breakEvenDistance = atr * BREAK_EVEN_ATR_MULTIPLIER;
    const profitLockDistance = entryPrice * (PROFIT_LOCK_PCT / 100);

    if (direction === "LONG") {
      const profitPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      const profitFromEntry = currentPrice - entryPrice;

      // Profit lock check first (highest priority)
      if (profitPct >= PROFIT_LOCK_PCT) {
        const lockStop = entryPrice * (1 + PROFIT_LOCK_FLOOR_PCT / 100);
        if (lockStop > newStop) {
          newStop = lockStop;
          reason = `Profit lock: +${profitPct.toFixed(1)}% → stop tightened to +${PROFIT_LOCK_FLOOR_PCT}%`;
          return { newStop, reason };
        }
      }

      // Break-even check
      if (profitFromEntry >= breakEvenDistance && newStop < entryPrice) {
        newStop = entryPrice;
        reason = `Break-even: price moved +${(profitFromEntry / atr).toFixed(1)} ATR → stop to entry`;
        return { newStop, reason };
      }

      // Standard trailing: move stop up by the same ATR-based distance
      const trailingStop = currentPrice - (atr * this.atrMultiplier);
      if (trailingStop > newStop) {
        newStop = trailingStop;
        reason = `Trailing: stop raised to ${newStop.toFixed(4)} (ATR × ${this.atrMultiplier})`;
      }
    } else {
      // SHORT direction (mirror logic)
      const profitPct = ((entryPrice - currentPrice) / entryPrice) * 100;
      const profitFromEntry = entryPrice - currentPrice;

      // Profit lock check (highest priority)
      if (profitPct >= PROFIT_LOCK_PCT) {
        const lockStop = entryPrice * (1 - PROFIT_LOCK_FLOOR_PCT / 100);
        if (lockStop < newStop) {
          newStop = lockStop;
          reason = `Profit lock: +${profitPct.toFixed(1)}% → stop tightened to -${PROFIT_LOCK_FLOOR_PCT}%`;
          return { newStop, reason };
        }
      }

      // Break-even check
      if (profitFromEntry >= breakEvenDistance && newStop > entryPrice) {
        newStop = entryPrice;
        reason = `Break-even: price moved -${(profitFromEntry / atr).toFixed(1)} ATR → stop to entry`;
        return { newStop, reason };
      }

      // Standard trailing: move stop down
      const trailingStop = currentPrice + (atr * this.atrMultiplier);
      if (trailingStop < newStop) {
        newStop = trailingStop;
        reason = `Trailing: stop lowered to ${newStop.toFixed(4)} (ATR × ${this.atrMultiplier})`;
      }
    }

    return { newStop, reason };
  }

  /**
   * Check if the trailing stop has been hit.
   */
  isStopHit(
    currentPrice: number,
    stopPrice: number,
    direction: "LONG" | "SHORT",
  ): boolean {
    return direction === "LONG"
      ? currentPrice <= stopPrice
      : currentPrice >= stopPrice;
  }

  /**
   * Check if take profit level has been reached.
   * Returns which TP was hit (1, 2, or 0 for none).
   */
  checkTakeProfit(
    currentPrice: number,
    tp1: number,
    tp2: number,
    direction: "LONG" | "SHORT",
  ): 0 | 1 | 2 {
    if (direction === "LONG") {
      if (currentPrice >= tp2) return 2;
      if (currentPrice >= tp1) return 1;
    } else {
      if (currentPrice <= tp2) return 2;
      if (currentPrice <= tp1) return 1;
    }
    return 0;
  }

  // ── Private Helpers ──────────────────────────────────────────────────

  /**
   * Extract regime position size multiplier from the regime agent's report.
   * Falls back to 1.0 (neutral) if regime data is unavailable.
   */
  private extractRegimeMultiplier(reports: AgentReport[]): number {
    const regimeReport = reports.find((r) => r.role === "regime");
    if (!regimeReport?.data) return 1.0;

    const regimeData = regimeReport.data as Partial<RegimeClassification> | undefined;
    const mult = regimeData?.parameters?.positionSizeMultiplier;
    if (typeof mult === "number" && !isNaN(mult)) {
      return Math.max(0, Math.min(1.5, mult)); // clamp 0-1.5
    }
    return 1.0;
  }

  /**
   * Extract correlation position multiplier from the correlation agent's report.
   * Falls back to 1.0 if correlation data is unavailable.
   */
  private extractCorrelationMultiplier(reports: AgentReport[]): number {
    const corrReport = reports.find((r) => r.role === "correlation");
    if (!corrReport?.data) return 1.0;

    // Correlation agent provides positionMultiplier in its matrix data
    const matrixData = corrReport.data.matrix;
    if (matrixData?.positionMultiplier !== undefined) {
      const mult = Number(matrixData.positionMultiplier);
      if (!isNaN(mult)) {
        return Math.max(0, Math.min(1.5, mult));
      }
    }

    // Fallback: if correlation has riskLevel, adjust accordingly
    const riskLevel = corrReport.data.riskLevel;
    if (riskLevel === "HIGH") return 0.75;
    if (riskLevel === "ELEVATED") return 0.85;
    if (riskLevel === "NORMAL") return 1.0;

    return 1.0;
  }

  /**
   * Extract Devil's Advocate multiplier.
   * The DA (Devil's Advocate) is the confidence agent's consensus conflict detection.
   * If there are conflicts flagged, apply a haircut to position size.
   */
  private extractDevilAdvocateMultiplier(reports: AgentReport[]): number {
    const confidenceReport = reports.find((r) => r.role === "confidence");
    if (!confidenceReport?.data) return 1.0;

    // Check for conflict pairs — the confidence agent detects when agents disagree
    const conflicts = confidenceReport.data.conflicts as Array<{ severity: string }> | undefined;
    if (conflicts && conflicts.length > 0) {
      // More conflicts → bigger haircut
      const conflictCount = conflicts.length;
      const conflictMult = Math.max(0.5, 1.0 - (conflictCount * 0.1));
      return conflictMult;
    }

    // If the confidence agent's overall consensus score is low, reduce size
    const consensusScore = confidenceReport.data.consensusScore;
    if (typeof consensusScore === "number" && !isNaN(consensusScore)) {
      // consensusScore is 0-100; map to 0.5-1.0 range
      return Math.max(0.5, consensusScore / 100);
    }

    return 1.0;
  }

  /**
   * Compute confidence adjustment factor from the decision confidence.
   * Low confidence → reduced position; high confidence → full position.
   */
  private computeConfidenceAdjustment(confidence: number): number {
    // Map confidence (0-100) to a 0.25-1.25 multiplier
    // Below 50% confidence: scale down aggressively
    // Above 80%: slight boost
    if (confidence < 50) {
      return Math.max(0.25, confidence / 100);
    }
    if (confidence >= 85) {
      return 1.0 + ((confidence - 85) / 15) * 0.25; // 1.0 to 1.25
    }
    return 0.5 + ((confidence - 50) / 35) * 0.5; // 0.5 to 1.0
  }

  /**
   * Compute the scale-in plan based on probe mode and confidence.
   * 
   * - Probe mode + confidence < 70: step 1 (25%) → step 2 (50%) → step 3 (100%)
   * - Probe mode + confidence 70-85: step 1 (50%) → step 3 (100%)
   * - Normal: single step at full size
   */
  private computeScaleInPlan(
    fullSize: number,
    probeMode: boolean,
    confidence: number,
  ): ScaleInStep[] {
    if (!probeMode || confidence >= 85 || fullSize === 0) {
      // Normal mode: single step
      return [{
        step: 1,
        size: fullSize,
        triggerDescription: "Full position — confidence ≥ 85% or non-probe mode",
      }];
    }

    if (confidence < 70) {
      // Three-step scale-in
      return [
        {
          step: 1,
          size: fullSize * PROBE_STEP1_PCT,
          triggerDescription: "Probe entry (25%): wait for confirmation candle",
        },
        {
          step: 2,
          size: fullSize * PROBE_STEP2_PCT,
          triggerDescription: "Confirmation: price moves +1 ATR in favor → scale to 50%",
        },
        {
          step: 3,
          size: fullSize * PROBE_STEP3_PCT,
          triggerDescription: "Full conviction: second confirmation → scale to 100%",
        },
      ];
    }

    // Two-step scale-in for med confidence
    return [
      {
        step: 1,
        size: fullSize * PROBE_STEP2_PCT,
        triggerDescription: "Probe entry (50%): wait for confirmation",
      },
      {
        step: 3,
        size: fullSize * PROBE_STEP3_PCT,
        triggerDescription: "Confirmation candle → scale to 100%",
      },
    ];
  }

  /**
   * Estimate ATR as 2% of current price when no ATR data is available.
   */
  private estimateAtr(currentPrice: number): number {
    return currentPrice * 0.02; // 2% ATR estimate
  }

  // ── LLM Integration ─────────────────────────────────────────────────

  /**
   * Generate an AgentReport confirming the position management parameters.
   * The LLM is used here for reasoning/narrative, but actual computation
   * is deterministic via computePosition().
   */
  async generatePositionReport(
    output: PositionManagerOutput,
    context: PositionManagerContext,
  ): Promise<AgentReport> {
    const llm = await super.analyzeMarket({
      decision: {
        action: context.decision.action,
        confidence: context.decision.confidence,
      },
      positionManager: {
        positionSize: output.positionSize,
        stopLoss: output.stopLoss,
        takeProfit: output.takeProfit,
        trailingActivated: output.trailingActivated,
        scaleInSteps: output.scaleInPlan.length,
        direction: output.direction,
      },
    });

    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction: output.direction === "LONG" ? "LONG" : "SHORT",
      confidence: context.decision.confidence,
      reasoning: llm.reasoning
        ? `Position Manager: ${llm.reasoning.slice(0, 200)}`
        : this.buildReasoningSummary(output, context),
      data: output as unknown as Record<string, any>,
    };
  }

  /**
   * Build a deterministic reasoning summary when LLM is unavailable.
   */
  private buildReasoningSummary(
    output: PositionManagerOutput,
    ctx: PositionManagerContext,
  ): string {
    const parts: string[] = [];
    parts.push(`Position: $${output.positionSize.toFixed(2)} (max ${output.maxPositionPct * 100}% of portfolio)`);
    parts.push(`SL: $${output.stopLoss.toFixed(4)} | TP1 (${output.takeProfitLevels.tp1.sizePct * 100}%): $${output.takeProfitLevels.tp1.price.toFixed(4)} | TP2: $${output.takeProfitLevels.tp2.price.toFixed(4)}`);
    parts.push(`Trailing: ${output.trailingActivated ? "ACTIVE" : "OFF"} (ATR × ${output.trailingParams.atrMultiplier})`);
    parts.push(`Scale-in: ${output.scaleInPlan.length} step(s)`);
    parts.push(`Direction: ${output.direction} | RR: 1:${output.riskRewardRatio}`);
    return parts.join(" | ");
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let positionManagerInstance: PositionManagerAgent | null = null;

export function getPositionManager(): PositionManagerAgent {
  if (!positionManagerInstance) {
    positionManagerInstance = new PositionManagerAgent();
  }
  return positionManagerInstance;
}
