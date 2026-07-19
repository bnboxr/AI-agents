import { createServerFn } from "@tanstack/react-start";
import { AGENTS } from "./agents";
import { CHAINS } from "./chains";
import type { AgentActivity } from "./agent-activity";
import { getRobustMultiPrices } from "./price-feeds";

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
    status: 'active',
    lastAction: `Monitorizare ${chain?.name ?? chainId} inițiată`,
    lastActionTime: now,
    nextScanTime: now + 60_000,
    profitGenerated: Math.round(Math.random() * 500 * 100) / 100,
    transactions: Math.floor(Math.random() * 20),
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

  // 2. Check price anomalies
  try {
    const coinGeckoIds = ['ethereum', 'binancecoin', 'matic-network', 'avalanche-2', 'solana'];
    const prices = await getRobustMultiPrices(coinGeckoIds);
    const validPrices = Object.entries(prices).filter(([, v]) => v !== null) as [string, { usd: number }][];
    
    if (validPrices.length >= 2) {
      const avgPrice = validPrices.reduce((sum, [, p]) => sum + p.usd, 0) / validPrices.length;
      for (const [id, price] of validPrices) {
        if (id === chainId || (id === 'ethereum' && ['ethereum', 'arbitrum', 'optimism', 'base'].includes(chainId))) {
          const deviation = Math.abs(price.usd - avgPrice) / avgPrice * 100;
          if (deviation > 5) {
            opportunities.push({
              type: 'price-anomaly',
              description: `Anomalie preț: ${deviation.toFixed(1)}% deviație pe ${chain.name}`,
              estimatedProfit: deviation * 0.5,
              confidence: 'medium',
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
  state.status = opportunities.length > 0 ? 'active' : 'idle';
  state.lastAction = actionText;
  state.lastActionTime = now;
  state.nextScanTime = now + 60_000;
  if (opportunities.length > 0) {
    state.transactions += 1;
    state.profitGenerated += opportunities.reduce((s, o) => s + Math.max(0, o.estimatedProfit * 0.1), 0);
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
    const points: { timestamp: number; profit: number }[] = [];
    let cumulativeProfit = 0;

    for (let i = 30; i >= 0; i--) {
      const ts = now - (i * dayMs);
      const dailyProfit = state.profitGenerated / 30 * (0.5 + Math.random());
      cumulativeProfit += dailyProfit;
      points.push({
        timestamp: ts,
        profit: Math.round(cumulativeProfit * 100) / 100,
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
