// ── Multi-Chain Wallet Aggregator ───────────────────────────────────
// Derives ALL chain addresses from the single autonomous wallet
// BIP39 mnemonic via BIP44 paths. One seed → many chains.
//
// Chains: Ethereum, Solana, XRP, TRON, Cosmos

import { getAutonomousWallet } from "./autonomous-wallet";
import {
  getSolanaAddress,
  getSolanaBalance,
} from "./chains/solana-wallet";
import {
  getXrpAddress,
  getXrpBalance,
} from "./chains/xrp-wallet";
import {
  getTronAddress,
  getTronBalance,
} from "./chains/tron-wallet";
import {
  getCosmosAddress,
  getCosmosBalance,
} from "./chains/cosmos-wallet";

// ── Types ──────────────────────────────────────────────────────────

export interface ChainAddressEntry {
  chain: string;
  chainId: string;
  icon: string;
  address: string;
  balance: number;
  balanceUsd: number;
  nativeSymbol: string;
  error?: string;
}

// ── Addresses (fast — no external API calls) ────────────────────────

/**
 * Get all chain addresses derived from the autonomous wallet mnemonic.
 * Fast — no external API calls. Use for initial page load.
 */
export async function getAllChainAddresses(): Promise<ChainAddressEntry[]> {
  const aw = await getAutonomousWallet();

  const entries: ChainAddressEntry[] = [
    {
      chain: "Ethereum",
      chainId: "ethereum",
      icon: "⟠",
      address: aw.address,
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "ETH",
    },
  ];

  // Solana
  try {
    const addr = await getSolanaAddress();
    entries.push({
      chain: "Solana",
      chainId: "solana",
      icon: "◎",
      address: addr,
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "SOL",
    });
  } catch (err) {
    entries.push({
      chain: "Solana",
      chainId: "solana",
      icon: "◎",
      address: "—",
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "SOL",
      error: (err as Error).message,
    });
  }

  // XRP
  try {
    const addr = await getXrpAddress();
    entries.push({
      chain: "XRP",
      chainId: "xrp",
      icon: "❌",
      address: addr,
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "XRP",
    });
  } catch (err) {
    entries.push({
      chain: "XRP",
      chainId: "xrp",
      icon: "❌",
      address: "—",
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "XRP",
      error: (err as Error).message,
    });
  }

  // TRON
  try {
    const addr = await getTronAddress();
    entries.push({
      chain: "TRON",
      chainId: "tron",
      icon: "🔷",
      address: addr,
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "TRX",
    });
  } catch (err) {
    entries.push({
      chain: "TRON",
      chainId: "tron",
      icon: "🔷",
      address: "—",
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "TRX",
      error: (err as Error).message,
    });
  }

  // Cosmos
  try {
    const addr = await getCosmosAddress();
    entries.push({
      chain: "Cosmos",
      chainId: "cosmos",
      icon: "⚛️",
      address: addr,
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "ATOM",
    });
  } catch (err) {
    entries.push({
      chain: "Cosmos",
      chainId: "cosmos",
      icon: "⚛️",
      address: "—",
      balance: 0,
      balanceUsd: 0,
      nativeSymbol: "ATOM",
      error: (err as Error).message,
    });
  }

  return entries;
}

// ── Balances (slow — hits external RPC/API) ────────────────────────

/**
 * Fetch on-chain balances for all chains in parallel.
 * Returns an updated array of entries with balance data filled in.
 * Each balance call is individually caught — one failing won't block others.
 */
export async function fetchAllChainBalances(
  entries: ChainAddressEntry[],
): Promise<ChainAddressEntry[]> {
  const updated = entries.map((e) => ({ ...e }));

  // Fire all balance requests in parallel, each with its own catch
  const promises = updated.map(async (entry) => {
    try {
      switch (entry.chainId) {
        case "solana": {
          const info = await getSolanaBalance();
          entry.balance = info.balanceSol;
          entry.balanceUsd = info.balanceUsd;
          break;
        }
        case "xrp": {
          const info = await getXrpBalance();
          entry.balance = info.balanceXrp;
          entry.balanceUsd = info.balanceUsd;
          break;
        }
        case "tron": {
          const info = await getTronBalance();
          entry.balance = info.balanceTrx;
          entry.balanceUsd = info.balanceUsd;
          break;
        }
        case "cosmos": {
          const info = await getCosmosBalance();
          entry.balance = info.balanceAtom;
          entry.balanceUsd = info.balanceUsd;
          break;
        }
        // Ethereum balance is handled separately via getAutonomousWalletPublic
        default:
          break;
      }
    } catch (err) {
      entry.error = (err as Error).message;
    }
  });

  await Promise.allSettled(promises);
  return updated;
}
