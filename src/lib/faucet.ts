// ── Testnet Faucet Integration ───────────────────────────────────────
// Provides one-click faucet links and auto-request capabilities
// for testnet tokens on supported chains.
//
// Sepolia, Arbitrum Sepolia, Base Sepolia, Mumbai supported.

import { getWalletChainId, SUPPORTED_CHAINS, type WalletChainConfig } from "./chains-config";

// ── Faucet Link Definitions ─────────────────────────────────────────

export interface FaucetEntry {
  label: string;
  url: string;
  /** Description shown in the UI */
  description: string;
  /** If true, this endpoint can be auto-requested (no captcha) */
  canAutoRequest: boolean;
}

/** Get faucet entries for the currently selected wallet chain */
export function getFaucetsForCurrentChain(): FaucetEntry[] {
  const chainId = getWalletChainId();
  const config = SUPPORTED_CHAINS[chainId];
  if (!config || !config.testnet || !config.faucets) return [];

  return config.faucets.map((url) => {
    const entry = FAUCET_REGISTRY[url];
    return entry ?? {
      label: "Faucet",
      url,
      description: `Get testnet ${config.nativeToken} from ${new URL(url).hostname}`,
      canAutoRequest: false,
    };
  });
}

/** Known faucet registry with names and descriptions */
const FAUCET_REGISTRY: Record<string, FaucetEntry> = {
  "https://sepoliafaucet.com": {
    label: "Sepolia Faucet",
    url: "https://sepoliafaucet.com",
    description: "Alchemy-powered Sepolia faucet — 0.5 ETH/day",
    canAutoRequest: false,
  },
  "https://cloud.google.com/application/web3/faucet/ethereum/sepolia": {
    label: "Google Web3 Faucet",
    url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
    description: "Google Cloud Web3 faucet — 0.05 ETH/day",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/arbitrum/sepolia": {
    label: "QuickNode Faucet",
    url: "https://faucet.quicknode.com/arbitrum/sepolia",
    description: "QuickNode Arbitrum Sepolia faucet",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/base/sepolia": {
    label: "QuickNode Faucet",
    url: "https://faucet.quicknode.com/base/sepolia",
    description: "QuickNode Base Sepolia faucet",
    canAutoRequest: false,
  },
  "https://faucet.polygon.technology/": {
    label: "Polygon Faucet",
    url: "https://faucet.polygon.technology/",
    description: "Official Polygon faucet — 0.5 MATIC",
    canAutoRequest: false,
  },
};

// ── Auto-Faucet Request ─────────────────────────────────────────────

export interface FaucetRequestResult {
  success: boolean;
  message: string;
  txHash?: string;
}

/**
 * Attempt to auto-request testnet tokens via the pk910.de Sepolia PoW faucet.
 * This faucet doesn't require API keys but may require captcha solving
 * which is not possible programmatically. Falls back to manual link.
 *
 * POST https://sepolia-faucet.pk910.de/api/mine
 * Body: { address: "0x..." }
 */
export async function requestSepoliaFaucet(address: string): Promise<FaucetRequestResult> {
  try {
    const res = await fetch("https://sepolia-faucet.pk910.de/api/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        message: `Faucet request submitted! Check ${address} for test ETH shortly.`,
        txHash: data.txHash,
      };
    }

    const text = await res.text();
    return {
      success: false,
      message: `Faucet request failed: ${text.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Faucet request error: ${(err as Error).message}. Try the manual faucet link instead.`,
    };
  }
}

/**
 * Get all faucet links for a specific chain (by chain ID string).
 * Useful for showing faucets without switching chains.
 */
export function getFaucetsForChain(chainId: string): FaucetEntry[] {
  const config = SUPPORTED_CHAINS[chainId];
  if (!config || !config.testnet || !config.faucets) return [];

  return config.faucets.map((url) => {
    const entry = FAUCET_REGISTRY[url];
    return entry ?? {
      label: "Faucet",
      url,
      description: `Get testnet ${config.nativeToken}`,
      canAutoRequest: false,
    };
  });
}
