"use client";

import { useState, useEffect, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PortfolioSnapshot } from "~/lib/agent-activity";

interface PortfolioChartProps {
  points: PortfolioSnapshot[];
  currentTotal: number;
}

export function PortfolioChart({ points, currentTotal }: PortfolioChartProps) {
  const [timeframe, setTimeframe] = useState<"24h" | "7d" | "30d" | "all">("30d");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const filteredPoints = useMemo(() => {
    if (points.length === 0) return [];
    const now = Date.now();
    let cutoff: number;
    switch (timeframe) {
      case "24h": cutoff = now - 24 * 3600 * 1000; break;
      case "7d": cutoff = now - 7 * 24 * 3600 * 1000; break;
      case "30d": cutoff = now - 30 * 24 * 3600 * 1000; break;
      default: return points;
    }
    return points.filter((p) => p.timestamp >= cutoff);
  }, [points, timeframe]);

  // Only show a subset of points for performance
  const displayPoints = useMemo(() => {
    if (filteredPoints.length <= 100) return filteredPoints;
    const step = Math.ceil(filteredPoints.length / 100);
    return filteredPoints.filter((_, i) => i % step === 0);
  }, [filteredPoints]);

  const fmtPrice = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtDateTime = (ts: number) =>
    new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const firstValue = displayPoints[0]?.totalValue ?? 0;
  const lastValue = displayPoints[displayPoints.length - 1]?.totalValue ?? 0;
  const change = lastValue - firstValue;
  const changePct = firstValue > 0 ? ((change / firstValue) * 100) : 0;

  if (!mounted) {
    return (
      <div className="glass-card p-6 animate-fade-in">
        <div className="h-[300px] flex items-center justify-center text-gray-400">Loading chart...</div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Portfolio Evolution
          </h2>
          {displayPoints.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-lg font-bold text-white text-mono">
                {fmtPrice(lastValue || currentTotal)}
              </span>
              <span className={`text-xs font-medium text-mono-sm ${change >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {change >= 0 ? '+' : ''}{fmtPrice(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
        {/* Timeframe selectors */}
        <div className="flex items-center gap-1">
          {(["24h", "7d", "30d", "all"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                timeframe === tf
                  ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
                  : 'text-gray-400 border border-dark-border hover:text-white hover:bg-dark-hover'
              }`}
            >
              {tf === "all" ? "All" : tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {displayPoints.length === 0 ? (
        <div className="h-[300px] flex flex-col items-center justify-center text-gray-400">
          <span className="text-4xl mb-3">📊</span>
          <p className="text-sm">No historical data available yet</p>
          <p className="text-xs mt-1 text-gray-400">Connect a wallet or wait for data to accumulate</p>
        </div>
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayPoints} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={fmtDate}
                stroke="#6b7280"
                tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="#6b7280"
                tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(13, 17, 35, 0.95)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '0.75rem',
                  backdropFilter: 'blur(16px)',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                }}
                labelFormatter={(ts: number) => fmtDateTime(ts)}
                formatter={(value: number) => [fmtPrice(value), 'Value']}
              />
              <Area
                type="monotone"
                dataKey="totalValue"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#portfolioGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#3b82f6', stroke: '#0d1723', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
