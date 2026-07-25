// Preload shim: tronweb (Google protobuf closure lib) expects a global `proto`
// namespace object, but Bun doesn't provide it. This runs before any imports.
(globalThis as any).proto = {};

// ── Auto-create .env from .env.example on first run ──────────────────
import { existsSync, copyFileSync } from "node:fs";
if (!existsSync(".env") && existsSync(".env.example")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example — edit with your keys");
}

// ── Startup: Full Local AI Auto-Provisioning ────────────────────────
//
// Resolution order (no Ollama/LM Studio dependency):
//   1. Scan for Ollama, LM Studio, llama.cpp server (existing)
//   2. If none found:
//      a. Check for build tools (cmake, gcc, git)
//      b. If tools exist: git clone + build llama.cpp
//      c. If no .gguf files on disk: recommend + auto-download best model
//      d. Start llama-server with the model
//   3. Log ready status

import { scanLocalAI, scanGGUFFiles, startLlamaCppServer } from "./src/lib/local-ai-scanner";
import { recommendModel, getDefaultModelPath, downloadModel } from "./src/lib/model-selector";
import { checkBuildTools, ensureLlamaCppSync } from "./src/lib/llama-cpp-builder";

const localAI = await scanLocalAI();

// Check if any external server is already running
const anyServer =
  localAI.ollama || localAI.lmStudio || localAI.llamaCpp ||
  localAI.textGenWebUI || localAI.jan || localAI.openWebUI;

console.log("[HSMC] Local AI scan:", localAI);

if (!anyServer) {
  console.log("[HSMC] No local AI server found — provisioning llama.cpp...");

  // (a) Check for build tools
  let canBuild = false;
  try {
    const tools = await checkBuildTools();
    canBuild = tools.cmake && tools.gcc && tools.git;
    if (canBuild) {
      console.log("[HSMC] Build tools found: cmake, gcc, git ✓");
    } else {
      const missing = [];
      if (!tools.cmake) missing.push("cmake");
      if (!tools.gcc) missing.push("gcc");
      if (!tools.git) missing.push("git");
      console.warn(
        `[HSMC] Missing build tools: ${missing.join(", ")}. Cannot auto-build llama.cpp.`,
      );
      console.warn(
        "[HSMC] Install with: apt-get install cmake gcc git  (or equivalent)",
      );
    }
  } catch (err) {
    console.warn("[HSMC] Could not check build tools:", err);
  }

  // (b) Find or wait until we have a .gguf model file
  const existingGGUF = scanGGUFFiles();
  let modelPath: string | null = null;

  if (existingGGUF.length > 0) {
    modelPath = existingGGUF[0].path;
    console.log(
      `[HSMC] Found existing model: ${existingGGUF[0].filename} (${existingGGUF[0].sizeGB} GB)`,
    );
  } else {
    // (c) No .gguf files — recommend and auto-download
    const rec = recommendModel();
    const modelRef = rec.primary.huggingFaceId;
    console.log(
      `[HSMC] No .gguf files found. Recommended: ${rec.primary.modelName} ` +
      `(${rec.primary.sizeGB} GB, ${rec.primary.quantization})`,
    );

    if (modelRef) {
      console.log(`[HSMC] Auto-downloading model: ${modelRef}`);
      try {
        modelPath = await downloadModel(
          modelRef,
          (pct: number) => {
            if (pct % 10 === 0) {
              console.log(`[HSMC] Download progress: ${pct}%`);
            }
          },
        );
        console.log(`[HSMC] Model downloaded to: ${modelPath}`);
      } catch (err) {
        console.warn("[HSMC] Auto-download failed:", err);
        console.warn(
          "[HSMC] To manually download a model, place a .gguf file in " +
          `${getDefaultModelPath()} or run:\n` +
          `  huggingface-cli download ${modelRef} --local-dir ${getDefaultModelPath()}`,
        );
      }
    } else {
      console.warn("[HSMC] No model reference available for auto-download.");
    }
  }

  // (d) Start llama-server if we have a model
  if (modelPath) {
    // Ensure we have the llama-server binary
    const existingBinary = ensureLlamaCppSync();
    if (!existingBinary && !canBuild) {
      console.warn(
        "[HSMC] Cannot start llama.cpp server: no binary and no build tools.\n" +
        "  Install build tools (cmake gcc git) and restart, or manually install Ollama/LM Studio.",
      );
    } else {
      try {
        const result = await startLlamaCppServer(modelPath);
        console.log(
          `[HSMC] Local AI ready — llama.cpp serving model on port ${result.port} (pid ${result.process.pid})`,
        );
        // Store port globally so other modules can discover it
        (globalThis as any).__HSMC_LLAMA_PORT = result.port;
      } catch (err) {
        console.error("[HSMC] Failed to start llama.cpp server:", err);
      }
    }
  } else if (!existingGGUF.length) {
    console.log("[HSMC] No model available. Local AI will not start.");
    console.log("[HSMC] Place a .gguf file in ~/models/ and restart.");
  }
} else {
  // At least one server is already running — log which one
  const running: string[] = [];
  if (localAI.ollama) running.push("Ollama (port 11434)");
  if (localAI.lmStudio) running.push("LM Studio (port 1234)");
  if (localAI.llamaCpp) running.push("llama.cpp (port 8080)");
  if (localAI.textGenWebUI) running.push("TextGen WebUI (port 7860)");
  if (localAI.jan) running.push("Jan AI (port 1337)");
  if (localAI.openWebUI) running.push("Open WebUI (port 3000)");

  console.log(`[HSMC] Local AI servers already running: ${running.join(", ")}`);
  // Still scan for .gguf files for awareness
  const ggufFiles = scanGGUFFiles();
  if (ggufFiles.length > 0) {
    console.log(
      `[HSMC] Found ${ggufFiles.length} .gguf file(s), largest: ${ggufFiles[0].filename} (${ggufFiles[0].sizeGB} GB)`,
    );
  }
}
