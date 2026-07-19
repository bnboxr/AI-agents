import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
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

function AgentsPage() {
  const initial = Route.useLoaderData();
  const [statuses, setStatuses] = useState<AgentStatus[]>(initial.statuses);
  const [profitHistory] = useState(initial.profitHistory);
  const [activities] = useState(initial.activities);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'idle' | 'error'>('all');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const filteredStatuses = useMemo(() => {
    if (filter === 'all') return statuses;
    return statuses.filter(s => s.status === filter);
  }, [statuses, filter]);

  const selectedProfitHistory = useMemo(() => {
    if (!selectedAgent) return null;
    return profitHistory.find(h => h.agentId === selectedAgent);
  }, [selectedAgent, profitHistory]);

  const selectedStatus = useMemo(() => {
    if (!selectedAgent) return null;
    return statuses.find(s => s.chainId === selectedAgent);
  }, [selectedAgent, statuses]);

  const handleToggleAgent = async (chainId: string, currentStatus: string) => {
    const newActive = currentStatus !== 'active';
    try {
      const updated = await toggleAgentStatus({
        data: { chainId, active: newActive },
      });
      setStatuses(prev => prev.map(s => s.chainId === chainId ? updated : s));
    } catch { /* keep current state */ }
  };

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await runAllAgentScans();
      const refreshed = await getAllAgentStatuses();
      setStatuses(refreshed);
    } catch { /* keep current */ }
    setScanning(false);
  };

  const totalProfit = useMemo(() => statuses.reduce((s, a) => s + a.profitGenerated, 0), [statuses]);
  const totalTx = useMemo(() => statuses.reduce((s, a) => s + a.transactions, 0), [statuses]);
  const activeCount = useMemo(() => statuses.filter(s => s.status === 'active').length, [statuses]);

  const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const fmtDate = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const fmtTimeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
    return `${Math.round(diff / 60000)}m ago`;
  };

  // Profit chart data
  const profitChartData = useMemo(() => {
    return statuses.map(s => ({
      name: s.agentName,
      profit: Math.round(s.profitGenerated * 100) / 100,
      fill: s.status === 'active' ? '#3b82f6' : s.status === 'scanning' ? '#06b6d4' : '#6b7280',
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
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                20 agenți AI specializați — fiecare monitorizează un chain
              </p>
            </div>
            <button
              onClick={handleScanAll}
              disabled={scanning}
              className="glass-button text-sm px-6 py-2 disabled:opacity-50"
            >
              {scanning ? "⚡ Scanning..." : "⚡ Run All Scans"}
            </button>
          </div>
        </section>

        {/* ── Stats Bar ──────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up">
          <AgentStatCard label="Active Agents" value={`${activeCount}/${statuses.length}`} icon="🟢" />
          <AgentStatCard label="Total Profit" value={fmtUSD(totalProfit)} icon="💰" positive={true} />
          <AgentStatCard label="Total Transactions" value={totalTx.toString()} icon="📊" />
          <AgentStatCard label="Scan Interval" value="60s" icon="⏱️" />
        </section>

        {/* ── Filter + Agent Grid ────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <span className="text-accent-blue">▸</span> All Agents — {statuses.length} Total
            </h2>
            <div className="flex gap-1.5">
              {(['all', 'active', 'idle', 'error'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filter === f
                      ? 'bg-accent-blue text-white'
                      : 'card text-gray-400 hover:text-white'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'idle' ? 'Idle' : 'Error'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredStatuses.map((agent) => {
              const agentConfig = AGENTS[agent.chainId];
              const isSelected = selectedAgent === agent.chainId;
              return (
                <button
                  key={agent.chainId}
                  onClick={() => setSelectedAgent(isSelected ? null : agent.chainId)}
                  className={`card p-4 text-left transition-all duration-200 animate-fade-in-up ${
                    isSelected ? 'border-accent-blue bg-dark-hover scale-[1.02]' : ''
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{agent.icon}</span>
                      <span className="text-sm font-bold text-white">{agent.agentName}</span>
                    </div>
                    <span className={`status-dot ${agent.status === 'active' ? 'status-dot-online' : agent.status === 'error' ? 'status-dot-offline' : 'status-dot'}`}
                      style={agent.status === 'scanning' ? { background: '#06b6d4', boxShadow: '0 0 6px rgba(6,182,212,0.5)' } : agent.status === 'idle' ? { background: '#6b7280' } : {}}
                    ></span>
                  </div>

                  {/* Strategy tags */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {agent.strategies.slice(0, 2).map((s, i) => (
                      <span key={i} className="badge-blue text-[0.55rem]">{s.replace(/-/g, ' ')}</span>
                    ))}
                    {agent.strategies.length > 2 && (
                      <span className="badge text-[0.55rem] text-gray-400">+{agent.strategies.length - 2}</span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Profit:</span>
                      <span className="text-mono-sm text-accent-green font-bold">{fmtUSD(agent.profitGenerated)}</span>
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
                        {agent.nextScanTime > Date.now() ? `${Math.round((agent.nextScanTime - Date.now()) / 1000)}s` : 'now'}
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
                <span className={`ml-auto badge ${
                  selectedStatus.status === 'active' ? 'badge-green' :
                  selectedStatus.status === 'scanning' ? 'badge-cyan' :
                  selectedStatus.status === 'error' ? 'badge-red' :
                  'badge'
                }`}>
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
                  <span className="text-accent-green font-bold text-mono">{fmtUSD(selectedStatus.profitGenerated)}</span>
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
                      : 'Pending'}
                  </span>
                </div>

                <div className="pt-3">
                  <button
                    onClick={() => handleToggleAgent(selectedStatus.chainId, selectedStatus.status)}
                    className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedStatus.status === 'active'
                        ? 'bg-accent-red/10 text-accent-red border border-accent-red/20 hover:bg-accent-red/20'
                        : 'bg-accent-green/10 text-accent-green border border-accent-green/20 hover:bg-accent-green/20'
                    }`}
                  >
                    {selectedStatus.status === 'active' ? '⏸ Deactivate Agent' : '▶ Activate Agent'}
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
                      tickFormatter={(ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      stroke="#30363d"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#30363d"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0d1117',
                        border: '1px solid #21262d',
                        borderRadius: '0.5rem',
                        color: '#e5e7eb',
                        fontSize: '0.75rem',
                      }}
                      labelFormatter={(ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      formatter={(value: number) => [fmtUSD(value), 'Cumulative Profit']}
                    />
                    <Line
                      type="monotone"
                      dataKey="profit"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#22c55e' }}
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
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#30363d"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '0.5rem',
                    color: '#e5e7eb',
                    fontSize: '0.75rem',
                  }}
                  formatter={(value: number) => [fmtUSD(value), 'Profit']}
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

        {/* ── Recent Agent Activity ───────────────────────────── */}
        <section className="animate-fade-in-up">
          <AgentFeed activities={activities.slice(0, 20)} />
        </section>
      </div>
    </div>
  );
}

function AgentStatCard({ label, value, icon, positive }: { label: string; value: string; icon: string; positive?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={`text-xl font-bold text-mono ${positive === true ? 'text-accent-green' : positive === false ? 'text-accent-red' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}
// (imports moved to top of file)
