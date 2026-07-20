// ── XRP Wallet — BIP44 Derivation from Autonomous Mnemonic ──────────
// Derives an XRP keypair using BIP44 path m/44'/144'/0'/0/0
// from the platform's autonomous wallet mnemonic.
// Uses xrpl.js + bip39 + @scure/bip32 for secp256k1 derivation.

import * as bip39 from "bip39";
import { HDKey } from "@scure/bip32";
import { getAutonomousWallet } from "../autonomous-wallet";

// ── xrpl lazy-load: avoid top-level import (xrpl → @scure/bip32 ESM crashes Bun SSR) ──

interface XrplWallet {
  classicAddress: string;
  seed?: string;
}

interface XrplClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  request(req: Record<string, unknown>): Promise<{ result: Record<string, unknown> }>;
}

interface XrplModule {
  Wallet: { fromSeed(seed: string): XrplWallet };
  Client: new (url: string) => XrplClient;
}

let _xrplModule: XrplModule | null = null;

async function loadXrpl(): Promise<XrplModule> {
  if (_xrplModule) return _xrplModule;
  _xrplModule = (await import("xrpl")) as unknown as XrplModule;
  return _xrplModule;
}

// ── Constants ───────────────────────────────────────────────────────────

const XRP_BIP44_PATH = "m/44'/144'/0'/0/0";

// XRPL RPC URLs (WebSocket)
const DEFAULT_MAINNET_RPC = "wss://s1.ripple.com";
const DEFAULT_TESTNET_RPC = "wss://s.altnet.rippletest.net:51233";

// CoinGecko XRP price ID
const XRP_COINGECKO_ID = "ripple";

// ── Types ──────────────────────────────────────────────────────────────

export interface XrpWalletInfo {
  address: string;
  classicAddress: string;
  balanceXrp: number;
  balanceUsd: number;
  xrpPrice: number;
}

// ── In-memory cache ────────────────────────────────────────────────────

let cachedWallet_: XrplWallet | null = null;
let cachedAddress_: string | null = null;
let cachedXrpPrice: { price: number; ts: number } | null = null;
const PRICE_CACHE_TTL = 30_000; // 30 seconds

// ── Core: Derive XRP Wallet ────────────────────────────────────────────

/**
 * Derive an XRP Wallet from the autonomous wallet's BIP39 mnemonic
 * using BIP44 path m/44'/144'/0'/0/0 (secp256k1).
 */
export async function getXrpWallet(): Promise<XrplWallet> {
  if (cachedWallet_) return cachedWallet_;

  const aw = await getAutonomousWallet();
  const seed = Buffer.from(await bip39.mnemonicToSeed(aw.mnemonic));
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(XRP_BIP44_PATH);

  if (!child.privateKey) {
    throw new Error("[XrpWallet] Failed to derive XRP private key");
  }

  const privKeyHex = Buffer.from(child.privateKey).toString("hex").toUpperCase();
  const { Wallet } = await loadXrpl();
  const wallet = Wallet.fromSeed(privKeyHex);

  cachedWallet_ = wallet;
  cachedAddress_ = wallet.classicAddress;
  console.log(`[XrpWallet] Derived XRP address: ${wallet.classicAddress}`);
  return wallet;
}

/**
 * Get the XRP classic address derived from the autonomous wallet.
 */
export async function getXrpAddress(): Promise<string> {
  if (cachedAddress_) return cachedAddress_;
  const wallet = await getXrpWallet();
  return wallet.classicAddress;
}

// ── Balance ─────────────────────────────────────────────────────────────

/**
 * Get XRP balance from the XRP Ledger for the autonomous wallet's address.
 * Fetches on-chain balance + CoinGecko XRP/USD price.
 */
export async function getXrpBalance(rpcUrl?: string): Promise<XrpWalletInfo> {
  const wallet = await getXrpWallet();
  const address = wallet.classicAddress;

  const { Client } = await loadXrpl();
  const client = new Client(rpcUrl ?? getDefaultRpcUrl());

  let balanceXrp = 0;
  try {
    await client.connect();
    const response = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    // Balance is returned in drops (1 XRP = 1,000,000 drops)
    const balanceDrops = (response.result as Record<string, unknown>).account_data as Record<string, string>;
    if (balanceDrops?.Balance) {
      balanceXrp = Number(balanceDrops.Balance) / 1_000_000;
    }
  } catch (err) {
    console.warn("[XrpWallet] Failed to fetch on-chain balance:", (err as Error).message);
  } finally {
    try { await client.disconnect(); } catch { /* ignore */ }
  }

  const xrpPrice = await fetchXrpPrice();
  const balanceUsd = balanceXrp * xrpPrice;

  return {
    address,
    classicAddress: address,
    balanceXrp,
    balanceUsd,
    xrpPrice,
  };
}

// ── XRP Price ───────────────────────────────────────────────────────────

/**
 * Fetch XRP/USD price from CoinGecko with 30s cache.
 */
export async function fetchXrpPrice(): Promise<number> {
  const now = Date.now();
  if (cachedXrpPrice && (now - cachedXrpPrice.ts) < PRICE_CACHE_TTL) {
    return cachedXrpPrice.price;
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${XRP_COINGECKO_ID}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd: number }>;
      const price = data[XRP_COINGECKO_ID]?.usd ?? 0;
      cachedXrpPrice = { price, ts: now };
      return price;
    }
  } catch (err) {
    console.warn("[XrpWallet] CoinGecko XRP price fetch failed:", (err as Error).message);
  }

  // Return stale cached price or fallback
  return cachedXrpPrice?.price ?? 0.55; // ~$0.55 fallback
}

// ── RPC Helpers ─────────────────────────────────────────────────────────

/**
 * Get default XRP RPC URL (configurable via env).
 */
function getDefaultRpcUrl(): string {
  return process.env.XRP_RPC_URL ?? DEFAULT_MAINNET_RPC;
}

/**
 * Get XRP testnet RPC URL.
 */
export function getXrpTestnetRpcUrl(): string {
  return process.env.XRP_TESTNET_RPC_URL ?? DEFAULT_TESTNET_RPC;
}

// ── XRPL Connection ─────────────────────────────────────────────────────

/**
 * Create and return a connected XRPL Client.
 * Caller must disconnect when done.
 */
export async function connectXrpl(rpcUrl?: string): Promise<XrplClient> {
  const { Client } = await loadXrpl();
  const client = new Client(rpcUrl ?? getDefaultRpcUrl());
  await client.connect();
  return client;
}
