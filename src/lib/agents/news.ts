// ── News Sentiment Agent ──────────────────────────────────────────
import { BaseAgent } from "./base";
import { agentBus } from "../agent-bus";

export interface NewsHeadline {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number; // unix ms
}

export interface ScoredHeadline {
  headline: NewsHeadline;
  sentiment: number;  // -100 to +100
  impact: "LOW" | "MEDIUM" | "HIGH";
}

const SYSTEM_PROMPT = `You are a crypto news analyst. Score these headlines for market impact. For each: sentiment (-100 bearish to +100 bullish), impact (LOW/MEDIUM/HIGH). Return JSON: {"overallSentiment": number, "confidence": number, "direction": "LONG"|"SHORT"|"NEUTRAL", "summary": string}`;

/**
 * Simple similarity score between two strings (Jaccard-like on word tokens).
 * Returns 0-1 where 1 = identical.
 */
function titleSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => {
    const lower = s.toLowerCase();
    // Extract words of 3+ chars
    return new Set(lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  };
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  const intersection = new Set([...ta].filter((x) => tb.has(x)));
  const union = new Set([...ta, ...tb]);
  return intersection.size / union.size;
}

/** Deduplicate headlines by title similarity. */
function deduplicateHeadlines(headlines: NewsHeadline[]): NewsHeadline[] {
  const result: NewsHeadline[] = [];
  for (const h of headlines) {
    const isDuplicate = result.some(
      (r) => titleSimilarity(r.title, h.title) > 0.7,
    );
    if (!isDuplicate) result.push(h);
  }
  return result;
}

/** Apply exponential decay weighting: more recent = higher weight. */
function exponentialDecayWeight(
  publishedAt: number,
  now: number,
  halfLifeMs: number = 3_600_000, // 1 hour
): number {
  const ageMs = now - publishedAt;
  return Math.exp((-Math.LN2 * ageMs) / halfLifeMs);
}

export class NewsSentimentAgent extends BaseAgent {
  constructor() {
    super({
      id: "news-agent",
      role: "news",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  /** Fetch headlines from CryptoPanic RSS feed (free, no API key). */
  async fetchCryptoPanic(): Promise<NewsHeadline[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      // Use a CORS-friendly approach — RSS-to-JSON via a public converter
      const res = await fetch(
        "https://cryptopanic.com/api/v1/posts/?auth_token=&public=true&filter=news",
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (!res.ok) return [];

      const data = (await res.json()) as {
        results?: Array<{
          id: number;
          title: string;
          url: string;
          source?: { title: string };
          published_at: string;
        }>;
      };

      return (data.results || []).map((item) => ({
        id: `cp-${item.id}`,
        title: item.title,
        url: item.url,
        source: item.source?.title || "CryptoPanic",
        publishedAt: new Date(item.published_at).getTime(),
      }));
    } catch (err) {
      console.warn("[NewsAgent] fetchCryptoPanic failed:", err);
      return [];
    }
  }

  /** Fetch headlines from CoinGecko /news endpoint (free tier). */
  async fetchCoinGeckoNews(): Promise<NewsHeadline[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch("https://api.coingecko.com/api/v3/news", {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return [];

      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          title: string;
          url: string;
          author: string;
          updated_at: number;
        }>;
      };

      return (data.data || []).map((item) => ({
        id: `cg-${item.id}`,
        title: item.title,
        url: item.url,
        source: item.author || "CoinGecko",
        publishedAt: item.updated_at * 1000,
      }));
    } catch (err) {
      console.warn("[NewsAgent] fetchCoinGeckoNews failed:", err);
      return [];
    }
  }

  /** Fetch, deduplicate, and return all headlines. */
  async fetchHeadlines(): Promise<NewsHeadline[]> {
    const [cpNews, cgNews] = await Promise.all([
      this.fetchCryptoPanic(),
      this.fetchCoinGeckoNews(),
    ]);

    const combined = [...cpNews, ...cgNews];
    const deduped = deduplicateHeadlines(combined);

    // Sort newest first
    deduped.sort((a, b) => b.publishedAt - a.publishedAt);

    return deduped;
  }

  /** Build the user prompt from the headlines context. */
  protected buildUserPrompt(context: {
    headlines: NewsHeadline[];
  }): string {
    const lines: string[] = [
      `Analyze these ${context.headlines.length} crypto news headlines for market sentiment:`,
      "",
    ];

    for (const h of context.headlines) {
      const ageMin = Math.round(
        (Date.now() - h.publishedAt) / 60_000,
      );
      lines.push(`- [${h.source}] ${h.title} (${ageMin}m ago)`);
    }

    lines.push(
      "",
      "Return the overall market sentiment:",
      "- overallSentiment: -100 (extremely bearish) to +100 (extremely bullish)",
      "- confidence: 0-100 on how clear the signal is",
      '- direction: "LONG" if bullish, "SHORT" if bearish, "NEUTRAL" if mixed',
      "- summary: one-sentence takeaway",
    );

    return lines.join("\n");
  }

  /** Core analysis: fetch headlines, score with GPT-4o, emit event. */
  async analyzeNews(context?: { token?: string; chainId?: string }): Promise<{
    headlines: NewsHeadline[];
    overallSentiment: number;
    confidence: number;
    direction: "LONG" | "SHORT" | "NEUTRAL";
    summary: string;
  }> {
    const headlines = await this.fetchHeadlines();

    if (headlines.length === 0) {
      const fallback = {
        headlines: [] as NewsHeadline[],
        overallSentiment: 0,
        confidence: 0,
        direction: "NEUTRAL" as const,
        summary: "No news headlines available.",
      };

      agentBus.emit("news_sentiment", {
        chainId: context?.chainId || "unknown",
        token: context?.token || "unknown",
        overallSentiment: fallback.overallSentiment,
        confidence: fallback.confidence,
        direction: fallback.direction,
        headlineCount: 0,
        summary: fallback.summary,
        timestamp: Date.now(),
      });

      return fallback;
    }

    // Run LLM analysis via base class
    const report = await super.analyzeMarket({ headlines });

    // Extract sentiment data from the report
    const overallSentiment = report.data?.overallSentiment ?? 0;
    const confidence = report.confidence;
    const direction = report.direction;
    const summary = report.reasoning;

    // Emit news_sentiment event on agentBus
    agentBus.emit("news_sentiment", {
      chainId: context?.chainId || "unknown",
      token: context?.token || "unknown",
      overallSentiment,
      confidence,
      direction,
      headlineCount: headlines.length,
      summary,
      timestamp: Date.now(),
    });

    return {
      headlines,
      overallSentiment,
      confidence,
      direction,
      summary,
    };
  }
}
