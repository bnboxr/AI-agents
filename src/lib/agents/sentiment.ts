// ── Sentiment Agent ─────────────────────────────────────────────────
// Level 1 Intelligence Agent: Fear & Greed Index + GPT-4o synthesis.
// Fetches Crypto Fear & Greed from alternative.me and produces a
// contrarian sentiment report (extreme fear = bullish, extreme greed = bearish).
//
// Data: https://api.alternative.me/fng/ (single REST call, no auth required)

import { BaseAgent } from "./base";
import type { AgentReport } from "./types";

// ── Types ──────────────────────────────────────────────────────────

export interface FearGreedData {
  value: number; // 0-100
  classification: string; // e.g. "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
  timestamp: string; // epoch seconds
  timeUntilUpdate?: string;
}

export interface SentimentContext {
  fearGreed: FearGreedData;
  /** Computed contrarian score: (50 - fng) * 2 → range [-100, +100] */
  contrarianScore: number;
}

// ── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a crypto market sentiment analyst specializing in crowd psychology and contrarian signals.

Your input is the Crypto Fear & Greed Index (0-100) and a pre-computed contrarian score:
- 0-24: Extreme Fear → historically a buying opportunity (contrarian bullish)
- 25-49: Fear → cautiously bullish
- 50-74: Greed → cautiously bearish  
- 75-100: Extreme Greed → historically a selling signal (contrarian bearish)

The contrarian score formula: (50 - fng) * 2. Positive = bullish, negative = bearish.

Your task: synthesize the fear & greed reading with crowd psychology. Are retail traders panicking? Are they euphoric? What does the contrarian perspective suggest?

Respond with JSON only:
{
  "direction": "LONG" | "SHORT" | "NEUTRAL",
  "confidence": <0-100>,
  "reasoning": "<2-3 sentence synthesis of psychology + contrarian signal>",
  "data": { "fearGreed": <value>, "contrarianScore": <value>, "classification": "<label>" }
}`;

// ── API Fetch ──────────────────────────────────────────────────────

const FNG_API = "https://api.alternative.me/fng/?limit=1";

async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(FNG_API, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[SentimentAgent] FNG API returned ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      data: Array<{
        value: string;
        value_classification: string;
        timestamp: string;
        time_until_update?: string;
      }>;
    };

    const item = json.data?.[0];
    if (!item) return null;

    return {
      value: parseInt(item.value, 10) || 50,
      classification: item.value_classification || "Neutral",
      timestamp: item.timestamp || String(Math.floor(Date.now() / 1000)),
      timeUntilUpdate: item.time_until_update,
    };
  } catch (err) {
    console.warn(
      `[SentimentAgent] FNG fetch failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
    return null;
  }
}

// ── Agent Class ────────────────────────────────────────────────────

export class SentimentAgent extends BaseAgent {
  private lastFng: FearGreedData | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 120_000; // 2 min cache

  constructor() {
    super({
      id: "sentiment-agent",
      role: "sentiment",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Public API ───────────────────────────────────────────────────

  /** Fetch (or return cached) Fear & Greed data. */
  async getFearGreed(): Promise<FearGreedData | null> {
    const now = Date.now();
    if (this.lastFng && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.lastFng;
    }
    const fng = await fetchFearGreed();
    if (fng) {
      this.lastFng = fng;
      this.lastFetchTime = now;
    }
    return fng;
  }

  /** Compute the contrarian score from an FNG value. */
  computeContrarianScore(fngValue: number): number {
    return (50 - fngValue) * 2;
  }

  /** Classify the contrarian signal direction from the score. */
  classifyContrarian(score: number): {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    signal: string;
  } {
    if (score > 40) return { direction: "LONG", signal: "Strong contrarian bullish" };
    if (score > 15) return { direction: "LONG", signal: "Contrarian bullish" };
    if (score < -40) return { direction: "SHORT", signal: "Strong contrarian bearish" };
    if (score < -15) return { direction: "SHORT", signal: "Contrarian bearish" };
    return { direction: "NEUTRAL", signal: "Neutral — no strong contrarian signal" };
  }

  // ── Overrides ────────────────────────────────────────────────────

  protected buildUserPrompt(context: { fearGreed: FearGreedData; contrarianScore: number }): string {
    const { fearGreed, contrarianScore } = context;
    return [
      `Fear & Greed Index: ${fearGreed.value}/100 (${fearGreed.classification})`,
      `Contrarian Score: ${contrarianScore.toFixed(1)} (${contrarianScore > 0 ? "bullish" : "bearish"} bias)`,
      "",
      "Crowd psychology? Contrarian signal? Synthesize.",
    ].join("\n");
  }

  /** Fetch FNG, compute score, and either fast-path or call GPT-4o. */
  async analyzeMarket(_context?: any): Promise<AgentReport> {
    const fng = await this.getFearGreed();

    if (!fng) {
      return this.fallbackReport(
        "Fear & Greed Index unavailable (alternative.me API may be down). Using neutral signal.",
      );
    }

    const contrarianScore = this.computeContrarianScore(fng.value);
    const rulesBased = this.classifyContrarian(contrarianScore);

    // Fast path: extreme values with high confidence — skip LLM
    if (Math.abs(contrarianScore) > 40) {
      const direction = contrarianScore > 40 ? "LONG" : "SHORT";
      const sentiment = contrarianScore > 40 ? "Extreme Fear" : "Extreme Greed";
      return {
        agentId: this.id,
        role: this.role,
        timestamp: Date.now(),
        direction,
        confidence: Math.min(95, Math.abs(contrarianScore)),
        reasoning: `Fear & Greed: ${fng.value}/100 (${sentiment}). Strong contrarian signal — ${rulesBased.signal}. Crowd psychology suggests retail is ${contrarianScore > 40 ? "panic selling" : "euphoric buying"} — historically a ${direction === "LONG" ? "buying" : "selling"} opportunity.`,
        data: {
          fearGreed: fng,
          contrarianScore,
          classification: fng.classification,
          fastPath: true,
        },
      };
    }

    // Near-neutral: also skip LLM — not worth the API call
    if (Math.abs(contrarianScore) < 15) {
      return {
        agentId: this.id,
        role: this.role,
        timestamp: Date.now(),
        direction: "NEUTRAL",
        confidence: Math.max(40, 50 - Math.abs(contrarianScore)),
        reasoning: `Fear & Greed: ${fng.value}/100 (${fng.classification}). No strong contrarian signal — market sentiment is balanced.`,
        data: {
          fearGreed: fng,
          contrarianScore,
          classification: fng.classification,
          fastPath: true,
        },
      };
    }

    // Moderate signal → GPT-4o synthesis
    return super.analyzeMarket({ fearGreed: fng, contrarianScore });
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: SentimentAgent | null = null;

export function getSentimentAgent(): SentimentAgent {
  if (!_instance) {
    _instance = new SentimentAgent();
  }
  return _instance;
}
