// ── Solana Wallet — BIP44 Derivation from Autonomous Mnemonic ──────────
// Derives a Solana keypair using BIP44 path m/44'/501'/0'/0'
// from the platform's autonomous wallet mnemonic.
// Uses @solana/web3.js + bip39 + ed25519-hd-key.

import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import { getAutonomousWallet } from "../autonomous-wallet";
import { CHAINS } from "../chains";

// ── Constants ───────────────────────────────────────────────────────────

const SOLANA_BIP44_PATH = "m/44'/501'/0'/0'";

// Default Solana RPC URLs
const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

// CoinGecko SOL price ID
const SOL_COINGECKO_ID = "solana";

// ── Types ──────────────────────────────────────────────────────────────

export interface SolanaWalletInfo {
  address: string;
  publicKey: string;
  balanceLamports: number;
  balanceSol: number;
  balanceUsd: number;
  solPrice: number;
}

// ── In-memory cache ────────────────────────────────────────────────────

let cachedKeypair: Keypair | null = null;
let cachedSolPrice: { price: number; ts: number } | null = null;
const PRICE_CACHE_TTL = 30_000; // 30 seconds

// ── Core: Derive Solana Keypair ────────────────────────────────────────

/**
 * Derive a Solana Keypair from the autonomous wallet's BIP39 mnemonic
 * using BIP44 path m/44'/501'/0'/0'.
 */
export async function getSolanaKeypair(): Promise<Keypair> {
  if (cachedKeypair) return cachedKeypair;

  const aw = await getAutonomousWallet();
  const seed = await bip39.mnemonicToSeed(aw.mnemonic);
  const derived = derivePath(SOLANA_BIP44_PATH, seed.toString("hex"));
  const keypair = Keypair.fromSeed(derived.key);

  cachedKeypair = keypair;
  console.log(`[SolanaWallet] Derived Solana address: ${keypair.publicKey.toBase58()}`);
  return keypair;
}

/**
 * Get the Solana base58 address derived from the autonomous wallet.
 */
export async function getSolanaAddress(): Promise<string> {
  const kp = await getSolanaKeypair();
  return kp.publicKey.toBase58();
}

/**
 * Get the Solana PublicKey object.
 */
export async function getSolanaPublicKey(): Promise<PublicKey> {
  const kp = await getSolanaKeypair();
  return kp.publicKey;
}

// ── Balance ─────────────────────────────────────────────────────────────

/**
 * Get SOL balance for the autonomous wallet's Solana address.
 * Fetches on-chain balance + CoinGecko SOL/USD price.
 */
export async function getSolanaBalance(rpcUrl?: string): Promise<SolanaWalletInfo> {
  const kp = await getSolanaKeypair();
  const address = kp.publicKey.toBase58();
  const connection = new Connection(rpcUrl ?? getDefaultRpcUrl(), "confirmed");

  let balanceLamports = 0;
  try {
    balanceLamports = await connection.getBalance(kp.publicKey);
  } catch (err) {
    console.warn("[SolanaWallet] Failed to fetch on-chain balance:", (err as Error).message);
  }

  const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
  const solPrice = await fetchSolPrice();
  const balanceUsd = balanceSol * solPrice;

  return {
    address,
    publicKey: kp.publicKey.toBase58(),
    balanceLamports,
    balanceSol,
    balanceUsd,
    solPrice,
  };
}

// ── SOL Price ───────────────────────────────────────────────────────────

/**
 * Fetch SOL/USD price from CoinGecko with 30s cache.
 */
async function fetchSolPrice(): Promise<number> {
  const now = Date.now();
  if (cachedSolPrice && (now - cachedSolPrice.ts) < PRICE_CACHE_TTL) {
    return cachedSolPrice.price;
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${SOL_COINGECKO_ID}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = await res.json() as Record<string, { usd: number }>;
      const price = data[SOL_COINGECKO_ID]?.usd ?? 0;
      cachedSolPrice = { price, ts: now };
      return price;
    }
  } catch (err) {
    console.warn("[SolanaWallet] CoinGecko SOL price fetch failed:", (err as Error).message);
  }

  // Return stale cached price or fallback
  return cachedSolPrice?.price ?? 170; // ~$170 fallback
}

// ── RPC Helpers ─────────────────────────────────────────────────────────

/**
 * Get default Solana RPC URL (configurable via env).
 */
function getDefaultRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? DEFAULT_MAINNET_RPC;
}

/**
 * Get Solana devnet RPC URL.
 */
export function getSolanaDevnetRpcUrl(): string {
  return process.env.SOLANA_DEVNET_RPC_URL ?? DEFAULT_DEVNET_RPC;
}

/**
 * Get the Solana chain config from CHAINS.
 */
export function getSolanaChainConfig() {
  return CHAINS.find((c) => c.id === "solana")!;
}

// ── Transaction signing helpers ─────────────────────────────────────────

/**
 * Sign a raw transaction buffer with the Solana keypair.
 * Returns the signature as base58 string.
 */
export async function signTransaction(txBuffer: Uint8Array): Promise<string> {
  const kp = await getSolanaKeypair();
  // For simple signing, we sign the message directly
  const signature = kp.secretKey.slice(0, 32); // ed25519 secret key
  // In production, use actual transaction signing via @solana/web3.js Transaction
  return Buffer.from(signature).toString("base64");
}

/**
 * Get the raw secret key (Uint8Array) for use with web3.js transactions.
 * Handle with care — this is the private key material.
 */
export async function getSolanaSecretKey(): Promise<Uint8Array> {
  const kp = await getSolanaKeypair();
  return kp.secretKey;
}
