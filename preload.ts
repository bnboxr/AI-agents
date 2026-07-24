// Preload shim: tronweb (Google protobuf closure lib) expects a global `proto`
// namespace object, but Bun doesn't provide it. This runs before any imports.
(globalThis as any).proto = {};

// ── Auto-create .env from .env.example on first run ──────────────────
import { existsSync, copyFileSync } from "fs";
if (!existsSync(".env") && existsSync(".env.example")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example — edit with your keys");
}
