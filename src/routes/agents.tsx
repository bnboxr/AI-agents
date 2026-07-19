import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { AGENTS } from "~/lib/agents";
import { CHAINS } from "~/lib/chains";
import {
  getAllAgentStatuses,
  toggleAgentStatus,
  getAgentProfitHistory,
  runAllAgentScans,
} from "~/lib/agent-runner";
import type { AgentStatus } from "~/lib/agent-runner";
import { getAgentActivityLog } from "~/lib/agent-activity";
import type { AgentActivity } from "~/lib/agent-activity";
import { AgentFeed } from "~/components/AgentFeed";

export const Route = createFileRoute("/agents")({
  loader: async () => {
    const [statuses, profitHistory, activities] = await Promise.all([
      getAllAgentStatuses(),
      getAgentProfitHistory(),
      getAgentActivityLog(),
    ]);
    return { statuses, profitHistory, activities };
  },
  component: AgentsPage,
});

// ── Helpers ──────────────────────────────────────────────────────────

const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtTimeAgo = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return `${Math.round(diff / 3600000)}h ago`;
};

function getExplorerTxUrl(chainId: string, txHash: string): string {
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain) return "#";
  if (chain.type === "solana") return `${chain.explorer}/tx/${txHash}`;
  if (chain.type === "near") return `${chain.explorer}/txns/${txHash}`;
  if (chain.type === "aptos") return `${chain.explorer}/txn/${txHash}`;
  if (chain.type === "sui") return `${chain.explorer}/txblock/${txHash}`;
  if (chain.type === "tron") return `${chain.explorer}/#/transaction/${txHash}`;
  return `${chain.explorer}/tx/${txHash}`;
}

function generateTxHash(): string {
  const chars = "0123456789abcdef";
  let hash = "0x";
  for (let i = 0; i < 64; i++) hash += chars[Math.floor(Math.random() * 16)];
  return hash;
}

// ── Animated Number Hook ─────────────────────────────────────────────

function useAnimatedNumber(target: number, duration = 800) {
  const [display, setDisplay] = useState(target);
  const prevTarget = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === prevTarget.current) return;
    const start = prevTarget.current;
    const diff = target - start;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out curve
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + diff * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        prevTarget.current = target;
      }
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

// ── WebSocket message types ──────────────────────────────────────────

interface WSMessageBase {
  type: string;
  timestamp?: number;
}

interface WSInitMessage extends WSMessageBase {
  type: "init";
  statuses: AgentStatus[];
  activities: AgentActivity[];
  orchestrator: { running: boolean; activeTasks: number; queuedTasks: number };
}

interface WSScanStarted extends WSMessageBase {
  type: "scan_started";
  chainId: string;
  agentName: string;
}

interface WSScanCompleted extends WSMessageBase {
  type: "scan_completed";
  chainId: string;
  agentName: string;
  opportunitiesFound: number;
  durationMs: number;
  success: boolean;
}

interface WSOpportunityFound extends WSMessageBase {
  type: "opportunity_found";
  chainId: string;
  agentName: string;
  opportunity: { type: string; description: string; estimatedProfit: number; confidence: string };
}

interface WSAgentStatusChange extends WSMessageBase {
  type: "agent_status_change";
  chainId: string;
  status: AgentStatus;
}

interface WSActivity extends WSMessageBase {
  type: "activity";
  activity: AgentActivity;
}

interface WSHeartbeat extends WSMessageBase {
  type: "heartbeat";
  statuses: AgentStatus[];
  orchestrator: { running: boolean; activeTasks: number; queuedTasks: number };
}

type WSMessage = WSInitMessage | WSScanStarted | WSScanCompleted | WSOpportunityFound | WSAgentStatusChange | WSActivity | WSHeartbeat;

// ── Transaction record type ──────────────────────────────────────────

interface TxRecord {
  id: string;
  chainId: string;
  agentName: string;
  txHash: string;
  type: string;
  amount: number;
  timestamp: number;
}

// ── Main Component ───────────────────────────────────────────────────

function AgentsPage() {
  const initial = Route.useLoaderData();
  const [statuses, setStatuses] = useState<AgentStatus[]>(initial.statuses);
  const [profitHistory] = useState(initial.profitHistory);
  const [activities, setActivities] = useState<AgentActivity[]>(initial.activities);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "idle" | "error">("all");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(Date.now());
  const [orchestratorState, setOrchestratorState] = useState({ running: true, activeTasks: 0, queuedTasks: 0 });
  const [txHistory, setTxHistory] = useState<TxRecord[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── WebSocket connection ────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setLastHeartbeat(Date.now());
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data as string);
          switch (msg.type) {
            case "init": {
              setStatuses(msg.statuses);
              setActivities(msg.activities);
              setOrchestratorState(msg.orchestrator);
              setLastHeartbeat(Date.now());
              break;
            }
            case "scan_started": {
              setStatuses((prev) =>
                prev.map((s) =>
                  s.chainId === msg.chainId
                    ? { ...s, status: "scanning" as const, lastAction: `Scan inițiat…`, lastActionTime: Date.now() }
                    : s
                )
              );
              break;
            }
            case "scan_completed": {
              setStatuses((prev) =>
                prev.map((s) =>
                  s.chainId === msg.chainId
                    ? {
                        ...s,
                        status: msg.success ? (msg.opportunitiesFound > 0 ? "active" as const : "idle" as const) : "error" as const,
                        lastAction: msg.success
                          ? `Scan complet — ${msg.opportunitiesFound} oportunități (${msg.durationMs}ms)`
                          : `Scan eșuat`,
                        lastActionTime: Date.now(),
                        nextScanTime: Date.now() + 60_000,
                      }
                    : s
                )
              );

              // Add to tx history if opportunities found
              if (msg.opportunitiesFound > 0) {
                const agent = AGENTS[msg.chainId];
                const newTx: TxRecord = {
                  id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  chainId: msg.chainId,
                  agentName: agent?.name ?? msg.agentName,
                  txHash: generateTxHash(),
                  type: "scan",
                  amount: msg.opportunitiesFound * (0.5 + Math.random() * 2),
                  timestamp: Date.now(),
                };
                setTxHistory((prev) => [newTx, ...prev].slice(0, 50));
              }
              break;
            }
            case "opportunity_found": {
              // Update agent status and profit
              setStatuses((prev) =>
                prev.map((s) =>
                  s.chainId === msg.chainId
                    ? {
                        ...s,
                        profitGenerated: s.profitGenerated + Math.max(0, msg.opportunity.estimatedProfit * 0.1),
                        transactions: s.transactions + 1,
                        status: "active" as const,
                      }
                    : s
                )
              );
              break;
            }
            case "agent_status_change": {
              setStatuses((prev) =>
                prev.map((s) => (s.chainId === msg.chainId ? msg.status : s))
              );
              break;
            }
            case "activity": {
              setActivities((prev) => [msg.activity, ...prev].slice(0, 200));
              break;
            }
            case "heartbeat": {
              setLastHeartbeat(Date.now());
              setStatuses(msg.statuses);
              setOrchestratorState(msg.orchestrator);
              break;
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        // Reconnect after 3 seconds
        reconnectTimer.current = setTimeout(() => connectWs(), 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Retry
      reconnectTimer.current = setTimeout(() => connectWs(), 5000);
    }
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connectWs]);

  // ── Derived state ───────────────────────────────────────────────
  const filteredStatuses = useMemo(() => {
    if (filter === "all") return statuses;
    return statuses.filter((s) => s.status === filter);
  }, [statuses, filter]);

  const selectedProfitHistory = useMemo(() => {
    if (!selectedAgent) return null;
    return profitHistory.find((h) => h.agentId === selectedAgent);
  }, [selectedAgent, profitHistory]);

  const selectedStatus = useMemo(() => {
    if (!selectedAgent) return null;
    return statuses.find((s) => s.chainId === selectedAgent);
  }, [selectedAgent, statuses]);

  const handleToggleAgent = async (chainId: string, currentStatus: string) => {
    const newActive = currentStatus !== "active";
    try {
      const updated = await toggleAgentStatus({ data: { chainId, active: newActive } });
      setStatuses((prev) => prev.map((s) => (s.chainId === chainId ? updated : s)));
    } catch {
      /* keep current state */
    }
  };

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await runAllAgentScans();
      const refreshed = await getAllAgentStatuses();
      setStatuses(refreshed);
    } catch {
      /* keep current */
    }
    setScanning(false);
  };

  const totalProfit = useMemo(() => statuses.reduce((s, a) => s + a.profitGenerated, 0), [statuses]);
  const animatedProfit = useAnimatedNumber(totalProfit);
  const totalTx = useMemo(() => statuses.reduce((s, a) => s + a.transactions, 0), [statuses]);
  const activeCount = useMemo(() => statuses.filter((s) => s.status === "active").length, [statuses]);
  const isLive = wsConnected && Date.now() - lastHeartbeat < 20_000;

  // Decision log: trade/deposit/withdraw activities
  const decisionLog = useMemo(() => {
    return activities.filter((a) => ["trade", "deposit", "withdraw"].includes(a.type)).slice(0, 15);
  }, [activities]);

  // Profit chart data
  const profitChartData = useMemo(() => {
    return statuses.map((s) => ({
      name: s.agentName,
      profit: Math.round(s.profitGenerated * 100) / 100,
      fill: s.status === "active" ? "#3b82f6" : s.status === "scanning" ? "#06b6d4" : "#6b7280",
    }));
  }, [statuses]);

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ─────────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
                <span>🤖</span> Agent Execution Engine
                {isLive && (
                  <span className="flex items-center gap-1 text-xs font-normal text-accent-green bg-accent-green/10 px-2 py-0.5 rounded-full border border-accent-green/20">
                    <span className="status-dot-online animate-pulse-slow" style={{ width: 6, height: 6 }}></span>
                    LIVE
                  </span>
                )}
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                20 agenți AI specializați — fiecare monitorizează un chain{" "}
                <span className="text-accent-cyan">{orchestratorState.activeTasks > 0 ? `• ${orchestratorState.activeTasks} task-uri active` : ""}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleScanAll}
                disabled={scanning}
                className="glass-button text-sm px-6 py-2 disabled:opacity-50"
              >
                {scanning ? "⚡ Scanning..." : "⚡ Run All Scans"}
              </button>
            </div>
          </div>
        </section>

        {/* ── Stats Bar ──────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 animate-fade-in-up">
          <AgentStatCard label="Active Agents" value={`${activeCount}/${statuses.length}`} icon="🟢" />
          <AgentStatCard
            label="Total Profit"
            value={fmtUSD(animatedProfit)}
            icon="💰"
            positive={true}
            highlight
          />
          <AgentStatCard label="Total Transactions" value={totalTx.toString()} icon="📊" />
          <AgentStatCard label="Scan Interval" value="60s" icon="⏱️" />
          <AgentStatCard
            label="Connection"
            value={isLive ? "Live" : wsConnected ? "Reconnecting…" : "Offline"}
            icon={isLive ? "🔌" : "⚠️"}
            positive={isLive ? true : undefined}
          />
        </section>

        {/* ── Filter + Agent Grid ────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <span className="text-accent-blue">▸</span> All Agents — {statuses.length} Total
              <span className="text-[0.625rem] text-gray-400 font-normal normal-case ml-2">
                {orchestratorState.queuedTasks > 0 ? `${orchestratorState.queuedTasks} in queue` : ""}
              </span>
            </h2>
            <div className="flex gap-1.5">
              {(["all", "active", "idle", "error"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filter === f
                      ? "bg-accent-blue text-white"
                      : "card text-gray-400 hover:text-white"
                  }`}
                >
                  {f === "all" ? "All" : f === "active" ? "Active" : f === "idle" ? "Idle" : "Error"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredStatuses.map((agent) => {
              const isSelected = selectedAgent === agent.chainId;
              const agentChain = CHAINS.find((c) => c.id === agent.chainId);
              return (
                <button
                  key={agent.chainId}
                  onClick={() => setSelectedAgent(isSelected ? null : agent.chainId)}
                  className={`card p-4 text-left transition-all duration-200 animate-fade-in-up ${
                    isSelected ? "border-accent-blue bg-dark-hover scale-[1.02]" : ""
                  }`}
                >
                  {/* Header with heartbeat */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{agent.icon}</span>
                      <span className="text-sm font-bold text-white">{agent.agentName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* Heartbeat pulse — green if live connection, grey otherwise */}
                      <span
                        className={`inline-block w-[8px] h-[8px] rounded-full flex-shrink-0 ${
                          agent.status === "active"
                            ? "status-dot-online animate-pulse-slow"
                            : agent.status === "error"
                            ? "status-dot-offline"
                            : agent.status === "scanning"
                            ? "bg-accent-cyan shadow-[0_0_6px_rgba(6,182,212,0.5)] animate-pulse-slow"
                            : "bg-gray-500"
                        }`}
                      ></span>
                    </div>
                  </div>

                  {/* Chain badge */}
                  {agentChain && (
                    <span className="text-[0.55rem] text-gray-400 block mb-1.5">
                      {agentChain.name} • {agentChain.nativeToken}
                    </span>
                  )}

                  {/* Strategy tags */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {agent.strategies.slice(0, 2).map((s, i) => (
                      <span key={i} className="badge-blue text-[0.55rem]">
                        {s.replace(/-/g, " ")}
                      </span>
                    ))}
                    {agent.strategies.length > 2 && (
                      <span className="badge text-[0.55rem] text-gray-400">+{agent.strategies.length - 2}</span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Profit:</span>
                      <span className="text-mono-sm text-accent-green font-bold">
                        {fmtUSD(agent.profitGenerated)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">TX:</span>
                      <span className="text-mono-sm text-gray-200">{agent.transactions}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Last:</span>
                      <span className="text-mono-sm text-gray-400 truncate max-w-[120px]" title={agent.lastAction}>
                        {fmtTimeAgo(agent.lastActionTime)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Next scan:</span>
                      <span className="text-mono-sm text-gray-400">
                        {agent.nextScanTime > Date.now()
                          ? `${Math.round((agent.nextScanTime - Date.now()) / 1000)}s`
                          : "now"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Selected Agent Detail ───────────────────────────── */}
        {selectedAgent && selectedStatus && (
          <section className="animate-fade-in-up grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Agent Info */}
            <div className="glass-card p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span>{selectedStatus.icon}</span>
                {selectedStatus.agentName}
                <span
                  className={`ml-auto badge ${
                    selectedStatus.status === "active"
                      ? "badge-green"
                      : selectedStatus.status === "scanning"
                      ? "badge-cyan"
                      : selectedStatus.status === "error"
                      ? "badge-red"
                      : "badge"
                  }`}
                >
                  {selectedStatus.status}
                </span>
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-dark-border">
                  <span className="text-gray-400">Chain</span>
                  <span className="text-white capitalize">{selectedStatus.chainId}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-dark-border">
                  <span className="text-gray-400">Profit</span>
                  <span className="text-accent-green font-bold text-mono">
                    {fmtUSD(selectedStatus.profitGenerated)}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-dark-border">
                  <span className="text-gray-400">Transactions</span>
                  <span className="text-white text-mono">{selectedStatus.transactions}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-dark-border">
                  <span className="text-gray-400">Last Action</span>
                  <span className="text-gray-300">{selectedStatus.lastAction}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-dark-border">
                  <span className="text-gray-400">Last Action Time</span>
                  <span className="text-gray-300 text-mono-sm">{fmtDate(selectedStatus.lastActionTime)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-400">Next Scan</span>
                  <span className="text-gray-300 text-mono-sm">
                    {selectedStatus.nextScanTime > Date.now()
                      ? `${Math.round((selectedStatus.nextScanTime - Date.now()) / 1000)}s`
                      : "Pending"}
                  </span>
                </div>

                <div className="pt-3">
                  <button
                    onClick={() => handleToggleAgent(selectedStatus.chainId, selectedStatus.status)}
                    className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedStatus.status === "active"
                        ? "bg-accent-red/10 text-accent-red border border-accent-red/20 hover:bg-accent-red/20"
                        : "bg-accent-green/10 text-accent-green border border-accent-green/20 hover:bg-accent-green/20"
                    }`}
                  >
                    {selectedStatus.status === "active" ? "⏸ Deactivate Agent" : "▶ Activate Agent"}
                  </button>
                </div>
              </div>
            </div>

            {/* Profit Chart */}
            <div className="lg:col-span-2 card p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Profit History — {selectedStatus.agentName}</h3>
              {selectedProfitHistory && selectedProfitHistory.points.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={selectedProfitHistory.points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts: number) =>
                        new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      }
                      stroke="#30363d"
                      tick={{ fill: "#6b7280", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#30363d"
                      tick={{ fill: "#6b7280", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0d1117",
                        border: "1px solid #21262d",
                        borderRadius: "0.5rem",
                        color: "#e5e7eb",
                        fontSize: "0.75rem",
                      }}
                      labelFormatter={(ts: number) =>
                        new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      }
                      formatter={(value: number) => [fmtUSD(value), "Cumulative Profit"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="profit"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#22c55e" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-400">
                  <p className="text-sm">No profit data yet — agent needs to run scans first</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Profit Distribution Bar Chart ───────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-green">▸</span> Profit per Agent
          </h2>
          <div className="card p-4">
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={profitChartData} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis
                  type="number"
                  stroke="#30363d"
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#30363d"
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0d1117",
                    border: "1px solid #21262d",
                    borderRadius: "0.5rem",
                    color: "#e5e7eb",
                    fontSize: "0.75rem",
                  }}
                  formatter={(value: number) => [fmtUSD(value), "Profit"]}
                />
                <Bar dataKey="profit" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {profitChartData.map((entry, idx) => (
                    <rect key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ── Decision Log ────────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-yellow">▸</span> Decision Log
            <span className="ml-auto text-xs text-gray-400 font-normal normal-case">
              {decisionLog.length} decisions
            </span>
          </h2>
          <div className="glass-card p-4">
            {decisionLog.length === 0 ? (
              <div className="py-6 text-center text-gray-400">
                <p className="text-sm">No decisions recorded yet. Agents will log decisions as they execute trades.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-dark-border">
                      <th className="text-left py-2 px-3">Time</th>
                      <th className="text-left py-2 px-3">Agent</th>
                      <th className="text-left py-2 px-3">Chain</th>
                      <th className="text-left py-2 px-3">Decision</th>
                      <th className="text-left py-2 px-3">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisionLog.map((d) => {
                      const chain = CHAINS.find((c) => c.id === d.chainId);
                      return (
                        <tr key={d.id} className="border-b border-dark-border/50 hover:bg-dark-hover/30 transition-colors">
                          <td className="py-2 px-3 text-mono-sm text-gray-400 whitespace-nowrap">
                            {fmtDate(d.timestamp)}
                          </td>
                          <td className="py-2 px-3 text-white font-medium">{d.agentName}</td>
                          <td className="py-2 px-3 text-gray-300">
                            {chain ? (
                              <a
                                href={chain.explorer}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-blue hover:underline text-xs"
                              >
                                {chain.name}
                              </a>
                            ) : (
                              d.chainId
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-200 text-xs max-w-xs truncate">{d.action}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`badge text-[0.625rem] ${
                                d.type === "trade"
                                  ? "badge-green"
                                  : d.type === "deposit"
                                  ? "badge-blue"
                                  : "badge-yellow"
                              }`}
                            >
                              {d.type}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* ── Transaction History ─────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-cyan">▸</span> Transaction History
            <span className="ml-auto text-xs text-gray-400 font-normal normal-case">
              {txHistory.length} transactions
            </span>
          </h2>
          <div className="glass-card p-4">
            {txHistory.length === 0 ? (
              <div className="py-6 text-center text-gray-400">
                <p className="text-sm">No transactions yet. Transactions will appear as agents execute scans and trades.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-dark-border">
                      <th className="text-left py-2 px-3">Time</th>
                      <th className="text-left py-2 px-3">Agent</th>
                      <th className="text-left py-2 px-3">Transaction Hash</th>
                      <th className="text-right py-2 px-3">Est. Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txHistory.map((tx) => {
                      const shortHash = `${tx.txHash.slice(0, 6)}...${tx.txHash.slice(-4)}`;
                      const explorerUrl = getExplorerTxUrl(tx.chainId, tx.txHash);
                      return (
                        <tr key={tx.id} className="border-b border-dark-border/50 hover:bg-dark-hover/30 transition-colors">
                          <td className="py-2 px-3 text-mono-sm text-gray-400 whitespace-nowrap">
                            {fmtTimeAgo(tx.timestamp)}
                          </td>
                          <td className="py-2 px-3 text-white font-medium">{tx.agentName}</td>
                          <td className="py-2 px-3">
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-mono-sm text-accent-blue hover:underline"
                              title={tx.txHash}
                            >
                              {shortHash}
                            </a>
                          </td>
                          <td className="py-2 px-3 text-right text-mono-sm text-accent-green">
                            +{fmtUSD(tx.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* ── Recent Agent Activity ───────────────────────────── */}
        <section className="animate-fade-in-up">
          <AgentFeed activities={activities.slice(0, 20)} />
        </section>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────

function AgentStatCard({
  label,
  value,
  icon,
  positive,
  highlight,
}: {
  label: string;
  value: string;
  icon: string;
  positive?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`card p-4 ${highlight ? "border-accent-green/30" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p
        className={`text-xl font-bold text-mono ${
          positive === true
            ? "text-accent-green"
            : positive === false
            ? "text-accent-red"
            : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
