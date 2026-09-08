// ── Environment Guard (owner hard rule) ──────────────────────────────
// LIVE execution requires real credentials. When a required env var is
// missing, this throws a clear error — it NEVER falls back to simulation,
// paper mode, or a fabricated value presented as real.
//
// Owner directive (WORKFLOW.md): "NO demo, NO fake, NO mock, NO fallback
// data — anywhere. Errors must surface as errors."
//
// The owner adds real key values to Secrets later; until then the live
// paths throw on first call, which is the intended behavior. Env is read
// at call time (not module load) so Secrets injected at startup work.

/**
 * Return the value of a required environment variable or throw.
 *
 * @param name  env var name, e.g. "BINANCE_API_KEY"
 * @returns     the non-empty value
 * @throws      Error with the owner-approved phrasing when missing/empty
 */
export function requireEnv(name: string): string {
  const value =
    typeof process !== "undefined" && process.env
      ? process.env[name]
      : undefined;
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[live] Missing required env var ${name} — add it to Secrets. Refusing to simulate.`,
    );
  }
  return value;
}