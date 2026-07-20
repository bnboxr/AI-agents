// ── Execution Agent ─────────────────────────────────────────────────
// Receives OrchestratorDecision and executes trades via the trading engine.
// The decision's positionSize, stopLoss, and takeProfit are refined by
// the PositionManagerAgent (src/lib/agents/position-manager.ts) before
// reaching this agent. See orchestrator.ts runAgentAnalysis() flow.
//
// MODE DETECTION: Live mode when a trading-capable exchange (role "trading"
// or "both") has API keys configured. Falls back to paper mode otherwise.
// Zero Math.random() — slippage derived from real order book depth.

import { BaseAgent } from "./base";
import type { AgentReport, OrchestratorDecision } from "./types";
import { openTrade, closeTrade } from "~/lib/trading-engine";
import { getOrderBook, type OrderBook, type OrderBookLevel } from "./liquidity";
import { getTradingExchanges } from "~/lib/exchange/manager";

/** Result type for trade opening: either a successful position or an error. */
interface TradeOpenResult {
  id?: string;
  error?: string;
}

/** Result type for trade closing: either a successful close or an error. */
interface TradeCloseResult {
  id?: string;
  error?: string;
}

export type ExecutionMode = "paper" | "live";

export interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  filledPrice: number;
  requestedPrice: number;
  slippage: number;
  slippagePct: number;
  mode: ExecutionMode;
  error?: string;
  side: "BUY" | "SELL" | "EXIT";
  size: number;
  timestamp: number;
}

/** Detect if any trading-capable exchange has real API keys configured */
function detectLiveMode(): boolean {
  const tradingExchanges = getTradingExchanges();
  return tradingExchanges.some((ex) => ex.isLive);
}

const SYSTEM_PROMPT = `You are a trade execution specialist at a top quantitative hedge fund. Your job is to execute trades with minimal slippage and maximum efficiency.

You receive trade decisions from the Orchestrator and execute them through the trading engine. In live mode, you route to exchange APIs (Binance/Bitunix). In paper mode, you simulate realistic fills using order book depth.

Key execution principles:
- Minimize slippage through smart order routing
- Use real order book data for slippage estimation (never random)
- Always confirm fills and report exact execution prices
- If a trade cannot be executed (e.g., position already open), report the error clearly

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":100,"reasoning":"execution report","data":{"success":true,"filledPrice":number,"slippagePct":number,"mode":"paper"|"live"}}`;

export class ExecutionAgent extends BaseAgent {
  private mode: ExecutionMode;
  private readonly SLIPPAGE_MIN = 0.001; // 0.1%
  private readonly SLIPPAGE_MAX = 0.005; // 0.5%

  /** Active position IDs managed by this agent (in-memory tracking). */
  private activePositionIds: Set<string> = new Set();

  constructor() {
    super({
      id: "execution-agent",
      role: "execution",
      systemPrompt: SYSTEM_PROMPT,
    });
    this.mode = detectLiveMode() ? "live" : "paper";
  }

  /** Toggle between paper and live execution modes. */
  setExecutionMode(mode: ExecutionMode): void {
    this.mode = mode;
  }

  /** Get the current execution mode. */
  getExecutionMode(): ExecutionMode {
    return this.mode;
  }

  /**
   * Compute fill price with slippage derived from the real order book.
   * Walks the order book levels until the positionSize is filled,
   * then computes the volume-weighted average price (VWAP) of the fill.
   *
   * For BUY: walks the ask side (ascending price).
   * For SELL/EXIT: walks the bid side (descending price).
   *
   * Falls back to a conservative 0.1% slippage estimate if order book
   * data is unavailable.
   */
  private computeSlippagePrice(
    marketPrice: number,
    side: "BUY" | "SELL" | "EXIT",
    positionSize: number,
    orderBook?: OrderBook | null,
  ): { filledPrice: number; slippage: number; slippagePct: number } {
    // Try to use real order book data
    if (orderBook) {
      const levels: OrderBookLevel[] =
        side === "BUY" ? orderBook.asks : orderBook.bids;

      if (levels.length > 0) {
        let remaining = positionSize;
        let totalCost = 0;
        let totalFilled = 0;

        for (const level of levels) {
          if (remaining <= 0) break;
          const fillQty = Math.min(remaining, level.quantity);
          totalCost += fillQty * level.price;
          totalFilled += fillQty;
          remaining -= fillQty;
        }

        // If we couldn't fill the full size from the book, use last level price
        if (remaining > 0 && levels.length > 0) {
          const lastPrice = levels[levels.length - 1].price;
          totalCost += remaining * lastPrice;
          totalFilled += remaining;
        }

        if (totalFilled > 0) {
          const filledPrice = totalCost / totalFilled;
          const slippage = Math.abs(filledPrice - marketPrice);
          const slippagePct = marketPrice > 0 ? slippage / marketPrice : 0;

          return {
            filledPrice: Math.round(filledPrice * 100000) / 100000,
            slippage: Math.round(slippage * 100000) / 100000,
            slippagePct: Math.round(slippagePct * 10000) / 10000,
          };
        }
      }
    }

    // Fallback: conservative 0.1% slippage (no Math.random())
    const slippagePct = this.SLIPPAGE_MIN;
    const slippageMultiplier =
      side === "BUY" ? 1 + slippagePct : 1 - slippagePct;
    const filledPrice = marketPrice * slippageMultiplier;
    const slippage = Math.abs(filledPrice - marketPrice);

    return {
      filledPrice: Math.round(filledPrice * 100000) / 100000,
      slippage: Math.round(slippage * 100000) / 100000,
      slippagePct: Math.round(slippagePct * 10000) / 10000,
    };
  }

  /**
   * Execute a real market order via the first available live trading exchange.
   * Uses getTradingExchanges() to only route to exchanges with role "trading" or "both".
   */
  private async executeLiveOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number,
    currentPrice: number,
  ): Promise<{ success: boolean; filledPrice: number; exchange: string; orderId?: string; error?: string }> {
    const tradingExchanges = getTradingExchanges().filter((ex) => ex.isLive);

    if (tradingExchanges.length === 0) {
      return {
        success: false,
        filledPrice: currentPrice,
        exchange: "none",
        error: "No live trading-capable exchange configured",
      };
    }

    // Use the first live trading exchange
    const exchange = tradingExchanges[0];
    console.log(`[ExecutionAgent] Live execution via ${exchange.name} (${exchange.role})`);

    try {
      const result = await exchange.placeOrder({
        symbol,
        side,
        type: "MARKET",
        quantity,
      });

      if (result.status === "REJECTED") {
        return {
          success: false,
          filledPrice: currentPrice,
          exchange: exchange.name,
          error: `${exchange.name} rejected order: data-only exchange cannot execute trades`,
        };
      }

      return {
        success: result.status === "FILLED" || result.status === "PARTIALLY_FILLED",
        filledPrice: result.avgPrice || currentPrice,
        exchange: exchange.name,
        orderId: result.orderId,
      };
    } catch (err) {
      return {
        success: false,
        filledPrice: currentPrice,
        exchange: exchange.name,
        error: err instanceof Error ? err.message : `${exchange.name} order failed`,
      };
    }
  }

  /**
   * Execute an OrchestratorDecision — open or close positions.
   * Requires current market price for fill simulation.
   */
  async executeDecision(
    decision: OrchestratorDecision,
    currentPrice: number,
    chainId: string,
    token: string,
  ): Promise<ExecutionResult> {
    const timestamp = Date.now();

    // EXIT action: close all active positions
    if (decision.action === "EXIT") {
      const results: ExecutionResult[] = [];
      for (const posId of this.activePositionIds) {
        const result = await this.executeExit(posId, currentPrice, token);
        results.push(result);
      }
      if (results.length > 0) {
        return results[results.length - 1];
      }
      return {
        success: true,
        filledPrice: currentPrice,
        requestedPrice: currentPrice,
        slippage: 0,
        slippagePct: 0,
        mode: this.mode,
        side: "EXIT",
        size: 0,
        timestamp,
      };
    }

    // HOLD / WAIT: no execution needed
    if (decision.action === "HOLD" || decision.action === "WAIT") {
      return {
        success: true,
        filledPrice: currentPrice,
        requestedPrice: currentPrice,
        slippage: 0,
        slippagePct: 0,
        mode: this.mode,
        side: decision.action === "HOLD" ? "BUY" : "BUY",
        size: 0,
        timestamp,
      };
    }

    // BUY or SELL: open new position
    const side = decision.action;

    // ── LIVE MODE: Route to trading exchange ──────────────────────
    if (this.mode === "live") {
      try {
        const liveResult = await this.executeLiveOrder(
          token,
          side,
          decision.positionSize,
          currentPrice,
        );

        if (liveResult.success && liveResult.orderId) {
          this.activePositionIds.add(liveResult.orderId);

          const slippage = Math.abs(liveResult.filledPrice - currentPrice);
          const slippagePct = currentPrice > 0 ? slippage / currentPrice : 0;

          return {
            success: true,
            tradeId: liveResult.orderId,
            filledPrice: liveResult.filledPrice,
            requestedPrice: currentPrice,
            slippage: Math.round(slippage * 100000) / 100000,
            slippagePct: Math.round(slippagePct * 10000) / 10000,
            mode: "live",
            side,
            size: decision.positionSize,
            timestamp,
          };
        }

        return {
          success: false,
          filledPrice: currentPrice,
          requestedPrice: currentPrice,
          slippage: 0,
          slippagePct: 0,
          mode: "live",
          side,
          size: decision.positionSize,
          timestamp,
          error: liveResult.error || "Live order failed",
        };
      } catch (err) {
        return {
          success: false,
          filledPrice: currentPrice,
          requestedPrice: currentPrice,
          slippage: 0,
          slippagePct: 0,
          mode: "live",
          side,
          size: decision.positionSize,
          timestamp,
          error: err instanceof Error ? err.message : "Live execution failed",
        };
      }
    }

    // ── PAPER MODE: Simulate with real order book slippage ──────────
    // Try to fetch real order book for accurate slippage
    let orderBook: OrderBook | null = null;
    try {
      orderBook = await getOrderBook(token);
    } catch (err) {
      console.warn("[ExecutionAgent] getOrderBook failed:", err);
      // Order book unavailable — use conservative fallback in computeSlippagePrice
    }

    const { filledPrice, slippage, slippagePct } = this.computeSlippagePrice(
      currentPrice,
      side,
      decision.positionSize,
      orderBook,
    );

    try {
      const position: TradeOpenResult = await openTrade({
        data: {
          chainId,
          token,
          direction: side === "BUY" ? "LONG" : "SHORT",
          price: filledPrice,
          size: decision.positionSize,
          leverage: 1,
        },
      });

      if ('error' in position && position.error) {
        return {
          success: false,
          filledPrice,
          requestedPrice: currentPrice,
          slippage,
          slippagePct,
          mode: "paper",
          side,
          size: decision.positionSize,
          timestamp,
          error: position.error,
        };
      }

      if (position && 'id' in position && position.id) {
        this.activePositionIds.add(position.id);
      }

      return {
        success: true,
        tradeId: position.id,
        filledPrice,
        requestedPrice: currentPrice,
        slippage,
        slippagePct,
        mode: "paper",
        side,
        size: decision.positionSize,
        timestamp,
      };
    } catch (err) {
      return {
        success: false,
        filledPrice,
        requestedPrice: currentPrice,
        slippage,
        slippagePct,
        mode: "paper",
        side,
        size: decision.positionSize,
        timestamp,
        error: err instanceof Error ? err.message : "Trade execution failed",
      };
    }
  }

  /**
   * Close a specific position by ID.
   */
  async executeExit(
    positionId: string,
    currentPrice: number,
    token?: string,
  ): Promise<ExecutionResult> {
    const timestamp = Date.now();

    // ── LIVE MODE: Cancel on trading exchange ─────────────────────
    if (this.mode === "live") {
      try {
        // For exits in live mode, place a SELL market order via trading exchange
        const liveResult = await this.executeLiveOrder(
          token || positionId,
          "SELL",
          0, // close full position
          currentPrice,
        );

        this.activePositionIds.delete(positionId);

        if (liveResult.success) {
          const slippage = Math.abs(liveResult.filledPrice - currentPrice);
          const slippagePct = currentPrice > 0 ? slippage / currentPrice : 0;

          return {
            success: true,
            tradeId: positionId,
            filledPrice: liveResult.filledPrice,
            requestedPrice: currentPrice,
            slippage: Math.round(slippage * 100000) / 100000,
            slippagePct: Math.round(slippagePct * 10000) / 10000,
            mode: "live",
            side: "EXIT",
            size: 0,
            timestamp,
          };
        }

        return {
          success: false,
          tradeId: positionId,
          filledPrice: currentPrice,
          requestedPrice: currentPrice,
          slippage: 0,
          slippagePct: 0,
          mode: "live",
          side: "EXIT",
          size: 0,
          timestamp,
          error: liveResult.error || "Live exit failed",
        };
      } catch (err) {
        return {
          success: false,
          tradeId: positionId,
          filledPrice: currentPrice,
          requestedPrice: currentPrice,
          slippage: 0,
          slippagePct: 0,
          mode: "live",
          side: "EXIT",
          size: 0,
          timestamp,
          error: err instanceof Error ? err.message : "Exit execution failed",
        };
      }
    }

    // ── PAPER MODE: Simulate with real order book ───────────────────
    let orderBook: OrderBook | null = null;
    try {
      orderBook = await getOrderBook(token || "");
    } catch (err) {
      console.warn("[ExecutionAgent] exit getOrderBook failed:", err);
      // unavailable
    }

    const { filledPrice, slippage, slippagePct } = this.computeSlippagePrice(
      currentPrice,
      "EXIT",
      0,
      orderBook,
    );

    try {
      const result: TradeCloseResult = await closeTrade({
        data: {
          id: positionId,
          exitPrice: filledPrice,
        },
      });

      if ('error' in result && result.error) {
        return {
          success: false,
          tradeId: positionId,
          filledPrice,
          requestedPrice: currentPrice,
          slippage,
          slippagePct,
          mode: "paper",
          side: "EXIT",
          size: 0,
          timestamp,
          error: result.error,
        };
      }

      this.activePositionIds.delete(positionId);

      return {
        success: true,
        tradeId: positionId,
        filledPrice,
        requestedPrice: currentPrice,
        slippage,
        slippagePct,
        mode: "paper",
        side: "EXIT",
        size: 0,
        timestamp,
      };
    } catch (err) {
      return {
        success: false,
        tradeId: positionId,
        filledPrice,
        requestedPrice: currentPrice,
        slippage,
        slippagePct,
        mode: "paper",
        side: "EXIT",
        size: 0,
        timestamp,
        error: err instanceof Error ? err.message : "Exit execution failed",
      };
    }
  }

  /**
   * Generate an AgentReport confirming the execution.
   */
  async generateExecutionReport(
    result: ExecutionResult,
    decision: OrchestratorDecision,
  ): Promise<AgentReport> {
    const context = {
      execution: result,
      decision: {
        action: decision.action,
        confidence: decision.confidence,
        positionSize: decision.positionSize,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
      },
    };

    const report = await super.analyzeMarket(context);

    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction:
        decision.action === "BUY"
          ? "LONG"
          : decision.action === "SELL"
            ? "SHORT"
            : "NEUTRAL",
      confidence: result.success ? 100 : 0,
      reasoning: result.success
        ? `${this.mode.toUpperCase()} ${result.side}: filled at $${result.filledPrice} (slippage: ${result.slippagePct}%). ID: ${result.tradeId ?? "N/A"}`
        : `Execution failed: ${result.error}`,
      data: {
        executionMode: this.mode,
        success: result.success,
        tradeId: result.tradeId,
        filledPrice: result.filledPrice,
        requestedPrice: result.requestedPrice,
        slippage: result.slippage,
        slippagePct: result.slippagePct,
        side: result.side,
        size: result.size,
        llmNote: report.reasoning,
      },
    };
  }

  /** Get the number of active positions tracked by this agent. */
  getActivePositionCount(): number {
    return this.activePositionIds.size;
  }
}
