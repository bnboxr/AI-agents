// Wallet management — BIP-44 derivation, state tracking, gas funding
import { HDNodeWallet } from "ethers";
import type { AirdropWallet, WalletChainState } from "./types";

// ── In-memory state ─────────────────────────────────────────────────

const wallets: Map<number, AirdropWallet> = new Map();

// ── Gas thresholds (in native token) per chain ──────────────────────

export const MIN_GAS: Record<string, string> = {
  ethereum: "0.01",
  arbitrum: "0.005",
  optimism: "0.005",
  base: "0.005",
  polygon: "5",
  bnb: "0.05",
  avalanche: "0.1",
  fantom: "1",
  gnosis: "0.1",
  zksync: "0.005",
};

const DEFAULT_MIN_GAS = "0.005";

function getMinGas(chainId: string): string {
  return MIN_GAS[chainId] ?? DEFAULT_MIN_GAS;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Derive wallets from a BIP-39 seed phrase using BIP-44 path m/44'/60'/0'/0/{index}.
 * Returns array of { address, privateKey }.
 */
export function deriveWallets(
  seed: string,
  count: number,
): { address: string; privateKey: string }[] {
  const results: { address: string; privateKey: string }[] = [];

  for (let i = 0; i < count; i++) {
    const path = `m/44'/60'/0'/0/${i}`;
    const wallet = HDNodeWallet.fromPhrase(seed, undefined, path);
    results.push({
      address: wallet.address,
      privateKey: wallet.privateKey,
    });
  }

  return results;
}

/**
 * Initialize all wallets from seed and store in memory.
 * Wallet #0 is the funding master.
 */
export function initWallets(seed: string, count: number): void {
  wallets.clear();
  const derived = deriveWallets(seed, count);

  for (let i = 0; i < derived.length; i++) {
    wallets.set(i, {
      index: i,
      address: derived[i].address,
      privateKey: derived[i].privateKey,
      chains: new Map(),
    });
  }

  console.log(`[Airdrop] Initialized ${derived.length} wallets (master: ${derived[0]?.address ?? "N/A"})`);
}

/**
 * Get cached wallet state, or initialize a fresh state if not present.
 */
export function getWalletState(index: number): AirdropWallet | undefined {
  return wallets.get(index);
}

/**
 * Get or initialize chain-specific state for a wallet.
 */
export function getWalletChainState(
  index: number,
  chainId: string,
): WalletChainState | undefined {
  const wallet = wallets.get(index);
  if (!wallet) return undefined;

  if (!wallet.chains.has(chainId)) {
    wallet.chains.set(chainId, {
      chainId,
      nonce: 0,
      balance: "0",
      lastInteraction: 0,
      totalGasSpent: "0",
    });
  }

  return wallet.chains.get(chainId);
}

/**
 * Check if a wallet needs gas funding on a specific chain.
 * Returns true if balance is below the minimum gas threshold.
 */
export function needsGasFunding(index: number, chainId: string): boolean {
  const state = getWalletChainState(index, chainId);
  if (!state) return false;

  const minGas = getMinGas(chainId);
  try {
    return parseFloat(state.balance) < parseFloat(minGas);
  } catch {
    return true;
  }
}

/**
 * Update wallet state after a transaction.
 */
export function updateWalletAfterTx(
  index: number,
  chainId: string,
  tx: { gasUsed: string; effectiveGasPrice: string },
): void {
  const state = getWalletChainState(index, chainId);
  if (!state) return;

  state.nonce += 1;
  state.lastInteraction = Date.now();

  try {
    const gasCost = parseFloat(tx.gasUsed) * parseFloat(tx.effectiveGasPrice) / 1e18;
    const currentGas = parseFloat(state.totalGasSpent);
    state.totalGasSpent = (currentGas + gasCost).toString();
  } catch {
    // ignore parse errors
  }
}

/**
 * Get the next available wallet on a chain (lowest pending tx count).
 * Currently returns the first wallet; pending tx tracking is added in Phase 2.
 */
export function getNextAvailableWallet(chainId: string): AirdropWallet | undefined {
  let best: AirdropWallet | undefined;
  let bestNonce = Infinity;

  for (const wallet of wallets.values()) {
    const state = wallet.chains.get(chainId);
    const nonce = state?.nonce ?? 0;
    if (nonce < bestNonce) {
      bestNonce = nonce;
      best = wallet;
    }
  }

  return best;
}

/**
 * Get all initialized wallets.
 */
export function getAllWallets(): AirdropWallet[] {
  return Array.from(wallets.values());
}

/**
 * Get wallet count.
 */
export function getWalletCount(): number {
  return wallets.size;
}

/**
 * Get the master (funding) wallet.
 */
export function getMasterWallet(): AirdropWallet | undefined {
  return wallets.get(0);
}

/**
 * Get all wallet addresses.
 */
export function getAllAddresses(): string[] {
  return Array.from(wallets.values()).map((w) => w.address);
}
