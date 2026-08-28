// ── Local AI Scanner ─────────────────────────────────────────────────
// Scans localhost for running AI inference servers (Ollama, LM Studio,
// llama.cpp, Oobabooga, Jan AI, Open WebUI) and discovers .gguf model
// files on disk. Used by the local LLM provider for zero-latency inference.
//
// Also provides llama.cpp self-hosting: when no external server is found,
// `startLlamaCppServer()` auto-builds (or locates) llama.cpp and starts
// llama-server with a given .gguf model file.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir, cpus } from "node:os";
import { spawn, type ChildProcess } from "child_process";
import { ensureLlamaCpp } from "./llama-cpp-builder";

// ── Types ──────────────────────────────────────────────────────────

export type LocalAISource =
  | "ollama"
  | "lmStudio"
  | "llamaCpp"
  | "textGenWebUI"
  | "jan"
  | "openWebUI";

export interface LocalAIScanResult {
  ollama: boolean;
  lmStudio: boolean;
  llamaCpp: boolean;
  textGenWebUI: boolean;
  jan: boolean;
  openWebUI: boolean;
}

export interface GGUFDiscovery {
  path: string;
  filename: string;
  sizeBytes: number;
  sizeGB: string;
}

export interface FullLocalScan {
  servers: LocalAIScanResult;
  ggufFiles: GGUFDiscovery[];
  availableSources: LocalAISource[];
}

// ── Port Check ─────────────────────────────────────────────────────

const PORT_MAP: Record<LocalAISource, number> = {
  ollama: 11434,
  lmStudio: 1234,
  llamaCpp: 8080,
  textGenWebUI: 7860,
  jan: 1337,
  openWebUI: 3000,
};

async function checkPort(port: number): Promise<boolean> {
  try {
    // Use a raw TCP socket to check if the port is listening
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "HEAD",
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeout);

    // Any response (even an error page) means the port is open
    return res !== null;
  } catch {
    return false;
  }
}

// ── Scan Servers ───────────────────────────────────────────────────

export async function scanLocalAI(): Promise<LocalAIScanResult> {
  const results = await Promise.all(
    Object.entries(PORT_MAP).map(async ([source, port]) => {
      const available = await checkPort(port);
      return { source: source as LocalAISource, available };
    }),
  );

  return {
    ollama: results.find((r) => r.source === "ollama")?.available ?? false,
    lmStudio:
      results.find((r) => r.source === "lmStudio")?.available ?? false,
    llamaCpp:
      results.find((r) => r.source === "llamaCpp")?.available ?? false,
    textGenWebUI:
      results.find((r) => r.source === "textGenWebUI")?.available ?? false,
    jan: results.find((r) => r.source === "jan")?.available ?? false,
    openWebUI:
      results.find((r) => r.source === "openWebUI")?.available ?? false,
  };
}

// ── GGUF File Discovery ────────────────────────────────────────────

const GGUF_SEARCH_PATHS = [
  join(homedir(), "models"),
  join(homedir(), ".cache", "lm-studio"),
  join(homedir(), ".ollama"),
  join(homedir(), "Downloads"),
  join(tmpdir(), "llama-models"),
];

function findGGUFFiles(dir: string, maxDepth: number = 3): GGUFDiscovery[] {
  const results: GGUFDiscovery[] = [];

  try {
    if (!existsSync(dir)) return results;

    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      try {
        if (entry.isDirectory() && maxDepth > 0) {
          results.push(...findGGUFFiles(fullPath, maxDepth - 1));
        } else if (
          entry.isFile() &&
          entry.name.toLowerCase().endsWith(".gguf")
        ) {
          const stats = statSync(fullPath);
          const sizeBytes = stats.size;
          const sizeGB = (sizeBytes / 1_073_741_824).toFixed(2);

          results.push({
            path: fullPath,
            filename: entry.name,
            sizeBytes,
            sizeGB,
          });
        }
      } catch {
        // Skip files/dirs we can't access
      }
    }
  } catch {
    // Directory not readable
  }

  return results;
}

export function scanGGUFFiles(): GGUFDiscovery[] {
  const allFiles: GGUFDiscovery[] = [];

  for (const searchPath of GGUF_SEARCH_PATHS) {
    const found = findGGUFFiles(searchPath);
    allFiles.push(...found);
  }

  // Sort by size descending (largest models first)
  allFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return allFiles;
}

// ── Full Scan ──────────────────────────────────────────────────────

export async function fullLocalScan(): Promise<FullLocalScan> {
  const [servers, ggufFiles] = await Promise.all([
    scanLocalAI(),
    Promise.resolve(scanGGUFFiles()),
  ]);

  const availableSources: LocalAISource[] = [];
  if (servers.ollama) availableSources.push("ollama");
  if (servers.lmStudio) availableSources.push("lmStudio");
  if (servers.llamaCpp) availableSources.push("llamaCpp");
  if (servers.textGenWebUI) availableSources.push("textGenWebUI");
  if (servers.jan) availableSources.push("jan");
  if (servers.openWebUI) availableSources.push("openWebUI");

  return { servers, ggufFiles, availableSources };
}

// ── Preferred Source ───────────────────────────────────────────────

const SOURCE_PREFERENCE: LocalAISource[] = [
  "ollama",
  "lmStudio",
  "llamaCpp",
  "textGenWebUI",
  "jan",
  "openWebUI",
];

export async function findAvailableLocalSource(): Promise<{
  source: LocalAISource;
  port: number;
} | null> {
  const servers = await scanLocalAI();

  for (const source of SOURCE_PREFERENCE) {
    if (servers[source]) {
      return { source, port: PORT_MAP[source] };
    }
  }

  return null;
}

// ── Free Port Discovery ──────────────────────────────────────────────

/**
 * Find a free TCP port on localhost by binding to port 0 and
 * immediately releasing it. Returns the ephemeral port number assigned.
 */
export async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => resolve(8081 + Math.floor(Math.random() * 1000)));
      }
    });
    server.on("error", () => {
      resolve(8081 + Math.floor(Math.random() * 1000));
    });
  });
}

// ── Wait for Server ─────────────────────────────────────────────────

/**
 * Poll a health-check URL until the server responds (or the timeout expires).
 * Returns `true` when the server is ready, `false` on timeout.
 */
export async function waitForServer(
  url: string,
  timeoutMs: number = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status === 404) {
        // 404 still means the server is up (the /health endpoint may not exist)
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── Start llama.cpp Server ──────────────────────────────────────────

/**
 * Start a llama-server instance using the auto-built (or pre-existing)
 * llama.cpp binary. Returns the port the server is listening on and the
 * subprocess handle so callers can manage its lifecycle.
 *
 * @param modelPath  Absolute path to a .gguf model file.
 * @param opts       Optional overrides for port, layers, context size, etc.
 */
export async function startLlamaCppServer(
  modelPath: string,
  opts?: {
    port?: number;
    ngl?: number; // layers to offload to GPU (default: 999 = all)
    ctxSize?: number;
    host?: string;
    threads?: number;
  },
): Promise<{ port: number; process: ChildProcess }> {
  // 1. Ensure we have a llama-server binary
  const binary = await ensureLlamaCpp();

  // 2. Pick a free port
  const port = opts?.port ?? (await findFreePort());
  const host = opts?.host ?? "127.0.0.1";
  const ngl = opts?.ngl ?? 999; // offload all layers to GPU if available
  const threads = opts?.threads ?? Math.max(1, (cpus().length || 4) - 1);

  // 3. Build args
  const args: string[] = [
    "-m", modelPath,
    "--port", String(port),
    "--host", host,
    "-ngl", String(ngl),
    "-t", String(threads),
  ];

  if (opts?.ctxSize) {
    args.push("-c", String(opts.ctxSize));
  }

  console.log(
    `[LlamaCpp] Starting server: ${binary} -m ${modelPath} --port ${port}`,
  );

  // 4. Spawn llama-server
  const proc = spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.on("exit", (exitCode) => {
    if (exitCode !== null && exitCode !== 0) {
      console.error(`[LlamaCpp] Server exited with code ${exitCode}`);
    }
  });
  proc.on("error", (error) => {
    console.error(`[LlamaCpp] Server exited with error:`, error);
  });

  // 5. Wait for the server to be ready
  const healthUrl = `http://${host}:${port}/health`;
  console.log(`[LlamaCpp] Waiting for server at ${healthUrl}...`);
  const ready = await waitForServer(healthUrl, 30_000);

  if (!ready) {
    // Kill the process if it didn't come up in time
    proc.kill();
    throw new Error(
      `[LlamaCpp] Server failed to start within 30s. Check stderr for details.`,
    );
  }

  console.log(`[LlamaCpp] Server ready on port ${port} (pid ${proc.pid})`);
  return { port, process: proc };
}

// ── Stop llama.cpp Server ───────────────────────────────────────────

/**
 * Gracefully stop a llama-server subprocess.
 */
export function stopLlamaCppServer(proc: ChildProcess): void {
  try {
    proc.kill("SIGTERM");
    // Force kill after 5s if still alive
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 5_000);
  } catch {
    // Already dead
  }
}
