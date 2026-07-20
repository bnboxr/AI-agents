// ── Venue Selector ──────────────────────────────────────────────────
// Persists trading venue preference (Bitunix / Wallet / Auto).
// Uses localStorage for persistence (browser-only).
// Falls back to "bitunix" default.

export type TradingVenue = "bitunix" | "wallet" | "auto";

const STORAGE_KEY = "hsmc_trading_venue";
const DEFAULT_VENUE: TradingVenue = "bitunix";

function readLocalStorage(): TradingVenue {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "bitunix" || stored === "wallet" || stored === "auto") {
        return stored;
      }
    }
  } catch {
    // localStorage not available (SSR / sandbox)
  }
  return DEFAULT_VENUE;
}

function writeLocalStorage(venue: TradingVenue): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, venue);
    }
  } catch {
    // localStorage not available
  }
}

/**
 * Get the current trading venue preference.
 * Returns "bitunix", "wallet", or "auto".
 * Default: "bitunix".
 */
export function getVenuePreference(): TradingVenue {
  return readLocalStorage();
}

/**
 * Set the trading venue preference.
 * Persists to localStorage (if available).
 */
export function setVenuePreference(venue: TradingVenue): void {
  writeLocalStorage(venue);
}

/**
 * Resolve the actual venue to use, honoring "auto" fallback:
 * "auto" → try "bitunix" first, fallback to "wallet".
 */
export function resolveVenue(): "bitunix" | "wallet" {
  const pref = getVenuePreference();
  if (pref === "auto") {
    // Bitunix is the preferred primary; wallet is fallback
    return "bitunix";
  }
  return pref;
}
