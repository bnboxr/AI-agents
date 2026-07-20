// ── Trading Engine — AI-Powered Autonomous Trading ───────────────
// Agents are trained by GPT-4o to analyze 5-min charts and execute LONG/SHORT

import { createServerFn } from "@tanstack/react-start";
import { getApiKey } from "~/lib/api-keys";
import { getRiskStateRaw } from "~/lib/risk-engine";
import { agentBus } from "~/lib/agent-bus";
import { sql, isDbAvailable } from "~/lib/db";
import { getPrice } from "~/lib/ws/price-context";
import { seededRandom } from "~/lib/deterministic-random";

// ── Types ──────────────────────────────────────────────────────────

export type TradeDirection = "LONG" | "SHORT";
export type TradeStatus = "pending" | "open" | "closed" | "cancelled";

export interface TradeConfig {
  maxPositionUsd: number;
  maxLeverage: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxDailyTrades: number;
  allowedChains: string[];
  timeframe: "5m" | "15m" | "1h";
}

export interface TradePosition {
  id: string;
  chainId: string;
  token: string;
  direction: TradeDirection;
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  pnl: number;
  pnlPct: number;
  stopLoss: number;
  takeProfit: number;
  status: TradeStatus;
  openedAt: number;
  closedAt?: number;
  aiReasoning?: string;
}

export interface MarketData {
  chainId: string;
  token: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

// ── Default Config ─────────────────────────────────────────────────

const DEFAULT_CONFIG: TradeConfig = {
  maxPositionUsd: 100,
  maxLeverage: 3,
  stopLossPct: 5,
  takeProfitPct: 10,
  maxDailyTrades: 20,
  allowedChains: ["ethereum", "arbitrum", "polygon", "base"],
  timeframe: "5m",
};

// ── In-Memory State ───────────────────────────────────────────────

let tradeConfig: TradeConfig = { ...DEFAULT_CONFIG };
const openPositions: Map<string, TradePosition> = new Map();
const tradeHistory: TradePosition[] = [];
let dailyTradeCount = 0;
let lastResetDay = new Date().getDate();

function resetDailyIfNeeded() {
  const today = new Date().getDate();
  if (today !== lastResetDay) {
    dailyTradeCount = 0;
    lastResetDay = today;
  }
}

// ── AI Chart Analysis ──────────────────────────────────────────────

async function analyzeMarketWithAI(
  chainId: string,
  token: string,
  priceData: { price: number; change24h: number; volume24h: number; high24h: number; low24h: number }
): Promise<{ direction: TradeDirection | null; confidence: number; reasoning: string }> {
  const apiKey = getApiKey("openai");
  if (!apiKey) {
    return { direction: null, confidence: 0, reasoning: "No AI model configured. Add OpenAI API key in Settings." };
  }

  const prompt = `You are a professional crypto trader. Analyze this market data on 5-minute timeframe:

Chain: ${chainId}
Token: ${token}
Current Price: $${priceData.price}
24h Change: ${priceData.change24h}%
24h Volume: $${priceData.volume24h.toLocaleString()}
24h High: $${priceData.high24h}
24h Low: $${priceData.low24h}

Based on price action, momentum, and volatility, decide:
- LONG (bullish signal, price likely to rise in next 5-15 min)
- SHORT (bearish signal, price likely to drop)
- HOLD (no clear signal)

Respond in JSON format only: {"direction":"LONG"|"SHORT"|"HOLD","confidence":0-100,"reasoning":"brief explanation"}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 150,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return { direction: null, confidence: 0, reasoning: "AI API error" };
    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || "";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      direction: json.direction === "HOLD" ? null : json.direction,
      confidence: json.confidence || 50,
      reasoning: json.reasoning || "AI analysis complete",
    };
  } catch {
    return { direction: null, confidence: 0, reasoning: "Analysis failed — using fallback rules" };
  }
}

function fallbackAnalysis(priceData: { change24h: number; high24h: number; low24h: number }): { direction: TradeDirection | null; confidence: number; reasoning: string } {
  const range = priceData.high24h - priceData.low24h;
  const positionInRange = (priceData.high24h - priceData.high24h * 0.3); // simplified
  if (priceData.change24h > 5) return { direction: "LONG", confidence: 60, reasoning: `Strong upward momentum: +${priceData.change24h}% in 24h` };
  if (priceData.change24h < -5) return { direction: "SHORT", confidence: 60, reasoning: `Strong downward momentum: ${priceData.change24h}% in 24h` };
  return { direction: null, confidence: 30, reasoning: "No clear signal — sideways market" };
}

// ── Live Price Access ──────────────────────────────────────────────

/**
 * Get the current live price for a token from the real-time WebSocket cache.
 * Falls back to the provided default if no live data is available yet.
 */
export function getCurrentPrice(token: string, fallback?: number): number | null {
  const price = getPrice(token);
  if (price !== null) return price;
  return fallback ?? null;
}

// ── Server Functions ───────────────────────────────────────────────

export const getTradeConfig = createServerFn({ method: "GET" }).handler(async () => tradeConfig);

export const updateTradeConfig = createServerFn({ method: "POST" }).handler(async ({ data }: { data: Partial<TradeConfig> }) => {
  tradeConfig = { ...tradeConfig, ...data };
  return tradeConfig;
});

export const getOpenPositions = createServerFn({ method: "GET" }).handler(async () => {
  // Try DB first
  if (isDbAvailable()) {
    try {
      const result = await sql`SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC`;
      if (result.rows.length > 0) {
        return result.rows.map(rowToTradePosition);
      }
    } catch (err) {
      console.error("[DB] getOpenPositions query failed:", err);
    }
  }
  return Array.from(openPositions.values());
});

export const getTradeHistory = createServerFn({ method: "GET" }).handler(async () => {
  // Try DB first
  if (isDbAvailable()) {
    try {
      const result = await sql`SELECT * FROM trades WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 50`;
      if (result.rows.length > 0) {
        return result.rows.map(rowToTradePosition);
      }
    } catch (err) {
      console.error("[DB] getTradeHistory query failed:", err);
    }
  }
  return tradeHistory.slice(-50);
});

// ── Row mapper: DB row → TradePosition ───────────────────────────

function rowToTradePosition(row: Record<string, unknown>): TradePosition {
  return {
    id: row.id as string,
    chainId: row.chain_id as string,
    token: row.token as string,
    direction: row.direction as TradeDirection,
    entryPrice: row.entry_price as number,
    currentPrice: (row.current_price as number) ?? (row.entry_price as number),
    size: row.size as number,
    leverage: (row.leverage as number) ?? 1,
    pnl: (row.pnl as number) ?? 0,
    pnlPct: (row.pnl_pct as number) ?? 0,
    stopLoss: row.stop_loss as number,
    takeProfit: row.take_profit as number,
    status: row.status as TradeStatus,
    openedAt: new Date(row.opened_at as string).getTime(),
    closedAt: row.closed_at ? new Date(row.closed_at as string).getTime() : undefined,
    aiReasoning: row.ai_reasoning as string | undefined,
  };
}

export const analyzeToken = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { chainId: string; token: string; price: number; change24h: number; volume24h: number; high24h: number; low24h: number } }) => {
  resetDailyIfNeeded();
  const risk = getRiskStateRaw();
  if (risk.circuitBreakerTripped) {
    return { blocked: true, reason: "Circuit breaker tripped — trading paused" };
  }
  if (dailyTradeCount >= tradeConfig.maxDailyTrades) {
    return { blocked: true, reason: `Daily trade limit reached (${tradeConfig.maxDailyTrades})` };
  }

  const aiResult = await analyzeMarketWithAI(data.chainId, data.token, data);
  if (!aiResult.direction) {
    return { blocked: true, reason: aiResult.reasoning, fallback: fallbackAnalysis(data) };
  }
  if (aiResult.confidence < 50) {
    return { blocked: true, reason: `Low confidence (${aiResult.confidence}%) — ${aiResult.reasoning}` };
  }

  return { blocked: false, direction: aiResult.direction, confidence: aiResult.confidence, reasoning: aiResult.reasoning };
});

export const openTrade = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { chainId: string; token: string; direction: TradeDirection; price: number; size: number; leverage: number } }) => {
  resetDailyIfNeeded();
  const risk = getRiskStateRaw();
  if (risk.circuitBreakerTripped) return { error: "Circuit breaker tripped" };

  dailyTradeCount++;
  const seed = `${data.chainId}-${data.token}-${Date.now()}-${dailyTradeCount}`;
  const id = `trade_${Date.now()}_${seededRandom(seed).toString(36).slice(2, 6)}`;
  const leverage = Math.min(data.leverage, tradeConfig.maxLeverage);
  const stopLoss = data.direction === "LONG"
    ? data.price * (1 - tradeConfig.stopLossPct / 100)
    : data.price * (1 + tradeConfig.stopLossPct / 100);
  const takeProfit = data.direction === "LONG"
    ? data.price * (1 + tradeConfig.takeProfitPct / 100)
    : data.price * (1 - tradeConfig.takeProfitPct / 100);

  const position: TradePosition = {
    id,
    chainId: data.chainId,
    token: data.token,
    direction: data.direction,
    entryPrice: data.price,
    currentPrice: data.price,
    size: data.size,
    leverage,
    pnl: 0,
    pnlPct: 0,
    stopLoss,
    takeProfit,
    status: "open",
    openedAt: Date.now(),
  };
  openPositions.set(id, position);

  // Write-through to DB
  if (isDbAvailable()) {
    sql`
      INSERT INTO trades (id, chain_id, token, direction, entry_price, current_price, size, leverage, pnl, pnl_pct, stop_loss, take_profit, status, opened_at)
      VALUES (${id}, ${data.chainId}, ${data.token}, ${data.direction}, ${data.price}, ${data.price}, ${data.size}, ${leverage}, 0, 0, ${stopLoss}, ${takeProfit}, 'open', now())
    `.catch((err) => console.error("[DB] openTrade insert failed:", err));
  }

  agentBus.emit("activity", { type: "trade_opened", chainId: data.chainId, data: position });
  return position;
});

export const closeTrade = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { id: string; exitPrice: number } }) => {
  const pos = openPositions.get(data.id);
  if (!pos) return { error: "Position not found" };

  pos.currentPrice = data.exitPrice;
  if (pos.direction === "LONG") {
    pos.pnlPct = ((data.exitPrice - pos.entryPrice) / pos.entryPrice) * 100 * pos.leverage;
  } else {
    pos.pnlPct = ((pos.entryPrice - data.exitPrice) / pos.entryPrice) * 100 * pos.leverage;
  }
  pos.pnl = (pos.size * pos.pnlPct) / 100;
  pos.status = "closed";
  pos.closedAt = Date.now();

  openPositions.delete(data.id);
  tradeHistory.push({ ...pos });

  // Write-through to DB
  if (isDbAvailable()) {
    sql`
      UPDATE trades
      SET status = 'closed', exit_price = ${data.exitPrice}, current_price = ${data.exitPrice},
          pnl = ${pos.pnl}, pnl_pct = ${pos.pnlPct}, closed_at = now(), updated_at = now()
      WHERE id = ${data.id}
    `.catch((err) => console.error("[DB] closeTrade update failed:", err));
  }

  agentBus.emit("activity", { type: "trade_closed", chainId: pos.chainId, data: pos });
  return pos;
});

export const getTradingStats = createServerFn({ method: "GET" }).handler(async () => {
  const open = Array.from(openPositions.values());
  const totalPnl = open.reduce((s, p) => s + p.pnl, 0);
  const wins = tradeHistory.filter(t => t.pnl > 0).length;
  const losses = tradeHistory.filter(t => t.pnl < 0).length;
  return {
    openPositions: open.length,
    totalPnl,
    totalTrades: tradeHistory.length,
    winRate: tradeHistory.length > 0 ? ((wins / tradeHistory.length) * 100).toFixed(1) : "0",
    dailyTrades: dailyTradeCount,
    maxDailyTrades: tradeConfig.maxDailyTrades,
  };
});
