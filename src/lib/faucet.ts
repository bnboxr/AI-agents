// ── Testnet Faucet Integration ───────────────────────────────────────
// Provides one-click faucet links and auto-request capabilities
// for testnet tokens on supported chains.
//
// Sepolia, Arbitrum Sepolia, Base Sepolia, Mumbai,
// Optimism Sepolia, Scroll Sepolia supported.
//
// Delegates to faucet-aggregator.ts for the full registry.

import { getWalletChainId, SUPPORTED_CHAINS, type WalletChainConfig } from "./chains-config";
import {
  FAUCET_REGISTRY as AGGREGATOR_FAUCETS,
  getFaucetsForChain as aggregatorGetFaucets,
  requestFaucetApi as aggregatorRequestApi,
  fundWallet as aggregatorFundWallet,
  getFaucetSummary,
  type FaucetEntry as AggregatorFaucetEntry,
  type FaucetResult,
} from "./faucet-aggregator";

// ── Re-exports ───────────────────────────────────────────────────────

export type { FaucetEntry as FaucetEntryAggregator, FaucetResult } from "./faucet-aggregator";

// ── Legacy Faucet Entry (for backward compatibility) ─────────────────

export interface FaucetEntry {
  label: string;
  url: string;
  /** Description shown in the UI */
  description: string;
  /** If true, this endpoint can be auto-requested (no captcha) */
  canAutoRequest: boolean;
}

// ── Known faucet registry with names and descriptions ─────────────────

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
  "https://sepolia-faucet.pk910.de": {
    label: "PoW Faucet (pk910)",
    url: "https://sepolia-faucet.pk910.de",
    description: "Proof-of-work faucet — mine larger amounts",
    canAutoRequest: true,
  },
  "https://www.alchemy.com/faucets/ethereum-sepolia": {
    label: "Alchemy Sepolia Faucet",
    url: "https://www.alchemy.com/faucets/ethereum-sepolia",
    description: "Alchemy faucet — requires login, 0.5 ETH/day",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/ethereum/sepolia": {
    label: "QuickNode Sepolia Faucet",
    url: "https://faucet.quicknode.com/ethereum/sepolia",
    description: "QuickNode faucet — 0.1 ETH/day",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/arbitrum/sepolia": {
    label: "QuickNode Arb Sepolia",
    url: "https://faucet.quicknode.com/arbitrum/sepolia",
    description: "QuickNode Arbitrum Sepolia faucet",
    canAutoRequest: false,
  },
  "https://www.alchemy.com/faucets/arbitrum-sepolia": {
    label: "Alchemy Arb Sepolia",
    url: "https://www.alchemy.com/faucets/arbitrum-sepolia",
    description: "Alchemy Arbitrum Sepolia faucet — requires login",
    canAutoRequest: false,
  },
  "https://faucets.chain.link/arbitrum-sepolia": {
    label: "Chainlink Arb Sepolia",
    url: "https://faucets.chain.link/arbitrum-sepolia",
    description: "Chainlink faucet for Arbitrum Sepolia",
    canAutoRequest: false,
  },
  "https://bridge.arbitrum.io/?destinationChain=arbitrum-sepolia": {
    label: "Arbitrum Bridge",
    url: "https://bridge.arbitrum.io/?destinationChain=arbitrum-sepolia",
    description: "Arbitrum bridge — Sepolia ETH → Arb Sepolia",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/base/sepolia": {
    label: "QuickNode Base Sepolia",
    url: "https://faucet.quicknode.com/base/sepolia",
    description: "QuickNode Base Sepolia faucet",
    canAutoRequest: false,
  },
  "https://www.alchemy.com/faucets/base-sepolia": {
    label: "Alchemy Base Sepolia",
    url: "https://www.alchemy.com/faucets/base-sepolia",
    description: "Alchemy Base Sepolia faucet — requires login",
    canAutoRequest: false,
  },
  "https://faucets.chain.link/base-sepolia": {
    label: "Chainlink Base Sepolia",
    url: "https://faucets.chain.link/base-sepolia",
    description: "Chainlink faucet for Base Sepolia",
    canAutoRequest: false,
  },
  "https://bridge.base.org": {
    label: "Base Bridge",
    url: "https://bridge.base.org",
    description: "Base bridge — Sepolia ETH → Base Sepolia",
    canAutoRequest: false,
  },
  "https://faucet.polygon.technology": {
    label: "Polygon Official Faucet",
    url: "https://faucet.polygon.technology",
    description: "Official Polygon faucet — 0.5 MATIC",
    canAutoRequest: false,
  },
  "https://faucet.polygon.technology/": {
    label: "Polygon Faucet",
    url: "https://faucet.polygon.technology/",
    description: "Official Polygon faucet — 0.5 MATIC",
    canAutoRequest: false,
  },
  "https://www.alchemy.com/faucets/polygon-mumbai": {
    label: "Alchemy Mumbai Faucet",
    url: "https://www.alchemy.com/faucets/polygon-mumbai",
    description: "Alchemy Polygon Mumbai faucet — requires login",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/polygon/mumbai": {
    label: "QuickNode Mumbai Faucet",
    url: "https://faucet.quicknode.com/polygon/mumbai",
    description: "QuickNode Polygon Mumbai faucet",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/optimism/sepolia": {
    label: "QuickNode Optimism Sepolia",
    url: "https://faucet.quicknode.com/optimism/sepolia",
    description: "QuickNode Optimism Sepolia faucet",
    canAutoRequest: false,
  },
  "https://www.alchemy.com/faucets/optimism-sepolia": {
    label: "Alchemy Optimism Sepolia",
    url: "https://www.alchemy.com/faucets/optimism-sepolia",
    description: "Alchemy Optimism Sepolia faucet — requires login",
    canAutoRequest: false,
  },
  "https://faucet.quicknode.com/scroll": {
    label: "QuickNode Scroll Sepolia",
    url: "https://faucet.quicknode.com/scroll",
    description: "QuickNode Scroll Sepolia faucet",
    canAutoRequest: false,
  },
  "https://sepolia.scroll.io": {
    label: "Scroll Sepolia Faucet",
    url: "https://sepolia.scroll.io",
    description: "Official Scroll Sepolia faucet",
    canAutoRequest: false,
  },
};

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

// ── Auto-Faucet Request ─────────────────────────────────────────────

export interface FaucetRequestResult {
  success: boolean;
  message: string;
  txHash?: string;
}

/**
 * Attempt to auto-request testnet tokens via the pk910.de Sepolia PoW faucet.
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

// ── Faucet Aggregator Integration ────────────────────────────────────

/**
 * "Fund My Wallet" — one-click that opens all web faucets in new tabs
 * and tries API/PoW faucets automatically.
 * Delegates to faucet-aggregator.ts for implementation.
 */
export async function fundWallet(
  address: string,
  chainId: string
): Promise<FaucetResult[]> {
  return aggregatorFundWallet(address, chainId);
}

/**
 * Get faucet results summary for display.
 */
export { getFaucetSummary } from "./faucet-aggregator";
