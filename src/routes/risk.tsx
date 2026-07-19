import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import {
  getRiskStateRaw,
  setRiskLimits,
  resetCircuitBreaker,
  toggleAgentRiskStatus,
  simulateMarketCrash,
  type RiskSystemState,
  type AgentRiskState,
  type RiskLimits,
} from "~/lib/risk-engine";

// ── Route ──────────────────────────────────────────────────────────

export const Route = createFileRoute("/risk")({
  loader: async () => {
    return await getRiskStateRaw();
  },
  component: RiskPage,
});

// ── Helpers ────────────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score <= 3) return "text-accent-green";
  if (score <= 6) return "text-accent-yellow";
  return "text-accent-red";
}

function riskBgColor(score: number): string {
  if (score <= 3) return "bg-accent-green/10 border-accent-green/30";
  if (score <= 6) return "bg-accent-yellow/10 border-accent-yellow/30";
  return "bg-accent-red/10 border-accent-red/30";
}

function statusBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case "active":
      return { cls: "badge-green", label: "Active" };
    case "paused":
      return { cls: "badge-yellow", label: "Paused" };
    case "stopped":
      return { cls: "badge-red", label: "Stopped" };
    default:
      return { cls: "badge-blue", label: status };
  }
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

// ── Circular Gauge Component ───────────────────────────────────────

function CircularGauge({
  value,
  max,
  label,
  subtitle,
  size = 120,
  strokeWidth = 10,
}: {
  value: number;
  max: number;
  label: string;
  subtitle?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(1, Math.max(0, value / max));
  const offset = circumference * (1 - pct);
  const color = value <= max * 0.33 ? "#22c55e" : value <= max * 0.66 ? "#eab308" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(33,38,45,0.6)"
          strokeWidth={strokeWidth}
        />
        {/* Foreground arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center" style={{ marginTop: `${size / 2 - 10}px` }}>
        <span className="text-2xl font-black text-white">{value}</span>
        <span className="text-xs text-gray-400">/ {max}</span>
      </div>
      <div className="text-center mt-2">
        <p className="text-sm font-semibold text-white">{label}</p>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Gauge Card Component ───────────────────────────────────────────

function GaugeCard({
  icon,
  title,
  value,
  subtitle,
  colorClass,
  children,
}: {
  icon: string;
  title: string;
  value: string;
  subtitle?: string;
  colorClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="glass-card p-5 relative overflow-hidden">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-2xl">{icon}</span>
          <h3 className="text-sm font-medium text-gray-400 mt-1">{title}</h3>
        </div>
      </div>
      <p className={`text-3xl font-black ${colorClass ?? "text-white"}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      {children}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────

function RiskPage() {
  const initial = Route.useLoaderData();
  const [state, setState] = useState<RiskSystemState>(initial);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editLimits, setEditLimits] = useState<RiskLimits>(initial.limits);
  const [savingLimits, setSavingLimits] = useState(false);
  const [resettingCB, setResettingCB] = useState(false);

  // ── Auto-refresh ────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const fresh = await getRiskStateRaw();
      setState(fresh);
      setEditLimits((prev) => ({ ...prev, ...fresh.limits }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // ── Actions ─────────────────────────────────────────────────────

  const handleToggleAgent = useCallback(async (chainId: string, currentStatus: string) => {
    setLoading(true);
    try {
      const newStatus = currentStatus === "active" ? "paused" : "active";
      await toggleAgentRiskStatus({ data: { chainId, status: newStatus as "active" | "paused" } });
      await refresh();
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [refresh]);

  const handleResetCB = useCallback(async () => {
    setResettingCB(true);
    try {
      await resetCircuitBreaker();
      await refresh();
    } catch { /* ignore */ }
    finally { setResettingCB(false); }
  }, [refresh]);

  const handleSaveLimits = useCallback(async () => {
    setSavingLimits(true);
    try {
      await setRiskLimits({ data: { limits: editLimits } });
      setEditMode(false);
      await refresh();
    } catch { /* ignore */ }
    finally { setSavingLimits(false); }
  }, [editLimits, refresh]);

  const handleSimCrash = useCallback(async (pct: number) => {
    setLoading(true);
    try {
      await simulateMarketCrash({ data: { dropPct: pct } });
      await refresh();
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [refresh]);

  // ── Derived ─────────────────────────────────────────────────────

  const agentList: AgentRiskState[] = Object.values(state.agents).sort(
    (a, b) => b.riskScore - a.riskScore
  );

  const circuitBreakerColor = state.circuitBreakerTripped
    ? "text-accent-red"
    : "text-accent-green";
  const circuitBreakerIcon = state.circuitBreakerTripped ? "🔴" : "🟢";
  const circuitBreakerLabel = state.circuitBreakerTripped
    ? "TRIPPED"
    : "Normal";

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh pt-20 pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Page header */}
        <div className="mb-8 animate-fade-in-up">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🛡️</span>
              <div>
                <h1 className="text-3xl sm:text-4xl font-black text-white">
                  Risk Management
                </h1>
                <p className="text-gray-400 text-sm mt-1">
                  Real-time risk monitoring and circuit breaker controls
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refresh}
                disabled={loading}
                className="text-xs px-4 py-2 rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-accent-blue/40 transition-all duration-200"
              >
                {loading ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Top Row: Gauge Cards ───────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
          {/* Overall Risk Score */}
          <GaugeCard
            icon="⚠️"
            title="Overall Risk Score"
            value={`${state.overallRiskScore}`}
            subtitle="out of 10"
            colorClass={riskColor(state.overallRiskScore)}
          >
            <div className="mt-3 h-2 rounded-full bg-dark-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  state.overallRiskScore <= 3 ? "bg-accent-green" : state.overallRiskScore <= 6 ? "bg-accent-yellow" : "bg-accent-red"
                }`}
                style={{ width: `${state.overallRiskScore * 10}%` }}
              />
            </div>
          </GaugeCard>

          {/* Active Agents */}
          <GaugeCard
            icon="🤖"
            title="Active Agents"
            value={`${state.activeAgentCount}`}
            subtitle={`${state.pausedAgentCount} paused`}
            colorClass="text-accent-blue"
          >
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-dark-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent-blue transition-all duration-500"
                  style={{
                    width: `${state.activeAgentCount + state.pausedAgentCount > 0 ? (state.activeAgentCount / (state.activeAgentCount + state.pausedAgentCount)) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-500">
                {state.activeAgentCount + state.pausedAgentCount > 0
                  ? Math.round((state.activeAgentCount / (state.activeAgentCount + state.pausedAgentCount)) * 100)
                  : 0}%
              </span>
            </div>
          </GaugeCard>

          {/* Circuit Breaker */}
          <GaugeCard
            icon={circuitBreakerIcon}
            title="Circuit Breaker"
            value={circuitBreakerLabel}
            colorClass={circuitBreakerColor}
            subtitle={state.circuitBreakerTripped ? state.circuitBreakerReason : `Market: ${state.marketDropPct.toFixed(1)}% drop`}
          >
            {state.circuitBreakerTripped && (
              <button
                onClick={handleResetCB}
                disabled={resettingCB}
                className="mt-3 w-full glass-button text-sm py-2 bg-accent-red/80 hover:bg-accent-red"
              >
                {resettingCB ? "Resetting…" : "Reset Circuit Breaker"}
              </button>
            )}
          </GaugeCard>

          {/* Total Exposure */}
          <GaugeCard
            icon="💰"
            title="Total Exposure"
            value={formatUsd(state.totalExposure)}
            subtitle={`${Object.keys(state.agents).length} agents`}
            colorClass="text-accent-teal"
          >
            <div className="mt-3 h-2 rounded-full bg-dark-border overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-teal transition-all duration-500"
                style={{ width: `${Math.min(100, (state.totalExposure / (state.limits.maxExposurePerChain * 10)) * 100)}%` }}
              />
            </div>
          </GaugeCard>
        </div>

        {/* ── Circuit Breaker Controls + Simulator ───────────────── */}
        {!state.circuitBreakerTripped && (
          <div className="glass-card p-5 mb-8 animate-fade-in-up" style={{ animationDelay: "0.15s" }}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white">🔬 Circuit Breaker Test</h3>
                <p className="text-xs text-gray-500 mt-1">Simulate a market crash to test circuit breaker response.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSimCrash(20)}
                  disabled={loading}
                  className="text-xs px-4 py-2 rounded-lg border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-all duration-200 disabled:opacity-40"
                >
                  Simulate -20%
                </button>
                <button
                  onClick={() => handleSimCrash(30)}
                  disabled={loading}
                  className="text-xs px-4 py-2 rounded-lg border border-accent-red/50 text-accent-red hover:bg-accent-red/20 transition-all duration-200 disabled:opacity-40 font-medium"
                >
                  Simulate -30%
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Per-Agent Risk Breakdown Table ──────────────────────── */}
        <div className="glass-card overflow-hidden mb-8 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
          <div className="p-5 border-b border-dark-border flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-sm font-semibold text-white">📊 Per-Agent Risk Breakdown</h3>
            <span className="text-xs text-gray-500">{agentList.length} agents monitored</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium">Agent</th>
                  <th className="py-3 px-4 font-medium">Chain</th>
                  <th className="py-3 px-4 font-medium text-right">Drawdown</th>
                  <th className="py-3 px-4 font-medium text-right">Exposure</th>
                  <th className="py-3 px-4 font-medium text-right">Volatility</th>
                  <th className="py-3 px-4 font-medium text-center">Risk Score</th>
                  <th className="py-3 px-4 font-medium text-center">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agentList.map((agent, i) => {
                  const badge = statusBadge(agent.status);
                  const chain = agent.chainId;
                  return (
                    <tr
                      key={chain}
                      className={`border-b border-dark-border/50 hover:bg-dark-hover/40 transition-colors ${
                        i % 2 === 0 ? "bg-dark-surface/30" : ""
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{agent.icon}</span>
                          <span className="font-medium text-white">{agent.agentName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-dark-border text-gray-400 capitalize">
                          {chain}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={
                            agent.drawdownPct >= state.limits.maxDrawdownPct
                              ? "text-accent-red font-semibold"
                              : agent.drawdownPct >= state.limits.maxDrawdownPct * 0.7
                                ? "text-accent-yellow"
                                : "text-gray-300"
                          }
                        >
                          {agent.drawdownPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-mono-sm text-gray-300">
                        {formatUsd(agent.exposureUsd)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">
                        {agent.volatilityPct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${riskBgColor(agent.riskScore)} ${riskColor(agent.riskScore)}`}
                        >
                          {agent.riskScore}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={badge.cls}>{badge.label}</span>
                        {agent.pauseReason && (
                          <p className="text-xs text-gray-500 mt-0.5 max-w-[140px] truncate" title={agent.pauseReason}>
                            {agent.pauseReason}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleToggleAgent(chain, agent.status)}
                          disabled={loading}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 disabled:opacity-40 ${
                            agent.status === "active"
                              ? "border-accent-yellow/30 text-accent-yellow hover:bg-accent-yellow/10"
                              : "border-accent-green/30 text-accent-green hover:bg-accent-green/10"
                          }`}
                        >
                          {agent.status === "active" ? "Pause" : "Resume"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Limit Configuration ────────────────────────────────── */}
        <div className="glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: "0.25s" }}>
          <div className="p-5 border-b border-dark-border flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-sm font-semibold text-white">⚙️ Risk Limit Configuration</h3>
            <button
              onClick={() => {
                if (editMode) {
                  setEditLimits({ ...state.limits });
                }
                setEditMode(!editMode);
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-accent-blue/40 transition-all duration-200"
            >
              {editMode ? "Cancel" : "Edit Limits"}
            </button>
          </div>

          <div className="p-5">
            {editMode ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Max Drawdown (%)</label>
                  <input
                    type="number"
                    value={editLimits.maxDrawdownPct}
                    onChange={(e) => setEditLimits((p) => ({ ...p, maxDrawdownPct: Number(e.target.value) }))}
                    className="glass-input w-full text-sm"
                    min={5}
                    max={50}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Max Exposure Per Chain ($)</label>
                  <input
                    type="number"
                    value={editLimits.maxExposurePerChain}
                    onChange={(e) => setEditLimits((p) => ({ ...p, maxExposurePerChain: Number(e.target.value) }))}
                    className="glass-input w-full text-sm"
                    min={1000}
                    step={5000}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Stop-Loss (%)</label>
                  <input
                    type="number"
                    value={editLimits.stopLossPct}
                    onChange={(e) => setEditLimits((p) => ({ ...p, stopLossPct: Number(e.target.value) }))}
                    className="glass-input w-full text-sm"
                    min={1}
                    max={30}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Market Crash Threshold (%)</label>
                  <input
                    type="number"
                    value={editLimits.marketCrashThresholdPct}
                    onChange={(e) => setEditLimits((p) => ({ ...p, marketCrashThresholdPct: Number(e.target.value) }))}
                    className="glass-input w-full text-sm"
                    min={5}
                    max={50}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Max Risk Score (1-10)</label>
                  <input
                    type="number"
                    value={editLimits.maxRiskScore}
                    onChange={(e) => setEditLimits((p) => ({ ...p, maxRiskScore: Number(e.target.value) }))}
                    className="glass-input w-full text-sm"
                    min={3}
                    max={10}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleSaveLimits}
                    disabled={savingLimits}
                    className="glass-button text-sm w-full"
                  >
                    {savingLimits ? "Saving…" : "Save Limits"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="glass-panel p-3 text-center">
                  <p className="text-xs text-gray-500">Max Drawdown</p>
                  <p className="text-lg font-bold text-white">{state.limits.maxDrawdownPct}%</p>
                </div>
                <div className="glass-panel p-3 text-center">
                  <p className="text-xs text-gray-500">Max Exposure / Chain</p>
                  <p className="text-lg font-bold text-white">{formatUsd(state.limits.maxExposurePerChain)}</p>
                </div>
                <div className="glass-panel p-3 text-center">
                  <p className="text-xs text-gray-500">Stop-Loss</p>
                  <p className="text-lg font-bold text-white">{state.limits.stopLossPct}%</p>
                </div>
                <div className="glass-panel p-3 text-center">
                  <p className="text-xs text-gray-500">Crash Threshold</p>
                  <p className="text-lg font-bold text-white">{state.limits.marketCrashThresholdPct}%</p>
                </div>
                <div className="glass-panel p-3 text-center">
                  <p className="text-xs text-gray-500">Max Risk Score</p>
                  <p className="text-lg font-bold text-white">{state.limits.maxRiskScore}/10</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Last Updated ────────────────────────────────────────── */}
        <p className="text-xs text-gray-600 text-center mt-6 animate-fade-in-up">
          Last updated: {new Date(state.lastUpdated).toLocaleTimeString()} · Auto-refreshes every 10s
        </p>
      </div>
    </div>
  );
}
