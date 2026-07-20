// ── Cosmos Wallet — BIP44 Derivation from Autonomous Mnemonic ──────
// Derives a Cosmos (ATOM) keypair using BIP44 path m/44'/118'/0'/0/0
// from the platform's autonomous wallet mnemonic.
// Uses bip39 + @scure/bip32 for secp256k1 derivation + manual bech32.
//
// Cosmos Hub (cosmoshub-4), Testnet (theta-testnet-001)

import * as bip39 from "bip39";
import { HDKey } from "@scure/bip32";
import { getAutonomousWallet } from "../autonomous-wallet";
import * as crypto from "node:crypto";

// ── Constants ───────────────────────────────────────────────────────────

const COSMOS_BIP44_PATH = "m/44'/118'/0'/0/0";

// Cosmos REST API endpoints
const DEFAULT_MAINNET_REST = "https://api.cosmos.network";
const DEFAULT_MAINNET_RPC = "https://rpc.cosmos.network";

// CoinGecko ATOM price ID
const ATOM_COINGECKO_ID = "cosmos";

// ── Types ──────────────────────────────────────────────────────────────

export interface CosmosWalletInfo {
  address: string;
  balanceAtom: number;
  balanceUsd: number;
  atomPrice: number;
}

// ── In-memory cache ────────────────────────────────────────────────────

let cachedAddress_: string | null = null;
let cachedAtomPrice: { price: number; ts: number } | null = null;
const PRICE_CACHE_TTL = 30_000; // 30 seconds

// ── Bech32 implementation for Cosmos ─────────────────────────────────────

const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) >> 5);
  }
  result.push(0);
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) & 31);
  }
  return result;
}

function bech32Encode(hrp: string, data: number[]): string {
  const combined = [...bech32HrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...combined, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 31);
  }
  const all = [...data, ...checksum];
  return hrp + "1" + all.map((v) => BECH32_ALPHABET[v]).join("");
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits) {
    throw new Error("Excess padding");
  } else if ((acc << (toBits - bits)) & maxv) {
    throw new Error("Non-zero padding");
  }
  return result;
}

function pubkeyToCosmosAddress(pubkeyBytes: Uint8Array, prefix: string): string {
  // SHA256 of pubkey
  const sha256Hash = crypto.createHash("sha256").update(Buffer.from(pubkeyBytes)).digest();
  // RIPEMD160 of SHA256
  const ripemd160Hash = crypto.createHash("ripemd160").update(sha256Hash).digest();
  // Convert 8-bit to 5-bit words
  const words = convertBits(Array.from(ripemd160Hash), 8, 5, true);
  return bech32Encode(prefix, words);
}

// ── Core: Derive Cosmos Wallet ──────────────────────────────────────────

/**
 * Derive a Cosmos address from the autonomous wallet's BIP39 mnemonic
 * using BIP44 path m/44'/118'/0'/0/0 (secp256k1).
 */
export async function getCosmosWallet(): Promise<{ address: string }> {
  if (cachedAddress_) {
    return { address: cachedAddress_ };
  }

  const aw = await getAutonomousWallet();
  const seed = Buffer.from(await bip39.mnemonicToSeed(aw.mnemonic));
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(COSMOS_BIP44_PATH);

  if (!child.publicKey) {
    throw new Error("[CosmosWallet] Failed to derive Cosmos public key");
  }

  // Get compressed public key (33 bytes: 02/03 prefix + 32-byte x)
  const pubkeyBytes = child.publicKey; // @scure/bip32 returns compressed pubkey
  const address = pubkeyToCosmosAddress(pubkeyBytes, "cosmos");

  cachedAddress_ = address;
  console.log(`[CosmosWallet] Derived Cosmos address: ${address}`);
  return { address };
}

/**
 * Get the Cosmos bech32 address derived from the autonomous wallet.
 */
export async function getCosmosAddress(): Promise<string> {
  if (cachedAddress_) return cachedAddress_;
  const wallet = await getCosmosWallet();
  return wallet.address;
}

// ── Balance ─────────────────────────────────────────────────────────────

/**
 * Get ATOM balance from Cosmos Hub for the autonomous wallet's address.
 * Uses Cosmos REST API + CoinGecko ATOM/USD price.
 */
export async function getCosmosBalance(restUrl?: string): Promise<CosmosWalletInfo> {
  const wallet = await getCosmosWallet();
  const address = wallet.address;
  const baseUrl = restUrl ?? DEFAULT_MAINNET_REST;

  let balanceAtom = 0;
  try {
    const res = await fetch(
      `${baseUrl}/cosmos/bank/v1beta1/balances/${address}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        balances?: Array<{ denom: string; amount: string }>;
      };
      const atomBal = data.balances?.find((b) => b.denom === "uatom");
      if (atomBal) {
        // 1 ATOM = 1,000,000 uatom
        balanceAtom = Number(atomBal.amount) / 1_000_000;
      }
    }
  } catch (err) {
    console.warn("[CosmosWallet] Failed to fetch on-chain balance:", (err as Error).message);
  }

  const atomPrice = await fetchAtomPrice();
  const balanceUsd = balanceAtom * atomPrice;

  return {
    address,
    balanceAtom,
    balanceUsd,
    atomPrice,
  };
}

// ── ATOM Price ───────────────────────────────────────────────────────────

/**
 * Fetch ATOM/USD price from CoinGecko with 30s cache.
 */
export async function fetchAtomPrice(): Promise<number> {
  const now = Date.now();
  if (cachedAtomPrice && (now - cachedAtomPrice.ts) < PRICE_CACHE_TTL) {
    return cachedAtomPrice.price;
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ATOM_COINGECKO_ID}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd: number }>;
      const price = data[ATOM_COINGECKO_ID]?.usd ?? 0;
      cachedAtomPrice = { price, ts: now };
      return price;
    }
  } catch (err) {
    console.warn("[CosmosWallet] CoinGecko ATOM price fetch failed:", (err as Error).message);
  }

  // Return stale cached price or fallback
  return cachedAtomPrice?.price ?? 6.5; // ~$6.50 fallback
}

// ── RPC Helpers ─────────────────────────────────────────────────────────

/**
 * Get default Cosmos REST API URL (configurable via env).
 */
function getDefaultRestUrl(): string {
  return process.env.COSMOS_REST_URL ?? DEFAULT_MAINNET_REST;
}

/**
 * Get default Cosmos RPC URL.
 */
export function getDefaultRpcUrl(): string {
  return process.env.COSMOS_RPC_URL ?? DEFAULT_MAINNET_RPC;
}
