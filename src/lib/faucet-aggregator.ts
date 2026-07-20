// ── Faucet Aggregator ─────────────────────────────────────────────────
// One-click "Fund My Wallet" that tries multiple faucets in parallel
// for the connected chain. Covers 6 testnet chains with 20+ faucets.
//
// Faucet types:
//   web    — visit link, opens in browser tab (manual interaction)
//   api    — can auto-request via fetch (no captcha)
//   pow    — proof-of-work faucet (pk910.de style)
//   bridge — bridge UI (user must interact manually)
//
// Chains covered:
//   Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Mumbai,
//   Optimism Sepolia, Scroll Sepolia

// ── Types ────────────────────────────────────────────────────────────

export interface FaucetEntry {
  name: string;
  url: string;
  chain: string;
  token: string;
  type: "web" | "api" | "pow" | "bridge";
  description: string;
}

export interface FaucetResult {
  faucet: FaucetEntry;
  status: "trying" | "success" | "failed" | "skipped";
  message: string;
  txHash?: string;
}

// ── Faucet Registry — 22 faucets across 6 chains ─────────────────────

export const FAUCET_REGISTRY: FaucetEntry[] = [
  // ── Sepolia ETH ──────────────────────────────────────────────
  {
    name: "Sepolia Faucet",
    url: "https://sepoliafaucet.com",
    chain: "sepolia",
    token: "ETH",
    type: "web",
    description: "Alchemy-powered Sepolia faucet — 0.5 ETH/day",
  },
  {
    name: "Google Web3 Faucet",
    url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
    chain: "sepolia",
    token: "ETH",
    type: "web",
    description: "Google Cloud Web3 faucet — 0.05 ETH/day",
  },
  {
    name: "PoW Faucet (pk910)",
    url: "https://sepolia-faucet.pk910.de",
    chain: "sepolia",
    token: "ETH",
    type: "pow",
    description: "Proof-of-work faucet — mine larger amounts",
  },
  {
    name: "Alchemy Sepolia Faucet",
    url: "https://www.alchemy.com/faucets/ethereum-sepolia",
    chain: "sepolia",
    token: "ETH",
    type: "web",
    description: "Alchemy faucet — requires login, 0.5 ETH/day",
  },
  {
    name: "QuickNode Sepolia Faucet",
    url: "https://faucet.quicknode.com/ethereum/sepolia",
    chain: "sepolia",
    token: "ETH",
    type: "web",
    description: "QuickNode faucet — 0.1 ETH/day",
  },

  // ── Arbitrum Sepolia ETH ─────────────────────────────────────
  {
    name: "QuickNode Arbitrum Sepolia",
    url: "https://faucet.quicknode.com/arbitrum/sepolia",
    chain: "arbitrum-sepolia",
    token: "ETH",
    type: "web",
    description: "QuickNode Arbitrum Sepolia faucet",
  },
  {
    name: "Alchemy Arbitrum Sepolia",
    url: "https://www.alchemy.com/faucets/arbitrum-sepolia",
    chain: "arbitrum-sepolia",
    token: "ETH",
    type: "web",
    description: "Alchemy Arbitrum Sepolia faucet — requires login",
  },
  {
    name: "Chainlink Arbitrum Sepolia",
    url: "https://faucets.chain.link/arbitrum-sepolia",
    chain: "arbitrum-sepolia",
    token: "ETH",
    type: "web",
    description: "Chainlink faucet for Arbitrum Sepolia",
  },
  {
    name: "Arbitrum Bridge",
    url: "https://bridge.arbitrum.io/?destinationChain=arbitrum-sepolia",
    chain: "arbitrum-sepolia",
    token: "ETH",
    type: "bridge",
    description: "Arbitrum bridge — Sepolia ETH → Arb Sepolia",
  },

  // ── Base Sepolia ETH ─────────────────────────────────────────
  {
    name: "QuickNode Base Sepolia",
    url: "https://faucet.quicknode.com/base/sepolia",
    chain: "base-sepolia",
    token: "ETH",
    type: "web",
    description: "QuickNode Base Sepolia faucet",
  },
  {
    name: "Alchemy Base Sepolia",
    url: "https://www.alchemy.com/faucets/base-sepolia",
    chain: "base-sepolia",
    token: "ETH",
    type: "web",
    description: "Alchemy Base Sepolia faucet — requires login",
  },
  {
    name: "Chainlink Base Sepolia",
    url: "https://faucets.chain.link/base-sepolia",
    chain: "base-sepolia",
    token: "ETH",
    type: "web",
    description: "Chainlink faucet for Base Sepolia",
  },
  {
    name: "Base Bridge",
    url: "https://bridge.base.org",
    chain: "base-sepolia",
    token: "ETH",
    type: "bridge",
    description: "Base bridge — Sepolia ETH → Base Sepolia",
  },

  // ── Polygon Mumbai MATIC ─────────────────────────────────────
  {
    name: "Polygon Official Faucet",
    url: "https://faucet.polygon.technology",
    chain: "mumbai",
    token: "MATIC",
    type: "web",
    description: "Official Polygon faucet — 0.5 MATIC",
  },
  {
    name: "Alchemy Mumbai Faucet",
    url: "https://www.alchemy.com/faucets/polygon-mumbai",
    chain: "mumbai",
    token: "MATIC",
    type: "web",
    description: "Alchemy Polygon Mumbai faucet — requires login",
  },
  {
    name: "QuickNode Mumbai Faucet",
    url: "https://faucet.quicknode.com/polygon/mumbai",
    chain: "mumbai",
    token: "MATIC",
    type: "web",
    description: "QuickNode Polygon Mumbai faucet",
  },

  // ── Optimism Sepolia ETH ─────────────────────────────────────
  {
    name: "QuickNode Optimism Sepolia",
    url: "https://faucet.quicknode.com/optimism/sepolia",
    chain: "optimism-sepolia",
    token: "ETH",
    type: "web",
    description: "QuickNode Optimism Sepolia faucet",
  },
  {
    name: "Alchemy Optimism Sepolia",
    url: "https://www.alchemy.com/faucets/optimism-sepolia",
    chain: "optimism-sepolia",
    token: "ETH",
    type: "web",
    description: "Alchemy Optimism Sepolia faucet — requires login",
  },

  // ── Scroll Sepolia ETH ───────────────────────────────────────
  {
    name: "QuickNode Scroll Sepolia",
    url: "https://faucet.quicknode.com/scroll",
    chain: "scroll-sepolia",
    token: "ETH",
    type: "web",
    description: "QuickNode Scroll Sepolia faucet",
  },
  {
    name: "Scroll Sepolia Faucet",
    url: "https://sepolia.scroll.io",
    chain: "scroll-sepolia",
    token: "ETH",
    type: "web",
    description: "Official Scroll Sepolia faucet",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Get all faucets for a given chain ID string.
 * Chain IDs map: sepolia, arbitrum-sepolia, base-sepolia, mumbai, optimism-sepolia, scroll-sepolia
 */
export function getFaucetsForChain(chainId: string): FaucetEntry[] {
  return FAUCET_REGISTRY.filter((f) => f.chain === chainId);
}

/**
 * Get faucets of a specific type for a chain.
 */
export function getFaucetsByType(chainId: string, type: FaucetEntry["type"]): FaucetEntry[] {
  return FAUCET_REGISTRY.filter((f) => f.chain === chainId && f.type === type);
}

/**
 * Auto-request faucets (API and PoW type).
 * Currently supports the pk910.de PoW faucet for Sepolia.
 */
export async function requestFaucetApi(
  faucet: FaucetEntry,
  address: string
): Promise<{ success: boolean; txHash?: string; message: string }> {
  if (faucet.type === "pow" && faucet.url.includes("pk910.de")) {
    try {
      const apiUrl = faucet.url.replace(/\/?$/, "/api/mine");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          txHash: data.txHash,
          message: `PoW faucet request submitted. ${data.message || ""}`,
        };
      }

      const text = await res.text();
      return {
        success: false,
        message: `PoW faucet failed: ${text.slice(0, 200)}`,
      };
    } catch (err) {
      return {
        success: false,
        message: `PoW faucet error: ${(err as Error).message}`,
      };
    }
  }

  // For "web" and "bridge" types, auto-request is not possible
  return {
    success: false,
    message: `Auto-request not supported for ${faucet.type} faucets. Open the link manually.`,
  };
}

/**
 * "Fund My Wallet" — one-click that opens all web faucets in new tabs
 * and tries API/PoW faucets automatically.
 *
 * Returns results for all faucets tried.
 */
export async function fundWallet(
  address: string,
  chainId: string
): Promise<FaucetResult[]> {
  const faucets = getFaucetsForChain(chainId);

  if (faucets.length === 0) {
    return [];
  }

  const results: FaucetResult[] = [];

  // Open web/bridge faucets in new tabs (browser-only)
  const webFaucets = faucets.filter((f) => f.type === "web" || f.type === "bridge");

  for (const faucet of webFaucets) {
    if (typeof window !== "undefined") {
      window.open(faucet.url, "_blank", "noopener,noreferrer");
    }
    results.push({
      faucet,
      status: "trying",
      message: `Opened ${faucet.name} in new tab — complete the form there.`,
    });
  }

  // Try API/PoW faucets automatically
  const autoFaucets = faucets.filter((f) => f.type === "api" || f.type === "pow");

  const autoPromises = autoFaucets.map(async (faucet) => {
    const res = await requestFaucetApi(faucet, address);
    return {
      faucet,
      status: res.success ? ("success" as const) : ("failed" as const),
      message: res.message,
      txHash: res.txHash,
    } satisfies FaucetResult;
  });

  const autoResults = await Promise.all(autoPromises);
  results.push(...autoResults);

  return results;
}

/**
 * Get a summary of faucet activity for display.
 */
export function getFaucetSummary(results: FaucetResult[]): {
  total: number;
  web: number;
  auto: number;
  success: number;
  failed: number;
  totalEstimatedTokens: string;
} {
  const web = results.filter((r) => r.faucet.type === "web" || r.faucet.type === "bridge").length;
  const auto = results.filter((r) => r.faucet.type === "api" || r.faucet.type === "pow").length;
  const success = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return {
    total: results.length,
    web,
    auto,
    success,
    failed,
    totalEstimatedTokens: "Variable — depends on faucet limits and captcha completion.",
  };
}
