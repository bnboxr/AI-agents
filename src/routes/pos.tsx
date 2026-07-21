/**
 * POS Crypto Terminal — Merchant Point of Sale
 *
 * Glassmorphism UI for accepting crypto payments.
 * Features: USD amount input → QR code + NFC tap-to-pay → Polygon settlement.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount } from "~/lib/demo-wagmi";
import QRCode from "qrcode";
import POSReceipt from "~/components/POSReceipt";
import {
  checkNFCWebSupport,
  writeNFCMessage,
  getNFCStatus,
  type NFCBridgeStatus,
} from "~/lib/nfc-bridge";
import {
  createPaymentSession,
  getPaymentSession,
  getTokenPrices,
  buildEIP681Url,
  buildNFCPayload,
  type PaymentSession,
} from "~/lib/pos-service";
import { startPaymentWatcher } from "~/lib/pos-watcher";

// ── Types ────────────────────────────────────────────────────────────

type TokenType = "USDC" | "USDT" | "MATIC";

// ── Route ────────────────────────────────────────────────────────────

export const Route = createFileRoute("/pos")({
  component: POSTerminal,
});

// ── Main Component ───────────────────────────────────────────────────

function POSTerminal() {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState<string>("");
  const [selectedToken, setSelectedToken] = useState<TokenType>("USDC");
  const [merchantWallet, setMerchantWallet] = useState<string>("");
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nfcStatus, setNfcStatus] = useState<NFCBridgeStatus | null>(null);
  const [nfcWriting, setNfcWriting] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({ USDC: 1, USDT: 1, MATIC: 0.5 });
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Populate merchant wallet from connected wallet
  useEffect(() => {
    if (isConnected && address && !merchantWallet) {
      setMerchantWallet(address);
    }
  }, [isConnected, address]);

  // Check NFC support on mount
  useEffect(() => {
    setNfcStatus(getNFCStatus());
  }, []);

  // Auto-focus amount input
  useEffect(() => {
    amountInputRef.current?.focus();
  }, []);

  // Load prices on mount
  useEffect(() => {
    getTokenPrices().then(setPrices).catch((err) => {
      console.warn("[POS] Price load error:", err);
    });
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Start blockchain watcher on mount (once)
  const watcherStarted = useRef(false);
  useEffect(() => {
    if (!watcherStarted.current) {
      startPaymentWatcher();
      watcherStarted.current = true;
    }
  }, []);

  // ── Create Payment Session ────────────────────────────────────────

  const handleCreateSession = useCallback(async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    if (!merchantWallet) {
      setError("Please connect your wallet or enter a merchant address");
      return;
    }

    setLoading(true);
    setError(null);
    setSession(null);
    setQrDataUrl(null);

    try {
      // Refresh prices first
      const freshPrices = await getTokenPrices();
      setPrices(freshPrices);

      const newSession = createPaymentSession({
        amount: parsedAmount,
        token: selectedToken,
        merchant: merchantWallet,
        merchantName: "HSMC POS Merchant",
      });

      // Recalculate with live prices
      const price = freshPrices[selectedToken] || 1;
      const decimals = selectedToken === "MATIC" ? 18 : 6;
      const rawAmount = BigInt(Math.floor((parsedAmount / price) * 10 ** decimals));
      newSession.tokenAmount = rawAmount.toString();

      setSession(newSession);

      const contractAddress =
        (typeof process !== "undefined" && process.env?.VITE_POS_CONTRACT_ADDRESS) ||
        "0x0000000000000000000000000000000000000000";

      const eip681Url = buildEIP681Url({
        contractAddress,
        token: selectedToken,
        amount: newSession.tokenAmount,
        merchant: merchantWallet,
        sessionId: newSession.sessionId,
      });

      setQrUrl(eip681Url);

      // Generate QR code
      try {
        const qrData = await QRCode.toDataURL(eip681Url, {
          width: 280,
          margin: 2,
          color: { dark: "#00e676", light: "#0d1117" },
        });
        setQrDataUrl(qrData);
      } catch (qrErr) {
        console.warn("[POS] QR generation error:", qrErr);
      }

      // Start polling for status
      startPolling(newSession.sessionId);

      setLoading(false);
    } catch (err) {
      console.warn("[POS] Create session error:", err);
      setError("Failed to create payment session");
      setLoading(false);
    }
  }, [amount, merchantWallet, selectedToken]);

  // ── Poll Session Status ───────────────────────────────────────────

  const startPolling = useCallback((sessionId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    const poll = () => {
      setPollCount((c) => c + 1);
      const s = getPaymentSession(sessionId);
      if (!s) return;

      setSession((prev) => {
        if (!prev) return prev;
        if (s.status !== prev.status) {
          return { ...prev, status: s.status, txId: s.txId, payerAddress: s.payerAddress, confirmedAt: s.confirmedAt };
        }
        return prev;
      });

      if (s.status === "confirmed" || s.status === "failed") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
  }, []);

  // ── NFC Write ─────────────────────────────────────────────────────

  const handleNFCWrite = useCallback(async () => {
    if (!session || !qrUrl) return;

    setNfcWriting(true);
    setNfcError(null);

    try {
      const result = await writeNFCMessage([
        { recordType: "url", data: qrUrl },
        {
          recordType: "text",
          data: JSON.stringify({
            type: "crypto-payment",
            sessionId: session.sessionId,
            amount: session.tokenAmount,
            token: session.token,
            merchant: session.merchant,
            contractAddress:
              (typeof process !== "undefined" && process.env?.VITE_POS_CONTRACT_ADDRESS) || "",
            timestamp: Date.now(),
          }),
        },
      ]);

      if (!result.success) {
        setNfcError(result.error);
      }
    } catch (err: any) {
      console.warn("[POS] NFC write error:", err);
      setNfcError(err?.message || "NFC write failed");
    }

    setNfcWriting(false);
  }, [session, qrUrl]);

  // ── Reset ─────────────────────────────────────────────────────────

  const handleReset = () => {
    setAmount("");
    setSession(null);
    setQrDataUrl(null);
    setQrUrl(null);
    setError(null);
    setNfcError(null);
    setPollCount(0);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    amountInputRef.current?.focus();
  };

  // ── Calculate Token Equivalent ────────────────────────────────────

  const parsedAmount = parseFloat(amount) || 0;
  const tokenPrice = prices[selectedToken] || 1;
  const tokenEquivalent = parsedAmount > 0 ? parsedAmount / tokenPrice : 0;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8 min-h-dvh">
      <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-[#e0e6ed] font-mono tracking-tight">
            <span className="text-[#00e676]">{">"}</span> POS Terminal
          </h1>
          <p className="text-[#546e7a] text-sm mt-2 font-mono">
            Accept crypto payments · Polygon Network · Instant settlement
          </p>
        </div>

        {/* ── Show Receipt if Confirmed ────────────────────────── */}
        {session?.status === "confirmed" && (
          <div className="animate-fade-in-up">
            <POSReceipt session={session} onClose={handleReset} />
            <div className="text-center mt-4">
              <button onClick={handleReset} className="glass-button text-sm px-6 py-2">
                New Payment
              </button>
            </div>
          </div>
        )}

        {/* ── Active Payment View ──────────────────────────────── */}
        {session && session.status === "pending" && (
          <div className="space-y-6">
            {/* Amount Display */}
            <div className="glass-card p-8 text-center">
              <p className="text-[#546e7a] text-xs uppercase tracking-wider mb-2 font-mono">Amount Due</p>
              <p className="text-5xl sm:text-6xl font-black text-[#e0e6ed] font-mono tracking-tight">
                ${session.amount.toFixed(2)}
              </p>
              <p className="text-[#00e676] text-lg mt-2 font-mono">
                ≈ {formatTokenAmount(session.tokenAmount, session.token)} {session.token === "MATIC" ? "POL" : session.token}
              </p>
            </div>

            {/* QR Code */}
            <div className="glass-card p-6 text-center">
              <p className="text-[#546e7a] text-xs uppercase tracking-wider mb-4 font-mono">Scan to Pay</p>
              {qrDataUrl ? (
                <div className="inline-block p-3 bg-[#0a0d14] rounded-xl border border-[#1a1f2e]">
                  <img src={qrDataUrl} alt="Payment QR Code" className="w-[280px] h-[280px]" />
                </div>
              ) : (
                <div className="inline-block p-3 bg-[#0a0d14] rounded-xl border border-[#1a1f2e] w-[280px] h-[280px] flex items-center justify-center">
                  <span className="text-[#455a64] font-mono text-sm animate-pulse-slow">Generating QR...</span>
                </div>
              )}
              {qrUrl && (
                <p className="text-[#455a64] text-xs mt-3 font-mono break-all max-w-[320px] mx-auto">
                  {qrUrl.slice(0, 60)}...
                </p>
              )}
            </div>

            {/* NFC Button */}
            <div className="glass-card p-6 text-center">
              <p className="text-[#546e7a] text-xs uppercase tracking-wider mb-4 font-mono">Tap to Pay via NFC</p>
              {nfcStatus?.supported ? (
                <button
                  onClick={handleNFCWrite}
                  disabled={nfcWriting}
                  className={`px-8 py-4 rounded-xl text-lg font-bold font-mono transition-all duration-200 ${
                    nfcWriting
                      ? "bg-[#1a1f2e] text-[#546e7a] cursor-wait"
                      : "bg-[#00e676]/10 border-2 border-[#00e676]/40 text-[#00e676] hover:bg-[#00e676]/20 hover:border-[#00e676]/60 active:scale-95"
                  }`}
                >
                  {nfcWriting ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-pulse-slow">📱</span> Writing to NFC...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">📱 Tap to Pay via NFC</span>
                  )}
                </button>
              ) : (
                <div className="text-center">
                  <button
                    disabled
                    className="px-8 py-4 rounded-xl text-lg font-bold font-mono bg-[#1a1f2e] text-[#455a64] cursor-not-allowed"
                  >
                    📱 NFC Not Available
                  </button>
                  <p className="text-[#546e7a] text-xs mt-2 font-mono">Use QR code instead — works on all devices</p>
                </div>
              )}
              {nfcError && <p className="text-[#ff3d00] text-xs mt-3 font-mono">{nfcError}</p>}
            </div>

            {/* Payment Status */}
            <div className="glass-card p-4 text-center">
              <div className="flex items-center justify-center gap-3">
                <span className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-[#ffab00] font-mono text-sm font-semibold">Awaiting Payment...</span>
              </div>
              <p className="text-[#546e7a] text-xs mt-2 font-mono">
                Session: {session.sessionId} · Checking every 3s
                {pollCount > 0 && ` · Poll #${pollCount}`}
              </p>
            </div>

            {/* Cancel */}
            <div className="text-center">
              <button
                onClick={handleReset}
                className="text-[#546e7a] hover:text-[#ff3d00] text-sm font-mono transition-colors"
              >
                Cancel Payment
              </button>
            </div>
          </div>
        )}

        {/* ── New Payment Form ─────────────────────────────────── */}
        {(!session || session.status === "failed") && (
          <div className="space-y-5">
            {/* Merchant Wallet */}
            {!isConnected && (
              <div className="glass-card p-4">
                <label className="block text-[#546e7a] text-xs uppercase tracking-wider mb-2 font-mono">
                  Merchant Wallet Address
                </label>
                <input
                  type="text"
                  value={merchantWallet}
                  onChange={(e) => setMerchantWallet(e.target.value)}
                  placeholder="0x..."
                  className="glass-input w-full"
                />
              </div>
            )}

            {/* Amount Input */}
            <div className="glass-card p-8 text-center">
              <label className="block text-[#546e7a] text-xs uppercase tracking-wider mb-3 font-mono">
                Enter Amount (USD)
              </label>
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="text-[#e0e6ed] text-4xl font-light">$</span>
                <input
                  ref={amountInputRef}
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="bg-transparent text-5xl sm:text-6xl font-black text-[#e0e6ed] font-mono tracking-tight text-center w-[250px] outline-none border-b-2 border-[#1a1f2e] focus:border-[#00e676] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ caretColor: "#00e676" }}
                />
              </div>
              {parsedAmount > 0 && (
                <p className="text-[#00e676] text-sm font-mono mt-2">
                  ≈ {tokenEquivalent.toFixed(selectedToken === "MATIC" ? 4 : 2)} {selectedToken === "MATIC" ? "POL" : selectedToken}
                </p>
              )}
            </div>

            {/* Token Selector */}
            <div className="glass-card p-4">
              <label className="block text-[#546e7a] text-xs uppercase tracking-wider mb-3 font-mono">Accepted Token</label>
              <div className="flex gap-2">
                {(["USDC", "USDT", "MATIC"] as TokenType[]).map((token) => (
                  <button
                    key={token}
                    onClick={() => setSelectedToken(token)}
                    className={`flex-1 py-3 rounded-lg text-sm font-bold font-mono transition-all duration-200 ${
                      selectedToken === token
                        ? "bg-[#00e676]/10 border-2 border-[#00e676]/40 text-[#00e676]"
                        : "bg-[#0a0d14] border border-[#1a1f2e] text-[#546e7a] hover:border-[#00e676]/20 hover:text-[#b0bec5]"
                    }`}
                  >
                    {token === "MATIC" ? "POL" : token}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="glass-card p-4 border-[#ff3d00]/30 bg-[#ff3d00]/5">
                <p className="text-[#ff3d00] text-sm font-mono text-center">{error}</p>
              </div>
            )}

            {/* Failed Session */}
            {session?.status === "failed" && (
              <div className="glass-card p-4 border-[#ff3d00]/30 bg-[#ff3d00]/5 text-center">
                <p className="text-[#ff3d00] font-mono font-semibold">✕ Payment failed or timed out</p>
                <p className="text-[#546e7a] text-xs mt-1 font-mono">Please try again</p>
              </div>
            )}

            {/* Charge Button */}
            <button
              onClick={handleCreateSession}
              disabled={loading || parsedAmount <= 0}
              className={`w-full py-4 rounded-xl text-lg font-black font-mono transition-all duration-200 ${
                loading
                  ? "bg-[#1a1f2e] text-[#546e7a] cursor-wait"
                  : parsedAmount > 0
                    ? "bg-[#00e676] text-[#080a0f] hover:bg-[#00e676]/90 hover:shadow-lg hover:shadow-[#00e676]/20 active:scale-[0.98]"
                    : "bg-[#1a1f2e] text-[#455a64] cursor-not-allowed"
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⟳</span> Creating Session...
                </span>
              ) : (
                `Charge $${parsedAmount > 0 ? parsedAmount.toFixed(2) : "0.00"}`
              )}
            </button>

            {/* Info */}
            <div className="text-center space-y-1">
              <p className="text-[#455a64] text-xs font-mono">Payments settle on Polygon Network</p>
              <p className="text-[#455a64] text-xs font-mono">
                Network: {(typeof process !== "undefined" && process.env?.VITE_POS_NETWORK) === "mainnet"
                  ? "Mainnet"
                  : "Amoy Testnet"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatTokenAmount(amount: string, token: TokenType): string {
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
