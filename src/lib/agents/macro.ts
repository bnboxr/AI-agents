// ── Macro Analysis Agent ──────────────────────────────────────────
import { BaseAgent } from "./base";
import { getCorrelationAgent } from "./correlation";

export interface MacroData {
  dxy: number;
  sp500: number;
  gold: number;
  fearGreedIndex: number;
  fearGreedLabel: string;
  timestamp: number;
}

export interface MacroCorrelation {
  dxyCryptoCorr: number;   // typically negative
  sp500CryptoCorr: number; // typically positive
  goldCryptoCorr: number;  // variable
}

const SYSTEM_PROMPT = `You are a macro-economic analyst specializing in crypto markets. Analyze macro indicators and determine the prevailing macro regime for crypto assets.

Key relationships to consider:
- DXY (US Dollar Index): Stronger dollar typically bearish for crypto (inverse correlation)
- S&P 500: Risk-on proxy — crypto often correlates with equities in bull markets
- Gold: Safe-haven asset — gold rally alongside crypto can signal monetary debasement narrative
- Fear & Greed Index: 0-25 Extreme Fear (contrarian buy?), 25-45 Fear, 45-55 Neutral, 55-75 Greed, 75-100 Extreme Greed (caution)

Determine:
- Macro regime: RISK_ON (favorable for crypto), RISK_OFF (bearish), or NEUTRAL
- Direction for crypto: LONG, SHORT, or NEUTRAL
- Confidence: 0-100

Respond in JSON format only:
{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":0-100,"reasoning":"concise macro analysis","data":{"regime":"RISK_ON"|"RISK_OFF"|"NEUTRAL","dxySignal":"BULLISH"|"BEARISH"|"NEUTRAL","sp500Signal":"BULLISH"|"BEARISH"|"NEUTRAL","goldSignal":"BULLISH"|"BEARISH"|"NEUTRAL","fearGreedSignal":"BULLISH"|"BEARISH"|"NEUTRAL"}}`;

export class MacroAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      id: "macro-agent",
      role: "macro",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /** Fetch DXY from Yahoo Finance unofficial API. */
  async fetchDXY(): Promise<{ price: number; changePct: number } | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      // Yahoo Finance v8 chart API for DX-Y.NYB (DXY futures)
      const res = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d",
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (!res.ok) return null;

      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number };
          }>;
        };
      };

      const meta = data.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) return null;

      return {
        price: meta.regularMarketPrice,
        changePct: meta.regularMarketChangePercent ?? 0,
      };
    } catch {
      return null;
    }
  }

  /** Fetch S&P 500 from Yahoo Finance. */
  async fetchSP500(): Promise<{ price: number; changePct: number } | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/^GSPC?interval=1d&range=5d",
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (!res.ok) return null;

      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number };
          }>;
        };
      };

      const meta = data.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) return null;

      return {
        price: meta.regularMarketPrice,
        changePct: meta.regularMarketChangePercent ?? 0,
      };
    } catch {
      return null;
    }
  }

  /** Fetch gold (GC=F) from Yahoo Finance. */
  async fetchGold(): Promise<{ price: number; changePct: number } | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=5d",
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (!res.ok) return null;

      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number };
          }>;
        };
      };

      const meta = data.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) return null;

      return {
        price: meta.regularMarketPrice,
        changePct: meta.regularMarketChangePercent ?? 0,
      };
    } catch {
      return null;
    }
  }

  /** Fetch Fear & Greed Index from alternative.me. */
  async fetchFearGreed(): Promise<{
    value: number;
    label: string;
  } | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch("https://api.alternative.me/fng/?limit=1", {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return null;

      const data = (await res.json()) as {
        data?: Array<{ value: string; value_classification: string }>;
      };

      const item = data.data?.[0];
      if (!item) return null;

      return {
        value: parseInt(item.value, 10),
        label: item.value_classification,
      };
    } catch {
      return null;
    }
  }

  /** Fetch all macro data in parallel. */
  async fetchMacroData(): Promise<MacroData> {
    const [dxy, sp500, gold, fng] = await Promise.all([
      this.fetchDXY(),
      this.fetchSP500(),
      this.fetchGold(),
      this.fetchFearGreed(),
    ]);

    return {
      dxy: dxy?.price ?? 0,
      sp500: sp500?.price ?? 0,
      gold: gold?.price ?? 0,
      fearGreedIndex: fng?.value ?? 50,
      fearGreedLabel: fng?.label ?? "Neutral",
      timestamp: Date.now(),
    };
  }

  /**
   * Compute correlations using live data from CorrelationAgent when available.
   * Falls back to heuristic defaults if correlation data is not yet ready.
   * DXY typically inversely correlated, S&P500 typically positively correlated.
   */
  computeCorrelations(macro: MacroData): MacroCorrelation {
    // Hardcoded fallback defaults
    const FALLBACK_DXY_CRYPTO = -0.5;
    const FALLBACK_SP500_CRYPTO = 0.6;
    const FALLBACK_GOLD_CRYPTO = macro.fearGreedIndex < 30 ? -0.3 : 0.3;

    try {
      const corrAgent = getCorrelationAgent();
      const matrix = corrAgent.getMatrix();

      // If correlation agent has live data, extract the relevant pairs
      if (matrix.dataAvailable) {
        let dxyCryptoCorr = FALLBACK_DXY_CRYPTO;
        let sp500CryptoCorr = FALLBACK_SP500_CRYPTO;
        let goldCryptoCorr = FALLBACK_GOLD_CRYPTO;

        for (const pair of matrix.pairs) {
          switch (pair.pair) {
            case "DXY-CRYPTO":
              dxyCryptoCorr = pair.short; // 7d correlation
              break;
            case "BTC-SPX":
              sp500CryptoCorr = pair.short;
              break;
            case "BTC-GOLD":
              goldCryptoCorr = pair.short;
              break;
          }
        }

        return { dxyCryptoCorr, sp500CryptoCorr, goldCryptoCorr };
      }
    } catch {
      // Correlation agent unavailable — use hardcoded defaults
    }

    return {
      dxyCryptoCorr: FALLBACK_DXY_CRYPTO,
      sp500CryptoCorr: FALLBACK_SP500_CRYPTO,
      goldCryptoCorr: FALLBACK_GOLD_CRYPTO,
    };
  }

  /** Build user prompt from macro context. */
  protected buildUserPrompt(context: {
    macroData: MacroData;
    correlations: MacroCorrelation;
  }): string {
    const m = context.macroData;
    const c = context.correlations;

    return [
      `Macro Indicators (as of ${new Date(m.timestamp).toISOString()}):`,
      `  DXY (US Dollar Index): ${m.dxy.toFixed(2)}`,
      `  S&P 500: ${m.sp500.toFixed(2)}`,
      `  Gold (GC=F): $${m.gold.toFixed(2)}`,
      `  Fear & Greed Index: ${m.fearGreedIndex} (${m.fearGreedLabel})`,
      "",
      `Known Correlations with Crypto:`,
      `  DXY ↔ Crypto: ${c.dxyCryptoCorr.toFixed(2)} (inverse)`,
      `  S&P500 ↔ Crypto: ${c.sp500CryptoCorr.toFixed(2)} (positive)`,
      `  Gold ↔ Crypto: ${c.goldCryptoCorr.toFixed(2)}`,
      "",
      `Analyze the macro regime and determine whether conditions favor LONG or SHORT crypto exposure.`,
    ].join("\n");
  }

  /** Core analysis: fetch macro data, run GPT-4o analysis. */
  async analyzeMacro(): Promise<{
    macroData: MacroData;
    correlations: MacroCorrelation;
    regime: string;
  }> {
    const macroData = await this.fetchMacroData();
    const correlations = this.computeCorrelations(macroData);

    // If all macro data failed to fetch, return neutral fallback
    if (macroData.dxy === 0 && macroData.sp500 === 0 && macroData.gold === 0) {
      return {
        macroData,
        correlations,
        regime: "NEUTRAL",
      };
    }

    // LLM analysis via base class — we don't call analyzeMarket directly
    // from analyzeMacro since we want the raw report plus macroData.
    return {
      macroData,
      correlations,
      regime: "NEUTRAL", // will be overridden by LLM in analyzeMarket
    };
  }

  /** Override analyzeMarket to accept macro context directly. */
  async analyzeMarket(context?: any): Promise<import("./types").AgentReport> {
    const macroData = context?.macroData ?? (await this.fetchMacroData());
    const correlations = context?.correlations ?? this.computeCorrelations(macroData);

    if (macroData.dxy === 0 && macroData.sp500 === 0 && macroData.gold === 0) {
      return this.fallbackReport(
        "Macro data unavailable from all sources. Check network connectivity.",
      );
    }

    return super.analyzeMarket({ macroData, correlations });
  }
}
