// ── Market Analysis Agent ─────────────────────────────────────────
import { BaseAgent } from "./base";
import { getPrice } from "../ws/price-context";

export interface OHLCVBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SYSTEM_PROMPT = `You are a professional market analyst with 40 years experience trading crypto, forex, and equities. Your specialty is reading price action, trend structure, and momentum on short timeframes (5m–1h).

Analyze the provided OHLCV price data and determine:
- Market direction: LONG (bullish), SHORT (bearish), or NEUTRAL (sideways/choppy)
- Confidence: 0-100 based on signal clarity
- Trend strength: WEAK / MODERATE / STRONG
- Volatility assessment: LOW / NORMAL / HIGH
- Key support and resistance levels from the data

Consider: trend direction, momentum, volume patterns, higher highs/lower lows, market structure, and volatility regime.

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"concise analysis","data":{"trendStrength":"WEAK"|"MODERATE"|"STRONG","volatility":"LOW"|"NORMAL"|"HIGH","support":number,"resistance":number,"momentum":"BULLISH"|"BEARISH"|"NEUTRAL"}}`;

export class MarketAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      id: "market-agent",
      role: "market",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /**
   * Get the current live price for a token from the real-time WebSocket feed.
   * Falls back to null if no live data is available.
   */
  static getLivePrice(token: string): number | null {
    return getPrice(token);
  }

  protected buildUserPrompt(context: {
    token: string;
    chainId: string;
    currentPrice: number;
    change24h: number;
    volume24h: number;
    high24h: number;
    low24h: number;
    ohlcv?: OHLCVBar[];
  }): string {
    const lines: string[] = [
      `Token: ${context.token} (${context.chainId})`,
      `Current Price: $${context.currentPrice}`,
      `24h Change: ${context.change24h}%`,
      `24h Volume: $${context.volume24h.toLocaleString()}`,
      `24h High: $${context.high24h}`,
      `24h Low: $${context.low24h}`,
    ];

    if (context.ohlcv && context.ohlcv.length > 0) {
      lines.push(`\nRecent OHLCV data (${context.ohlcv.length} candles):`);
      for (const bar of context.ohlcv.slice(-12)) {
        lines.push(
          `  ${new Date(bar.timestamp).toISOString()} | O:${bar.open} H:${bar.high} L:${bar.low} C:${bar.close} V:${bar.volume}`,
        );
      }
    }

    return lines.join("\n");
  }
}
