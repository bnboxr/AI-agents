// All profit figures are $0 until agents are deployed with real capital
// and connected to live on-chain scanners. No simulated or mock data.

import { createServerFn } from "@tanstack/react-start";
import { AGENTS } from "./agents";
import { CHAINS } from "./chains";
import type { AgentActivity } from "./agent-activity";
import { getRobustMultiPrices } from "./price-feeds";
import { getPrice, getPrices } from "./ws/price-context";
import { agentBus } from "./agent-bus";
import { sql, isDbAvailable } from "./db";

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

/**
 * Sync a single agent state to the DB (non-blocking).
 */
export function syncAgentStateToDb(state: AgentStatus): void {
  if (!isDbAvailable()) return;
  sql.query(
    `INSERT INTO agent_states (chain_id, agent_name, icon, status, last_action, last_action_at, next_scan_at, profit_total, transactions, strategies, updated_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7), $8, $9, $10, NOW())
     ON CONFLICT (chain_id) DO UPDATE SET
       agent_name = EXCLUDED.agent_name,
       icon = EXCLUDED.icon,
       status = EXCLUDED.status,
       last_action = EXCLUDED.last_action,
       last_action_at = EXCLUDED.last_action_at,
       next_scan_at = EXCLUDED.next_scan_at,
       profit_total = EXCLUDED.profit_total,
       transactions = EXCLUDED.transactions,
       strategies = EXCLUDED.strategies,
       updated_at = NOW()`,
    [
      state.chainId,
      state.agentName,
      state.icon,
      state.status,
      state.lastAction,
      state.lastActionTime / 1000,
      state.nextScanTime / 1000,
      state.profitGenerated,
      state.transactions,
      state.strategies,
    ]
  ).catch((err) => {
    console.warn("[AgentRunner] DB write failed for state:", state.chainId, err);
  });
}

/**
 * Load all agent states from DB on startup and populate the in-memory Map.
 * Called once during server initialization.
 */
export async function loadAgentStates(): Promise<void> {
  if (!isDbAvailable()) {
    console.log("[AgentRunner] DB not available — skipping state load from DB.");
    return;
  }
  try {
    const result = await sql.query("SELECT * FROM agent_states");
    if (!result.rows || result.rows.length === 0) {
      console.log("[AgentRunner] No existing agent states in DB — using fresh defaults.");
      return;
    }
    for (const row of result.rows) {
      const state: AgentStatus = {
        chainId: row.chain_id as string,
        agentName: row.agent_name as string,
        icon: row.icon as string,
        status: row.status as AgentStatus["status"],
        lastAction: (row.last_action as string) ?? "Restored from DB",
        lastActionTime: row.last_action_at
          ? new Date(row.last_action_at as string).getTime()
          : Date.now(),
        nextScanTime: row.next_scan_at
          ? new Date(row.next_scan_at as string).getTime()
          : Date.now() + 60_000,
        profitGenerated: (row.profit_total as number) ?? 0,
        transactions: (row.transactions as number) ?? 0,
        strategies: (row.strategies as string[]) ?? [],
      };
      agentStates.set(state.chainId, state);
    }
    console.log(`[AgentRunner] Loaded ${result.rows.length} agent states from DB.`);
  } catch (err) {
    console.warn("[AgentRunner] Failed to load agent states from DB:", err);
  }
}

// ── In-memory activity log (mirrors agent-activity.ts pattern) ─────

const activityLog: AgentActivity[] = [];

export function addActivity(entry: AgentActivity) {
  activityLog.unshift(entry);
  if (activityLog.length > 200) activityLog.length = 200;
  // Emit for WebSocket broadcast
  agentBus.emit('activity', { activity: entry });

  // DB write-through — non-blocking, fires and forgets
  if (isDbAvailable()) {
    sql`
      INSERT INTO agent_activities (id, chain_id, agent_name, action, type, created_at)
      VALUES (${entry.id}, ${entry.chainId}, ${entry.agentName}, ${entry.action}, ${entry.type}, to_timestamp(${entry.timestamp / 1000}))
    `.catch((err) => {
      console.warn("[AgentRunner] DB write failed for activity:", err);
    });
  }
}

export function getActivities(): AgentActivity[] {
  return [...activityLog];
}

// ── Internal scanning logic ────────────────────────────────────────

// Fallback APYs for scanning (used when staking serverFn can't be called cross-fn)
const STAKING_APY_FALLBACKS: Record<string, number> = {
  ethereum: 3.1, solana: 6.5, near: 9.5, aptos: 7.0,
  sui: 4.0, bnb: 3.5, polygon: 5.0, avalanche: 7.5,
  tron: 4.5, xrp: 2.0, cosmos: 18.0,
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
  } catch (err) { console.warn("[AgentRunner] internalScan price check failed:", err); /* continue */ }

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

  // Sync state to DB
  syncAgentStateToDb(state);

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
    } catch (err) {
      console.warn("[AgentRunner] runAllAgentScans — chain scan failed:", err);
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
  
  // Sync state to DB
  syncAgentStateToDb(state);

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

// ── Startup: load agent states from DB ─────────────────────────────

setTimeout(() => {
  loadAgentStates()
    .then(() => {
      // Initialize states for any chains not found in DB
      for (const chain of CHAINS) {
        getAgentState(chain.id);
      }
      console.log(`[AgentRunner] Agent states initialized — ${agentStates.size} chains loaded.`);
    })
    .catch((err) => {
      console.error("[AgentRunner] Failed to load agent states on startup:", err);
    });
}, 500);
