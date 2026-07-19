// Behavioral randomization — deterministic personas, amounts, delays, action selection
import type { AirdropActionType, WalletPersona } from "./types";

// ── Simple deterministic hash ───────────────────────────────────────

function hashStr(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Given a seed, returns a function that produces deterministic random numbers in [0, 1).
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Base action order (unshuffled) ──────────────────────────────────

const BASE_ACTION_ORDER: AirdropActionType[] = ["swap", "deposit", "borrow", "bridge"];

/** Fisher-Yates shuffle using a seeded RNG */
function shuffleSeeded<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ── Stablecoin preferences ──────────────────────────────────────────

const STABLECOINS = ["USDC", "USDT", "DAI", "FRAX"];

// ── Public API ──────────────────────────────────────────────────────

/**
 * Generate a deterministic wallet persona from walletIndex+chainId hash.
 */
export function generatePersona(walletIndex: number, chainId: string): WalletPersona {
  const seedBase = hashStr(`${walletIndex}:${chainId}`);
  const rng = mulberry32(seedBase);

  const skipProbability = 0.1 + rng() * 0.2; // 0.1-0.3
  const actionCountMin = 1 + Math.floor(rng() * 2); // 1-2
  const actionCountMax = actionCountMin + 1 + Math.floor(rng() * 3); // 2-5, >= min
  const actionCountRange: [number, number] = [actionCountMin, Math.max(actionCountMin, actionCountMax)];
  const timezoneOffset = Math.floor(rng() * 24); // 0-23
  const dexPreference: 'v2' | 'v3' = rng() < 0.5 ? 'v2' : 'v3';
  const stableIdx = Math.floor(rng() * STABLECOINS.length);
  const stablecoinPreference = STABLECOINS[stableIdx] ?? "USDC";

  const preferredActionOrder = shuffleSeeded(BASE_ACTION_ORDER, rng);

  return {
    preferredActionOrder,
    skipProbability,
    actionCountRange,
    timezoneOffset,
    dexPreference,
    stablecoinPreference,
  };
}

/**
 * Randomize an amount: base × (1 + random(-variance, +variance)).
 * Uses a deterministic seed for reproducibility.
 */
export function randomAmount(
  base: number,
  variance: number,
  seed?: number,
): number {
  const rng = mulberry32(seed ?? Date.now());
  const factor = 1 + (rng() * 2 - 1) * variance;
  return base * factor;
}

/**
 * Randomize a delay: base × (1 + random(-variance, +variance)).
 * Uses a deterministic seed for reproducibility.
 */
export function randomDelay(
  base: number,
  variance: number,
  seed?: number,
): number {
  const rng = mulberry32(seed ?? Date.now());
  const factor = 1 + (rng() * 2 - 1) * variance;
  return Math.max(1000, base * factor); // minimum 1 second
}

/**
 * Weighted coin flip based on persona's skip probability.
 */
export function shouldSkipAction(persona: WalletPersona): boolean {
  const seed = hashStr(`${persona.timezoneOffset}:${persona.dexPreference}:${Date.now()}`);
  const rng = mulberry32(seed);
  return rng() < persona.skipProbability;
}

/**
 * Select N actions from the persona's preferred action order,
 * where N is a random value within the actionCountRange.
 */
export function selectActions(persona: WalletPersona): AirdropActionType[] {
  const rng = mulberry32(hashStr(`${persona.timezoneOffset}:${persona.dexPreference}:actions`));
  const [min, max] = persona.actionCountRange;
  const count = Math.min(
    persona.preferredActionOrder.length,
    min + Math.floor(rng() * (max - min + 1)),
  );

  return persona.preferredActionOrder.slice(0, count);
}
