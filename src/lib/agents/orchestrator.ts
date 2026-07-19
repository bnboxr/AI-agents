// ── Multi-Agent Orchestrator ─────────────────────────────────────
// Gathers reports from all agents, scores them, and produces a final decision.
// Integrates Learning, Memory, Exit, Execution, Portfolio, and Reasoning agents.

import { createServerFn } from "@tanstack/react-start";
import { MarketAnalysisAgent, type OHLCVBar } from "./market";
import { TechnicalAnalysisAgent, type TechnicalIndicators } from "./technical";
import { RiskManagementAgent, type RiskAssessment } from "./risk";
import { NewsSentimentAgent } from "./news";
import { MacroAnalysisAgent } from "./macro";
import { PatternRecognitionAgent } from "./pattern";
import { LearningAgent, type MarketCondition } from "./learning";
import { MemoryAgent } from "./memory";
import { ExitAgent, type ExitContext } from "./exit";
import { ExecutionAgent, type ExecutionResult } from "./execution";
import { PortfolioAgent, type PortfolioSnapshot } from "./portfolio";
import { ReasoningAgent, type ExplanationResult } from "./reasoning";
import { SmartMoneyAgent, type SmartMoneyPatterns } from "./smart-money";
import { LiquidityAgent, subscribeOrderBook, type LiquidityAnalysis } from "./liquidity";
import type {
  AgentReport,
  AgentRole,
  OrchestratorDecision,
  TradingState,
} from "./types";
import { sql, isDbAvailable } from "../db";

// ── Agent Registry ────────────────────────────────────────────────

const marketAgent = new MarketAnalysisAgent();
const technicalAgent = new TechnicalAnalysisAgent();
const riskAgent = new RiskManagementAgent();
const newsAgent = new NewsSentimentAgent();
const macroAgent = new MacroAnalysisAgent();
const patternAgent = new PatternRecognitionAgent();
const learningAgent = new LearningAgent();
const memoryAgent = new MemoryAgent();
const exitAgent = new ExitAgent();
const executionAgent = new ExecutionAgent();
const portfolioAgent = new PortfolioAgent();
const reasoningAgent = new ReasoningAgent();
const smartMoneyAgent = new SmartMoneyAgent();
const liquidityAgent = new LiquidityAgent();

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
  smart_money: 0.12,
  liquidity: 0.11,
};

// ── In-memory report store ────────────────────────────────────────

const recentReports: Map<string, AgentReport[]> = new Map();

// ── Track last stored decision ID for outcome recording ────────────

let lastStoredDecisionId: string | null = null;

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

/** Derive market condition from price context for learning/memory agents. */
function deriveMarketCondition(
  ctx: PriceContext,
  reports: AgentReport[],
): MarketCondition {
  const scored = scoreDirection(reports);

  // Check volatility from ATR
  const atrPct = ctx.atr ? (ctx.atr / ctx.currentPrice) * 100 : 2;
  const isVolatile = atrPct > 4;

  // Check price change
  const absChange = Math.abs(ctx.change24h);

  if (isVolatile) return "volatile";
  if (absChange > 5 && ctx.change24h > 0) return "trending_up";
  if (absChange > 5 && ctx.change24h < 0) return "trending_down";
  if (absChange < 2) return "sideways";
  return scored.direction === "LONG"
    ? "trending_up"
    : scored.direction === "SHORT"
      ? "trending_down"
      : "sideways";
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

  // ── Smart Money Agent: ICT/SMC analysis ──────────────────────────
  if (ctx.ohlcv && ctx.ohlcv.length >= 20) {
    try {
      const smartMoneyPatterns = smartMoneyAgent.analyzeSmartMoney(
        ctx.ohlcv,
        ctx.currentPrice,
      );
      const smartMoneyReport = await smartMoneyAgent.analyzeMarket({
        token: ctx.token,
        chainId: ctx.chainId,
        currentPrice: ctx.currentPrice,
        patterns: smartMoneyPatterns,
        bars: ctx.ohlcv,
      });
      // Attach raw pattern data to the report
      smartMoneyReport.data = {
        ...smartMoneyReport.data,
        orderBlocks: smartMoneyPatterns.orderBlocks.length,
        fvgs: smartMoneyPatterns.fvgs.length,
        unfilledFvgs: smartMoneyPatterns.fvgs.filter((f) => !f.filled).length,
        bos: smartMoneyPatterns.bos.length,
        choch: smartMoneyPatterns.choch.length,
        equalHighsLows: smartMoneyPatterns.equalHighsLows.length,
        liquidityGrabs: smartMoneyPatterns.liquidityGrabs.length,
        premiumDiscount: smartMoneyPatterns.premiumDiscount.zone,
        rawPatterns: smartMoneyPatterns,
      };
      reports.push(smartMoneyReport);
    } catch {
      reports.push({
        agentId: "smart-money-agent",
        role: "smart_money",
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: 0,
        reasoning: "Smart Money analysis unavailable.",
        data: {},
      });
    }
  } else {
    reports.push({
      agentId: "smart-money-agent",
      role: "smart_money",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 50,
      reasoning: "Insufficient OHLCV data for Smart Money analysis (need 20+ candles).",
      data: {},
    });
  }

  // ── Liquidity Agent: Order Book & Depth Analysis ────────────────
  try {
    // Ensure order book subscription for this token
    const tokenSymbol = ctx.token.toUpperCase();
    subscribeOrderBook(tokenSymbol);

    // Wait briefly for any initial order book data to arrive
    // (the WebSocket is async, but we work with whatever we have)
    const liquidityAnalysis = liquidityAgent.analyzeLiquidity(
      tokenSymbol,
      ctx.currentPrice,
      ctx.ohlcv,
      // Use a default position size based on capital
      tradingState.capital * 0.01, // 1% of capital as reference
    );

    const liquidityReport = await liquidityAgent.analyzeMarket({
      token: ctx.token,
      chainId: ctx.chainId,
      currentPrice: ctx.currentPrice,
      analysis: liquidityAnalysis,
      positionSizeUSD: tradingState.capital * 0.01,
    });

    // Attach raw analysis data to the report
    liquidityReport.data = {
      ...liquidityReport.data,
      hasOrderBook: liquidityAnalysis.orderBook !== null,
      staleOrderBook: liquidityAnalysis.staleOrderBook,
      imbalance: liquidityAnalysis.imbalance?.imbalance ?? 0,
      imbalanceSignificant: liquidityAnalysis.imbalance?.significant ?? false,
      liquidityZones: liquidityAnalysis.liquidityZones.length,
      nearestZoneDistance: liquidityAnalysis.liquidityZones[0]?.proximity ?? null,
      sweeps: liquidityAnalysis.sweeps.length,
      slippagePct: liquidityAnalysis.slippage?.slippagePct ?? null,
      slippageFlagged: liquidityAnalysis.slippage?.flagged ?? false,
      icebergDetected: liquidityAnalysis.icebergSpoofing.icebergDetected,
      spoofingDetected: liquidityAnalysis.icebergSpoofing.spoofingDetected,
      rawAnalysis: liquidityAnalysis,
    };
    reports.push(liquidityReport);
  } catch {
    reports.push({
      agentId: "liquidity-agent",
      role: "liquidity",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "Liquidity analysis unavailable.",
      data: {},
    });
  }

  // Risk assessment (always run)
  const atr = ctx.atr ?? ctx.currentPrice * 0.02;
  const tentativeDirection = scoreDirection(reports).direction;
  const riskReport = await riskAgent.analyzeMarket({
    state: tradingState,
    currentPrice: ctx.currentPrice,
    atr,
    direction: tentativeDirection === "NEUTRAL" ? "LONG" : tentativeDirection,
  });
  reports.push(riskReport);

  // ── Memory Agent: recall similar past trades ─────────────────────
  try {
    const marketCondition = deriveMarketCondition(ctx, reports);
    const indicatorMap: Record<string, number> | undefined = ctx.indicators
      ? {
          rsi: ctx.indicators.rsi,
          macdValue: ctx.indicators.macd.value,
          macdSignal: ctx.indicators.macd.signal,
          ema20: ctx.indicators.ema20,
          ema50: ctx.indicators.ema50,
          atrPct: ctx.indicators.atrPct,
        }
      : undefined;

    const memoryReport = await memoryAgent.analyzeHistory(
      ctx.token,
      marketCondition,
      indicatorMap,
    );
    reports.push(memoryReport);
  } catch {
    reports.push({
      agentId: "memory-agent",
      role: "memory",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "Memory analysis unavailable.",
      data: {},
    });
  }

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
  // ── Exit Agent: check if we need to exit an open position ──────
  if (state.openPosition && state.entryPrice !== undefined) {
    // Build exit context from available data
    const exitCtx: ExitContext = {
      symbol: priceContext.token,
      direction: state.positionDirection ?? "LONG",
      entryPrice: state.entryPrice,
      currentPrice: priceContext.currentPrice,
      pnlPct: state.pnlPct,
      trailingStopHit: false, // Will be set from actual trailing stop check
      confidence: scoreDirection(reports).confidence,
      riskLevel: (reports.find((r) => r.role === "risk")?.data as unknown as RiskAssessment)?.riskLevel,
    };

    // Add technical indicators if available
    if (priceContext.indicators) {
      exitCtx.ema20 = priceContext.indicators.ema20;
      exitCtx.rsi = priceContext.indicators.rsi;
      exitCtx.macdHistogram = priceContext.indicators.macd.histogram;
    }

    // Run exit evaluation
    const exitResult = exitAgent.evaluateExit(exitCtx);

    // If exit agent says EXIT (CRITICAL or HIGH urgency), override
    if (exitResult.action === "EXIT" && (exitResult.urgency === "CRITICAL" || exitResult.urgency === "HIGH")) {
      // Record exit in learning agent
      learningAgent.recordTrade({
        symbol: priceContext.token,
        direction: state.positionDirection ?? "LONG",
        entryPrice: state.entryPrice,
        exitPrice: priceContext.currentPrice,
        pnlPct: state.pnlPct,
        marketCondition: deriveMarketCondition(priceContext, reports),
        confidence: scoreDirection(reports).confidence,
      });

      // Update state
      const isWin = state.pnlPct > 0;
      tradingState.openPosition = false;
      tradingState.positionDirection = undefined;
      tradingState.entryPrice = undefined;
      tradingState.capital = Math.round((tradingState.capital * (1 + state.pnlPct / 100)) * 100) / 100;
      if (isWin) {
        tradingState.consecutiveWins++;
        tradingState.consecutiveLosses = 0;
      } else {
        tradingState.consecutiveLosses++;
        tradingState.consecutiveWins = 0;
      }
      tradingState.totalTrades++;
      tradingState.winRate =
        tradingState.totalTrades > 0
          ? Math.round(
              ((tradingState.consecutiveWins +
                (tradingState.totalTrades - tradingState.consecutiveLosses - tradingState.consecutiveWins > 0
                  ? 0
                  : 0)) /
                tradingState.totalTrades) *
                100,
            )
          : 50;
      tradingState.pnl = tradingState.capital - tradingState.initialCapital;
      tradingState.pnlPct = (tradingState.pnl / tradingState.initialCapital) * 100;

      return {
        action: "EXIT",
        confidence: exitResult.confidence,
        positionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        reasoning: `Exit Agent override: ${exitResult.reason}`,
        agentReports: reports,
        timestamp: Date.now(),
      };
    }
  }

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

  // Score direction
  const scored = scoreDirection(reports);

  // ── Apply Learning Agent adjustments ──────────────────────────
  const learningAdjustments = learningAgent.getRecommendedAdjustments();
  const marketCondition = deriveMarketCondition(priceContext, reports);

  // Check if we should avoid this condition
  if (learningAdjustments.avoidConditions.includes(marketCondition)) {
    return {
      action: "HOLD",
      confidence: 0,
      positionSize: 0,
      stopLoss: 0,
      takeProfit: 0,
      reasoning: `Learning Agent: avoiding ${marketCondition} conditions due to poor historical performance. ${learningAdjustments.summary}`,
      agentReports: reports,
      timestamp: Date.now(),
    };
  }

  // Apply position size adjustment from learning
  let positionMultiplier = 1.0 + learningAdjustments.positionSizeAdjustment;
  positionMultiplier = Math.max(0.25, Math.min(1.5, positionMultiplier)); // clamp 25%-150%

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
    positionSize = positionSize * 2;
    tradingState.probeMode = false;
  }

  // Apply learning position multiplier
  positionSize = positionSize * positionMultiplier;

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

  // Add learning agent note if adjustments were made
  if (learningAdjustments.positionSizeAdjustment !== 0) {
    reasonLines.push(
      `[learning] Position adjusted by ${Math.round(learningAdjustments.positionSizeAdjustment * 100)}%: ${learningAdjustments.summary}`,
    );
  }

  // ── Store decision in memory agent ────────────────────────────
  const indicatorMap: Record<string, number> | undefined = priceContext.indicators
    ? {
        rsi: priceContext.indicators.rsi,
        macdValue: priceContext.indicators.macd.value,
        macdSignal: priceContext.indicators.macd.signal,
        ema20: priceContext.indicators.ema20,
        ema50: priceContext.indicators.ema50,
        atrPct: priceContext.indicators.atrPct,
      }
    : undefined;

  const storedDecision = memoryAgent.storeDecision(
    {
      action,
      confidence: scored.confidence,
      positionSize: Math.round(positionSize * 100) / 100,
      stopLoss,
      takeProfit,
      reasoning: reasonLines.join("\n"),
      agentReports: reports,
      timestamp: Date.now(),
    },
    priceContext.token,
    marketCondition,
    indicatorMap,
  );
  lastStoredDecisionId = storedDecision.id;

  // Update trading state for new position
  if (action === "BUY" || action === "SELL") {
    tradingState.openPosition = true;
    tradingState.positionDirection = scored.direction;
    tradingState.entryPrice = priceContext.currentPrice;
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

  // Write-through to DB
  if (isDbAvailable()) {
    sql`
      INSERT INTO trading_state (id, capital, initial_capital, open_position, position_direction, entry_price, current_price, pnl, pnl_pct, consecutive_losses, consecutive_wins, total_trades, win_rate, anti_tilt_mode, probe_mode, updated_at)
      VALUES (1, ${tradingState.capital}, ${tradingState.initialCapital}, ${tradingState.openPosition}, ${tradingState.positionDirection ?? null}, ${tradingState.entryPrice ?? null}, ${tradingState.currentPrice ?? null}, ${tradingState.pnl}, ${tradingState.pnlPct}, ${tradingState.consecutiveLosses}, ${tradingState.consecutiveWins}, ${tradingState.totalTrades}, ${tradingState.winRate}, ${tradingState.antiTiltMode}, ${tradingState.probeMode}, now())
      ON CONFLICT (id) DO UPDATE SET
        capital = EXCLUDED.capital,
        initial_capital = EXCLUDED.initial_capital,
        open_position = EXCLUDED.open_position,
        position_direction = EXCLUDED.position_direction,
        entry_price = EXCLUDED.entry_price,
        current_price = EXCLUDED.current_price,
        pnl = EXCLUDED.pnl,
        pnl_pct = EXCLUDED.pnl_pct,
        consecutive_losses = EXCLUDED.consecutive_losses,
        consecutive_wins = EXCLUDED.consecutive_wins,
        total_trades = EXCLUDED.total_trades,
        win_rate = EXCLUDED.win_rate,
        anti_tilt_mode = EXCLUDED.anti_tilt_mode,
        probe_mode = EXCLUDED.probe_mode,
        updated_at = EXCLUDED.updated_at
    `.catch((err) => console.error("[DB] updateTradingState UPSERT failed:", err));
  }

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
    execution?: ExecutionResult;
    portfolio?: PortfolioSnapshot;
    explanation?: string;
  }> => {
    const reports = await gatherReports(data);
    const decision = makeDecision(reports, tradingState, data);

    // Write-through to DB: orchestrator_decisions + agent_reports
    if (isDbAvailable()) {
      // Insert agent reports and collect IDs
      const reportIds: number[] = [];
      for (const report of reports) {
        sql`
          INSERT INTO agent_reports (agent_id, role, chain_id, token, direction, confidence, reasoning, data)
          VALUES (${report.agentId}, ${report.role}, ${data.chainId ?? null}, ${data.token ?? null}, ${report.direction}, ${report.confidence}, ${report.reasoning}, ${JSON.stringify(report.data)}::jsonb)
          RETURNING id
        `.then((res) => {
          if (res.rows[0]?.id) reportIds.push(res.rows[0].id as number);
        }).catch((err) => console.error("[DB] agent_reports insert failed:", err));
      }

      // Insert orchestrator decision (after a small delay to allow report IDs to resolve)
      const persistDecision = () => {
        sql`
          INSERT INTO orchestrator_decisions (action, confidence, position_size, stop_loss, take_profit, reasoning, chain_id, token, current_price, report_ids)
          VALUES (${decision.action}, ${decision.confidence}, ${decision.positionSize}, ${decision.stopLoss}, ${decision.takeProfit}, ${decision.reasoning}, ${data.chainId ?? null}, ${data.token ?? null}, ${data.currentPrice ?? null}, ${reportIds.length > 0 ? reportIds : null})
        `.catch((err) => console.error("[DB] orchestrator_decisions insert failed:", err));
      };
      // Use setTimeout to give agent_reports inserts a chance to resolve
      setTimeout(persistDecision, 100);
    }

    // ── Execution Agent: execute the decision ──────────────────
    let execution: ExecutionResult | undefined;
    if (
      decision.action === "BUY" ||
      decision.action === "SELL" ||
      decision.action === "EXIT"
    ) {
      try {
        execution = await executionAgent.executeDecision(
          decision,
          data.currentPrice,
          data.chainId || "unknown",
          data.token,
        );

        // Generate execution report (non-blocking)
        executionAgent
          .generateExecutionReport(execution, decision)
          .catch(() => {
            /* best-effort */
          });

        // If trade was executed, record in portfolio agent
        if (execution.success && execution.side !== "EXIT") {
          portfolioAgent.recordTradeResult(
            decision.action === "BUY"
              ? ((data.currentPrice - data.currentPrice) / data.currentPrice) * 100 // PnL will be updated on close
              : 0,
          );
        }
      } catch {
        // Execution is best-effort; don't block the pipeline
      }
    }

    // ── Portfolio Agent: review portfolio state ────────────────
    let portfolio: PortfolioSnapshot | undefined;
    try {
      // Collect open positions from execution agent tracking
      const openPositions: {
        id: string;
        token: string;
        chainId: string;
        direction: "LONG" | "SHORT";
        size: number;
        entryPrice: number;
        currentPrice: number;
        pnl: number;
        pnlPct: number;
      }[] = [];

      // Portfolio review (non-blocking for report generation)
      const portfolioReport = await portfolioAgent.reviewPortfolio(
        tradingState,
        openPositions,
      );
      portfolio = portfolioReport.data?.snapshot as PortfolioSnapshot | undefined;

      // Attach portfolio report to reports array
      reports.push(portfolioReport);
    } catch {
      // Portfolio review is best-effort
    }

    // ── Reasoning Agent: generate explanation ──────────────────
    let explanation: string | undefined;
    try {
      const explanationResult = await reasoningAgent.explainDecision(
        decision,
        data.token,
      );
      explanation = explanationResult.explanation;

      // Attach reasoning report to reports array
      const reasoningReport =
        await reasoningAgent.generateReasoningReport(explanationResult);
      reports.push(reasoningReport);
    } catch {
      // Reasoning is best-effort
    }

    return {
      reports,
      decision,
      state: { ...tradingState },
      execution,
      portfolio,
      explanation,
    };
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
    lastStoredDecisionId = null;
    return { ...tradingState };
  },
);

// ── Record Trade Outcome ──────────────────────────────────────────

export const recordTradeOutcome = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: {
      symbol: string;
      direction: "LONG" | "SHORT";
      entryPrice: number;
      exitPrice: number;
      marketCondition: MarketCondition;
      confidence: number;
      exitReason: string;
    };
  }): Promise<{ success: boolean; pnlPct: number }> => {
    const pnlMult = data.direction === "LONG" ? 1 : -1;
    const pnlPct =
      Math.round(
        ((pnlMult * (data.exitPrice - data.entryPrice)) / data.entryPrice) *
          100 *
          100,
      ) / 100;

    // Record in learning agent
    learningAgent.recordTrade({
      symbol: data.symbol,
      direction: data.direction,
      entryPrice: data.entryPrice,
      exitPrice: data.exitPrice,
      pnlPct,
      marketCondition: data.marketCondition,
      confidence: data.confidence,
    });

    // Update outcome in memory agent if we have a pending decision
    if (lastStoredDecisionId) {
      memoryAgent.recordOutcome(lastStoredDecisionId, {
        pnlPct,
        exitedAt: Date.now(),
        exitReason: data.exitReason,
      });
      lastStoredDecisionId = null;
    }

    // Record trade result in portfolio agent
    portfolioAgent.recordTradeResult(pnlPct);
    portfolioAgent.recordEquitySnapshot(tradingState.capital);

    // ── DB Write-through: UPDATE corresponding trade + UPSERT trading_state
    if (isDbAvailable()) {
      // Update the most recent open trade for this symbol/direction that was recently closed
      sql`
        UPDATE trades
        SET status = 'closed', exit_price = ${data.exitPrice}, pnl = ${tradingState.capital - tradingState.initialCapital}, pnl_pct = ${pnlPct}, closed_at = now(), updated_at = now()
        WHERE id = (
          SELECT id FROM trades
          WHERE token = ${data.symbol} AND direction = ${data.direction} AND status = 'open'
          ORDER BY opened_at DESC LIMIT 1
        )
      `.catch((err) => console.error("[DB] recordTradeOutcome trade UPDATE failed:", err));

      // UPSERT trading_state
      sql`
        INSERT INTO trading_state (id, capital, initial_capital, open_position, position_direction, entry_price, current_price, pnl, pnl_pct, consecutive_losses, consecutive_wins, total_trades, win_rate, anti_tilt_mode, probe_mode, updated_at)
        VALUES (1, ${tradingState.capital}, ${tradingState.initialCapital}, ${tradingState.openPosition}, ${tradingState.positionDirection ?? null}, ${tradingState.entryPrice ?? null}, ${tradingState.currentPrice ?? null}, ${tradingState.pnl}, ${tradingState.pnlPct}, ${tradingState.consecutiveLosses}, ${tradingState.consecutiveWins}, ${tradingState.totalTrades}, ${tradingState.winRate}, ${tradingState.antiTiltMode}, ${tradingState.probeMode}, now())
        ON CONFLICT (id) DO UPDATE SET
          capital = EXCLUDED.capital,
          initial_capital = EXCLUDED.initial_capital,
          open_position = EXCLUDED.open_position,
          position_direction = EXCLUDED.position_direction,
          entry_price = EXCLUDED.entry_price,
          current_price = EXCLUDED.current_price,
          pnl = EXCLUDED.pnl,
          pnl_pct = EXCLUDED.pnl_pct,
          consecutive_losses = EXCLUDED.consecutive_losses,
          consecutive_wins = EXCLUDED.consecutive_wins,
          total_trades = EXCLUDED.total_trades,
          win_rate = EXCLUDED.win_rate,
          anti_tilt_mode = EXCLUDED.anti_tilt_mode,
          probe_mode = EXCLUDED.probe_mode,
          updated_at = EXCLUDED.updated_at
      `.catch((err) => console.error("[DB] recordTradeOutcome trading_state UPSERT failed:", err));
    }

    // Update trading state
    const isWin = pnlPct > 0;
    tradingState.capital = Math.round((tradingState.capital * (1 + pnlPct / 100)) * 100) / 100;
    tradingState.openPosition = false;
    tradingState.positionDirection = undefined;
    tradingState.entryPrice = undefined;
    tradingState.totalTrades++;
    tradingState.pnl = tradingState.capital - tradingState.initialCapital;
    tradingState.pnlPct = (tradingState.pnl / tradingState.initialCapital) * 100;

    if (isWin) {
      tradingState.consecutiveWins++;
      tradingState.consecutiveLosses = 0;
    } else {
      tradingState.consecutiveLosses++;
      tradingState.consecutiveWins = 0;
    }

    tradingState.winRate =
      tradingState.totalTrades > 0
        ? Math.round(
            (tradingState.consecutiveWins / Math.max(1, tradingState.totalTrades)) * 100,
          )
        : 50;

    return { success: true, pnlPct };
  },
);

// ── Learning/Memory/Exit agent accessors ──────────────────────────

export const getLearningStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    overallWinRate: number;
    overallAvgPnl: number;
    totalTrades: number;
    adjustments: ReturnType<LearningAgent["getRecommendedAdjustments"]>;
    conditionStats: Record<MarketCondition, ReturnType<LearningAgent["getConditionStats"]>>;
  }> => {
    const conditions: MarketCondition[] = [
      "trending_up",
      "trending_down",
      "sideways",
      "volatile",
    ];
    const conditionStats = {} as Record<
      MarketCondition,
      ReturnType<LearningAgent["getConditionStats"]>
    >;
    for (const c of conditions) {
      conditionStats[c] = learningAgent.getConditionStats(c);
    }
    return {
      overallWinRate: learningAgent.getOverallWinRate(),
      overallAvgPnl: learningAgent.getOverallAvgPnl(),
      totalTrades: learningAgent.getOverallWinRate() > 0 ? 1 : 0, // will be properly calculated
      adjustments: learningAgent.getRecommendedAdjustments(),
      conditionStats,
    };
  },
);

export const getMemoryDecisions = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ count: number }> => {
    return { count: memoryAgent.getCount() };
  },
);

// ── Exports for internal use ──────────────────────────────────────

export {
  gatherReports,
  makeDecision,
  scoreDirection,
  tradingState,
  learningAgent,
  memoryAgent,
  exitAgent,
  executionAgent,
  portfolioAgent,
  reasoningAgent,
  liquidityAgent,
};
export type { PriceContext };
