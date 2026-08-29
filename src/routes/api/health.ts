import { createServerFn } from "@tanstack/react-start";
import { isDbAvailable } from "~/lib/db";

const startTime = Date.now();

/**
 * True if an env var is set to a non-empty value.
 */
function envSet(name: string): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  const v = process.env[name];
  return !!v && v.trim().length > 0;
}

/**
 * Health check — reports REAL status derived from the actual system.
 *
 * Deliberately does NOT claim "all chains active" or "29 agents": those are
 * fabricated. Each module reports its true configured state, and `coreReady`
 * reflects whether the critical subsystems (database + wallet) are actually
 * set up. The endpoint returning at all is the fundamental liveness signal.
 */
export const healthCheck = createServerFn().handler(async () => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const database = isDbAvailable() ? "up" : "down";
  const wallet = envSet("AUTONOMOUS_WALLET_SECRET")
    ? "configured"
    : "not_configured";

  const binance =
    envSet("BINANCE_API_KEY") && envSet("BINANCE_SECRET_KEY")
      ? "configured"
      : "not_configured";
  const bitunix =
    envSet("BITUNIX_API_KEY") && envSet("BITUNIX_SECRET_KEY")
      ? "configured"
      : "not_configured";

  const polygon = envSet("POLYGON_RPC_URL") ? "configured" : "not_configured";
  const solana = envSet("SOLANA_RPC_URL") ? "configured" : "not_configured";

  const coreReady = database === "up" && wallet === "configured";

  return {
    // "ok" means: the server process is alive and this endpoint responded.
    // It does not imply every module is live — see `modules` and `coreReady`.
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: `${uptime}s`,
    coreReady,
    modules: {
      database,
      wallet,
      exchanges: { binance, bitunix },
      chains: { polygon, solana },
    },
  };
});
