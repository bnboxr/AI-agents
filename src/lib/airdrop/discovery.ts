// Protocol discovery — fetches from DefiLlama, scores, and caches top protocols
import { agentBus } from "../agent-bus";
import type { AirdropProtocol } from "./types";

// ── In-memory state ─────────────────────────────────────────────────

let cachedProtocols: AirdropProtocol[] = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Categories we care about ────────────────────────────────────────

const TARGET_CATEGORIES = new Set([
  "Dexes",
  "Lending",
  "Bridge",
  "Yield",
  "CDP",
]);

// ── L2 chains for scoring boost ─────────────────────────────────────

const L2_CHAINS = new Set([
  "Arbitrum",
  "Optimism",
  "Base",
  "Polygon",
  "zkSync Era",
  "Linea",
  "Scroll",
  "Mantle",
  "StarkNet",
]);

// ── DefiLlama raw protocol shape ────────────────────────────────────

interface DefiLlamaProtocol {
  name: string;
  category: string;
  chain: string;
  tvl: number;
  change_7d: number;
  symbol: string;
  audits: string;
  slug: string;
  url: string;
  chains: string[];
  listedAt: number;
}

// ── Bus emit helper (event type added in Phase 3) ────────────────────

interface BusLike {
  emit(event: string, payload: unknown): void;
}
const bus = agentBus as unknown as BusLike;

// ── Public API ──────────────────────────────────────────────────────

/** Fetch all protocols from DefiLlama, with 4-hour in-memory cache */
export async function fetchProtocols(): Promise<DefiLlamaProtocol[]> {
  const now = Date.now();
  if (cachedProtocols.length > 0 && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedProtocols as unknown as DefiLlamaProtocol[];
  }

  try {
    const response = await fetch("https://api.llama.fi/protocols", {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`[Airdrop] DefiLlama fetch failed: ${response.status}`);
      return [];
    }

    const data: DefiLlamaProtocol[] = await response.json();
    // Cache the raw data
    cachedProtocols = data as unknown as AirdropProtocol[];
    lastFetchTime = now;

    return data;
  } catch (err) {
    console.error("[Airdrop] DefiLlama fetch error:", err);
    return [];
  }
}

/**
 * Score a protocol (0-100).
 * Components:
 *   - log-TVL:          0-30
 *   - no token:         0-25
 *   - L2:               0-15
 *   - audits:           0-10
 *   - 7d growth:        0-10
 *   - age (inverted):   0-10
 */
export function scoreProtocol(p: DefiLlamaProtocol): number {
  // TVL score: log10(tvl) normalized, max at ~$100B => log10(1e11) ≈ 11.04
  const logTvl = Math.log10(Math.max(p.tvl, 1));
  const tvlScore = Math.min(30, (logTvl / 11) * 30);

  // No token bonus: if no symbol, protocol hasn't launched a token yet
  const hasToken = p.symbol && p.symbol !== "-" && p.symbol.length > 0;
  const noTokenScore = hasToken ? 0 : 25;

  // L2 bonus
  const isL2 = p.chains.some((c) => L2_CHAINS.has(c));
  const l2Score = isL2 ? 15 : 0;

  // Audit score: 2.5 points per audit, max 10
  const auditCount = parseInt(p.audits, 10) || 0;
  const auditScore = Math.min(10, auditCount * 2.5);

  // 7d growth: cap at ±30%, normalize to 0-10
  const growth = Math.max(-30, Math.min(30, p.change_7d ?? 0));
  const growthScore = ((growth + 30) / 60) * 10;

  // Age (inverted): older protocols get less score (they're less likely to airdrop)
  const ageDays = p.listedAt
    ? Math.floor((Date.now() / 1000 - p.listedAt) / 86400)
    : 365 * 3;
  const ageScore = ageDays < 30 ? 10 : ageDays < 180 ? 8 : ageDays < 365 ? 5 : ageDays < 730 ? 3 : 1;

  return Math.round(tvlScore + noTokenScore + l2Score + auditScore + growthScore + ageScore);
}

/**
 * Convert a DefiLlama protocol to an AirdropProtocol with computed score.
 */
function toAirdropProtocol(p: DefiLlamaProtocol): AirdropProtocol {
  const hasToken = !!(p.symbol && p.symbol !== "-" && p.symbol.length > 0);
  return {
    id: p.slug || p.name.toLowerCase().replace(/\s+/g, "-"),
    name: p.name,
    category: p.category,
    chain: p.chain,
    tvl: p.tvl,
    hasToken,
    audits: parseInt(p.audits, 10) || 0,
    ageDays: p.listedAt
      ? Math.floor((Date.now() / 1000 - p.listedAt) / 86400)
      : 365 * 3,
    score: scoreProtocol(p),
    change7d: p.change_7d ?? 0,
    slug: p.slug,
    url: p.url,
  };
}

/**
 * Get the top N protocols sorted by score, meeting safety thresholds.
 */
export async function getTopProtocols(count = 30): Promise<AirdropProtocol[]> {
  const raw = await fetchProtocols();
  if (raw.length === 0) return [];

  const MIN_TVL = 10_000_000; // $10M
  const MIN_AGE_DAYS = 60;
  const MIN_AUDITS = 1;

  const scored: AirdropProtocol[] = [];

  for (const p of raw) {
    // Category filter
    if (!TARGET_CATEGORIES.has(p.category)) continue;

    // Safety thresholds
    if (p.tvl < MIN_TVL) continue;
    const ageDays = p.listedAt
      ? Math.floor((Date.now() / 1000 - p.listedAt) / 86400)
      : 365 * 3;
    if (ageDays < MIN_AGE_DAYS) continue;
    const audits = parseInt(p.audits, 10) || 0;
    if (audits < MIN_AUDITS) continue;

    scored.push(toAirdropProtocol(p));
  }

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count);
}

/**
 * Main entry point — called by the orchestrator.
 * Updates in-memory protocol list and emits on the agent bus.
 */
export async function discoverProtocols(): Promise<AirdropProtocol[]> {
  const protocols = await getTopProtocols(30);

  // Emit discovery event on the bus (event type added in Phase 3)
  bus.emit("airdrop_protocols_discovered", {
    count: protocols.length,
    topProtocols: protocols.slice(0, 5).map((p) => ({ id: p.id, name: p.name, score: p.score })),
    timestamp: Date.now(),
  });

  console.log(`[Airdrop] Discovered ${protocols.length} protocols`);
  return protocols;
}
