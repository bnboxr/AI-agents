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
import type { PricePoint } from "~/lib/agent-activity";

interface ChainChartProps {
  points: PricePoint[];
  tokenSymbol: string;
  currentPrice: number | null;
  change24h: number | null;
}

export function ChainChart({ points, tokenSymbol, currentPrice, change24h }: ChainChartProps) {
  const [timeframe, setTimeframe] = useState<"24h" | "7d" | "30d">("7d");
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

  const displayPoints = useMemo(() => {
    if (filteredPoints.length <= 80) return filteredPoints;
    const step = Math.ceil(filteredPoints.length / 80);
    return filteredPoints.filter((_, i) => i % step === 0);
  }, [filteredPoints]);

  const fmtPrice = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n > 100 ? 0 : 4 });
  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtDateTime = (ts: number) =>
    new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  if (!mounted) {
    return (
      <div className="card p-6">
        <div className="h-[280px] flex items-center justify-center text-gray-400">Loading chart...</div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span className="text-accent-teal">▸</span> {tokenSymbol} Price History
          </h3>
          {currentPrice !== null && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-lg font-bold text-white text-mono">
                {fmtPrice(currentPrice)}
              </span>
              {change24h !== null && (
                <span className={`text-xs font-medium text-mono-sm ${change24h >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(["24h", "7d", "30d"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                timeframe === tf
                  ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
                  : 'text-gray-400 border border-dark-border hover:text-white hover:bg-dark-hover'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {displayPoints.length === 0 ? (
        <div className="h-[280px] flex flex-col items-center justify-center text-gray-400">
          <span className="text-3xl mb-2">📈</span>
          <p className="text-sm">No price history available</p>
          <p className="text-xs mt-1 text-gray-400">Data will populate from CoinGecko</p>
        </div>
      ) : (
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayPoints} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id={`chainGradient-${tokenSymbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={fmtDate}
                stroke="#6b7280"
                tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="#6b7280"
                tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `$${v > 1 ? v.toFixed(0) : v.toFixed(2)}`}
                axisLine={false}
                tickLine={false}
                width={55}
                domain={['auto', 'auto']}
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
                formatter={(value: number) => [fmtPrice(value), tokenSymbol]}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="#14b8a6"
                strokeWidth={2}
                fill={`url(#chainGradient-${tokenSymbol})`}
                dot={false}
                activeDot={{ r: 4, fill: '#14b8a6', stroke: '#0d1723', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
