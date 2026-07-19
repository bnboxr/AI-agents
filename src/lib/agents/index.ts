// ── Multi-Agent Trading Framework — Public API ────────────────────

export { BaseAgent } from "./base";
export type { BaseAgentConfig } from "./base";

export { MarketAnalysisAgent } from "./market";
export type { OHLCVBar } from "./market";

export { TechnicalAnalysisAgent } from "./technical";
export type { TechnicalIndicators } from "./technical";

export { RiskManagementAgent } from "./risk";
export type { RiskAssessment } from "./risk";

export {
  runAgentAnalysis,
  getAgentReports,
  getOrchestratorDecision,
  updateTradingStateFn,
  resetTradingState,
  gatherReports,
  makeDecision,
  scoreDirection,
  tradingState,
} from "./orchestrator";
export type { PriceContext } from "./orchestrator";

export type {
  AgentRole,
  AgentReport,
  OrchestratorDecision,
  TradingState,
} from "./types";
