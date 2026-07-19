// ── Strategy Backtesting Types ──────────────────────────────────────

export type StrategyType = 'flash-loan-arbitrage' | 'yield-optimizer' | 'cross-chain';

export type TimeRange = '7d' | '30d' | '90d';

export interface BacktestConfig {
  strategy: StrategyType;
  timeRange: TimeRange;
  chainId: string;
  initialCapital: number; // USD
  /** Optional parameter overrides per strategy */
  params?: Record<string, number>;
}

export interface StrategyMetrics {
  sharpeRatio: number;
  maxDrawdown: number; // percentage, e.g. -15.2
  winRate: number; // percentage, e.g. 62.5
  totalReturn: number; // percentage, e.g. 23.4
  profitFactor: number;
  volatility: number; // annualized std dev
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number; // USD
  avgLoss: number; // USD
  bestTrade: number; // USD
  worstTrade: number; // USD
}

export interface Trade {
  index: number;
  timestamp: number;
  type: 'buy' | 'sell';
  price: number;
  pnl: number | null; // null for buy entries
  pnlPct: number | null;
  cumulativePnl: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  metrics: StrategyMetrics;
  trades: Trade[];
  equityCurve: EquityPoint[];
  startedAt: number;
  completedAt: number;
  priceDataPoints: number;
}
