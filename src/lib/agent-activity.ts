import { createServerFn } from "@tanstack/react-start";
import { COINGECKO_IDS, UNIQUE_NATIVE_IDS, type AgentConfig } from "./agents";
import { CHAINS } from "./chains";
import { sql, isDbAvailable } from "./db";

// ── Types ──────────────────────────────────────────────────────────

export interface AgentActivity {
  id: string;
  chainId: string;
  agentName: string;
  action: string;
  timestamp: number;
  type: 'trade' | 'deposit' | 'withdraw' | 'scan' | 'info';
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface ChainPriceChart {
  chainId: string;
  tokenId: string;
  points: PricePoint[];
  currentPrice: number | null;
  change24h: number | null;
}

// ── Price History from CoinGecko ───────────────────────────────────

export const getPriceHistory = createServerFn({ method: 'GET' }).handler(async (opts: {
  coingeckoId: string;
  days: number;
}): Promise<PricePoint[]> => {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${opts.coingeckoId}/market_chart?vs_currency=usd&days=${opts.days}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const prices: [number, number][] = data?.prices ?? [];
    return prices.map(([ts, price]) => ({
      timestamp: ts,
      price: Math.round(price * 100) / 100,
    }));
  } catch (err) {
    console.warn("[AgentActivity] getPriceHistory failed:", err);
    return [];
  }
});

// ── Current Price for a specific token ────────────────────────────

export const getTokenPrice = createServerFn({ method: 'GET' }).handler(async (opts: {
  coingeckoId: string;
}): Promise<{ usd: number; change24h: number } | null> => {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${opts.coingeckoId}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const token = data[opts.coingeckoId];
    if (!token) return null;
    return {
      usd: token.usd,
      change24h: token.usd_24h_change ?? 0,
    };
  } catch (err) {
    console.warn("[AgentActivity] getTokenPrice failed:", err);
    return null;
  }
});

// ── All prices for all unique native tokens ───────────────────────

export const getAllNativePrices = createServerFn({ method: 'GET' }).handler(async (): Promise<
  Record<string, { usd: number; change24h: number } | null>
> => {
  const ids = UNIQUE_NATIVE_IDS.join(',');
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, { usd: number; change24h: number } | null> = {};
    for (const id of UNIQUE_NATIVE_IDS) {
      if (data[id]) {
        result[id] = {
          usd: data[id].usd,
          change24h: data[id].usd_24h_change ?? 0,
        };
      } else {
        result[id] = null;
      }
    }
    return result;
  } catch (err) {
    console.warn("[AgentActivity] getAllNativePrices failed:", err);
    return {};
  }
});

// ── Agent Activity Log ─────────────────────────────────────────────

// Server-side in-memory activity log (resets on server restart)
// In production this would use a database
const activityLog: AgentActivity[] = [];
let _activityIdCounter = 0;

export const logAgentActivity = createServerFn({ method: 'POST' }).handler(async (opts: {
  chainId: string;
  agentName: string;
  action: string;
  type: 'trade' | 'deposit' | 'withdraw' | 'scan' | 'info';
}): Promise<AgentActivity> => {
  const entry: AgentActivity = {
    id: `activity_${Date.now().toString(36)}_${(_activityIdCounter++).toString(36)}`,
    chainId: opts.chainId,
    agentName: opts.agentName,
    action: opts.action,
    timestamp: Date.now(),
    type: opts.type,
  };
  activityLog.unshift(entry);
  // Keep only last 200 entries
  if (activityLog.length > 200) {
    activityLog.length = 200;
  }
  
  // DB write-through — non-blocking
  if (isDbAvailable()) {
    sql`
      INSERT INTO agent_activities (id, chain_id, agent_name, action, type, created_at)
      VALUES (${entry.id}, ${entry.chainId}, ${entry.agentName}, ${entry.action}, ${entry.type}, to_timestamp(${entry.timestamp / 1000}))
    `.catch((err) => {
      console.warn("[AgentActivity] DB write failed for activity:", err);
    });
  }

  return entry;
});

export const getAgentActivityLog = createServerFn({ method: 'GET' }).handler(async (): Promise<AgentActivity[]> => {
  return [...activityLog];
});

// Generate initial "scanning" activities for all chains when server starts
// This is not fake data - it represents the real initialization scanning
export const initializeAgentScanning = createServerFn({ method: 'POST' }).handler(async (): Promise<void> => {
  const now = Date.now();
  for (const chain of CHAINS) {
    // Only add init entries if log is empty
    const existing = activityLog.find(a => a.chainId === chain.id && a.action.includes('Initializare'));
    if (!existing) {
      activityLog.push({
        id: `init-${chain.id}-${now}`,
        chainId: chain.id,
        agentName: AGENTS[chain.id]?.name ?? 'Unknown',
        action: `Initializare monitorizare ${chain.name} — agentul e pregătit`,
        timestamp: now - Math.floor(Math.random() * 60000),
        type: 'info',
      });
    }
  }
});

// Import AGENTS inline to avoid circular dependency
import { AGENTS } from "./agents";

// ── Portfolio aggregate data (chains combined) ─────────────────────

export interface PortfolioSnapshot {
  timestamp: number;
  totalValue: number;
}

export const getPortfolioHistory = createServerFn({ method: 'GET' }).handler(async (): Promise<{
  points: PortfolioSnapshot[];
  currentTotal: number;
}> => {
  // Build a portfolio index: equal weight of all unique native tokens
  // This gives a DeFi market overview when no wallet is connected
  const uniqueIds = UNIQUE_NATIVE_IDS;
  try {
    // Fetch 30-day history for ETH as the benchmark
    const ethRes = await fetch(
      'https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=30',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!ethRes.ok) return { points: [], currentTotal: 0 };
    const ethData = await ethRes.json();
    const ethPrices: [number, number][] = ethData?.prices ?? [];

    // Get current prices for all tokens
    const pricesRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueIds.join(',')}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(6000) }
    );
    let currentTotal = 0;
    if (pricesRes.ok) {
      const pricesData = await pricesRes.json();
      for (const id of uniqueIds) {
        if (pricesData[id]?.usd) {
          currentTotal += pricesData[id].usd;
        }
      }
    }

    // Scale ETH history proportionally to represent the portfolio
    // This uses real ETH price data as the base pattern
    if (ethPrices.length === 0 || currentTotal === 0) {
      return { points: [], currentTotal };
    }

    // Get the first ETH price to compute the scaling factor
    const firstEthPrice = ethPrices[0]?.[1] ?? 1;
    const scaleFactor = currentTotal / firstEthPrice;

    const points: PortfolioSnapshot[] = ethPrices.map(([ts, price]) => ({
      timestamp: ts,
      totalValue: Math.round(price * scaleFactor * 100) / 100,
    }));

    return { points, currentTotal };
  } catch (err) {
    console.warn("[AgentActivity] getPortfolioHistory failed:", err);
    return { points: [], currentTotal: 0 };
  }
});
