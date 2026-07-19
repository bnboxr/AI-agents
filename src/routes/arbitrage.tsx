import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getArbitrageOpportunities, getPrices } from "~/lib/blockchain";
import type { ArbitrageOpportunity, PriceData } from "~/lib/blockchain";

export const Route = createFileRoute("/arbitrage")({
  loader: async () => {
    const [opportunities, prices] = await Promise.all([
      getArbitrageOpportunities(),
      getPrices(),
    ]);
    return { opportunities, prices };
  },
  component: ArbitragePage,
});

function ArbitragePage() {
  const initial = Route.useLoaderData();
  const [opportunities, setOpportunities] = useState(initial.opportunities);
  const [prices, setPrices] = useState(initial.prices);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const interval = setInterval(async () => {
      setRefreshing(true);
      try {
        const [opps, pr] = await Promise.all([
          getArbitrageOpportunities(),
          getPrices(),
        ]);
        setOpportunities(opps);
        setPrices(pr);
      } catch {
        // keep current
      }
      setRefreshing(false);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const fmtPrice = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)}%`;

  const filteredOpps = filter === "all"
    ? opportunities
    : opportunities.filter((o) =>
        o.sourceChain.toLowerCase().includes(filter.toLowerCase()) ||
        o.destChain.toLowerCase().includes(filter.toLowerCase()) ||
        o.pair.toLowerCase().includes(filter.toLowerCase())
      );

  // Extract unique chains for filter
  const chainSet = new Set<string>();
  opportunities.forEach((o) => {
    chainSet.add(o.sourceChain);
    chainSet.add(o.destChain);
  });

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ──────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">💹</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Arbitrage Scanner</h1>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm">
            Cross-chain arbitrage opportunities detected in real-time. Compare prices across DEXs on different chains.
            {refreshing && <span className="ml-2 text-accent-blue animate-pulse-slow">⟳ refreshing...</span>}
          </p>
        </section>

        {/* ── Market Prices ────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
          <div className="glass-card p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">BTC</p>
            <p className="text-lg font-bold text-white text-mono">
              {prices.btc ? fmtPrice(prices.btc.usd) : "—"}
            </p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">ETH</p>
            <p className="text-lg font-bold text-white text-mono">
              {prices.eth ? fmtPrice(prices.eth.usd) : "—"}
            </p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">BTC 24h</p>
            <p className={`text-lg font-bold text-mono ${prices.btc ? (prices.btc.change24h >= 0 ? 'text-accent-green' : 'text-accent-red') : 'text-gray-400'}`}>
              {prices.btc ? `${prices.btc.change24h >= 0 ? '+' : ''}${prices.btc.change24h.toFixed(2)}%` : "—"}
            </p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">ETH 24h</p>
            <p className={`text-lg font-bold text-mono ${prices.eth ? (prices.eth.change24h >= 0 ? 'text-accent-green' : 'text-accent-red') : 'text-gray-400'}`}>
              {prices.eth ? `${prices.eth.change24h >= 0 ? '+' : ''}${prices.eth.change24h.toFixed(2)}%` : "—"}
            </p>
          </div>
        </section>

        {/* ── Filter Bar ───────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilter("all")}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                filter === "all"
                  ? "bg-accent-blue/10 border-accent-blue text-accent-blue"
                  : "border-dark-border text-gray-400 hover:text-white hover:border-dark-border-light"
              }`}
            >
              All Opportunities
            </button>
            {Array.from(chainSet).sort().map((chain) => (
              <button
                key={chain}
                onClick={() => setFilter(chain)}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors capitalize ${
                  filter === chain
                    ? "bg-accent-blue/10 border-accent-blue text-accent-blue"
                    : "border-dark-border text-gray-400 hover:text-white hover:border-dark-border-light"
                }`}
              >
                {chain}
              </button>
            ))}
          </div>
        </section>

        {/* ── Opportunities Table ──────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card overflow-hidden">
            {filteredOpps.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400 text-mono-sm">No arbitrage opportunities found</p>
                <p className="text-xs text-gray-400 mt-2">
                  {filter !== "all"
                    ? `No results for filter "${filter}". Try a different filter.`
                    : "The scanner is actively monitoring cross-chain price discrepancies. Check back soon."}
                </p>
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div className="grid grid-cols-7 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
                  <span>#</span>
                  <span className="col-span-2">Pair</span>
                  <span>Route</span>
                  <span className="text-right">Buy Price</span>
                  <span className="text-right">Sell Price</span>
                  <span className="text-right">Profit</span>
                </div>
                {/* Table Rows */}
                {filteredOpps.map((opp, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-7 gap-2 px-4 py-3 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors"
                  >
                    <span className="text-xs text-gray-400 text-mono-sm">{i + 1}</span>
                    <span className="text-sm text-white font-medium col-span-2 text-mono-sm">{opp.pair}</span>
                    <span className="text-xs text-gray-300 capitalize text-mono-sm">
                      {opp.sourceChain} → {opp.destChain}
                    </span>
                    <span className="text-xs text-gray-200 text-right text-mono-sm">${opp.sourcePrice.toFixed(2)}</span>
                    <span className="text-xs text-gray-200 text-right text-mono-sm">${opp.destPrice.toFixed(2)}</span>
                    <span className="text-xs text-right text-mono-sm">
                      <span className="text-accent-green font-semibold">+{opp.profitPct.toFixed(3)}%</span>
                      <span className="text-gray-400 ml-1 block text-[0.625rem]">~{opp.estTime}</span>
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Summary */}
          <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
            <span>{filteredOpps.length} opportunity(s) detected</span>
            <span className="text-mono-sm">
              Best: {filteredOpps.length > 0 ? fmtPct(filteredOpps[0].profitPct) : "N/A"}
            </span>
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-white mb-3">How Cross-Chain Arbitrage Works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-gray-400">
              <div>
                <p className="text-accent-cyan font-medium mb-1">1. Price Discovery</p>
                <p>We query DEX prices for the same asset across multiple chains simultaneously.</p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">2. Spread Detection</p>
                <p>When the price difference between two chains exceeds gas + bridge costs, an opportunity exists.</p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">3. Execution Path</p>
                <p>Buy on the cheaper chain, bridge assets, sell on the expensive chain — pocket the difference.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
