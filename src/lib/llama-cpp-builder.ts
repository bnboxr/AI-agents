// ── Llama C++ Builder ─────────────────────────────────────────────────
// Auto-builds llama.cpp from source when no existing inference server is
// found. Provides a fully self-sufficient local AI runtime with zero
// dependency on Ollama, LM Studio, or any pre-installed server.
//
// On first run (when no server is detected):
//   1. Clones llama.cpp from GitHub (shallow, latest release tag)
//   2. Builds with cmake (CPU-only by default; CUDA optional)
//   3. Returns the path to llama-server binary
//
// Subsequent runs skip the build if the binary already exists.

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, platform, cpus, tmpdir } from "node:os";
import { execSync } from "child_process";

// ── Constants ─────────────────────────────────────────────────────────

const BUILD_DIR = join(tmpdir(), "llama-cpp-build");
const BINARY_NAME = platform() === "win32" ? "llama-server.exe" : "llama-server";
const BINARY_PATH = join(BUILD_DIR, "build", "bin", BINARY_NAME);

/** Tag/branch to clone — pinned to a stable release */
const LLAMA_CPP_RELEASE_TAG = "b4390";

/** Common search paths for pre-existing llama-server binaries */
const SEARCH_PATHS = [
  "llama-server",
  join(BUILD_DIR, "build", "bin", "llama-server"),
  "/usr/local/bin/llama-server",
  "/usr/bin/llama-server",
  join(homedir(), "llama.cpp", "build", "bin", "llama-server"),
  join(homedir(), ".local", "bin", "llama-server"),
];

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve a binary name/path to a full path using `which`.
 * Returns `null` if the binary is not found on PATH.
 */
function which(name: string): string | null {
  try {
    const out = execSync(`which ${name}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Search for an existing llama-server binary at common locations.
 * Returns the first found path, or `null` if none exists.
 */
function findExisting(names: string[]): string | null {
  for (const name of names) {
    // If the name looks like a full path, check it directly
    if (name.includes("/") || name.includes("\\")) {
      if (existsSync(name)) return resolve(name);
    } else {
      // Otherwise search PATH
      const resolved = which(name);
      if (resolved) return resolved;
    }
  }
  return null;
}

// ── Build-Tool Detection ──────────────────────────────────────────────

export interface BuildToolsStatus {
  cmake: boolean;
  make: boolean;
  gcc: boolean;
  git: boolean;
}

/**
 * Check which build tools are available on the system.
 * Used to gate auto-build: if critical tools are missing the caller should
 * surface a clear error rather than failing mid-build.
 */
export async function checkBuildTools(): Promise<BuildToolsStatus> {
  const tools = ["cmake", "make", "gcc", "git"] as const;
  const [cmake, make, gcc, git] = await Promise.all(
    tools.map(async (tool) => {
      try {
        execSync(`which ${tool}`, { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    }),
  );
  return { cmake, make, gcc, git };
}

// ── Core: Ensure llama.cpp Binary ─────────────────────────────────────

/**
 * Guarantee a working llama-server binary. The resolution order is:
 *   1. Check known paths / PATH for an existing binary.
 *   2. If `BUILD_DIR/build/bin/llama-server` already exists, reuse it.
 *   3. Otherwise clone & build llama.cpp from source.
 *
 * Returns the absolute path to the `llama-server` binary.
 * Throws if the build fails or required tools are missing.
 */
export async function ensureLlamaCpp(): Promise<string> {
  // 1. Check for existing binary on PATH or known locations
  const existing = findExisting(SEARCH_PATHS);
  if (existing) {
    console.log(`[LlamaCpp] Found existing binary: ${existing}`);
    return existing;
  }

  // 2. Check if we already built it in BUILD_DIR
  if (existsSync(BINARY_PATH)) {
    console.log(`[LlamaCpp] Reusing previously built binary: ${BINARY_PATH}`);
    return BINARY_PATH;
  }

  // 3. Check build tools before attempting a build
  console.log("[LlamaCpp] No existing binary found — checking build tools...");
  const tools = await checkBuildTools();
  if (!tools.git) {
    throw new Error(
      "[LlamaCpp] git is not installed. Install git to auto-build llama.cpp.",
    );
  }
  if (!tools.cmake) {
    throw new Error(
      "[LlamaCpp] cmake is not installed. Install cmake to auto-build llama.cpp.",
    );
  }
  if (!tools.gcc) {
    throw new Error(
      "[LlamaCpp] gcc is not installed. Install gcc to auto-build llama.cpp.",
    );
  }

  // 4. Clone llama.cpp (shallow, single tag)
  console.log(
    `[LlamaCpp] Cloning llama.cpp (tag: ${LLAMA_CPP_RELEASE_TAG})...`,
  );
  mkdirSync(BUILD_DIR, { recursive: true });

  const cloneResult =
    await $`git clone --depth 1 --branch ${LLAMA_CPP_RELEASE_TAG} https://github.com/ggerganov/llama.cpp.git ${BUILD_DIR}`
      .cwd(tmpdir())
      .quiet()
      .nothrow();

  if (cloneResult.exitCode !== 0) {
    // If the tag clone fails, try main as a fallback
    console.log("[LlamaCpp] Tag clone failed, trying main branch...");
    const fallbackResult =
      await $`git clone --depth 1 https://github.com/ggerganov/llama.cpp.git ${BUILD_DIR}`
        .cwd(tmpdir())
        .quiet()
        .nothrow();
    if (fallbackResult.exitCode !== 0) {
      throw new Error(
        `[LlamaCpp] Failed to clone llama.cpp:\n${fallbackResult.stderr.toString()}`,
      );
    }
  }

  // 5. Build with cmake (CPU-only by default)
  console.log("[LlamaCpp] Configuring with cmake...");
  const cpuCount = cpus().length;

  const cmakeResult =
    await $`cmake -B build -DGGML_CUDA=OFF -DCMAKE_BUILD_TYPE=Release`
      .cwd(BUILD_DIR)
      .quiet()
      .nothrow();

  if (cmakeResult.exitCode !== 0) {
    throw new Error(
      `[LlamaCpp] cmake configure failed:\n${cmakeResult.stderr.toString()}`,
    );
  }

  console.log(`[LlamaCpp] Building (${cpuCount} parallel jobs)...`);
  const buildResult =
    await $`cmake --build build --config Release -j${String(cpuCount)}`
      .cwd(BUILD_DIR)
      .quiet()
      .nothrow();

  if (buildResult.exitCode !== 0) {
    throw new Error(
      `[LlamaCpp] Build failed:\n${buildResult.stderr.toString()}`,
    );
  }

  if (!existsSync(BINARY_PATH)) {
    throw new Error(
      `[LlamaCpp] Build completed but binary not found at ${BINARY_PATH}`,
    );
  }

  console.log(`[LlamaCpp] Build successful: ${BINARY_PATH}`);
  return BINARY_PATH;
}

/**
 * Ensure llama.cpp and immediately return the binary path.
 * Convenience wrapper for one-shot callers.
 */
export function ensureLlamaCppSync(): string | null {
  // Synchronous check only — cannot build synchronously.
  return findExisting(SEARCH_PATHS) ?? (existsSync(BINARY_PATH) ? BINARY_PATH : null);
}
