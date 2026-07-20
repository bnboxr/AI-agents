/**
 * Demo Mode — bypasses wallet requirements so the platform is fully explorable
 * without MetaMask or any real wallet connection.
 *
 * Default: demo mode ON (so the platform feels alive out of the box).
 * Toggle via URL param `?demo=true` or `?demo=false`, or via the navbar toggle.
 */

const STORAGE_KEY = "hs_demo";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return true; // SSR default to demo
  try {
    const urlDemo = new URLSearchParams(window.location.search).get("demo");
    if (urlDemo === "true") {
      localStorage.setItem(STORAGE_KEY, "true");
      return true;
    }
    if (urlDemo === "false") {
      localStorage.setItem(STORAGE_KEY, "false");
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) !== "false"; // Default: demo ON
  } catch {
    return true; // localStorage unavailable = demo
  }
}

export function toggleDemo(): void {
  if (typeof window === "undefined") return;
  try {
    const current = isDemoMode();
    localStorage.setItem(STORAGE_KEY, current ? "false" : "true");
    window.location.reload();
  } catch {
    // ignore
  }
}

/** Fake demo address — clearly identifiable as simulated */
export const DEMO_ADDRESS = "0xDEM0DEADBEEF0000000000000000000000000000" as const;

/** Fake demo balance for display purposes */
export const DEMO_BALANCE = {
  value: BigInt("1000000000000000000"), // 1 ETH in wei
  decimals: 18,
  symbol: "ETH",
  formatted: "1.0",
};
