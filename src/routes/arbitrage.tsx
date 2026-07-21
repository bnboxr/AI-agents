import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";
import {
  fetchFloorPrices,
  scanArbitrage as scanNFTArbitrage,
  getNFTArbitrageState,
  executePaperTrade,
  getPaperTradeProfit,
  getTopCollections,
  type NFTArbitrageOpportunity,
  type NFTArbitrageState,
  type NFTCollection,
  type PaperNFTTrade,
} from "~/lib/revenue/nft-arbitrage";

// ── Types ──────────────────────────────────────────────────────────

interface ExchangePrice {
  symbol: string;
  price: number;
  exchange: string;
}

interface CEXArbitrageOpportunity {
  pair: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  grossProfit: number;
  netProfit: number;
  profitable: boolean;
  timestamp: number;
}

interface CEXScanResult {
  opportunities: CEXArbitrageOpportunity[];
  scannedPairs: number;
  prices: ExchangePrice[];
  lastUpdated: number;
  error?: string;
}

const SCAN_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT",
  "MATICUSDT", "UNIUSDT", "ARBUSDT", "OPUSDT", "NEARUSDT",
  "ATOMUSDT", "LTCUSDT", "FILUSDT", "APTUSDT", "SUIUSDT",
];

const NOTIONAL = 1000;
const FEE_PCT = 0.2;

// ── Server Function: Real CEX Arbitrage Scan ──────────────────────

export const scanCEXArbitrage = createServerFn({ method: "GET" })
  .handler(async (): Promise<CEXScanResult> => {
    const prices: ExchangePrice[] = [];
    const errors: string[] = [];

    try {
      const binanceRes = await fetch(
        "https://api.binance.com/api/v3/ticker/price",
        { signal: AbortSignal.timeout(8000) }
      );
      if (binanceRes.ok) {
        const binanceData: { symbol: string; price: string }[] = await binanceRes.json();
        for (const item of binanceData) {
          if (SCAN_SYMBOLS.includes(item.symbol)) {
            prices.push({ symbol: item.symbol, price: parseFloat(item.price), exchange: "Binance" });
          }
        }
      } else { errors.push(`Binance HTTP ${binanceRes.status}`); }
    } catch (err: any) { errors.push(`Binance: ${err.message}`); }

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
            prices.push({ symbol: sym, price: parseFloat(ticker.lastPrice), exchange: "Bybit" });
          }
        }
      } else { errors.push(`Bybit HTTP ${bybitRes.status}`); }
    } catch (err: any) { errors.push(`Bybit: ${err.message}`); }

    const opportunities: CEXArbitrageOpportunity[] = [];
    const scannedSymbols = new Set(prices.map((p) => p.symbol));

    for (const symbol of scannedSymbols) {
      const symbolPrices = prices.filter((p) => p.symbol === symbol);
      if (symbolPrices.length < 2) continue;
      let minPrice = symbolPrices[0];
      let maxPrice = symbolPrices[0];
      for (const p of symbolPrices) {
        if (p.price < minPrice.price) minPrice = p;
        if (p.price > maxPrice.price) maxPrice = p;
      }
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
  const [tab, setTab] = useState<"cex" | "nft">("cex");

  // CEX state
  const [cexData, setCexData] = useState<CEXScanResult | null>(null);
  const [cexLoading, setCexLoading] = useState(true);
  const [cexError, setCexError] = useState<string | null>(null);
  const [cexFilter, setCexFilter] = useState<"all" | "profitable">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);

  const doCEXScan = useCallback(async () => {
    setCexLoading(true);
    try {
      const result = await scanCEXArbitrage();
      setCexData(result);
      setCexError(result.error || null);
      setLastRefresh(Date.now());
    } catch (err: any) {
      setCexError(err.message || "Scan failed");
    }
    setCexLoading(false);
  }, []);

  // NFT state
  const [nftState, setNftState] = useState<NFTArbitrageState>(getNFTArbitrageState());
  const [nftLoading, setNftLoading] = useState(false);
  const [nftFilter, setNftFilter] = useState<"all" | "profitable">("profitable");
  const [nftCollectionFilter, setNftCollectionFilter] = useState("all");
  const [paperTradeProfit, setPaperTradeProfit] = useState(0);

  const doNFTScan = useCallback(async () => {
    setNftLoading(true);
    try {
      await fetchFloorPrices();
      scanNFTArbitrage();
      setNftState(getNFTArbitrageState());
      setPaperTradeProfit(getPaperTradeProfit());
    } catch (err) {
      console.warn("NFT scan failed:", err);
    }
    setNftLoading(false);
  }, []);

  // Initial CEX load + auto-refresh
  useEffect(() => {
    doCEXScan();
    if (!autoRefresh) return;
    const interval = setInterval(doCEXScan, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // NFT refresh
  useEffect(() => {
    if (tab === "nft") {
      doNFTScan();
      const interval = setInterval(doNFTScan, 60000);
      return () => clearInterval(interval);
    }
  }, [tab]);

  const formatPrice = (n: number) =>
    n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(3) : n.toFixed(2);

  const formatETH = (n: number) => n.toFixed(4);

  // CEX derived
  const cexOpps = cexData?.opportunities || [];
  const cexFiltered = cexFilter === "profitable" ? cexOpps.filter(o => o.profitable) : cexOpps;
  const cexProfitableCount = cexOpps.filter(o => o.profitable).length;
  const cexBestSpread = cexOpps.length > 0 ? cexOpps[0].spreadPct : 0;

  // NFT derived
  const nftOpps = nftState.opportunities;
  const nftFiltered = nftCollectionFilter === "all"
    ? nftOpps
    : nftOpps.filter(o => o.collection === nftCollectionFilter);
  const nftCollections = [...new Set(nftOpps.map(o => o.collection))];

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <section className="animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">💹</span>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Arbitrage Scanner</h1>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-accent-blue" />
              Auto-refresh (30s)
            </label>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm">
            Real-time arbitrage scanner. CEX spreads + NFT cross-marketplace opportunities.
            {lastRefresh > 0 && (
              <span className="ml-2 text-xs text-gray-500">
                Last scan: {new Date(lastRefresh).toLocaleTimeString()}
              </span>
            )}
          </p>
        </section>

        {/* Tab Switcher */}
        <div className="flex rounded-xl bg-dark-hover border border-dark-border p-1 w-fit">
          <button
            onClick={() => setTab("cex")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "cex" ? "bg-accent-blue text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            📊 CEX (Binance↔Bybit)
          </button>
          <button
            onClick={() => setTab("nft")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "nft" ? "bg-accent-blue text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            🎨 NFT (OpenSea↔Blur↔LooksRare)
          </button>
        </div>

        {/* ── CEX Arbitrage ─────────────────────────────────── */}
        {tab === "cex" && (
          <>
            {/* Error Banner */}
            {cexError && (
              <section className="animate-fade-in-up">
                <div className="glass-card border border-accent-yellow/40 bg-accent-yellow/5 p-4 flex items-start gap-3">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <p className="text-sm font-semibold text-accent-yellow">Partial data warning</p>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono text-[0.7rem]">{cexError}</p>
                  </div>
                </div>
              </section>
            )}

            {/* Summary Cards */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
              <div className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-white text-mono">{cexLoading ? "…" : cexData?.scannedPairs || 0}</p>
                <p className="text-xs text-gray-400 mt-1">Prices Fetched</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-accent-blue text-mono">{cexLoading ? "…" : cexOpps.length}</p>
                <p className="text-xs text-gray-400 mt-1">Pairs Scanned</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-accent-green text-mono">{cexLoading ? "…" : cexProfitableCount}</p>
                <p className="text-xs text-gray-400 mt-1">Profitable</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className={`text-2xl font-bold text-mono ${cexBestSpread > 1 ? "text-accent-green" : "text-gray-300"}`}>
                  {cexLoading ? "…" : `${cexBestSpread.toFixed(3)}%`}
                </p>
                <p className="text-xs text-gray-400 mt-1">Best Spread</p>
              </div>
            </section>

            {/* Filter + Results */}
            <section>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button onClick={() => setCexFilter("all")} className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${cexFilter === "all" ? "bg-accent-blue/10 border-accent-blue text-accent-blue" : "border-dark-border text-gray-400 hover:text-white"}`}>
                  All ({cexOpps.length})
                </button>
                <button onClick={() => setCexFilter("profitable")} className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${cexFilter === "profitable" ? "bg-accent-green/10 border-accent-green text-accent-green" : "border-dark-border text-gray-400 hover:text-white"}`}>
                  Profitable ({cexProfitableCount})
                </button>
                <span className="text-xs text-gray-500 ml-2">Fee: {FEE_PCT}% RT · ${NOTIONAL} notional</span>
              </div>

              <div className="glass-card overflow-hidden">
                {cexLoading && !cexData ? (
                  <div className="text-center py-16"><p className="text-gray-400">⟳ Scanning Binance & Bybit...</p></div>
                ) : cexFiltered.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-gray-400">No arbitrage opportunities found</p>
                    <p className="text-xs text-gray-400 mt-2 max-w-md mx-auto">
                      {cexFilter === "profitable"
                        ? "No opportunities exceed the 0.2% fee threshold right now."
                        : "Prices are synchronized. Check back — spreads appear during volatility."}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-8 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
                      <span>Pair</span><span>Buy On</span><span className="text-right">Buy Price</span>
                      <span>Sell On</span><span className="text-right">Sell Price</span>
                      <span className="text-right">Spread</span><span className="text-right">Net P&L</span><span></span>
                    </div>
                    {cexFiltered.map((opp, i) => (
                      <div key={`${opp.pair}-${i}`} className={`grid grid-cols-8 gap-2 px-4 py-3 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors ${opp.profitable ? "border-l-2 border-l-accent-green" : ""}`}>
                        <span className="text-sm text-white font-medium text-mono-sm">{opp.pair.replace("USDT", "/USDT")}</span>
                        <span className={`text-xs font-medium ${opp.buyExchange === "Binance" ? "text-accent-yellow" : "text-accent-cyan"}`}>{opp.buyExchange}</span>
                        <span className="text-xs text-gray-200 text-right text-mono-sm">${formatPrice(opp.buyPrice)}</span>
                        <span className={`text-xs font-medium ${opp.sellExchange === "Binance" ? "text-accent-yellow" : "text-accent-cyan"}`}>{opp.sellExchange}</span>
                        <span className="text-xs text-gray-200 text-right text-mono-sm">${formatPrice(opp.sellPrice)}</span>
                        <span className={`text-xs text-right font-semibold text-mono-sm ${opp.spreadPct > 1 ? "text-accent-green" : opp.spreadPct > 0.3 ? "text-accent-yellow" : "text-gray-400"}`}>{opp.spreadPct.toFixed(3)}%</span>
                        <span className={`text-xs text-right font-bold text-mono-sm ${opp.profitable ? "text-accent-green" : "text-accent-red"}`}>{opp.netProfit >= 0 ? "+" : ""}{opp.netProfit.toFixed(2)}</span>
                        <span className="text-center">{opp.profitable ? <span className="badge badge-green text-[0.625rem]">Trade</span> : <span className="text-xs text-gray-500">—</span>}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>
          </>
        )}

        {/* ── NFT Arbitrage ─────────────────────────────────── */}
        {tab === "nft" && (
          <>
            {/* NFT Stats */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
              <div className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-white text-mono">{nftState.collections.length}</p>
                <p className="text-xs text-gray-400 mt-1">Collections Tracked</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-accent-blue text-mono">{nftOpps.length}</p>
                <p className="text-xs text-gray-400 mt-1">NFT Opportunities</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-accent-green text-mono">{formatETH(paperTradeProfit)} ETH</p>
                <p className="text-xs text-gray-400 mt-1">Paper Trade P&L</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-accent-yellow text-mono">{nftState.paperTrades.length}</p>
                <p className="text-xs text-gray-400 mt-1">Trades Executed</p>
              </div>
            </section>

            {/* Controls */}
            <section className="flex flex-wrap items-center gap-2">
              <button onClick={doNFTScan} disabled={nftLoading} className="glass-button px-4 py-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-50">
                {nftLoading ? "⟳ Scanning..." : "⟳ Scan NFTs"}
              </button>
              <select value={nftCollectionFilter} onChange={e => setNftCollectionFilter(e.target.value)} className="glass-input px-3 py-1.5 rounded-lg text-xs text-gray-300">
                <option value="all">All Collections</option>
                {nftCollections.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span className="text-xs text-gray-500">Min spread: 5% (covers fees + gas)</span>
            </section>

            {/* NFT Opportunities */}
            <section>
              <div className="glass-card overflow-hidden">
                {nftLoading && nftOpps.length === 0 ? (
                  <div className="text-center py-16"><p className="text-gray-400">⟳ Scanning NFT marketplaces...</p></div>
                ) : nftFiltered.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-gray-400">No NFT arbitrage opportunities found</p>
                    <p className="text-xs text-gray-500 mt-2">Spreads below 5% threshold. Try again later.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-9 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
                      <span>Collection</span><span>Buy On</span><span className="text-right">Buy</span>
                      <span>Sell On</span><span className="text-right">Sell</span>
                      <span className="text-right">Spread</span><span className="text-right">Net Profit</span><span></span><span></span>
                    </div>
                    {nftFiltered.map(opp => (
                      <div key={opp.id} className="grid grid-cols-9 gap-2 px-4 py-3 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors border-l-2 border-l-accent-green">
                        <span className="text-sm text-white font-medium truncate">{opp.collectionName}</span>
                        <span className="text-xs text-accent-yellow font-medium">{opp.buyMarketplace}</span>
                        <span className="text-xs text-gray-200 text-right text-mono-sm">{formatETH(opp.buyPrice)} ETH</span>
                        <span className="text-xs text-accent-cyan font-medium">{opp.sellMarketplace}</span>
                        <span className="text-xs text-gray-200 text-right text-mono-sm">{formatETH(opp.sellPrice)} ETH</span>
                        <span className={`text-xs text-right font-bold text-mono-sm ${opp.spreadPct > 10 ? "text-accent-green" : "text-accent-yellow"}`}>{opp.spreadPct}%</span>
                        <span className="text-xs text-right text-accent-green font-bold text-mono-sm">{formatETH(opp.netProfit)} ETH</span>
                        <span className="text-xs text-gray-400 text-center">Gas: ~{formatETH(opp.estimatedGas)} ETH</span>
                        <span className="text-center">
                          <button onClick={() => { executePaperTrade(opp.id); setNftState(getNFTArbitrageState()); setPaperTradeProfit(getPaperTradeProfit()); }} className="text-[0.6rem] px-2 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/20 hover:bg-accent-green/20">
                            Buy
                          </button>
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            {/* Floor Prices */}
            {nftState.collections.filter(c => c.floorPrice > 0).length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="text-accent-blue">▸</span> NFT Floor Prices (OpenSea)
                </h2>
                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-dark-border text-gray-400">
                          <th className="text-left py-3 px-4 font-medium">Collection</th>
                          <th className="text-right py-3 px-4 font-medium">Floor</th>
                          <th className="text-right py-3 px-4 font-medium">24h Vol</th>
                          <th className="text-right py-3 px-4 font-medium hidden sm:table-cell">7d Vol</th>
                          <th className="text-right py-3 px-4 font-medium hidden md:table-cell">Market Cap</th>
                          <th className="text-center py-3 px-4 font-medium">Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nftState.collections.filter(c => c.floorPrice > 0).slice(0, 10).map(col => (
                          <tr key={col.slug} className="border-b border-dark-border hover:bg-dark-hover">
                            <td className="py-3 px-4"><span className="text-white font-medium">{col.name}</span></td>
                            <td className="py-3 px-4 text-right text-accent-green font-bold text-mono-sm">{formatETH(col.floorPrice)} ETH</td>
                            <td className="py-3 px-4 text-right text-gray-300">{formatETH(col.volume24h)} ETH</td>
                            <td className="py-3 px-4 text-right text-gray-400 hidden sm:table-cell">{formatETH(col.volume7d)} ETH</td>
                            <td className="py-3 px-4 text-right text-gray-400 hidden md:table-cell">{formatETH(col.marketCap)} ETH</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`text-[0.6rem] px-2 py-0.5 rounded-full border ${col.trend === "up" ? "bg-green-500/10 text-green-400 border-green-500/30" : col.trend === "down" ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-gray-500/10 text-gray-400 border-gray-500/30"}`}>
                                {col.trend === "up" ? `↑${col.percentChange24h.toFixed(1)}%` : col.trend === "down" ? `↓${Math.abs(col.percentChange24h).toFixed(1)}%` : "flat"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Paper Trade History */}
            {nftState.paperTrades.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Paper Trade History</h2>
                <div className="glass-card overflow-hidden">
                  {nftState.paperTrades.slice(-10).reverse().map(t => (
                    <div key={t.id} className="flex items-center justify-between px-4 py-2 border-b border-dark-border last:border-0 text-xs">
                      <span className="text-white">{t.collection}</span>
                      <span className="text-gray-400">{t.buyMarketplace}→{t.sellMarketplace}</span>
                      <span className="text-gray-300">{formatETH(t.buyPrice)}→{formatETH(t.sellPrice)} ETH</span>
                      <span className="text-accent-green font-bold">+{formatETH(t.profit)} ETH</span>
                      <span className="text-gray-500">{new Date(t.executedAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* How It Works */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-white mb-3">How Arbitrage Works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-gray-400">
              <div>
                <p className="text-accent-cyan font-medium mb-1">CEX Arbitrage</p>
                <p>Compare Binance ↔ Bybit spot prices for 20 pairs. Profitable when spread &gt; 0.2% (covers 0.1% fee/side).</p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">NFT Arbitrage</p>
                <p>Compare OpenSea ↔ Blur ↔ LooksRare ↔ X2Y2 floor prices. Profitable at &gt;5% spread (covers marketplace fees + gas).</p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">Paper Trading</p>
                <p>Execute simulated NFT arbitrage to track performance. No real funds — all data from public marketplace APIs.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
