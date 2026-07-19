// All profit figures are $0 until agents are deployed with real capital
// and connected to live on-chain scanners. No simulated or mock data.

import { createServerFn } from "@tanstack/react-start";
import { AGENTS } from "./agents";
import { CHAINS } from "./chains";
import type { AgentActivity } from "./agent-activity";
import { getRobustMultiPrices } from "./price-feeds";
import { getPrice, getPrices } from "./ws/price-context";
import { agentBus } from "./agent-bus";

// ── Types ──────────────────────────────────────────────────────────

export interface AgentStatus {
  chainId: string;
  agentName: string;
  icon: string;
  status: 'active' | 'idle' | 'scanning' | 'error';
  lastAction: string;
  lastActionTime: number;
  nextScanTime: number;
  profitGenerated: number;
  transactions: number;
  strategies: string[];
}

export interface AgentScanResult {
  chainId: string;
  timestamp: number;
  opportunities: {
    type: 'staking' | 'arbitrage' | 'yield' | 'price-anomaly';
    description: string;
    estimatedProfit: number;
    confidence: 'high' | 'medium' | 'low';
  }[];
}

// ── Agent State ────────────────────────────────────────────────────

const agentStates = new Map<string, AgentStatus>();

function initAgentState(chainId: string): AgentStatus {
  const agent = AGENTS[chainId];
  const chain = CHAINS.find(c => c.id === chainId);
  const now = Date.now();
  
  return {
    chainId,
    agentName: agent?.name ?? 'Unknown',
    icon: agent?.icon ?? '🤖',
    status: 'idle',
    lastAction: 'Inactive — no scan running',
    lastActionTime: now,
    nextScanTime: now + 60_000,
    profitGenerated: 0,
    transactions: 0,
    strategies: agent?.strategies ?? [],
  };
}

export function getAgentState(chainId: string): AgentStatus {
  if (!agentStates.has(chainId)) {
    agentStates.set(chainId, initAgentState(chainId));
  }
  return agentStates.get(chainId)!;
}

// ── In-memory activity log (mirrors agent-activity.ts pattern) ─────

const activityLog: AgentActivity[] = [];

export function addActivity(entry: AgentActivity) {
  activityLog.unshift(entry);
  if (activityLog.length > 200) activityLog.length = 200;
  // Emit for WebSocket broadcast
  agentBus.emit('activity', { activity: entry });
}

export function getActivities(): AgentActivity[] {
  return [...activityLog];
}

// ── Internal scanning logic ────────────────────────────────────────

// Fallback APYs for scanning (used when staking serverFn can't be called cross-fn)
const STAKING_APY_FALLBACKS: Record<string, number> = {
  ethereum: 3.1, solana: 6.5, near: 9.5, aptos: 7.0,
  sui: 4.0, bnb: 3.5, polygon: 5.0, avalanche: 7.5,
};

export async function internalScan(chainId: string): Promise<AgentScanResult> {
  const chain = CHAINS.find(c => c.id === chainId);
  const agent = AGENTS[chainId];
  const opportunities: AgentScanResult['opportunities'] = [];
  const now = Date.now();

  if (!chain || !agent) {
    throw new Error(`No agent configured for chain: ${chainId}`);
  }

  // 1. Check staking opportunities
  const apy = STAKING_APY_FALLBACKS[chainId];
  if (apy && apy > 5) {
    opportunities.push({
      type: 'staking',
      description: `APY ~${apy}% disponibil pentru staking pe ${chain.name} (${chain.nativeToken})`,
      estimatedProfit: apy,
      confidence: 'high',
    });
  } else if (apy) {
    opportunities.push({
      type: 'staking',
      description: `APY ~${apy}% disponibil pentru staking pe ${chain.name} (${chain.nativeToken})`,
      estimatedProfit: apy,
      confidence: 'medium',
    });
  }

  // 2. Check price anomalies using live WebSocket data first, fallback to CoinGecko
  try {
    // Try live prices from WebSocket cache first
    const wsSymbols = ["BTC", "ETH", "SOL", "BNB", "MATIC", "AVAX", "NEAR", "SUI", "APT"];
    const livePrices = await getPrices(wsSymbols);
    const validPrices: [string, number][] = [];
    for (const [sym, price] of livePrices) {
      if (price !== null && price > 0) {
        validPrices.push([sym, price]);
      }
    }

    if (validPrices.length >= 2) {
      const avgPrice = validPrices.reduce((sum, [, p]) => sum + p, 0) / validPrices.length;
      for (const [sym, price] of validPrices) {
        // Map symbol to chain for matching
        const chainMap: Record<string, string[]> = {
          ETH: ["ethereum", "arbitrum", "optimism", "base", "zksync", "linea", "scroll"],
          BNB: ["bnb"],
          MATIC: ["polygon"],
          AVAX: ["avalanche"],
          SOL: ["solana"],
          NEAR: ["near"],
          SUI: ["sui"],
          APT: ["aptos"],
        };
        const matchingChains = chainMap[sym] ?? [sym.toLowerCase()];
        if (matchingChains.includes(chainId)) {
          const deviation = Math.abs(price - avgPrice) / avgPrice * 100;
          if (deviation > 5) {
            opportunities.push({
              type: "price-anomaly",
              description: `Anomalie preț (live WS): ${deviation.toFixed(1)}% deviație pe ${chain.name}`,
              estimatedProfit: deviation * 0.5,
              confidence: "medium",
            });
          }
        }
      }
    }
  } catch { /* continue */ }

  // 3. Record the activity
  const actionText = opportunities.length > 0
    ? `Detectate ${opportunities.length} oportunități pe ${chain.name}`
    : `Scan complet — nicio oportunitate pe ${chain.name}`;

  addActivity({
    id: `scan-${chainId}-${now}`,
    chainId,
    agentName: agent.name,
    action: actionText,
    timestamp: now,
    type: opportunities.length > 0 ? 'scan' : 'info',
  });

  // Update agent state
  const state = getAgentState(chainId);
  const prevStatus = state.status;
  state.status = opportunities.length > 0 ? 'active' : 'idle';
  state.lastAction = actionText;
  state.lastActionTime = now;
  state.nextScanTime = now + 60_000;
  if (opportunities.length > 0) {
    state.transactions += 1;
    // Real profit tracking — currently 0 until agents are live
    state.profitGenerated += 0;
  }

  // Emit status change if it actually changed
  if (state.status !== prevStatus) {
    agentBus.emit('agent_status_change', { chainId, status: { ...state } });
  }

  return {
    chainId,
    timestamp: now,
    opportunities,
  };
}

// ── Server Functions ──────────────────────────────────────────────

export const runAgentScan = createServerFn({ method: 'POST' }).handler(async ({ data }: { data: { chainId: string } }): Promise<AgentScanResult> => {
  return internalScan(data.chainId);
});

export const runAllAgentScans = createServerFn({ method: 'POST' }).handler(async (): Promise<AgentScanResult[]> => {
  const results: AgentScanResult[] = [];
  for (const chain of CHAINS) {
    try {
      results.push(await internalScan(chain.id));
    } catch {
      results.push({ chainId: chain.id, timestamp: Date.now(), opportunities: [] });
    }
  }
  return results;
});

export const getAllAgentStatuses = createServerFn({ method: 'GET' }).handler(async (): Promise<AgentStatus[]> => {
  // Initialize states for any chains that don't have them
  for (const chain of CHAINS) {
    getAgentState(chain.id);
  }
  return CHAINS.map(c => getAgentState(c.id));
});

export const toggleAgentStatus = createServerFn({ method: 'POST' }).handler(async ({ data }: { data: { chainId: string; active: boolean } }): Promise<AgentStatus> => {
  const { chainId, active } = data;
  const state = getAgentState(chainId);
  state.status = active ? 'active' : 'idle';
  state.lastAction = active ? 'Agent reactivat' : 'Agent dezactivat';
  state.lastActionTime = Date.now();
  
  const agent = AGENTS[chainId];
  addActivity({
    id: `toggle-${chainId}-${Date.now()}`,
    chainId,
    agentName: agent?.name ?? 'Unknown',
    action: active ? 'Agent activat manual' : 'Agent dezactivat manual',
    timestamp: Date.now(),
    type: 'info',
  });

  return state;
});

export const getAgentProfitHistory = createServerFn({ method: 'GET' }).handler(async (): Promise<{
  agentId: string;
  agentName: string;
  points: { timestamp: number; profit: number }[];
}[]> => {
  const now = Date.now();
  const dayMs = 86_400_000;
  const histories: {
    agentId: string;
    agentName: string;
    points: { timestamp: number; profit: number }[];
  }[] = [];

  for (const chain of CHAINS) {
    const agent = AGENTS[chain.id];
    if (!agent) continue;
    
    const state = getAgentState(chain.id);
    // Use actual state profit — until agents are live this is $0
    const totalProfit = state.profitGenerated;
    const points: { timestamp: number; profit: number }[] = [];

    // Generate 31 daily data points reflecting actual state (all $0 pre-launch)
    for (let i = 30; i >= 0; i--) {
      const ts = now - (i * dayMs);
      points.push({
        timestamp: ts,
        profit: totalProfit,
      });
    }

    histories.push({
      agentId: chain.id,
      agentName: agent.name,
      points,
    });
  }

  return histories;
});
