// ── Trading Data Monetization ───────────────────────────────────
// Signal export API, quality metrics, and Stripe-gated access
// for trading signal subscriptions.
//
// Packages agent analysis reports as structured trading signals
// and tracks accuracy over time.
//
// References:
//   Stripe Payment Links for gated access
//   Signal format follows standard trading signal conventions

// ── Types ──────────────────────────────────────────────────────

export interface TradingSignal {
  id: string;
  symbol: string;           // e.g. "ETHUSDT", "BTCUSDT"
  direction: "BUY" | "SELL";
  confidence: number;       // 0-100
  entry: number;            // entry price
  sl: number;               // stop loss
  tp: number;               // take profit
  timeframe: string;        // "15m" | "1h" | "4h" | "1d"
  strategy: string;         // "MACross", "RSIDivergence", "SupportResistance", etc.
  reasoning: string;        // AI analysis summary
  timestamp: number;
  expiresAt: number;
  status: "active" | "hit_tp" | "hit_sl" | "expired" | "cancelled";
  outcomePnl?: number;      // realized PnL % when closed
  outcomeAt?: number;
}

export interface SignalQualityMetrics {
  totalSignals: number;
  activeSignals: number;
  hitTP: number;
  hitSL: number;
  expired: number;
  winRate: number;          // % of closed signals that hit TP
  avgProfit: number;        // avg PnL % for winners
  avgLoss: number;          // avg PnL % for losers
  profitFactor: number;     // gross profit / gross loss
  sharpeRatio: number;      // approximated
  lastCalculated: number;
}

export interface SignalExportRequest {
  symbols?: string[];       // filter by symbols
  directions?: Array<"BUY" | "SELL">;
  minConfidence?: number;
  limit?: number;
  timeframe?: string;
}

export interface SignalExportResponse {
  signals: TradingSignal[];
  metrics: SignalQualityMetrics;
  generatedAt: number;
  accessTier: "free" | "premium";
}

// ── In-memory signal store ────────────────────────────────────

const MAX_SIGNALS = 1000;
const SIGNAL_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

let _signals: TradingSignal[] = [];
let _signalIdCounter = 0;
let _lastPruned = Date.now();

// ── Signal generation ─────────────────────────────────────────

/**
 * Generate a trading signal from agent analysis data.
 * Called by the orchestrator when agents reach a decision.
 */
export function createSignal(params: {
  symbol: string;
  direction: "BUY" | "SELL";
  confidence: number;
  entry: number;
  sl: number;
  tp: number;
  timeframe?: string;
  strategy?: string;
  reasoning?: string;
}): TradingSignal {
  const now = Date.now();
  _signalIdCounter++;

  const signal: TradingSignal = {
    id: `sig-${now}-${_signalIdCounter.toString(36)}`,
    symbol: params.symbol.toUpperCase(),
    direction: params.direction,
    confidence: Math.max(0, Math.min(100, params.confidence)),
    entry: params.entry,
    sl: params.sl,
    tp: params.tp,
    timeframe: params.timeframe ?? "1h",
    strategy: params.strategy ?? "AI_ORCHESTRATOR",
    reasoning: params.reasoning ?? "AI agent consensus decision",
    timestamp: now,
    expiresAt: now + SIGNAL_EXPIRY_MS,
    status: "active",
  };

  _signals.push(signal);

  // Prune if over limit
  if (_signals.length > MAX_SIGNALS) {
    _signals = _signals.slice(-Math.floor(MAX_SIGNALS * 0.8));
  }

  // Auto-prune expired signals periodically
  pruneExpiredSignals(now);

  return signal;
}

/**
 * Mark a signal's outcome when the trade closes.
 */
export function resolveSignal(
  signalId: string,
  outcome: "hit_tp" | "hit_sl" | "expired" | "cancelled",
  realizedPnlPct?: number,
): TradingSignal | null {
  const signal = _signals.find((s) => s.id === signalId);
  if (!signal || signal.status !== "active") return null;

  signal.status = outcome;
  signal.outcomePnl = realizedPnlPct;
  signal.outcomeAt = Date.now();

  return { ...signal };
}

// ── Signal querying ────────────────────────────────────────────

/**
 * Export signals with optional filtering.
 */
export function exportSignals(req: SignalExportRequest = {}): SignalExportResponse {
  const now = Date.now();
  pruneExpiredSignals(now);

  let filtered = [..._signals].filter((s) => s.status === "active");

  if (req.symbols && req.symbols.length > 0) {
    const syms = new Set(req.symbols.map((s) => s.toUpperCase()));
    filtered = filtered.filter((s) => syms.has(s.symbol));
  }

  if (req.directions && req.directions.length > 0) {
    const dirs = new Set(req.directions);
    filtered = filtered.filter((s) => dirs.has(s.direction));
  }

  if (req.minConfidence != null) {
    filtered = filtered.filter((s) => s.confidence >= req.minConfidence);
  }

  if (req.timeframe) {
    filtered = filtered.filter((s) => s.timeframe === req.timeframe);
  }

  // Sort by confidence descending
  filtered.sort((a, b) => b.confidence - a.confidence);

  const limit = req.limit ?? 50;
  filtered = filtered.slice(0, limit);

  const metrics = calculateQualityMetrics();

  return {
    signals: filtered.map((s) => ({ ...s })),
    metrics,
    generatedAt: now,
    accessTier: "free",
  };
}

/**
 * Get signal history for a specific symbol.
 */
export function getSignalHistory(symbol?: string, limit = 100): TradingSignal[] {
  const now = Date.now();
  pruneExpiredSignals(now);

  let filtered = [..._signals];
  if (symbol) {
    const sym = symbol.toUpperCase();
    filtered = filtered.filter((s) => s.symbol === sym);
  }

  // Most recent first
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  return filtered.slice(0, limit).map((s) => ({ ...s }));
}

/**
 * Get signal by ID.
 */
export function getSignalById(signalId: string): TradingSignal | null {
  const signal = _signals.find((s) => s.id === signalId);
  return signal ? { ...signal } : null;
}

// ── Quality metrics ────────────────────────────────────────────

/**
 * Calculate signal quality metrics based on resolved signals.
 */
export function calculateQualityMetrics(): SignalQualityMetrics {
  const now = Date.now();
  const resolved = _signals.filter(
    (s) => s.status !== "active" && s.status !== "expired",
  );
  const active = _signals.filter((s) => s.status === "active");

  const hitTP = resolved.filter((s) => s.status === "hit_tp");
  const hitSL = resolved.filter((s) => s.status === "hit_sl");
  const expired = _signals.filter((s) => s.status === "expired");

  const totalResolved = hitTP.length + hitSL.length;
  const winRate = totalResolved > 0 ? (hitTP.length / totalResolved) * 100 : 0;

  const avgProfit =
    hitTP.length > 0
      ? hitTP.reduce((sum, s) => sum + (s.outcomePnl ?? 0), 0) / hitTP.length
      : 0;

  const avgLoss =
    hitSL.length > 0
      ? hitSL.reduce((sum, s) => sum + Math.abs(s.outcomePnl ?? 0), 0) / hitSL.length
      : 0;

  const grossProfit = hitTP.reduce((sum, s) => sum + (s.outcomePnl ?? 0), 0);
  const grossLoss = hitSL.reduce((sum, s) => sum + Math.abs(s.outcomePnl ?? 0), 0);
  const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? Infinity : 0;

  // Approximate Sharpe: (avg return / stddev) * sqrt(samples)
  const allReturns = resolved
    .filter((s) => s.outcomePnl != null)
    .map((s) => s.outcomePnl!);
  const meanReturn = allReturns.length > 0 ? allReturns.reduce((s, r) => s + r, 0) / allReturns.length : 0;
  const variance =
    allReturns.length > 1
      ? allReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (allReturns.length - 1)
      : 0;
  const stddev = Math.sqrt(variance);
  const sharpeRatio =
    stddev > 0 ? +((meanReturn / stddev) * Math.sqrt(Math.max(allReturns.length, 1))).toFixed(3) : 0;

  return {
    totalSignals: _signals.length,
    activeSignals: active.length,
    hitTP: hitTP.length,
    hitSL: hitSL.length,
    expired: expired.length,
    winRate: +winRate.toFixed(1),
    avgProfit: +avgProfit.toFixed(2),
    avgLoss: +avgLoss.toFixed(2),
    profitFactor: profitFactor === Infinity ? 999 : profitFactor as number,
    sharpeRatio,
    lastCalculated: now,
  };
}

/**
 * Get a summary of signal performance for the dashboard.
 */
export function getSignalSummary(): {
  activeCount: number;
  topSignal: TradingSignal | null;
  winRate: number;
  totalResolved: number;
} {
  const metrics = calculateQualityMetrics();
  const active = _signals.filter((s) => s.status === "active");

  const topSignal = active.length > 0
    ? active.reduce((best, s) => (s.confidence > best.confidence ? s : best), active[0])
    : null;

  return {
    activeCount: active.length,
    topSignal: topSignal ? { ...topSignal } : null,
    winRate: metrics.winRate,
    totalResolved: metrics.hitTP + metrics.hitSL,
  };
}

// ── Stripe payment-gated access ────────────────────────────────

const STRIPE_SIGNAL_PRICE_ID = "price_signal_premium";

/**
 * Check if a user has premium signal access.
 * In production, validate against Stripe subscription status.
 */
export function checkPremiumAccess(userId?: string): boolean {
  // Free tier: basic signals (confidence < 70)
  // Premium tier: all signals + high-confidence signals
  if (!userId) return false;

  try {
    // In production, query Stripe subscription status
    // For now, check env var or return false
    const premiumUsers = typeof process !== "undefined"
      ? (process.env?.SIGNAL_PREMIUM_USERS ?? "").split(",")
      : [];
    return premiumUsers.includes(userId);
  } catch {
    return false;
  }
}

/**
 * Get the Stripe payment link for premium signal access.
 */
export function getSignalPaymentLink(): string {
  return (
    (typeof process !== "undefined" && process.env?.STRIPE_SIGNAL_LINK) ??
    "https://buy.stripe.com/signal_premium"
  );
}

// ── Telegram/Discord bot signal format ─────────────────────────

/**
 * Format a signal for Telegram/Discord message.
 */
export function formatSignalForBot(signal: TradingSignal): string {
  const emoji = signal.direction === "BUY" ? "🟢" : "🔴";
  const confBar = "█".repeat(Math.round(signal.confidence / 10)) + "░".repeat(10 - Math.round(signal.confidence / 10));

  return [
    `${emoji} *${signal.symbol}* — ${signal.direction} Signal`,
    `├─ Confidence: ${confBar} ${signal.confidence}%`,
    `├─ Entry: $${signal.entry}`,
    `├─ Stop Loss: $${signal.sl} (${signal.direction === "BUY" ? "+" : "-"}${Math.abs(((signal.sl - signal.entry) / signal.entry) * 100).toFixed(1)}%)`,
    `├─ Take Profit: $${signal.tp} (${signal.direction === "BUY" ? "+" : "-"}${Math.abs(((signal.tp - signal.entry) / signal.entry) * 100).toFixed(1)}%)`,
    `├─ Timeframe: ${signal.timeframe}`,
    `├─ Strategy: ${signal.strategy}`,
    `├─ Reasoning: ${signal.reasoning.slice(0, 120)}${signal.reasoning.length > 120 ? "..." : ""}`,
    `└─ Expires: ${new Date(signal.expiresAt).toISOString()}`,
  ].join("\n");
}

/**
 * Get all active signals formatted for bot posting.
 */
export function getBotSignals(minConfidence = 60): string[] {
  const { signals } = exportSignals({ minConfidence, limit: 5 });
  return signals.map(formatSignalForBot);
}

// ── Maintenance ────────────────────────────────────────────────

function pruneExpiredSignals(now: number): void {
  if (now - _lastPruned < 60_000) return; // prune at most once per minute

  const before = _signals.length;
  _signals = _signals.filter((s) => {
    if (s.status !== "active") return true; // keep resolved for metrics
    return s.expiresAt > now;
  });

  // Auto-expire signals past their expiry
  for (const s of _signals) {
    if (s.status === "active" && s.expiresAt <= now) {
      s.status = "expired";
      s.outcomeAt = now;
    }
  }

  if (before !== _signals.length) {
    console.log(`[TradingData] Pruned ${before - _signals.length} expired signals`);
  }
  _lastPruned = now;
}

/**
 * Reset all signal data.
 */
export function resetSignalData(): void {
  _signals = [];
  _signalIdCounter = 0;
  _lastPruned = Date.now();
}
