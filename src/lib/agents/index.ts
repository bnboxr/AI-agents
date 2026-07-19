// ── Multi-Agent Trading Framework — Public API ────────────────────

export { BaseAgent } from "./base";
export type { BaseAgentConfig } from "./base";

export { MarketAnalysisAgent } from "./market";
export type { OHLCVBar } from "./market";

export { TechnicalAnalysisAgent } from "./technical";
export type { TechnicalIndicators } from "./technical";
export { computeLiveIndicators } from "./technical";

export { RiskManagementAgent } from "./risk";
export type { RiskAssessment } from "./risk";

export { NewsSentimentAgent } from "./news";
export type { NewsHeadline, ScoredHeadline } from "./news";

export { MacroAnalysisAgent } from "./macro";
export type { MacroData, MacroCorrelation } from "./macro";

export { PatternRecognitionAgent } from "./pattern";
export type { PriceExtrema, DetectedPattern } from "./pattern";

export { LearningAgent } from "./learning";
export type {
  TradeRecord,
  MarketCondition,
  ConditionStats,
  LearningAdjustments,
} from "./learning";

export { MemoryAgent } from "./memory";
export type { StoredDecision, SimilarTrade } from "./memory";

export { ExitAgent } from "./exit";
export type { ExitContext, ExitResult } from "./exit";

export { ExecutionAgent } from "./execution";
export type { ExecutionMode, ExecutionResult } from "./execution";

export { PortfolioAgent } from "./portfolio";
export type { PortfolioSnapshot, PortfolioPosition, PortfolioMetrics } from "./portfolio";

export { ReasoningAgent } from "./reasoning";
export type { ExplanationResult } from "./reasoning";

export { SmartMoneyAgent } from "./smart-money";
export type {
  OrderBlock,
  FairValueGap,
  StructureBreak,
  EqualLevels,
  LiquidityGrab,
  PremiumDiscountZone,
  SmartMoneyPatterns,
} from "./smart-money";

export { LiquidityAgent, getOrderBook, subscribeOrderBook } from "./liquidity";
export type {
  OrderBook,
  OrderBookLevel,
  LiquidityZone,
  LiquiditySweep,
  ImbalanceResult,
  SlippageEstimate,
  IcebergSpoofingResult,
  LiquidityAnalysis,
} from "./liquidity";

export { RegimeDetectionAgent, classifyRegime } from "./regime";
export type {
  MarketRegime,
  RegimeClassification,
  RegimeParameters,
} from "./regime";

export { MultiTimeframeAgent } from "./multi-timeframe";
export type {
  TimeframeScore,
  MultiTimeframeAnalysis,
} from "./multi-timeframe";

export { ProbabilityAgent } from "./probability";
export type { ProbabilityResult } from "./probability";

export {
  runAgentAnalysis,
  getAgentReports,
  getOrchestratorDecision,
  updateTradingStateFn,
  resetTradingState,
  recordTradeOutcome,
  getLearningStats,
  getMemoryDecisions,
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
  regimeAgent,
  multiTimeframeAgent,
  correlationAgent,
  sentimentAgent,
  volumeAgent,
  probabilityAgent,
} from "./orchestrator";
export type { PriceContext } from "./orchestrator";

export { CorrelationAgent, getCorrelationAgent, pearsonR, logReturns } from "./correlation";
export type {
  PricePoint,
  CorrelationPairData,
  CorrelationMatrix,
} from "./correlation";

export { SentimentAgent, getSentimentAgent } from "./sentiment";
export type { FearGreedData, SentimentContext } from "./sentiment";

export { VolumeAgent, getVolumeAgent, analyzeVolume, computeOBV, computeVolumeDelta, detectVolumeClimax, detectAccumDist, computeAnchoredVWAP, computeVolumeScore } from "./volume";
export type { VolumeAnalysis, VolumeContext } from "./volume";

export type {
  AgentRole,
  AgentReport,
  OrchestratorDecision,
  TradingState,
} from "./types";
