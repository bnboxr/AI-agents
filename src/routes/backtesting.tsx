import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { CHAINS } from "~/lib/chains";
import { runBacktest } from "~/lib/backtesting/engine";
import type {
  BacktestConfig,
  BacktestResult,
  StrategyType,
  TimeRange,
} from "~/lib/backtesting/types";

export const Route = createFileRoute("/backtesting")({
  component: BacktestingPage,
});

const STRATEGIES: { value: StrategyType; label: string; icon: string; desc: string }[] = [
  {
    value: "flash-loan-arbitrage",
    label: "Flash Loan Arbitrage",
    icon: "⚡",
    desc: "Dip buying with tight profit targets and stop-losses",
  },
  {
    value: "yield-optimizer",
    label: "Yield Optimizer",
    icon: "📈",
    desc: "Momentum-based trend following strategy",
  },
  {
    value: "cross-chain",
    label: "Cross-Chain",
    icon: "🔗",
    desc: "Mean-reversion across correlated assets",
  },
];

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
];

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatGwei(n: number): string {
  if (n >= 1) return `${n.toFixed(1)} gwei`;
  if (n >= 0.001) return `${(n * 1000).toFixed(1)} mgwei`;
  return `${(n * 1e6).toFixed(1)} µgwei`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function BacktestingPage() {
  const [strategy, setStrategy] = useState<StrategyType>("flash-loan-arbitrage");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [chainId, setChainId] = useState("ethereum");
  const [initialCapital, setInitialCapital] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress(10);
    setResult(null);

    const config: BacktestConfig = {
      strategy,
      timeRange,
      chainId,
      initialCapital,
    };

    try {
      // Simulate progress
      const progressTimer = setInterval(() => {
        setProgress((p) => Math.min(p + Math.random() * 20, 85));
      }, 400);

      const res = await runBacktest({ data: config });

      clearInterval(progressTimer);
      setProgress(100);

      // Small delay for smooth UX
      await new Promise((r) => setTimeout(r, 300));
      setResult(res as BacktestResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }, [strategy, timeRange, chainId, initialCapital]);

  const chain = CHAINS.find((c) => c.id === chainId);

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ──────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🧪</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Strategy Backtesting</h1>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm">
            Simulate trading strategies against historical price data. Test flash-loan arbitrage,
            yield optimization, and cross-chain rebalancing strategies before deploying capital.
          </p>
        </section>

        {/* ── Configuration Panel ─────────────────────────── */}
        <section className="glass-card p-5 sm:p-6 animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <span className="text-accent-blue">⚙</span> Configuration
          </h2>

          {/* Strategy Selector */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-400 mb-2">Strategy</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STRATEGIES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStrategy(s.value)}
                  disabled={loading}
                  className={`text-left p-3 rounded-lg border transition-all duration-200 ${
                    strategy === s.value
                      ? "border-accent-blue bg-blue-surface/50 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                      : "border-dark-border bg-dark-surface hover:border-dark-border-light"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.icon}</span>
                    <span className={`text-sm font-semibold ${strategy === s.value ? "text-accent-blue" : "text-white"}`}>
                      {s.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {/* Time Range */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Time Range</label>
              <div className="flex gap-1.5">
                {TIME_RANGES.map((tr) => (
                  <button
                    key={tr.value}
                    onClick={() => setTimeRange(tr.value)}
                    disabled={loading}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                      timeRange === tr.value
                        ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/30"
                        : "bg-dark-surface text-gray-400 border border-dark-border hover:border-dark-border-light"
                    }`}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chain Selector */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Chain</label>
              <select
                value={chainId}
                onChange={(e) => setChainId(e.target.value)}
                disabled={loading}
                className="w-full glass-input text-sm py-2 px-3"
              >
                {CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.nativeToken})
                  </option>
                ))}
              </select>
            </div>

            {/* Initial Capital */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Initial Capital (USD)</label>
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                disabled={loading}
                min={100}
                max={10000000}
                step={1000}
                className="w-full glass-input text-sm py-2 px-3 text-mono"
              />
            </div>

            {/* Run Button */}
            <div className="flex items-end">
              <button
                onClick={handleRun}
                disabled={loading}
                className="glass-button w-full text-sm py-2.5"
              >
                {loading ? "Running..." : "🚀 Run Backtest"}
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {loading && (
            <div className="mt-4 animate-fade-in">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-400">
                  Fetching historical data & running simulation...
                </span>
                <span className="text-xs text-mono text-accent-blue">{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-dark-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-blue to-accent-cyan rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 text-sm text-accent-red">
              {error}
            </div>
          )}
        </section>

        {/* ── Results Dashboard ───────────────────────────── */}
        {result && (
          <div className="space-y-6 animate-fade-in-up">
            {/* Metrics Cards */}
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                label="Total Return"
                value={formatPct(result.metrics.totalReturn)}
                sub={`${result.metrics.totalTrades} trades`}
                positive={result.metrics.totalReturn >= 0}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={result.metrics.sharpeRatio.toFixed(2)}
                sub="risk-adjusted"
                positive={result.metrics.sharpeRatio > 0}
              />
              <MetricCard
                label="Max Drawdown"
                value={formatPct(result.metrics.maxDrawdown)}
                sub="worst peak-to-trough"
                positive={result.metrics.maxDrawdown >= -5}
              />
              <MetricCard
                label="Win Rate"
                value={`${result.metrics.winRate.toFixed(1)}%`}
                sub={`${result.metrics.winningTrades}W / ${result.metrics.losingTrades}L`}
                positive={result.metrics.winRate >= 50}
              />
              <MetricCard
                label="Profit Factor"
                value={result.metrics.profitFactor === Infinity ? "∞" : result.metrics.profitFactor.toFixed(2)}
                sub="gross win / gross loss"
                positive={result.metrics.profitFactor > 1}
              />
              <MetricCard
                label="Volatility"
                value={`${result.metrics.volatility.toFixed(1)}%`}
                sub="annualized"
                positive={result.metrics.volatility < 50}
              />
            </section>

            {/* Equity Curve */}
            <section className="glass-card p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <span className="text-accent-cyan">📊</span> Equity Curve
              </h3>
              <div className="h-72 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={result.equityCurve}>
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      stroke="#6b7280"
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#6b7280"
                      fontSize={11}
                      tickLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(13, 17, 35, 0.95)",
                        border: "1px solid rgba(59, 130, 246, 0.2)",
                        borderRadius: "0.75rem",
                        backdropFilter: "blur(12px)",
                        fontSize: "0.8125rem",
                      }}
                      labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
                      formatter={(value: number) => [formatCurrency(value), "Equity"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#equityGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Trade Details */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Trade Stats */}
              <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <span className="text-accent-teal">💹</span> Trade Statistics
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <StatRow label="Total Trades" value={String(result.metrics.totalTrades)} />
                  <StatRow label="Winning Trades" value={String(result.metrics.winningTrades)} color="text-accent-green" />
                  <StatRow label="Losing Trades" value={String(result.metrics.losingTrades)} color="text-accent-red" />
                  <StatRow label="Avg Win" value={formatCurrency(result.metrics.avgWin)} color="text-accent-green" />
                  <StatRow label="Avg Loss" value={formatCurrency(result.metrics.avgLoss)} color="text-accent-red" />
                  <StatRow label="Best Trade" value={formatCurrency(result.metrics.bestTrade)} color="text-accent-green" />
                  <StatRow label="Worst Trade" value={formatCurrency(result.metrics.worstTrade)} color="text-accent-red" />
                  <StatRow label="Data Points" value={String(result.priceDataPoints)} />
                </div>
              </div>

              {/* Config Summary */}
              <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <span className="text-accent-purple">📋</span> Run Summary
                </h3>
                <div className="space-y-3">
                  <ConfigRow label="Strategy" value={STRATEGIES.find((s) => s.value === result.config.strategy)?.label ?? result.config.strategy} />
                  <ConfigRow label="Chain" value={chain?.name ?? result.config.chainId} />
                  <ConfigRow label="Time Range" value={TIME_RANGES.find((t) => t.value === result.config.timeRange)?.label ?? result.config.timeRange} />
                  <ConfigRow label="Initial Capital" value={formatCurrency(result.config.initialCapital)} />
                  <ConfigRow
                    label="Final Equity"
                    value={formatCurrency(
                      result.equityCurve[result.equityCurve.length - 1]?.equity ?? result.config.initialCapital
                    )}
                    color={result.metrics.totalReturn >= 0 ? "text-accent-green" : "text-accent-red"}
                  />
                  <ConfigRow
                    label="Duration"
                    value={`${((result.completedAt - result.startedAt) / 1000).toFixed(1)}s`}
                  />
                </div>
              </div>
            </section>

            {/* Trade Log Table */}
            {result.trades.length > 0 && (
              <section className="glass-card p-5 sm:p-6 overflow-hidden">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <span className="text-accent-yellow">📜</span> Trade Log
                </h3>
                <div className="overflow-x-auto -mx-5 sm:-mx-6">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-dark-border text-gray-400">
                        <th className="text-left py-2 px-4 font-medium">#</th>
                        <th className="text-left py-2 px-4 font-medium">Time</th>
                        <th className="text-left py-2 px-4 font-medium">Type</th>
                        <th className="text-right py-2 px-4 font-medium">Price</th>
                        <th className="text-right py-2 px-4 font-medium">PnL</th>
                        <th className="text-right py-2 px-4 font-medium">Cumulative</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-50).map((trade) => (
                        <tr key={trade.index} className="border-b border-dark-border/50 hover:bg-dark-hover/50 transition-colors">
                          <td className="py-2 px-4 text-mono text-gray-400">{trade.index + 1}</td>
                          <td className="py-2 px-4 text-mono-sm text-gray-300">{formatDate(trade.timestamp)}</td>
                          <td className="py-2 px-4">
                            <span
                              className={`badge text-[10px] ${
                                trade.type === "buy" ? "badge-green" : "badge-red"
                              }`}
                            >
                              {trade.type.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2 px-4 text-mono-sm text-right text-gray-200">
                            {formatCurrency(trade.price)}
                          </td>
                          <td
                            className={`py-2 px-4 text-mono-sm text-right ${
                              trade.pnl === null
                                ? "text-gray-400"
                                : (trade.pnl ?? 0) >= 0
                                ? "text-accent-green"
                                : "text-accent-red"
                            }`}
                          >
                            {trade.pnl !== null ? formatCurrency(trade.pnl) : "—"}
                          </td>
                          <td
                            className={`py-2 px-4 text-mono-sm text-right ${
                              trade.cumulativePnl >= 0 ? "text-accent-green" : "text-accent-red"
                            }`}
                          >
                            {formatCurrency(trade.cumulativePnl)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.trades.length > 50 && (
                    <p className="text-xs text-gray-400 text-center mt-3">
                      Showing last 50 of {result.trades.length} trades
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive: boolean;
}) {
  return (
    <div className="glass-card p-4 text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p
        className={`text-xl font-bold text-mono ${
          positive ? "text-accent-green" : "text-accent-red"
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

function StatRow({
  label,
  value,
  color = "text-gray-200",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-dark-border/50 last:border-b-0">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-xs text-mono font-medium ${color}`}>{value}</span>
    </div>
  );
}

function ConfigRow({
  label,
  value,
  color = "text-gray-200",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-sm text-mono font-medium ${color}`}>{value}</span>
    </div>
  );
}
