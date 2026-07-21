import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useBalance, useWaitForTransactionReceipt } from "~/lib/demo-wagmi";
import { parseUnits, formatUnits, parseEther, type Address } from "viem";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import {
  getStakingProtocols,
  getStakingByChain,
  getBestAPYPerAsset,
  getAPYHistory,
} from "~/lib/staking";
import type { StakingProtocol, StakingChainGroup, StakingAPYHistory } from "~/lib/staking";
import { addNotification } from "~/lib/notifications";
import {
  discoverPools,
  depositLP,
  getLPYield,
  compound,
  closePosition,
  computeOptimalCompoundInterval,
  type LPPosition,
  type DeFiLlamaPool,
} from "~/lib/revenue/lp-compounder";

export const Route = createFileRoute("/stake")({
  loader: async () => {
    const [protocols, byChain, bestAPY, apyHistory] = await Promise.all([
      getStakingProtocols(),
      getStakingByChain(),
      getBestAPYPerAsset(),
      getAPYHistory(),
    ]);
    return { protocols, byChain, bestAPY, apyHistory };
  },
  component: StakePage,
});

// ── Lido stETH ABI ────────────────────────────────────────────────
const LIDO_STETH_ABI = [
  {
    inputs: [{ name: "_referral", type: "address" }],
    name: "submit",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "getTotalPooledEther",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getTotalShares",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ── AAVE V3 Pool ABI ──────────────────────────────────────────────
const AAVE_POOL_ABI = [
  {
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    name: "supply",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    name: "withdraw",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "asset", type: "address" }],
    name: "getReserveData",
    outputs: [
      { name: "configuration", type: "uint256" },
      { name: "liquidityIndex", type: "uint128" },
      { name: "currentLiquidityRate", type: "uint128" },
      { name: "variableBorrowIndex", type: "uint128" },
      { name: "currentVariableBorrowRate", type: "uint128" },
      { name: "currentStableBorrowRate", type: "uint128" },
      { name: "lastUpdateTimestamp", type: "uint40" },
      { name: "id", type: "uint16" },
      { name: "aTokenAddress", type: "address" },
      { name: "stableDebtTokenAddress", type: "address" },
      { name: "variableDebtTokenAddress", type: "address" },
      { name: "interestRateStrategyAddress", type: "address" },
      { name: "accruedToTreasury", type: "uint128" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ── ERC-20 ABI (approve) ──────────────────────────────────────────
const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ── Known contract addresses ──────────────────────────────────────
const LIDO_STETH_ADDRESS: Record<number, `0x${string}`> = {
  1: "0xae7ab96520DE3A18E5e111B5EaAb0953127DfE84", // Ethereum
};

const AAVE_POOL_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",       // Ethereum
  42161: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  10: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  137: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  43114: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

const SUPPORTED_ASSETS: Record<number, { address: `0x${string}`; symbol: string; decimals: number }[]> = {
  1: [
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18 },
    { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", symbol: "ETH", decimals: 18 },
  ],
  42161: [
    { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6 },
  ],
};

// ── Types for execution state ─────────────────────────────────────
interface StakeExecutionState {
  protocol: StakingProtocol;
  amount: string;
  txHash: `0x${string}` | null;
  status: 'idle' | 'approving' | 'approve-confirming' | 'staking' | 'staking-confirming' | 'confirmed' | 'unstaking' | 'unstaking-confirming';
}

function StakePage() {
  const initial = Route.useLoaderData();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [protocols, setProtocols] = useState(initial.protocols);
  const [byChain, setByChain] = useState(initial.byChain);
  const [bestAPY, setBestAPY] = useState(initial.bestAPY);
  const [apyHistory] = useState(initial.apyHistory);
  const [selectedChain, setSelectedChain] = useState<string>("all");
  const [selectedProtocol, setSelectedProtocol] = useState<StakingProtocol | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [execState, setExecState] = useState<StakeExecutionState | null>(null);

  // ── Determine if the selected protocol supports direct staking ──
  const canStakeDirectly = useMemo(() => {
    if (!selectedProtocol || !chainId) return false;
    // Lido stETH on Ethereum mainnet
    if (selectedProtocol.id === 'lido-steth' && chainId === 1) return true;
    // AAVE lending protocols on supported chains
    if (selectedProtocol.type === 'lending' && AAVE_POOL_ADDRESSES[chainId]) return true;
    return false;
  }, [selectedProtocol, chainId]);

  const isLidoProtocol = selectedProtocol?.id === 'lido-steth';
  const isAaveLending = selectedProtocol?.type === 'lending';

  const poolAddress = chainId ? AAVE_POOL_ADDRESSES[chainId] : undefined;
  const stethAddress = chainId ? LIDO_STETH_ADDRESS[chainId] : undefined;

  // ── Get the asset address for AAVE supply ───────────────────────
  const assetInfo = useMemo(() => {
    if (!isAaveLending || !chainId) return null;
    const assets = SUPPORTED_ASSETS[chainId] || [];
    return assets.find(a => a.symbol === selectedProtocol?.asset) ?? assets[0];
  }, [isAaveLending, chainId, selectedProtocol]);

  // ── Read: AAVE reserve data ────────────────────────────────────
  const { data: reserveData } = useReadContract({
    address: poolAddress,
    abi: AAVE_POOL_ABI,
    functionName: "getReserveData",
    args: isAaveLending && assetInfo ? [assetInfo.address] : undefined,
    query: { enabled: !!poolAddress && isAaveLending && !!assetInfo },
  });

  const liveSupplyAPY = reserveData
    ? (Number(reserveData[2]) / 1e27) * 100
    : null;

  // ── Read: Lido pool stats ──────────────────────────────────────
  const { data: lidoPooledEth } = useReadContract({
    address: stethAddress,
    abi: LIDO_STETH_ABI,
    functionName: "getTotalPooledEther",
    query: { enabled: !!stethAddress && isLidoProtocol },
  });

  // ── Read: allowance for AAVE ────────────────────────────────────
  const { data: tokenAllowance } = useReadContract({
    address: assetInfo?.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && poolAddress && assetInfo ? [address, poolAddress] : undefined,
    query: { enabled: !!assetInfo && !!address && !!poolAddress && isAaveLending },
  });

  // ── Wallet balance ──────────────────────────────────────────────
  const { data: ethBalance } = useBalance({
    address,
    query: { enabled: !!address && isLidoProtocol },
  });

  const { data: tokenBalance } = useBalance({
    address,
    token: isAaveLending ? assetInfo?.address : undefined,
    query: { enabled: !!address && isAaveLending && !!assetInfo },
  });

  // ── Write contracts ─────────────────────────────────────────────
  const { writeContract: writeContractRaw, data: txData, isPending: txPending } = useWriteContract();

  // Track tx hash from writeContract return
  useEffect(() => {
    if (txData && execState && !execState.txHash) {
      setExecState(prev => prev ? { ...prev, txHash: txData } : null);
    }
  }, [txData]);

  const { isLoading: txConfirming, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: execState?.txHash ?? undefined,
  });

  // ── Update execState based on tx status ─────────────────────────
  useEffect(() => {
    if (!execState) return;
    if (txConfirming && execState.status === 'staking') {
      setExecState(prev => prev ? { ...prev, status: 'staking-confirming' } : null);
    }
    if (txConfirming && execState.status === 'approving') {
      setExecState(prev => prev ? { ...prev, status: 'approve-confirming' } : null);
    }
    if (txConfirmed && (execState.status === 'staking-confirming' || execState.status === 'approve-confirming')) {
      // If we just approved, now do the actual stake
      if (execState.status === 'approve-confirming' && execState.protocol) {
        executeStake(execState.protocol, execState.amount);
      } else {
        setExecState(prev => prev ? { ...prev, status: 'confirmed' } : null);
      }
    }
    if (txConfirmed && execState.status === 'unstaking-confirming') {
      setExecState(prev => prev ? { ...prev, status: 'confirmed' } : null);
    }
  }, [txConfirming, txConfirmed]);

  // ── Poll protocols every 5 minutes ──────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [freshProtocols, freshByChain, freshBestAPY] = await Promise.all([
          getStakingProtocols(),
          getStakingByChain(),
          getBestAPYPerAsset(),
        ]);
        setProtocols(freshProtocols);
        setByChain(freshByChain);
        setBestAPY(freshBestAPY);
      } catch {
        // keep stale data on error
      }
    }, 300_000); // 5 minutes
    return () => clearInterval(interval);
  }, []);

  // ── Execute real staking ────────────────────────────────────────
  const executeStake = useCallback(async (protocol: StakingProtocol, amount: string) => {
    if (!address || !amount) return;

    if (protocol.id === 'lido-steth' && stethAddress) {
      // Lido: submit ETH to receive stETH
      const wei = parseEther(amount);
      setExecState({ protocol, amount, txHash: null, status: 'staking' });
      writeContractRaw({
        address: stethAddress,
        abi: LIDO_STETH_ABI,
        functionName: "submit",
        args: [address], // _referral = self
        value: wei,
      });
    } else if (protocol.type === 'lending' && poolAddress && assetInfo) {
      // AAVE: first approve, then supply
      if (tokenAllowance) {
        try {
          const parsed = parseUnits(amount, assetInfo.decimals);
          if (tokenAllowance < parsed) {
            // Need approval first
            setExecState({ protocol, amount, txHash: null, status: 'approving' });
            writeContractRaw({
              address: assetInfo.address,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [poolAddress, parseUnits("999999999", assetInfo.decimals)],
            });
            return;
          }
        } catch {
          // fall through to direct supply
        }
      }
      // Supply directly
      const parsed = parseUnits(amount, assetInfo.decimals);
      setExecState({ protocol, amount, txHash: null, status: 'staking' });
      writeContractRaw({
        address: poolAddress,
        abi: AAVE_POOL_ABI,
        functionName: "supply",
        args: [assetInfo.address, parsed, address, 0],
      });
    }
  }, [address, stethAddress, poolAddress, assetInfo, tokenAllowance, writeContractRaw]);

  const handleStake = async () => {
    if (!selectedProtocol || !stakeAmount) return;
    executeStake(selectedProtocol, stakeAmount);
  };

  const handleUnstake = () => {
    if (!selectedProtocol || !stakeAmount || !address || !poolAddress || !assetInfo) return;
    const parsed = parseUnits(stakeAmount, assetInfo.decimals);
    setExecState({ protocol: selectedProtocol, amount: stakeAmount, txHash: null, status: 'unstaking' });
    writeContractRaw({
      address: poolAddress,
      abi: AAVE_POOL_ABI,
      functionName: "withdraw",
      args: [assetInfo.address, parsed, address],
    });
  };

  const handleReset = () => {
    setExecState(null);
    setStakeAmount("");
  };

  // ── Derived data ────────────────────────────────────────────────
  const chains = useMemo(() => {
    const unique = new Map<string, string>();
    protocols.forEach(p => unique.set(p.chain, p.chain.charAt(0).toUpperCase() + p.chain.slice(1)));
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name }));
  }, [protocols]);

  const filteredProtocols = useMemo(() => {
    if (selectedChain === "all") return protocols;
    return protocols.filter(p => p.chain === selectedChain);
  }, [protocols, selectedChain]);

  const selectedHistory = useMemo(() => {
    if (!selectedProtocol) return null;
    return apyHistory.find(h => h.protocolId === selectedProtocol.id);
  }, [selectedProtocol, apyHistory]);

  const allAssets = useMemo(() => Object.keys(bestAPY), [bestAPY]);

  // Display APY: prefer live on-chain APY for selected protocol
  const displayAPY = useMemo(() => {
    if (!selectedProtocol) return null;
    if (isAaveLending && liveSupplyAPY !== null) return liveSupplyAPY;
    if (isLidoProtocol && selectedProtocol.apy > 0) return selectedProtocol.apy;
    return selectedProtocol.apy;
  }, [selectedProtocol, isAaveLending, isLidoProtocol, liveSupplyAPY]);

  const fmtUSD = (n: number) => {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  };
  const fmtAPY = (n: number) => `${n.toFixed(2)}%`;
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // ── Determine button state labels ───────────────────────────────
  const getStakeButtonLabel = () => {
    if (!isConnected) return "Connect wallet";
    if (!execState) return `Stake ${selectedProtocol?.asset || ""}`;
    switch (execState.status) {
      case 'approving': return "Approving token...";
      case 'approve-confirming': return "Confirming approval...";
      case 'staking': return "Staking...";
      case 'staking-confirming': return "Confirming stake...";
      case 'confirmed': return "✓ Staked!";
      case 'unstaking': return "Unstaking...";
      case 'unstaking-confirming': return "Confirming unstake...";
      default: return `Stake ${selectedProtocol?.asset || ""}`;
    }
  };

  const isStakeButtonDisabled = () => {
    if (!stakeAmount || !isConnected) return true;
    if (execState) {
      if (execState.status === 'confirmed') return false; // allow re-stake
      if (execState.status !== 'idle') return true;
    }
    return false;
  };

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ─────────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
                <span>⚡</span> Staking Automat
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Real APY data from DeFiLlama + protocol APIs — stake directly on-chain
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {protocols.length} protocoale • {chains.length} chain-uri
              </span>
              <span className="text-xs text-accent-green">
                ● Live
              </span>
            </div>
          </div>
        </section>

        {/* ── Best APY Per Asset ────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-green">▸</span> Best APY per Asset
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {allAssets.map((asset) => {
              const proto = bestAPY[asset];
              if (!proto) return null;
              return (
                <button
                  key={asset}
                  onClick={() => { setSelectedProtocol(proto); setExecState(null); setStakeAmount(""); }}
                  className={`card p-4 text-left transition-all duration-200 ${
                    selectedProtocol?.id === proto.id ? 'border-accent-blue bg-dark-hover' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">{asset}</span>
                    <span className="badge-green text-[0.6rem]">Best</span>
                  </div>
                  <p className="text-lg font-bold text-accent-green text-mono">{fmtAPY(proto.apy)}</p>
                  <p className="text-xs text-gray-400 mt-1 truncate">{proto.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{proto.chain}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── APY Scanner Table ─────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <span className="text-accent-blue">▸</span> APY Scanner — All Protocols
            </h2>
            <select
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value)}
              className="glass-input py-1.5 px-3 text-sm text-gray-200 rounded-lg"
            >
              <option value="all">🌐 All chains</option>
              {chains.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-gray-400">
                    <th className="text-left py-3 px-4 font-medium">Protocol</th>
                    <th className="text-left py-3 px-4 font-medium">Chain</th>
                    <th className="text-left py-3 px-4 font-medium">Asset</th>
                    <th className="text-right py-3 px-4 font-medium">APY</th>
                    <th className="text-right py-3 px-4 font-medium hidden sm:table-cell">TVL</th>
                    <th className="text-right py-3 px-4 font-medium hidden md:table-cell">Contract</th>
                    <th className="text-center py-3 px-4 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProtocols.map((proto) => (
                    <tr
                      key={proto.id}
                      className={`border-b border-dark-border hover:bg-dark-hover transition-colors cursor-pointer ${
                        selectedProtocol?.id === proto.id ? 'bg-dark-hover' : ''
                      }`}
                      onClick={() => { setSelectedProtocol(proto); setExecState(null); setStakeAmount(""); }}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{proto.name}</span>
                          {proto.autocompounding && (
                            <span className="badge-cyan text-[0.55rem]">auto</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-300 capitalize">{proto.chain}</td>
                      <td className="py-3 px-4 text-gray-200 font-medium">{proto.asset}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`text-mono-sm font-bold ${
                          proto.apy >= 10 ? 'text-accent-green' :
                          proto.apy >= 5 ? 'text-accent-yellow' :
                          'text-gray-300'
                        }`}>
                          {fmtAPY(proto.apy)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-400 hidden sm:table-cell">
                        {proto.tvl > 0 ? fmtUSD(proto.tvl) : "—"}
                      </td>
                      <td className="py-3 px-4 text-right text-mono-sm text-gray-400 hidden md:table-cell">
                        {proto.contractAddress === 'native' ? 'Native' : `${proto.contractAddress.slice(0, 6)}...${proto.contractAddress.slice(-4)}`}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <a
                          href={proto.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-blue hover:text-accent-cyan text-xs transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Site ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Stake/Unstake Panel ────────────────────────────── */}
        {selectedProtocol && (
          <section className="animate-fade-in-up">
            <div className="glass-card p-6 max-w-lg">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span>{selectedProtocol.name}</span>
                <span className="text-sm text-gray-400">
                  — {displayAPY !== null ? fmtAPY(displayAPY) : "Loading..."} APY
                </span>
              </h3>

              {/* Live APY indicator */}
              {isAaveLending && (
                <div className="bg-dark-hover/50 rounded-xl p-3 border border-dark-border mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">AAVE V3 Supply APY (on-chain)</span>
                    <span className={`text-lg font-bold text-mono ${liveSupplyAPY !== null ? 'text-accent-green' : 'text-gray-400'}`}>
                      {liveSupplyAPY !== null ? `${liveSupplyAPY.toFixed(2)}%` : "Reading..."}
                    </span>
                  </div>
                </div>
              )}

              {/* Lido TVL */}
              {isLidoProtocol && lidoPooledEth != null && (
                <div className="bg-dark-hover/50 rounded-xl p-3 border border-dark-border mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Total Pooled ETH (on-chain)</span>
                    <span className="text-lg font-bold text-mono text-accent-blue">
                      {parseFloat(formatUnits(lidoPooledEth, 18)).toLocaleString()} ETH
                    </span>
                  </div>
                </div>
              )}

              {/* Wallet Balance */}
              <div className="flex items-center justify-between text-xs mb-4">
                <span className="text-gray-400">
                  Wallet: {
                    isLidoProtocol
                      ? (ethBalance ? `${parseFloat(ethBalance.formatted).toFixed(4)} ETH` : "...")
                      : (tokenBalance ? `${parseFloat(tokenBalance.formatted).toFixed(4)} ${selectedProtocol.asset}` : "...")
                  }
                </span>
                <button
                  onClick={() => {
                    if (isLidoProtocol && ethBalance) setStakeAmount(ethBalance.formatted);
                    else if (tokenBalance) setStakeAmount(tokenBalance.formatted);
                  }}
                  className="text-accent-blue hover:text-accent-cyan transition-colors"
                >
                  MAX
                </button>
              </div>

              {/* Transaction status display */}
              {execState?.txHash && (
                <div className={`glass-card p-3 mb-4 ${
                  execState.status === 'confirmed' ? 'bg-accent-green/5 border-accent-green/20' :
                  execState.status.includes('confirming') ? 'bg-accent-yellow/5 border-accent-yellow/20' :
                  'bg-accent-blue/5 border-accent-blue/20'
                }`}>
                  <p className={`text-xs font-medium ${
                    execState.status === 'confirmed' ? 'text-accent-green' :
                    execState.status.includes('confirming') ? 'text-accent-yellow' :
                    'text-accent-blue'
                  }`}>
                    {execState.status === 'confirmed'
                      ? '✅ Transaction confirmed!'
                      : execState.status.includes('confirming')
                      ? '⏳ Waiting for confirmation...'
                      : '📝 Transaction submitted'}
                  </p>
                  <p className="text-mono-sm text-gray-400 mt-1 text-[0.6rem] truncate">
                    Tx: {execState.txHash}
                  </p>
                  {execState.status === 'confirmed' && (
                    <button
                      onClick={handleReset}
                      className="mt-2 text-xs text-accent-blue hover:text-accent-cyan transition-colors"
                    >
                      Stake again →
                    </button>
                  )}
                </div>
              )}

              {/* Stake input (not yet confirmed) */}
              {(!execState || execState.status === 'confirmed') && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">
                      Amount ({selectedProtocol.asset})
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        placeholder={`0.0 ${selectedProtocol.asset}`}
                        className="glass-input flex-1 text-mono"
                      />
                    </div>
                    {stakeAmount && (displayAPY ?? selectedProtocol.apy) > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        Estimated yearly reward: <span className="text-accent-green">
                          {(parseFloat(stakeAmount) * (displayAPY ?? selectedProtocol.apy) / 100).toFixed(4)} {selectedProtocol.asset}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Can stake directly */}
                  {canStakeDirectly ? (
                    <div>
                      <button
                        onClick={handleStake}
                        disabled={isStakeButtonDisabled()}
                        className="w-full glass-button bg-gradient-to-r from-green-500/80 to-emerald-500/80 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {getStakeButtonLabel()}
                      </button>
                      {isAaveLending && (
                        <button
                          onClick={handleUnstake}
                          disabled={!stakeAmount || !isConnected}
                          className="w-full mt-2 glass-button bg-gradient-to-r from-red-500/80 to-orange-500/80 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Unstake {selectedProtocol.asset}
                        </button>
                      )}
                      {!isConnected && (
                        <p className="text-xs text-gray-400 text-center mt-2">
                          Connect your wallet to execute real on-chain staking
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <a
                        href={selectedProtocol.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full glass-button bg-gradient-to-r from-blue-500/80 to-cyan-500/80 text-center block"
                      >
                        Stake via {selectedProtocol.name} ↗
                      </a>
                      <p className="text-xs text-gray-400 text-center mt-2">
                        Direct on-chain staking via HSMC is available for Lido (ETH) and AAVE V3 pools.
                        For other protocols, you'll be redirected to their native interface.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Pending state */}
              {execState && execState.status !== 'confirmed' && execState.status !== 'idle' && (
                <div className="text-center py-4">
                  <div className="animate-spin inline-block w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full mb-2" />
                  <p className="text-sm text-gray-400">{getStakeButtonLabel()}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── APY History Chart ─────────────────────────────── */}
        {selectedHistory && (
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-cyan">▸</span> APY History — {selectedProtocol?.name}
            </h2>
            <div className="glass-card p-4">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={selectedHistory.points}>
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={fmtDate}
                    stroke="#30363d"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#30363d"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0d1117',
                      border: '1px solid #21262d',
                      borderRadius: '0.5rem',
                      color: '#e5e7eb',
                      fontSize: '0.75rem',
                    }}
                    labelFormatter={(ts: number) => fmtDate(ts)}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, 'APY']}
                  />
                  <Line
                    type="monotone"
                    dataKey="apy"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#06b6d4' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* ── LP Yield Compounder ────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-green">▸</span> LP Yield Compounder
          </h2>
          <div className="glass-card p-5">
            <p className="text-xs text-gray-400 mb-4">
              Deposit into LP pools from DeFiLlama. Auto-compound rewards when gas-efficient.
              Impermanent loss estimates based on pool composition and volatility.
            </p>
            <LPSection />
          </div>
        </section>

        {/* ── Per Chain Groups ──────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> By Chain
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {byChain.map((group) => (
              <div key={group.chain} className="glass-card p-4">
                <h3 className="text-sm font-semibold text-white capitalize mb-3">
                  {group.chainName}
                </h3>
                <div className="space-y-1">
                  {group.protocols.slice(0, 4).map((proto) => (
                    <div
                      key={proto.id}
                      onClick={() => { setSelectedProtocol(proto); setExecState(null); setStakeAmount(""); }}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-dark-hover cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-300">{proto.name}</span>
                        {proto.autocompounding && (
                          <span className="badge-cyan text-[0.55rem]">auto</span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-mono-sm text-accent-green">
                        {fmtAPY(proto.apy)}
                      </span>
                    </div>
                  ))}
                  {group.protocols.length > 4 && (
                    <p className="text-xs text-gray-400 text-center pt-1">
                      +{group.protocols.length - 4} more
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── LP Compounder Section ────────────────────────────────────────

function LPSection() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [lpPools, setLpPools] = useState<DeFiLlamaPool[]>([]);
  const [lpPositions, setLpPositions] = useState<LPPosition[]>([]);
  const [lpLoading, setLpLoading] = useState(false);
  const [lpDepositAmount, setLpDepositAmount] = useState("");
  const [selectedPool, setSelectedPool] = useState<DeFiLlamaPool | null>(null);
  const [autoCompound, setAutoCompound] = useState(true);
  const [sortBy, setSortBy] = useState<"apy" | "tvl" | "risk">("apy");
  const [stableOnly, setStableOnly] = useState(false);
  const [blendedAPY, setBlendedAPY] = useState(0);

  useEffect(() => {
    loadPools();
  }, [stableOnly]);

  const loadPools = async () => {
    setLpLoading(true);
    try {
      const pools = await discoverPools(50000, undefined, stableOnly);
      setLpPools(pools);
    } catch { /* keep existing */ }
    setLpLoading(false);
  };

  const handleDepositLP = async () => {
    if (!selectedPool || !lpDepositAmount) return;
    try {
      const pos = await depositLP(selectedPool.pool, parseFloat(lpDepositAmount));
      setLpPositions(prev => [...prev, pos]);
      setLpDepositAmount("");
      refreshPositions();
    } catch (err) {
      console.warn("LP deposit failed:", err);
    }
  };

  const handleCompound = (positionId?: string) => {
    const state = compound(positionId);
    setLpPositions(state.positions.filter(p => p.status === "active"));
    setBlendedAPY(state.blendedAPY);
  };

  const handleCloseLP = (positionId: string) => {
    closePosition(positionId);
    refreshPositions();
  };

  const refreshPositions = () => {
    const state = getLPYield();
    setLpPositions(state.positions.filter(p => p.status === "active"));
    setBlendedAPY(state.blendedAPY);
  };

  // Auto-compound effect
  useEffect(() => {
    if (!autoCompound) return;
    const interval = setInterval(() => {
      refreshPositions();
      // Auto-compound if fees exceed gas threshold
      const state = getLPYield();
      for (const pos of state.positions) {
        if (pos.status !== "active") continue;
        const gasCost = pos.chain === "ethereum" ? 15 : pos.chain === "arbitrum" ? 1.5 : 0.5;
        if (pos.feesEarned >= gasCost * 2) {
          compound(pos.id);
        }
      }
      setLpPositions(getLPYield().positions.filter(p => p.status === "active"));
    }, 60000);
    return () => clearInterval(interval);
  }, [autoCompound]);

  // IL calculator
  const estimateIL = (pool: DeFiLlamaPool): { ilPct: number; description: string } => {
    const s = pool.symbol.toLowerCase();
    const stables = ["usdc", "usdt", "dai", "frax", "lusd"];
    const isStable = stables.some(st => s.includes(st));
    const parts = s.split(/[-/\s]+/);
    if (isStable && parts.length === 2 && stables.some(st => parts[0].includes(st)) && stables.some(st => parts[1].includes(st))) {
      return { ilPct: 0, description: "Negligible — stablecoin pair" };
    }
    if ((s.includes("eth") || s.includes("weth")) && (s.includes("usdc") || s.includes("usdt"))) {
      return { ilPct: 0.3, description: "Low — ETH/stable, moderate correlation" };
    }
    if (pool.apy > 50) return { ilPct: 5.0, description: "High — volatile pair with elevated APY" };
    if (pool.apy > 20) return { ilPct: 1.5, description: "Moderate — higher yield means higher IL risk" };
    return { ilPct: 0.5, description: "Low to moderate" };
  };

  const sortedPools = [...lpPools].sort((a, b) => {
    if (sortBy === "apy") return b.apy - a.apy;
    if (sortBy === "tvl") return b.tvlUsd - a.tvlUsd;
    return 0; // risk-based
  }).slice(0, 20);

  const fmtUSD = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n.toFixed(2)}`;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={loadPools} disabled={lpLoading} className="glass-button px-3 py-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-40">
          {lpLoading ? "Loading..." : "⟳ Refresh Pools"}
        </button>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as "apy" | "tvl" | "risk")} className="glass-input px-3 py-1.5 rounded-lg text-xs text-gray-300">
          <option value="apy">Sort: APY ↓</option>
          <option value="tvl">Sort: TVL ↓</option>
          <option value="risk">Sort: Risk</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={stableOnly} onChange={e => setStableOnly(e.target.checked)} className="accent-accent-blue" />
          Stablecoins only
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer ml-2">
          <input type="checkbox" checked={autoCompound} onChange={e => setAutoCompound(e.target.checked)} className="accent-accent-green" />
          Auto-compound
        </label>
        {blendedAPY > 0 && (
          <span className="text-xs text-accent-green ml-auto font-bold">Blended APY: {blendedAPY.toFixed(2)}%</span>
        )}
      </div>

      {/* Pool Table */}
      {lpPools.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400 text-sm">{lpLoading ? "Loading DeFiLlama pools..." : "No pools found"}</p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-dark-hover">
              <tr className="text-gray-400">
                <th className="text-left py-2 px-2 font-medium">Pool</th>
                <th className="text-left py-2 px-2 font-medium">DEX</th>
                <th className="text-left py-2 px-2 font-medium hidden sm:table-cell">Chain</th>
                <th className="text-right py-2 px-2 font-medium">APY</th>
                <th className="text-right py-2 px-2 font-medium">TVL</th>
                <th className="text-right py-2 px-2 font-medium hidden md:table-cell">IL Est.</th>
                <th className="text-center py-2 px-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedPools.map(pool => {
                const il = estimateIL(pool);
                const interval = computeOptimalCompoundInterval(1000, pool.apy, pool.chain);
                return (
                  <tr key={pool.pool} className={`border-b border-dark-border hover:bg-dark-hover transition-colors cursor-pointer ${selectedPool?.pool === pool.pool ? "bg-accent-blue/5" : ""}`}
                    onClick={() => setSelectedPool(pool)}>
                    <td className="py-2 px-2 text-white font-medium">{pool.symbol}</td>
                    <td className="py-2 px-2 text-gray-300">{pool.project}</td>
                    <td className="py-2 px-2 text-gray-400 capitalize hidden sm:table-cell">{pool.chain}</td>
                    <td className={`py-2 px-2 text-right font-bold ${pool.apy >= 20 ? "text-accent-green" : pool.apy >= 8 ? "text-accent-yellow" : "text-gray-300"}`}>{pool.apy.toFixed(2)}%</td>
                    <td className="py-2 px-2 text-right text-gray-400">{fmtUSD(pool.tvlUsd)}</td>
                    <td className={`py-2 px-2 text-right hidden md:table-cell ${il.ilPct < 1 ? "text-green-400" : il.ilPct < 3 ? "text-yellow-400" : "text-red-400"}`}>{il.ilPct.toFixed(1)}%</td>
                    <td className="py-2 px-2 text-center">
                      <span className="text-[0.6rem] text-gray-500">Compound: {interval.intervalHours}h</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Deposit Panel */}
      {selectedPool && (
        <div className="glass-card p-4 border border-accent-blue/20">
          <h4 className="text-sm font-semibold text-white mb-3">Deposit into {selectedPool.symbol} ({selectedPool.project})</h4>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              value={lpDepositAmount}
              onChange={e => setLpDepositAmount(e.target.value)}
              placeholder="Amount (USD)"
              className="glass-input px-3 py-2 rounded-lg text-white text-sm w-40"
            />
            <button onClick={handleDepositLP} disabled={!lpDepositAmount}
              className="glass-button px-4 py-2 bg-accent-green/20 border-accent-green/30 text-accent-green text-sm disabled:opacity-40">
              Deposit
            </button>
            <span className="text-xs text-gray-400">
              APY: {selectedPool.apy.toFixed(2)}% · TVL: {fmtUSD(selectedPool.tvlUsd)} · IL: {estimateIL(selectedPool).ilPct.toFixed(1)}% est.
            </span>
          </div>
        </div>
      )}

      {/* Active LP Positions */}
      {lpPositions.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-white mb-2">Your LP Positions ({lpPositions.length})</h4>
          <div className="space-y-2">
            {lpPositions.map(pos => {
              const il = pos.ilRisk === "low" ? 0.3 : pos.ilRisk === "medium" ? 1.5 : 5.0;
              return (
                <div key={pos.id} className="glass-card p-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-sm font-bold text-white">{pos.pair}</span>
                    <span className="text-xs text-gray-400 ml-2">{pos.dex} · {pos.chain}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-400">Deposit: ${pos.deposited.toFixed(2)}</span>
                    <span className="text-accent-green">Fees: ${pos.feesEarned.toFixed(4)}</span>
                    <span className="text-gray-400">APY: {pos.apy.toFixed(2)}%</span>
                    <span className={`${il < 1 ? "text-green-400" : il < 3 ? "text-yellow-400" : "text-red-400"}`}>
                      IL: {il.toFixed(1)}%
                    </span>
                    <span className="text-gray-500">Compounds: {pos.compoundCount}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleCompound(pos.id)} className="text-[0.6rem] px-2 py-1 rounded bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20 hover:bg-accent-cyan/20">
                      Compound
                    </button>
                    <button onClick={() => handleCloseLP(pos.id)} className="text-[0.6rem] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
                      Close
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
