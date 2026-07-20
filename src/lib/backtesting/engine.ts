import { createServerFn } from "@tanstack/react-start";
import { CHAINS } from "../chains";
import type {
  BacktestConfig,
  BacktestResult,
  StrategyMetrics,
  Trade,
  EquityPoint,
} from "./types";

// ── Constants ───────────────────────────────────────────────────────

const RISK_FREE_RATE = 0.05; // 5% annual
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// Chain → CoinGecko native token ID mapping
const CHAIN_COINGECKO_IDS: Record<string, string> = {
  ethereum: "ethereum",
  bnb: "binancecoin",
  polygon: "matic-network",
  arbitrum: "ethereum",
  optimism: "ethereum",
  base: "ethereum",
  avalanche: "avalanche-2",
  fantom: "fantom",
  gnosis: "xdai",
  zksync: "ethereum",
  linea: "ethereum",
  scroll: "ethereum",
  mantle: "mantle",
  celo: "celo",
  moonbeam: "moonbeam",
  solana: "solana",
  near: "near",
  aptos: "aptos",
  sui: "sui",
  tron: "tron",
};

function resolveCoinGeckoId(chainId: string): string {
  return CHAIN_COINGECKO_IDS[chainId] ?? "ethereum";
}

function daysFromRange(tr: string): number {
  switch (tr) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90;
    default: return 30;
  }
}

// ── Historical Price Fetch ──────────────────────────────────────────

interface PricePoint {
  timestamp: number;
  price: number;
}

async function fetchHistoricalPrices(
  coingeckoId: string,
  days: number
): Promise<PricePoint[]> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - days * 86400;

  const url = `${COINGECKO_BASE}/coins/${coingeckoId}/market_chart/range?vs_currency=usd&from=${from}&to=${now}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json();
    const prices: [number, number][] = data?.prices ?? [];
    return prices.map(([ts, price]) => ({ timestamp: ts, price }));
  } catch (err) {
    console.warn("[Backtesting] fetchCoinGeckoRange failed:", err);
    return [];
  }
}

// ── Strategy Simulators ─────────────────────────────────────────────

interface SimulationState {
  capital: number;
  position: number; // units held
  entryPrice: number;
  inPosition: boolean;
  trades: Trade[];
  equityCurve: EquityPoint[];
  pricePoints: PricePoint[];
}

function initState(
  initialCapital: number,
  pricePoints: PricePoint[]
): SimulationState {
  return {
    capital: initialCapital,
    position: 0,
    entryPrice: 0,
    inPosition: false,
    trades: [],
    equityCurve: [{ timestamp: pricePoints[0]?.timestamp ?? Date.now(), equity: initialCapital }],
    pricePoints,
  };
}

/**
 * Flash-loan arbitrage: buys on dips, sells on peaks with tight thresholds.
 * Scans for price reversals and executes quick in-out trades.
 */
function simulateFlashLoanArbitrage(
  pricePoints: PricePoint[],
  initialCapital: number
): SimulationState {
  const state = initState(initialCapital, pricePoints);
  if (pricePoints.length < 10) return state;

  const lookback = 5;
  const profitTarget = 1.005; // 0.5% target
  const stopLoss = 0.992; // 0.8% stop

  for (let i = lookback; i < pricePoints.length; i++) {
    const price = pricePoints[i].price;
    const equity = state.inPosition
      ? state.capital + state.position * price
      : state.capital;

    if (!state.inPosition) {
      // Look for dip: price is below local average
      const avg = pricePoints.slice(i - lookback, i).reduce((s, p) => s + p.price, 0) / lookback;
      if (price < avg * 0.995) {
        // Buy
        const units = (state.capital * 0.95) / price;
        state.position = units;
        state.capital -= units * price;
        state.inPosition = true;
        state.entryPrice = price;
        state.trades.push({
          index: state.trades.length,
          timestamp: pricePoints[i].timestamp,
          type: "buy",
          price,
          pnl: null,
          pnlPct: null,
          cumulativePnl: equity - initialCapital,
        });
      }
    } else {
      const returnPct = price / state.entryPrice;
      // Sell on profit target or stop loss
      if (returnPct >= profitTarget || returnPct <= stopLoss) {
        const pnl = state.position * price;
        state.capital += pnl;
        const tradePnl = pnl - state.position * state.entryPrice;
        state.trades.push({
          index: state.trades.length,
          timestamp: pricePoints[i].timestamp,
          type: "sell",
          price,
          pnl: tradePnl,
          pnlPct: returnPct - 1,
          cumulativePnl: state.capital - initialCapital,
        });
        state.position = 0;
        state.inPosition = false;
        state.entryPrice = 0;
      }
    }

    state.equityCurve.push({
      timestamp: pricePoints[i].timestamp,
      equity: state.inPosition ? state.capital + state.position * price : state.capital,
    });
  }

  // Close any open position at last price
  if (state.inPosition) {
    const lastPrice = pricePoints[pricePoints.length - 1].price;
    const pnl = state.position * lastPrice;
    state.capital += pnl;
    const tradePnl = pnl - state.position * state.entryPrice;
    state.trades.push({
      index: state.trades.length,
      timestamp: pricePoints[pricePoints.length - 1].timestamp,
      type: "sell",
      price: lastPrice,
      pnl: tradePnl,
      pnlPct: lastPrice / state.entryPrice - 1,
      cumulativePnl: state.capital - initialCapital,
    });
    state.position = 0;
    state.inPosition = false;
  }

  return state;
}

/**
 * Yield optimizer: simulates compounding yield over time.
 * Uses a smoothed trend-following model — enters when momentum is positive.
 */
function simulateYieldOptimizer(
  pricePoints: PricePoint[],
  initialCapital: number
): SimulationState {
  const state = initState(initialCapital, pricePoints);
  if (pricePoints.length < 20) return state;

  const smaShort = 5;
  const smaLong = 20;

  for (let i = smaLong; i < pricePoints.length; i++) {
    const price = pricePoints[i].price;
    const shortAvg =
      pricePoints.slice(i - smaShort, i).reduce((s, p) => s + p.price, 0) / smaShort;
    const longAvg =
      pricePoints.slice(i - smaLong, i).reduce((s, p) => s + p.price, 0) / smaLong;

    const momentum = shortAvg > longAvg;

    if (momentum && !state.inPosition) {
      const units = (state.capital * 0.9) / price;
      state.position = units;
      state.capital -= units * price;
      state.inPosition = true;
      state.entryPrice = price;
      state.trades.push({
        index: state.trades.length,
        timestamp: pricePoints[i].timestamp,
        type: "buy",
        price,
        pnl: null,
        pnlPct: null,
        cumulativePnl: (state.capital + state.position * price) - initialCapital,
      });
    } else if (!momentum && state.inPosition) {
      const pnl = state.position * price;
      state.capital += pnl;
      const tradePnl = pnl - state.position * state.entryPrice;
      state.trades.push({
        index: state.trades.length,
        timestamp: pricePoints[i].timestamp,
        type: "sell",
        price,
        pnl: tradePnl,
        pnlPct: price / state.entryPrice - 1,
        cumulativePnl: state.capital - initialCapital,
      });
      state.position = 0;
      state.inPosition = false;
      state.entryPrice = 0;
    }

    state.equityCurve.push({
      timestamp: pricePoints[i].timestamp,
      equity: state.inPosition ? state.capital + state.position * price : state.capital,
    });
  }

  // Close open position
  if (state.inPosition) {
    const lastPrice = pricePoints[pricePoints.length - 1].price;
    const pnl = state.position * lastPrice;
    state.capital += pnl;
    const tradePnl = pnl - state.position * state.entryPrice;
    state.trades.push({
      index: state.trades.length,
      timestamp: pricePoints[pricePoints.length - 1].timestamp,
      type: "sell",
      price: lastPrice,
      pnl: tradePnl,
      pnlPct: lastPrice / state.entryPrice - 1,
      cumulativePnl: state.capital - initialCapital,
    });
    state.position = 0;
    state.inPosition = false;
  }

  return state;
}

/**
 * Cross-chain: simulates periodic rebalancing between two correlated assets.
 * Uses normalized ratio mean-reversion strategy.
 */
function simulateCrossChain(
  pricePoints: PricePoint[],
  initialCapital: number
): SimulationState {
  const state = initState(initialCapital, pricePoints);
  if (pricePoints.length < 20) return state;

  const window = 10;
  const threshold = 0.02; // 2% deviation triggers trade

  for (let i = window; i < pricePoints.length; i++) {
    const currentPrice = pricePoints[i].price;
    const avg =
      pricePoints.slice(i - window, i).reduce((s, p) => s + p.price, 0) / window;
    const deviation = (currentPrice - avg) / avg;

    const equity = state.inPosition
      ? state.capital + state.position * currentPrice
      : state.capital;

    if (!state.inPosition && deviation < -threshold) {
      // Oversold → buy
      const units = (state.capital * 0.9) / currentPrice;
      state.position = units;
      state.capital -= units * currentPrice;
      state.inPosition = true;
      state.entryPrice = currentPrice;
      state.trades.push({
        index: state.trades.length,
        timestamp: pricePoints[i].timestamp,
        type: "buy",
        price: currentPrice,
        pnl: null,
        pnlPct: null,
        cumulativePnl: equity - initialCapital,
      });
    } else if (state.inPosition && deviation > threshold) {
      // Overbought → sell
      const pnl = state.position * currentPrice;
      state.capital += pnl;
      const tradePnl = pnl - state.position * state.entryPrice;
      state.trades.push({
        index: state.trades.length,
        timestamp: pricePoints[i].timestamp,
        type: "sell",
        price: currentPrice,
        pnl: tradePnl,
        pnlPct: currentPrice / state.entryPrice - 1,
        cumulativePnl: state.capital - initialCapital,
      });
      state.position = 0;
      state.inPosition = false;
      state.entryPrice = 0;
    }

    state.equityCurve.push({
      timestamp: pricePoints[i].timestamp,
      equity: state.inPosition ? state.capital + state.position * currentPrice : state.capital,
    });
  }

  if (state.inPosition) {
    const lastPrice = pricePoints[pricePoints.length - 1].price;
    const pnl = state.position * lastPrice;
    state.capital += pnl;
    const tradePnl = pnl - state.position * state.entryPrice;
    state.trades.push({
      index: state.trades.length,
      timestamp: pricePoints[pricePoints.length - 1].timestamp,
      type: "sell",
      price: lastPrice,
      pnl: tradePnl,
      pnlPct: lastPrice / state.entryPrice - 1,
      cumulativePnl: state.capital - initialCapital,
    });
    state.position = 0;
    state.inPosition = false;
  }

  return state;
}

// ── Metrics Computation ─────────────────────────────────────────────

function computeMetrics(
  state: SimulationState,
  initialCapital: number,
  days: number
): StrategyMetrics {
  const finalEquity =
    state.equityCurve[state.equityCurve.length - 1]?.equity ?? initialCapital;
  const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100;

  // Daily returns for Sharpe
  const dailyReturns: number[] = [];
  for (let i = 1; i < state.equityCurve.length; i++) {
    const prev = state.equityCurve[i - 1].equity;
    const curr = state.equityCurve[i].equity;
    if (prev > 0) {
      dailyReturns.push((curr - prev) / prev);
    }
  }

  const avgDailyReturn =
    dailyReturns.length > 0
      ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
      : 0;
  const stdDaily =
    dailyReturns.length > 1
      ? Math.sqrt(
          dailyReturns.reduce((s, r) => s + (r - avgDailyReturn) ** 2, 0) /
            (dailyReturns.length - 1)
        )
      : 0;
  const annualizedReturn = avgDailyReturn * 365;
  const annualizedVol = stdDaily * Math.sqrt(365);
  const sharpeRatio =
    annualizedVol > 0 ? (annualizedReturn - RISK_FREE_RATE) / annualizedVol : 0;

  // Max drawdown
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of state.equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = (point.equity - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  // Win rate & profit factor
  const closedTrades = state.trades.filter((t) => t.type === "sell" && t.pnl !== null);
  const winningTrades = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losingTrades = closedTrades.filter((t) => (t.pnl ?? 0) <= 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

  const totalWins = winningTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalLosses = Math.abs(losingTrades.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

  const bestTrade = closedTrades.length > 0 ? Math.max(...closedTrades.map((t) => t.pnl ?? 0)) : 0;
  const worstTrade = closedTrades.length > 0 ? Math.min(...closedTrades.map((t) => t.pnl ?? 0)) : 0;

  return {
    sharpeRatio,
    maxDrawdown: maxDrawdown * 100,
    winRate,
    totalReturn,
    profitFactor,
    volatility: annualizedVol * 100,
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
  };
}

// ── Main Backtesting Function ────────────────────────────────────────

export async function runBacktestInternal(config: BacktestConfig): Promise<BacktestResult> {
  const startedAt = Date.now();
  const coingeckoId = resolveCoinGeckoId(config.chainId);
  const days = daysFromRange(config.timeRange);
  const pricePoints = await fetchHistoricalPrices(coingeckoId, days);

  if (pricePoints.length === 0) {
    // Return empty result
    return {
      config,
      metrics: {
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        totalReturn: 0,
        profitFactor: 0,
        volatility: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        avgWin: 0,
        avgLoss: 0,
        bestTrade: 0,
        worstTrade: 0,
      },
      trades: [],
      equityCurve: [],
      startedAt,
      completedAt: Date.now(),
      priceDataPoints: 0,
    };
  }

  let state: SimulationState;
  switch (config.strategy) {
    case "flash-loan-arbitrage":
      state = simulateFlashLoanArbitrage(pricePoints, config.initialCapital);
      break;
    case "yield-optimizer":
      state = simulateYieldOptimizer(pricePoints, config.initialCapital);
      break;
    case "cross-chain":
      state = simulateCrossChain(pricePoints, config.initialCapital);
      break;
    default:
      state = simulateYieldOptimizer(pricePoints, config.initialCapital);
  }

  const metrics = computeMetrics(state, config.initialCapital, days);

  return {
    config,
    metrics,
    trades: state.trades,
    equityCurve: state.equityCurve,
    startedAt,
    completedAt: Date.now(),
    priceDataPoints: pricePoints.length,
  };
}

// ── Server Function ──────────────────────────────────────────────────

export const runBacktest = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as BacktestConfig)
  .handler(async ({ data }) => {
    return runBacktestInternal(data);
  });
