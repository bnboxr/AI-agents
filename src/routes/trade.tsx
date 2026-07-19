import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { CHAINS } from "~/lib/chains";
import {
  getTradeConfig,
  updateTradeConfig,
  getOpenPositions,
  getTradeHistory,
  analyzeToken,
  openTrade,
  closeTrade,
  getTradingStats,
  type TradePosition,
  type TradeDirection,
  type TradeConfig,
} from "~/lib/trading-engine";

export const Route = createFileRoute("/trade")({
  loader: async () => {
    const [config, positions, history, stats] = await Promise.all([
      getTradeConfig(),
      getOpenPositions(),
      getTradeHistory(),
      getTradingStats(),
    ]);
    return { config, positions, history, stats };
  },
  component: TradePage,
});

const TOP_TOKENS = [
  { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum" },
  { symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin" },
  { symbol: "SOL", name: "Solana", coingeckoId: "solana" },
  { symbol: "BNB", name: "BNB", coingeckoId: "binancecoin" },
  { symbol: "ARB", name: "Arbitrum", coingeckoId: "arbitrum" },
  { symbol: "OP", name: "Optimism", coingeckoId: "optimism" },
  { symbol: "MATIC", name: "Polygon", coingeckoId: "matic-network" },
  { symbol: "AVAX", name: "Avalanche", coingeckoId: "avalanche-2" },
];

function TradePage() {
  const { address, isConnected } = useAccount();
  const { config: initConfig, positions: initPositions, history: initHistory, stats: initStats } = Route.useLoaderData();
  const [config, setConfig] = useState<TradeConfig>(initConfig);
  const [positions, setPositions] = useState<TradePosition[]>(initPositions);
  const [history] = useState(initHistory);
  const [stats, setStats] = useState(initStats);

  const [selectedChain, setSelectedChain] = useState("ethereum");
  const [selectedToken, setSelectedToken] = useState("ETH");
  const [tradeSize, setTradeSize] = useState(10);
  const [leverage, setLeverage] = useState(1);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{ direction?: TradeDirection; confidence?: number; reasoning?: string; blocked?: boolean } | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Fetch real price
  useEffect(() => {
    const token = TOP_TOKENS.find(t => t.symbol === selectedToken);
    if (!token) return;
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${token.coingeckoId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_24hr_high_low=true`)
      .then(r => r.json())
      .then(data => {
        const d = data[token.coingeckoId];
        if (d) setPrice(d.usd);
      })
      .catch(() => {});
    const interval = setInterval(() => {
      fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${token.coingeckoId}&vs_currencies=usd&include_24hr_change=true`)
        .then(r => r.json())
        .then(data => {
          const d = data[token.coingeckoId];
          if (d) setPrice(d.usd);
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedToken]);

  const handleAnalyze = useCallback(async () => {
    if (!price) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const result = await analyzeToken({
        data: {
          chainId: selectedChain,
          token: selectedToken,
          price,
          change24h: 0,
          volume24h: 0,
          high24h: price * 1.02,
          low24h: price * 0.98,
        },
      });
      setAnalysis(result);
    } catch {
      setAnalysis({ blocked: true, reasoning: "Analysis failed" });
    }
    setAnalyzing(false);
  }, [selectedChain, selectedToken, price]);

  const handleOpenTrade = useCallback(async (direction: TradeDirection) => {
    if (!price) return;
    const result = await openTrade({
      data: { chainId: selectedChain, token: selectedToken, direction, price, size: tradeSize, leverage },
    });
    if (!("error" in result)) {
      setPositions(prev => [...prev, result]);
      setAnalysis(null);
      const newStats = await getTradingStats();
      setStats(newStats);
    }
  }, [selectedChain, selectedToken, price, tradeSize, leverage]);

  const handleCloseTrade = useCallback(async (id: string) => {
    if (!price) return;
    await closeTrade({ data: { id, exitPrice: price } });
    const [newPositions, newStats] = await Promise.all([getOpenPositions(), getTradingStats()]);
    setPositions(newPositions);
    setStats(newStats);
  }, [price]);

  // Refresh positions periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      const [newPositions, newStats] = await Promise.all([getOpenPositions(), getTradingStats()]);
      setPositions(newPositions);
      setStats(newStats);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-dvh pt-20 pb-12 px-4 sm:px-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <span className="text-5xl mb-4 block text-[#00e676] font-mono font-black">{">"}</span>
          <h1 className="text-3xl font-black text-[#e0e6ed] mb-2 font-mono tracking-tight">AI_TRADE</h1>
          <p className="text-[#546e7a] font-mono text-sm">
            GPT-4o analyzes 5-min charts. You set the rules. Agents execute.
          </p>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Open Positions" value={stats.openPositions} color="blue" />
          <StatCard label="Total P&L" value={`$${stats.totalPnl.toFixed(2)}`} color={stats.totalPnl >= 0 ? "green" : "red"} />
          <StatCard label="Win Rate" value={`${stats.winRate}%`} color="purple" />
          <StatCard label="Trades Today" value={`${stats.dailyTrades}/${stats.maxDailyTrades}`} color="teal" />
        </div>

        {!isConnected && (
          <div className="glass-card p-8 text-center mb-6">
            <p className="text-gray-400 text-lg mb-4">Connect your wallet to start trading</p>
            <p className="text-gray-500 text-sm">Use the <strong>Connect Wallet</strong> button in the top right</p>
          </div>
        )}

        {/* Trading Panel */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Market & Analysis */}
          <div className="space-y-6">
            {/* Token Selector */}
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">Market</h3>
              <div className="flex gap-2 mb-3">
                <select
                  value={selectedChain}
                  onChange={e => setSelectedChain(e.target.value)}
                  className="glass-input flex-1 px-3 py-2 rounded-lg text-white text-sm"
                >
                  {config.allowedChains.map(c => (
                    <option key={c} value={c}>{CHAINS.find(ch => ch.id === c)?.name || c}</option>
                  ))}
                </select>
                <select
                  value={selectedToken}
                  onChange={e => setSelectedToken(e.target.value)}
                  className="glass-input flex-1 px-3 py-2 rounded-lg text-white text-sm"
                >
                  {TOP_TOKENS.map(t => (
                    <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                  ))}
                </select>
              </div>
              {price && (
                <div className="text-center py-3">
                  <span className="text-3xl font-black text-white">${price.toFixed(2)}</span>
                  <span className="text-gray-500 text-sm ml-2">{selectedToken}/USD</span>
                </div>
              )}
            </div>

            {/* Trade Controls */}
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">Position</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Size (USD)</span>
                  <input
                    type="number"
                    value={tradeSize}
                    onChange={e => setTradeSize(Number(e.target.value))}
                    className="glass-input w-24 px-2 py-1 rounded text-white text-sm text-right"
                    min={1}
                    max={config.maxPositionUsd}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Leverage</span>
                  <select
                    value={leverage}
                    onChange={e => setLeverage(Number(e.target.value))}
                    className="glass-input px-2 py-1 rounded text-white text-sm"
                  >
                    {[1, 2, 3].filter(l => l <= config.maxLeverage).map(l => (
                      <option key={l} value={l}>{l}x</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Stop Loss: {config.stopLossPct}%</span>
                  <span>Take Profit: {config.takeProfitPct}%</span>
                </div>
              </div>

              {/* AI Analysis */}
              <button
                onClick={handleAnalyze}
                disabled={analyzing || !price}
                className="glass-button w-full mt-4 py-3 bg-purple-600/20 border-purple-500 text-purple-300 hover:bg-purple-600/40 font-bold rounded-xl transition-all disabled:opacity-50"
              >
                {analyzing ? "🧠 Analyzing..." : "🧠 AI Analyze Market"}
              </button>

              {analysis && !analysis.blocked && analysis.direction && (
                <div className="mt-4 p-4 rounded-xl border border-accent-purple/20 bg-accent-purple/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-lg font-bold ${analysis.direction === "LONG" ? "text-green-400" : "text-red-400"}`}>
                      {analysis.direction} 📊
                    </span>
                    <span className="text-sm text-gray-400">Confidence: {analysis.confidence}%</span>
                  </div>
                  <p className="text-sm text-gray-300 mb-3">{analysis.reasoning}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenTrade("LONG")}
                      className="flex-1 py-2.5 rounded-xl bg-green-600/20 border border-green-500 text-green-300 hover:bg-green-600/40 font-bold text-sm transition-all"
                    >
                      🟢 LONG ${tradeSize}
                    </button>
                    <button
                      onClick={() => handleOpenTrade("SHORT")}
                      className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500 text-red-300 hover:bg-red-600/40 font-bold text-sm transition-all"
                    >
                      🔴 SHORT ${tradeSize}
                    </button>
                  </div>
                </div>
              )}

              {analysis?.blocked && (
                <div className="mt-4 p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
                  <p className="text-sm text-yellow-300">⚠️ {analysis.reasoning}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Positions & Config */}
          <div className="space-y-6">
            {/* Open Positions */}
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
                Open Positions ({positions.length})
              </h3>
              {positions.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No open positions</p>
              ) : (
                <div className="space-y-3">
                  {positions.map(pos => (
                    <div key={pos.id} className="p-3 rounded-xl border border-dark-border bg-dark-hover/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-bold ${pos.direction === "LONG" ? "text-green-400" : "text-red-400"}`}>
                          {pos.direction} {pos.token}
                        </span>
                        <span className="text-xs text-gray-500">{pos.leverage}x</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Entry: ${pos.entryPrice}</span>
                        <span>Size: ${pos.size}</span>
                      </div>
                      <div className="flex justify-between text-xs mb-2">
                        <span className={pos.pnlPct >= 0 ? "text-green-400" : "text-red-400"}>
                          P&L: {pos.pnlPct >= 0 ? "+" : ""}{pos.pnlPct.toFixed(2)}%
                        </span>
                        <button
                          onClick={() => handleCloseTrade(pos.id)}
                          className="px-3 py-1 rounded-lg bg-dark-border text-gray-400 hover:text-white text-xs transition-colors"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Config Toggle */}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors w-full text-center"
            >
              {showConfig ? "Hide" : "Show"} Trading Rules ⚙️
            </button>
            {showConfig && (
              <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">Trading Rules</h3>
                <div className="space-y-3 text-sm">
                  {(["maxPositionUsd", "maxLeverage", "stopLossPct", "takeProfitPct", "maxDailyTrades"] as const).map(key => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-gray-400">{key}</span>
                      <input
                        type="number"
                        value={config[key]}
                        onChange={e => {
                          const newCfg = { ...config, [key]: Number(e.target.value) };
                          setConfig(newCfg);
                          updateTradeConfig({ data: { [key]: Number(e.target.value) } });
                        }}
                        className="glass-input w-20 px-2 py-1 rounded text-white text-sm text-right"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    blue: "border-accent-blue/20 bg-accent-blue/5",
    green: "border-green-500/20 bg-green-500/5",
    red: "border-red-500/20 bg-red-500/5",
    purple: "border-purple-500/20 bg-purple-500/5",
    teal: "border-cyan-500/20 bg-cyan-500/5",
  };
  const glows: Record<string, string> = {
    blue: "blue-glow",
    green: "",
    red: "",
    purple: "",
    teal: "teal-glow",
  };
  return (
    <div className={`glass-panel p-4 text-center ${glows[color] || ""}`}>
      <div className="text-2xl font-black text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );
}
