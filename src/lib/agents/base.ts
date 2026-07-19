// ── Base Agent Class ──────────────────────────────────────────────
import { getApiKey } from "~/lib/api-keys";
import type { AgentReport, AgentRole } from "./types";

export interface BaseAgentConfig {
  id: string;
  role: AgentRole;
  systemPrompt: string;
}

export class BaseAgent {
  readonly id: string;
  readonly role: AgentRole;
  private systemPrompt: string;

  constructor(config: BaseAgentConfig) {
    this.id = config.id;
    this.role = config.role;
    this.systemPrompt = config.systemPrompt;
  }

  /** Generate the user prompt from context data. Override in subclasses. */
  protected buildUserPrompt(context: any): string {
    if (typeof context === "string") return context;
    return JSON.stringify(context, null, 2);
  }

  /** Call GPT-4o with the agent's system prompt and context. */
  async analyzeMarket(context: any): Promise<AgentReport> {
    const apiKey = getApiKey("openai");
    if (!apiKey) {
      return this.fallbackReport("No OpenAI API key configured. Add key in Settings.");
    }

    const userPrompt = this.buildUserPrompt(context);
    const messages = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: userPrompt },
    ];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages,
          temperature: 0.2,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return this.fallbackReport(`GPT-4o API error: ${res.status}`);
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const text = data.choices?.[0]?.message?.content || "";
      const parsed = this.parseResponse(text);
      return {
        agentId: this.id,
        role: this.role,
        timestamp: Date.now(),
        ...parsed,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      return this.fallbackReport(`Analysis failed: ${reason}`);
    }
  }

  /** Parse the LLM JSON response into a partial report. */
  protected parseResponse(text: string): {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    confidence: number;
    reasoning: string;
    data: Record<string, any>;
  } {
    try {
      const cleaned = text.replace(/```json|```/g, "").trim();
      const json = JSON.parse(cleaned);
      return {
        direction: this.normalizeDirection(json.direction),
        confidence: Math.min(100, Math.max(0, Number(json.confidence) || 50)),
        reasoning: String(json.reasoning || "No reasoning provided"),
        data: json.data || {},
      };
    } catch {
      return {
        direction: "NEUTRAL",
        confidence: 30,
        reasoning: `Could not parse LLM response. Raw: ${text.slice(0, 120)}`,
        data: {},
      };
    }
  }

  /** Normalize direction strings from the LLM. */
  protected normalizeDirection(raw: string): "LONG" | "SHORT" | "NEUTRAL" {
    const d = String(raw || "").toUpperCase().trim();
    if (d === "LONG" || d === "BUY") return "LONG";
    if (d === "SHORT" || d === "SELL") return "SHORT";
    return "NEUTRAL";
  }

  /** Generate a safe fallback report when the LLM is unavailable. */
  protected fallbackReport(reason: string): AgentReport {
    return {
      agentId: this.id,
      role: this.role,
      timestamp: Date.now(),
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: reason,
      data: { fallback: true },
    };
  }
}
