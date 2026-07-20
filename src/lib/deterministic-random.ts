// ── Deterministic Random ─────────────────────────────────────────────
// Hash-based seeded random number generator. Produces identical output
// for identical seed strings — critical for reproducible backtesting
// and audit-trail consistency across the agent pipeline.
//
// Usage:
//   seededRandom("BTC-12345")        → deterministic float [0, 1)
//   deterministicUUID("my-seed")     → deterministic UUID string

/**
 * Simple polynomial hash of a string seed, normalized to [0, 1).
 * Same seed always produces the same float — suitable for slippage
 * simulation, randomized-but-repeatable agent decisions, etc.
 */
export function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Normalize to [0, 1)
  return ((Math.abs(hash) % 1_000_000) / 1_000_000);
}

const HEX = "0123456789abcdef";

/**
 * Deterministic UUID v4-formatted string from a seed.
 * Generates 32 hex digits via seededRandom, then formats as 8-4-4-4-12.
 */
export function deterministicUUID(seed: string): string {
  const digits: string[] = [];
  for (let i = 0; i < 32; i++) {
    const r = seededRandom(`${seed}-uuid-${i}`);
    digits.push(HEX[Math.floor(r * 16)]);
  }
  return (
    digits.slice(0, 8).join("") +
    "-" +
    digits.slice(8, 12).join("") +
    "-" +
    digits.slice(12, 16).join("") +
    "-" +
    digits.slice(16, 20).join("") +
    "-" +
    digits.slice(20, 32).join("")
  );
}
