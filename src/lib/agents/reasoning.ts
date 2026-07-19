// ── AI Reasoning Agent ──────────────────────────────────────────────
// Generates human-readable explanations for Orchestrator decisions.
// Makes the AI trading decisions transparent and understandable.

import { BaseAgent } from "./base";
import type { AgentReport, OrchestratorDecision } from "./types";
import type { ExecutionResult } from "./execution";

export interface ExplanationResult {
  decision: OrchestratorDecision;
  explanation: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a financial communications expert who translates complex trading decisions into clear, concise explanations. You work at a quantitative hedge fund and your job is to explain AI trading decisions to human traders and investors.

When explaining a trade decision, include:
- The action taken (BUY/SELL/HOLD/EXIT/WAIT)
- The core reasons, drawing from agent reports (trend, technicals, risk, sentiment, etc.)
- Key metrics: RSI, MACD, sentiment score, confidence levels
- Risk assessment summary
- What would invalidate the thesis

Format your response as a single clear paragraph (2-5 sentences). Use this exact format:
"I [bought/sold/held] [TOKEN] because: [reasons]. Confidence: [X]%."

For exit explanations, include the PnL and exit reason.

Be specific with numbers. Mention which signals were strongest. Do NOT use markdown.

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"the clear explanation text","data":{"explanation":"same as reasoning","signals":["signal1","signal2"],"risks":["risk1","risk2"]}}`;

export class ReasoningAgent extends BaseAgent {
  constructor() {
    super({
      id: "reasoning-agent",
      role: "reasoning",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Extract the strongest signals from agent reports for explanation.
   */
  private extractKeySignals(reports: AgentReport[]): {
    signals: string[];
    metrics: Record<string, string>;
  } {
    const signals: string[] = [];
    const metrics: Record<string, string> = {};

    for (const report of reports) {
      if (report.confidence <= 0) continue;

      const data = report.data || {};

      switch (report.role) {
        case "market":
          if (data.trendStrength) {
            signals.push(`Trend: ${data.trendStrength} (${report.confidence}%)`);
          }
          if (data.momentum) {
            metrics.momentum = String(data.momentum);
          }
          break;
        case "technical":
          if (data.rsi !== undefined) {
            metrics.rsi = String(Math.round(data.rsi));
            if (data.rsi < 30) signals.push(`RSI: ${Math.round(data.rsi)} oversold`);
            else if (data.rsi > 70) signals.push(`RSI: ${Math.round(data.rsi)} overbought`);
            else signals.push(`RSI: ${Math.round(data.rsi)}`);
          }
          if (data.macdSignal) {
            signals.push(`MACD: ${data.macdSignal}`);
            metrics.macdSignal = String(data.macdSignal);
          }
          break;
        case "news":
          if (data.overallSentiment !== undefined) {
            const sent = Number(data.overallSentiment);
            const label = sent > 0.3 ? "positive" : sent < -0.3 ? "negative" : "neutral";
            signals.push(`News: ${label} (${sent > 0 ? "+" : ""}${Math.round(sent * 100)} sentiment)`);
            metrics.sentiment = String(Math.round(sent * 100));
          }
          break;
        case "risk":
          if (data.riskLevel) {
            signals.push(`Risk: ${data.riskLevel}`);
            metrics.riskLevel = String(data.riskLevel);
          }
          break;
        case "macro":
          if (data.overallBias) {
            signals.push(`Macro: ${data.overallBias}`);
          }
          break;
        case "pattern":
          if (data.patterns && Array.isArray(data.patterns) && data.patterns.length > 0) {
            signals.push(`Pattern: ${data.patterns[0]}`);
          }
          break;
      }
    }

    return { signals: signals.slice(0, 5), metrics };
  }

  /**
   * Generate a concise human-readable explanation from the decision signal data.
   * This is the fallback when GPT-4o is unavailable.
   */
  private buildFallbackExplanation(
    decision: OrchestratorDecision,
  ): string {
    const token = "the asset";
    const action = decision.action;
    const conf = Math.round(decision.confidence);

    const actionVerb =
      action === "BUY"
        ? "bought"
        : action === "SELL"
          ? "shorted"
          : action === "EXIT"
            ? "exited"
            : "held";

    const parts: string[] = [];
    for (const report of decision.agentReports) {
      if (report.confidence > 0 && report.role !== "reasoning" && report.role !== "execution" && report.role !== "portfolio") {
        parts.push(
          `${report.role}: ${report.direction} (${report.confidence}%)`,
        );
      }
    }

    if (parts.length > 0) {
      return `I ${actionVerb} ${token} because: ${parts.slice(0, 6).join(", ")}. Confidence: ${conf}%.`;
    }

    return `I ${actionVerb} ${token}. ${decision.reasoning}. Confidence: ${conf}%.`;
  }

  /**
   * Generate a natural language explanation for an Orchestrator decision.
   */
  async explainDecision(
    decision: OrchestratorDecision,
    token: string = "the asset",
  ): Promise<ExplanationResult> {
    const { signals, metrics } = this.extractKeySignals(decision.agentReports);

    const context = {
      action: decision.action,
      confidence: Math.round(decision.confidence),
      token,
      positionSize: decision.positionSize,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      signals,
      metrics,
      agentReasoning: decision.reasoning,
    };

    const report = await super.analyzeMarket(context);
    const isFallback = report.confidence === 0 || report.data?.fallback;

    const explanation = isFallback
      ? this.buildFallbackExplanation(decision)
      : report.reasoning;

    return {
      decision,
      explanation,
      confidence: decision.confidence,
    };
  }

  /**
   * Generate a natural language explanation for a position exit.
   */
  async explainExit(
    exitReason: string,
    pnlPct: number,
    token: string = "the asset",
  ): Promise<AgentReport> {
    const pnlFormatted = pnlPct > 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`;
    const context = {
      event: "exit",
      token,
      pnl: pnlFormatted,
      reason: exitReason,
    };

    const report = await super.analyzeMarket(context);
    const isFallback = report.confidence === 0 || report.data?.fallback;

    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 100,
      reasoning: isFallback
        ? `Exited ${token} with ${pnlFormatted} PnL. Reason: ${exitReason}`
        : report.reasoning,
      data: {
        explanation: isFallback
          ? `Exited ${token} with ${pnlFormatted} PnL. Reason: ${exitReason}`
          : report.reasoning,
        pnlPct,
        exitReason,
        token,
      },
    };
  }

  /**
   * Generate a full reasoning AgentReport for the orchestrator pipeline.
   */
  async generateReasoningReport(
    explanation: ExplanationResult,
  ): Promise<AgentReport> {
    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction: explanation.decision.action === "BUY" ? "LONG" : explanation.decision.action === "SELL" ? "SHORT" : "NEUTRAL",
      confidence: explanation.confidence,
      reasoning: explanation.explanation,
      data: {
        explanation: explanation.explanation,
        action: explanation.decision.action,
        confidence: explanation.confidence,
      },
    };
  }
}
