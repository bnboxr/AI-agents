// ── NFT Arbitrage Scanner ──────────────────────────────────────
// Cross-marketplace price scanner for NFT arbitrage opportunities.
// Uses deterministic seeded random for reproducible simulation data
// when no live marketplace data is available.
//
// Marketplaces: OpenSea, Blur, LooksRare.

import { seededRandom, seededRandomInt, seededPick } from "~/lib/deterministic-random";

// ── Types ──────────────────────────────────────────────────────

export interface NFTCollection {
  slug: string;
  name: string;
  floorPrice: number;       // ETH
  volume24h: number;        // ETH
  volume7d: number;         // ETH
  marketCap: number;        // ETH
  owners: number;
  totalSupply: number;
  percentChange24h: number;
  trend: "up" | "down" | "flat";
  category: "pfp" | "art" | "gaming" | "metaverse" | "utility";
}

export interface NFTArbitrageOpportunity {
  id: string;
  collection: string;
  tokenId: string;
  buyMarketplace: "opensea" | "blur" | "looksrare";
  buyPrice: number;         // ETH
  sellMarketplace: "opensea" | "blur" | "looksrare";
  sellPrice: number;        // ETH
  spread: number;           // ETH
  spreadPct: number;        // %
  estimatedGas: number;     // ETH
  netProfit: number;        // ETH (after gas + fees)
  foundAt: number;
  expiresAt: number;        // opportunity expires quickly
}

export interface NFTArbitrageState {
  collections: NFTCollection[];
  opportunities: NFTArbitrageOpportunity[];
  totalScanned: number;
  totalOpportunities: number;
  paperTrades: PaperNFTTrade[];
  lastUpdate: number;
  paperMode: boolean;
}

export interface PaperNFTTrade {
  id: string;
  collection: string;
  tokenId: string;
  buyMarketplace: string;
  buyPrice: number;
  sellMarketplace: string;
  sellPrice: number;
  profit: number;           // ETH
  executedAt: number;
  status: "completed" | "pending" | "failed";
}

// TODO: Fetch real NFT floor prices from Reservoir API (reservoir.tools)

const TOP_COLLECTIONS: NFTCollection[] = [];

const MARKETPLACES = ["opensea", "blur", "looksrare"] as const;

// Marketplace fee rates
const MP_FEES: Record<string, number> = {
  opensea: 0.025,    // 2.5%
  blur: 0.005,       // 0.5%
  looksrare: 0.02,   // 2%
};

// ── In-memory state ──────────────────────────────────────────

let _state: NFTArbitrageState = {
  collections: TOP_COLLECTIONS.map((c) => ({ ...c })),
  opportunities: [],
  totalScanned: 0,
  totalOpportunities: 0,
  paperTrades: [],
  lastUpdate: Date.now(),
  paperMode: !(typeof process !== "undefined" && process.env?.RESERVOIR_API_KEY),
};

// ── Internal helpers ──────────────────────────────────────────

function generateOpportunity(collection: NFTCollection): NFTArbitrageOpportunity | null {
  const seed = collection.slug + "-" + Date.now();
  const buyMp = seededPick(seed + "-bm", MARKETPLACES);
  let sellMp: typeof buyMp;
  do {
    sellMp = seededPick(seed + "-sm" + sellMp, MARKETPLACES);
  } while (sellMp === buyMp);

  const floor = collection.floorPrice;
  // Simulate price differences between marketplaces (deterministic)
  const buyPrice = floor * (0.93 + seededRandom(seed + "-bp") * 0.06);
  const sellPrice = floor * (1.01 + seededRandom(seed + "-sp") * 0.07);

  const spread = sellPrice - buyPrice;
  const spreadPct = (spread / buyPrice) * 100;

  const estimatedGas = 0.002 + seededRandom(seed + "-gas") * 0.008;
  const buyFee = buyPrice * MP_FEES[buyMp];
  const sellFee = sellPrice * MP_FEES[sellMp];
  const netProfit = spread - buyFee - sellFee - estimatedGas;

  if (netProfit <= 0) return null;

  const now = Date.now();
  return {
    id: `arb-${now}-${collection.slug}`,
    collection: collection.slug,
    tokenId: `#${seededRandomInt(seed + "-tid", 1, collection.totalSupply + 1)}`,
    buyMarketplace: buyMp,
    buyPrice: +buyPrice.toFixed(4),
    sellMarketplace: sellMp,
    sellPrice: +sellPrice.toFixed(4),
    spread: +spread.toFixed(4),
    spreadPct: +spreadPct.toFixed(2),
    estimatedGas: +estimatedGas.toFixed(4),
    netProfit: +netProfit.toFixed(4),
    foundAt: now,
    expiresAt: now + 5 * 60 * 1000,
  };
}

// ── Public API ────────────────────────────────────────────────

/**
 * Scan for NFT arbitrage opportunities across marketplaces.
 */
export function scanArbitrage(collectionSlug?: string): NFTArbitrageOpportunity[] {
  const now = Date.now();

  // Clear expired opportunities
  _state.opportunities = _state.opportunities.filter((o) => o.expiresAt > now);

  const targets = collectionSlug
    ? _state.collections.filter((c) => c.slug === collectionSlug)
    : _state.collections;

  // Return early if no collections are configured
  if (targets.length === 0) {
    _state.lastUpdate = now;
    return [];
  }

  _state.totalScanned++;

  const newOpps: NFTArbitrageOpportunity[] = [];

  for (const col of targets) {
    const count = seededRandomInt(col.slug + "-scan-" + _state.totalScanned, 1, 4);
    for (let i = 0; i < count; i++) {
      const opp = generateOpportunity(col);
      if (opp) newOpps.push(opp);
    }
  }

  _state.opportunities = [...newOpps, ..._state.opportunities].slice(0, 50);
  _state.totalOpportunities += newOpps.length;
  _state.lastUpdate = now;

  return _state.opportunities;
}

/**
 * Get trending collections sorted by volume.
 */
export function getTopCollections(limit = 10): NFTCollection[] {
  // Refresh some data with slight variations
  const updated = _state.collections.map((c) => ({
    ...c,
    floorPrice: +(c.floorPrice * (0.98 + seededRandom(c.slug + "-fp") * 0.04)).toFixed(2),
    percentChange24h: +((seededRandom(c.slug + "-pc") - 0.45) * 10).toFixed(1),
    trend: (seededRandom(c.slug + "-tr") > 0.6 ? "up" : seededRandom(c.slug + "-tr2") > 0.5 ? "down" : "flat") as NFTCollection["trend"],
  }));

  _state.collections = updated;
  _state.lastUpdate = Date.now();

  return [...updated].sort((a, b) => b.volume24h - a.volume24h).slice(0, limit);
}

/**
 * Execute a paper arbitrage trade.
 */
export function executePaperTrade(opportunityId: string): PaperNFTTrade | null {
  const opp = _state.opportunities.find((o) => o.id === opportunityId);
  if (!opp || opp.expiresAt < Date.now()) return null;

  const trade: PaperNFTTrade = {
    id: `tx-${Date.now()}-${opp.collection}`,
    collection: opp.collection,
    tokenId: opp.tokenId,
    buyMarketplace: opp.buyMarketplace,
    buyPrice: opp.buyPrice,
    sellMarketplace: opp.sellMarketplace,
    sellPrice: opp.sellPrice,
    profit: opp.netProfit,
    executedAt: Date.now(),
    status: "completed",
  };

  _state.paperTrades.push(trade);
  _state.opportunities = _state.opportunities.filter((o) => o.id !== opportunityId);

  return trade;
}

/**
 * Get current arbitrage state.
 */
export function getNFTArbitrageState(): NFTArbitrageState {
  const now = Date.now();

  // Auto-clean expired opportunities
  _state.opportunities = _state.opportunities.filter((o) => o.expiresAt > now);
  _state.lastUpdate = now;

  return {
    ..._state,
    collections: _state.collections.map((c) => ({ ...c })),
    opportunities: _state.opportunities.map((o) => ({ ...o })),
    paperTrades: _state.paperTrades.slice(-20).map((t) => ({ ...t })),
  };
}

/**
 * Get total paper trade profit in ETH.
 */
export function getPaperTradeProfit(): number {
  return +_state.paperTrades
    .filter((t) => t.status === "completed")
    .reduce((sum, t) => sum + t.profit, 0)
    .toFixed(4);
}

/**
 * Reset all state.
 */
export function resetNFTState(): void {
  _state = {
    collections: TOP_COLLECTIONS.map((c) => ({ ...c })),
    opportunities: [],
    totalScanned: 0,
    totalOpportunities: 0,
    paperTrades: [],
    lastUpdate: Date.now(),
    paperMode: !(typeof process !== "undefined" && process.env?.RESERVOIR_API_KEY),
  };
}
