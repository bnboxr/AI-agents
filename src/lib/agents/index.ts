// ── Multi-Agent Trading Framework — Public API ────────────────────

export { BaseAgent } from "./base";
export type { BaseAgentConfig } from "./base";

export { MarketAnalysisAgent } from "./market";
export type { OHLCVBar } from "./market";

export { TechnicalAnalysisAgent } from "./technical";
export type { TechnicalIndicators } from "./technical";

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
} from "./orchestrator";
export type { PriceContext } from "./orchestrator";

export type {
  AgentRole,
  AgentReport,
  OrchestratorDecision,
  TradingState,
} from "./types";
