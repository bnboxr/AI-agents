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

// ── Simulated trending collections ─────────────────────────────

const TOP_COLLECTIONS: NFTCollection[] = [
  {
    slug: "cryptopunks", name: "CryptoPunks", floorPrice: 42.5,
    volume24h: 89.3, volume7d: 612.4, marketCap: 425_000,
    owners: 3620, totalSupply: 10_000, percentChange24h: -2.1,
    trend: "down", category: "pfp",
  },
  {
    slug: "bored-ape-yacht-club", name: "Bored Ape Yacht Club", floorPrice: 12.8,
    volume24h: 145.2, volume7d: 1023.8, marketCap: 128_000,
    owners: 6421, totalSupply: 10_000, percentChange24h: 1.5,
    trend: "up", category: "pfp",
  },
  {
    slug: "mutant-ape-yacht-club", name: "Mutant Ape Yacht Club", floorPrice: 2.4,
    volume24h: 52.1, volume7d: 389.5, marketCap: 46_800,
    owners: 12850, totalSupply: 20_000, percentChange24h: 0.3,
    trend: "flat", category: "pfp",
  },
  {
    slug: "azuki", name: "Azuki", floorPrice: 4.2,
    volume24h: 78.6, volume7d: 547.2, marketCap: 42_000,
    owners: 5340, totalSupply: 10_000, percentChange24h: 3.2,
    trend: "up", category: "pfp",
  },
  {
    slug: "pudgy-penguins", name: "Pudgy Penguins", floorPrice: 8.9,
    volume24h: 112.4, volume7d: 782.1, marketCap: 79_210,
    owners: 4780, totalSupply: 8_888, percentChange24h: 5.7,
    trend: "up", category: "pfp",
  },
  {
    slug: "degods", name: "DeGods", floorPrice: 1.8,
    volume24h: 23.5, volume7d: 167.3, marketCap: 16_000,
    owners: 3210, totalSupply: 10_000, percentChange24h: -0.8,
    trend: "down", category: "pfp",
  },
  {
    slug: "clonex", name: "CloneX", floorPrice: 1.2,
    volume24h: 18.9, volume7d: 132.4, marketCap: 23_400,
    owners: 8900, totalSupply: 20_000, percentChange24h: -1.4,
    trend: "down", category: "metaverse",
  },
  {
    slug: "milady-maker", name: "Milady Maker", floorPrice: 3.6,
    volume24h: 45.2, volume7d: 312.8, marketCap: 35_280,
    owners: 4120, totalSupply: 9_800, percentChange24h: 2.8,
    trend: "up", category: "pfp",
  },
  {
    slug: "art-blocks", name: "Art Blocks Curated", floorPrice: 0.85,
    volume24h: 12.3, volume7d: 89.7, marketCap: 8_500,
    owners: 6540, totalSupply: 10_000, percentChange24h: 0.1,
    trend: "flat", category: "art",
  },
  {
    slug: "parallel-alpha", name: "Parallel Alpha", floorPrice: 0.42,
    volume24h: 8.7, volume7d: 62.3, marketCap: 4_200,
    owners: 7230, totalSupply: 10_000, percentChange24h: 1.1,
    trend: "up", category: "gaming",
  },
];

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
  paperMode: true,
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
    paperMode: true,
  };
}
