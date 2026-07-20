// ── Faucet Cooldown Tracker ──────────────────────────────────────────
// Tracks faucet claims per chain with 24h cooldown.
// DB-backed: faucet_claims table.
// Provides countdown timers and auto-claim eligibility checks.

import { sql, isDbAvailable } from "./db";
import { SUPPORTED_CHAINS } from "./chains-config";

export interface FaucetEntry {
  name: string;
  url: string;
  chainId: string;
  available: boolean;
  resetAt: number;  // timestamp when cooldown expires (0 = available now)
}

export interface FaucetClaim {
  faucetName: string;
  chainId: string;
  claimedAt: number;
  resetAt: number;         // 24h after claim
  amount: number;
  txHash?: string;
}

// ── In-memory cache ──────────────────────────────────────────────────

const claims = new Map<string, FaucetClaim>();
// key: `${chainId}:${faucetName}`

const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function claimKey(chainId: string, faucetName: string): string {
  return `${chainId}:${faucetName}`;
}

/** Check if a faucet can be claimed right now */
export function canClaim(faucetName: string, chainId?: string): boolean {
  // Find the claim by faucet name across all chains if chainId not provided
  for (const [key, claim] of claims) {
    if (claim.faucetName === faucetName) {
      if (chainId && claim.chainId !== chainId) continue;
      return Date.now() >= claim.resetAt;
    }
  }
  return true; // never claimed = available
}

/** Get seconds until a faucet resets. Returns 0 if available. */
export function timeUntilReset(faucetName: string, chainId?: string): number {
  for (const [key, claim] of claims) {
    if (claim.faucetName === faucetName) {
      if (chainId && claim.chainId !== chainId) continue;
      const remaining = claim.resetAt - Date.now();
      return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    }
  }
  return 0;
}

/** Record a faucet claim with 24h cooldown */
export function recordClaim(
  faucetName: string,
  chainId: string,
  amount: number,
  txHash?: string,
): FaucetClaim {
  const now = Date.now();
  const claim: FaucetClaim = {
    faucetName,
    chainId,
    claimedAt: now,
    resetAt: now + FAUCET_COOLDOWN_MS,
    amount,
    txHash,
  };
  claims.set(claimKey(chainId, faucetName), claim);
  persistFaucetClaim(claim);
  return claim;
}

/** Get all faucet entries for a chain with availability status */
export function getAvailableFaucets(chainId: string): FaucetEntry[] {
  const cfg = SUPPORTED_CHAINS[chainId];
  if (!cfg?.faucets || !cfg.testnet) return [];

  return cfg.faucets.map((url) => {
    const name = faucetNameFromUrl(url);
    const key = claimKey(chainId, name);
    const existing = claims.get(key);
    const now = Date.now();

    return {
      name,
      url,
      chainId,
      available: !existing || now >= existing.resetAt,
      resetAt: existing ? existing.resetAt : 0,
    };
  });
}

/** Get all faucet entries across all testnet chains */
export function getAllFaucetEntries(): FaucetEntry[] {
  const entries: FaucetEntry[] = [];
  for (const [id, cfg] of Object.entries(SUPPORTED_CHAINS)) {
    if (cfg.testnet && cfg.faucets) {
      entries.push(...getAvailableFaucets(id));
    }
  }
  return entries;
}

/** Get the earliest reset time across all faucets for a chain */
export function getNextResetTime(chainId: string): number {
  let earliest = 0;
  for (const claim of claims.values()) {
    if (claim.chainId === chainId) {
      if (earliest === 0 || claim.resetAt < earliest) {
        earliest = claim.resetAt;
      }
    }
  }
  return earliest;
}

/** Count of available faucets for a chain */
export function countAvailableFaucets(chainId: string): number {
  return getAvailableFaucets(chainId).filter((f) => f.available).length;
}

/** Total faucets for a chain */
export function countTotalFaucets(chainId: string): number {
  const cfg = SUPPORTED_CHAINS[chainId];
  return cfg?.faucets?.length ?? 0;
}

/** Auto-detect and mark passed cooldowns as available */
export function refreshCooldowns(): string[] {
  const now = Date.now();
  const refreshed: string[] = [];
  for (const [key, claim] of claims) {
    if (now >= claim.resetAt) {
      claims.delete(key);
      refreshed.push(key);
    }
  }
  return refreshed;
}

// ── Helpers ──────────────────────────────────────────────────────────

function faucetNameFromUrl(url: string): string {
  // Extract a friendly name from the faucet URL
  if (url.includes("alchemy.com")) return "Alchemy";
  if (url.includes("quicknode.com")) return "QuickNode";
  if (url.includes("google") || url.includes("cloud.google.com")) return "Google";
  if (url.includes("chain.link")) return "Chainlink";
  if (url.includes("pk910")) return "pk910";
  if (url.includes("polygon.technology")) return "Polygon";
  if (url.includes("scroll.io") || url.includes("scroll")) return "Scroll";
  if (url.includes("bridge")) return "Bridge";
  if (url.includes("sepoliafaucet.com")) return "SepoliaFaucet";
  // Default: extract hostname
  try {
    const host = new URL(url).hostname.replace("www.", "");
    return host.split(".")[0];
  } catch {
    return url.slice(0, 12);
  }
}

// ── DB Persistence ───────────────────────────────────────────────────

async function persistFaucetClaim(claim: FaucetClaim): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    await sql`
      INSERT INTO faucet_claims (faucet_name, chain_id, claimed_at, reset_at, amount, tx_hash)
      VALUES (${claim.faucetName}, ${claim.chainId}, ${claim.claimedAt},
        ${claim.resetAt}, ${claim.amount}, ${claim.txHash ?? null})
    `;
  } catch (err) {
    console.warn("[FaucetCooldown] persist failed:", err);
  }
}

/** Load claims from DB into memory */
export async function loadFaucetClaimsFromDb(): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    const result = await sql.query(
      "SELECT * FROM faucet_claims WHERE reset_at > extract(epoch from now()) * 1000"
    );
    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      const claim: FaucetClaim = {
        faucetName: r.faucet_name as string,
        chainId: r.chain_id as string,
        claimedAt: (r.claimed_at as number) ?? 0,
        resetAt: (r.reset_at as number) ?? 0,
        amount: (r.amount as number) ?? 0,
        txHash: r.tx_hash as string | undefined,
      };
      claims.set(claimKey(claim.chainId, claim.faucetName), claim);
    }
    console.log(`[FaucetCooldown] Loaded ${result.rows.length} active claims from DB`);
  } catch (err) {
    console.warn("[FaucetCooldown] loadFromDb failed:", err);
  }
}
