import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useBalance } from "wagmi";
import { parseUnits, formatUnits, type Address } from "viem";
import type { TokenInfo } from "~/lib/web3";

// ── AAVE V3 Pool ABI (minimal) ────────────────────────────────────
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

// ── AAVE V3 Pool addresses ────────────────────────────────────────
const AAVE_POOL_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",       // Ethereum Mainnet
  42161: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",    // Arbitrum
  10: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",       // Optimism
  137: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",       // Polygon
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",     // Base
  43114: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",    // Avalanche
};

// ── Supported assets for deposit ──────────────────────────────────
interface EarnAsset {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
}

const EARN_ASSETS: Record<number, EarnAsset[]> = {
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

export const Route = createFileRoute("/earn")({
  component: EarnPage,
});

function EarnPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<EarnAsset | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");

  useEffect(() => { setMounted(true); }, []);

  const assets = EARN_ASSETS[chainId] || [];
  const poolAddress = AAVE_POOL_ADDRESSES[chainId];

  // Get AAVE reserve data for APY
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

  // Wallet balance
  const { data: balance } = useBalance({
    address,
    token: selectedAsset?.address,
    query: { enabled: !!selectedAsset },
  });

  // Write contracts
  const { writeContract: supply, isPending: supplyPending } = useWriteContract();
  const { writeContract: withdraw, isPending: withdrawPending } = useWriteContract();

  const handleDeposit = () => {
    if (!selectedAsset || !amount || !address || !poolAddress) return;
    const parsed = parseUnits(amount, selectedAsset.decimals);
    supply({
      address: poolAddress,
      abi: AAVE_POOL_ABI,
      functionName: "supply",
      args: [selectedAsset.address, parsed, address, 0],
    });
  };

  const handleWithdraw = () => {
    if (!selectedAsset || !amount || !address || !poolAddress) return;
    const parsed = parseUnits(amount, selectedAsset.decimals);
    withdraw({
      address: poolAddress,
      abi: AAVE_POOL_ABI,
      functionName: "withdraw",
      args: [selectedAsset.address, parsed, address],
    });
  };

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
      <div className="mx-auto max-w-lg space-y-6 mt-8">
        {/* Header */}
        <section className="animate-fade-in text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center justify-center gap-2">
            <span>📈</span> Earn Yield
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Deposit assets into AAVE V3 and earn real yield
          </p>
        </section>

        {!isConnected ? (
          <div className="glass-card p-8 text-center animate-fade-in-up">
            <p className="text-gray-400 text-lg mb-4">Connect your wallet to earn yield</p>
            <p className="text-xs text-gray-500">Use the Connect Wallet button in the navbar</p>
          </div>
        ) : !poolAddress ? (
          <div className="glass-card p-8 text-center animate-fade-in-up">
            <p className="text-gray-400 text-lg mb-4">AAVE V3 not available on this chain</p>
            <p className="text-xs text-gray-500">Switch to Ethereum, Arbitrum, Optimism, Polygon, Base, or Avalanche</p>
          </div>
        ) : (
          <div className="glass-card p-5 space-y-4 animate-fade-in-up">
            {/* Mode Toggle */}
            <div className="flex rounded-xl bg-dark-hover border border-dark-border p-1">
              <button
                onClick={() => setMode("deposit")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === "deposit" ? "bg-accent-blue text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Deposit
              </button>
              <button
                onClick={() => setMode("withdraw")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === "withdraw" ? "bg-accent-blue text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Withdraw
              </button>
            </div>

            {/* Asset Selector */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Asset</label>
              <div className="grid grid-cols-2 gap-2">
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
                    Wallet Balance: {balance ? `${parseFloat(balance.formatted).toFixed(4)} ${selectedAsset.symbol}` : "..."}
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
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
                    {mode === "deposit" ? "Amount to Deposit" : "Amount to Withdraw"}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="0.0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="flex-1 bg-dark-hover border border-dark-border rounded-xl px-4 py-3 text-white text-lg text-mono outline-none focus:border-accent-blue/50 transition-colors"
                    />
                    <div className="px-3 py-3 rounded-xl border border-dark-border bg-dark-hover text-sm font-medium text-white flex items-center">
                      {selectedAsset.symbol}
                    </div>
                  </div>
                </div>

                {/* Action Button */}
                {mode === "deposit" ? (
                  <button
                    onClick={handleDeposit}
                    disabled={!amount || supplyPending || parseFloat(amount) <= 0}
                    className="w-full py-3 rounded-xl bg-accent-green text-white font-semibold hover:bg-accent-green/80 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-accent-green/20"
                  >
                    {supplyPending ? "Confirming..." : `Deposit ${selectedAsset.symbol}`}
                  </button>
                ) : (
                  <button
                    onClick={handleWithdraw}
                    disabled={!amount || withdrawPending || parseFloat(amount) <= 0}
                    className="w-full py-3 rounded-xl bg-accent-yellow text-black font-semibold hover:bg-accent-yellow/80 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-accent-yellow/20"
                  >
                    {withdrawPending ? "Confirming..." : `Withdraw ${selectedAsset.symbol}`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Info Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in-up">
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white mb-1">AAVE V3</h3>
            <p className="text-xs text-gray-400">
              Industry-leading lending protocol with billions in TVL. Non-custodial, audited, and battle-tested.
            </p>
          </div>
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white mb-1">Compound V3</h3>
            <p className="text-xs text-gray-400">
              Also available on supported chains. Connect your wallet to see Compound rates alongside AAVE.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
