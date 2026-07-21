// ── AI Assistant Server Functions ───────────────────────────────────
// Handles chat for the Floating AI Assistant.
// Uses the multi-provider LLM pipeline (OpenAI, DeepSeek, Grok, Gemini).

import { createServerFn } from "@tanstack/react-start";
import { queryAllProviders, type LLMMessage, type MultiProviderResult } from "~/lib/llm/multi-provider";

// ── Types ──────────────────────────────────────────────────────────

export interface AssistantRequest {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  pageContext: {
    route: string;
    title: string;
    visibleText: string;
  };
}

export interface AssistantResponse {
  content: string;
  provider: string;
  model: string;
  latencyMs: number;
}

// ── System Prompt Builder ──────────────────────────────────────────

function buildSystemPrompt(pageContext: AssistantRequest["pageContext"]): string {
  return `Ești asistentul HSMC, o platformă fintech DeFi — un AI Hedge Fund OS cu 29 de agenți autonomi.
Vorbești în română, ești prietenos, concis și de ajutor. Răspunzi scurt și la obiect (1-3 propoziții când e posibil).

Contextul curent al utilizatorului:
- Pagina: ${pageContext.route} (${pageContext.title})
- Conținut vizibil pe pagină: ${pageContext.visibleText || "N/A"}

Poți să ajuți cu:
- Navigarea platformei (pagini, funcționalități)
- Informații despre trading, DeFi, crypto
- Întrebări despre HSMC și cele 29 de AI agents
- Sfaturi despre yield farming, staking, airdrops
- Explicarea conceptelor crypto în termeni simpli

Limitează-te la întrebări legate de platforma HSMC, crypto, DeFi și trading.
Dacă întrebarea e complet în afara subiectului, spune politicos că poți ajuta doar cu subiecte HSMC/crypto.`;
}

// ── Server Function ────────────────────────────────────────────────

export const askAssistant = createServerFn(
  "POST",
  async (request: AssistantRequest): Promise<AssistantResponse> => {
    const systemPrompt = buildSystemPrompt(request.pageContext);

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      ...request.history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user", content: request.message },
    ];

    try {
      const result: MultiProviderResult = await queryAllProviders(messages, {
        temperature: 0.5,
        maxTokens: 500,
        timeoutMs: 12_000,
      });

      if (result.response) {
        return {
          content: result.response.content,
          provider: result.response.provider,
          model: result.response.model,
          latencyMs: result.response.latencyMs,
        };
      }

      // Fallback: no provider responded
      return {
        content:
          "Îmi pare rău, niciun provider LLM nu este disponibil momentan. Verifică configurația API keys (OPENAI_API_KEY, DEEPSEEK_API_KEY, GROK_API_KEY, GEMINI_API_KEY).",
        provider: "none",
        model: "none",
        latencyMs: 0,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[AI Assistant] Error:", errMsg);
      return {
        content:
          "A apărut o eroare la procesarea mesajului tău. Încearcă din nou.",
        provider: "error",
        model: "error",
        latencyMs: 0,
      };
    }
  },
);
