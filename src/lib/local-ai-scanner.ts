// ── Local AI Scanner ─────────────────────────────────────────────────
// Scans localhost for running AI inference servers (Ollama, LM Studio,
// llama.cpp, Oobabooga, Jan AI, Open WebUI) and discovers .gguf model
// files on disk. Used by the local LLM provider for zero-latency inference.

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import os from "os";

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
  join(os.homedir(), "models"),
  join(os.homedir(), ".cache", "lm-studio"),
  join(os.homedir(), ".ollama"),
  join(os.homedir(), "Downloads"),
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
