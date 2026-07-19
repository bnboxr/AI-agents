// ── Portfolio Agent ─────────────────────────────────────────────────
// Tracks portfolio health: equity, exposure, allocation, diversification.
// Monitors concentration risk and calculates performance metrics.

import { BaseAgent } from "./base";
import type { AgentReport, TradingState } from "./types";

export interface PortfolioSnapshot {
  totalEquity: number;
  initialCapital: number;
  absolutePnl: number;
  pnlPct: number;
  exposure: number; // % of capital deployed
  exposureUsd: number;
  positions: PortfolioPosition[];
  diversificationScore: number; // 0-100, higher = more diversified
  concentrationWarnings: string[];
  metrics: PortfolioMetrics;
}

export interface PortfolioPosition {
  id: string;
  token: string;
  chainId: string;
  direction: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  allocationPct: number; // % of total equity
}

export interface PortfolioMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  winRate: number;
  totalTrades: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
}

const SYSTEM_PROMPT = `You are a portfolio manager at a top-tier hedge fund. Your specialty is portfolio construction, risk management, and capital allocation across multiple assets.

Review the provided portfolio state and assess:
- Overall portfolio health (GREEN / YELLOW / RED)
- Concentration risk: any single position > 25% of portfolio
- Diversification: how well is capital spread across assets?
- Rebalancing suggestions: should we reduce or increase exposure?
- Risk-adjusted returns: Sharpe ratio, Sortino ratio assessment

Key rules:
- No single position should exceed 25% of total equity
- Target at least 3 uncorrelated positions for proper diversification
- Cash reserve: always keep at least 10% in cash for opportunities
- Drawdown management: if drawdown > 15%, reduce position sizes by 50%

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"portfolio review","data":{"health":"GREEN"|"YELLOW"|"RED","concentrationRisk":true|false,"rebalancingSuggestions":["suggestion1","suggestion2"],"cashReserveAdequate":true|false,"summary":"brief overall assessment"}}`;

export class PortfolioAgent extends BaseAgent {
  /** Maximum allocation for a single position (% of equity). */
  private readonly MAX_SINGLE_ALLOCATION = 0.25;
  /** Minimum cash reserve (% of equity). */
  private readonly MIN_CASH_RESERVE = 0.10;
  /** Risk-free rate for Sharpe/Sortino (annualized). */
  private readonly RISK_FREE_RATE = 0.04; // 4%

  /** Historical trade outcomes for metric calculation. */
  private tradeReturns: number[] = [];
  /** Historical equity curve for drawdown calculation. */
  private equityHistory: number[] = [];

  constructor() {
    super({
      id: "portfolio-agent",
      role: "portfolio",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Record a trade outcome for metric tracking.
   */
  recordTradeResult(pnlPct: number): void {
    this.tradeReturns.push(pnlPct);
    // Keep last 200 trades max to avoid unbounded memory
    if (this.tradeReturns.length > 200) {
      this.tradeReturns = this.tradeReturns.slice(-200);
    }
  }

  /**
   * Record equity snapshot for drawdown tracking.
   */
  recordEquitySnapshot(equity: number): void {
    this.equityHistory.push(equity);
    if (this.equityHistory.length > 500) {
      this.equityHistory = this.equityHistory.slice(-500);
    }
  }

  /**
   * Get the full portfolio state snapshot.
   */
  getPortfolioState(
    tradingState: TradingState,
    openPositions: {
      id: string;
      token: string;
      chainId: string;
      direction: "LONG" | "SHORT";
      size: number;
      entryPrice: number;
      currentPrice: number;
      pnl: number;
      pnlPct: number;
    }[] = [],
  ): PortfolioSnapshot {
    const totalEquity = tradingState.capital;
    const totalPositionSize = openPositions.reduce(
      (sum, p) => sum + p.size,
      0,
    );
    const exposure = totalEquity > 0 ? (totalPositionSize / totalEquity) * 100 : 0;

    // Map positions with allocation %
    const positions: PortfolioPosition[] = openPositions.map((p) => ({
      ...p,
      allocationPct:
        totalEquity > 0 ? Math.round((p.size / totalEquity) * 10000) / 100 : 0,
    }));

    // Concentration warnings
    const concentrationWarnings: string[] = [];
    for (const pos of positions) {
      if (pos.allocationPct > this.MAX_SINGLE_ALLOCATION * 100) {
        concentrationWarnings.push(
          `${pos.token} (${pos.direction}) at ${pos.allocationPct.toFixed(1)}% allocation exceeds ${(this.MAX_SINGLE_ALLOCATION * 100).toFixed(0)}% max — reduce exposure!`,
        );
      }
    }

    // Check cash reserve
    const cashReserve = totalEquity - totalPositionSize;
    const cashReservePct = totalEquity > 0 ? (cashReserve / totalEquity) * 100 : 0;
    if (cashReservePct < this.MIN_CASH_RESERVE * 100) {
      concentrationWarnings.push(
        `Cash reserve at ${cashReservePct.toFixed(1)}% — below ${(this.MIN_CASH_RESERVE * 100).toFixed(0)}% minimum. Do not open new positions.`,
      );
    }

    // Diversification score: 0-100
    // Based on: number of positions, allocation evenness, direction mix
    const diversificationScore = this.computeDiversificationScore(positions);

    // Metrics
    const metrics = this.calculateMetrics();

    return {
      totalEquity: Math.round(totalEquity * 100) / 100,
      initialCapital: tradingState.initialCapital,
      absolutePnl: Math.round((tradingState.pnl || 0) * 100) / 100,
      pnlPct: Math.round((tradingState.pnlPct || 0) * 100) / 100,
      exposure: Math.round(exposure * 100) / 100,
      exposureUsd: Math.round(totalPositionSize * 100) / 100,
      positions,
      diversificationScore: Math.round(diversificationScore * 100) / 100,
      concentrationWarnings,
      metrics,
    };
  }

  /**
   * Check if any single position exceeds 25% of portfolio.
   * Returns warnings array — empty means no concentration issues.
   */
  checkExposure(
    positions: { token: string; direction: string; size: number }[],
    totalEquity: number,
  ): string[] {
    const warnings: string[] = [];
    for (const pos of positions) {
      const allocPct = totalEquity > 0 ? (pos.size / totalEquity) * 100 : 0;
      if (allocPct > this.MAX_SINGLE_ALLOCATION * 100) {
        warnings.push(
          `⚠️ ${pos.token} (${pos.direction}) exposure at ${allocPct.toFixed(1)}% — exceeds ${(this.MAX_SINGLE_ALLOCATION * 100).toFixed(0)}% limit`,
        );
      }
    }
    return warnings;
  }

  /**
   * Compute diversification score.
   * Factors: position count (up to 5), allocation evenness, direction mix.
   */
  private computeDiversificationScore(positions: PortfolioPosition[]): number {
    if (positions.length === 0) return 0; // Cash only — no diversification needed

    // Score based on number of positions (max score at 5+ positions)
    const countScore = Math.min(positions.length / 5, 1) * 40;

    // Score based on allocation evenness (inverse of Herfindahl index)
    let allocationScore = 0;
    if (positions.length > 0) {
      const totalAlloc = positions.reduce((s, p) => s + p.allocationPct, 0);
      if (totalAlloc > 0) {
        // Normalized Herfindahl: sum of squared allocations
        const herf = positions.reduce(
          (s, p) => s + (p.allocationPct / totalAlloc) ** 2,
          0,
        );
        // Higher Herfindahl = more concentrated → lower score
        const evenness = herf > 0 ? 1 / (herf * positions.length) : 0;
        allocationScore = Math.min(evenness, 1) * 30;
      }
    }

    // Score based on direction mix (LONG vs SHORT balance)
    let directionScore = 0;
    if (positions.length > 1) {
      const longs = positions.filter((p) => p.direction === "LONG").length;
      const shorts = positions.length - longs;
      const balance = 1 - Math.abs(longs - shorts) / positions.length;
      directionScore = balance * 30;
    } else {
      directionScore = 5; // Single position = low direction diversity
    }

    return Math.min(countScore + allocationScore + directionScore, 100);
  }

  /**
   * Calculate performance metrics: Sharpe, Sortino, win rate, etc.
   */
  calculateMetrics(): PortfolioMetrics {
    const returns = this.tradeReturns;

    if (returns.length === 0) {
      return {
        sharpeRatio: 0,
        sortinoRatio: 0,
        winRate: 0,
        totalTrades: 0,
        avgWinPct: 0,
        avgLossPct: 0,
        profitFactor: 0,
        maxDrawdownPct: 0,
      };
    }

    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r < 0);

    const winRate =
      returns.length > 0 ? (wins.length / returns.length) * 100 : 0;
    const avgWinPct =
      wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
    const avgLossPct =
      losses.length > 0
        ? Math.abs(losses.reduce((s, r) => s + r, 0) / losses.length)
        : 0;

    // Profit factor: total gains / total losses
    const totalGains = wins.reduce((s, r) => s + r, 0);
    const totalLosses = Math.abs(losses.reduce((s, r) => s + r, 0));
    const profitFactor = totalLosses > 0 ? totalGains / totalLosses : totalGains > 0 ? Infinity : 0;

    // Average return and standard deviation
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Simplified Sharpe: (avgReturn - riskFree) / stdDev
    // Using per-trade returns; risk-free rate is annualized so we use 0 for per-trade
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    // Sortino: (avgReturn - riskFree) / downsideDeviation
    const downsideReturns = returns.filter((r) => r < 0);
    const downsideVariance =
      downsideReturns.length > 0
        ? downsideReturns.reduce((s, r) => s + r ** 2, 0) / returns.length
        : 0;
    const downsideDev = Math.sqrt(downsideVariance);
    const sortinoRatio = downsideDev > 0 ? avgReturn / downsideDev : 0;

    // Max drawdown from equity history
    let maxDrawdownPct = 0;
    if (this.equityHistory.length > 1) {
      let peak = this.equityHistory[0];
      for (const equity of this.equityHistory) {
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      }
    }

    return {
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      sortinoRatio: Math.round(sortinoRatio * 100) / 100,
      winRate: Math.round(winRate * 100) / 100,
      totalTrades: returns.length,
      avgWinPct: Math.round(avgWinPct * 100) / 100,
      avgLossPct: Math.round(avgLossPct * 100) / 100,
      profitFactor: profitFactor === Infinity ? 999 : Math.round(profitFactor * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    };
  }

  /**
   * Full portfolio review: snapshot + GPT-4o analysis.
   */
  async reviewPortfolio(
    tradingState: TradingState,
    openPositions: {
      id: string;
      token: string;
      chainId: string;
      direction: "LONG" | "SHORT";
      size: number;
      entryPrice: number;
      currentPrice: number;
      pnl: number;
      pnlPct: number;
    }[] = [],
  ): Promise<AgentReport> {
    const snapshot = this.getPortfolioState(tradingState, openPositions);

    // Record equity for drawdown tracking
    this.recordEquitySnapshot(snapshot.totalEquity);

    // Try GPT-4o for portfolio review
    const llmReport = await super.analyzeMarket(snapshot);

    // Determine overall health
    let health: "GREEN" | "YELLOW" | "RED" = "GREEN";
    if (snapshot.concentrationWarnings.length > 0) health = "YELLOW";
    if (snapshot.metrics.maxDrawdownPct > 15) health = "RED";
    if (snapshot.pnlPct < -10) health = "RED";

    const isFallback = llmReport.confidence === 0 || llmReport.data?.fallback;

    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: health === "GREEN" ? 85 : health === "YELLOW" ? 60 : 30,
      reasoning: isFallback
        ? `Portfolio health: ${health}. Exposure: ${snapshot.exposure.toFixed(1)}%. Div: ${snapshot.diversificationScore.toFixed(0)}/100. ${snapshot.concentrationWarnings.length > 0 ? `Warnings: ${snapshot.concentrationWarnings.join("; ")}` : "No concentration issues."}`
        : llmReport.reasoning,
      data: {
        health,
        snapshot,
        concentrationRisk: snapshot.concentrationWarnings.length > 0,
        warnings: snapshot.concentrationWarnings,
        metrics: snapshot.metrics,
        llmNote: isFallback ? null : llmReport.reasoning,
      },
    };
  }
}
