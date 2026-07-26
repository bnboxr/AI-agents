/**
 * Demo Mode / Maintenance Mode — explict opt-in only.
 *
 * LIVE by default. The platform operates on real data.
 * Demo mode is ONLY for maintenance scenarios:
 *   - URL param `?demo=true`
 *   - localStorage `hs_demo` === `"true"`
 *
 * When demo mode is off (default), all components show real/live data.
 * When live data fails, components show error messages — NEVER silent fallback to demo.
 */

const STORAGE_KEY = "hs_demo";

  if (typeof window === "undefined") return false; // SSR: never demo
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
    // Only demo if explicitly opted in via localStorage
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false; // localStorage unavailable = LIVE
  }
}

  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, current ? "false" : "true");
    window.location.reload();
  } catch {
    // ignore
  }
}

/** Fake demo address — clearly identifiable as simulated */

/** Fake demo balance for display purposes */
  value: BigInt("1000000000000000000"), // 1 ETH in wei
  decimals: 18,
  symbol: "ETH",
  formatted: "1.0",
};
