// ── TRON Wallet — BIP44 Derivation from Autonomous Mnemonic ──────────
// Derives a TRON keypair using BIP44 path m/44'/195'/0'/0/0
// from the platform's autonomous wallet mnemonic.
// Uses tronweb + bip39 + @scure/bip32 for secp256k1 derivation.

import * as bip39 from "bip39";
import { HDKey } from "@scure/bip32";
import { getAutonomousWallet } from "../autonomous-wallet";
import { TronWeb } from "tronweb";

// ── Constants ───────────────────────────────────────────────────────────

const TRON_BIP44_PATH = "m/44'/195'/0'/0/0";

// TRON RPC URLs
const DEFAULT_MAINNET_RPC = "https://api.trongrid.io";
const DEFAULT_SHASTA_RPC = "https://api.shasta.trongrid.io";

// CoinGecko TRX price ID
const TRX_COINGECKO_ID = "tron";

// ── Types ──────────────────────────────────────────────────────────────

export interface TronWalletInfo {
  address: string;
  hexAddress: string;
  balanceTrx: number;
  balanceUsd: number;
  trxPrice: number;
}

// ── In-memory cache ────────────────────────────────────────────────────

let cachedPrivateKey_: string | null = null;
let cachedAddress_: string | null = null;
let cachedHexAddress_: string | null = null;
let cachedTrxPrice: { price: number; ts: number } | null = null;
const PRICE_CACHE_TTL = 30_000; // 30 seconds

// ── Core: Derive TRON Wallet ────────────────────────────────────────────

/**
 * Derive a TRON private key and address from the autonomous wallet's BIP39
 * mnemonic using BIP44 path m/44'/195'/0'/0/0 (secp256k1).
 */
export async function getTronWallet(): Promise<{ privateKey: string; address: string; hexAddress: string }> {
  if (cachedPrivateKey_ && cachedAddress_) {
    return { privateKey: cachedPrivateKey_, address: cachedAddress_, hexAddress: cachedHexAddress_! };
  }

  const aw = await getAutonomousWallet();
  const seed = Buffer.from(await bip39.mnemonicToSeed(aw.mnemonic));
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(TRON_BIP44_PATH);

  if (!child.privateKey) {
    throw new Error("[TronWallet] Failed to derive TRON private key");
  }

  const privKeyHex = Buffer.from(child.privateKey).toString("hex");

  // Create TronWeb instance to derive address from private key
  const tw = new TronWeb({
    fullHost: DEFAULT_MAINNET_RPC,
    privateKey: privKeyHex,
  });

  const address = tw.defaultAddress.base58!;
  const hexAddress = tw.defaultAddress.hex!;

  cachedPrivateKey_ = privKeyHex;
  cachedAddress_ = address;
  cachedHexAddress_ = hexAddress;

  console.log(`[TronWallet] Derived TRON address: ${address}`);
  return { privateKey: privKeyHex, address, hexAddress };
}

/**
 * Get the TRON base58 address derived from the autonomous wallet.
 */
export async function getTronAddress(): Promise<string> {
  if (cachedAddress_) return cachedAddress_;
  const wallet = await getTronWallet();
  return wallet.address;
}

/**
 * Get the TRON hex address derived from the autonomous wallet.
 */
export async function getTronHexAddress(): Promise<string> {
  if (cachedHexAddress_) return cachedHexAddress_;
  const wallet = await getTronWallet();
  return wallet.hexAddress;
}

// ── Balance ─────────────────────────────────────────────────────────────

/**
 * Get TRX balance from the TRON network for the autonomous wallet's address.
 * Fetches on-chain balance + CoinGecko TRX/USD price.
 */
export async function getTronBalance(rpcUrl?: string): Promise<TronWalletInfo> {
  const wallet = await getTronWallet();
  const address = wallet.address;
  const host = rpcUrl ?? getDefaultRpcUrl();

  let balanceTrx = 0;
  try {
    const tw = new TronWeb({ fullHost: host });
    // getBalance returns balance in SUN (1 TRX = 1,000,000 SUN)
    const balanceSun = await tw.trx.getBalance(address);
    balanceTrx = Number(balanceSun) / 1_000_000;
  } catch (err) {
    console.warn("[TronWallet] Failed to fetch on-chain balance:", (err as Error).message);
  }

  const trxPrice = await fetchTrxPrice();
  const balanceUsd = balanceTrx * trxPrice;

  return {
    address,
    hexAddress: wallet.hexAddress,
    balanceTrx,
    balanceUsd,
    trxPrice,
  };
}

// ── TRX Price ───────────────────────────────────────────────────────────

/**
 * Fetch TRX/USD price from CoinGecko with 30s cache.
 */
export async function fetchTrxPrice(): Promise<number> {
  const now = Date.now();
  if (cachedTrxPrice && (now - cachedTrxPrice.ts) < PRICE_CACHE_TTL) {
    return cachedTrxPrice.price;
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${TRX_COINGECKO_ID}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd: number }>;
      const price = data[TRX_COINGECKO_ID]?.usd ?? 0;
      cachedTrxPrice = { price, ts: now };
      return price;
    }
  } catch (err) {
    console.warn("[TronWallet] CoinGecko TRX price fetch failed:", (err as Error).message);
  }

  // Return stale cached price or fallback
  return cachedTrxPrice?.price ?? 0.25; // ~$0.25 fallback
}

// ── RPC Helpers ─────────────────────────────────────────────────────────

/**
 * Get default TRON RPC URL (configurable via env).
 */
function getDefaultRpcUrl(): string {
  return process.env.TRON_RPC_URL ?? DEFAULT_MAINNET_RPC;
}

/**
 * Get TRON Shasta testnet RPC URL.
 */
export function getTronTestnetRpcUrl(): string {
  return process.env.TRON_SHASTA_RPC_URL ?? DEFAULT_SHASTA_RPC;
}

// ── TronWeb Connection ───────────────────────────────────────────────────

/**
 * Create and return a TronWeb instance connected to the given RPC.
 */
export function createTronWeb(rpcUrl?: string): TronWeb {
  return new TronWeb({ fullHost: rpcUrl ?? getDefaultRpcUrl() });
}
