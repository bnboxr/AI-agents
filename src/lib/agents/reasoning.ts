// ── AI Reasoning Agent ──────────────────────────────────────────────
// Generates human-readable explanations for Orchestrator decisions.
// Includes self-audit and enhanced explainability with ✓/✗ signal tracking.
// Makes the AI trading decisions transparent and understandable.

import { BaseAgent } from "./base";
import type { AgentReport, OrchestratorDecision } from "./types";
import type { ExecutionResult } from "./execution";
import { getApiKey } from "~/lib/api-keys";

export interface ExplanationResult {
  decision: OrchestratorDecision;
  explanation: string;
  confidence: number;
}

export interface TradeAudit {
  passed: boolean;
  score: number; // 0-100
  entryRationale: string;
  withinRules: boolean;
  ruleViolations: string[];
  ignoredSignals: string[];
  whatWorked: string[];
  whatDidnt: string[];
  recommendations: string[];
  timestamp: number;
}

interface ExplainabilitySignal {
  bullishLabel: string;
  bearishLabel: string;
  check: (reports: AgentReport[], decision: OrchestratorDecision) => boolean;
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
   * Define the signal checks for enhanced explainability.
   * Each signal maps to specific agent report data.
   * Returns ✓ if any relevant agent contributed positively, ✗ otherwise.
   */
  private readonly EXPLAINABILITY_SIGNALS: ExplainabilitySignal[] = [
    {
      bullishLabel: "Trend ascendent",
      bearishLabel: "Trend descendent",
      check: (reports, decision) => {
        const targetDir = decision.action === "BUY" ? "LONG" : decision.action === "SELL" ? "SHORT" : "LONG";
        const market = reports.find((r) => r.role === "market");
        const tech = reports.find((r) => r.role === "technical");
        const mtf = reports.find((r) => r.role === "multi_timeframe");
        return (
          (market?.direction === targetDir && market.confidence > 50) ||
          (tech?.direction === targetDir && tech.confidence > 50) ||
          (mtf?.direction === targetDir && mtf.confidence > 50)
        );
      },
    },
    {
      bullishLabel: "Volum în creștere",
      bearishLabel: "Volum în scădere",
      check: (reports, decision) => {
        const vol = reports.find((r) => r.role === "volume");
        if (!vol) return false;
        const data = vol.data || {};
        const isBullish = decision.action === "BUY";
        if (isBullish) {
          return (
            data.compositeScore > 0 ||
            data.deltaClass === "BULLISH" ||
            data.obvTrend === "RISING" ||
            (vol.direction === "LONG" && vol.confidence > 50)
          );
        }
        return (
          data.compositeScore < 0 ||
          data.deltaClass === "BEARISH" ||
          data.obvTrend === "FALLING" ||
          (vol.direction === "SHORT" && vol.confidence > 50)
        );
      },
    },
    {
      bullishLabel: "BOS confirmat",
      bearishLabel: "BOS confirmat",
      check: (reports) => {
        const sm = reports.find((r) => r.role === "smart_money");
        if (!sm) return false;
        const data = sm.data || {};
        return (data.bos !== undefined && data.bos > 0) || (data.rawPatterns?.bos?.length > 0);
      },
    },
    {
      bullishLabel: "Sentiment pozitiv",
      bearishLabel: "Sentiment negativ",
      check: (reports, decision) => {
        const news = reports.find((r) => r.role === "news");
        const sent = reports.find((r) => r.role === "sentiment");
        const isBullish = decision.action === "BUY";
        if (isBullish) {
          const newsOk =
            news && news.data?.overallSentiment !== undefined
              ? Number(news.data.overallSentiment) > 0
              : false;
          const sentOk =
            sent && sent.data?.fearGreedIndex !== undefined
              ? Number(sent.data.fearGreedIndex) > 50
              : sent?.direction === "LONG" && sent.confidence > 50;
          return newsOk || sentOk;
        }
        const newsOk =
          news && news.data?.overallSentiment !== undefined
            ? Number(news.data.overallSentiment) < 0
            : false;
        const sentOk =
          sent && sent.data?.fearGreedIndex !== undefined
            ? Number(sent.data.fearGreedIndex) < 50
            : sent?.direction === "SHORT" && sent.confidence > 50;
        return newsOk || sentOk;
      },
    },
    {
      bullishLabel: "Risc acceptabil",
      bearishLabel: "Risc acceptabil",
      check: (reports) => {
        const risk = reports.find((r) => r.role === "risk");
        if (!risk) return false;
        const data = risk.data || {};
        const level = data.riskLevel || data.risk_level;
        return level === "LOW" || level === "MEDIUM";
      },
    },
    {
      bullishLabel: "FVG umplut",
      bearishLabel: "FVG umplut",
      check: (reports) => {
        const sm = reports.find((r) => r.role === "smart_money");
        if (!sm) return false;
        const data = sm.data || {};
        if (data.fvgs !== undefined && data.fvgs > 0) return true;
        if (data.unfilledFvgs !== undefined && data.unfilledFvgs > 0) return true;
        if (data.rawPatterns?.fvgs?.length > 0) {
          return data.rawPatterns.fvgs.some((f: any) => f.filled);
        }
        return false;
      },
    },
    {
      bullishLabel: "Probabilitate favorabilă",
      bearishLabel: "Probabilitate favorabilă",
      check: (reports, decision) => {
        const prob = reports.find((r) => r.role === "probability");
        const targetDir = decision.action === "BUY" ? "LONG" : decision.action === "SELL" ? "SHORT" : "LONG";
        return prob?.direction === targetDir && prob.confidence > 50;
      },
    },
    {
      bullishLabel: "Consens între agenți",
      bearishLabel: "Consens între agenți",
      check: (reports, decision) => {
        const conf = reports.find((r) => r.role === "confidence");
        const targetDir = decision.action === "BUY" ? "LONG" : decision.action === "SELL" ? "SHORT" : "LONG";
        return conf?.direction === targetDir && conf.confidence > 50;
      },
    },
  ];

  /**
   * Build the enhanced explainability format with ✓/✗ signal tracking.
   * Owner's exact format:
   *   BUY BTC
   *   Motive:
   *   ✓ Trend ascendent
   *   ✓ Volum în creștere
   *   ...
   *   Confidence: 94%
   *   Risk: 1.2%
   *   Expected RR: 1:4
   */
  private buildExplainabilityFormat(
    decision: OrchestratorDecision,
    reports: AgentReport[],
    token: string,
  ): string {
    const tokenUpper = token.toUpperCase();
    const action = decision.action;
    const lines: string[] = [];

    // Header
    lines.push(`${action} ${tokenUpper}`);
    lines.push("Motive:");

    // Evaluate each signal
    const isBullish = decision.action === "BUY";
    for (const signal of this.EXPLAINABILITY_SIGNALS) {
      const passed = signal.check(reports, decision);
      const label = isBullish ? signal.bullishLabel : signal.bearishLabel;
      lines.push(`${passed ? "✓" : "✗"} ${label}`);
    }

    // Confidence
    lines.push(`Confidence: ${Math.round(decision.confidence)}%`);

    // Risk %: extract from risk agent report
    const riskReport = reports.find((r) => r.role === "risk");
    const riskData = riskReport?.data || {};
    const riskPerTrade =
      riskData.riskPerTrade !== undefined
        ? Number(riskData.riskPerTrade)
        : riskData.risk_per_trade !== undefined
          ? Number(riskData.risk_per_trade)
          : null;
    const riskPct =
      riskPerTrade !== null
        ? `${(riskPerTrade * 100).toFixed(1)}%`
        : "N/A";
    lines.push(`Risk: ${riskPct}`);

    // Expected RR: compute from stopLoss / takeProfit / currentPrice
    const currentPrice =
      riskData.currentPrice ??
      (reports[0]?.data?.currentPrice as number | undefined);
    if (currentPrice && decision.stopLoss > 0 && decision.takeProfit > 0) {
      const risk = Math.abs(currentPrice - decision.stopLoss);
      const reward = Math.abs(decision.takeProfit - currentPrice);
      if (risk > 0) {
        const rr = reward / risk;
        lines.push(`Expected RR: 1:${rr.toFixed(1)}`);
      } else {
        lines.push(`Expected RR: N/A`);
      }
    } else {
      lines.push(`Expected RR: N/A`);
    }

    return lines.join("\n");
  }

  /**
   * Generate a natural language explanation for an Orchestrator decision.
   * Uses the enhanced explainability format with ✓/✗ signal tracking.
   * Falls back to GPT-4o enrichment if key signals are ambiguous.
   */
  async explainDecision(
    decision: OrchestratorDecision,
    token: string = "the asset",
  ): Promise<ExplanationResult> {
    const reports = decision.agentReports;

    // Build the primary explanation using the owner's format
    const explanation = this.buildExplainabilityFormat(decision, reports, token);

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

  /**
   * Self-audit: post-execution trade review using GPT-4o.
   * Returns a structured TradeAudit with pass/fail + recommendations.
   * Stores audit alongside trade in memory/DB via the returned object.
   *
   * GPT-4o prompt: "This trade was executed. Audit it:
   *   (1) Why did we enter?
   *   (2) Was it within rules?
   *   (3) Did we ignore any signal?
   *   (4) What worked?
   *   (5) What didn't?"
   */
  async auditTrade(
    decision: OrchestratorDecision,
    reports: AgentReport[],
  ): Promise<TradeAudit> {
    const apiKey = getApiKey("openai");
    if (!apiKey) {
      return this.buildFallbackAudit(decision, reports, "No OpenAI API key configured.");
    }

    // Build a detailed context for the audit
    const reportSummaries = reports
      .filter((r) => r.role !== "reasoning" && r.role !== "execution")
      .map((r) => {
        const dataStr = r.data ? ` | data: ${JSON.stringify(r.data).slice(0, 200)}` : "";
        return `[${r.role}] dir=${r.direction} conf=${r.confidence}% — ${r.reasoning.slice(0, 150)}${dataStr}`;
      })
      .join("\n");

    const context = {
      action: decision.action,
      confidence: Math.round(decision.confidence),
      positionSize: decision.positionSize,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      reasoning: decision.reasoning.slice(0, 500),
      timestamp: decision.timestamp,
      agentReports: reportSummaries,
    };

    const systemPrompt = `You are an internal audit specialist at a quantitative hedge fund. Your job is to conduct a post-trade audit. You review executed trades and determine whether they were sound.

For each audit, answer these 5 questions:
(1) Why did we enter this trade? Summarize the rationale from the agent reports.
(2) Was it within our risk rules? Check position size, stop loss, risk per trade.
(3) Did we ignore any signal? Check if any agent had a contrary or warning signal that was overlooked.
(4) What worked well in this decision? Identify strengths.
(5) What didn't work? Identify weaknesses, errors, or oversights.

Then provide:
- A pass/fail verdict (pass means the trade was well-reasoned and within rules)
- A score from 0-100
- Specific, actionable recommendations for improvement

Respond ONLY in JSON format:
{"passed":true|false,"score":0-100,"entryRationale":"...","withinRules":true|false,"ruleViolations":["violation1"],"ignoredSignals":["signal1"],"whatWorked":["strength1"],"whatDidnt":["weakness1"],"recommendations":["rec1","rec2"]}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(context, null, 2) },
          ],
          temperature: 0.3,
          max_tokens: 600,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return this.buildFallbackAudit(decision, reports, `GPT-4o API error: ${res.status}`);
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const text = data.choices?.[0]?.message?.content || "";

      // Parse the JSON response
      try {
        const cleaned = text.replace(/```json|```/g, "").trim();
        const json = JSON.parse(cleaned);

        return {
          passed: Boolean(json.passed),
          score: Math.min(100, Math.max(0, Number(json.score) || 50)),
          entryRationale: String(json.entryRationale || "No rationale provided."),
          withinRules: Boolean(json.withinRules),
          ruleViolations: Array.isArray(json.ruleViolations)
            ? json.ruleViolations.map(String)
            : [],
          ignoredSignals: Array.isArray(json.ignoredSignals)
            ? json.ignoredSignals.map(String)
            : [],
          whatWorked: Array.isArray(json.whatWorked)
            ? json.whatWorked.map(String)
            : [],
          whatDidnt: Array.isArray(json.whatDidnt)
            ? json.whatDidnt.map(String)
            : [],
          recommendations: Array.isArray(json.recommendations)
            ? json.recommendations.map(String)
            : [],
          timestamp: Date.now(),
        };
      } catch {
        return this.buildFallbackAudit(decision, reports, `Could not parse GPT-4o response: ${text.slice(0, 150)}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      return this.buildFallbackAudit(decision, reports, `Audit failed: ${reason}`);
    }
  }

  /**
   * Build a fallback audit when GPT-4o is unavailable.
   * Uses rules-based heuristics from the agent reports.
   */
  private buildFallbackAudit(
    decision: OrchestratorDecision,
    reports: AgentReport[],
    reason: string,
  ): TradeAudit {
    const riskReport = reports.find((r) => r.role === "risk");
    const riskData = riskReport?.data || {};
    const riskLevel = riskData.riskLevel || "MEDIUM";
    const daReport = reports.find((r) => r.role === "devils_advocate");

    const withinRules = riskLevel !== "CRITICAL" && !daReport?.data?.veto;
    const ruleViolations: string[] = [];
    if (riskLevel === "CRITICAL") ruleViolations.push("Risk level CRITICAL — position should have been blocked.");
    if (daReport?.data?.veto) ruleViolations.push("Devil's Advocate veto was active — trade should not have executed.");
    if (decision.positionSize <= 0) ruleViolations.push("Position size is zero or negative.");
    if (decision.stopLoss <= 0) ruleViolations.push("No stop loss set.");

    const highConfReports = reports.filter((r) => r.confidence > 60);
    const whatWorked = highConfReports.slice(0, 3).map((r) => `${r.role}: ${r.reasoning.slice(0, 80)}`);

    const lowConfReports = reports.filter((r) => r.confidence < 30 && r.confidence > 0);
    const whatDidnt = lowConfReports.slice(0, 3).map((r) => `${r.role}: ${r.reasoning.slice(0, 80)}`);

    const ignoredSignals: string[] = [];
    const decisionDirection = decision.action === "BUY" ? "LONG" : decision.action === "SELL" ? "SHORT" : "NEUTRAL";
    for (const r of reports) {
      if (r.direction !== "NEUTRAL" && r.direction !== decisionDirection && r.confidence > 30) {
        ignoredSignals.push(`${r.role} signalled ${r.direction} (${r.confidence}%)`);
      }
    }

    const passed = withinRules && ignoredSignals.length === 0;
    const score = passed ? 70 : withinRules ? 50 : 20;

    return {
      passed,
      score,
      entryRationale: `Action: ${decision.action}, Confidence: ${Math.round(decision.confidence)}%. ${decision.reasoning.slice(0, 150)}`,
      withinRules,
      ruleViolations,
      ignoredSignals,
      whatWorked: whatWorked.length > 0 ? whatWorked : ["No high-confidence agent contributions detected."],
      whatDidnt: whatDidnt.length > 0 ? whatDidnt : ["All agents are neutral or low-confidence."],
      recommendations: [
        `Fallback audit generated: ${reason}`,
        "Verify trade parameters before next execution.",
      ],
      timestamp: Date.now(),
    };
  }
}
