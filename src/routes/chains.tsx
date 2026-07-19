import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getAllChainStatus } from "~/lib/blockchain";
import { AGENTS } from "~/lib/agents";
import type { ChainStatus } from "~/lib/blockchain";

export const Route = createFileRoute("/chains")({
  loader: async () => {
    const chains = await getAllChainStatus();
    return { chains };
  },
  component: ChainsPage,
});

function ChainsPage() {
  const initial = Route.useLoaderData();
  const [chains, setChains] = useState(initial.chains);
  const [refreshing, setRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      setRefreshing(true);
      try {
        const result = await getAllChainStatus();
        setChains(result);
      } catch {
        // keep current
      }
      setRefreshing(false);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const onlineChains = chains.filter((c) => c.online);
  const offlineChains = chains.filter((c) => !c.online);

  const fmtNum = (n: number) => n.toLocaleString("en-US");
  const fmtLatency = (n: number | null) => n !== null ? `${n}ms` : "—";

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ──────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🔗</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Chain Explorer</h1>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm">
            Real-time status for {chains.length} blockchain networks. Click any chain for detailed metrics, charts, and agent controls.
            {refreshing && <span className="ml-2 text-accent-blue animate-pulse-slow">⟳ refreshing...</span>}
          </p>
        </section>

        {/* ── Summary Stats ───────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-white text-mono">{chains.length}</p>
            <p className="text-xs text-gray-400 mt-1">Total Chains</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-green text-mono">{onlineChains.length}</p>
            <p className="text-xs text-gray-400 mt-1">Online</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-red text-mono">{offlineChains.length}</p>
            <p className="text-xs text-gray-400 mt-1">Offline</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-blue text-mono">
              {onlineChains.length > 0
                ? Math.round(onlineChains.reduce((s, c) => s + (c.latency ?? 0), 0) / onlineChains.length)
                : "—"}
            </p>
            <p className="text-xs text-gray-400 mt-1">Avg Latency (ms)</p>
          </div>
        </section>

        {/* ── All Chains Grid ─────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> All Networks — {chains.length} Chains
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {chains.map((chain, i) => (
              <ChainCard
                key={chain.id}
                chain={chain}
                delay={i * 30}
                fmtNum={fmtNum}
                fmtLatency={fmtLatency}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function ChainCard({
  chain, delay, fmtNum, fmtLatency,
}: {
  chain: ChainStatus;
  delay: number;
  fmtNum: (n: number) => string;
  fmtLatency: (n: number | null) => string;
}) {
  const agent = AGENTS[chain.id];

  return (
    <Link
      to="/chains/$chainId"
      params={{ chainId: chain.id }}
      className="card-interactive p-4 animate-fade-in-up group block"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={chain.online ? "status-dot-online" : "status-dot-offline"}></span>
          <span className="text-sm font-semibold text-white group-hover:text-accent-blue transition-colors">
            {chain.name}
          </span>
        </div>
        <span className={`badge ${chain.online ? 'badge-green' : 'badge-red'}`}>
          {chain.online ? 'Live' : 'Down'}
        </span>
      </div>

      {/* Metrics */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">Block</span>
          <span className="text-mono-sm text-gray-200">{chain.blockHeight !== null ? fmtNum(chain.blockHeight) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Gas</span>
          <span className="text-mono-sm text-gray-200">
            {chain.gasPrice !== null ? `${chain.gasPrice.toFixed(1)} gwei` : chain.online ? "N/A" : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Latency</span>
          <span className={`text-mono-sm ${chain.online ? 'text-accent-green' : 'text-accent-red'}`}>
            {fmtLatency(chain.latency)}
          </span>
        </div>
      </div>

      {/* Agent indicator */}
      {agent && (
        <div className="mt-3 pt-2 border-t border-dark-border flex items-center gap-1.5">
          <span className="text-xs">{agent.icon}</span>
          <span className="text-[0.625rem] text-gray-400">{agent.name}</span>
          <span className="ml-auto text-[0.5rem] text-accent-blue opacity-0 group-hover:opacity-100 transition-opacity">
            Details →
          </span>
        </div>
      )}
    </Link>
  );
}
