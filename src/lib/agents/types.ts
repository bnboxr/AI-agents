// ── Multi-Agent Trading Framework — Core Types ────────────────────

export type AgentRole =
  | "market"
  | "technical"
  | "news"
  | "macro"
  | "pattern"
  | "risk"
  | "strategy"
  | "execution"
  | "portfolio"
  | "learning"
  | "memory"
  | "reasoning"
  | "exit"
  | "smart_money"
  | "liquidity"
  | "regime"
  | "multi_timeframe"
  | "correlation"
  | "sentiment"
  | "volume"
  | "probability"
  | "confidence"
  | "devils_advocate"
  | "position_manager"
  | "system_audit";

export interface AgentReport {
  agentId: string;
  role: AgentRole;
  timestamp: number;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number; // 0-100
  reasoning: string;
  data: Record<string, any>;
}

export interface OrchestratorDecision {
  action: "BUY" | "SELL" | "HOLD" | "EXIT" | "WAIT";
  confidence: number;
  positionSize: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  agentReports: AgentReport[];
  timestamp: number;
}

export interface TradingState {
  capital: number;
  initialCapital: number;
  openPosition: boolean;
  positionDirection?: "LONG" | "SHORT";
  entryPrice?: number;
  currentPrice?: number;
  pnl: number;
  pnlPct: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  totalTrades: number;
  winRate: number;
  antiTiltMode: boolean;
  probeMode: boolean;
}
