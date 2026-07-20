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
import { ReasoningAgent, type ExplanationResult, type TradeAudit } from "./reasoning";
import { SmartMoneyAgent, type SmartMoneyPatterns } from "./smart-money";
import { LiquidityAgent, subscribeOrderBook, type LiquidityAnalysis } from "./liquidity";
import { RegimeDetectionAgent, classifyRegime } from "./regime";
import type { RegimeClassification } from "./regime";
import { MultiTimeframeAgent, type MultiTimeframeAnalysis } from "./multi-timeframe";
import { CorrelationAgent, getCorrelationAgent, type CorrelationMatrix } from "./correlation";
import { SentimentAgent, getSentimentAgent } from "./sentiment";
import { getVolumeAgent } from "./volume";
import { ProbabilityAgent } from "./probability";
import { ConfidenceAgent } from "./confidence";
import { DevilsAdvocateAgent } from "./devils-advocate";
import { PositionManagerAgent, getPositionManager } from "./position-manager";
import type { PositionManagerOutput } from "./position-manager";
import { isKillSwitchActive, getKillSwitchReason, markApiHealthy, recordLastPrice } from "../risk-engine";
import { getCapitalState } from "~/lib/capital-manager";
import type {
  AgentReport,
  AgentRole,
  OrchestratorDecision,
  TradingState,
} from "./types";
import { getApiKey } from "~/lib/api-keys";
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
const regimeAgent = new RegimeDetectionAgent();
const multiTimeframeAgent = new MultiTimeframeAgent();
const correlationAgent = getCorrelationAgent();
const sentimentAgent = getSentimentAgent();
const volumeAgent = getVolumeAgent();
const probabilityAgent = new ProbabilityAgent();
const confidenceAgent = new ConfidenceAgent();
const devilsAdvocateAgent = new DevilsAdvocateAgent();
const positionManager = getPositionManager();

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
  regime: 0.10,
  multi_timeframe: 0.09,
  correlation: 0.10,
  sentiment: 0.08,
  volume: 0.09,
  probability: 0.12,
  confidence: 0.13,
  devils_advocate: 0.15,
  position_manager: 0.08,
  system_audit: 0, // Monitoring only — not a trading signal agent
};

// Snapshot of original weights for auto-weight adjustment baseline
const BASE_WEIGHTS: Record<AgentRole, number> = { ...ROLE_WEIGHTS };

// ── In-memory report store ────────────────────────────────────────

const recentReports: Map<string, AgentReport[]> = new Map();

// ── Track last stored decision ID for outcome recording ────────────

let lastStoredDecisionId: string | null = null;

// ── Track last decision's agent reports for per-agent accuracy ─────

let lastDecisionReports: AgentReport[] = [];

// ── Default Trading State ─────────────────────────────────────────

const capitalState = getCapitalState();

let tradingState: TradingState = {
  capital: capitalState.trading,
  initialCapital: capitalState.initial,
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
    let weight = ROLE_WEIGHTS[report.role] || 0;
    if (weight === 0) continue;

    // ── Apply discovered pattern modifiers ──────────────────────
    // Learning agent adjusts weights based on discovered patterns
    const patternModifier = learningAgent.applyPatternModifiers(report.role, {
      direction: report.direction,
      confidence: report.confidence,
      reasoning: report.reasoning,
    });
    if (patternModifier !== 0) {
      // Modify effective confidence: patterns boost/penalize confidence
      const adjustedConf = Math.max(0, Math.min(100, report.confidence + patternModifier));
      weight = weight * (adjustedConf / report.confidence);
    }

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

  // Macro analysis — uses real-time correlations from CorrelationAgent
  try {
    // Compute correlation matrix for real-time macro correlation values
    const corrMatrix = correlationAgent.getMatrix();
    const corrContext = {
      dxyCryptoCorr: corrMatrix.pairs.find((p) => p.pair === "DXY-CRYPTO")?.baseline ?? -0.5,
      sp500CryptoCorr: corrMatrix.pairs.find((p) => p.pair === "BTC-SPX")?.baseline ?? 0.6,
      goldCryptoCorr: corrMatrix.pairs.find((p) => p.pair === "BTC-GOLD")?.baseline ?? 0.3,
    };
    const macroReport = await macroAgent.analyzeMarket({ correlations: corrContext });
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

  // ── Regime Detection Agent: Market regime classification ──────
  if (ctx.ohlcv && ctx.ohlcv.length >= 20) {
    try {
      // Rules-based regime classification (synchronous, no API call)
      const classification = regimeAgent.detectRegime(ctx.ohlcv, ctx.currentPrice);

      // GPT-4o synthesis for strategic recommendations
      const synthesis = await regimeAgent.synthesize(
        ctx.token,
        ctx.chainId,
        ctx.currentPrice,
        classification,
      );

      const regimeReport: AgentReport = {
        agentId: "regime-agent",
        role: "regime",
        timestamp: Date.now(),
        direction: synthesis.direction,
        confidence: synthesis.confidence,
        reasoning: `Regime: ${classification.regime.replace(/_/g, " ")} (ADX ${classification.adx}, Vol ${classification.volatility}%). ${synthesis.reasoning}`,
        data: {
          regime: classification.regime,
          adx: classification.adx,
          volatility: classification.volatility,
          trendStrength: classification.trendStrength,
          activeStrategies: synthesis.activeStrategies,
          disabledStrategies: synthesis.disabledStrategies,
          riskAdjustment: synthesis.riskAdjustment,
          parameters: classification.parameters,
          classification,
          synthesis,
        },
      };
      reports.push(regimeReport);
    } catch {
      reports.push({
        agentId: "regime-agent",
        role: "regime",
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: 0,
        reasoning: "Regime detection unavailable.",
        data: {},
      });
    }
  } else {
    reports.push({
      agentId: "regime-agent",
      role: "regime",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 50,
      reasoning: "Insufficient OHLCV data for regime detection (need 20+ candles).",
      data: {},
    });
  }

  // ── Multi-Timeframe Agent: 7-timeframe confluence analysis ─────
  if (ctx.ohlcv && ctx.ohlcv.length >= 20) {
    try {
      // Rules-based multi-timeframe analysis (synchronous, no API call)
      const mtfAnalysis = multiTimeframeAgent.analyzeMultiTimeframe(ctx.ohlcv);

      // GPT-4o synthesis for directional bias
      const mtfReport = await multiTimeframeAgent.analyzeMarket({
        token: ctx.token,
        chainId: ctx.chainId,
        currentPrice: ctx.currentPrice,
        analysis: mtfAnalysis,
        bars: ctx.ohlcv,
      });

      // Attach full analysis data
      mtfReport.data = {
        ...mtfReport.data,
        confluenceScore: mtfAnalysis.confluenceScore,
        higherTimeframeBlocked: mtfAnalysis.higherTimeframeBlocked,
        blockDirection: mtfAnalysis.blockDirection,
        divergenceDetected: mtfAnalysis.divergenceDetected,
        divergenceSeverity: mtfAnalysis.divergenceSeverity,
        timeframeScores: mtfAnalysis.timeframeScores.map((s) => ({
          timeframe: s.timeframe,
          score: s.score,
          direction: s.direction,
          adx: s.adx,
          rsi: s.rsi,
        })),
        rawAnalysis: mtfAnalysis,
      };
      reports.push(mtfReport);
    } catch {
      reports.push({
        agentId: "multi-tf-agent",
        role: "multi_timeframe",
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: 0,
        reasoning: "Multi-timeframe analysis unavailable.",
        data: {},
      });
    }
  } else {
    reports.push({
      agentId: "multi-tf-agent",
      role: "multi_timeframe",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 50,
      reasoning: "Insufficient OHLCV data for multi-timeframe analysis (need 20+ candles).",
      data: {},
    });
  }

  // ── Correlation Agent: cross-asset correlation analysis ─────────
  try {
    // Ensure correlation agent is initialized
    correlationAgent.initialize().catch(() => {
      /* best-effort background init */
    });

    const corrMatrix = correlationAgent.getMatrix();
    const corrReport = await correlationAgent.analyzeMarket({ matrix: corrMatrix });
    // Attach full matrix data to the report
    corrReport.data = {
      ...corrReport.data,
      matrix: corrMatrix,
      riskLevel: corrMatrix.riskLevel,
      divergenceScore: corrMatrix.divergenceScore,
      positionMultiplier: corrMatrix.positionMultiplier,
      pairCount: corrMatrix.pairs.length,
      breakdownCount: corrMatrix.pairs.filter((p) => p.breakdown !== "NORMAL").length,
      pairs: corrMatrix.pairs.map((p) => ({
        pair: p.pair,
        baseline: p.baseline,
        short: p.short,
        delta: p.delta,
        breakdown: p.breakdown,
        signFlipped: p.signFlipped,
      })),
    };
    reports.push(corrReport);
  } catch {
    reports.push({
      agentId: "correlation-agent",
      role: "correlation",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "Correlation analysis unavailable.",
      data: {},
    });
  }

  // ── Sentiment Agent: Fear & Greed + contrarian psychology ─────────
  try {
    const sentimentReport = await sentimentAgent.analyzeMarket({});
    reports.push(sentimentReport);
  } catch {
    reports.push({
      agentId: "sentiment-agent",
      role: "sentiment",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "Sentiment analysis unavailable.",
      data: {},
    });
  }

  // ── Volume Agent: OBV, Delta, Climax, A/D, VWAP ────────────────
  if (ctx.ohlcv && ctx.ohlcv.length >= 10) {
    try {
      const { analyzeVolume } = await import("./volume");
      const volumeAnalysis = analyzeVolume(ctx.ohlcv, ctx.currentPrice);
      const volumeReport = await volumeAgent.analyzeMarket({
        token: ctx.token,
        chainId: ctx.chainId,
        currentPrice: ctx.currentPrice,
        ohlcv: ctx.ohlcv,
        analysis: volumeAnalysis,
      });
      // Attach full analysis data
      volumeReport.data = {
        ...volumeReport.data,
        obv: volumeAnalysis.obv,
        obvTrend: volumeAnalysis.obvTrend,
        volumeDelta: volumeAnalysis.volumeDelta,
        deltaClass: volumeAnalysis.deltaClass,
        climax: volumeAnalysis.climax,
        adPattern: volumeAnalysis.adPattern,
        vwap: volumeAnalysis.vwap,
        vwapPosition: volumeAnalysis.vwapPosition,
        compositeScore: volumeAnalysis.compositeScore,
        scores: volumeAnalysis.scores,
      };
      reports.push(volumeReport);
    } catch (err) {
      reports.push({
        agentId: "volume-agent",
        role: "volume",
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: 0,
        reasoning: `Volume analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        data: {},
      });
    }
  } else {
    reports.push({
      agentId: "volume-agent",
      role: "volume",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 50,
      reasoning: "Insufficient OHLCV data for volume analysis (need 10+ candles).",
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

  // ── Probability Agent: Bayesian/Monte Carlo/Kelly ──────────────────
  try {
    const probMarketCondition = deriveMarketCondition(ctx, reports);
    const riskData = riskReport.data as unknown as RiskAssessment | undefined;

    // Feed trade history from learning agent
    const allTrades = (learningAgent as any).trades ?? [];
    const conditionStats = (learningAgent as any).conditionStats ?? new Map();
    probabilityAgent.feedTradeData(allTrades, conditionStats);

    // Derive trend score from existing reports
    let trendScore = 50;
    const regimeReport = reports.find((r) => r.role === "regime");
    if (regimeReport?.data?.trendStrength != null) {
      trendScore = Number(regimeReport.data.trendStrength);
    }

    // Run probability pipeline
    const probResult = probabilityAgent.computeProbability({
      symbol: ctx.token,
      currentPrice: ctx.currentPrice,
      atr,
      trendScore,
      direction: tentativeDirection === "NEUTRAL" ? "LONG" : tentativeDirection,
      marketCondition: probMarketCondition,
      riskData,
      bars: ctx.ohlcv,
    });

    // Synthesize with GPT-4o
    const probReport = await probabilityAgent.synthesize(probResult);

    // Map BULLISH/BEARISH/NEUTRAL to LONG/SHORT/NEUTRAL for downstream compatibility
    if (probReport.direction === "NEUTRAL" && probResult.direction === "BULLISH") {
      probReport.direction = "LONG";
    } else if (probReport.direction === "NEUTRAL" && probResult.direction === "BEARISH") {
      probReport.direction = "SHORT";
    }

    reports.push(probReport);
  } catch {
    reports.push({
      agentId: "probability-agent",
      role: "probability",
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "Probability analysis unavailable.",
      data: {},
    });
  }

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

  // ── Confidence Agent: consensus, conflict detection, calibration ──
  // Runs LAST — synthesizes ALL other agent reports.
  try {
    const consensusResult = confidenceAgent.computeConfidence(reports);
    const confidenceReport = await confidenceAgent.synthesize(consensusResult);

    // Map BULLISH/BEARISH/NEUTRAL to LONG/SHORT/NEUTRAL for downstream compatibility
    if (confidenceReport.direction === "NEUTRAL" && consensusResult.consensusDirection === "BULLISH") {
      confidenceReport.direction = "LONG";
    } else if (confidenceReport.direction === "NEUTRAL" && consensusResult.consensusDirection === "BEARISH") {
      confidenceReport.direction = "SHORT";
    }

    reports.push(confidenceReport);
  } catch {
    reports.push({
      agentId: "confidence-agent",
      role: "confidence" as AgentRole,
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: "Confidence analysis unavailable.",
      data: {},
    });
  }

  // Store reports
  const key = `${ctx.chainId}:${ctx.token}`;
  recentReports.set(key, reports);

  return reports;
}

// ── Dialogue Phase ──────────────────────────────────────────────────
// After gathering reports, top agents are questioned to clarify their
// reasoning. GPT-4o synthesises a dialogue; confidence scores are
// adjusted based on the clarity of each response.

async function runDialogue(
  reports: AgentReport[],
  context: PriceContext,
): Promise<{
  enrichedReports: AgentReport[];
  dialogueLog: string;
}> {
  const apiKey = getApiKey("openai");
  if (!apiKey) {
    return { enrichedReports: reports, dialogueLog: "" };
  }

  // ── Pick top agents by confidence ──────────────────────────────
  const highConfidence = reports
    .filter((r) => r.confidence > 60)
    .sort((a, b) => b.confidence - a.confidence);

  const top: AgentReport[] = highConfidence.slice(0, 3);

  // ── Add conflicting agents (high confidence, opposite direction) ──
  const scored = scoreDirection(reports);
  const majorityDir = scored.direction;
  if (majorityDir !== "NEUTRAL") {
    for (const r of reports) {
      if (
        r.confidence > 50 &&
        r.direction !== majorityDir &&
        r.direction !== "NEUTRAL" &&
        !top.some((t) => t.agentId === r.agentId)
      ) {
        top.push(r);
        if (top.length >= 5) break; // cap at 5 for performance
      }
    }
  }

  const dialogueLines: string[] = [];
  const enrichedReports: AgentReport[] = reports.map((r) => ({ ...r }));

  for (const agent of top) {
    try {
      const systemPrompt =
        `You are the ${agent.role} agent in an AI hedge fund orchestrator. ` +
        `You are being questioned to clarify your analysis. Be concise (1-3 sentences). ` +
        `Respond with JSON: {"direction":"LONG|SHORT|NEUTRAL","confidence":0-100,"reasoning":"..."}`;

      const userPrompt =
        `You previously analysed this trade (${context.token} @ ${context.currentPrice}) ` +
        `and gave: direction=${agent.direction}, confidence=${agent.confidence}%. ` +
        `Your original reasoning: "${agent.reasoning}"\n\n` +
        `Based on your analysis, is this trade a good idea? Explain briefly.`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

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
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 200,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        dialogueLines.push(
          `→ ${agent.role}: "${agent.reasoning.slice(0, 80)}"`,
        );
        continue;
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const text = data.choices?.[0]?.message?.content || "";

      // Parse the structured response
      let parsedConfidence: number | null = null;
      let parsedReasoning: string = text;
      try {
        const cleaned = text.replace(/```json|```/g, "").trim();
        const json = JSON.parse(cleaned);
        parsedConfidence = Number(json.confidence);
        parsedReasoning = json.reasoning || text;
      } catch {
        parsedReasoning = text.slice(0, 120);
      }

      // Blend confidence: average original + dialogue confidence
      if (
        parsedConfidence !== null &&
        !isNaN(parsedConfidence) &&
        parsedConfidence >= 0 &&
        parsedConfidence <= 100
      ) {
        const idx = enrichedReports.findIndex(
          (r) => r.agentId === agent.agentId,
        );
        if (idx !== -1) {
          enrichedReports[idx].confidence = Math.round(
            (enrichedReports[idx].confidence + parsedConfidence) / 2,
          );
          // Use the clarified reasoning if it's non-trivial
          if (parsedReasoning.length > 10) {
            enrichedReports[idx].reasoning = parsedReasoning.slice(0, 200);
          }
        }
      }

      dialogueLines.push(
        `→ ${agent.role}: "${parsedReasoning.slice(0, 120)}"`,
      );
    } catch {
      // GPT-4o call failed — keep original reasoning and confidence
      dialogueLines.push(
        `→ ${agent.role}: "${agent.reasoning.slice(0, 80)}"`,
      );
    }
  }

  const dialogueLog =
    dialogueLines.length > 0
      ? `🤖 DIALOGUE:\n${dialogueLines.join("\n")}`
      : "";

  return { enrichedReports, dialogueLog };
}

// ── Core: Make Decision ───────────────────────────────────────────

function makeDecision(
  reports: AgentReport[],
  state: TradingState,
  priceContext: PriceContext,
  dialogueLog?: string,
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
      reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}ANTI-TILT active: ${state.consecutiveLosses} consecutive losses. Waiting for market conditions to improve.`,
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
      reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}Learning Agent: avoiding ${marketCondition} conditions due to poor historical performance. ${learningAdjustments.summary}`,
      agentReports: reports,
      timestamp: Date.now(),
    };
  }

  // Apply position size adjustment from learning
  let positionMultiplier = 1.0 + learningAdjustments.positionSizeAdjustment;
  positionMultiplier = Math.max(0.25, Math.min(1.5, positionMultiplier)); // clamp 25%-150%

  // ── Apply Correlation Agent multiplier ──────────────────────────
  const corrReport = reports.find((r) => r.role === "correlation");
  const corrMatrixData = corrReport?.data?.matrix as CorrelationMatrix | undefined;
  if (corrMatrixData?.dataAvailable) {
    // Correlation agent's position multiplier further reduces risk during breakdowns
    const corrMult = corrMatrixData.positionMultiplier;
    positionMultiplier = positionMultiplier * corrMult;
    positionMultiplier = Math.max(0, Math.min(1.5, positionMultiplier));

    // HALT override from correlation agent
    if (corrMatrixData.riskLevel === "HALT") {
      return {
        action: "WAIT",
        confidence: 0,
        positionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}🚨 CORRELATION HALT: Severe correlation breakdown detected (divergence score: ${corrMatrixData.divergenceScore}). ${corrReport?.reasoning?.slice(0, 150) ?? "Multiple pairs have broken down — systemic risk elevated."}`,
        agentReports: reports,
        timestamp: Date.now(),
      };
    }
  }

  // ── Devil's Advocate: find reasons NOT to trade ───────────────
  // Owner's most-requested agent. Runs BEFORE final decision.
  // Uses synchronous red-flag detection (rules-based) + optional GPT-4o synthesis.
  // If VETO → override to WAIT/NEUTRAL immediately.
  let daLine = "";
  try {
    const daContext = {
      token: priceContext.token,
      currentPrice: priceContext.currentPrice,
      ohlcv: priceContext.ohlcv,
      reports,
      // Optional: extract from liquidity agent report if available
    };

    // Attempt to enrich with liquidity data from agent reports
    const liqReport = reports.find((r) => r.role === "liquidity");
    if (liqReport?.data) {
      const liqData = liqReport.data as Record<string, any>;
      if (liqData.fundingRate !== undefined) {
        (daContext as any).fundingRate = liqData.fundingRate;
      }
      if (liqData.openInterestChange24h !== undefined) {
        (daContext as any).openInterestChange24h = liqData.openInterestChange24h;
      }
      if (liqData.spread !== undefined) {
        (daContext as any).spread = liqData.spread;
      }
      if (liqData.avgSpread !== undefined) {
        (daContext as any).avgSpread = liqData.avgSpread;
      }
    }

    // Also check for funding/oi directly in report data
    const marketReport = reports.find((r) => r.role === "market");
    if ((daContext as any).fundingRate === undefined && (marketReport?.data as any)?.fundingRate !== undefined) {
      (daContext as any).fundingRate = (marketReport?.data as any).fundingRate;
    }

    const daResult = devilsAdvocateAgent.detectRedFlags(daContext as any);

    // ── VETO: Block trade immediately ──
    if (daResult.veto || daResult.severity === "VETO") {
      const flagReasons = daResult.flags.map((f) => f.label).join(" + ");
      daLine = `⚠️ devils_advocate: "VETO — ${flagReasons}"`;
      return {
        action: "WAIT",
        confidence: 0,
        positionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}${daLine}\n→ DECISION: WAIT\n\n🚨 DEVIL'S ADVOCATE VETO: ${daResult.flagCount} red flags — ${flagReasons}. Trade blocked. ${daResult.flags.map((f) => f.detail).join("; ")}`,
        agentReports: reports,
        timestamp: Date.now(),
      };
    }

    // ── OBJECTION: Reduce position and confidence ──
    if (daResult.severity === "OBJECTION") {
      const flagReasons = daResult.flags.map((f) => f.label).join(" + ");
      daLine = `⚠️ devils_advocate: "OBJECTION — ${flagReasons}"`;
      // Apply confidence reduction
      const originalConfidence = scored.confidence;
      scored.confidence = Math.max(0, originalConfidence - daResult.confidenceReduction);

      // Apply position multiplier (only if lower than current)
      positionMultiplier = Math.min(positionMultiplier, daResult.positionMultiplier);

      // Push a report for visibility
      reports.push({
        agentId: "devils-advocate-agent",
        role: "devils_advocate" as AgentRole,
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: daResult.flagCount * 15,
        reasoning: `OBJECTION (${daResult.flagCount} flags): ${flagReasons}. Confidence reduced by ${daResult.confidenceReduction}%, position ×${daResult.positionMultiplier}.`,
        data: {
          flags: daResult.flags.map((f) => ({ id: f.id, label: f.label, detail: f.detail })),
          severity: daResult.severity,
          positionMultiplier: daResult.positionMultiplier,
          confidenceReduction: daResult.confidenceReduction,
          veto: false,
        },
      });
    }
  } catch (err) {
    // Devil's Advocate is best-effort — don't block pipeline on errors
    console.error("[DevilsAdvocate] Error in red flag detection:", err);
  }

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
      reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}${daLine ? daLine + "\n" : ""}→ DECISION: WAIT\n\nRisk level CRITICAL: ${riskData?.reason ?? "Position too risky."}`,
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
      reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}${daLine ? daLine + "\n" : ""}→ DECISION: HOLD\n\nNo strong directional signal. Holding.`,
      agentReports: reports,
      timestamp: Date.now(),
    };
  }

  // ── Multi-Timeframe Block Check ────────────────────────────────
  // If 4h+ strongly bearish → block longs; 4h+ strongly bullish → block shorts
  const mtfReport = reports.find((r) => r.role === "multi_timeframe");
  const mtfBlocked = mtfReport?.data?.higherTimeframeBlocked === true;
  const mtfBlockDirection = mtfReport?.data?.blockDirection as
    | "LONG"
    | "SHORT"
    | null
    | undefined;

  if (mtfBlocked && mtfBlockDirection) {
    if (scored.direction === "LONG" && mtfBlockDirection === "LONG") {
      return {
        action: "HOLD",
        confidence: scored.confidence,
        positionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}${daLine ? daLine + "\n" : ""}→ DECISION: HOLD\n\n🚫 MULTI-TF BLOCK: Higher timeframe(s) strongly bearish — blocking LONG entries despite ${scored.direction} signal (${scored.confidence}%). ${mtfReport?.reasoning?.slice(0, 100) ?? ""}`,
        agentReports: reports,
        timestamp: Date.now(),
      };
    }
    if (scored.direction === "SHORT" && mtfBlockDirection === "SHORT") {
      return {
        action: "HOLD",
        confidence: scored.confidence,
        positionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        reasoning: `${dialogueLog ? dialogueLog + "\n" : ""}${daLine ? daLine + "\n" : ""}→ DECISION: HOLD\n\n🚫 MULTI-TF BLOCK: Higher timeframe(s) strongly bullish — blocking SHORT entries despite ${scored.direction} signal (${scored.confidence}%). ${mtfReport?.reasoning?.slice(0, 100) ?? ""}`,
        agentReports: reports,
        timestamp: Date.now(),
      };
    }
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

  // ── Build final reasoning with dialogue ───────────────────────
  const dialogueHeader = dialogueLog || "";
  const decisionLine = `→ DECISION: ${action}`;
  const fullReasoning = [
    dialogueHeader,
    daLine,
    decisionLine,
    "",
    ...reasonLines,
  ]
    .filter(Boolean)
    .join("\n");

  // ── Capture agent reports for per-agent accuracy tracking ──────
  lastDecisionReports = reports;

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
      reasoning: fullReasoning,
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
    reasoning: fullReasoning,
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
    audit?: TradeAudit;
  }> => {
    // ── Kill Switch Check ─────────────────────────────────────────
    // Runs synchronously at the start of every analysis cycle.
    if (isKillSwitchActive()) {
      const reason = getKillSwitchReason();
      const killDecision: OrchestratorDecision = {
        action: "WAIT",
        confidence: 0,
        positionSize: 0,
        stopLoss: 0,
        takeProfit: 0,
        reasoning: `🚨 KILL SWITCH ACTIVE: ${reason}. All trading halted. Manual reset required.`,
        agentReports: [],
        timestamp: Date.now(),
      };
      return {
        reports: [],
        decision: killDecision,
        state: { ...tradingState },
      };
    }

    // Mark API as healthy (we received data successfully)
    markApiHealthy();

    // Record price for corrupt data detection
    if (data.currentPrice > 0) {
      recordLastPrice(data.currentPrice);
    }

    const reports = await gatherReports(data);
    
    // ── Dialogue Phase: question top agents to clarify reasoning ──
    const { enrichedReports, dialogueLog } = await runDialogue(reports, data);
    const decision = makeDecision(enrichedReports, tradingState, data, dialogueLog);

    // ── Position Manager: refine execution parameters ────────────────
    let positionManagerOutput: PositionManagerOutput | undefined;
    if (decision.action === "BUY" || decision.action === "SELL") {
      try {
        positionManagerOutput = positionManager.computePosition({
          decision,
          reports: enrichedReports,
          state: tradingState,
          currentPrice: data.currentPrice,
          atr: data.atr,
        });

        // Override decision with refined position sizing from Position Manager
        decision.positionSize = positionManagerOutput.positionSize;
        decision.stopLoss = positionManagerOutput.stopLoss;
        decision.takeProfit = positionManagerOutput.takeProfit;

        // Generate position manager report (non-blocking)
        positionManager
          .generatePositionReport(positionManagerOutput, {
            decision,
            reports: enrichedReports,
            state: tradingState,
            currentPrice: data.currentPrice,
            atr: data.atr,
          })
          .then((pmReport) => {
            finalReports.push(pmReport);
          })
          .catch(() => {
            /* best-effort */
          });
      } catch (err) {
        console.error("[PositionManager] computePosition failed:", err);
      }
    }

    // Use enriched reports for downstream consumers (DB, portfolio, etc.)
    const finalReports = enrichedReports;

    // Write-through to DB: orchestrator_decisions + agent_reports
    if (isDbAvailable()) {
      // Insert agent reports and collect IDs
      const reportIds: number[] = [];
      for (const report of finalReports) {
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
      finalReports.push(portfolioReport);
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
      finalReports.push(reasoningReport);
    } catch {
      // Reasoning is best-effort
    }

    // ── Self Audit: post-execution trade review ──────────────────
    // Runs after execution and explanation to audit the trade quality.
    let audit: TradeAudit | undefined;
    if (
      decision.action === "BUY" ||
      decision.action === "SELL" ||
      decision.action === "EXIT"
    ) {
      try {
        audit = await reasoningAgent.auditTrade(decision, finalReports);

        // Store audit alongside trade in memory if we have a stored decision ID
        if (lastStoredDecisionId && audit) {
          memoryAgent.storeAudit(lastStoredDecisionId, audit);
        }

        // Persist audit to DB via agent_memory table
        if (isDbAvailable()) {
          sql`
            INSERT INTO agent_memory (agent_id, memory_type, chain_id, token, summary, payload, importance)
            VALUES (
              ${"reasoning-agent"},
              ${"trade_audit"},
              ${data.chainId ?? null},
              ${data.token ?? null},
              ${`Audit: ${audit.passed ? "PASS" : "FAIL"} (score: ${audit.score}/100)`},
              ${JSON.stringify(audit)}::jsonb,
              ${audit.passed ? 5 : 9}
            )
          `.catch((err) => console.error("[DB] audit insert failed:", err));
        }
      } catch (err) {
        console.error("[Audit] Self-audit failed:", err);
        // Audit is best-effort — don't block the pipeline
      }
    }

    return {
      reports: finalReports,
      decision,
      state: { ...tradingState },
      execution,
      portfolio,
      explanation,
      audit,
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
    const capState = getCapitalState();
    tradingState = {
      capital: capState.trading,
      initialCapital: capState.initial,
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
  }): Promise<{
    success: boolean;
    pnlPct: number;
    weightAdjusted?: boolean;
    patternsDiscovered?: number;
  }> => {
    const pnlMult = data.direction === "LONG" ? 1 : -1;
    const pnlPct =
      Math.round(
        ((pnlMult * (data.exitPrice - data.entryPrice)) / data.entryPrice) *
          100 *
          100,
      ) / 100;

    // ── Extract agent signals from last decision reports ──────────
    const agentSignals = lastDecisionReports.map((r) => ({
      role: r.role,
      direction: r.direction,
    }));

    // Record in learning agent with per-agent signal tracking
    learningAgent.recordTradeWithSignals(
      {
        symbol: data.symbol,
        direction: data.direction,
        entryPrice: data.entryPrice,
        exitPrice: data.exitPrice,
        pnlPct,
        marketCondition: data.marketCondition,
        confidence: data.confidence,
        timestamp: Date.now(),
      },
      agentSignals,
    );

    // Update outcome in memory agent if we have a pending decision
    if (lastStoredDecisionId) {
      memoryAgent.recordOutcome(lastStoredDecisionId, {
        pnlPct,
        exitedAt: Date.now(),
        exitReason: data.exitReason,
      });
      lastStoredDecisionId = null;
    }

    // ── Auto-Weight Adjustment: every 20 closed trades ──────────────
    let weightAdjusted = false;
    if (learningAgent.isWeightAdjustmentDue()) {
      const adjustments = learningAgent.adjustWeights(BASE_WEIGHTS);
      if (adjustments && adjustments.length > 0) {
        // Apply new weights to ROLE_WEIGHTS
        for (const adj of adjustments) {
          ROLE_WEIGHTS[adj.role] = adj.newWeight;
        }

        // Log to DB: orchestrator_weight_history
        if (isDbAvailable()) {
          for (const adj of adjustments) {
            sql`
              INSERT INTO orchestrator_weight_history (role, weight, reason)
              VALUES (${adj.role}, ${adj.newWeight}, ${adj.reason})
            `.catch((err) =>
              console.error(
                "[DB] orchestrator_weight_history insert failed:",
                err,
              ),
            );
          }
        }

        // Log to agent_memory for audit trail
        if (isDbAvailable()) {
          sql`
            INSERT INTO agent_memory (agent_id, memory_type, chain_id, token, summary, payload, importance)
            VALUES (
              ${"learning-agent"},
              ${"weight_adjustment"},
              ${null},
              ${null},
              ${`Auto-weight adjustment: ${adjustments.length} agents updated (trade #${tradingState.totalTrades + 1})`},
              ${JSON.stringify(adjustments)}::jsonb,
              ${7}
            )
          `.catch((err) =>
            console.error("[DB] weight_adjustment agent_memory insert failed:", err),
          );
        }

        weightAdjusted = true;
        console.log(
          `[Orchestrator] Weights adjusted — ${adjustments.length} agents updated`,
        );
      }
    }

    // ── Pattern Discovery: every 50 closed trades ───────────────────
    let patternsDiscovered = 0;
    if (learningAgent.isPatternDiscoveryDue()) {
      try {
        const patterns = await learningAgent.discoverPatterns();
        patternsDiscovered = patterns.length;

        // Store discovered patterns in agent_memory
        if (isDbAvailable() && patterns.length > 0) {
          sql`
            INSERT INTO agent_memory (agent_id, memory_type, chain_id, token, summary, payload, importance)
            VALUES (
              ${"learning-agent"},
              ${"discovered_patterns"},
              ${null},
              ${null},
              ${`Pattern discovery: ${patterns.length} patterns found (trade #${tradingState.totalTrades + 1})`},
              ${JSON.stringify(patterns)}::jsonb,
              ${8}
            )
          `.catch((err) =>
            console.error(
              "[DB] discovered_patterns agent_memory insert failed:",
              err,
            ),
          );
        }
      } catch (err) {
        console.error("[Orchestrator] Pattern discovery failed:", err);
      }
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

    return { success: true, pnlPct, weightAdjusted, patternsDiscovered };
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
  runDialogue,
  scoreDirection,
  tradingState,
  learningAgent,
  memoryAgent,
  exitAgent,
  executionAgent,
  portfolioAgent,
  reasoningAgent,
  liquidityAgent,
  regimeAgent,
  multiTimeframeAgent,
  correlationAgent,
  sentimentAgent,
  volumeAgent,
  probabilityAgent,
  confidenceAgent,
  devilsAdvocateAgent,
  positionManager,
};
export type { PriceContext };
