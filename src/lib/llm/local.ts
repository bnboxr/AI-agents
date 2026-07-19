// ── Ollama Local LLM Support ───────────────────────────────────────
// Auto-detects Ollama, lists models, and routes chat requests locally.

const OLLAMA_BASE = "http://localhost:11434";

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaStatus {
  running: boolean;
  models: OllamaModel[];
  error?: string;
}

/**
 * Check if Ollama is running and list available models.
 */
export async function detectOllama(): Promise<OllamaStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { running: false, models: [], error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as { models: OllamaModel[] };
    return {
      running: true,
      models: data.models ?? [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { running: false, models: [], error: msg };
  }
}

/**
 * List available models from a running Ollama instance.
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  const status = await detectOllama();
  return status.models;
}

/**
 * Find a compatible model from Ollama that can serve as a GPT-4o fallback.
 * Priority order: llama3.1, llama3, mistral, phi3, gemma2, qwen2
 */
export function findCompatibleModel(models: OllamaModel[]): string | null {
  const preferred = [
    "llama3.1",
    "llama3.2",
    "llama3",
    "mistral",
    "phi3",
    "gemma2",
    "qwen2",
    "command-r",
    "mixtral",
  ];

  const modelNames = models.map((m) => m.name.toLowerCase());

  for (const pref of preferred) {
    const match = modelNames.find(
      (n) => n === pref || n.startsWith(`${pref}:`) || n.startsWith(`${pref}-`),
    );
    if (match) return models[modelNames.indexOf(match)].name;
  }

  // Fallback: return the first model if any exist
  if (models.length > 0) return models[0].name;
  return null;
}

/**
 * Check if a specific Ollama model name is available locally.
 */
export function hasCompatibleModel(models: OllamaModel[]): boolean {
  return findCompatibleModel(models) !== null;
}

// ── Chat / Completion ──────────────────────────────────────────────

export interface OllamaMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface OllamaChatResponse {
  content: string;
  model: string;
  done: boolean;
}

/**
 * Send a chat request to Ollama.
 */
export async function ollamaChat(
  options: OllamaChatOptions,
): Promise<OllamaChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.3,
          num_predict: options.max_tokens ?? 50,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data = (await res.json()) as {
      message: { content: string };
      model: string;
      done: boolean;
    };

    return {
      content: data.message?.content ?? "",
      model: data.model,
      done: data.done,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * One-shot tool detection via Ollama — determines which tool to call
 * based on user message. Replicates the GPT-4o tool detection pattern.
 */
export async function ollamaDetectTool(
  model: string,
  systemPrompt: string,
  userMessage: string,
  toolNames: string[],
): Promise<string | null> {
  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const response = await ollamaChat({
    model,
    messages,
    temperature: 0.3,
    max_tokens: 50,
  });

  const raw = response.content.trim();

  // Try exact match first
  for (const name of toolNames) {
    if (raw.includes(name)) return name;
  }
  const matched = toolNames.find((n) => raw === n || raw.startsWith(n));
  if (matched) return matched;

  return null;
}
