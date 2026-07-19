import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { CHAINS } from "~/lib/chains";
import { getAllChainStatus } from "~/lib/blockchain";
import type { ChainStatus } from "~/lib/blockchain";
import { getAllAgentStatuses, getAgentProfitHistory } from "~/lib/agent-runner";
import type { AgentStatus } from "~/lib/agent-runner";
import { getStakingProtocols } from "~/lib/staking";
import type { StakingProtocol } from "~/lib/staking";

export const Route = createFileRoute("/analytics")({
  loader: async () => {
    const [chains, agentStatuses, profitHistory, stakingProtocols] = await Promise.all([
      getAllChainStatus(),
      getAllAgentStatuses(),
      getAgentProfitHistory(),
      getStakingProtocols(),
    ]);
    return { chains, agentStatuses, profitHistory, stakingProtocols };
  },
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const data = Route.useLoaderData();
  const { chains, agentStatuses, profitHistory, stakingProtocols } = data;

  // TVL per chain (estimated from gas/activity)
  const tvlPerChain = useMemo(() => {
    return chains.map(c => ({
      name: c.name,
      tvl: c.online ? Math.round((c.blockHeight ?? 0) * 0.0001 + (c.gasPrice ?? 0) * 100) : 0,
      gasUsed: c.gasPrice ?? 0,
      online: c.online,
    }));
  }, [chains]);

  // Profit per agent
  const profitPerAgent = useMemo(() => {
    return agentStatuses.map(a => ({
      name: a.agentName,
      profit: Math.round(a.profitGenerated * 100) / 100,
      tx: a.transactions,
    })).sort((a, b) => b.profit - a.profit);
  }, [agentStatuses]);

  // Gas spent per chain
  const gasPerChain = useMemo(() => {
    return chains.filter(c => c.online && c.gasPrice).map(c => ({
      name: c.name,
      gas: c.gasPrice ?? 0,
    })).sort((a, b) => b.gas - a.gas);
  }, [chains]);

  // Top staking strategies
  const topStrategies = useMemo(() => {
    return stakingProtocols.slice(0, 5).map(p => ({
      name: `${p.name} (${p.asset})`,
      apy: p.apy,
      chain: p.chain,
    }));
  }, [stakingProtocols]);

  // P&L summary
  const totalProfit = useMemo(() => agentStatuses.reduce((s, a) => s + a.profitGenerated, 0), [agentStatuses]);
  const totalTx = useMemo(() => agentStatuses.reduce((s, a) => s + a.transactions, 0), [agentStatuses]);
  const onlineChains = useMemo(() => chains.filter(c => c.online).length, [chains]);

  const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const fmtAPY = (n: number) => `${n.toFixed(2)}%`;

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <section className="animate-fade-in">
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
            <span>📊</span> Analytics
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Total Value Locked, profit, gas, și performance metrics
          </p>
        </section>

        {/* Summary Cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up">
          <SummaryCard label="Total Profit" value={fmtUSD(totalProfit)} icon="💰" positive={true} />
          <SummaryCard label="Total Transactions" value={totalTx.toLocaleString()} icon="📈" />
          <SummaryCard label="Chains Online" value={`${onlineChains}/${chains.length}`} icon="🔗" positive={onlineChains > chains.length * 0.8} />
          <SummaryCard label="Active Strategies" value={stakingProtocols.length.toString()} icon="🎯" />
        </section>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* P&L per Agent Bar Chart */}
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-green">▸</span> Profit per Agent
            </h2>
            <div className="glass-card p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={profitPerAgent} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis type="number" stroke="#30363d" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => `$${v}`} />
                  <YAxis dataKey="name" type="category" stroke="#30363d" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={55} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '0.5rem', color: '#e5e7eb', fontSize: '0.75rem' }}
                    formatter={(value: number) => [fmtUSD(value), 'Profit']} />
                  <Bar dataKey="profit" fill="#22c55e" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Gas per Chain */}
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-yellow">▸</span> Gas Price per Chain (Gwei)
            </h2>
            <div className="glass-card p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={gasPerChain} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis type="number" stroke="#30363d" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => `${v}gwei`} />
                  <YAxis dataKey="name" type="category" stroke="#30363d" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={55} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '0.5rem', color: '#e5e7eb', fontSize: '0.75rem' }}
                    formatter={(value: number) => [`${value.toFixed(1)} gwei`, 'Gas']} />
                  <Bar dataKey="gas" fill="#eab308" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Strategies */}
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-blue">▸</span> Top Performing Strategies
            </h2>
            <div className="glass-card p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topStrategies} margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="name" stroke="#30363d" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" />
                  <YAxis stroke="#30363d" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '0.5rem', color: '#e5e7eb', fontSize: '0.75rem' }}
                    formatter={(value: number) => [fmtAPY(value), 'APY']} />
                  <Bar dataKey="apy" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* TVL per Chain */}
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-teal">▸</span> Estimated TVL per Chain
            </h2>
            <div className="glass-card p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={tvlPerChain} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis type="number" stroke="#30363d" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`} />
                  <YAxis dataKey="name" type="category" stroke="#30363d" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={55} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '0.5rem', color: '#e5e7eb', fontSize: '0.75rem' }}
                    formatter={(value: number) => [fmtUSD(value), 'Est. TVL']} />
                  <Bar dataKey="tvl" fill="#14b8a6" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        {/* Detailed Chain Table */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Chain Details
          </h2>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-gray-400">
                    <th className="text-left py-3 px-4 font-medium">Chain</th>
                    <th className="text-right py-3 px-4 font-medium">Status</th>
                    <th className="text-right py-3 px-4 font-medium">Block</th>
                    <th className="text-right py-3 px-4 font-medium">Gas (gwei)</th>
                    <th className="text-right py-3 px-4 font-medium">Latency</th>
                    <th className="text-right py-3 px-4 font-medium">Est. TVL</th>
                  </tr>
                </thead>
                <tbody>
                  {chains.map((chain) => (
                    <tr key={chain.id} className="border-b border-dark-border hover:bg-dark-hover transition-colors">
                      <td className="py-3 px-4">
                        <span className="text-white font-medium">{chain.name}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={chain.online ? 'badge-green' : 'badge-red'}>
                          {chain.online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-mono-sm text-gray-200">
                        {chain.blockHeight?.toLocaleString() ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-mono-sm text-gray-200">
                        {chain.gasPrice ? `${chain.gasPrice.toFixed(1)}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-mono-sm">
                        <span className={chain.online ? 'text-accent-green' : 'text-accent-red'}>
                          {chain.latency ? `${chain.latency}ms` : '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-mono-sm text-gray-300">
                        {chain.online ? fmtUSD((chain.blockHeight ?? 0) * 0.0001) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, positive }: { label: string; value: string; icon: string; positive?: boolean }) {
  return (
    <div className="glass-card p-4">
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
