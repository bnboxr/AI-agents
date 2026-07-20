// ── Autonomous Wallet Generator ─────────────────────────────────────
// Generates a BIP39 mnemonic, derives HD wallet, stores encrypted in DB.
// Generated ONCE — subsequent calls return the existing wallet.
// Uses ethers v6. Private key encrypted with AES-256-GCM using a
// platform-derived key from AUTONOMOUS_WALLET_SECRET env var.

import { ethers } from "ethers";
import crypto from "node:crypto";
import { sql, isDbAvailable } from "./db";
import { runMigrations } from "./db/migrations";

// ── Types ──────────────────────────────────────────────────────────

export interface AutonomousWallet {
  address: string;
  publicKey: string;
  mnemonic: string;
  privateKey: string;
}

export interface AutonomousWalletPublic {
  address: string;
  publicKey: string;
  chain: string;
  balance: string;
}

// ── Encryption helpers ─────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.AUTONOMOUS_WALLET_SECRET;
  if (!secret) {
    // Derive a deterministic key from a platform constant
    // In production, this should be set via env var
    const fallback = "hsmic-autonomous-wallet-platform-key-2026";
    return crypto.createHash("sha256").update(fallback).digest();
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── In-memory cache ────────────────────────────────────────────────

let cachedWallet: AutonomousWallet | null = null;
let initialized = false;

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Generate a new BIP39 wallet. Only called once — subsequent calls
 * return the cached/existing wallet from DB.
 */
export async function getAutonomousWallet(): Promise<AutonomousWallet> {
  if (cachedWallet) return cachedWallet;

  // Try to load from DB first
  if (isDbAvailable()) {
    await runMigrations();
    try {
      const result = await sql.query(
        "SELECT address, mnemonic_encrypted, private_key_encrypted FROM autonomous_wallet ORDER BY created_at DESC LIMIT 1",
      );
      if (result.rows.length > 0) {
        const row = result.rows[0] as Record<string, unknown>;
        const address = row.address as string;
        const mnemonicEncrypted = row.mnemonic_encrypted as string;
        const privateKeyEncrypted = row.private_key_encrypted as string;

        const mnemonic = decrypt(mnemonicEncrypted);
        const privateKey = decrypt(privateKeyEncrypted);

        // Derive public key from private key
        const wallet = new ethers.Wallet(privateKey);
        const publicKey = wallet.signingKey.publicKey;

        cachedWallet = { address, publicKey, mnemonic, privateKey };
        console.log(`[AutonomousWallet] Loaded existing wallet ${address} from DB`);
        return cachedWallet;
      }
    } catch (err) {
      console.warn("[AutonomousWallet] Failed to load from DB, will generate new:", (err as Error).message);
    }
  }

  // Generate new wallet
  const mnemonicEntropy = ethers.randomBytes(16); // 128 bits = 12 words
  const mnemonic = ethers.Mnemonic.fromEntropy(mnemonicEntropy).phrase;
  const wallet = ethers.Wallet.fromPhrase(mnemonic);
  const address = wallet.address;
  const privateKey = wallet.privateKey;
  const publicKey = wallet.signingKey.publicKey;

  console.log(`[AutonomousWallet] Generated new wallet: ${address}`);

  // Save to DB
  if (isDbAvailable()) {
    try {
      const mnemonicEncrypted = encrypt(mnemonic);
      const privateKeyEncrypted = encrypt(privateKey);
      await sql`
        INSERT INTO autonomous_wallet (address, mnemonic_encrypted, private_key_encrypted, created_at)
        VALUES (${address}, ${mnemonicEncrypted}, ${privateKeyEncrypted}, now())
      `;
      console.log("[AutonomousWallet] Saved encrypted wallet to DB");
    } catch (err) {
      console.warn("[AutonomousWallet] Failed to save to DB:", (err as Error).message);
    }
  }

  cachedWallet = { address, publicKey, mnemonic, privateKey };
  return cachedWallet;
}

/**
 * Get the wallet seed phrase (decrypted). Requires confirmation context.
 * Only call from authenticated server contexts.
 */
export async function revealSeedPhrase(): Promise<string> {
  const wallet = await getAutonomousWallet();
  return wallet.mnemonic;
}

/**
 * Get the wallet private key (decrypted). Requires confirmation context.
 * Only call from authenticated server contexts.
 */
export async function revealPrivateKey(): Promise<string> {
  const wallet = await getAutonomousWallet();
  return wallet.privateKey;
}

/**
 * Get public info about the autonomous wallet.
 */
export async function getAutonomousWalletPublic(): Promise<AutonomousWalletPublic> {
  const wallet = await getAutonomousWallet();
  return {
    address: wallet.address,
    publicKey: wallet.publicKey,
    chain: "Ethereum",
    balance: "0", // Will be populated by balance checker
  };
}

/**
 * Initialize the wallet on first access. Idempotent.
 */
export async function initAutonomousWallet(): Promise<void> {
  if (initialized) return;
  await getAutonomousWallet();
  initialized = true;
}

/**
 * Get the private key for use by farmer/execution agents.
 * Returns undefined if wallet hasn't been generated yet or there's no DB.
 */
export async function getAutonomousPrivateKey(): Promise<string | undefined> {
  try {
    const wallet = await getAutonomousWallet();
    return wallet.privateKey;
  } catch {
    return undefined;
  }
}
