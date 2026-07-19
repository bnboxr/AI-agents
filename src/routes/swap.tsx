import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useSwitchChain } from "wagmi";
import { parseUnits, formatUnits, type Address } from "viem";
import { getChainTokens, type TokenInfo } from "~/lib/web3";

// Uniswap V3 Quoter ABI (minimal for quoteExactInputSingle)
const QUOTER_ABI = [
  {
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    name: "quoteExactInputSingle",
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const QUOTER_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",    // Ethereum
  42161: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", // Arbitrum
  10: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",    // Optimism
  8453: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",   // Base
  137: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",    // Polygon
  56: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",     // BSC
};

// Common Uniswap V3 fee tiers
const FEE_TIERS = [100, 500, 3000, 10000];

export const Route = createFileRoute("/swap")({
  component: SwapPage,
});

function SwapPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  const [sellToken, setSellToken] = useState<TokenInfo | null>(null);
  const [buyToken, setBuyToken] = useState<TokenInfo | null>(null);
  const [sellAmount, setSellAmount] = useState("");
  const [slippage, setSlippage] = useState(0.5);
  const [showSellSelector, setShowSellSelector] = useState(false);
  const [showBuySelector, setShowBuySelector] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const tokens = getChainTokens(chainId);

  // Set defaults on mount / chain change
  useEffect(() => {
    if (tokens.length >= 2) {
      setSellToken(tokens[0]);
      setBuyToken(tokens[1]);
    }
  }, [chainId]);

  const isNativeToken = (t: TokenInfo) => t.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const isWETH = (t: TokenInfo) => t.symbol === "WETH" || t.symbol === "WBNB" || t.symbol === "WAVAX" || t.symbol === "WFTM";

  // Determine tokenIn/tokenOut for the quoter (wrap native to WETH equivalent)
  const getQuoterTokenIn = () => {
    if (!sellToken) return null;
    if (isNativeToken(sellToken)) {
      const wrapped = tokens.find(t => isWETH(t));
      return wrapped || sellToken;
    }
    return sellToken;
  };

  const getQuoterTokenOut = () => {
    if (!buyToken) return null;
    if (isNativeToken(buyToken)) {
      const wrapped = tokens.find(t => isWETH(t));
      return wrapped || buyToken;
    }
    return buyToken;
  };

  const tokenIn = getQuoterTokenIn();
  const tokenOut = getQuoterTokenOut();
  const amountIn = sellAmount && sellToken && tokenIn
    ? parseUnits(sellAmount, tokenIn.decimals)
    : 0n;

  // Uniswap V3 Quoter
  const { data: quoteData, isLoading: quoteLoading, error: quoteError } = useReadContract({
    address: QUOTER_ADDRESSES[chainId] as `0x${string}` | undefined,
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: tokenIn && tokenOut && amountIn > 0n
      ? [
          tokenIn.address as Address,
          tokenOut.address as Address,
          3000, // default fee tier 0.3%
          amountIn,
          0n,
        ]
      : undefined,
    query: {
      enabled: !!tokenIn && !!tokenOut && amountIn > 0n && !!QUOTER_ADDRESSES[chainId],
    },
  });

  const amountOut = quoteData ? quoteData[0] : 0n;
  const gasEstimate = quoteData ? quoteData[3] : 0n;

  const fmtPrice = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });

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
            <span>💱</span> Swap
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Swap tokens at the best rates via Uniswap V3
          </p>
        </section>

        {!isConnected ? (
          <div className="glass-card p-8 text-center animate-fade-in-up">
            <p className="text-gray-400 text-lg mb-4">Connect your wallet to swap tokens</p>
            <p className="text-xs text-gray-500">Use the Connect Wallet button in the navbar</p>
          </div>
        ) : (
          <div className="glass-card p-5 space-y-4 animate-fade-in-up">
            {/* Sell Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider">You Pay</label>
                <span className="text-xs text-gray-500">
                  Chain: {chainId}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="0.0"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  className="flex-1 bg-dark-hover border border-dark-border rounded-xl px-4 py-3 text-white text-lg text-mono outline-none focus:border-accent-blue/50 transition-colors"
                />
                <button
                  onClick={() => setShowSellSelector(!showSellSelector)}
                  className="px-4 py-3 rounded-xl border border-dark-border bg-dark-hover hover:border-accent-blue/40 transition-colors text-sm font-medium text-white flex items-center gap-2 min-w-[100px] justify-between"
                >
                  <span>{sellToken?.symbol || "Select"}</span>
                  <span className="text-xs text-gray-400">▼</span>
                </button>
              </div>
              {showSellSelector && (
                <TokenSelector
                  tokens={tokens}
                  onSelect={(t) => { setSellToken(t); setShowSellSelector(false); }}
                  onClose={() => setShowSellSelector(false)}
                />
              )}
            </div>

            {/* Swap Direction */}
            <div className="flex justify-center">
              <button
                onClick={() => {
                  const temp = sellToken;
                  setSellToken(buyToken);
                  setBuyToken(temp);
                  setSellAmount("");
                }}
                className="w-8 h-8 rounded-full border border-dark-border bg-dark-surface flex items-center justify-center text-gray-400 hover:text-white hover:border-accent-blue/40 transition-colors"
              >
                ↕
              </button>
            </div>

            {/* Buy Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider">You Receive</label>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 bg-dark-hover border border-dark-border rounded-xl px-4 py-3 text-white text-lg text-mono flex items-center">
                  {quoteLoading ? (
                    <span className="text-gray-400 text-sm animate-pulse">Fetching quote...</span>
                  ) : amountOut > 0n && buyToken ? (
                    <span>{parseFloat(formatUnits(amountOut, buyToken.decimals)).toFixed(6)}</span>
                  ) : (
                    <span className="text-gray-500">0.0</span>
                  )}
                </div>
                <button
                  onClick={() => setShowBuySelector(!showBuySelector)}
                  className="px-4 py-3 rounded-xl border border-dark-border bg-dark-hover hover:border-accent-blue/40 transition-colors text-sm font-medium text-white flex items-center gap-2 min-w-[100px] justify-between"
                >
                  <span>{buyToken?.symbol || "Select"}</span>
                  <span className="text-xs text-gray-400">▼</span>
                </button>
              </div>
              {showBuySelector && (
                <TokenSelector
                  tokens={tokens}
                  onSelect={(t) => { setBuyToken(t); setShowBuySelector(false); }}
                  onClose={() => setShowBuySelector(false)}
                />
              )}
            </div>

            {/* Quote Details */}
            {amountOut > 0n && buyToken && sellToken && (
              <div className="bg-dark-hover/50 rounded-xl p-3 space-y-1.5 text-xs border border-dark-border">
                <div className="flex justify-between">
                  <span className="text-gray-400">Rate</span>
                  <span className="text-gray-200 text-mono-sm">
                    1 {sellToken.symbol} ≈ {quoteData ? (parseFloat(formatUnits(amountOut, buyToken.decimals)) / parseFloat(sellAmount)).toFixed(6) : "..."} {buyToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Slippage</span>
                  <span className="text-accent-yellow text-mono-sm">{slippage}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Gas Estimate</span>
                  <span className="text-gray-200 text-mono-sm">{gasEstimate > 0n ? formatUnits(gasEstimate, 0) : "..."} gas</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Router</span>
                  <span className="text-accent-blue text-mono-sm">Uniswap V3</span>
                </div>
                {quoteError && (
                  <div className="text-accent-red text-xs mt-1">
                    Quote error: {quoteError.message?.slice(0, 100) || "Failed to fetch quote"}
                  </div>
                )}
              </div>
            )}

            {/* Slippage Settings */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400">Slippage:</span>
              {[0.1, 0.5, 1.0].map((s) => (
                <button
                  key={s}
                  onClick={() => setSlippage(s)}
                  className={`px-2 py-1 rounded-md border ${
                    slippage === s
                      ? "border-accent-blue text-accent-blue bg-accent-blue/10"
                      : "border-dark-border text-gray-400 hover:text-white"
                  }`}
                >
                  {s}%
                </button>
              ))}
            </div>

            {/* Swap Button */}
            <button
              disabled={!sellAmount || !sellToken || !buyToken || amountOut === 0n || quoteLoading}
              className="w-full py-3 rounded-xl bg-accent-blue text-white font-semibold hover:bg-accent-blue/80 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-accent-blue/20"
            >
              {quoteLoading ? "Fetching Quote..." : amountOut === 0n ? "Enter Amount" : "Swap"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenSelector({
  tokens,
  onSelect,
  onClose,
}: {
  tokens: TokenInfo[];
  onSelect: (t: TokenInfo) => void;
  onClose: () => void;
}) {
  return (
    <div className="border border-dark-border rounded-xl bg-dark-surface overflow-hidden mt-1">
      <div className="max-h-48 overflow-y-auto">
        {tokens.map((t) => (
          <button
            key={t.symbol + t.address}
            onClick={() => onSelect(t)}
            className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-dark-hover transition-colors text-left"
          >
            <span className="text-sm font-medium text-white text-mono-sm">{t.symbol}</span>
            <span className="text-xs text-gray-400">{t.name}</span>
          </button>
        ))}
      </div>
      <button onClick={onClose} className="w-full px-4 py-2 text-xs text-gray-400 hover:text-white border-t border-dark-border bg-dark-hover/50">
        Cancel
      </button>
    </div>
  );
}
