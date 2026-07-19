// ── Execution Agent ─────────────────────────────────────────────────
// Receives OrchestratorDecision and executes trades via the trading engine.
// The decision's positionSize, stopLoss, and takeProfit are refined by
// the PositionManagerAgent (src/lib/agents/position-manager.ts) before
// reaching this agent. See orchestrator.ts runAgentAnalysis() flow.
// Paper trading mode (default): simulates fills with realistic slippage.
// Live mode: placeholder for future exchange API integration.

import { BaseAgent } from "./base";
import type { AgentReport, OrchestratorDecision } from "./types";
import { openTrade, closeTrade } from "~/lib/trading-engine";

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

const SYSTEM_PROMPT = `You are a trade execution specialist at a top quantitative hedge fund. Your job is to execute trades with minimal slippage and maximum efficiency.

You receive trade decisions from the Orchestrator and execute them through the trading engine. In paper mode, you simulate realistic fills. In live mode, you route to exchange APIs.

Key execution principles:
- Minimize slippage through smart order routing
- Paper mode: apply realistic slippage (0.1-0.5%) to simulate real market conditions
- Always confirm fills and report exact execution prices
- If a trade cannot be executed (e.g., position already open), report the error clearly

Respond in JSON format only:
{"direction":"NEUTRAL","confidence":100,"reasoning":"execution report","data":{"success":true,"filledPrice":number,"slippagePct":number,"mode":"paper"|"live"}}`;

export class ExecutionAgent extends BaseAgent {
  private mode: ExecutionMode = "paper";
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
   * Compute simulated fill price with realistic slippage.
   * For BUY: price goes up (adverse slippage).
   * For SELL/EXIT: price goes down (adverse slippage).
   */
  private computeSlippagePrice(
    marketPrice: number,
    side: "BUY" | "SELL" | "EXIT",
  ): { filledPrice: number; slippage: number; slippagePct: number } {
    // Random slippage between min and max
    const slippagePct =
      this.SLIPPAGE_MIN +
      Math.random() * (this.SLIPPAGE_MAX - this.SLIPPAGE_MIN);

    const slippageMultiplier = side === "BUY" ? 1 + slippagePct : 1 - slippagePct;
    const filledPrice = marketPrice * slippageMultiplier;
    const slippage = Math.abs(filledPrice - marketPrice);

    return {
      filledPrice: Math.round(filledPrice * 100000) / 100000,
      slippage: Math.round(slippage * 100000) / 100000,
      slippagePct: Math.round(slippagePct * 10000) / 10000,
    };
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
        const result = await this.executeExit(posId, currentPrice);
        results.push(result);
      }
      // Return aggregate result
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

    if (this.mode === "paper") {
      const { filledPrice, slippage, slippagePct } = this.computeSlippagePrice(
        currentPrice,
        side,
      );

      try {
        const position = await openTrade({
          data: {
            chainId,
            token,
            direction: side === "BUY" ? "LONG" : "SHORT",
            price: filledPrice,
            size: decision.positionSize,
            leverage: 1, // Default leverage for paper trading
          },
        });

        // Type guard: check if position has an id (success) or error
        if ("error" in (position as any)) {
          return {
            success: false,
            filledPrice,
            requestedPrice: currentPrice,
            slippage,
            slippagePct,
            mode: this.mode,
            side,
            size: decision.positionSize,
            timestamp,
            error: (position as any).error,
          };
        }

        if (position && "id" in position) {
          this.activePositionIds.add(position.id);
        }

        return {
          success: true,
          tradeId: (position as any).id,
          filledPrice,
          requestedPrice: currentPrice,
          slippage,
          slippagePct,
          mode: this.mode,
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
          mode: this.mode,
          side,
          size: decision.positionSize,
          timestamp,
          error: err instanceof Error ? err.message : "Trade execution failed",
        };
      }
    }

    // Live mode: placeholder for exchange API integration
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
      error:
        "Live trading mode is not yet implemented. Switch to paper mode or configure exchange API keys.",
    };
  }

  /**
   * Close a specific position by ID.
   */
  async executeExit(
    positionId: string,
    currentPrice: number,
  ): Promise<ExecutionResult> {
    const timestamp = Date.now();

    if (this.mode === "paper") {
      const { filledPrice, slippage, slippagePct } = this.computeSlippagePrice(
        currentPrice,
        "EXIT",
      );

      try {
        const result = await closeTrade({
          data: {
            id: positionId,
            exitPrice: filledPrice,
          },
        });

        if ("error" in (result as any)) {
          return {
            success: false,
            tradeId: positionId,
            filledPrice,
            requestedPrice: currentPrice,
            slippage,
            slippagePct,
            mode: this.mode,
            side: "EXIT",
            size: 0,
            timestamp,
            error: (result as any).error,
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
          mode: this.mode,
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
          mode: this.mode,
          side: "EXIT",
          size: 0,
          timestamp,
          error: err instanceof Error ? err.message : "Exit execution failed",
        };
      }
    }

    // Live mode placeholder
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
      error:
        "Live trading mode is not yet implemented. Switch to paper mode or configure exchange API keys.",
    };
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
      direction: decision.action === "BUY" ? "LONG" : decision.action === "SELL" ? "SHORT" : "NEUTRAL",
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
