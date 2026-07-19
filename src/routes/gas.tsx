import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { CHAINS } from "~/lib/chains";
import { fetchGasState, toggleAutoSchedule } from "~/lib/gas-optimizer";
import type { GasOptimizerState, CheapWindow } from "~/lib/gas-optimizer";

export const Route = createFileRoute("/gas")({
  loader: async () => {
    try {
      const state = await fetchGasState();
      return { state };
    } catch {
      return { state: null };
    }
  },
  component: GasPage,
});

const CHAIN_GROUPS: Record<string, { label: string; chains: string[] }> = {
  l1: {
    label: "Layer 1",
    chains: ["ethereum", "bnb", "solana", "avalanche", "fantom", "near", "aptos", "sui", "tron"],
  },
  l2: {
    label: "Layer 2 / Rollups",
    chains: ["arbitrum", "optimism", "base", "zksync", "linea", "scroll", "polygon", "mantle"],
  },
  other: {
    label: "Other",
    chains: ["gnosis", "celo", "moonbeam"],
  },
};

function formatGwei(n: number): string {
  if (n >= 1) return `${n.toFixed(1)} gwei`;
  if (n >= 0.001) return `${(n * 1000).toFixed(2)} mgwei`;
  return `${(n * 1e6).toFixed(1)} µgwei`;
}

function getGasColor(gwei: number, maxGwei: number): string {
  const ratio = maxGwei > 0 ? gwei / maxGwei : 0;
  if (ratio < 0.15) return "bg-accent-green/80";
  if (ratio < 0.35) return "bg-accent-teal/80";
  if (ratio < 0.55) return "bg-accent-yellow/80";
  if (ratio < 0.75) return "bg-orange-500/80";
  return "bg-accent-red/80";
}

function getHeatmapIntensity(avgGwei: number, maxGwei: number): string {
  const ratio = maxGwei > 0 ? avgGwei / maxGwei : 0;
  if (ratio < 0.15) return "rgba(34, 197, 94, 0.7)";  // green
  if (ratio < 0.35) return "rgba(20, 184, 166, 0.7)"; // teal
  if (ratio < 0.55) return "rgba(234, 179, 8, 0.7)";  // yellow
  if (ratio < 0.75) return "rgba(249, 115, 22, 0.7)"; // orange
  return "rgba(239, 68, 68, 0.7)"; // red
}

function GasPage() {
  const initial = Route.useLoaderData();
  const [state, setState] = useState<GasOptimizerState | null>(initial.state);
  const [autoSched, setAutoSched] = useState(initial.state?.autoScheduleEnabled ?? false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      setRefreshing(true);
      try {
        const fresh = await fetchGasState();
        setState(fresh);
        setAutoSched(fresh.autoScheduleEnabled);
      } catch { /* keep current */ }
      setRefreshing(false);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleAuto = async () => {
    const next = !autoSched;
    setAutoSched(next);
    try {
      await toggleAutoSchedule({ data: { enabled: next } });
    } catch {
      setAutoSched(!next); // revert
    }
  };

  // Compute max gwei for coloring
  const allGweis = state
    ? Object.values(state.currentPrices)
        .filter((p): p is { gwei: number; timestamp: number } => p !== null)
        .map((p) => p.gwei)
    : [];
  const maxGwei = allGweis.length > 0 ? Math.max(...allGweis) : 100;

  // Compute max heatmap gwei
  const allHeatGweis = state?.heatmap.map((c) => c.avgGwei) ?? [];
  const maxHeatGwei = allHeatGweis.length > 0 ? Math.max(...allHeatGweis) : 100;

  // Build heatmap grid
  const heatmapGrid = CHAINS.map((chain) => {
    const cells = state?.heatmap.filter((c) => c.chainId === chain.id) ?? [];
    const hourMap: Record<number, number> = {};
    for (const c of cells) {
      hourMap[c.hour] = c.avgGwei;
    }
    return { chain, hourMap };
  });

  const totalSavingsUSD = (state?.savings ?? []).reduce((sum, s) => sum + s.estimatedSavingsUSD, 0);
  const totalTxScheduled = (state?.savings ?? []).reduce((sum, s) => sum + s.totalTxScheduled, 0);

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ──────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⛽</span>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Gas Optimizer</h1>
            </div>
            <div className="flex items-center gap-3">
              {refreshing && (
                <span className="text-xs text-accent-blue animate-pulse-slow">⟳ updating...</span>
              )}
              <button
                onClick={handleToggleAuto}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 border ${
                  autoSched
                    ? "bg-accent-green/15 text-accent-green border-accent-green/30 shadow-[0_0_12px_rgba(34,197,94,0.2)]"
                    : "bg-dark-surface text-gray-400 border-dark-border hover:border-dark-border-light"
                }`}
              >
                {autoSched ? "⚡ Auto-Schedule ON" : "Auto-Schedule OFF"}
              </button>
            </div>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm mt-1">
            Monitor gas prices across 20 chains and schedule transactions during the cheapest windows.
            {autoSched && " Auto-scheduling is active — tasks are being routed to low-gas windows."}
          </p>
        </section>

        {/* ── Savings Tracker Card ────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in-up">
          <div className="glass-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-green/10 flex items-center justify-center shrink-0">
              <span className="text-lg">💰</span>
            </div>
            <div>
              <p className="text-xs text-gray-400">Estimated Savings</p>
              <p className="text-xl font-bold text-accent-green text-mono">
                ${totalSavingsUSD.toFixed(4)}
              </p>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-blue/10 flex items-center justify-center shrink-0">
              <span className="text-lg">📤</span>
            </div>
            <div>
              <p className="text-xs text-gray-400">Gas-Aware TXs Scheduled</p>
              <p className="text-xl font-bold text-white text-mono">{totalTxScheduled.toLocaleString()}</p>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-purple/10 flex items-center justify-center shrink-0">
              <span className="text-lg">🕐</span>
            </div>
            <div>
              <p className="text-xs text-gray-400">Last Updated</p>
              <p className="text-sm font-bold text-white text-mono">
                {state?.lastUpdated
                  ? new Date(state.lastUpdated).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                  : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* ── Current Gas Prices Table ────────────────────── */}
        <section className="glass-card p-5 sm:p-6 animate-fade-in-up">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-accent-cyan">📡</span> Live Gas Prices
          </h2>

          {(["l1", "l2", "other"] as const).map((groupKey) => {
            const group = CHAIN_GROUPS[groupKey];
            const groupChains = CHAINS.filter((c) => group.chains.includes(c.id));

            return (
              <div key={groupKey} className="mb-4 last:mb-0">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {groupChains.map((chain) => {
                    const price = state?.currentPrices[chain.id];
                    const gwei = price?.gwei ?? null;
                    return (
                      <div
                        key={chain.id}
                        className="flex items-center gap-2 p-2.5 rounded-lg bg-dark-surface border border-dark-border hover:border-dark-border-light transition-colors"
                      >
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            gwei !== null ? getGasColor(gwei, maxGwei) : "bg-gray-600"
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-200 truncate">{chain.name}</p>
                          <p className="text-xs text-mono text-gray-400">
                            {gwei !== null ? formatGwei(gwei) : "—"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        {/* ── Gas Heatmap ─────────────────────────────────── */}
        <section className="glass-card p-5 sm:p-6 overflow-hidden animate-fade-in-up">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-accent-yellow">🔥</span> Gas Heatmap (24h)
            <span className="text-[10px] text-gray-400 font-normal ml-1">
              — darker = more expensive
            </span>
          </h2>

          <div className="overflow-x-auto -mx-5 sm:-mx-6">
            <div className="min-w-[700px] px-5 sm:px-6">
              {/* Header row with hours */}
              <div className="flex mb-1">
                <div className="w-24 shrink-0" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="flex-1 text-center text-[9px] text-gray-400 font-mono"
                  >
                    {h.toString().padStart(2, "0")}
                  </div>
                ))}
              </div>

              {/* Chain rows */}
              {heatmapGrid.map(({ chain, hourMap }) => {
                const chainMax = Math.max(...Object.values(hourMap), 0.00001);
                return (
                  <div key={chain.id} className="flex items-center mb-0.5">
                    <div className="w-24 shrink-0 pr-2">
                      <p className="text-[10px] text-gray-300 truncate">{chain.name}</p>
                    </div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const gwei = hourMap[h];
                      const hasData = gwei !== undefined;
                      return (
                        <div
                          key={h}
                          className="flex-1 aspect-[2/1] mx-[0.5px] rounded-sm transition-all duration-200 hover:scale-110"
                          style={{
                            backgroundColor: hasData
                              ? getHeatmapIntensity(gwei, maxHeatGwei)
                              : "rgba(33, 38, 45, 0.3)",
                          }}
                          title={
                            hasData
                              ? `${chain.name} @ ${h}:00 — avg ${formatGwei(gwei)}`
                              : `${chain.name} @ ${h}:00 — no data`
                          }
                        />
                      );
                    })}
                  </div>
                );
              })}

              {/* Legend */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dark-border">
                <span className="text-[10px] text-gray-400">Cheap</span>
                <div className="flex gap-[1px]">
                  {["rgba(34,197,94,0.7)", "rgba(20,184,166,0.7)", "rgba(234,179,8,0.7)", "rgba(249,115,22,0.7)", "rgba(239,68,68,0.7)"].map(
                    (color, i) => (
                      <div
                        key={i}
                        className="w-4 h-3 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                    )
                  )}
                </div>
                <span className="text-[10px] text-gray-400">Expensive</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Cheap Windows Recommendations ───────────────── */}
        {state?.cheapWindows && state.cheapWindows.length > 0 && (
          <section className="glass-card p-5 sm:p-6 animate-fade-in-up">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <span className="text-accent-green">✅</span> Cheap Window Recommendations
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {state.cheapWindows.map((win, i) => (
                <CheapWindowCard key={`${win.chainId}-${win.startHour}-${i}`} window={win} />
              ))}
            </div>
          </section>
        )}

        {/* ── Savings Breakdown ───────────────────────────── */}
        {state?.savings && state.savings.filter((s) => s.totalTxScheduled > 0).length > 0 && (
          <section className="glass-card p-5 sm:p-6 animate-fade-in-up">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <span className="text-accent-green">💵</span> Savings by Chain
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-gray-400">
                    <th className="text-left py-2 px-3 font-medium">Chain</th>
                    <th className="text-right py-2 px-3 font-medium">TXs Scheduled</th>
                    <th className="text-right py-2 px-3 font-medium">Gwei Saved</th>
                    <th className="text-right py-2 px-3 font-medium">Est. USD</th>
                  </tr>
                </thead>
                <tbody>
                  {state.savings
                    .filter((s) => s.totalTxScheduled > 0)
                    .sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD)
                    .map((s) => (
                      <tr key={s.chainId} className="border-b border-dark-border/50">
                        <td className="py-2 px-3 text-gray-200 font-medium">{s.chainName}</td>
                        <td className="py-2 px-3 text-right text-mono text-gray-300">
                          {s.totalTxScheduled.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right text-mono text-accent-green">
                          {formatGwei(s.estimatedSavingsGwei)}
                        </td>
                        <td className="py-2 px-3 text-right text-mono text-accent-green">
                          ${s.estimatedSavingsUSD.toFixed(6)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function CheapWindowCard({ window: win }: { window: CheapWindow }) {
  const formatHour = (h: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    return `${hour12}${ampm}`;
  };

  const confidenceColors: Record<string, string> = {
    high: "badge-green",
    medium: "badge-yellow",
    low: "badge-red",
  };

  return (
    <div className="p-3 rounded-lg bg-dark-surface border border-dark-border hover:border-accent-green/30 transition-all duration-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-white">{win.chainName}</span>
        <span className={`badge text-[9px] ${confidenceColors[win.confidence] ?? "badge-blue"}`}>
          {win.confidence.toUpperCase()}
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between">
          <span className="text-[10px] text-gray-400">Window</span>
          <span className="text-xs text-mono text-accent-cyan">
            {formatHour(win.startHour)} – {formatHour(win.endHour)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-gray-400">Avg Gas</span>
          <span className="text-xs text-mono text-accent-green">{formatGwei(win.avgGwei)}</span>
        </div>
      </div>
    </div>
  );
}
