// ── Multi-Agent Orchestrator ─────────────────────────────────────
// Gathers reports from all agents, scores them, and produces a final decision.

import { createServerFn } from "@tanstack/react-start";
import { MarketAnalysisAgent, type OHLCVBar } from "./market";
import { TechnicalAnalysisAgent, type TechnicalIndicators } from "./technical";
import { RiskManagementAgent, type RiskAssessment } from "./risk";
import { NewsSentimentAgent } from "./news";
import { MacroAnalysisAgent } from "./macro";
import { PatternRecognitionAgent } from "./pattern";
import type {
  AgentReport,
  AgentRole,
  OrchestratorDecision,
  TradingState,
} from "./types";

// ── Agent Registry ────────────────────────────────────────────────

const marketAgent = new MarketAnalysisAgent();
const technicalAgent = new TechnicalAnalysisAgent();
const riskAgent = new RiskManagementAgent();
const newsAgent = new NewsSentimentAgent();
const macroAgent = new MacroAnalysisAgent();
const patternAgent = new PatternRecognitionAgent();

// ── Scoring Weights ───────────────────────────────────────────────

const ROLE_WEIGHTS: Record<AgentRole, number> = {
  market: 0.12,
  technical: 0.12,
  pattern: 0.08,
  risk: 0.20,
  strategy: 0.18,
  portfolio: 0.10,
  news: 0.10,
  macro: 0.10,
  execution: 0,
  learning: 0,
  memory: 0,
  reasoning: 0,
  exit: 0,
};

// ── In-memory report store ────────────────────────────────────────

const recentReports: Map<string, AgentReport[]> = new Map();

// ── Default Trading State ─────────────────────────────────────────

let tradingState: TradingState = {
  capital: 10000,
  initialCapital: 10000,
  openPosition: false,
  pnl: 0,
  pnlPct: 0,
  consecutiveLosses: 0,
  consecutiveWins: 0,
  totalTrades: 0,
  winRate: 50,
  antiTiltMode: false,
  probeMode: false,
};

// ── Helpers ───────────────────────────────────────────────────────

function scoreDirection(reports: AgentReport[]): {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
} {
  let longScore = 0;
  let shortScore = 0;
  let neutralScore = 0;
  let totalWeight = 0;

  for (const report of reports) {
    const weight = ROLE_WEIGHTS[report.role] || 0;
    if (weight === 0) continue;
    totalWeight += weight;

    const weightedConf = report.confidence * weight;
    if (report.direction === "LONG") longScore += weightedConf;
    else if (report.direction === "SHORT") shortScore += weightedConf;
    else neutralScore += weightedConf;
  }

  if (totalWeight === 0) return { direction: "NEUTRAL", confidence: 0 };

  // Normalize
  longScore /= totalWeight;
  shortScore /= totalWeight;
  neutralScore /= totalWeight;

  const maxScore = Math.max(longScore, shortScore, neutralScore);
  if (maxScore === neutralScore || maxScore < 40)
    return { direction: "NEUTRAL", confidence: maxScore };
  if (longScore >= shortScore)
    return { direction: "LONG", confidence: longScore };
  return { direction: "SHORT", confidence: shortScore };
}

function computeProbeSize(normalSize: number): number {
  return normalSize * 0.25;
}

function hasExitSignal(reports: AgentReport[]): boolean {
  return reports.some((r) => r.confidence < 40 && r.role !== "news" && r.role !== "macro");
}

// ── Core: Gather Reports ──────────────────────────────────────────

export interface PriceContext {
  token: string;
  chainId: string;
  currentPrice: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  ohlcv?: OHLCVBar[];
  indicators?: TechnicalIndicators;
  atr?: number;
}

async function gatherReports(ctx: PriceContext): Promise<AgentReport[]> {
  const reports: AgentReport[] = [];

  // Market analysis
  const marketReport = await marketAgent.analyzeMarket(ctx);
  reports.push(marketReport);

  // Technical analysis (only if indicators provided)
  if (ctx.indicators) {
    const techReport = await technicalAgent.analyzeMarket({
      token: ctx.token,
      chainId: ctx.chainId,
      indicators: ctx.indicators,
    });
    reports.push(techReport);
  } else {
    // Provide a neutral placeholder
    reports.push({
      agentId: "technical-agent",
      role: "technical",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 50,
      reasoning: "No technical indicators provided — neutral signal.",
      data: {},
    });
  }

  // News sentiment analysis
  try {
    const newsResult = await newsAgent.analyzeNews({
      token: ctx.token,
      chainId: ctx.chainId,
    });
    reports.push({
      agentId: "news-agent",
      role: "news",
      timestamp: Date.now(),
      direction: newsResult.direction,
      confidence: newsResult.confidence,
      reasoning: newsResult.summary,
      data: {
        overallSentiment: newsResult.overallSentiment,
        headlineCount: newsResult.headlines.length,
        headlines: newsResult.headlines.slice(0, 5).map((h) => h.title),
      },
    });
  } catch {
    reports.push({
      agentId: "news-agent",
      role: "news",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "News sentiment analysis unavailable.",
      data: {},
    });
  }

  // Macro analysis
  try {
    const macroReport = await macroAgent.analyzeMarket();
    reports.push(macroReport);
  } catch {
    reports.push({
      agentId: "macro-agent",
      role: "macro",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "Macro analysis unavailable.",
      data: {},
    });
  }

  // Pattern recognition (only if OHLCV data provided)
  if (ctx.ohlcv && ctx.ohlcv.length >= 30) {
    try {
      const patterns = patternAgent.detectPatterns(ctx.ohlcv);
      const patternReport = await patternAgent.analyzeMarket({
        token: ctx.token,
        chainId: ctx.chainId,
        currentPrice: ctx.currentPrice,
        patterns,
        bars: ctx.ohlcv,
      });
      reports.push(patternReport);
    } catch {
      reports.push({
        agentId: "pattern-agent",
        role: "pattern",
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: 0,
        reasoning: "Pattern recognition unavailable.",
        data: {},
      });
    }
  } else {
    reports.push({
      agentId: "pattern-agent",
      role: "pattern",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 50,
      reasoning: "Insufficient OHLCV data for pattern detection.",
      data: {},
    });
  }

  // Risk assessment (always run)
  const atr = ctx.atr ?? ctx.currentPrice * 0.02; // default 2% ATR
  const tentativeDirection = scoreDirection(reports).direction;
  const riskReport = await riskAgent.analyzeMarket({
    state: tradingState,
    currentPrice: ctx.currentPrice,
    atr,
    direction: tentativeDirection === "NEUTRAL" ? "LONG" : tentativeDirection,
  });
  reports.push(riskReport);

  // Store reports
  const key = `${ctx.chainId}:${ctx.token}`;
  recentReports.set(key, reports);

  return reports;
}

// ── Core: Make Decision ───────────────────────────────────────────

function makeDecision(
  reports: AgentReport[],
  state: TradingState,
  priceContext: PriceContext,
): OrchestratorDecision {
  // Anti-tilt check
  if (state.consecutiveLosses >= 3) {
    tradingState.antiTiltMode = true;
    return {
      action: "WAIT",
      confidence: 0,
      positionSize: 0,
      stopLoss: 0,
      takeProfit: 0,
      reasoning: `ANTI-TILT active: ${state.consecutiveLosses} consecutive losses. Waiting for market conditions to improve.`,
      agentReports: reports,
      timestamp: Date.now(),
    };
  }

  // Exit signal check
  if (state.openPosition && hasExitSignal(reports)) {
    return {
      action: "EXIT",
      confidence: 100,
      positionSize: 0,
      stopLoss: 0,
      takeProfit: 0,
      reasoning:
        "Exit signal triggered: one or more agents have confidence below 40%.",
      agentReports: reports,
      timestamp: Date.now(),
    };
  }

  // Score direction
  const scored = scoreDirection(reports);

  // Extract risk data
  const riskReport = reports.find((r) => r.role === "risk");
  const riskData = riskReport?.data as unknown as RiskAssessment | undefined;
  const riskLevel = riskData?.riskLevel ?? "MEDIUM";

  // If confidence < 70, probe mode
  if (scored.confidence < 70) {
    tradingState.probeMode = true;
  }

  // Determine base position size from risk agent
  let positionSize = riskData?.maxPositionSize ?? state.capital * 0.01;
  if (state.probeMode && scored.confidence >= 70 && scored.confidence < 85) {
    positionSize = computeProbeSize(positionSize);
    tradingState.probeMode = true;
  } else if (state.probeMode && scored.confidence >= 85) {
    // Scale-in: after confirming probe, increase
    positionSize = positionSize * 2;
    tradingState.probeMode = false;
  }

  // Risk level override
  if (riskLevel === "CRITICAL") {
    return {
      action: "WAIT",
      confidence: 0,
      positionSize: 0,
      stopLoss: 0,
      takeProfit: 0,
      reasoning: `Risk level CRITICAL: ${riskData?.reason ?? "Position too risky."}`,
      agentReports: reports,
      timestamp: Date.now(),
    };
  }

  // Neutral / low confidence → HOLD
  if (scored.direction === "NEUTRAL" || scored.confidence < 50) {
    return {
      action: state.openPosition ? "HOLD" : "HOLD",
      confidence: scored.confidence,
      positionSize: 0,
      stopLoss: 0,
      takeProfit: 0,
      reasoning: "No strong directional signal. Holding.",
      agentReports: reports,
      timestamp: Date.now(),
    };
  }

  const action = scored.direction === "LONG" ? "BUY" : "SELL";
  const stopLoss = riskData?.stopLoss ?? 0;
  const takeProfit = riskData?.takeProfit ?? 0;

  const reasonLines: string[] = [];
  for (const r of reports) {
    if (r.confidence > 0) {
      reasonLines.push(
        `[${r.role}] ${r.direction} (${r.confidence}%): ${r.reasoning.slice(0, 100)}`,
      );
    }
  }

  return {
    action,
    confidence: scored.confidence,
    positionSize: Math.round(positionSize * 100) / 100,
    stopLoss,
    takeProfit,
    reasoning: reasonLines.join("\n"),
    agentReports: reports,
    timestamp: Date.now(),
  };
}

// ── State Management ──────────────────────────────────────────────

function updateTradingState(updates: Partial<TradingState>): TradingState {
  tradingState = { ...tradingState, ...updates };
  return tradingState;
}

// ── Server Functions ──────────────────────────────────────────────

export const runAgentAnalysis = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: PriceContext;
  }): Promise<{
    reports: AgentReport[];
    decision: OrchestratorDecision;
    state: TradingState;
  }> => {
    const reports = await gatherReports(data);
    const decision = makeDecision(reports, tradingState, data);
    return { reports, decision, state: { ...tradingState } };
  },
);

export const getAgentReports = createServerFn({ method: "GET" }).handler(
  async ({
    data,
  }: {
    data: { chainId?: string; token?: string };
  }): Promise<AgentReport[]> => {
    if (data.chainId && data.token) {
      const key = `${data.chainId}:${data.token}`;
      return recentReports.get(key) ?? [];
    }
    // Return all recent reports
    const all: AgentReport[] = [];
    for (const reports of recentReports.values()) {
      all.push(...reports);
    }
    return all;
  },
);

export const getOrchestratorDecision = createServerFn({
  method: "GET",
}).handler(async (): Promise<{
  decision: OrchestratorDecision | null;
  state: TradingState;
}> => {
  // Return latest decision from memory (or null if none)
  const allReports: AgentReport[] = [];
  for (const reports of recentReports.values()) {
    allReports.push(...reports);
  }
  const decision: OrchestratorDecision | null =
    allReports.length > 0
      ? {
          action: "HOLD",
          confidence: 50,
          positionSize: 0,
          stopLoss: 0,
          takeProfit: 0,
          reasoning: "Latest aggregated state from orchestrator.",
          agentReports: allReports.slice(-10),
          timestamp: Date.now(),
        }
      : null;
  return { decision, state: { ...tradingState } };
});

export const updateTradingStateFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: Partial<TradingState>;
  }): Promise<TradingState> => {
    return updateTradingState(data);
  },
);

export const resetTradingState = createServerFn({ method: "POST" }).handler(
  async (): Promise<TradingState> => {
    tradingState = {
      capital: 10000,
      initialCapital: 10000,
      openPosition: false,
      pnl: 0,
      pnlPct: 0,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      totalTrades: 0,
      winRate: 50,
      antiTiltMode: false,
      probeMode: false,
    };
    return { ...tradingState };
  },
);

// ── Exports for internal use ──────────────────────────────────────

export { gatherReports, makeDecision, scoreDirection, tradingState };
export type { PriceContext };
