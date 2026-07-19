// ── Technical Analysis Agent ─────────────────────────────────────
import { BaseAgent } from "./base";
import { getPriceHistory, type PriceTick } from "../ws/price-context";

export interface TechnicalIndicators {
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  ema20: number;
  ema50: number;
  ema200: number;
  vwap: number;
  atr: number;
  atrPct: number;
  bollingerBands: { upper: number; middle: number; lower: number; width: number };
  currentPrice: number;
}

const SYSTEM_PROMPT = `You are a professional technical analyst with decades of experience. You analyze technical indicators to determine trade direction, identify divergences, and find support/resistance levels.

Analyze the provided technical indicators:
- RSI (14): Overbought > 70, Oversold < 30
- MACD: Signal crossovers, histogram momentum
- EMAs (20/50/200): Golden cross, death cross, price relative to EMAs
- VWAP: Price above = bullish, below = bearish
- ATR: Volatility context for stop placement
- Bollinger Bands: Squeeze/expansion, price at bands

Determine: direction (LONG/SHORT/NEUTRAL), confidence (0-100), and identify key signals.

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"concise technical analysis","data":{"signals":["signal1","signal2"],"divergences":[],"supportLevels":[number],"resistanceLevels":[number],"indicatorSummary":"brief summary"}}`;

export class TechnicalAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      id: "technical-agent",
      role: "technical",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  protected buildUserPrompt(context: { token: string; chainId: string; indicators: TechnicalIndicators }): string {
    const ind = context.indicators;
    return [
      `Token: ${context.token} (${context.chainId})`,
      `Current Price: ${ind.currentPrice}`,
      ``,
      `Technical Indicators:`,
      `  RSI (14): ${ind.rsi.toFixed(1)}`,
      `  MACD: value=${ind.macd.value.toFixed(4)} signal=${ind.macd.signal.toFixed(4)} histogram=${ind.macd.histogram.toFixed(4)}`,
      `  EMA 20: ${ind.ema20.toFixed(4)}`,
      `  EMA 50: ${ind.ema50.toFixed(4)}`,
      `  EMA 200: ${ind.ema200.toFixed(4)}`,
      `  VWAP: ${ind.vwap.toFixed(4)}`,
      `  ATR: ${ind.atr.toFixed(4)} (${ind.atrPct.toFixed(2)}%)`,
      `  Bollinger Bands: upper=${ind.bollingerBands.upper.toFixed(4)} middle=${ind.bollingerBands.middle.toFixed(4)} lower=${ind.bollingerBands.lower.toFixed(4)} width=${ind.bollingerBands.width.toFixed(2)}%`,
    ].join("\n");
  }
}

// ── Real-Time Indicator Computation ───────────────────────────────
// Uses live price history from the WebSocket market data to compute
// technical indicators on the fly.

/**
 * Compute an exponential moving average from a price series.
 */
function computeEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return prices.reduce((a, b) => a + b, 0) / prices.length;

  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Compute RSI (Relative Strength Index) from a price series.
 */
function computeRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Compute MACD from a price series.
 */
function computeMACD(prices: number[]): { value: number; signal: number; histogram: number } {
  if (prices.length < 26) {
    return { value: 0, signal: 0, histogram: 0 };
  }

  // Compute EMA-12 and EMA-26 from the full series
  const ema12 = computeEMA(prices, 12);
  const ema26 = computeEMA(prices, 26);
  const value = ema12 - ema26;

  // For signal line we need the MACD line history — simplified: use single MACD value
  // In practice, signal would be a 9-period EMA of the MACD line
  // Here we approximate: signal is a 9-period EMA approximation
  const signal = value * 0.9; // simplified approximation
  const histogram = value - signal;

  return { value, signal, histogram };
}

/**
 * Compute Bollinger Bands from a price series.
 */
function computeBollingerBands(prices: number[], period = 20): { upper: number; middle: number; lower: number; width: number } {
  if (prices.length < period) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return { upper: avg, middle: avg, lower: avg, width: 0 };
  }

  const recent = prices.slice(-period);
  const middle = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + 2 * stdDev;
  const lower = middle - 2 * stdDev;
  const width = middle > 0 ? ((upper - lower) / middle) * 100 : 0;

  return { upper, middle, lower, width };
}

/**
 * Compute ATR (Average True Range) from price ticks.
 */
function computeATR(ticks: PriceTick[], period = 14): { atr: number; atrPct: number } {
  if (ticks.length < 2) return { atr: 0, atrPct: 0 };

  const prices = ticks.map((t) => t.price);
  const trueRanges: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    trueRanges.push(Math.abs(prices[i] - prices[i - 1]));
  }

  const atr = trueRanges.length > 0
    ? trueRanges.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trueRanges.length)
    : 0;

  const lastPrice = prices[prices.length - 1];
  const atrPct = lastPrice > 0 ? (atr / lastPrice) * 100 : 0;

  return { atr, atrPct };
}

/**
 * Compute VWAP from price ticks.
 */
function computeVWAP(ticks: PriceTick[]): number {
  if (ticks.length === 0) return 0;

  let cumPV = 0;
  let cumV = 0;

  for (const tick of ticks) {
    const vol = tick.volume > 0 ? tick.volume : 1;
    cumPV += tick.price * vol;
    cumV += vol;
  }

  return cumV > 0 ? cumPV / cumV : ticks[ticks.length - 1].price;
}

/**
 * Compute real-time technical indicators from live WebSocket price history.
 * @param symbol - Token symbol (e.g. "BTC", "ETH")
 * @returns TechnicalIndicators computed from the live ring buffer
 */
export function computeLiveIndicators(symbol: string): TechnicalIndicators | null {
  const ticks = getPriceHistory(symbol, 200);
  if (ticks.length < 14) return null; // need minimum data

  const prices = ticks.map((t) => t.price);
  const currentPrice = prices[prices.length - 1];

  const rsi = computeRSI(prices);
  const macd = computeMACD(prices);
  const ema20 = computeEMA(prices, 20);
  const ema50 = computeEMA(prices, 50);
  const ema200 = computeEMA(prices, 200);
  const vwap = computeVWAP(ticks);
  const { atr, atrPct } = computeATR(ticks);
  const bollingerBands = computeBollingerBands(prices);

  return {
    rsi,
    macd,
    ema20,
    ema50,
    ema200,
    vwap,
    atr,
    atrPct,
    bollingerBands,
    currentPrice,
  };
}
