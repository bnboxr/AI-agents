/**
 * POSReceipt — Payment receipt with auto-conversion support
 *
 * Displays the confirmed payment receipt and offers instant conversion
 * to another token/chain after payment is confirmed.
 */

import { useState, useEffect } from "react";
import type { PaymentSession } from "~/lib/pos-service";
import { convertPayment, getTokenPrices, type ConvertibleToken } from "~/lib/pos-service";

// ── Types ────────────────────────────────────────────────────────────

export interface ConversionResult {
  originalTxId: string;
  conversionTxId: string;
  fromToken: string;
  fromAmount: string;
  toToken: string;
  toAmount: string;
  toChain?: string;
}

interface POSReceiptProps {
  session: PaymentSession;
  onClose?: () => void;
  onConvert?: (result: ConversionResult) => void;
}

// ── Supported conversion tokens ──────────────────────────────────────

const DESTINATION_TOKENS: Array<{ symbol: ConvertibleToken; label: string; chain: string }> = [
  { symbol: "USDC", label: "USDC", chain: "Polygon" },
  { symbol: "USDT", label: "USDT", chain: "Polygon" },
  { symbol: "MATIC", label: "POL (MATIC)", chain: "Polygon" },
  { symbol: "ETH", label: "ETH", chain: "Ethereum" },
  { symbol: "SOL", label: "SOL", chain: "Solana" },
  { symbol: "BTC", label: "BTC (wrapped)", chain: "Polygon" },
];

// ── Component ────────────────────────────────────────────────────────

export default function POSReceipt({ session, onClose, onConvert }: POSReceiptProps) {
  const [showConvert, setShowConvert] = useState(false);
  const [destinationToken, setDestinationToken] = useState<ConvertibleToken>("USDC");
  const [destinationChain, setDestinationChain] = useState<string>("");
  const [converting, setConverting] = useState(false);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [rateLoading, setRateLoading] = useState(false);

  // Load prices for conversion rate display
  useEffect(() => {
    if (showConvert) {
      setRateLoading(true);
      getTokenPrices()
        .then((p) => setPrices(p as Record<string, number>))
        .catch(() => {})
        .finally(() => setRateLoading(false));
    }
  }, [showConvert, destinationToken]);

  // Calculate estimated conversion
  const parsedAmount = session ? parseFloat(formatTokenAmount(session.tokenAmount, session.token)) : 0;
  const fromPrice = prices[session?.token || "USDC"] || 1;
  const toPrice = prices[destinationToken] || 1;

  // For simplicity, use 1:1 for stablecoins and price ratio otherwise
  let estimatedOutput = parsedAmount;
  if (session?.token && destinationToken) {
    if (session.token === "USDC" && destinationToken === "USDT") {
      estimatedOutput = parsedAmount; // 1:1 stablecoin
    } else if (session.token === "USDT" && destinationToken === "USDC") {
      estimatedOutput = parsedAmount; // 1:1 stablecoin
    } else if (fromPrice > 0 && toPrice > 0) {
      estimatedOutput = (parsedAmount * fromPrice) / toPrice;
    }
  }

  const handleConvert = async () => {
    if (!session) return;
    setConverting(true);
    setConversionError(null);

    try {
      const result = await convertPayment(
        session.sessionId,
        session.token,
        session.tokenAmount,
        destinationToken,
        destinationChain || undefined
      );

      const convResult: ConversionResult = {
        originalTxId: session.txId || "unknown",
        conversionTxId: result.txId,
        fromToken: session.token,
        fromAmount: session.tokenAmount,
        toToken: destinationToken,
        toAmount: result.amount,
        toChain: destinationChain || undefined,
      };

      setConversionResult(convResult);
      onConvert?.(convResult);
    } catch (err: any) {
      setConversionError(err?.message || "Conversion failed");
    }

    setConverting(false);
  };

  // Show conversion receipt
  if (conversionResult) {
    return (
      <div className="glass-card p-6 space-y-5 animate-fade-in-up border-[#00e676]/30 bg-[#00e676]/5">
        {/* Header */}
        <div className="text-center">
          <div className="status-indicator text-5xl mb-3">
            <span className="inline-flex items-center justify-center">
              <span className="w-16 h-16 rounded-full bg-[#00e676]/20 border-2 border-[#00e676] flex items-center justify-center">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00e676"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </span>
          </div>
          <p className="text-[#00e676] text-lg font-bold font-mono">✅ PAYMENT + CONVERSION COMPLETE</p>
        </div>

        {/* Original Payment */}
        <div className="bg-[#0a0d14] rounded-lg p-4 border border-[#1a1f2e]">
          <p className="text-[#546e7a] text-xs uppercase tracking-wider font-mono mb-2">Payment</p>
          <div className="flex justify-between items-center">
            <span className="text-[#e0e6ed] font-mono font-bold">
              ${session.amount.toFixed(2)} USD
            </span>
            <span className="text-[#00e676] font-mono text-sm">
              {formatTokenAmount(conversionResult.fromAmount, conversionResult.fromToken as TokenType)}{" "}
              {conversionResult.fromToken === "MATIC" ? "POL" : conversionResult.fromToken}
            </span>
          </div>
          <p className="text-[#00bcd4] text-xs mt-1 font-mono break-all">
            TX: {conversionResult.originalTxId.slice(0, 14)}...{conversionResult.originalTxId.slice(-8)}
          </p>
        </div>

        {/* Conversion Arrow */}
        <div className="text-center">
          <span className="text-[#546e7a] text-2xl">↓</span>
        </div>

        {/* Converted */}
        <div className="bg-[#0a0d14] rounded-lg p-4 border border-[#00e676]/20">
          <p className="text-[#546e7a] text-xs uppercase tracking-wider font-mono mb-2">
            Converted{conversionResult.toChain ? ` (${conversionResult.toChain})` : ""}
          </p>
          <div className="flex justify-between items-center">
            <span className="text-[#00e676] font-mono font-bold">
              {formatTokenAmount(conversionResult.toAmount, conversionResult.toToken as TokenType)}{" "}
              {conversionResult.toToken}
            </span>
            <span className="text-[#e0e6ed] font-mono text-sm">
              ≈ ${(parseFloat(formatTokenAmount(conversionResult.toAmount, conversionResult.toToken as TokenType)) * (prices[conversionResult.toToken] || 1)).toFixed(2)} USD
            </span>
          </div>
          <p className="text-[#00bcd4] text-xs mt-1 font-mono break-all">
            TX: {conversionResult.conversionTxId.slice(0, 14)}...{conversionResult.conversionTxId.slice(-8)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => {
              setShowConvert(false);
              setConversionResult(null);
            }}
            className="glass-button text-sm px-6 py-2 border-[#00e676]/30 text-[#00e676]"
          >
            Convert Again
          </button>
          <button onClick={onClose} className="glass-button text-sm px-6 py-2">
            New Payment
          </button>
        </div>
      </div>
    );
  }

  // Show conversion panel
  if (showConvert) {
    return (
      <div className="glass-card p-6 space-y-5 animate-fade-in-up border-[#00e676]/30 bg-[#00e676]/5">
        {/* Header */}
        <div className="text-center">
          <div className="status-indicator text-5xl mb-3">
            <span className="inline-flex items-center justify-center">
              <span className="w-16 h-16 rounded-full bg-[#00e676]/20 border-2 border-[#00e676] flex items-center justify-center">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00e676"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </span>
          </div>
          <p className="text-[#00e676] text-lg font-bold font-mono">✅ PAYMENT RECEIVED</p>
          <p className="text-[#546e7a] text-xs mt-1 font-mono">
            ${session.amount.toFixed(2)} USD ·{" "}
            {formatTokenAmount(session.tokenAmount, session.token)}{" "}
            {session.token === "MATIC" ? "POL" : session.token}
          </p>
        </div>

        {/* TXID */}
        {session.txId && (
          <p className="text-[#00bcd4] text-xs text-center font-mono break-all">
            TX: {session.txId.slice(0, 14)}...{session.txId.slice(-8)}
          </p>
        )}

        {/* Divider */}
        <div className="border-t border-[#1a1f2e]" />

        {/* Convert Section */}
        <div>
          <p className="text-[#546e7a] text-xs uppercase tracking-wider font-mono mb-3">
            Convert to Another Token
          </p>

          {/* Destination Token */}
          <div className="mb-3">
            <label className="block text-[#455a64] text-xs font-mono mb-2">Destination Token</label>
            <div className="grid grid-cols-3 gap-2">
              {DESTINATION_TOKENS.map((dt) => (
                <button
                  key={dt.symbol}
                  onClick={() => {
                    setDestinationToken(dt.symbol);
                    setDestinationChain(dt.chain);
                  }}
                  className={`py-2 px-2 rounded-lg text-xs font-mono transition-all duration-200 ${
                    destinationToken === dt.symbol
                      ? "bg-[#00e676]/10 border-2 border-[#00e676]/40 text-[#00e676]"
                      : "bg-[#0a0d14] border border-[#1a1f2e] text-[#546e7a] hover:border-[#00e676]/20"
                  }`}
                >
                  {dt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Estimated Rate */}
          <div className="bg-[#0a0d14] rounded-lg p-3 border border-[#1a1f2e] mb-3">
            <div className="flex justify-between items-center">
              <span className="text-[#546e7a] text-xs font-mono">Rate</span>
              <span className="text-[#e0e6ed] text-xs font-mono">
                {rateLoading ? (
                  <span className="animate-pulse">Loading...</span>
                ) : (
                  <>
                    1 {session.token === "MATIC" ? "POL" : session.token} ≈{" "}
                    {fromPrice > 0 && toPrice > 0
                      ? (fromPrice / toPrice).toFixed(6)
                      : "..."}{" "}
                    {destinationToken}
                  </>
                )}
              </span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-[#546e7a] text-xs font-mono">You receive</span>
              <span className="text-[#00e676] text-xs font-mono font-bold">
                ≈ {estimatedOutput.toFixed(6)} {destinationToken}
              </span>
            </div>
            {destinationChain && (
              <div className="flex justify-between items-center mt-1">
                <span className="text-[#546e7a] text-xs font-mono">Chain</span>
                <span className="text-[#00bcd4] text-xs font-mono">{destinationChain}</span>
              </div>
            )}
          </div>

          {/* Convert Button */}
          <button
            onClick={handleConvert}
            disabled={converting}
            className={`w-full py-3 rounded-xl text-sm font-bold font-mono transition-all duration-200 ${
              converting
                ? "bg-[#1a1f2e] text-[#546e7a] cursor-wait"
                : "bg-[#00e676] text-[#080a0f] hover:bg-[#00e676]/90 hover:shadow-lg hover:shadow-[#00e676]/20 active:scale-[0.98]"
            }`}
          >
            {converting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span> Converting...
              </span>
            ) : (
              `Convert to ${destinationToken}`
            )}
          </button>

          {/* Error */}
          {conversionError && (
            <p className="text-[#ff3d00] text-xs mt-2 font-mono text-center">{conversionError}</p>
          )}
        </div>

        {/* Back */}
        <div className="text-center">
          <button
            onClick={() => setShowConvert(false)}
            className="text-[#546e7a] hover:text-[#b0bec5] text-sm font-mono transition-colors"
          >
            ← Keep as {session.token === "MATIC" ? "POL" : session.token}
          </button>
        </div>
      </div>
    );
  }

  // Standard receipt view (before conversion)
  return (
    <div className="glass-card p-6 space-y-5 animate-fade-in-up border-[#00e676]/30 bg-[#00e676]/5">
      {/* Header */}
      <div className="text-center">
        <div className="status-indicator text-5xl mb-3">
          <span className="inline-flex items-center justify-center">
            <span className="w-16 h-16 rounded-full bg-[#00e676]/20 border-2 border-[#00e676] flex items-center justify-center">
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00e676"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </span>
        </div>
        <p className="text-[#00e676] text-lg font-bold font-mono">✅ PAYMENT RECEIVED</p>
        <p className="text-[#546e7a] text-xs mt-1 font-mono">
          Session: {session.sessionId}
        </p>
      </div>

      {/* Amount */}
      <div className="bg-[#0a0d14] rounded-lg p-4 border border-[#1a1f2e]">
        <div className="flex justify-between items-center">
          <span className="text-[#546e7a] text-xs uppercase tracking-wider font-mono">Amount</span>
          <span className="text-[#e0e6ed] font-mono font-bold text-lg">
            ${session.amount.toFixed(2)} USD
          </span>
        </div>
        <div className="flex justify-between items-center mt-1">
          <span className="text-[#546e7a] text-xs font-mono">Token</span>
          <span className="text-[#00e676] font-mono text-sm">
            {formatTokenAmount(session.tokenAmount, session.token)}{" "}
            {session.token === "MATIC" ? "POL" : session.token}
          </span>
        </div>
        {session.txId && (
          <div className="mt-2 pt-2 border-t border-[#1a1f2e]">
            <p className="text-[#00bcd4] text-xs font-mono break-all">
              TX: {session.txId.slice(0, 14)}...{session.txId.slice(-8)}
            </p>
          </div>
        )}
        {session.payerAddress && (
          <div className="mt-1">
            <p className="text-[#455a64] text-xs font-mono break-all">
              From: {session.payerAddress.slice(0, 10)}...{session.payerAddress.slice(-8)}
            </p>
          </div>
        )}
        {session.confirmedAt && (
          <div className="mt-1">
            <p className="text-[#455a64] text-xs font-mono">
              {new Date(session.confirmedAt).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      {/* Conversion Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowConvert(true)}
          className="flex-1 py-3 rounded-xl text-sm font-bold font-mono bg-[#00e676]/10 border-2 border-[#00e676]/40 text-[#00e676] hover:bg-[#00e676]/20 hover:border-[#00e676]/60 transition-all duration-200"
        >
          Convert to another token
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl text-sm font-bold font-mono bg-[#1a1f2e] border border-[#1a1f2e] text-[#546e7a] hover:text-[#b0bec5] hover:border-[#00e676]/20 transition-all duration-200"
        >
          Keep as {session.token === "MATIC" ? "POL" : session.token}
        </button>
      </div>

      {/* Transaction details */}
      <div className="text-center">
        <p className="text-[#455a64] text-xs font-mono">
          Network: {(typeof process !== "undefined" && process.env?.VITE_POS_NETWORK) === "mainnet"
            ? "Polygon Mainnet"
            : "Polygon Amoy Testnet"}
        </p>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

type TokenType = "USDC" | "USDT" | "MATIC";

function formatTokenAmount(amount: string, token: string): string {
  try {
    const val = BigInt(amount);
    const decimals = token === "MATIC" ? 18 : 6;
    const divisor = BigInt(10) ** BigInt(decimals);
    const intPart = val / divisor;
    const fracPart = val % divisor;
    if (fracPart === 0n) return intPart.toString();
    const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${intPart}.${fracStr.slice(0, 6)}`;
  } catch {
    return amount;
  }
}
