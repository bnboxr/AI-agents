import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getChain, CHAINS } from "~/lib/chains";
import { getChainStatus, checkChain } from "~/lib/blockchain";
import { getAgent, AGENTS, COINGECKO_IDS } from "~/lib/agents";
import { getPriceHistory, getTokenPrice, logAgentActivity } from "~/lib/agent-activity";
import { ChainChart } from "~/components/ChainChart";
import type { ChainStatus } from "~/lib/blockchain";
import type { AgentConfig } from "~/lib/agents";
import type { PricePoint } from "~/lib/agent-activity";

// ── DEX data per chain (real DEXes) ────────────────────────────────

interface DexInfo {
  name: string;
  url: string;
  type: string;
}

const CHAIN_DEXES: Record<string, DexInfo[]> = {
  ethereum: [
    { name: 'Uniswap V3', url: 'https://app.uniswap.org', type: 'DEX Aggregator' },
    { name: 'Curve', url: 'https://curve.fi', type: 'StableSwap' },
    { name: 'Balancer', url: 'https://balancer.fi', type: 'AMM' },
    { name: '1inch', url: 'https://1inch.io', type: 'Aggregator' },
  ],
  bnb: [
    { name: 'PancakeSwap V3', url: 'https://pancakeswap.finance', type: 'DEX' },
    { name: 'Venus', url: 'https://venus.io', type: 'Lending' },
    { name: 'Biswap', url: 'https://biswap.org', type: 'DEX' },
  ],
  polygon: [
    { name: 'QuickSwap', url: 'https://quickswap.exchange', type: 'DEX' },
    { name: 'Balancer Polygon', url: 'https://polygon.balancer.fi', type: 'AMM' },
    { name: 'SushiSwap', url: 'https://sushi.com', type: 'DEX' },
  ],
  arbitrum: [
    { name: 'Camelot', url: 'https://camelot.exchange', type: 'DEX' },
    { name: 'GMX', url: 'https://gmx.io', type: 'Perpetuals' },
    { name: 'SushiSwap Arbitrum', url: 'https://sushi.com', type: 'DEX' },
  ],
  optimism: [
    { name: 'Velodrome', url: 'https://velodrome.finance', type: 'DEX' },
    { name: 'Synthetix', url: 'https://synthetix.io', type: 'Derivatives' },
    { name: 'Uniswap V3 OP', url: 'https://app.uniswap.org', type: 'DEX' },
  ],
  base: [
    { name: 'Aerodrome', url: 'https://aerodrome.finance', type: 'DEX' },
    { name: 'Morpho', url: 'https://morpho.org', type: 'Lending' },
    { name: 'Uniswap V3 Base', url: 'https://app.uniswap.org', type: 'DEX' },
  ],
  avalanche: [
    { name: 'Trader Joe', url: 'https://traderjoexyz.com', type: 'DEX' },
    { name: 'Pangolin', url: 'https://pangolin.exchange', type: 'DEX' },
    { name: 'AAVE Avalanche', url: 'https://aave.com', type: 'Lending' },
  ],
  fantom: [
    { name: 'SpookySwap', url: 'https://spooky.fi', type: 'DEX' },
    { name: 'Beethoven X', url: 'https://beets.fi', type: 'AMM' },
    { name: 'Geist Finance', url: 'https://geist.finance', type: 'Lending' },
  ],
  gnosis: [
    { name: 'HoneySwap', url: 'https://honeyswap.org', type: 'DEX' },
    { name: 'Agave', url: 'https://agave.finance', type: 'Lending' },
  ],
  zksync: [
    { name: 'SyncSwap', url: 'https://syncswap.xyz', type: 'DEX' },
    { name: 'Mute', url: 'https://mute.io', type: 'DEX' },
  ],
  linea: [
    { name: 'SyncSwap Linea', url: 'https://syncswap.xyz', type: 'DEX' },
    { name: 'Mendi Finance', url: 'https://mendi.finance', type: 'Lending' },
  ],
  scroll: [
    { name: 'Skydrome', url: 'https://skydrome.finance', type: 'DEX' },
    { name: 'SyncSwap Scroll', url: 'https://syncswap.xyz', type: 'DEX' },
  ],
  mantle: [
    { name: 'Agni Finance', url: 'https://agni.finance', type: 'DEX' },
    { name: 'Lendle', url: 'https://lendle.xyz', type: 'Lending' },
  ],
  celo: [
    { name: 'Ubeswap', url: 'https://ubeswap.org', type: 'DEX' },
    { name: 'Moola Market', url: 'https://moola.market', type: 'Lending' },
  ],
  moonbeam: [
    { name: 'StellaSwap', url: 'https://stellaswap.com', type: 'DEX' },
    { name: 'Moonwell', url: 'https://moonwell.fi', type: 'Lending' },
  ],
  solana: [
    { name: 'Jupiter', url: 'https://jup.ag', type: 'Aggregator' },
    { name: 'Raydium', url: 'https://raydium.io', type: 'DEX' },
    { name: 'Orca', url: 'https://orca.so', type: 'DEX' },
    { name: 'Mango Markets', url: 'https://mango.markets', type: 'Perpetuals' },
  ],
  near: [
    { name: 'Ref Finance', url: 'https://ref.finance', type: 'DEX' },
    { name: 'Burrow', url: 'https://burrow.cash', type: 'Lending' },
  ],
  aptos: [
    { name: 'PancakeSwap Aptos', url: 'https://pancakeswap.finance/aptos', type: 'DEX' },
    { name: 'Liquidswap', url: 'https://liquidswap.com', type: 'DEX' },
    { name: 'Thala', url: 'https://thala.fi', type: 'DeFi' },
  ],
  sui: [
    { name: 'Cetus', url: 'https://cetus.zone', type: 'DEX' },
    { name: 'NAVI Protocol', url: 'https://naviprotocol.io', type: 'Lending' },
    { name: 'Turbos', url: 'https://turbos.finance', type: 'DEX' },
  ],
  tron: [
    { name: 'SUNSwap', url: 'https://sunswap.com', type: 'DEX' },
    { name: 'JustLend', url: 'https://justlend.org', type: 'Lending' },
  ],
};

// ── Known PaunAI contracts ──
const PAUNAI_CONTRACTS: Record<string, { address: string; name: string }[]> = {
  ethereum: [],
  bnb: [],
  polygon: [],
  arbitrum: [],
  optimism: [],
  base: [],
  avalanche: [],
  fantom: [],
  gnosis: [],
  zksync: [],
  linea: [],
  scroll: [],
  mantle: [],
  celo: [],
  moonbeam: [],
  solana: [],
  near: [],
  aptos: [],
  sui: [],
  tron: [],
};

export const Route = createFileRoute("/chains/$chainId")({
  loader: async ({ params }) => {
    const chainConfig = getChain(params.chainId);
    if (!chainConfig) throw new Error("Chain not found");

    const coingeckoId = COINGECKO_IDS[params.chainId] || 'ethereum';
    const [chainStatus, priceHistory, tokenPrice] = await Promise.all([
      checkChain(chainConfig),
      getPriceHistory({ coingeckoId, days: 30 }),
      getTokenPrice({ coingeckoId }),
    ]);

    return {
      chainId: params.chainId,
      chainConfig,
      chainStatus,
      priceHistory,
      tokenPrice,
    };
  },
  component: ChainDetailPage,
  notFoundComponent: () => (
    <div className="flex min-h-dvh items-center justify-center bg-darker">
      <div className="glass-card p-12 text-center max-w-md">
        <h1 className="text-6xl font-black text-gradient-blue mb-4">404</h1>
        <p className="text-gray-400 text-lg">Chain not found</p>
        <Link to="/chains" className="mt-6 inline-block text-accent-blue hover:text-accent-cyan transition-colors">
          ← Back to Chains
        </Link>
      </div>
    </div>
  ),
});

function ChainDetailPage() {
  const { chainId, chainConfig, chainStatus: initialStatus, priceHistory, tokenPrice } = Route.useLoaderData();
  const [chainStatus, setChainStatus] = useState(initialStatus);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mounted, setMounted] = useState(false);

  const agent: AgentConfig | undefined = AGENTS[chainId];
  const dexs = CHAIN_DEXES[chainId] || [];
  const contracts = PAUNAI_CONTRACTS[chainId] || [];
  const explorer = chainConfig.explorer;

  useEffect(() => { setMounted(true); }, []);

  // Auto-refresh chain status
  useEffect(() => {
    const interval = setInterval(async () => {
      setRefreshing(true);
      try {
        const status = await getChainStatus(chainId);
        setChainStatus(status);
      } catch { /* keep */ }
      setRefreshing(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [chainId]);

  const handleForceScan = async () => {
    setScanning(true);
    try {
      const status = await getChainStatus(chainId);
      setChainStatus(status);
      await logAgentActivity({
        chainId,
        agentName: agent?.name ?? 'Agent',
        action: `Scanare forțată pe ${chainConfig.name} — verificare oportunități`,
        type: 'scan',
      });
    } catch { /* ignore */ }
    setTimeout(() => setScanning(false), 2000);
  };

  const fmtNum = (n: number) => n.toLocaleString("en-US");
  const fmtPrice = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n > 100 ? 2 : 4, maximumFractionDigits: n > 100 ? 2 : 4 });

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Breadcrumb ──────────────────────────────────── */}
        <div className="flex items-center gap-2 text-xs text-gray-400 animate-fade-in">
          <Link to="/chains" className="hover:text-accent-blue transition-colors">Chains</Link>
          <span>/</span>
          <span className="text-white font-medium">{chainConfig.name}</span>
          {refreshing && <span className="ml-2 text-accent-blue animate-pulse-slow">⟳</span>}
        </div>

        {/* ── Hero Section ───────────────────────────────── */}
        <section className="glass-card p-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{agent?.icon || '🔗'}</span>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
                  {chainConfig.name}
                  <span className={chainStatus.online ? "status-dot-online" : "status-dot-offline"}></span>
                </h1>
                <p className="text-sm text-gray-400">
                  Native: {chainConfig.nativeToken} • Type: {chainConfig.type.toUpperCase()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg border border-dark-border text-xs text-gray-400 hover:text-white hover:border-accent-blue/30 transition-all"
              >
                Explorer ↗
              </a>
              <button
                onClick={handleForceScan}
                disabled={scanning}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  scanning
                    ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                    : 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/30'
                }`}
              >
                {scanning ? 'Scanning...' : 'Force Scan'}
              </button>
            </div>
          </div>

          {/* Status Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-dark-border">
            <HeroStat
              label="Block Height"
              value={chainStatus.blockHeight !== null ? fmtNum(chainStatus.blockHeight) : '—'}
              icon="📦"
            />
            <HeroStat
              label="Gas Price"
              value={chainStatus.gasPrice !== null ? `${chainStatus.gasPrice.toFixed(1)} gwei` : '—'}
              icon="⛽"
            />
            <HeroStat
              label={`${chainConfig.nativeToken} Price`}
              value={tokenPrice?.usd ? fmtPrice(tokenPrice.usd) : '—'}
              change={tokenPrice?.change24h ?? null}
              icon="💰"
            />
            <HeroStat
              label="Latency"
              value={chainStatus.latency !== null ? `${chainStatus.latency}ms` : '—'}
              icon="⚡"
            />
          </div>
        </section>

        {/* ── Price Chart ───────────────────────────────── */}
        <section className="animate-fade-in-up">
          <ChainChart
            points={priceHistory}
            tokenSymbol={chainConfig.nativeToken}
            currentPrice={tokenPrice?.usd ?? null}
            change24h={tokenPrice?.change24h ?? null}
          />
        </section>

        {/* ── Agent Card + Actions ───────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent Info */}
          <section className="animate-fade-in-up">
            {agent ? (
              <div className="glass-card p-6 h-full">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span className="text-accent-cyan">▸</span> Chain Agent
                </h2>
                <div className="flex items-start gap-4">
                  <span className="text-4xl">{agent.icon}</span>
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">{agent.name}</span>
                      <span className={`badge ${chainStatus.online ? 'badge-green' : 'badge-red'}`}>
                        {chainStatus.online ? 'Active' : 'Offline'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{agent.role}</p>
                    <p className="text-sm text-gray-300">{agent.description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {agent.strategies.map((s) => (
                        <span key={s} className="badge badge-blue text-[0.625rem]">{s}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-card p-6 h-full flex items-center justify-center">
                <p className="text-gray-400 text-sm">No agent assigned to this chain</p>
              </div>
            )}
          </section>

          {/* Actions */}
          <section className="animate-fade-in-up">
            <div className="glass-card p-6">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="text-accent-teal">▸</span> Actions on {chainConfig.name}
              </h2>
              <div className="grid grid-cols-2 gap-2">
                <ActionButton
                  to="/swap"
                  icon="💱"
                  label="Swap"
                  desc={`Trade tokens on ${chainConfig.name}`}
                />
                <ActionButton
                  to="/earn"
                  icon="📈"
                  label="Deposit"
                  desc={`Earn yield on ${chainConfig.name}`}
                />
                <ActionButton
                  to="/withdraw"
                  icon="📤"
                  label="Withdraw"
                  desc={`Withdraw from ${chainConfig.name}`}
                />
                <ActionButton
                  to="/arbitrage"
                  icon="🌉"
                  label="Arbitrage"
                  desc="Cross-chain arbitrage"
                />
              </div>
            </div>
          </section>
        </div>

        {/* ── DEXes & Contracts ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top DEXes */}
          <section className="animate-fade-in-up">
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="text-accent-yellow">▸</span> Top DEXes & Protocols
              </h2>
              {dexs.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No DEX data available for this chain</p>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-3 text-xs text-gray-400 pb-2 border-b border-dark-border">
                    <span>Name</span>
                    <span>Type</span>
                    <span className="text-right">Link</span>
                  </div>
                  {dexs.map((dex) => (
                    <div key={dex.name} className="grid grid-cols-3 py-2 text-xs border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors rounded px-2">
                      <span className="text-white font-medium">{dex.name}</span>
                      <span className="text-gray-300">{dex.type}</span>
                      <span className="text-right">
                        <a
                          href={dex.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-blue hover:text-accent-cyan transition-colors"
                        >
                          Open ↗
                        </a>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* PăunAI Contracts */}
          <section className="animate-fade-in-up">
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="text-accent-blue">▸</span> PăunAI Contracts
              </h2>
              {contracts.length === 0 ? (
                <div className="py-4 text-center text-gray-400">
                  <p className="text-sm">No contracts deployed on {chainConfig.name}</p>
                  <p className="text-xs mt-1 text-gray-400">Smart contracts are deployed as agents activate on this chain</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-2 text-xs text-gray-400 pb-2 border-b border-dark-border">
                    <span>Contract</span>
                    <span className="text-right">Address</span>
                  </div>
                  {contracts.map((c) => (
                    <div key={c.address} className="grid grid-cols-2 py-2 text-xs border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors rounded px-2">
                      <span className="text-white font-medium">{c.name}</span>
                      <span className="text-right">
                        <a
                          href={`${explorer}/address/${c.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-mono-sm text-accent-blue hover:text-accent-cyan transition-colors"
                        >
                          {c.address.slice(0, 8)}...{c.address.slice(-6)}
                        </a>
                      </span>
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

function HeroStat({
  label,
  value,
  change,
  icon,
}: {
  label: string;
  value: string;
  change?: number | null;
  icon: string;
}) {
  return (
    <div className="bg-dark-hover/50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-[0.625rem] text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-white text-mono">{value}</span>
        {change !== null && change !== undefined && (
          <span className={`text-[0.625rem] font-medium ${change >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  to,
  icon,
  label,
  desc,
}: {
  to: string;
  icon: string;
  label: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="card p-4 hover:border-accent-blue/30 hover:bg-dark-hover/80 transition-all group"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{icon}</span>
        <span className="text-sm font-semibold text-white group-hover:text-accent-blue transition-colors">{label}</span>
      </div>
      <p className="text-[0.625rem] text-gray-400">{desc}</p>
    </Link>
  );
}
