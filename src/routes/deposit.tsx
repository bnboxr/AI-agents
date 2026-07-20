import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";

// ── Server Functions ──────────────────────────────────────────────

interface CreateCheckoutResult {
  url: string | null;
  error?: string;
  mode: "live" | "unavailable";
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { amount: number } }): Promise<CreateCheckoutResult> => {
    const { amount } = data;
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      return {
        url: null,
        error: "Stripe is not configured. The platform operator must set STRIPE_SECRET_KEY.",
        mode: "unavailable",
      };
    }

    // Amount is in USD (dollars). Stripe expects cents.
    const amountCents = Math.round(amount * 100);
    if (amountCents < 50) {
      return { url: null, error: "Minimum deposit is $0.50.", mode: "live" };
    }

    try {
      const baseUrl = typeof window !== "undefined"
        ? window.location.origin
        : process.env.APP_URL || "http://localhost:3000";

      const stripeUrl = "https://api.stripe.com/v1/checkout/sessions";
      const params = new URLSearchParams({
        "payment_method_types[]": "card",
        "mode": "payment",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": "HSMC Deposit",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][quantity]": "1",
        "success_url": `${baseUrl}/deposit?status=success&session_id={CHECKOUT_SESSION_ID}`,
        "cancel_url": `${baseUrl}/deposit?status=cancelled`,
      });

      const res = await fetch(stripeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });

      const json = await res.json();
      if (!res.ok) {
        return { url: null, error: json.error?.message || "Stripe API error", mode: "live" };
      }

      return { url: json.url, mode: "live" };
    } catch (err: any) {
      return { url: null, error: err.message || "Failed to create checkout session", mode: "live" };
    }
  });

// ── Types ──────────────────────────────────────────────────────────

interface DepositRecord {
  id: string;
  amount: number;
  date: string;
  status: "completed" | "pending" | "cancelled";
  sessionId?: string;
}

// ── Constants ──────────────────────────────────────────────────────

const PRESET_AMOUNTS = [100, 500, 1000, 5000, 10000];
const CURRENCY = "USD";

// In-memory tx history (resets on page reload — real persistence needs DB)
// We read ?status=success&session_id=... from URL to show recent deposits
function parseUrlParams(): { status: string | null; sessionId: string | null } {
  if (typeof window === "undefined") return { status: null, sessionId: null };
  const p = new URLSearchParams(window.location.search);
  return { status: p.get("status"), sessionId: p.get("session_id") };
}

// ── Page Component ─────────────────────────────────────────────────

export const Route = createFileRoute("/deposit")({
  component: DepositPage,
});

function DepositPage() {
  const [amount, setAmount] = useState(100);
  const [customMode, setCustomMode] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [stripeMode, setStripeMode] = useState<"live" | "unavailable" | "unknown">("unknown");
  const [txHistory, setTxHistory] = useState<DepositRecord[]>([]);

  const effectiveAmount = customMode ? Number(customAmount) || 0 : amount;

  // Handle return from Stripe Checkout
  useEffect(() => {
    const { status, sessionId } = parseUrlParams();
    if (status === "success" && sessionId) {
      const record: DepositRecord = {
        id: sessionId.slice(0, 16) + "...",
        amount: effectiveAmount || 100,
        date: new Date().toISOString(),
        status: "completed",
        sessionId,
      };
      setTxHistory((prev) => [record, ...prev]);
      // Clean URL
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/deposit");
      }
    } else if (status === "cancelled") {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/deposit");
      }
    }
  }, []);

  const handleDeposit = useCallback(async () => {
    if (effectiveAmount <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setLoading(true);
    setError(null);
    setCheckoutUrl(null);

    try {
      const result = await createCheckoutSession({ data: { amount: effectiveAmount } });
      setStripeMode(result.mode);

      if (result.url) {
        setCheckoutUrl(result.url);
        // Auto-redirect to Stripe Checkout
        if (typeof window !== "undefined") {
          window.location.href = result.url;
        }
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setStripeMode("unavailable");
    } finally {
      setLoading(false);
    }
  }, [effectiveAmount]);

  return (
    <div className="min-h-dvh pt-20 pb-12 px-4 sm:px-6">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <span className="text-5xl mb-4 block">💳</span>
          <h1 className="text-3xl font-black text-white mb-2">Deposit Funds</h1>
          <p className="text-gray-400">
            Add funds to your HSMC balance via credit or debit card.
            Powered by Stripe — secure and instant.
          </p>
        </div>

        {/* Stripe Unavailable Banner */}
        {stripeMode === "unavailable" && (
          <div className="glass-card border border-accent-yellow/40 bg-accent-yellow/5 p-4 mb-6 flex items-start gap-3 animate-fade-in">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-accent-yellow">
                Stripe Not Configured
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                The <code className="text-accent-blue bg-dark-hover px-1 py-0.5 rounded text-[0.7rem]">STRIPE_SECRET_KEY</code>{" "}
                environment variable is not set. This deposit page is ready for production —{" "}
                set the key to enable live payments.
              </p>
            </div>
          </div>
        )}

        {/* Amount Selector */}
        <div className="glass-card p-6 mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-3">
            Select Amount ({CURRENCY})
          </label>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {PRESET_AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => { setAmount(a); setCustomMode(false); }}
                className={`glass-button py-3 text-sm font-semibold transition-all rounded-lg ${
                  amount === a && !customMode
                    ? "bg-accent-blue/20 border-accent-blue text-white shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                    : "text-gray-400 hover:text-white border-dark-border"
                }`}
              >
                ${a.toLocaleString()}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setCustomMode(!customMode); setError(null); }}
            className="text-sm text-accent-cyan hover:text-white transition-colors mb-3"
          >
            {customMode ? "← Use preset amounts" : "Enter custom amount"}
          </button>
          {customMode && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-gray-400 font-medium text-lg">$</span>
              <input
                type="number"
                min={1}
                value={customAmount}
                onChange={(e) => { setCustomAmount(e.target.value); setError(null); }}
                className="glass-input flex-1 px-4 py-3 rounded-md text-white text-lg"
                placeholder="0.00"
              />
              <span className="text-gray-400 font-medium">{CURRENCY}</span>
            </div>
          )}
        </div>

        {/* Payment Action */}
        <div className="glass-card p-6 mb-6 text-center">
          <p className="text-gray-300 mb-2">
            You are about to deposit{" "}
            <span className="text-white font-bold text-xl">
              ${effectiveAmount.toLocaleString()} {CURRENCY}
            </span>
          </p>
          <p className="text-gray-500 text-sm mb-6">
            You will be redirected to Stripe's secure checkout page to complete
            your payment. Your card details are handled entirely by Stripe —
            we never see them.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-accent-red/10 border border-accent-red/30 rounded-lg text-sm text-accent-red">
              {error}
            </div>
          )}

          <button
            onClick={handleDeposit}
            disabled={loading || effectiveAmount <= 0}
            className="glass-button inline-flex items-center gap-2 px-8 py-4 bg-green-600/20 border-green-500 text-green-300 hover:bg-green-600/40 text-lg font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="animate-spin">⟳</span>
                Redirecting...
              </>
            ) : (
              <>
                <span>🔒</span>
                Pay with Card
                <span>→</span>
              </>
            )}
          </button>

          {checkoutUrl && (
            <p className="text-gray-500 text-xs mt-4">
              If not redirected,{" "}
              <a href={checkoutUrl} className="text-accent-cyan hover:underline">
                click here
              </a>{" "}
              to complete your payment.
            </p>
          )}
        </div>

        {/* Transaction History */}
        {txHistory.length > 0 && (
          <div className="glass-card p-6 mb-6">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <span>📋</span> Recent Deposits
            </h3>
            <div className="space-y-2">
              {txHistory.map((tx, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 border-b border-dark-border last:border-0"
                >
                  <div>
                    <p className="text-sm text-white font-medium">
                      ${tx.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(tx.date).toLocaleString()} · {tx.id}
                    </p>
                  </div>
                  <span
                    className={`badge text-xs ${
                      tx.status === "completed"
                        ? "badge-green"
                        : tx.status === "pending"
                        ? "badge-yellow"
                        : "badge-red"
                    }`}
                  >
                    {tx.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="glass-card p-4 text-sm text-gray-400">
          <p className="flex items-center gap-2 mb-2">
            <span>🛡️</span>
            Secured by Stripe · PCI DSS Level 1 compliant
          </p>
          <p className="flex items-center gap-2 mb-2">
            <span>⚡</span>
            Funds appear in your balance within minutes
          </p>
          <p className="flex items-center gap-2">
            <span>🦚</span>
            After payment, check your balance on the{" "}
            <Link to="/portfolio" className="text-accent-cyan hover:underline">
              Portfolio
            </Link>{" "}
            page
          </p>
        </div>
      </div>
    </div>
  );
}
