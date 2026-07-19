import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { getAllAgentStatuses } from "~/lib/agent-runner";
import { getRiskStateRaw, type RiskSystemState } from "~/lib/risk-engine";
import { getOpenPositions, getTradeHistory, getTradingStats, type TradePosition } from "~/lib/trading-engine";
import { getAgentActivityLog, type AgentActivity } from "~/lib/agent-activity";
import { AGENTS } from "~/lib/agents";
import { CHAINS } from "~/lib/chains";

// ── Types ──────────────────────────────────────────────────────────

interface DashboardData {
  agentStatuses: Array<{
    id: string;
    name: string;
    icon: string;
    level: string;
    status: "active" | "idle" | "scanning" | "error" | "ok" | "warning";
    lastAction?: string;
  }>;
  riskState: RiskSystemState | null;
  positions: TradePosition[];
  trades: TradePosition[];
  pnl: number;
  activities: AgentActivity[];
  totalTrades: number;
  winRate: string;
}

// ── System Agents (non-chain, business-plan architecture) ─────────

interface SystemAgent {
  id: string;
  name: string;
  icon: string;
  level: string;
  status: "ok" | "warning" | "error";
}

function buildSystemAgents(risk: RiskSystemState | null): SystemAgent[] {
  const killSwitchActive = risk?.killSwitchTripped || risk?.circuitBreakerTripped || false;
  return [
    { id: "orchestrator", name: "Master Orchestrator", icon: "🎯", level: "Decision", status: "ok" },
    { id: "devils-advocate", name: "Devil's Advocate", icon: "😈", level: "Decision", status: "ok" },
    { id: "market-data", name: "Market Data Core", icon: "📡", level: "Intelligence", status: "ok" },
    { id: "technical", name: "Technical Analysis", icon: "🔧", level: "Analysis", status: "ok" },
    { id: "news", name: "News & Sentiment", icon: "📰", level: "Intelligence", status: "ok" },
    { id: "macro", name: "Macro Analysis", icon: "🌐", level: "Analysis", status: "ok" },
    { id: "liquidity", name: "Liquidity Agent", icon: "💧", level: "Intelligence", status: "ok" },
    { id: "smart-money", name: "Smart Money Tracker", icon: "🐋", level: "Analysis", status: "ok" },
    { id: "pattern", name: "Pattern Recognition", icon: "🔍", level: "Analysis", status: "ok" },
    { id: "risk-manager", name: "Risk Manager", icon: "🛡️", level: "Execution", status: risk ? (risk.overallRiskScore > 7 ? "warning" : "ok") : "ok" },
    { id: "circuit-breaker", name: "Circuit Breaker", icon: "🔌", level: "Execution", status: risk?.circuitBreakerTripped ? "warning" : "ok" },
    { id: "kill-switch", name: "Kill Switch", icon: "💀", level: "Execution", status: killSwitchActive ? "error" : "ok" },
    { id: "execution", name: "Trade Execution", icon: "⚡", level: "Execution", status: "ok" },
    { id: "portfolio", name: "Portfolio Manager", icon: "💼", level: "Execution", status: "ok" },
    { id: "learning", name: "Learning & Memory", icon: "🧠", level: "Analysis", status: "ok" },
    { id: "strategy", name: "Strategy Agent", icon: "📊", level: "Analysis", status: "ok" },
  ];
}

// ── Helpers ────────────────────────────────────────────────────────

function statusDot(status: string): string {
  switch (status) {
    case "active":
    case "scanning":
    case "ok":
      return "status-dot-online";
    case "idle":
      return "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)] w-2 h-2 rounded-full inline-block shrink-0";
    case "error":
      return "status-dot-offline";
    case "warning":
      return "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)] w-2 h-2 rounded-full inline-block shrink-0";
    default:
      return "status-dot-offline";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
    case "scanning":
    case "ok":
      return "text-accent-green";
    case "idle":
    case "warning":
      return "text-accent-yellow";
    case "error":
      return "text-accent-red";
    default:
      return "text-gray-400";
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function pnlColor(n: number): string {
  if (n > 0) return "text-accent-green";
  if (n < 0) return "text-accent-red";
  return "text-gray-400";
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// ── Route ──────────────────────────────────────────────────────────

export const Route = createFileRoute("/dashboard")({
  loader: async () => {
    const [agentStatuses, riskState, positions, trades, stats, activities] = await Promise.all([
      getAllAgentStatuses(),
      getRiskStateRaw(),
      getOpenPositions(),
      getTradeHistory(),
      getTradingStats(),
      getAgentActivityLog(),
    ]);
    return { agentStatuses, riskState, positions, trades, stats, activities };
  },
  component: DashboardPage,
});

// ── Component ──────────────────────────────────────────────────────

function DashboardPage() {
  const initial = Route.useLoaderData();
  const [data, setData] = useState<DashboardData>(() => mapInitialData(initial));
  const wsRef = useRef<WebSocket | null>(null);

  // Poll every 5 seconds
  const poll = useCallback(async () => {
    try {
      const [agentStatuses, riskState, positions, trades, stats, activities] = await Promise.all([
        getAllAgentStatuses(),
        getRiskStateRaw(),
        getOpenPositions(),
        getTradeHistory(),
        getTradingStats(),
        getAgentActivityLog(),
      ]);
      setData(mapToData(agentStatuses, riskState, positions, trades, stats, activities));
    } catch {
      // silent fail on poll — keep last known state
    }
  }, []);

  useEffect(() => {
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [poll]);

  // WebSocket for real-time activity stream
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "heartbeat" || msg.type === "init" || msg.type === "activity" || msg.type === "agent_status_change") {
          // Trigger a poll to refresh all data
          poll();
        }
      } catch {
        // ignore malformed WS messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, [poll]);

  // Re-fetch on window focus
  useEffect(() => {
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [poll]);

  const systemAgents = buildSystemAgents(data.riskState);
  const chainAgents = data.agentStatuses.filter(
    (a) => CHAINS.some((c) => c.id === a.id)
  );

  const killSwitchActive =
    data.riskState?.killSwitchTripped || data.riskState?.circuitBreakerTripped || false;
  const killSwitchReason =
    data.riskState?.killSwitchReason || data.riskState?.circuitBreakerReason || "";

  return (
    <div className="pt-20 pb-12 px-4 sm:px-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="glass-panel p-5 sm:p-6 blue-glow">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
              <span>🦚</span>
              <span className="text-gradient-blue">PĂUN AI</span>
              <span className="text-gray-400 text-lg font-normal">— AI Hedge Fund OS</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Autonomous trading command center • {systemAgents.length + chainAgents.length} agents online
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Kill Switch Status */}
            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold ${
                killSwitchActive
                  ? "border-accent-red/40 bg-accent-red/10 text-accent-red"
                  : "border-accent-green/40 bg-accent-green/10 text-accent-green"
              }`}
            >
              <span className={killSwitchActive ? "status-dot-offline" : "status-dot-online"}></span>
              <span>Kill Switch: {killSwitchActive ? "TRIPPED ⛔" : "ARMED ✅"}</span>
            </div>
            {/* P&L */}
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-dark-border bg-dark-surface/60">
              <span className="text-gray-400 text-sm">P&L</span>
              <span className={`text-mono font-bold ${pnlColor(data.pnl)}`}>
                {formatUsd(data.pnl)}
              </span>
            </div>
          </div>
        </div>
        {killSwitchActive && killSwitchReason && (
          <div className="mt-3 px-4 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30 text-accent-red text-sm">
            ⚠️ {killSwitchReason}
          </div>
        )}
      </div>

      {/* ── Agent Status Grid ─────────────────────────────────────── */}
      <div className="glass-panel p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span>🤖</span> Agent Status
          <span className="text-sm text-gray-400 font-normal">
            ({systemAgents.length + chainAgents.length} agents)
          </span>
        </h2>

        {/* System Agents — by level */}
        <div className="mb-4">
          <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2 font-medium">System Core</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {systemAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-surface/50 border border-dark-border/50 hover:border-accent-blue/30 transition-colors"
                title={agent.level}
              >
                <span className={statusDot(agent.status)}></span>
                <span className="text-sm">{agent.icon}</span>
                <span className="text-xs text-gray-300 truncate">{agent.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Chain Agents */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2 font-medium">Chain Agents</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {chainAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-surface/50 border border-dark-border/50 hover:border-accent-blue/30 transition-colors"
                title={agent.lastAction ?? ""}
              >
                <span className={statusDot(agent.status)}></span>
                <span className="text-sm">{agent.icon}</span>
                <span className="text-xs text-gray-300 truncate">{agent.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="status-dot-online"></span> Active
          </span>
          <span className="flex items-center gap-1">
            <span className="bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)] w-2 h-2 rounded-full inline-block shrink-0"></span> Idle/Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="status-dot-offline"></span> Error/Tripped
          </span>
        </div>
      </div>

      {/* ── Live Decision Feed ─────────────────────────────────────── */}
      <div className="glass-panel p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span>📡</span> Live Decision Feed
          <span className="text-xs text-gray-400 font-normal">(auto-refresh 5s)</span>
        </h2>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {data.activities.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">
              No activity yet — agents initializing...
            </p>
          ) : (
            data.activities.slice(0, 20).map((act) => (
              <div
                key={act.id}
                className="flex items-start gap-3 px-3 py-2 rounded-lg bg-dark-surface/40 border border-dark-border/30 text-sm"
              >
                <span className="text-xs font-mono text-gray-500 whitespace-nowrap mt-0.5">
                  {formatTime(act.timestamp)}
                </span>
                <span
                  className={`font-medium ${
                    act.type === "scan"
                      ? "text-accent-blue"
                      : act.type === "trade"
                        ? "text-accent-teal"
                        : act.type === "info"
                          ? "text-gray-300"
                          : "text-accent-cyan"
                  }`}
                >
                  🤖 {act.agentName}:
                </span>
                <span className="text-gray-400">{act.action}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Open Positions + Recent Trades ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Positions */}
        <div className="glass-panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span>📊</span> Open Positions
            <span className="text-xs text-gray-400 font-normal">
              ({data.positions.length} in paper mode)
            </span>
          </h2>
          {data.positions.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-4xl mb-2">📭</p>
              <p className="text-sm">No open positions</p>
              <p className="text-xs text-gray-500 mt-1">Paper trading mode — deploy capital to activate</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-dark-border/50">
                    <th className="text-left py-2 px-2">Symbol</th>
                    <th className="text-right py-2 px-2">Size</th>
                    <th className="text-right py-2 px-2">Entry</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-right py-2 px-2">Stop</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positions.map((pos) => (
                    <tr key={pos.id} className="border-b border-dark-border/30 hover:bg-dark-hover/30 transition-colors">
                      <td className="py-2 px-2">
                        <span className="text-white font-medium">{pos.token}</span>
                        <span className={`ml-2 text-xs ${pos.direction === "LONG" ? "text-accent-green" : "text-accent-red"}`}>
                          {pos.direction}
                        </span>
                      </td>
                      <td className="text-right py-2 px-2 text-mono text-gray-300">${pos.size.toLocaleString()}</td>
                      <td className="text-right py-2 px-2 text-mono text-gray-300">${pos.entryPrice.toFixed(2)}</td>
                      <td className={`text-right py-2 px-2 text-mono font-semibold ${pnlColor(pos.pnl)}`}>
                        {formatUsd(pos.pnl)} ({pos.pnlPct.toFixed(2)}%)
                      </td>
                      <td className="text-right py-2 px-2 text-mono text-accent-red">${pos.stopLoss.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="glass-panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span>📜</span> Recent Trades
            <span className="text-xs text-gray-400 font-normal">(last {Math.min(data.trades.length, 10)})</span>
          </h2>
          {data.trades.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-4xl mb-2">📭</p>
              <p className="text-sm">No trade history</p>
              <p className="text-xs text-gray-500 mt-1">Trades will appear here after execution</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-dark-border/50">
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-left py-2 px-2">Action</th>
                    <th className="text-right py-2 px-2">Price</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-center py-2 px-2">Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trades.slice(0, 10).map((trade) => (
                    <tr key={trade.id} className="border-b border-dark-border/30 hover:bg-dark-hover/30 transition-colors">
                      <td className="py-2 px-2 text-mono text-gray-400 text-xs">
                        {formatTime(trade.closedAt ?? trade.openedAt)}
                      </td>
                      <td className="py-2 px-2">
                        <span className="text-white font-medium">{trade.token}</span>
                        <span className={`ml-2 text-xs ${trade.direction === "LONG" ? "text-accent-green" : "text-accent-red"}`}>
                          {trade.direction}
                        </span>
                      </td>
                      <td className="text-right py-2 px-2 text-mono text-gray-300">
                        ${trade.currentPrice.toFixed(2)}
                      </td>
                      <td className={`text-right py-2 px-2 text-mono font-semibold ${pnlColor(trade.pnl)}`}>
                        {formatUsd(trade.pnl)}
                      </td>
                      <td className="text-center py-2 px-2">
                        {trade.aiReasoning ? (
                          <span
                            className="text-xs text-accent-blue cursor-help underline decoration-dotted"
                            title={trade.aiReasoning}
                          >
                            AI 🤖
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Stats summary */}
          {data.totalTrades > 0 && (
            <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
              <span>Total: <span className="text-white font-mono">{data.totalTrades}</span></span>
              <span>Win Rate: <span className="text-accent-green font-mono">{data.winRate}%</span></span>
            </div>
          )}
        </div>
      </div>

      {/* ── Risk Overview (compact) ────────────────────────────────── */}
      {data.riskState && (
        <div className="glass-panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span>🛡️</span> Risk Overview
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <div className="text-center">
              <p className="text-gray-400">Risk Score</p>
              <p className={`text-xl font-bold font-mono ${riskColor(data.riskState.overallRiskScore)}`}>
                {data.riskState.overallRiskScore}/10
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400">Active Agents</p>
              <p className="text-xl font-bold font-mono text-white">{data.riskState.activeAgentCount}</p>
            </div>
            <div className="text-center">
              <p className="text-gray-400">Paused</p>
              <p className="text-xl font-bold font-mono text-accent-yellow">{data.riskState.pausedAgentCount}</p>
            </div>
            <div className="text-center">
              <p className="text-gray-400">Total Exposure</p>
              <p className="text-xl font-bold font-mono text-white">
                ${(data.riskState.totalExposure / 1000).toFixed(1)}K
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400">Market Drop</p>
              <p className={`text-xl font-bold font-mono ${data.riskState.marketDropPct > 5 ? "text-accent-red" : "text-accent-green"}`}>
                {data.riskState.marketDropPct.toFixed(1)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400">Circuit Breaker</p>
              <p className={`text-xl font-bold font-mono ${data.riskState.circuitBreakerTripped ? "text-accent-red" : "text-accent-green"}`}>
                {data.riskState.circuitBreakerTripped ? "TRIPPED" : "OK"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score <= 3) return "text-accent-green";
  if (score <= 6) return "text-accent-yellow";
  return "text-accent-red";
}

function mapInitialData(initial: {
  agentStatuses: Awaited<ReturnType<typeof getAllAgentStatuses>>;
  riskState: Awaited<ReturnType<typeof getRiskStateRaw>>;
  positions: Awaited<ReturnType<typeof getOpenPositions>>;
  trades: Awaited<ReturnType<typeof getTradeHistory>>;
  stats: Awaited<ReturnType<typeof getTradingStats>>;
  activities: Awaited<ReturnType<typeof getAgentActivityLog>>;
}): DashboardData {
  return mapToData(
    initial.agentStatuses,
    initial.riskState,
    initial.positions,
    initial.trades,
    initial.stats,
    initial.activities,
  );
}

function mapToData(
  agentStatuses: Awaited<ReturnType<typeof getAllAgentStatuses>>,
  riskState: Awaited<ReturnType<typeof getRiskStateRaw>>,
  positions: Awaited<ReturnType<typeof getOpenPositions>>,
  trades: Awaited<ReturnType<typeof getTradeHistory>>,
  stats: Awaited<ReturnType<typeof getTradingStats>>,
  activities: Awaited<ReturnType<typeof getAgentActivityLog>>,
): DashboardData {
  return {
    agentStatuses: Array.isArray(agentStatuses)
      ? agentStatuses.map((a) => ({
          id: a.chainId,
          name: a.agentName,
          icon: a.icon,
          level: "Chain",
          status: a.status as "active" | "idle" | "scanning" | "error",
          lastAction: a.lastAction,
        }))
      : [],
    riskState,
    positions: Array.isArray(positions) ? positions : [],
    trades: Array.isArray(trades) ? trades : [],
    pnl: stats?.totalPnl ?? 0,
    activities: Array.isArray(activities) ? activities : [],
    totalTrades: stats?.totalTrades ?? 0,
    winRate: stats?.winRate ?? "0",
  };
}
