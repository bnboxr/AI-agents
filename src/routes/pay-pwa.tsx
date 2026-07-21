/**
 * HSMC Pay PWA — Customer-facing Progressive Web App
 *
 * Features:
 * - Install prompt (Add to Home Screen)
 * - Budget pre-authorization ("Allow payments up to $500")
 * - Stores budget in localStorage
 * - NFC tap detection → auto-process payment
 * - Transaction history
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { readNFCMessage, getNFCStatus } from "~/lib/nfc-bridge";
import { failPaymentSession, type PaymentStatus } from "~/lib/pos-service";

// ── Types ────────────────────────────────────────────────────────────

interface TransactionEntry {
  id: string;
  merchant: string;
  amount: number;
  token: string;
  date: number;
  status: "approved" | "declined" | "insufficient";
  txId?: string;
}

interface PWASettings {
  budget: number;
  spent: number;
  currency: string;
  autoPay: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY_SETTINGS = "hsmc_pay_settings";
const STORAGE_KEY_HISTORY = "hsmc_pay_history";
const DEFAULT_BUDGET = 500;

// ── Route ────────────────────────────────────────────────────────────

export const Route = createFileRoute("/pay-pwa")({
  component: HSMCPayPWA,
});

// ── Storage Helpers ───────────────────────────────────────────────────

function loadSettings(): PWASettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        budget: parsed.budget || DEFAULT_BUDGET,
        spent: parsed.spent || 0,
        currency: parsed.currency || "USD",
        autoPay: parsed.autoPay !== false,
      };
    }
  } catch {}
  return { budget: DEFAULT_BUDGET, spent: 0, currency: "USD", autoPay: true };
}

function saveSettings(settings: PWASettings): void {
  try { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); } catch {}
}

function loadHistory(): TransactionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(history: TransactionEntry[]): void {
  try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history.slice(0, 50))); } catch {}
}

function addToHistory(entry: Omit<TransactionEntry, "id" | "date">): TransactionEntry[] {
  const history = loadHistory();
  const newEntry: TransactionEntry = {
    ...entry,
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: Date.now(),
  };
  const updated = [newEntry, ...history];
  saveHistory(updated);
  return updated;
}

// ── Main Component ────────────────────────────────────────────────────

function HSMCPayPWA() {
  const [settings, setSettings] = useState<PWASettings>(loadSettings);
  const [history, setHistory] = useState<TransactionEntry[]>(loadHistory);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [nfcReading, setNfcReading] = useState(false);
  const [nfcAvailable, setNfcAvailable] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{
    type: "approved" | "declined" | "insufficient" | "timeout";
    message: string;
    txId?: string;
  } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  // ── PWA Install Handler ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // ── NFC Support Check ────────────────────────────────────────────
  useEffect(() => {
    const status = getNFCStatus();
    setNfcAvailable(status.supported && status.type === "web-nfc");
  }, []);

  // ── Handle Install ───────────────────────────────────────────────
  const handleInstall = useCallback(async () => {
    if (!installPrompt) {
      alert("To install: tap your browser menu → 'Add to Home Screen'");
      return;
    }
    try {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") setInstalled(true);
    } catch (err) {
      console.warn("[PWA] Install error:", err);
    }
    setInstallPrompt(null);
  }, [installPrompt]);

  // ── Save Budget ──────────────────────────────────────────────────
  const handleSaveBudget = useCallback(() => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val <= 0) return;
    const updated: PWASettings = { ...settings, budget: val };
    setSettings(updated);
    saveSettings(updated);
    setShowBudgetModal(false);
    setBudgetInput("");
  }, [budgetInput, settings]);

  // ── Process NFC Payment ──────────────────────────────────────────
  const processNFCPayment = useCallback(async (ndefText: string) => {
    if (processingPayment) return;
    setProcessingPayment(true);
    setPaymentResult(null);
    setNfcError(null);

    try {
      const payload = JSON.parse(ndefText);
      if (payload.type !== "crypto-payment") {
        setNfcError("Invalid payment format on NFC tag");
        setProcessingPayment(false);
        return;
      }

      const { sessionId, amount: rawAmount, token } = payload;
      const paymentAmount = parseFloat(rawAmount) || 0;
      const remaining = settings.budget - settings.spent;

      if (paymentAmount > remaining) {
        setPaymentResult({
          type: "insufficient",
          message: `Over budget: $${paymentAmount.toFixed(2)} exceeds $${remaining.toFixed(2)}`,
        });
        addToHistory({ merchant: "NFC Merchant", amount: paymentAmount, token: token || "USDC", status: "insufficient" });
        setHistory(loadHistory());
        failPaymentSession(sessionId, "insufficient_funds");
        setProcessingPayment(false);
        return;
      }

      // Within budget — auto-approve
      setPaymentResult({
        type: "approved",
        message: `$${paymentAmount.toFixed(2)} approved — tap complete`,
        txId: `sim_${sessionId}_${Date.now()}`,
      });

      const updated: PWASettings = { ...settings, spent: settings.spent + paymentAmount };
      setSettings(updated);
      saveSettings(updated);

      addToHistory({ merchant: "NFC Merchant", amount: paymentAmount, token: token || "USDC", status: "approved" });
      setHistory(loadHistory());
    } catch (err: any) {
      console.warn("[PWA] NFC payment error:", err);
      setPaymentResult({ type: "declined", message: err?.message || "Payment processing failed" });
    }
    setProcessingPayment(false);
  }, [processingPayment, settings]);

  // ── Start NFC Reading ────────────────────────────────────────────
  const handleStartNFC = useCallback(async () => {
    if (!nfcAvailable) { setNfcError("NFC not available"); return; }
    setNfcReading(true);
    setNfcError(null);
    setPaymentResult(null);

    try {
      const result = await readNFCMessage();
      if (!result.success) { setNfcError(result.error); setNfcReading(false); return; }
      for (const record of result.records) {
        if (record.recordType === "text") {
          const decoder = new TextDecoder();
          const text = decoder.decode(record.data);
          try {
            const parsed = JSON.parse(text);
            if (parsed.type === "crypto-payment") {
              await processNFCPayment(text);
              setNfcReading(false);
              return;
            }
          } catch {}
        }
      }
      setNfcError("No payment data found on NFC tag");
    } catch (err: any) {
      setNfcError(err?.message || "NFC read failed");
    }
    setNfcReading(false);
  }, [nfcAvailable, processNFCPayment]);

  // ── Reset budget ─────────────────────────────────────────────────
  const handleResetSpent = useCallback(() => {
    const updated: PWASettings = { ...settings, spent: 0 };
    setSettings(updated);
    saveSettings(updated);
  }, [settings]);

  const handleDismissResult = useCallback(() => setPaymentResult(null), []);

  // ── Computed ─────────────────────────────────────────────────────
  const remaining = settings.budget - settings.spent;
  const spentPercent = settings.budget > 0 ? Math.min(100, (settings.spent / settings.budget) * 100) : 0;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8 min-h-dvh">
      <div className="mx-auto max-w-md space-y-6 animate-fade-in">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl sm:text-4xl font-black text-[#e0e6ed] font-mono tracking-tight">
            <span className="text-[#00e676]">{">"}</span> HSMC Pay
          </h1>
          <p className="text-[#546e7a] text-sm mt-2 font-mono">⚡ Tap to Pay · Auto-approved within budget</p>
        </div>

        {/* Budget Card */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#b0bec5] font-mono font-bold text-sm uppercase tracking-wider">Spending Budget</h3>
            <button
              onClick={() => { setBudgetInput(settings.budget.toString()); setShowBudgetModal(true); }}
              className="text-[#00e676] text-xs font-mono hover:text-[#00e676]/80 transition-colors"
            >Change</button>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm font-mono">
              <span className="text-[#546e7a]">Spent: ${settings.spent.toFixed(2)}</span>
              <span className="text-[#00e676]">Left: ${remaining.toFixed(2)}</span>
            </div>
            <div className="w-full h-3 bg-[#0a0d14] rounded-full overflow-hidden border border-[#1a1f2e]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  spentPercent > 80 ? "bg-[#ff3d00]" : spentPercent > 50 ? "bg-[#ffab00]" : "bg-[#00e676]"
                }`}
                style={{ width: `${spentPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-[#455a64]">$0</span>
              <span className="text-[#455a64]">${settings.budget}</span>
            </div>
          </div>
          {settings.spent > 0 && (
            <button onClick={handleResetSpent} className="w-full mt-3 text-[#546e7a] text-xs font-mono hover:text-[#ff3d00] transition-colors py-1">
              Reset spent (new period)
            </button>
          )}
        </div>

        {/* NFC Tap Zone */}
        <div className="glass-card p-8 text-center">
          {paymentResult ? (
            /* Payment Result */
            <div className="animate-fade-in-up space-y-4">
              <div className="text-5xl">
                {paymentResult.type === "approved" && (
                  <span className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#00e676]/20 border-2 border-[#00e676]">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#00e676" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
                {paymentResult.type === "declined" && (
                  <span className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#ff3d00]/20 border-2 border-[#ff3d00]">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ff3d00" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                )}
                {paymentResult.type === "insufficient" && (
                  <span className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#ffab00]/20 border-2 border-[#ffab00]">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffab00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </span>
                )}
                {paymentResult.type === "timeout" && (
                  <span className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#546e7a]/20 border-2 border-[#546e7a]">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#546e7a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                  </span>
                )}
              </div>
              <p className={`text-lg font-bold font-mono ${
                paymentResult.type === "approved" ? "text-[#00e676]" :
                paymentResult.type === "insufficient" ? "text-[#ffab00]" : "text-[#ff3d00]"
              }`}>
                {paymentResult.type === "approved" ? "✅ APPROVED" :
                 paymentResult.type === "insufficient" ? "⚠️ OVER BUDGET" :
                 paymentResult.type === "timeout" ? "⏱️ TIMEOUT" : "❌ DECLINED"}
              </p>
              <p className="text-[#546e7a] text-sm font-mono">{paymentResult.message}</p>
              {paymentResult.txId && (
                <p className="text-[#00bcd4] text-xs font-mono break-all">TX: {paymentResult.txId.slice(0, 14)}...{paymentResult.txId.slice(-8)}</p>
              )}
              <div className="flex gap-3 justify-center mt-4">
                <button onClick={handleDismissResult} className="glass-button text-sm px-6 py-2">OK</button>
                <button onClick={() => { handleDismissResult(); handleStartNFC(); }} className="glass-button text-sm px-6 py-2 border-[#00e676]/30 text-[#00e676]">Tap Again</button>
              </div>
            </div>
          ) : nfcReading ? (
            /* Reading NFC */
            <div className="space-y-4">
              <div className="text-5xl animate-pulse">📱</div>
              <p className="text-[#00e676] font-bold font-mono text-lg">Hold phone near terminal...</p>
              <p className="text-[#546e7a] text-xs font-mono">NFC tag will be read automatically</p>
              <button onClick={() => setNfcReading(false)} className="text-[#546e7a] hover:text-[#ff3d00] text-xs font-mono transition-colors mt-2">Cancel</button>
            </div>
          ) : processingPayment ? (
            /* Processing */
            <div className="space-y-4">
              <div className="text-5xl animate-spin">⟳</div>
              <p className="text-[#00bcd4] font-bold font-mono text-lg">Processing Payment...</p>
              <p className="text-[#546e7a] text-xs font-mono">Auto-approving within budget</p>
            </div>
          ) : (
            /* Tap to Pay */
            <div className="space-y-4">
              <button
                onClick={handleStartNFC}
                disabled={!nfcAvailable}
                className={`w-32 h-32 rounded-full flex items-center justify-center mx-auto transition-all duration-300 ${
                  nfcAvailable
                    ? "bg-[#00e676]/10 border-4 border-[#00e676]/30 hover:border-[#00e676]/60 hover:bg-[#00e676]/20 active:scale-95 cursor-pointer"
                    : "bg-[#1a1f2e] border-4 border-[#455a64]/30 cursor-not-allowed opacity-50"
                }`}
              >
                <span className="text-5xl">📱</span>
              </button>
              <p className="text-[#00e676] font-bold font-mono text-lg">⚡ Tap to Pay</p>
              <p className="text-[#546e7a] text-sm font-mono">
                {nfcAvailable ? "Tap your phone on the merchant's terminal" : "NFC required — open on mobile Chrome"}
              </p>
            </div>
          )}
          {nfcError && <p className="text-[#ff3d00] text-xs mt-3 font-mono">{nfcError}</p>}
        </div>

        {/* Transaction History */}
        {history.length > 0 && (
          <div className="glass-card p-5">
            <h3 className="text-[#b0bec5] font-mono font-bold text-sm uppercase tracking-wider mb-3">Recent Transactions</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {history.slice(0, 10).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-[#1a1f2e] last:border-0">
                  <div className="flex items-center gap-3">
                    <span>{tx.status === "approved" ? "✓" : tx.status === "insufficient" ? "⚠" : "✕"}</span>
                    <div>
                      <p className="text-[#b0bec5] text-sm font-mono">{tx.merchant}</p>
                      <p className="text-[#455a64] text-xs font-mono">
                        {new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-mono font-bold ${
                      tx.status === "approved" ? "text-[#00e676]" : tx.status === "insufficient" ? "text-[#ffab00]" : "text-[#ff3d00]"
                    }`}>${tx.amount.toFixed(2)}</p>
                    <p className="text-[#455a64] text-xs font-mono">{tx.token}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Install PWA Button */}
        {!installed && (
          <div className="glass-card p-5 text-center">
            <p className="text-[#b0bec5] font-mono text-sm mb-3">Install for faster checkout</p>
            <button onClick={handleInstall} className="glass-button text-sm px-8 py-3 border-[#00e676]/30 text-[#00e676] font-bold">
              📲 Install App
            </button>
            <p className="text-[#455a64] text-xs mt-2 font-mono">Add to Home Screen for one-tap payments</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center space-y-1">
          <p className="text-[#455a64] text-xs font-mono">Auto-pay enabled · Budget: ${settings.budget} · Powered by PĂUN_AI POS</p>
          <p className="text-[#455a64] text-xs font-mono">Polygon Network · Instant settlement</p>
        </div>

        {/* Budget Modal */}
        {showBudgetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-card p-8 max-w-sm w-full animate-fade-in-up">
              <h3 className="text-[#e0e6ed] font-mono font-bold text-lg mb-4">Set Spending Budget</h3>
              <p className="text-[#546e7a] text-sm font-mono mb-4">
                Pre-authorize a maximum amount for auto-approved NFC payments. Payments under this limit process instantly.
              </p>
              <div className="flex items-center gap-2 mb-6">
                <span className="text-[#e0e6ed] text-2xl font-mono">$</span>
                <input
                  type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveBudget()}
                  placeholder={DEFAULT_BUDGET.toString()} min="1" step="1"
                  className="bg-transparent text-3xl font-black text-[#e0e6ed] font-mono text-center w-[180px] outline-none border-b-2 border-[#1a1f2e] focus:border-[#00e676] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ caretColor: "#00e676" }} autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowBudgetModal(false)} className="flex-1 glass-button text-sm py-2 border-[#1a1f2e] text-[#546e7a]">Cancel</button>
                <button onClick={handleSaveBudget} className="flex-1 glass-button text-sm py-2 border-[#00e676]/30 text-[#00e676] font-bold">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
