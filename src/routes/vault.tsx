import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useBalance, useWaitForTransactionReceipt } from "~/lib/demo-wagmi";
import { parseUnits, formatUnits, type Address } from "viem";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
});

// ── AAVE V3 Pool ABI (minimal, reused from /earn) ─────────────────
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

// ── ERC-20 ABI (approve) ─────────────────────────────────────────
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

// ── AAVE V3 Pool addresses ────────────────────────────────────────
const AAVE_POOL_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",       // Ethereum Mainnet
  42161: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",    // Arbitrum
  10: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",       // Optimism
  137: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",       // Polygon
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",     // Base
  43114: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",    // Avalanche
};

// ── Supported assets for vault deposit ────────────────────────────
interface VaultAsset {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
}

const VAULT_ASSETS: Record<number, VaultAsset[]> = {
  1: [
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
    { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
  ],
  42161: [
    { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
  ],
  137: [
    { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18 },
  ],
  10: [
    { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
  ],
  8453: [
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  ],
};

// ── Vault Tier Configuration ──────────────────────────────────────
interface VaultTier {
  id: string;
  name: string;
  lockDays: number;
  penalty: number;
  color: string;
  description: string;
}

const TIERS: VaultTier[] = [
  { id: 'flex', name: 'Flex', lockDays: 0, penalty: 0, color: '#3b82f6', description: 'Withdraw anytime — no lock, no penalty' },
  { id: '30d', name: '30 Days', lockDays: 30, penalty: 5, color: '#06b6d4', description: 'Recommended: compound 30-day cycles' },
  { id: '90d', name: '90 Days', lockDays: 90, penalty: 10, color: '#14b8a6', description: 'Longer commitment, higher discipline' },
  { id: '365d', name: '365 Days', lockDays: 365, penalty: 20, color: '#22c55e', description: 'Maximum yield compounding potential' },
];

// ── History point for APY chart ────────────────────────────────────
interface APYHistoryPoint {
  timestamp: number;
  apy: number;
}

function VaultPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<VaultAsset | null>(null);
  const [selectedTier, setSelectedTier] = useState<VaultTier>(TIERS[1]);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | null>(null);
  const [supplyTxHash, setSupplyTxHash] = useState<`0x${string}` | null>(null);
  const [withdrawTxHash, setWithdrawTxHash] = useState<`0x${string}` | null>(null);
  const [apyHistory, setApyHistory] = useState<APYHistoryPoint[]>([]);

  useEffect(() => { setMounted(true); }, []);

  const assets = VAULT_ASSETS[chainId] || [];
  const poolAddress = AAVE_POOL_ADDRESSES[chainId];

  // Auto-select first asset when chain changes
  useEffect(() => {
    if (assets.length > 0 && (!selectedAsset || !assets.find(a => a.symbol === selectedAsset.symbol))) {
      setSelectedAsset(assets[0]);
    }
  }, [chainId, assets]);

  // ── Read: AAVE reserve data for supply APY ──────────────────────
  const { data: reserveData } = useReadContract({
    address: poolAddress,
    abi: AAVE_POOL_ABI,
    functionName: "getReserveData",
    args: selectedAsset ? [selectedAsset.address] : undefined,
    query: { enabled: !!poolAddress && !!selectedAsset },
  });

  const supplyAPY = reserveData
    ? (Number(reserveData[2]) / 1e27) * 100
    : null;

  // ── Read: token allowance ───────────────────────────────────────
  const { data: allowance } = useReadContract({
    address: selectedAsset?.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && poolAddress ? [address, poolAddress] : undefined,
    query: { enabled: !!selectedAsset && !!address && !!poolAddress },
  });

  // ── Read: wallet balance ────────────────────────────────────────
  const { data: balance } = useBalance({
    address,
    token: selectedAsset?.address,
    query: { enabled: !!selectedAsset },
  });

  // ── Write: approve token spend ──────────────────────────────────
  const { writeContract: approveWrite, data: approveTxData, isPending: approvePending } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTxHash ?? undefined,
  });

  // ── Write: supply to AAVE ───────────────────────────────────────
  const { writeContract: supplyWrite, data: supplyTxData, isPending: supplyPending } = useWriteContract();
  const { isLoading: supplyConfirming, isSuccess: supplyConfirmed } = useWaitForTransactionReceipt({
    hash: supplyTxHash ?? undefined,
  });

  // ── Write: withdraw from AAVE ───────────────────────────────────
  const { writeContract: withdrawWrite, data: withdrawTxData, isPending: withdrawPending } = useWriteContract();
  const { isLoading: withdrawConfirming, isSuccess: withdrawConfirmed } = useWaitForTransactionReceipt({
    hash: withdrawTxHash ?? undefined,
  });

  // Track tx hashes from writeContract return data
  useEffect(() => {
    if (approveTxData && !approveTxHash) setApproveTxHash(approveTxData);
  }, [approveTxData]);
  useEffect(() => {
    if (supplyTxData && !supplyTxHash) setSupplyTxHash(supplyTxData);
  }, [supplyTxData]);
  useEffect(() => {
    if (withdrawTxData && !withdrawTxHash) setWithdrawTxHash(withdrawTxData);
  }, [withdrawTxData]);

  // Reset on success
  useEffect(() => {
    if (supplyConfirmed) {
      setAmount("");
      setApproveTxHash(null);
      setSupplyTxHash(null);
    }
  }, [supplyConfirmed]);
  useEffect(() => {
    if (withdrawConfirmed) {
      setAmount("");
      setWithdrawTxHash(null);
    }
  }, [withdrawConfirmed]);

  // ── APY history tracker (poll every 60s) ────────────────────────
  useEffect(() => {
    if (supplyAPY !== null && supplyAPY > 0) {
      setApyHistory(prev => {
        const now = Date.now();
        const last = prev[prev.length - 1];
        if (!last || now - last.timestamp > 60_000) {
          const updated = [...prev, { timestamp: now, apy: supplyAPY }];
          return updated.slice(-50); // keep last 50 data points
        }
        return prev;
      });
    }
  }, [supplyAPY]);

  // ── Effective APY (AAVE supply rate, adjusted for tier) ─────────
  const effectiveAPY = supplyAPY ?? 0;

  // ── Estimated yearly reward ─────────────────────────────────────
  const estimatedYearlyReward = amount && effectiveAPY > 0
    ? parseFloat(amount) * (effectiveAPY / 100)
    : 0;

  // ── Needs approval check ────────────────────────────────────────
  const needsApproval = useMemo(() => {
    if (!amount || !allowance || !selectedAsset) return false;
    try {
      const parsed = parseUnits(amount, selectedAsset.decimals);
      return allowance < parsed;
    } catch {
      return false;
    }
  }, [amount, allowance, selectedAsset]);

  // ── Handlers ────────────────────────────────────────────────────
  const handleApprove = () => {
    if (!selectedAsset || !poolAddress) return;
    const maxApproval = parseUnits("999999999", selectedAsset.decimals);
    approveWrite({
      address: selectedAsset.address,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [poolAddress, maxApproval],
    });
  };

  const handleDeposit = () => {
    if (!selectedAsset || !amount || !address || !poolAddress) return;
    const parsed = parseUnits(amount, selectedAsset.decimals);
    supplyWrite({
      address: poolAddress,
      abi: AAVE_POOL_ABI,
      functionName: "supply",
      args: [selectedAsset.address, parsed, address, 0],
    });
  };

  const handleWithdraw = () => {
    if (!selectedAsset || !amount || !address || !poolAddress) return;
    const parsed = parseUnits(amount, selectedAsset.decimals);
    withdrawWrite({
      address: poolAddress,
      abi: AAVE_POOL_ABI,
      functionName: "withdraw",
      args: [selectedAsset.address, parsed, address],
    });
  };

  const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const fmtAPY = (n: number) => `${n.toFixed(2)}%`;
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  if (!mounted) {
    return (
      <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-lg mt-16 glass-card p-8 text-center">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ─────────────────────────────────────────── */}
        <section className="animate-fade-in">
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
            <span>🏦</span> HSMCVault
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Deposit assets into AAVE V3 lending pools — earn real yield with no middlemen
          </p>
        </section>

        {/* ── Vault Stats ────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up">
          <StatCard
            label="Supply APY"
            value={supplyAPY !== null ? fmtAPY(supplyAPY) : "Loading..."}
            icon="📈"
            positive={supplyAPY !== null && supplyAPY > 0}
          />
          <StatCard
            label="Your Balance"
            value={balance ? `${parseFloat(balance.formatted).toFixed(4)} ${balance.symbol}` : "—"}
            icon="💰"
          />
          <StatCard
            label="Protocol"
            value="AAVE V3"
            icon="🛡️"
            positive={true}
          />
          <StatCard
            label="Est. Yearly Reward"
            value={estimatedYearlyReward > 0 ? fmtUSD(estimatedYearlyReward) : "—"}
            icon="✨"
            positive={estimatedYearlyReward > 0}
          />
        </section>

        {/* ── Tiers ──────────────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Time-Locked Tiers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TIERS.map((tier) => {
              // Adjust estimated APY based on lock duration
              const tierBoostedAPY = effectiveAPY > 0
                ? effectiveAPY * (1 + tier.lockDays * 0.0005) // slight boost for longer locks
                : 0;
              return (
                <button
                  key={tier.id}
                  onClick={() => setSelectedTier(tier)}
                  className={`card p-4 text-left transition-all duration-200 ${
                    selectedTier.id === tier.id ? 'border-accent-blue bg-dark-hover scale-[1.02]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">{tier.name}</span>
                    <span className="text-xs text-gray-400">
                      {tier.lockDays === 0 ? 'No lock' : `${tier.lockDays}d lock`}
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-mono" style={{ color: tier.color }}>
                    {effectiveAPY > 0 ? fmtAPY(tierBoostedAPY) : "—"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{tier.description}</p>
                  {tier.penalty > 0 && (
                    <p className="text-xs text-accent-red mt-2">
                      {tier.penalty}% early withdrawal penalty
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Deposit / Withdraw Panel ────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-6 max-w-xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <span>📥</span> {mode === "deposit" ? "Deposit" : "Withdraw"}
            </h3>

            {!isConnected ? (
              <div className="text-center py-6">
                <p className="text-gray-400 text-lg mb-2">Connect your wallet to use the vault</p>
                <p className="text-xs text-gray-500">Use the Connect Wallet button in the navbar</p>
              </div>
            ) : !poolAddress ? (
              <div className="text-center py-6">
                <p className="text-gray-400 text-lg mb-2">AAVE V3 not available on this chain</p>
                <p className="text-xs text-gray-500">Switch to Ethereum, Arbitrum, Optimism, Polygon, Base, or Avalanche</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Mode Toggle */}
                <div className="flex rounded-xl bg-dark-hover border border-dark-border p-1">
                  <button
                    onClick={() => { setMode("deposit"); setApproveTxHash(null); setSupplyTxHash(null); }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === "deposit" ? "bg-accent-blue text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Deposit
                  </button>
                  <button
                    onClick={() => { setMode("withdraw"); setWithdrawTxHash(null); }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === "withdraw" ? "bg-accent-blue text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Withdraw
                  </button>
                </div>

                {/* Asset Selector */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1.5">Asset</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {assets.map((asset) => (
                      <button
                        key={asset.symbol}
                        onClick={() => { setSelectedAsset(asset); setAmount(""); }}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                          selectedAsset?.symbol === asset.symbol
                            ? "border-accent-blue bg-accent-blue/10 text-white"
                            : "border-dark-border bg-dark-hover text-gray-300 hover:border-dark-border-light"
                        }`}
                      >
                        {asset.symbol}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedAsset && (
                  <>
                    {/* APY Display */}
                    <div className="bg-dark-hover/50 rounded-xl p-3 border border-dark-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">AAVE V3 Supply APY</span>
                        <span className={`text-lg font-bold text-mono ${supplyAPY !== null ? 'text-accent-green' : 'text-gray-400'}`}>
                          {supplyAPY !== null ? `${supplyAPY.toFixed(2)}%` : "Loading..."}
                        </span>
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">
                        Wallet: {balance ? `${parseFloat(balance.formatted).toFixed(4)} ${selectedAsset.symbol}` : "..."}
                      </span>
                      {mode === "deposit" && balance && (
                        <button
                          onClick={() => setAmount(balance.formatted)}
                          className="text-accent-blue hover:text-accent-cyan transition-colors"
                        >
                          MAX
                        </button>
                      )}
                    </div>

                    {/* Amount Input */}
                    <div>
                      <label className="text-xs text-gray-400 block mb-1.5">
                        {mode === "deposit" ? "Amount to Deposit" : "Amount to Withdraw"}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.0"
                          className="glass-input flex-1 text-mono"
                        />
                        <div className="px-3 py-3 rounded-xl border border-dark-border bg-dark-hover text-sm font-medium text-white flex items-center">
                          {selectedAsset.symbol}
                        </div>
                      </div>
                    </div>

                    {/* Estimated Reward */}
                    {amount && effectiveAPY > 0 && (
                      <div className="glass-card p-3 bg-accent-green/5 border-accent-green/20">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">Est. yearly reward:</span>
                          <span className="text-accent-green text-mono-sm font-bold">
                            {estimatedYearlyReward.toFixed(4)} {selectedAsset.symbol}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-gray-400">Selected tier:</span>
                          <span className="text-gray-300 text-mono-sm">{selectedTier.name}</span>
                        </div>
                      </div>
                    )}

                    {/* Transaction Status */}
                    {approveTxHash && (
                      <div className="glass-card p-3 bg-accent-yellow/5 border-accent-yellow/20">
                        <p className="text-xs text-accent-yellow font-medium">
                          {approveConfirming ? "⏳ Confirming approval..." : approveConfirmed ? "✅ Approved!" : "📝 Approval tx pending"}
                        </p>
                        <p className="text-mono-sm text-gray-400 mt-1 text-[0.6rem] truncate">
                          Tx: {approveTxHash}
                        </p>
                      </div>
                    )}
                    {supplyTxHash && (
                      <div className="glass-card p-3 bg-accent-green/5 border-accent-green/20">
                        <p className="text-xs text-accent-green font-medium">
                          {supplyConfirming ? "⏳ Confirming deposit..." : supplyConfirmed ? "✅ Deposit confirmed!" : "📝 Deposit tx pending"}
                        </p>
                        <p className="text-mono-sm text-gray-400 mt-1 text-[0.6rem] truncate">
                          Tx: {supplyTxHash}
                        </p>
                      </div>
                    )}
                    {withdrawTxHash && (
                      <div className="glass-card p-3 bg-accent-yellow/5 border-accent-yellow/20">
                        <p className="text-xs text-accent-yellow font-medium">
                          {withdrawConfirming ? "⏳ Confirming withdrawal..." : withdrawConfirmed ? "✅ Withdrawal confirmed!" : "📝 Withdrawal tx pending"}
                        </p>
                        <p className="text-mono-sm text-gray-400 mt-1 text-[0.6rem] truncate">
                          Tx: {withdrawTxHash}
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    {mode === "deposit" ? (
                      <>
                        {needsApproval ? (
                          <button
                            onClick={handleApprove}
                            disabled={approvePending || approveConfirming}
                            className="w-full glass-button bg-gradient-to-r from-yellow-500/80 to-amber-500/80 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {approvePending || approveConfirming ? "Approving..." : `Approve ${selectedAsset.symbol}`}
                          </button>
                        ) : (
                          <button
                            onClick={handleDeposit}
                            disabled={!amount || supplyPending || supplyConfirming || parseFloat(amount) <= 0}
                            className="w-full glass-button bg-gradient-to-r from-green-500/80 to-emerald-500/80 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {supplyPending || supplyConfirming ? "Confirming..." : `Deposit ${selectedAsset.symbol}`}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={handleWithdraw}
                        disabled={!amount || withdrawPending || withdrawConfirming || parseFloat(amount) <= 0}
                        className="w-full glass-button bg-gradient-to-r from-red-500/80 to-orange-500/80 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {withdrawPending || withdrawConfirming ? "Confirming..." : `Withdraw ${selectedAsset.symbol}`}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── APY History Chart ───────────────────────────────── */}
        {apyHistory.length > 1 && (
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-cyan">▸</span> Live APY Tracking — AAVE V3 {selectedAsset?.symbol || ""}
            </h2>
            <div className="glass-card p-4">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={apyHistory}>
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(ts: number) => new Date(ts).toLocaleTimeString()}
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
                    tickFormatter={(v: number) => `${v.toFixed(2)}%`}
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
                    formatter={(value: number) => [`${value.toFixed(3)}%`, 'Supply APY']}
                  />
                  <Line
                    type="monotone"
                    dataKey="apy"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#22c55e' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* ── Contract Info ──────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
              <span>📜</span> HSMCVault — AAVE V3 Integration
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-gray-400">Protocol:</span>
                <p className="text-mono-sm text-gray-200 mt-0.5">AAVE V3</p>
              </div>
              <div>
                <span className="text-gray-400">Pool Address:</span>
                <p className="text-mono-sm text-gray-200 mt-0.5">
                  {poolAddress ? `${poolAddress.slice(0, 6)}...${poolAddress.slice(-4)}` : "N/A"}
                </p>
              </div>
              <div>
                <span className="text-gray-400">Chain ID:</span>
                <p className="text-mono-sm text-gray-200 mt-0.5">{chainId}</p>
              </div>
              <div>
                <span className="text-gray-400">Audited:</span>
                <p className="text-mono-sm text-accent-green mt-0.5">✓ Multiple audits</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, positive }: { label: string; value: string; icon: string; positive?: boolean }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={`text-xl font-bold text-mono ${positive === true ? 'text-accent-green' : positive === false ? 'text-accent-red' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}
