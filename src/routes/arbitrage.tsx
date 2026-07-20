import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────

interface ExchangePrice {
  symbol: string;
  price: number;
  exchange: string;
}

interface ArbitrageOpportunity {
  pair: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  grossProfit: number; // on $1000 notional
  netProfit: number; // after 0.2% fees
  profitable: boolean;
  timestamp: number;
}

interface ScanResult {
  opportunities: ArbitrageOpportunity[];
  scannedPairs: number;
  prices: ExchangePrice[];
  lastUpdated: number;
  error?: string;
}

// ── Symbols to scan ────────────────────────────────────────────────

const SCAN_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT",
  "MATICUSDT", "UNIUSDT", "ARBUSDT", "OPUSDT", "NEARUSDT",
  "ATOMUSDT", "LTCUSDT", "FILUSDT", "APTUSDT", "SUIUSDT",
];

const NOTIONAL = 1000; // Calculate profit on $1000 notional
const FEE_PCT = 0.2; // 0.1% per exchange = 0.2% round trip

// ── Server Function: Real Cross-Exchange Scan ──────────────────────

export const scanArbitrage = createServerFn({ method: "GET" })
  .handler(async (): Promise<ScanResult> => {
    const prices: ExchangePrice[] = [];
    const errors: string[] = [];

    // Fetch Binance prices (free, no auth)
    try {
      const binanceRes = await fetch(
        "https://api.binance.com/api/v3/ticker/price",
        { signal: AbortSignal.timeout(8000) }
      );
      if (binanceRes.ok) {
        const binanceData: { symbol: string; price: string }[] = await binanceRes.json();
        for (const item of binanceData) {
          if (SCAN_SYMBOLS.includes(item.symbol)) {
            prices.push({
              symbol: item.symbol,
              price: parseFloat(item.price),
              exchange: "Binance",
            });
          }
        }
      } else {
        errors.push(`Binance HTTP ${binanceRes.status}`);
      }
    } catch (err: any) {
      errors.push(`Binance: ${err.message}`);
    }

    // Fetch Bybit prices (free, no auth)
    try {
      const bybitRes = await fetch(
        "https://api.bybit.com/v5/market/tickers?category=spot",
        { signal: AbortSignal.timeout(8000) }
      );
      if (bybitRes.ok) {
        const bybitData = await bybitRes.json();
        const tickers = bybitData?.result?.list || [];
        for (const ticker of tickers) {
          const sym = ticker.symbol as string;
          if (SCAN_SYMBOLS.includes(sym)) {
            prices.push({
              symbol: sym,
              price: parseFloat(ticker.lastPrice),
              exchange: "Bybit",
            });
          }
        }
      } else {
        errors.push(`Bybit HTTP ${bybitRes.status}`);
      }
    } catch (err: any) {
      errors.push(`Bybit: ${err.message}`);
    }

    // Cross-reference and find arbitrage opportunities
    const opportunities: ArbitrageOpportunity[] = [];
    const scannedSymbols = new Set(prices.map((p) => p.symbol));

    for (const symbol of scannedSymbols) {
      const symbolPrices = prices.filter((p) => p.symbol === symbol);
      if (symbolPrices.length < 2) continue;

      // Find min and max prices
      let minPrice = symbolPrices[0];
      let maxPrice = symbolPrices[0];
      for (const p of symbolPrices) {
        if (p.price < minPrice.price) minPrice = p;
        if (p.price > maxPrice.price) maxPrice = p;
      }

      // Only if different exchanges
      if (minPrice.exchange === maxPrice.exchange) continue;
      if (minPrice.price <= 0 || maxPrice.price <= 0) continue;

      const spreadPct = ((maxPrice.price - minPrice.price) / minPrice.price) * 100;
      const grossProfit = NOTIONAL * (spreadPct / 100);
      const netProfit = grossProfit - NOTIONAL * (FEE_PCT / 100);

      opportunities.push({
        pair: symbol,
        buyExchange: minPrice.exchange,
        sellExchange: maxPrice.exchange,
        buyPrice: minPrice.price,
        sellPrice: maxPrice.price,
        spreadPct: parseFloat(spreadPct.toFixed(4)),
        grossProfit: parseFloat(grossProfit.toFixed(2)),
        netProfit: parseFloat(netProfit.toFixed(2)),
        profitable: netProfit > 0,
        timestamp: Date.now(),
      });
    }

    // Sort by spread (highest first)
    opportunities.sort((a, b) => b.spreadPct - a.spreadPct);

    return {
      opportunities,
      scannedPairs: prices.length,
      prices,
      lastUpdated: Date.now(),
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  });

// ── Page Component ─────────────────────────────────────────────────

export const Route = createFileRoute("/arbitrage")({
  component: ArbitragePage,
});

function ArbitragePage() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "profitable">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);

  const doScan = useCallback(async () => {
    setLoading(true);
    try {
      const result = await scanArbitrage();
      setData(result);
      setError(result.error || null);
      setLastRefresh(Date.now());
    } catch (err: any) {
      setError(err.message || "Scan failed");
    }
    setLoading(false);
  }, []);

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    doScan();
    if (!autoRefresh) return;
    const interval = setInterval(doScan, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const formatPrice = (n: number) =>
    n < 1
      ? n.toFixed(6)
      : n < 100
        ? n.toFixed(3)
        : n.toFixed(2);

  const opportunities = data?.opportunities || [];
  const filtered = filter === "profitable"
    ? opportunities.filter((o) => o.profitable)
    : opportunities;

  const profitableCount = opportunities.filter((o) => o.profitable).length;
  const bestSpread = opportunities.length > 0 ? opportunities[0].spreadPct : 0;

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ──────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">💹</span>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">
                Arbitrage Scanner
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="accent-accent-blue"
                />
                Auto-refresh (30s)
              </label>
              <button
                onClick={doScan}
                disabled={loading}
                className="glass-button px-4 py-1.5 text-xs text-gray-300 hover:text-white transition-colors disabled:opacity-50"
              >
                {loading ? "⟳ Scanning..." : "⟳ Scan Now"}
              </button>
            </div>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm">
            Real-time cross-exchange arbitrage scanner. Compares prices
            between Binance and Bybit for {SCAN_SYMBOLS.length} trading pairs.
            Spot opportunities where the price difference exceeds trading fees.
            {lastRefresh > 0 && (
              <span className="ml-2 text-xs text-gray-500">
                Last scan: {new Date(lastRefresh).toLocaleTimeString()}
              </span>
            )}
          </p>
        </section>

        {/* ── Error Banner ──────────────────────────────────── */}
        {error && (
          <section className="animate-fade-in-up">
            <div className="glass-card border border-accent-yellow/40 bg-accent-yellow/5 p-4 flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-accent-yellow">
                  Partial data warning
                </p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono text-[0.7rem]">
                  {error}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── Summary Cards ─────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-white text-mono">
              {loading ? "…" : data?.scannedPairs || 0}
            </p>
            <p className="text-xs text-gray-400 mt-1">Prices Fetched</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-blue text-mono">
              {loading ? "…" : opportunities.length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Pairs Scanned</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-green text-mono">
              {loading ? "…" : profitableCount}
            </p>
            <p className="text-xs text-gray-400 mt-1">Profitable</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className={`text-2xl font-bold text-mono ${bestSpread > 1 ? "text-accent-green" : "text-gray-300"}`}>
              {loading ? "…" : `${bestSpread.toFixed(3)}%`}
            </p>
            <p className="text-xs text-gray-400 mt-1">Best Spread</p>
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
              All Pairs ({opportunities.length})
            </button>
            <button
              onClick={() => setFilter("profitable")}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                filter === "profitable"
                  ? "bg-accent-green/10 border-accent-green text-accent-green"
                  : "border-dark-border text-gray-400 hover:text-white hover:border-dark-border-light"
              }`}
            >
              Profitable Only ({profitableCount})
            </button>
            <span className="text-xs text-gray-500 ml-2">
              Fee assumption: {FEE_PCT}% round trip · ${NOTIONAL} notional
            </span>
          </div>
        </section>

        {/* ── Opportunities Table ──────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card overflow-hidden">
            {loading && !data ? (
              <div className="text-center py-16">
                <p className="text-gray-400">
                  <span className="animate-spin inline-block mr-2">⟳</span>
                  Scanning Binance & Bybit...
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400">No arbitrage opportunities found</p>
                <p className="text-xs text-gray-400 mt-2 max-w-md mx-auto">
                  {filter === "profitable"
                    ? "No opportunities exceed the 0.2% fee threshold right now. Markets are efficient — this is normal."
                    : "Prices are synchronized across Binance and Bybit. Check back — spreads appear during volatility."}
                </p>
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div className="grid grid-cols-8 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
                  <span>Pair</span>
                  <span>Buy On</span>
                  <span className="text-right">Buy Price</span>
                  <span>Sell On</span>
                  <span className="text-right">Sell Price</span>
                  <span className="text-right">Spread</span>
                  <span className="text-right">Net P&L</span>
                  <span></span>
                </div>
                {/* Table Rows */}
                {filtered.map((opp, i) => (
                  <div
                    key={`${opp.pair}-${i}`}
                    className={`grid grid-cols-8 gap-2 px-4 py-3 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors ${
                      opp.profitable ? "border-l-2 border-l-accent-green" : ""
                    }`}
                  >
                    <span className="text-sm text-white font-medium text-mono-sm">
                      {opp.pair.replace("USDT", "/USDT")}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        opp.buyExchange === "Binance" ? "text-accent-yellow" : "text-accent-cyan"
                      }`}
                    >
                      {opp.buyExchange}
                    </span>
                    <span className="text-xs text-gray-200 text-right text-mono-sm">
                      ${formatPrice(opp.buyPrice)}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        opp.sellExchange === "Binance" ? "text-accent-yellow" : "text-accent-cyan"
                      }`}
                    >
                      {opp.sellExchange}
                    </span>
                    <span className="text-xs text-gray-200 text-right text-mono-sm">
                      ${formatPrice(opp.sellPrice)}
                    </span>
                    <span className={`text-xs text-right font-semibold text-mono-sm ${
                      opp.spreadPct > 1 ? "text-accent-green" : opp.spreadPct > 0.3 ? "text-accent-yellow" : "text-gray-400"
                    }`}>
                      {opp.spreadPct.toFixed(3)}%
                    </span>
                    <span className={`text-xs text-right font-bold text-mono-sm ${
                      opp.profitable ? "text-accent-green" : "text-accent-red"
                    }`}>
                      {opp.netProfit >= 0 ? "+" : ""}{opp.netProfit.toFixed(2)}
                    </span>
                    <span className="text-center">
                      {opp.profitable ? (
                        <span className="badge badge-green text-[0.625rem]">Trade</span>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Summary footer */}
          {filtered.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between text-xs text-gray-400 gap-2">
              <span>
                {filtered.length} pair{filtered.length !== 1 ? "s" : ""} shown ·{" "}
                {profitableCount} profitable above {FEE_PCT}% fee threshold
              </span>
              <span className="text-mono-sm">
                Data: Binance + Bybit spot markets · {new Date(data?.lastUpdated || Date.now()).toLocaleTimeString()}
              </span>
            </div>
          )}
        </section>

        {/* ── Exchange Price Table ──────────────────────────── */}
        {data && data.prices.length > 0 && (
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-blue">▸</span> Raw Exchange Prices
            </h2>
            <div className="glass-card overflow-hidden">
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
                <span>Pair</span>
                <span className="text-right">Binance</span>
                <span className="text-right">Bybit</span>
                <span className="text-right hidden sm:block">Spread</span>
                <span className="hidden sm:block"></span>
              </div>
              {SCAN_SYMBOLS.map((symbol) => {
                const binance = data.prices.find(
                  (p) => p.symbol === symbol && p.exchange === "Binance"
                );
                const bybit = data.prices.find(
                  (p) => p.symbol === symbol && p.exchange === "Bybit"
                );
                if (!binance && !bybit) return null;

                const spread =
                  binance && bybit
                    ? ((Math.max(binance.price, bybit.price) -
                        Math.min(binance.price, bybit.price)) /
                        Math.min(binance.price, bybit.price)) *
                      100
                    : 0;

                return (
                  <div
                    key={symbol}
                    className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-4 py-2 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors text-xs"
                  >
                    <span className="text-white font-medium text-mono-sm">
                      {symbol.replace("USDT", "")}
                    </span>
                    <span className="text-right text-gray-300 text-mono-sm">
                      {binance ? `$${formatPrice(binance.price)}` : "—"}
                    </span>
                    <span className="text-right text-gray-300 text-mono-sm">
                      {bybit ? `$${formatPrice(bybit.price)}` : "—"}
                    </span>
                    <span
                      className={`text-right hidden sm:block text-mono-sm ${
                        spread > 0.5 ? "text-accent-green font-semibold" : "text-gray-400"
                      }`}
                    >
                      {binance && bybit ? `${spread.toFixed(3)}%` : "—"}
                    </span>
                    <span className="hidden sm:block">
                      {spread > 0.2 ? (
                        <span className="badge badge-green text-[0.625rem]">+{spread.toFixed(2)}%</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── How It Works ─────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-white mb-3">
              How Cross-Exchange Arbitrage Works
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-gray-400">
              <div>
                <p className="text-accent-cyan font-medium mb-1">1. Price Discovery</p>
                <p>
                  We query Binance and Bybit public REST APIs simultaneously
                  for the same trading pairs. No API keys required — data is
                  freely available to all traders.
                </p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">2. Spread Calculation</p>
                <p>
                  For each pair, we identify which exchange has the lower
                  (buy) and higher (sell) price. The spread is the percentage
                  difference between them.
                </p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">3. Profitability Check</p>
                <p>
                  An opportunity is profitable when spread &gt; 0.2%
                  (covering 0.1% fee on each side). Net P&amp;L calculated
                  on $1,000 notional for standardized comparison.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
