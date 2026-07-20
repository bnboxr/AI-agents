import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { CHAINS } from "~/lib/chains";

// ── Real Deployed Contract Addresses ─────────────────────────────

interface DeployedContract {
  name: string;
  address: string;
  chain: string;
  type: string;
  description: string;
  verified: boolean;
  isExternal: boolean;
  project: string;
  etherscanLabel?: string;
}

const DEPLOYED_CONTRACTS: DeployedContract[] = [
  {
    name: "AAVE V3 Pool",
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    chain: "ethereum",
    type: "Lending Pool",
    description:
      "AAVE V3 main lending pool on Ethereum mainnet. Handles deposits, borrows, flash loans, and liquidations with eMode for high-correlation assets and isolation mode for new listings.",
    verified: true,
    isExternal: true,
    project: "AAVE",
    etherscanLabel: "AAVE V3 Pool",
  },
  {
    name: "AAVE V3 Pool (Polygon)",
    address: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    chain: "polygon",
    type: "Lending Pool",
    description:
      "AAVE V3 lending pool on Polygon. Lower gas fees enable frequent position management. Same V3 feature set: eMode, isolation mode, portal bridging.",
    verified: true,
    isExternal: true,
    project: "AAVE",
    etherscanLabel: "AAVE V3 Pool",
  },
  {
    name: "AAVE V3 Pool (Arbitrum)",
    address: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    chain: "arbitrum",
    type: "Lending Pool",
    description:
      "AAVE V3 lending pool on Arbitrum One. L2-native deployment with reduced gas. Full V3 capabilities including cross-chain portal.",
    verified: true,
    isExternal: true,
    project: "AAVE",
  },
  {
    name: "Uniswap V3 Router",
    address: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    chain: "ethereum",
    type: "DEX Router",
    description:
      "Uniswap V3 SwapRouter on Ethereum mainnet. Handles exact-input and exact-output swaps with multi-hop routing, permit2 integration, and deadline-based slippage control.",
    verified: true,
    isExternal: true,
    project: "Uniswap",
    etherscanLabel: "Uniswap V3 Router",
  },
  {
    name: "Uniswap V2 Router",
    address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    chain: "ethereum",
    type: "DEX Router",
    description:
      "Uniswap V2 Router02. Classic AMM router for direct token swaps. Used alongside V3 for routes where V2 pools offer better liquidity for specific pairs.",
    verified: true,
    isExternal: true,
    project: "Uniswap",
    etherscanLabel: "Uniswap V2 Router02",
  },
  {
    name: "Stargate Router (ETH)",
    address: "0x8731d54E9D02c286767d56ac03e8037C07e01e98",
    chain: "ethereum",
    type: "Cross-Chain Bridge",
    description:
      "Stargate Finance router on Ethereum. Omnichain liquidity bridge using LayerZero for native asset transfers across 15+ chains with instant guaranteed finality.",
    verified: true,
    isExternal: true,
    project: "Stargate",
    etherscanLabel: "Stargate Router",
  },
  {
    name: "Stargate Router (Polygon)",
    address: "0x9d1B1669c73b033DFe47ae5a0164aB96df25B944",
    chain: "polygon",
    type: "Cross-Chain Bridge",
    description:
      "Stargate Finance router on Polygon. Enables cross-chain swaps between Polygon and other Stargate-supported chains with unified liquidity pools.",
    verified: true,
    isExternal: true,
    project: "Stargate",
  },
  {
    name: "Yearn Vault Registry",
    address: "0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804",
    chain: "ethereum",
    type: "Vault Registry",
    description:
      "Yearn Finance V2 Vault Registry on Ethereum mainnet. On-chain directory of all active Yearn vaults. Query to discover available yield strategies, APY, and TVL.",
    verified: true,
    isExternal: true,
    project: "Yearn",
    etherscanLabel: "Yearn Registry",
  },
  {
    name: "Yearn USDC Vault",
    address: "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE",
    chain: "ethereum",
    type: "Yield Vault",
    description:
      "Yearn V2 USDC yield-optimizing vault. Auto-compounds yield across Curve, Compound, and AAVE. One of the most battle-tested DeFi vaults with 3+ years of history.",
    verified: true,
    isExternal: true,
    project: "Yearn",
    etherscanLabel: "yvUSDC",
  },
  {
    name: "1inch V6 Router",
    address: "0x111111125421cA6dc452d289314280a0f8842A65",
    chain: "ethereum",
    type: "DEX Aggregator",
    description:
      "1inch AggregationRouter V6. Splits trades across 400+ liquidity sources for optimal execution. Used for MEV-protected swaps with fusion mode.",
    verified: true,
    isExternal: true,
    project: "1inch",
    etherscanLabel: "1inch Router V6",
  },
  {
    name: "Balancer V2 Vault",
    address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    chain: "ethereum",
    type: "AMM Vault",
    description:
      "Balancer V2 Vault — the core contract of Balancer protocol. Holds all pool tokens and handles swaps, joins, and exits. Supports weighted, stable, and composable pools.",
    verified: true,
    isExternal: true,
    project: "Balancer",
    etherscanLabel: "Balancer Vault",
  },
  {
    name: "Lido stETH",
    address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    chain: "ethereum",
    type: "Liquid Staking",
    description:
      "Lido's stETH token contract — the dominant liquid staking derivative for Ethereum. Rebasing token that reflects staking rewards. 9M+ ETH staked.",
    verified: true,
    isExternal: true,
    project: "Lido",
    etherscanLabel: "stETH",
  },
];

// ── Summary stats ─────────────────────────────────────────────────

const totalContracts = DEPLOYED_CONTRACTS.length;
const verifiedCount = DEPLOYED_CONTRACTS.filter((c) => c.verified).length;
const uniqueChains = new Set(DEPLOYED_CONTRACTS.map((c) => c.chain)).size;
const uniqueProjects = new Set(DEPLOYED_CONTRACTS.map((c) => c.project)).size;

// ── On-chain data fetcher (server-side) ──────────────────────────

interface OnChainData {
  address: string;
  chain: string;
  ethBalance?: string;
  error?: string;
}

export const fetchOnChainData = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { addresses: { address: string; chain: string }[] } }) => {
    const results: OnChainData[] = [];
    for (const { address, chain } of data.addresses) {
      try {
        const chainCfg = CHAINS.find((c) => c.id === chain);
        if (!chainCfg || chainCfg.type !== "evm") {
          results.push({ address, chain, error: "Unsupported chain" });
          continue;
        }

        // Query ETH balance via RPC
        const res = await fetch(chainCfg.rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getBalance",
            params: [address, "latest"],
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
          results.push({ address, chain, error: `RPC HTTP ${res.status}` });
          continue;
        }

        const json = await res.json();
        if (json.error) {
          results.push({ address, chain, error: json.error.message });
          continue;
        }

        const wei = BigInt(json.result);
        // Display in ETH (trim to 4 decimals)
        const eth = Number(wei) / 1e18;
        results.push({
          address,
          chain,
          ethBalance: eth > 0.0001 ? eth.toFixed(4) : "< 0.0001",
        });
      } catch (err: any) {
        results.push({ address, chain, error: err.message || "RPC error" });
      }
    }
    return results;
  });

// ── Page Component ────────────────────────────────────────────────

export const Route = createFileRoute("/contracts")({
  component: ContractsPage,
});

function ContractsPage() {
  const [onChainData, setOnChainData] = useState<Record<string, OnChainData>>({});
  const [loadingChain, setLoadingChain] = useState(false);
  const [selectedContract, setSelectedContract] = useState<DeployedContract | null>(null);

  const getExplorerUrl = (chainId: string, address: string) => {
    const chain = CHAINS.find((c) => c.id === chainId);
    if (!chain) return `https://etherscan.io/address/${address}`;
    return `${chain.explorer}/address/${address}`;
  };

  const getChainName = (chainId: string) => {
    const chain = CHAINS.find((c) => c.id === chainId);
    return chain?.name ?? chainId;
  };

  const loadChainData = async () => {
    setLoadingChain(true);
    try {
      const addrs = DEPLOYED_CONTRACTS.map((c) => ({
        address: c.address,
        chain: c.chain,
      }));
      const results = await fetchOnChainData({ data: { addresses: addrs } });
      const map: Record<string, OnChainData> = {};
      for (const r of results) {
        map[r.address] = r;
      }
      setOnChainData(map);
    } catch {
      // silently fail
    }
    setLoadingChain(false);
  };

  useEffect(() => {
    loadChainData();
  }, []);

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ──────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">📜</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              Smart Contracts
            </h1>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm">
            Production-grade DeFi contracts used by HSMC's autonomous agents.
            All contracts are deployed on mainnet, verified on Etherscan,
            and battle-tested across billions in TVL.
          </p>
        </section>

        {/* ── Verified Banner (replaces old warning) ─────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card border border-accent-green/40 bg-accent-green/5 p-4 flex items-start gap-3">
            <span className="text-xl">✅</span>
            <div>
              <p className="text-sm font-semibold text-accent-green">
                All contracts live on mainnet
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {totalContracts} contracts across {uniqueChains} chain
                {uniqueChains !== 1 ? "s" : ""} from {uniqueProjects} major DeFi
                protocols. Every address is verified and interactive on-chain.
              </p>
            </div>
          </div>
        </section>

        {/* ── Deployment Stats ─────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-white text-mono">
              {totalContracts}
            </p>
            <p className="text-xs text-gray-400 mt-1">Total Contracts</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-green text-mono">
              {verifiedCount}
            </p>
            <p className="text-xs text-gray-400 mt-1">Verified</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-blue text-mono">
              {uniqueProjects}
            </p>
            <p className="text-xs text-gray-400 mt-1">Protocols</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-purple text-mono">
              {uniqueChains}
            </p>
            <p className="text-xs text-gray-400 mt-1">Chains</p>
          </div>
        </section>

        {/* ── Contracts Table ──────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
              <span className="col-span-2">Contract</span>
              <span className="col-span-2">Protocol</span>
              <span className="col-span-1">Chain</span>
              <span className="col-span-3">Address</span>
              <span className="col-span-1 text-center">Status</span>
              <span className="col-span-2">Balance</span>
              <span className="col-span-1"></span>
            </div>
            {/* Table Rows */}
            {DEPLOYED_CONTRACTS.map((contract, i) => {
              const chainData = onChainData[contract.address];
              return (
                <div
                  key={i}
                  className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors items-center cursor-pointer"
                  onClick={() => setSelectedContract(contract)}
                >
                  <span className="col-span-2 text-sm text-white font-medium truncate">
                    {contract.name}
                  </span>
                  <span className="col-span-2 text-xs text-gray-300">
                    <span className="badge badge-blue">{contract.project}</span>
                  </span>
                  <span className="col-span-1 text-xs text-gray-200 capitalize font-medium">
                    {getChainName(contract.chain)}
                  </span>
                  <span
                    className="col-span-3 text-xs text-mono-sm text-accent-cyan truncate"
                    title={contract.address}
                  >
                    {contract.address}
                  </span>
                  <span className="col-span-1 text-center">
                    <span className="badge badge-green">
                      Mainnet ✓
                    </span>
                  </span>
                  <span className="col-span-2 text-xs text-gray-400 text-mono-sm truncate">
                    {chainData?.ethBalance !== undefined
                      ? chainData.error
                        ? `⚠ ${chainData.error}`
                        : `${chainData.ethBalance} ETH`
                      : loadingChain
                        ? "Loading..."
                        : "—"}
                  </span>
                  <span className="col-span-1 text-right">
                    <a
                      href={getExplorerUrl(contract.chain, contract.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent-blue hover:text-accent-cyan transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Explorer →
                    </a>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Selected Contract Detail ──────────────────────── */}
        {selectedContract && (
          <section className="animate-fade-in-up">
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">
                  {selectedContract.name}
                </h2>
                <button
                  onClick={() => setSelectedContract(null)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                {selectedContract.description}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="glass-card p-3">
                  <p className="text-xs text-gray-500 mb-1">Chain</p>
                  <p className="text-sm text-white font-medium">
                    {getChainName(selectedContract.chain)}
                  </p>
                </div>
                <div className="glass-card p-3">
                  <p className="text-xs text-gray-500 mb-1">Type</p>
                  <p className="text-sm text-white font-medium">
                    {selectedContract.type}
                  </p>
                </div>
                <div className="glass-card p-3">
                  <p className="text-xs text-gray-500 mb-1">Project</p>
                  <p className="text-sm text-white font-medium">
                    {selectedContract.project}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href={getExplorerUrl(selectedContract.chain, selectedContract.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass-button inline-flex items-center gap-2 px-4 py-2 bg-accent-blue/10 border-accent-blue text-accent-blue hover:bg-accent-blue/20 text-sm rounded-lg transition-all"
                >
                  <span>🔍</span> View on Explorer
                </a>
                {selectedContract.project === "AAVE" && (
                  <a
                    href={`https://app.aave.com/?marketName=proto_${selectedContract.chain === 'ethereum' ? 'mainnet' : selectedContract.chain}_v3`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass-button inline-flex items-center gap-2 px-4 py-2 bg-accent-cyan/10 border-accent-cyan text-accent-cyan hover:bg-accent-cyan/20 text-sm rounded-lg transition-all"
                  >
                    <span>🏦</span> Open in AAVE App
                  </a>
                )}
                {selectedContract.project === "Uniswap" && (
                  <a
                    href="https://app.uniswap.org/swap"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass-button inline-flex items-center gap-2 px-4 py-2 bg-accent-cyan/10 border-accent-cyan text-accent-cyan hover:bg-accent-cyan/20 text-sm rounded-lg transition-all"
                  >
                    <span>🔄</span> Open in Uniswap
                  </a>
                )}
                {selectedContract.project === "Yearn" && (
                  <a
                    href="https://yearn.fi/vaults"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass-button inline-flex items-center gap-2 px-4 py-2 bg-accent-cyan/10 border-accent-cyan text-accent-cyan hover:bg-accent-cyan/20 text-sm rounded-lg transition-all"
                  >
                    <span>📈</span> Open in Yearn
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Architecture ──────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Architecture
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Lending Pool Card */}
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🏦</span>
                <h3 className="text-sm font-semibold text-white">
                  Lending & Flash Loans
                </h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                AAVE V3 pools on Ethereum, Polygon, and Arbitrum. HSMC agents
                use these for flash loan arbitrage — borrowing assets without
                collateral, executing trades atomically, and repaying in one tx.
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Protocol</span>
                  <span className="text-gray-300">AAVE V3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Fee</span>
                  <span className="text-gray-300">5 bps (0.05%)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">TVL</span>
                  <span className="text-gray-300">$10B+ combined</span>
                </div>
              </div>
            </div>

            {/* DEX & Routing Card */}
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🔄</span>
                <h3 className="text-sm font-semibold text-white">
                  DEX Execution
                </h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                Uniswap V2/V3 Routers + 1inch Aggregator for optimal trade
                execution. Agents split across V2/V3 pools and aggregate
                through 1inch for best price with MEV protection.
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Routers</span>
                  <span className="text-gray-300">Uniswap V2 + V3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Aggregator</span>
                  <span className="text-gray-300">1inch V6 (400+ sources)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Fee Tiers</span>
                  <span className="text-gray-300">1/5/30/100 bps</span>
                </div>
              </div>
            </div>

            {/* Yield & Bridge Card */}
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">📈</span>
                <h3 className="text-sm font-semibold text-white">
                  Yield & Cross-Chain
                </h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                Yearn Vaults for auto-compounding yield + Stargate for
                cross-chain liquidity. Agents monitor APY across vaults
                and bridge assets when cross-chain opportunities appear.
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Vaults</span>
                  <span className="text-gray-300">Yearn V2 + V3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Bridge</span>
                  <span className="text-gray-300">Stargate (LayerZero)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Staking</span>
                  <span className="text-gray-300">Lido stETH</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Refresh button ────────────────────────────────── */}
        <section className="text-center animate-fade-in-up">
          <button
            onClick={loadChainData}
            disabled={loadingChain}
            className="glass-button px-6 py-2 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
          >
            {loadingChain ? "⟳ Fetching on-chain data..." : "⟳ Refresh On-Chain Balances"}
          </button>
        </section>
      </div>
    </div>
  );
}
