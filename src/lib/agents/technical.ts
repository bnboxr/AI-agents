// ── Technical Analysis Agent ─────────────────────────────────────
import { BaseAgent } from "./base";

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
      `Current Price: $${ind.currentPrice}`,
      ``,
      `Technical Indicators:`,
      `  RSI (14): ${ind.rsi.toFixed(1)}`,
      `  MACD: value=${ind.macd.value.toFixed(4)} signal=${ind.macd.signal.toFixed(4)} histogram=${ind.macd.histogram.toFixed(4)}`,
      `  EMA 20: $${ind.ema20.toFixed(4)}`,
      `  EMA 50: $${ind.ema50.toFixed(4)}`,
      `  EMA 200: $${ind.ema200.toFixed(4)}`,
      `  VWAP: $${ind.vwap.toFixed(4)}`,
      `  ATR: ${ind.atr.toFixed(4)} (${ind.atrPct.toFixed(2)}%)`,
      `  Bollinger Bands: upper=$${ind.bollingerBands.upper.toFixed(4)} middle=$${ind.bollingerBands.middle.toFixed(4)} lower=$${ind.bollingerBands.lower.toFixed(4)} width=${ind.bollingerBands.width.toFixed(2)}%`,
    ].join("\n");
  }
}
