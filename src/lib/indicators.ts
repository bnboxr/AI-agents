// ── Shared Technical Indicator Library ───────────────────────────────
// Centralized implementations for use by all agents.
// Eliminates duplicated indicator code across agent modules.
//
// Price-based indicators (data: number[]): EMA, RSI, SMA, MACD
// Bar-based indicators (bars: OHLCBar[]): ADX, Swing Highs/Lows

// ── Types ────────────────────────────────────────────────────────────

export interface OHLCBar {
  high: number;
  low: number;
  close: number;
}

// ── SMA: Simple Moving Average ───────────────────────────────────────

/**
 * Compute Simple Moving Average from a price series.
 * @param data - Array of prices (most recent last).
 * @param period - Lookback period.
 * @returns SMA value, or 0 if insufficient data.
 */
export function computeSMA(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) return 0;
  const window = data.slice(-Math.min(period, data.length));
  return window.reduce((a, b) => a + b, 0) / window.length;
}

// ── EMA: Exponential Moving Average ──────────────────────────────────

/**
 * Compute Exponential Moving Average from a price series.
 * Uses Wilder's smoothing (k = 2 / (period + 1)).
 * @param data - Array of prices (most recent last).
 * @param period - Lookback period.
 * @returns EMA value, or simple average if insufficient data.
 */
export function computeEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) {
    return data.reduce((a, b) => a + b, 0) / data.length;
  }

  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

// ── RSI: Relative Strength Index ─────────────────────────────────────

/**
 * Compute RSI (Relative Strength Index) using Wilder's smoothing.
 * @param data - Array of prices (most recent last).
 * @param period - Lookback period (default 14).
 * @returns RSI value 0-100, or 50 if insufficient data.
 */
export function computeRSI(data: number[], period: number = 14): number {
  if (data.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = data.length - period; i < data.length; i++) {
    const delta = data[i] - data[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD: Moving Average Convergence Divergence ──────────────────────

/**
 * Compute MACD (12/26/9) from a price series.
 * Uses EMA-12, EMA-26 for the MACD line, and a 9-period EMA of the
 * MACD line values for the signal line.
 * @param data - Array of prices (most recent last).
 * @returns { value, signal, histogram } or zeros if insufficient data.
 */
export function computeMACD(data: number[]): {
  value: number;
  signal: number;
  histogram: number;
} {
  if (data.length < 26) {
    return { value: 0, signal: 0, histogram: 0 };
  }

  // Compute rolling MACD values for signal line derivation
  // We compute EMA-12 and EMA-26 at each point past the slowest period
  const macdValues: number[] = [];
  for (let i = 26; i <= data.length; i++) {
    const slice = data.slice(0, i);
    const ema12 = computeEMA(slice, 12);
    const ema26 = computeEMA(slice, 26);
    macdValues.push(ema12 - ema26);
  }

  const value = macdValues[macdValues.length - 1];
  const signal = macdValues.length >= 9
    ? computeEMA(macdValues, 9)
    : macdValues.reduce((a, b) => a + b, 0) / macdValues.length;
  const histogram = value - signal;

  return { value, signal, histogram };
}

// ── Swing Highs / Lows ───────────────────────────────────────────────

/**
 * Find swing highs in a bar series.
 * A swing high is a bar whose high is higher than all highs within
 * `lookback` bars before AND after it.
 * @param bars - Array of OHLC bars (most recent last).
 * @param lookback - Number of bars to check on each side.
 * @returns Array of indices (into the bars array) where swing highs occur.
 */
export function findSwingHighs(bars: OHLCBar[], lookback: number): number[] {
  if (bars.length < lookback * 2 + 1 || lookback < 1) return [];

  const swingHighs: number[] = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    const high = bars[i].high;
    let isSwingHigh = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= high) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      swingHighs.push(i);
    }
  }

  return swingHighs;
}

/**
 * Find swing lows in a bar series.
 * A swing low is a bar whose low is lower than all lows within
 * `lookback` bars before AND after it.
 * @param bars - Array of OHLC bars (most recent last).
 * @param lookback - Number of bars to check on each side.
 * @returns Array of indices (into the bars array) where swing lows occur.
 */
export function findSwingLows(bars: OHLCBar[], lookback: number): number[] {
  if (bars.length < lookback * 2 + 1 || lookback < 1) return [];

  const swingLows: number[] = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    const low = bars[i].low;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].low <= low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swingLows.push(i);
    }
  }

  return swingLows;
}

// ── ADX: Average Directional Index ───────────────────────────────────

/**
 * Compute ADX (Average Directional Index) from OHLC bars.
 * Uses Wilder's smoothing for +DM, -DM, and TR.
 * @param bars - Array of OHLC bars (most recent last).
 * @param period - Lookback period (default 14).
 * @returns ADX value (0-100), or 0 if insufficient data.
 */
export function computeADX(bars: OHLCBar[], period: number = 14): number {
  if (bars.length < period + 1) return 0;

  // True Range series
  const trValues: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const prevHigh = bars[i - 1].high;
    const prevLow = bars[i - 1].low;

    // True Range
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trValues.push(tr);

    // Directional Movement
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  // Wilder's smoothing for TR, +DM, -DM
  const smoothTR = wilderSmooth(trValues, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);

  if (smoothTR === 0) return 0;

  // +DI and -DI
  const plusDI = (smoothPlusDM / smoothTR) * 100;
  const minusDI = (smoothMinusDM / smoothTR) * 100;

  // DX
  const diSum = plusDI + minusDI;
  if (diSum === 0) return 0;
  const dx = (Math.abs(plusDI - minusDI) / diSum) * 100;

  // ADX: we compute DX for each period, then smooth
  // For a single-point ADX, compute DX over the most recent `period` values
  const dxValues: number[] = [];
  for (let i = period; i < trValues.length; i++) {
    const trSlice = trValues.slice(i - period + 1, i + 1);
    const pdmSlice = plusDM.slice(i - period + 1, i + 1);
    const mdmSlice = minusDM.slice(i - period + 1, i + 1);

    const sTR = wilderSmooth(trSlice, period);
    const sPDM = wilderSmooth(pdmSlice, period);
    const sMDM = wilderSmooth(mdmSlice, period);

    if (sTR === 0) {
      dxValues.push(0);
      continue;
    }

    const pDI = (sPDM / sTR) * 100;
    const mDI = (sMDM / sTR) * 100;
    const diSum2 = pDI + mDI;
    if (diSum2 === 0) {
      dxValues.push(0);
      continue;
    }
    dxValues.push((Math.abs(pDI - mDI) / diSum2) * 100);
  }

  // Smooth the DX series to get ADX
  if (dxValues.length === 0) return 0;
  const adx = dxValues.reduce((a, b) => a + b, 0) / dxValues.length;

  return Math.min(100, Math.max(0, adx));
}

/**
 * Internal: Wilder's smoothing (similar to EMA with α = 1/period).
 */
function wilderSmooth(values: number[], period: number): number {
  if (values.length < period) {
    return values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  }

  // Initial: simple average of first `period` values
  let smoothed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    smoothed = (smoothed * (period - 1) + values[i]) / period;
  }

  return smoothed;
}
