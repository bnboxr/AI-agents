// ── Solana Chain Route — Balance, SOL Price, Jupiter Swaps ────────────

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";
import {
  getSolanaAddress,
  getSolanaBalance,
  type SolanaWalletInfo,
} from "~/lib/chains/solana-wallet";
import {
  solanaPaperSwap,
  getSolanaPaperBalances,
  resetSolanaPaperBalances,
  SOLANA_TOKENS,
  type SolanaSwapResult,
  type PaperBalance,
} from "~/lib/chains/solana-dex";

// ── Server Functions ──────────────────────────────────────────────────

const fetchSolanaInfo = createServerFn({ method: "GET" }).handler(
  async (): Promise<SolanaWalletInfo & { address: string }> => {
    const [address, balance] = await Promise.all([
      getSolanaAddress(),
      getSolanaBalance(),
    ]);
    return { ...balance, address };
  },
);

export const Route = createFileRoute("/chains/solana")({
  loader: async () => {
    try {
      const info = await fetchSolanaInfo();
      return { info, error: null };
    } catch (err) {
      return { info: null, error: (err as Error).message };
    }
  },
  component: SolanaChainPage,
});

// ── Page ──────────────────────────────────────────────────────────────

function SolanaChainPage() {
  const initial = Route.useLoaderData();
  const [info, setInfo] = useState(initial.info);
  const [balances, setBalances] = useState(getSolanaPaperBalances());
  const [swapInput, setSwapInput] = useState("SOL");
  const [swapOutput, setSwapOutput] = useState("USDC");
  const [swapAmount, setSwapAmount] = useState("0.1");
  const [swapping, setSwapping] = useState(false);
  const [swapResult, setSwapResult] = useState<SolanaSwapResult | null>(null);
  const [swapHistory, setSwapHistory] = useState<SolanaSwapResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const fresh = await fetchSolanaInfo();
        setInfo(fresh);
      } catch { /* keep stale */ }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchSolanaInfo();
      setInfo(fresh);
    } catch { /* keep stale */ }
    setRefreshing(false);
  }, []);

  const handleSwap = useCallback(async () => {
    const amount = parseFloat(swapAmount);
    if (isNaN(amount) || amount <= 0) return;
    if (swapInput === swapOutput) return;

    setSwapping(true);
    setSwapResult(null);
    try {
      const result = await solanaPaperSwap(swapInput, swapOutput, amount);
      setSwapResult(result);
      if (result.success) {
        setBalances(result.updatedBalances);
        setSwapHistory((prev) => [result, ...prev].slice(0, 20));
      }
    } catch (err) {
      setSwapResult({
        success: false,
        inputToken: swapInput,
        outputToken: swapOutput,
        inputAmount: amount,
        outputAmount: 0,
        priceImpactPct: 0,
        error: (err as Error).message,
        isPaper: true,
      });
    } finally {
      setSwapping(false);
    }
  }, [swapInput, swapOutput, swapAmount]);

  const handleReset = useCallback(() => {
    resetSolanaPaperBalances();
    setBalances(getSolanaPaperBalances());
    setSwapResult(null);
    setSwapHistory([]);
  }, []);

  const swapTokens = SOLANA_TOKENS.filter((t) => t.symbol !== swapInput);
  const outputTokens = SOLANA_TOKENS.filter((t) => t.symbol !== swapOutput);

  return (
    <div className="min-h-dvh bg-darker pt-20 pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 animate-fade-in-up">
          <span className="text-3xl">☀️</span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white">
              Solana
            </h1>
            <p className="text-sm text-gray-400">
              Jupiter DEX · SOL Balance · Autonomous Wallet
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-accent-blue/40 transition-colors disabled:opacity-40"
          >
            {refreshing ? "⟳ Refreshing…" : "🔄 Refresh"}
          </button>
        </div>

        {/* Wallet Info Card */}
        {info && (
          <div className="glass-card p-5 border-l-2 border-accent-purple/40 animate-fade-in-up">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <span>🔐</span> Autonomous Solana Wallet
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider font-mono">
                  Address
                </label>
                <p className="font-mono text-white truncate" title={info.address}>
                  {info.address.slice(0, 8)}...{info.address.slice(-6)}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider font-mono">
                  SOL Balance
                </label>
                <p className="font-mono text-white">
                  {info.balanceSol.toFixed(4)} SOL
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider font-mono">
                  USD Value
                </label>
                <p className="font-mono text-accent-green">
                  ${info.balanceUsd.toFixed(2)}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider font-mono">
                  SOL Price
                </label>
                <p className="font-mono text-accent-blue">
                  ${info.solPrice.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Jupiter Swap Card */}
        <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: "0.05s" }}>
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <span>🔄</span> Jupiter Swap <span className="text-xs text-accent-yellow">(Paper Mode)</span>
          </h3>

          {/* Paper Balances */}
          <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
            {(["sol", "usdc", "usdt"] as const).map((token) => (
              <div key={token} className="bg-dark-hover/50 border border-dark-border rounded-lg p-3 text-center">
                <div className="text-gray-400 uppercase font-mono">{token}</div>
                <div className="text-white font-mono font-bold text-sm">
                  {token === "sol"
                    ? balances[token].toFixed(4)
                    : balances[token].toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {/* Swap form */}
          <div className="space-y-3">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-mono mb-1 block">From</label>
                <select
                  value={swapInput}
                  onChange={(e) => {
                    setSwapInput(e.target.value);
                    if (e.target.value === swapOutput) {
                      setSwapOutput(SOLANA_TOKENS.find((t) => t.symbol !== e.target.value)?.symbol ?? "USDC");
                    }
                  }}
                  className="glass-input w-full text-sm bg-dark-hover"
                >
                  {SOLANA_TOKENS.map((t) => (
                    <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                  ))}
                </select>
              </div>
              <div className="text-gray-400 text-xl pt-5">→</div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-mono mb-1 block">To</label>
                <select
                  value={swapOutput}
                  onChange={(e) => setSwapOutput(e.target.value)}
                  className="glass-input w-full text-sm bg-dark-hover"
                >
                  {SOLANA_TOKENS.filter((t) => t.symbol !== swapInput).map((t) => (
                    <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-mono mb-1 block">Amount</label>
                <input
                  type="number"
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                  placeholder="0.1"
                  step="0.01"
                  min="0"
                  className="glass-input w-full text-sm font-mono"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSwap(); }}
                />
              </div>
              <button
                onClick={handleSwap}
                disabled={swapping || !swapAmount || parseFloat(swapAmount) <= 0 || swapInput === swapOutput}
                className="glass-button text-sm px-6 py-2 whitespace-nowrap bg-accent-purple/20 border-accent-purple/40 hover:bg-accent-purple/30 disabled:opacity-40"
              >
                {swapping ? (
                  <span className="flex items-center gap-1.5">
                    <span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" />
                    Swapping…
                  </span>
                ) : (
                  "🔄 Swap"
                )}
              </button>
            </div>
          </div>

          {/* Swap result */}
          {swapResult && (
            <div
              className={`mt-4 p-4 rounded-lg border ${
                swapResult.success
                  ? "border-accent-green/30 bg-accent-green/5"
                  : "border-accent-red/30 bg-accent-red/5"
              }`}
            >
              {swapResult.success ? (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Swapped</span>
                    <span className="text-white font-mono">
                      {swapResult.inputAmount} {swapResult.inputToken} → {swapResult.outputAmount.toFixed(6)} {swapResult.outputToken}
                    </span>
                  </div>
                  {swapResult.priceImpactPct > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Price Impact</span>
                      <span className={`font-mono ${swapResult.priceImpactPct > 2 ? "text-accent-yellow" : "text-accent-green"}`}>
                        {swapResult.priceImpactPct.toFixed(3)}%
                      </span>
                    </div>
                  )}
                  <div className="text-xs text-accent-green mt-2">
                    ✅ Paper swap executed (Jupiter quote fetched, no real tx)
                  </div>
                </div>
              ) : (
                <div className="text-sm text-accent-red">
                  ❌ Swap failed: {swapResult.error}
                </div>
              )}
            </div>
          )}

          {/* Reset button */}
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleReset}
              className="text-xs px-3 py-1.5 rounded-lg border border-dark-border text-gray-500 hover:text-accent-red hover:border-accent-red/40 transition-colors"
            >
              Reset Paper Balances
            </button>
          </div>
        </div>

        {/* Swap History */}
        {swapHistory.length > 0 && (
          <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <span>📜</span> Recent Swaps
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {swapHistory.map((swap, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg border ${
                    swap.success
                      ? "border-dark-border bg-dark-hover/40"
                      : "border-accent-red/20 bg-accent-red/5"
                  }`}
                >
                  <span>{swap.success ? "✅" : "❌"}</span>
                  <span className="text-gray-400 font-mono">
                    {swap.inputAmount} {swap.inputToken}
                  </span>
                  <span className="text-gray-600">→</span>
                  <span className="text-white font-mono">
                    {swap.outputAmount.toFixed(6)} {swap.outputToken}
                  </span>
                  {swap.priceImpactPct > 0 && (
                    <span className={`ml-auto font-mono ${swap.priceImpactPct > 2 ? "text-accent-yellow" : "text-gray-500"}`}>
                      {swap.priceImpactPct.toFixed(2)}%
                    </span>
                  )}
                  <span className="text-[0.6rem] px-1.5 py-0.5 rounded bg-dark-hover text-gray-600">
                    PAPER
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
