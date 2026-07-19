import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { formatUnits, type Address } from "viem";
import {
  getAllChainStatus,
  getPrices,
  getFearGreed,
  getArbitrageOpportunities,
  getMempoolTxs,
} from "~/lib/blockchain";
import type { ChainStatus, PriceData, FearGreedData, ArbitrageOpportunity, MempoolTx } from "~/lib/blockchain";
import { getChainTokens } from "~/lib/web3";
import {
  getPortfolioHistory,
  getAgentActivityLog,
  initializeAgentScanning,
} from "~/lib/agent-activity";
import { PortfolioChart } from "~/components/PortfolioChart";
import { AgentFeed } from "~/components/AgentFeed";
import type { AgentActivity } from "~/lib/agent-activity";

const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function fetchPrices(symbols: string[]): Promise<Record<string, { usd: number; change24h: number } | null>> {
  const idMap: Record<string, string> = {
    ETH: "ethereum", WETH: "ethereum",
    WBTC: "wrapped-bitcoin",
    USDC: "usd-coin", USDT: "tether", DAI: "dai",
    MATIC: "matic-network",
    BNB: "binancecoin", WBNB: "binancecoin",
    AVAX: "avalanche-2", WAVAX: "avalanche-2",
    FTM: "fantom", WFTM: "fantom",
  };
  const ids = symbols.map(s => idMap[s] || s.toLowerCase()).filter(Boolean);
  if (ids.length === 0) return {};
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`
    );
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, { usd: number; change24h: number } | null> = {};
    for (const sym of symbols) {
      const id = idMap[sym] || sym.toLowerCase();
      result[sym] = data[id] || null;
    }
    return result;
  } catch { return {}; }
}

export const Route = createFileRoute("/")({
  loader: async () => {
    const [chains, prices, fearGreed, arbitrage, mempool, portfolioData, agentActivities] = await Promise.all([
      getAllChainStatus(),
      getPrices(),
      getFearGreed(),
      getArbitrageOpportunities(),
      getMempoolTxs(),
      getPortfolioHistory(),
      getAgentActivityLog(),
    ]);
    // Initialize agent scanning if log is empty
    if (agentActivities.length === 0) {
      await initializeAgentScanning();
      const refreshed = await getAgentActivityLog();
      return { chains, prices, fearGreed, arbitrage, mempool, portfolioData, agentActivities: refreshed };
    }
    return { chains, prices, fearGreed, arbitrage, mempool, portfolioData, agentActivities };
  },
  component: HomePage,
});

function HomePage() {
  const initial = Route.useLoaderData();
  const { address, isConnected } = useAccount();
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [mounted, setMounted] = useState(false);
  const [portfolioPrices, setPortfolioPrices] = useState<Record<string, { usd: number; change24h: number } | null>>({});
  const [pfolioLoading, setPfolioLoading] = useState(true);

  useEffect(() => { setMounted(true); }, []);

  // Blockchain data refresh
  useEffect(() => {
    const interval = setInterval(async () => {
      setRefreshing(true);
      try {
        const [chains, prices, fearGreed, arbitrage, mempool] = await Promise.all([
          getAllChainStatus(),
          getPrices(),
          getFearGreed(),
          getArbitrageOpportunities(),
          getMempoolTxs(),
        ]);
        setData(prev => ({ ...prev, chains, prices, fearGreed, arbitrage, mempool }));
        setLastRefresh(Date.now());
      } catch { /* keep current */ }
      setRefreshing(false);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch ERC-20 balances for connected wallet
  const tokens = getChainTokens(1); // Use Ethereum mainnet tokens for portfolio
  const erc20Tokens = tokens.filter(t => t.address !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

  const { data: nativeBalance } = useBalance({ address, query: { enabled: isConnected } });
  const { data: erc20Balances } = useReadContracts({
    contracts: erc20Tokens.map(t => ({
      address: t.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [address as Address],
    })),
    query: { enabled: isConnected && erc20Tokens.length > 0 },
  });

  // Portfolio prices
  useEffect(() => {
    if (!isConnected) { setPfolioLoading(false); return; }
    const syms = tokens.map(t => t.symbol);
    fetchPrices(syms).then(p => {
      setPortfolioPrices(p);
      setPfolioLoading(false);
    });
  }, [isConnected]);

  const portfolioValue = useMemo(() => {
    let total = 0;
    if (nativeBalance) {
      const sym = tokens.find(t => t.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE")?.symbol || nativeBalance.symbol;
      const price = portfolioPrices[sym]?.usd;
      if (price) total += parseFloat(nativeBalance.formatted) * price;
    }
    erc20Tokens.forEach((token, i) => {
      const bal = erc20Balances?.[i];
      if (bal?.status === "success" && bal.result && bal.result > 0n) {
        const price = portfolioPrices[token.symbol]?.usd;
        if (price) total += parseFloat(formatUnits(bal.result, token.decimals)) * price;
      }
    });
    return total;
  }, [nativeBalance, erc20Balances, portfolioPrices, tokens]);

  const { chains, prices, fearGreed, arbitrage, mempool, portfolioData, agentActivities: initialActivities } = data;
  const onlineChains = chains.filter((c) => c.online).length;
  const totalChains = chains.length;

  const fmtNum = (n: number) => n.toLocaleString("en-US");
  const fmtPrice = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const fmtBlock = (n: number | null) => n !== null ? fmtNum(n) : "—";
  const fmtGas = (n: number | null) => n !== null ? `${n.toFixed(1)} gwei` : "—";
  const fmtLatency = (n: number | null) => n !== null ? `${n}ms` : "—";
  const secondsAgo = Math.round((Date.now() - lastRefresh) / 1000);

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Wallet Status Hero ─────────────────────────────── */}
        <section className="animate-fade-in">
          {mounted && isConnected ? (
            <div className="glass-card p-6 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="status-dot-online"></span>
                <span className="text-sm text-gray-300 text-mono-sm">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              </div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Portfolio Value</p>
              <p className="text-3xl font-bold text-white text-mono">
                {pfolioLoading ? "Loading..." : fmtPrice(portfolioValue)}
              </p>
              <div className="flex items-center justify-center gap-3 mt-3">
                <Link to="/swap" className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/80 transition-colors">
                  Swap
                </Link>
                <Link to="/earn" className="px-4 py-2 rounded-lg bg-accent-green text-white text-sm font-medium hover:bg-accent-green/80 transition-colors">
                  Earn Yield
                </Link>
                <Link to="/portfolio" className="px-4 py-2 rounded-lg border border-dark-border bg-dark-hover text-gray-300 text-sm font-medium hover:text-white transition-colors">
                  View All →
                </Link>
              </div>
            </div>
          ) : (
            <div className="glass-card p-8 text-center">
              <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                🦚 Păun AI — DeFi Command Center
              </h1>
              <p className="text-gray-400 max-w-md mx-auto mb-6 text-sm">
                Connect your wallet to start earning yield, swapping tokens, and managing your portfolio across 20+ blockchains.
              </p>
              <p className="text-xs text-gray-500">Use the <span className="text-accent-blue">Connect Wallet</span> button in the top-right corner</p>
            </div>
          )}
        </section>

        {/* ── Header Stats Bar ──────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
          <HeaderStat
            label="BTC"
            value={prices.btc ? fmtPrice(prices.btc.usd) : "—"}
            change={prices.btc ? fmtPct(prices.btc.change24h) : null}
            positive={prices.btc ? prices.btc.change24h >= 0 : null}
            icon="₿"
          />
          <HeaderStat
            label="ETH"
            value={prices.eth ? fmtPrice(prices.eth.usd) : "—"}
            change={prices.eth ? fmtPct(prices.eth.change24h) : null}
            positive={prices.eth ? prices.eth.change24h >= 0 : null}
            icon="Ξ"
          />
          <HeaderStat
            label="Fear & Greed"
            value={fearGreed ? `${fearGreed.value}` : "—"}
            subtitle={fearGreed?.classification ?? null}
            positive={fearGreed ? fearGreed.value > 50 : null}
            icon="🧠"
          />
          <HeaderStat
            label="Chains Online"
            value={`${onlineChains}/${totalChains}`}
            subtitle={`${Math.round((onlineChains / totalChains) * 100)}% uptime`}
            positive={onlineChains > totalChains * 0.8}
            icon="🔗"
          />
        </section>

        {/* ── Portfolio Evolution Chart ──────────────────────── */}
        <section className="animate-fade-in-up">
          <PortfolioChart
            points={portfolioData.points}
            currentTotal={portfolioData.currentTotal}
          />
        </section>

        {/* ── Agent Activity Feed ────────────────────────────── */}
        <section className="animate-fade-in-up">
          <AgentFeed activities={initialActivities} />
        </section>

        {/* ── Refresh indicator ─────────────────────────────── */}
        <div className="flex items-center justify-between text-xs text-gray-400 animate-fade-in">
          <span>
            Last refresh: {secondsAgo}s ago
            {refreshing && <span className="ml-2 text-accent-blue animate-pulse-slow">⟳ refreshing...</span>}
          </span>
          <span className="text-mono-sm text-gray-400">
            {new Date(lastRefresh).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        </div>

        {/* ── Chain Status Grid ─────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Chain Status — {totalChains} Networks
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {chains.map((chain, i) => (
              <ChainStatusCard
                key={chain.id}
                chain={chain}
                delay={i * 30}
                fmtBlock={fmtBlock}
                fmtGas={fmtGas}
                fmtLatency={fmtLatency}
              />
            ))}
          </div>
        </section>

        {/* ── Arbitrage + Mempool ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Arbitrage Scanner */}
          <section>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-cyan">▸</span> Arbitrage Scanner
            </h2>
            <div className="glass-card p-4">
              {arbitrage.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-mono-sm">No profitable arbitrage opportunities detected</p>
                  <p className="text-xs mt-1 text-gray-400">Scanning cross-chain price discrepancies...</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-5 text-xs text-gray-400 pb-2 border-b border-dark-border">
                    <span>Pair</span>
                    <span>Route</span>
                    <span className="text-right">Buy</span>
                    <span className="text-right">Sell</span>
                    <span className="text-right">Profit</span>
                  </div>
                  {arbitrage.map((opp, i) => (
                    <div key={i} className="grid grid-cols-5 py-2 text-xs border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors rounded">
                      <span className="text-white font-medium text-mono-sm">{opp.pair}</span>
                      <span className="text-gray-300 text-mono-sm capitalize">
                        {opp.sourceChain} → {opp.destChain}
                      </span>
                      <span className="text-right text-mono-sm text-gray-200">${opp.sourcePrice.toFixed(2)}</span>
                      <span className="text-right text-mono-sm text-gray-200">${opp.destPrice.toFixed(2)}</span>
                      <span className="text-right text-mono-sm text-accent-green font-semibold">
                        +{opp.profitPct.toFixed(3)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Mempool Watcher */}
          <section>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-yellow">▸</span> Mempool Watcher
            </h2>
            <div className="glass-card p-4">
              {mempool.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-mono-sm">No large transactions detected</p>
                  <p className="text-xs mt-1 text-gray-400">Monitoring mempool for significant transfers...</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-4 text-xs text-gray-400 pb-2 border-b border-dark-border">
                    <span>Hash</span>
                    <span>From → To</span>
                    <span className="text-right">Value</span>
                    <span className="text-right">Chain</span>
                  </div>
                  {mempool.map((tx, i) => (
                    <div key={i} className="grid grid-cols-4 py-2 text-xs border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors rounded">
                      <span className="text-white text-mono-sm">{tx.hash}</span>
                      <span className="text-gray-400 text-mono-sm">{tx.from} → {tx.to}</span>
                      <span className="text-right text-mono-sm text-accent-yellow font-medium">{tx.value.toFixed(4)} ETH</span>
                      <span className="text-right text-mono-sm text-gray-300 capitalize">{tx.chain}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function HeaderStat({
  label, value, change, subtitle, positive, icon,
}: {
  label: string;
  value: string;
  change?: string | null;
  subtitle?: string | null;
  positive: boolean | null;
  icon: string;
}) {
  return (
    <div className="glass-panel blue-glow p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p className="text-xl font-bold text-white text-mono">{value}</p>
      {(change || subtitle) && (
        <div className="flex items-center gap-2 mt-1">
          {change && (
            <span className={`text-xs font-medium text-mono-sm ${positive === true ? 'text-accent-green' : positive === false ? 'text-accent-red' : 'text-gray-400'}`}>
              {change}
            </span>
          )}
          {subtitle && (
            <span className="text-xs text-gray-400">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ChainStatusCard({
  chain, delay, fmtBlock, fmtGas, fmtLatency,
}: {
  chain: ChainStatus;
  delay: number;
  fmtBlock: (n: number | null) => string;
  fmtGas: (n: number | null) => string;
  fmtLatency: (n: number | null) => string;
}) {
  return (
    <Link
      to="/chains/$chainId"
      params={{ chainId: chain.id }}
      className="glass-card p-3 animate-fade-in-up group block"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={chain.online ? "status-dot-online" : "status-dot-offline"}></span>
          <span className="text-sm font-semibold text-white group-hover:text-accent-blue transition-colors">{chain.name}</span>
        </div>
        <span className="text-xs text-gray-400">{chain.nativeToken}</span>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">Block</span>
          <span className="text-mono-sm text-gray-200">{fmtBlock(chain.blockHeight)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Gas</span>
          <span className="text-mono-sm text-gray-200">{chain.online ? fmtGas(chain.gasPrice) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Latency</span>
          <span className={`text-mono-sm ${chain.online ? 'text-accent-green' : 'text-accent-red'}`}>
            {fmtLatency(chain.latency)}
          </span>
        </div>
        {!chain.online && chain.error && (
          <div className="mt-1 pt-1 border-t border-dark-border">
            <span className="text-accent-red text-mono-sm block truncate" title={chain.error}>{chain.error}</span>
          </div>
        )}
      </div>
    </Link>
  );
}
