// ── Model Selector ───────────────────────────────────────────────────
// Profiles local hardware and recommends the best GGUF model to run.
// Balances model capability against available RAM and CPU cores.
// Also provides structured recommendations per inference server.

import os from "os";

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
  const ram = os.totalmem();
  const free_ram = os.freemem();

  return {
    ram,
    free_ram,
    cpus: os.cpus().length,
    platform: os.platform(),
    arch: os.arch(),
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
