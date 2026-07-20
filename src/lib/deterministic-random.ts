/**
 * Deterministic pseudo-random number generator (mulberry32).
 * Used in place of Math.random() for reproducible simulation data.
 * Seed derived from a source string (e.g., wallet address, collection name).
 */
export function seededRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  // mulberry32
  let t = (h += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Deterministic random integer in [min, max) range.
 */
export function seededRandomInt(seed: string, min: number, max: number): number {
  return min + Math.floor(seededRandom(seed) * (max - min));
}

/**
 * Deterministic element pick from array.
 */
export function seededPick<T>(seed: string, arr: T[]): T {
  return arr[seededRandomInt(seed, 0, arr.length)];
}
