// ── Multi-Provider LLM System ───────────────────────────────────────
// Queries OpenAI, DeepSeek, Grok, and Gemini simultaneously.
// Returns fastest valid response. Falls back through providers on failure.
// All 29 agents + chat + orchestrator use this unified pipeline.

// ── Types ──────────────────────────────────────────────────────────

export type LLMProvider = "openai" | "deepseek" | "grok" | "gemini";

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  latencyMs: number;
}

export interface MultiProviderResult {
  response: LLMResponse | null;
  allResults: (LLMResponse | null)[];
  consensus: string | null; // most common response pattern
  providerStatuses: ProviderStatus[];
}

export interface ProviderStatus {
  provider: LLMProvider;
  connected: boolean;
  latencyMs: number | null;
  error?: string;
}

// ── Provider Configs ────────────────────────────────────────────────

interface ProviderConfig {
  url: string;
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (messages: LLMMessage[], options: LLMQueryOptions) => unknown;
  parseResponse: (data: any) => string;
}

const PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
    body: (messages, options) => ({
      model: "gpt-4o",
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 300,
    }),
    parseResponse: (data) =>
      data.choices?.[0]?.message?.content ?? "",
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
    body: (messages, options) => ({
      model: "deepseek-chat",
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 300,
    }),
    parseResponse: (data) =>
      data.choices?.[0]?.message?.content ?? "",
  },
  grok: {
    url: "https://api.x.ai/v1/chat/completions",
    model: "grok-2",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
    body: (messages, options) => ({
      model: "grok-2",
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 300,
    }),
    parseResponse: (data) =>
      data.choices?.[0]?.message?.content ?? "",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
    model: "gemini-pro",
    headers: (key) => ({
      "Content-Type": "application/json",
    }),
    body: (messages, options) => {
      // Convert OpenAI-style messages to Gemini format
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      // Merge system message into first user message if present
      const systemMsg = messages.find((m) => m.role === "system");
      if (systemMsg && contents.length > 0) {
        const firstUserIdx = contents.findIndex((c) => c.role === "user");
        if (firstUserIdx >= 0) {
          contents[firstUserIdx].parts.unshift({
            text: `[System instructions: ${systemMsg.content}]\n\n`,
          });
        }
      }
      return {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: options.maxTokens ?? 300,
        },
      };
    },
    parseResponse: (data) => {
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    },
  },
};

// ── API Key Access ──────────────────────────────────────────────────

function getProviderApiKey(provider: LLMProvider): string | null {
  const envMap: Record<LLMProvider, string> = {
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    grok: "GROK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const envVar = envMap[provider];
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  return null;
}

// ── Query Options ──────────────────────────────────────────────────

export interface LLMQueryOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

// ── Single Provider Query ──────────────────────────────────────────

async function queryProvider(
  provider: LLMProvider,
  messages: LLMMessage[],
  options: LLMQueryOptions,
): Promise<LLMResponse | null> {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) return null;

  const config = PROVIDER_CONFIGS[provider];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const url = provider === "gemini"
      ? `${config.url}?key=${encodeURIComponent(apiKey)}`
      : config.url;

    const res = await fetch(url, {
      method: "POST",
      headers: config.headers(apiKey),
      body: JSON.stringify(config.body(messages, options)),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(
        `[MultiProvider] ${provider} returned ${res.status}: ${errBody.slice(0, 200)}`,
      );
      return null;
    }

    const data = await res.json();
    const content = config.parseResponse(data);
    const latencyMs = Date.now() - startTime;

    if (!content) return null;

    return {
      content,
      provider,
      model: config.model,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : "Unknown";
    if (errMsg.includes("abort") || errMsg.includes("AbortError") || errMsg.includes("timeout")) {
      console.warn(`[MultiProvider] ${provider} timed out after ${latencyMs}ms`);
    } else {
      console.warn(
        `[MultiProvider] ${provider} error: ${errMsg}`,
      );
    }
    return null;
  }
}

// ── Main Query Functions ───────────────────────────────────────────

/**
 * Query ALL 4 LLM providers simultaneously. Returns the FASTEST valid
 * response. Falls back to the next fastest if the first has issues.
 */
export async function queryAllProviders(
  messages: LLMMessage[],
  options: LLMQueryOptions = {},
): Promise<MultiProviderResult> {
  const providers: LLMProvider[] = ["openai", "deepseek", "grok", "gemini"];

  // Fire all providers simultaneously
  const promises = providers.map((p) =>
    queryProvider(p, messages, options).catch(() => null),
  );

  // Race: take the first non-null response
  const results: (LLMResponse | null)[] = [];
  const statuses: ProviderStatus[] = [];

  // Use Promise.race for fastest-first, but also collect all results
  let firstResponse: LLMResponse | null = null;
  let firstResolved = false;

  // Wrap each promise to capture the result as it resolves
  const wrappedPromises = promises.map(async (promise, i) => {
    const result = await promise;
    results[i] = result;
    statuses.push({
      provider: providers[i],
      connected: result !== null,
      latencyMs: result?.latencyMs ?? null,
      error: result ? undefined : "No response or key missing",
    });

    if (!firstResolved && result !== null) {
      firstResolved = true;
      firstResponse = result;
    }
    return result;
  });

  // Wait for all to settle (don't short-circuit — collect all statuses)
  await Promise.allSettled(wrappedPromises);

  // Fill in any statuses for providers that weren't captured
  for (const p of providers) {
    if (!statuses.some((s) => s.provider === p)) {
      statuses.push({
        provider: p,
        connected: false,
        latencyMs: null,
        error: "No API key configured",
      });
    }
  }

  // Compute consensus: count how many providers gave similar direction
  let consensus: string | null = null;
  const nonNull = results.filter((r): r is LLMResponse => r !== null);
  if (nonNull.length >= 2) {
    // Simple consensus: count occurrences of first 20 chars
    const truncated = nonNull.map((r) => r.content.slice(0, 80).trim());
    const counts = new Map<string, number>();
    for (const t of truncated) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    let maxCount = 0;
    for (const [text, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        consensus = text;
      }
    }
    if (maxCount <= 1) consensus = null; // No real consensus
  }

  return {
    response: firstResponse,
    allResults: results,
    consensus,
    providerStatuses: statuses,
  };
}

/**
 * Convenience: query with a simple prompt string.
 * Uses minimal system message.
 */
export async function queryWithPrompt(
  systemPrompt: string,
  userPrompt: string,
  options?: LLMQueryOptions,
): Promise<MultiProviderResult> {
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  return queryAllProviders(messages, options);
}

/**
 * Simple single-response convenience. Returns the content string or null.
 */
export async function queryFirstResponse(
  messages: LLMMessage[],
  options?: LLMQueryOptions,
): Promise<string | null> {
  const result = await queryAllProviders(messages, options);
  return result.response?.content ?? null;
}

/**
 * Check which providers are available (have API keys configured).
 * Synchronous check — no network call.
 */
export function getAvailableProviders(): LLMProvider[] {
  const available: LLMProvider[] = [];
  for (const provider of ["openai", "deepseek", "grok", "gemini"] as LLMProvider[]) {
    if (getProviderApiKey(provider)) {
      available.push(provider);
    }
  }
  return available;
}

/**
 * Test connectivity to all configured providers.
 * Returns status for each provider.
 */
export async function checkAllProviderStatus(): Promise<ProviderStatus[]> {
  const testMessages: LLMMessage[] = [
    { role: "user", content: "Ping. Reply with just 'OK'." },
  ];

  const result = await queryAllProviders(testMessages, {
    maxTokens: 5,
    timeoutMs: 8_000,
  });
  return result.providerStatuses;
}
