// ── Model Selector ───────────────────────────────────────────────────
// Profiles local hardware and recommends the best GGUF model to run.
// Balances model capability against available RAM and CPU cores.
// Also provides structured recommendations per inference server.
//
// Now includes auto-download capability: `downloadModel()` fetches a GGUF
// from Hugging Face via direct URL or huggingface-cli, with progress reporting.

import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir, totalmem, freemem, cpus, platform, arch } from "node:os";
import { $ } from "bun";

// ── Types ──────────────────────────────────────────────────────────

export interface HardwareProfile {
  ram: number; // total system RAM in bytes
  free_ram: number; // available RAM in bytes
  cpus: number; // logical CPU cores
  platform: string;
  arch: string;
  ramGB: number; // convenience: total RAM in GB
  freeRamGB: number; // convenience: free RAM in GB
}

export type HardwareTier = "low" | "medium" | "high" | "extreme";

export interface ModelRecommendation {
  modelName: string;
  sizeGB: number;
  quantization: string;
  vramRequired: number;
  ramRequired: number;
  contextWindow: number;
  useCase: string;
  provider: string; // "ollama", "lmstudio", "llama.cpp", etc.
  ollamaTag?: string;
  huggingFaceId?: string;
}

export interface ModelRecommendationResult {
  hardware: HardwareProfile;
  tier: HardwareTier;
  primary: ModelRecommendation;
  alternatives: ModelRecommendation[];
  note: string;
}

// ── Hardware Profiling ─────────────────────────────────────────────

export function getHardwareProfile(): HardwareProfile {
  const ram = totalmem();
  const free_ram = freemem();

  return {
    ram,
    free_ram,
    cpus: cpus().length,
    platform: platform(),
    arch: arch(),
    ramGB: +(ram / 1_073_741_824).toFixed(1),
    freeRamGB: +(free_ram / 1_073_741_824).toFixed(1),
  };
}

// ── Tier Detection ─────────────────────────────────────────────────

export function detectHardwareTier(
  profile?: HardwareProfile,
): HardwareTier {
  const { ram } = profile ?? getHardwareProfile();
  const ramGB = ram / 1_073_741_824;

  if (ramGB < 8) return "low";
  if (ramGB < 16) return "medium";
  if (ramGB < 32) return "high";
  return "extreme";
}

// ── Recommendation Engine ──────────────────────────────────────────

const MODEL_CATALOG: Record<
  HardwareTier,
  { primary: ModelRecommendation; alternatives: ModelRecommendation[]; note: string }
> = {
  low: {
    primary: {
      modelName: "TinyLlama 1.1B",
      sizeGB: 0.7,
      quantization: "Q4_K_M",
      vramRequired: 1,
      ramRequired: 4,
      contextWindow: 2048,
      useCase: "Lightweight chat, basic code completion, resource-constrained",
      provider: "ollama",
      ollamaTag: "tinyllama:1.1b-chat-v1.0-q4_K_M",
      huggingFaceId: "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
    },
    alternatives: [
      {
        modelName: "Phi-2 2.7B",
        sizeGB: 1.6,
        quantization: "Q4_K_M",
        vramRequired: 2,
        ramRequired: 6,
        contextWindow: 2048,
        useCase: "Reasoning, code generation, better than TinyLlama",
        provider: "ollama",
        ollamaTag: "phi:2.7b-chat-v2-q4_K_M",
        huggingFaceId: "TheBloke/phi-2-GGUF",
      },
      {
        modelName: "StableLM Zephyr 3B",
        sizeGB: 1.9,
        quantization: "Q4_K_M",
        vramRequired: 2,
        ramRequired: 6,
        contextWindow: 4096,
        useCase: "Chat, instruction following",
        provider: "ollama",
        ollamaTag: "stablelm-zephyr:3b-q4_K_M",
        huggingFaceId: "TheBloke/stablelm-zephyr-3b-GGUF",
      },
    ],
    note: "Limited to quantized sub-3B models. Expect slower inference on CPU.",
  },
  medium: {
    primary: {
      modelName: "CodeLlama 7B",
      sizeGB: 4.2,
      quantization: "Q4_K_M",
      vramRequired: 6,
      ramRequired: 10,
      contextWindow: 16384,
      useCase: "Code generation, analysis, trading agent reasoning",
      provider: "ollama",
      ollamaTag: "codellama:7b-instruct-q4_K_M",
      huggingFaceId: "TheBloke/CodeLlama-7B-Instruct-GGUF",
    },
    alternatives: [
      {
        modelName: "DeepSeek Coder 1.3B",
        sizeGB: 0.8,
        quantization: "Q4_K_M",
        vramRequired: 1,
        ramRequired: 4,
        contextWindow: 16384,
        useCase: "Fast code completion, trading logic",
        provider: "ollama",
        ollamaTag: "deepseek-coder:1.3b-instruct-q4_K_M",
        huggingFaceId: "TheBloke/deepseek-coder-1.3b-instruct-GGUF",
      },
      {
        modelName: "DeepSeek Coder 6.7B",
        sizeGB: 4.0,
        quantization: "Q4_K_M",
        vramRequired: 6,
        ramRequired: 10,
        contextWindow: 16384,
        useCase: "Advanced code generation, multi-file reasoning",
        provider: "ollama",
        ollamaTag: "deepseek-coder:6.7b-instruct-q4_K_M",
        huggingFaceId: "TheBloke/deepseek-coder-6.7b-instruct-GGUF",
      },
      {
        modelName: "Mistral 7B",
        sizeGB: 4.2,
        quantization: "Q4_K_M",
        vramRequired: 6,
        ramRequired: 10,
        contextWindow: 8192,
        useCase: "General reasoning, trading strategy analysis",
        provider: "ollama",
        ollamaTag: "mistral:7b-instruct-v0.2-q4_K_M",
        huggingFaceId: "TheBloke/Mistral-7B-Instruct-v0.2-GGUF",
      },
    ],
    note: "7B models at Q4 quantization. CodeLlama recommended for trading agent work.",
  },
  high: {
    primary: {
      modelName: "DeepSeek Coder 33B",
      sizeGB: 19.9,
      quantization: "Q4_K_M",
      vramRequired: 24,
      ramRequired: 28,
      contextWindow: 16384,
      useCase: "Production-grade code generation, complex trading strategies",
      provider: "ollama",
      ollamaTag: "deepseek-coder:33b-instruct-q4_K_M",
      huggingFaceId: "TheBloke/deepseek-coder-33B-instruct-GGUF",
    },
    alternatives: [
      {
        modelName: "CodeLlama 13B",
        sizeGB: 7.9,
        quantization: "Q4_K_M",
        vramRequired: 10,
        ramRequired: 16,
        contextWindow: 16384,
        useCase: "Strong code generation, good balance",
        provider: "ollama",
        ollamaTag: "codellama:13b-instruct-q4_K_M",
        huggingFaceId: "TheBloke/CodeLlama-13B-Instruct-GGUF",
      },
      {
        modelName: "Mixtral 8x7B",
        sizeGB: 26.4,
        quantization: "Q3_K_M",
        vramRequired: 24,
        ramRequired: 30,
        contextWindow: 32768,
        useCase: "Mixture of experts, excellent reasoning",
        provider: "ollama",
        ollamaTag: "mixtral:8x7b-instruct-v0.1-q3_K_M",
        huggingFaceId: "TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF",
      },
    ],
    note: "Can comfortably run 13B-33B models. DeepSeek Coder 33B is ideal for trading systems.",
  },
  extreme: {
    primary: {
      modelName: "DeepSeek Coder 33B",
      sizeGB: 19.9,
      quantization: "Q5_K_M",
      vramRequired: 24,
      ramRequired: 28,
      contextWindow: 16384,
      useCase: "Maximum code quality, complex multi-agent orchestration",
      provider: "ollama",
      ollamaTag: "deepseek-coder:33b-instruct-q5_K_M",
      huggingFaceId: "TheBloke/deepseek-coder-33B-instruct-GGUF",
    },
    alternatives: [
      {
        modelName: "Mixtral 8x7B",
        sizeGB: 46.7,
        quantization: "Q4_K_M",
        vramRequired: 48,
        ramRequired: 50,
        contextWindow: 32768,
        useCase: "Best-in-class reasoning for strategy development",
        provider: "ollama",
        ollamaTag: "mixtral:8x7b-instruct-v0.1-q4_K_M",
        huggingFaceId: "TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF",
      },
      {
        modelName: "CodeLlama 34B",
        sizeGB: 20.5,
        quantization: "Q4_K_M",
        vramRequired: 24,
        ramRequired: 30,
        contextWindow: 16384,
        useCase: "High-quality code generation, near GPT-4 level",
        provider: "ollama",
        ollamaTag: "codellama:34b-instruct-q4_K_M",
        huggingFaceId: "TheBloke/CodeLlama-34B-Instruct-GGUF",
      },
    ],
    note: "Maximum capability. Run multiple models simultaneously if desired.",
  },
};

export function recommendModel(
  profile?: HardwareProfile,
): ModelRecommendationResult {
  const hw = profile ?? getHardwareProfile();
  const tier = detectHardwareTier(hw);
  const catalog = MODEL_CATALOG[tier];

  return {
    hardware: hw,
    tier,
    primary: catalog.primary,
    alternatives: catalog.alternatives,
    note: catalog.note,
  };
}

// ── Ollama Pull Command Helpers ─────────────────────────────────────

export function getOllamaPullCommand(
  model: ModelRecommendation,
): string {
  if (model.ollamaTag) {
    return `ollama pull ${model.ollamaTag}`;
  }
  return `# Manual download from ${model.huggingFaceId}`;
}

// ── Summary Printer ────────────────────────────────────────────────

export function printHardwareSummary(): string {
  const hw = getHardwareProfile();
  const rec = recommendModel(hw);

  return [
    `[HSMC] Hardware Profile:`,
    `  Platform:  ${hw.platform} (${hw.arch})`,
    `  RAM:       ${hw.ramGB} GB total / ${hw.freeRamGB} GB free`,
    `  CPUs:      ${hw.cpus}`,
    `  Tier:      ${rec.tier.toUpperCase()}`,
    `  Recommended: ${rec.primary.modelName} (${rec.primary.sizeGB} GB, ${rec.primary.quantization})`,
    `  Ollama:    ${getOllamaPullCommand(rec.primary)}`,
  ].join("\n");
}

// ── Hugging Face URL Builder ─────────────────────────────────────────

const HF_BASE = "https://huggingface.co";

/**
 * Build a direct download URL for a GGUF file on Hugging Face.
 *
 * Accepts several input formats:
 *   - "TheBloke/CodeLlama-7B-Instruct-GGUF" (repo only — picks first file)
 *   - "TheBloke/CodeLlama-7B-Instruct-GGUF/codellama-7b-instruct.Q4_K_M.gguf"
 *   - A raw Hugging Face URL (passed through as-is)
 *   - An Ollama tag like "codellama:7b-instruct-q4_K_M" (converted to HF ID)
 */
export function getHuggingFaceUrl(modelName: string): {
  url: string;
  repo: string;
  filename: string;
} {
  // Already a full URL — pass through
  if (modelName.startsWith("http://") || modelName.startsWith("https://")) {
    const parts = modelName.split("/");
    return {
      url: modelName,
      repo: "",
      filename: parts[parts.length - 1] ?? "model.gguf",
    };
  }

  // Ollama-style tag ("codellama:7b-instruct-q4_K_M")
  if (modelName.includes(":") && !modelName.includes("/")) {
    const [name, tag] = modelName.split(":");
    const fileName = `${name}-${tag}.gguf`;
    const repo = `TheBloke/${name}-GGUF`;
    return {
      url: `${HF_BASE}/${repo}/resolve/main/${fileName}`,
      repo,
      filename: fileName,
    };
  }

  // Repo/filepath ("TheBloke/CodeLlama-7B-Instruct-GGUF/filename.gguf")
  if (modelName.split("/").length >= 3) {
    const parts = modelName.split("/");
    const repo = `${parts[0]}/${parts[1]}`;
    const filepath = parts.slice(2).join("/");
    return {
      url: `${HF_BASE}/${repo}/resolve/main/${filepath}`,
      repo,
      filename: basename(filepath),
    };
  }

  // Repo-only ("TheBloke/CodeLlama-7B-Instruct-GGUF") — no specific file
  return {
    url: "",
    repo: modelName,
    filename: "",
  };
}

// ── Model Download ──────────────────────────────────────────────────

/**
 * Download a file with progress reporting via the `onProgress` callback.
 *
 * Uses Bun's native fetch and writes to `dest` as a stream. If the
 * destination already exists and the sizes match, it skips the download.
 *
 * @param url         Direct download URL
 * @param dest        Absolute filesystem path for the downloaded file
 * @param onProgress  Called with percentage (0-100) during download
 */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });

  // Check if already downloaded
  if (existsSync(dest)) {
    const res = await fetch(url, { method: "HEAD" });
    if (res.ok) {
      const remoteSize = parseInt(res.headers.get("content-length") ?? "0", 10);
      const localSize = Bun.file(dest).size;
      if (remoteSize > 0 && localSize === remoteSize) {
        console.log(`[ModelSelector] Already downloaded: ${dest}`);
        onProgress?.(100);
        return;
      }
    }
  }

  console.log(`[ModelSelector] Downloading ${url} → ${dest}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[ModelSelector] Download failed: HTTP ${response.status} for ${url}`,
    );
  }

  const contentLength = parseInt(
    response.headers.get("content-length") ?? "0",
    10,
  );
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("[ModelSelector] No response body");
  }

  const writer = createWriteStream(dest);
  let downloaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writer.write(Buffer.from(value));
      downloaded += value.length;

      if (contentLength > 0 && onProgress) {
        onProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
      }
    }
  } finally {
    writer.end();
    reader.releaseLock();
  }

  onProgress?.(100);
  console.log(`[ModelSelector] Download complete: ${dest}`);
}

/**
 * Download a model from Hugging Face by name/reference.
 *
 * This is the primary user-facing entry point. It resolves the model name
 * to a direct download URL, then streams the GGUF file to the local models
 * directory. If `huggingface-cli` is available it prefers that (it handles
 * auth tokens automatically); otherwise it falls back to a direct fetch.
 *
 * @param modelName  A Hugging Face repo ID (e.g. "TheBloke/CodeLlama-7B-Instruct-GGUF"),
 *                    a repo+file path, or an Ollama-style tag.
 * @param onProgress Optional progress callback (0-100).
 * @returns          The absolute path to the downloaded .gguf file.
 */
export async function downloadModel(
  modelName: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const { url, repo, filename } = getHuggingFaceUrl(modelName);
  const modelsDir = join(homedir(), "models");
  mkdirSync(modelsDir, { recursive: true });
  const dest = join(modelsDir, filename || basename(modelName) || "model.gguf");

  // Prefer huggingface-cli if available (handles auth, resuming, etc.)
  const hfCliCheck = await $`which huggingface-cli`.quiet().nothrow();
  if (hfCliCheck.exitCode === 0 && repo && filename) {
    console.log(`[ModelSelector] Using huggingface-cli for ${repo}/${filename}`);
    const result =
      await $`huggingface-cli download ${repo} ${filename} --local-dir ${modelsDir} --local-dir-use-symlinks False`
        .quiet()
        .nothrow();

    if (result.exitCode === 0) {
      onProgress?.(100);
      // Find the downloaded file
      const expectedPath = join(modelsDir, filename);
      if (existsSync(expectedPath)) return expectedPath;

      // The CLI may have placed it in a subdirectory
      for (const entry of readdirSync(modelsDir)) {
        const entryPath = join(modelsDir, entry);
        if (entry.toLowerCase().endsWith(".gguf")) {
          return entryPath;
        }
      }
    }
    // Fall through to direct download on failure
  }

  // Direct download via fetch
  if (!url) {
    throw new Error(
      `[ModelSelector] Cannot download "${modelName}" — provide a full Hugging Face repo+file path or URL.\n` +
        `Example: "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"`,
    );
  }

  await downloadFile(url, dest, onProgress);
  return dest;
}

/**
 * Returns the default path where models are stored.
 */
export function getDefaultModelPath(): string {
  const dir = join(homedir(), "models");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get a recommended model reference string suitable for `downloadModel()`.
 * Uses the hardware tier's primary recommendation.
 */
export function getRecommendedModelRef(): string {
  const rec = recommendModel();
  return rec.primary.huggingFaceId ?? rec.primary.ollamaTag ?? rec.primary.modelName;
}
