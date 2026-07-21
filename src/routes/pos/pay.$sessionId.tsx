/**
 * Customer Payment Page — /pos/pay/$sessionId
 *
 * Opens when customer scans QR code or taps NFC.
 * Shows merchant info, amount, and "Pay with Wallet" button.
 */

import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "~/lib/demo-wagmi";
import { getPaymentSession, type PaymentSession } from "~/lib/pos-service";

// ── Route ────────────────────────────────────────────────────────────

export const Route = createFileRoute("/pos/pay/$sessionId")({
  component: CustomerPaymentPage,
});

// ── Component ────────────────────────────────────────────────────────

function CustomerPaymentPage() {
  const { sessionId } = useParams({ from: "/pos/pay/$sessionId" });
  const { isConnected } = useAccount();

  const [session, setSession] = useState<PaymentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // ── Fetch Session ────────────────────────────────────────────────

  useEffect(() => {
    const s = getPaymentSession(sessionId);
    if (s) {
      setSession(s);
    } else {
      setError("Payment session not found or expired");
    }
    setLoading(false);
  }, [sessionId]);

  // ── Handle Payment ────────────────────────────────────────────────

  const handlePay = useCallback(async () => {
    if (!session || !isConnected) return;
    setPaying(true);
    setError(null);
    try {
      // In production, this triggers wallet interaction via the contract
      // For the demo, show processing state
    } catch (err) {
      console.warn("[Pay] Transaction error:", err);
      setError("Payment failed — please try again");
      setPaying(false);
    }
  }, [session, isConnected]);

  // ── Loading State ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="pt-14 pb-12 px-4 sm:px-6 min-h-dvh flex items-center justify-center">
        <div className="glass-card p-12 text-center max-w-md">
          <div className="animate-spin text-4xl mb-4">⟳</div>
          <p className="text-[#b0bec5] font-mono text-sm">Loading payment session...</p>
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────

  if (error || !session) {
    return (
      <div className="pt-14 pb-12 px-4 sm:px-6 min-h-dvh flex items-center justify-center">
        <div className="glass-card p-12 text-center max-w-md">
          <div className="text-4xl mb-4">✕</div>
          <h2 className="text-[#ff3d00] font-bold font-mono text-lg mb-2">Payment Error</h2>
          <p className="text-[#546e7a] font-mono text-sm">{error || "Session not found"}</p>
        </div>
      </div>
    );
  }

  // ── Confirmed State ────────────────────────────────────────────────

  if (session.status === "confirmed") {
    return (
      <div className="pt-14 pb-12 px-4 sm:px-6 min-h-dvh flex items-center justify-center">
        <div className="glass-card p-12 text-center max-w-md">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-[#00e676] font-bold font-mono text-xl mb-2">Payment Confirmed!</h2>
          <p className="text-[#b0bec5] font-mono text-sm mb-4">
            ${session.amount.toFixed(2)} paid successfully
          </p>
          <p className="text-[#546e7a] font-mono text-xs">Thank you for your payment</p>
        </div>
      </div>
    );
  }

  // ── Main Payment View ──────────────────────────────────────────────

  const tokenSymbol = session.token === "MATIC" ? "POL" : session.token;

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 min-h-dvh flex items-center justify-center">
      <div className="max-w-md w-full space-y-6 animate-fade-in-up">
        {/* Merchant + Amount */}
        <div className="glass-card p-8 text-center">
          <p className="text-[#546e7a] text-xs uppercase tracking-wider mb-2 font-mono">Pay to</p>
          <h2 className="text-[#e0e6ed] text-xl font-bold font-mono mb-1">{session.merchantName}</h2>
          <p className="text-[#455a64] text-xs font-mono mb-6">
            {session.merchant.slice(0, 8)}...{session.merchant.slice(-6)}
          </p>

          <div className="border-t border-b border-[#1a1f2e] py-6 my-4">
            <p className="text-[#546e7a] text-xs uppercase tracking-wider mb-1 font-mono">Amount Due</p>
            <p className="text-4xl font-black text-[#e0e6ed] font-mono">${session.amount.toFixed(2)}</p>
            <p className="text-[#00e676] text-sm mt-2 font-mono">
              ≈ {formatTokenAmount(session.tokenAmount, session.token)} {tokenSymbol}
            </p>
          </div>

          <p className="text-[#546e7a] text-xs font-mono mt-4">Session: {session.sessionId}</p>
        </div>

        {/* Pay Button */}
        {isConnected ? (
          <button
            onClick={handlePay}
            disabled={paying}
            className={`w-full py-4 rounded-xl text-lg font-black font-mono transition-all duration-200 ${
              paying
                ? "bg-[#1a1f2e] text-[#546e7a] cursor-wait"
                : "bg-[#00e676] text-[#080a0f] hover:bg-[#00e676]/90 hover:shadow-lg hover:shadow-[#00e676]/20 active:scale-[0.98]"
            }`}
          >
            {paying ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span> Processing...
              </span>
            ) : (
              `Pay $${session.amount.toFixed(2)}`
            )}
          </button>
        ) : (
          <div className="glass-card p-6 text-center">
            <p className="text-[#ffab00] font-mono text-sm mb-3">Connect your wallet to pay</p>
            <p className="text-[#546e7a] font-mono text-xs">Use the Connect button in the top-right corner</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="glass-card p-4 border-[#ff3d00]/30 bg-[#ff3d00]/5 text-center">
            <p className="text-[#ff3d00] font-mono text-sm">{error}</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center">
          <p className="text-[#455a64] text-xs font-mono">Powered by PĂUN_AI POS · Polygon Network</p>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatTokenAmount(amount: string, token: "USDC" | "USDT" | "MATIC"): string {
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
