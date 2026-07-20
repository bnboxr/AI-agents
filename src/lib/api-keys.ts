import { createServerFn } from "@tanstack/react-start";

// ── Types ──────────────────────────────────────────────────────────

export type ServiceName =
  | "openai"
  | "anthropic"
  | "telegram"
  | "discord"
  | "1inch"
  | "coingecko";

export type LLMProvider = "openai" | "anthropic" | "ollama";

export interface ServiceKey {
  service: ServiceName;
  configured: boolean;
  enabled: boolean;
  maskedKey: string | null;
}

export interface RpcEntry {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
}

// ── In-memory key store ────────────────────────────────────────────

const apiKeys = new Map<ServiceName, string>();
const enabledServices = new Map<ServiceName, boolean>();

// ── LLM provider preference ────────────────────────────────────────

let llmProvider: LLMProvider = "openai";

// Initialize all services as disabled + unconfigured
const ALL_SERVICES: ServiceName[] = [
  "openai",
  "anthropic",
  "telegram",
  "discord",
  "1inch",
  "coingecko",
];

for (const svc of ALL_SERVICES) {
  enabledServices.set(svc, false);
}

// ── In-memory RPC store ────────────────────────────────────────────

const rpcStore: RpcEntry[] = [];
let _rpcIdCounter = 0;

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  const prefix = key.slice(0, Math.min(3, key.length - 4));
  return `${prefix}...****${key.slice(-4)}`;
}

// ── Service endpoint configs for testing ───────────────────────────

const SERVICE_CONFIG: Record<
  ServiceName,
  { url: string; headerName: string; headerPrefix: string }
> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    headerName: "Authorization",
    headerPrefix: "Bearer ",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headerName: "x-api-key",
    headerPrefix: "",
  },
  telegram: {
    url: "", // filled dynamically with bot token
    headerName: "",
    headerPrefix: "",
  },
  discord: {
    url: "https://discord.com/api/v10/users/@me",
    headerName: "Authorization",
    headerPrefix: "Bot ",
  },
  "1inch": {
    url: "https://api.1inch.dev/swap/v6.0/1/approve/allowance",
    headerName: "Authorization",
    headerPrefix: "Bearer ",
  },
  coingecko: {
    url: "https://api.coingecko.com/api/v3/ping",
    headerName: "x-cg-demo-api-key",
    headerPrefix: "",
  },
};

// ── Server Functions ───────────────────────────────────────────────

export const getSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ keys: ServiceKey[]; rpcs: RpcEntry[] }> => {
    const keys: ServiceKey[] = ALL_SERVICES.map((service) => {
      const key = apiKeys.get(service);
      return {
        service,
        configured: !!key,
        enabled: enabledServices.get(service) ?? false,
        maskedKey: key ? maskKey(key) : null,
      };
    });

    return { keys, rpcs: [...rpcStore] };
  },
);

export const saveApiKey = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { service: ServiceName; key: string };
  }): Promise<ServiceKey> => {
    const { service, key } = data;

    // Store the key
    apiKeys.set(service, key);

    // Auto-enable when key is saved
    enabledServices.set(service, true);

    return {
      service,
      configured: true,
      enabled: true,
      maskedKey: maskKey(key),
    };
  },
);

export const toggleService = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { service: ServiceName; enabled: boolean };
  }): Promise<ServiceKey> => {
    const { service, enabled } = data;
    enabledServices.set(service, enabled);

    const key = apiKeys.get(service);
    return {
      service,
      configured: !!key,
      enabled,
      maskedKey: key ? maskKey(key) : null,
    };
  },
);

// ── LLM Provider preference ────────────────────────────────────────

export const getLLMProvider = createServerFn({ method: "GET" }).handler(
  async (): Promise<LLMProvider> => {
    return llmProvider;
  },
);

export const setLLMProvider = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { provider: LLMProvider };
  }): Promise<LLMProvider> => {
    llmProvider = data.provider;
    return llmProvider;
  },
);

export { llmProvider as _llmProvider };

export const testApiKey = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { service: ServiceName };
  }): Promise<{ ok: boolean; message: string }> => {
    const { service } = data;
    const key = apiKeys.get(service);

    if (!key) {
      return {
        ok: false,
        message: "No API key configured. Save a key first.",
      };
    }

    const config = SERVICE_CONFIG[service];

    // Telegram uses a special URL
    let url = config.url;
    if (service === "telegram") {
      url = `https://api.telegram.org/bot${key}/getMe`;
    }

    const headers: Record<string, string> = {};
    if (config.headerName) {
      headers[config.headerName] = `${config.headerPrefix}${key}`;
    }

    // For Telegram, no auth header needed — token is in the URL
    if (service === "telegram" && headers[config.headerName]) {
      delete headers[config.headerName];
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        return {
          ok: true,
          message: `✓ Connection successful — ${service} API responded with ${res.status}`,
        };
      }

      // Try to parse error body
      let detail = "";
      try {
        const body = await res.text();
        detail = body.slice(0, 200);
      } catch (err) {
        console.warn("[ApiKeys] verifyConnection body parse failed:", err);
        // ignore parse failure
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message: `Invalid API key (${res.status}). Double-check your key and permissions.`,
        };
      }

      return {
        ok: false,
        message: `API returned ${res.status}${detail ? `: ${detail}` : ""}`,
      };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Unknown network error";
      return {
        ok: false,
        message: `Connection failed: ${msg}`,
      };
    }
  },
);

// ── Raw key access (for internal service use) ──────────────────────

export function getApiKey(service: ServiceName): string | null {
  const stored = apiKeys.get(service);
  if (stored) return stored;
  // Fallback: read from environment variable
  const envMap: Record<string, string> = {
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
  };
  return envMap[service] || null;
}

// ── RPC management ─────────────────────────────────────────────────

export const addRpcEndpoint = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { label: string; url: string };
  }): Promise<RpcEntry> => {
    const entry: RpcEntry = {
      id: `rpc_${Date.now().toString(36)}_${(_rpcIdCounter++).toString(36)}`,
      label: data.label,
      url: data.url,
      enabled: true,
    };
    rpcStore.push(entry);
    return entry;
  },
);

export const toggleRpcEndpoint = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { id: string; enabled: boolean };
  }): Promise<RpcEntry | null> => {
    const entry = rpcStore.find((r) => r.id === data.id);
    if (entry) {
      entry.enabled = data.enabled;
      return { ...entry };
    }
    return null;
  },
);

export const deleteRpcEndpoint = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { id: string };
  }): Promise<boolean> => {
    const idx = rpcStore.findIndex((r) => r.id === data.id);
    if (idx !== -1) {
      rpcStore.splice(idx, 1);
      return true;
    }
    return false;
  },
);
