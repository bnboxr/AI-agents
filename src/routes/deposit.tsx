import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/deposit")({
  component: DepositPage,
});

const QUICK_AMOUNTS = [50, 100, 200, 500];
const STRIPE_LINK = "https://buy.stripe.com/6oU14n6wtfxNdwh5hJfbq00";

export default function DepositPage() {
  const [amount, setAmount] = useState(50);
  const [customMode, setCustomMode] = useState(false);

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

        {/* Amount Selector */}
        <div className="glass-card p-6 mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-3">
            Select Amount (RON)
          </label>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => { setAmount(a); setCustomMode(false); }}
                className={`glass-button py-3 text-sm font-semibold transition-all ${
                  amount === a && !customMode
                    ? "bg-accent-blue/20 border-accent-blue text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {a} RON
              </button>
            ))}
          </div>
          <button
            onClick={() => setCustomMode(!customMode)}
            className="text-sm text-accent-cyan hover:text-white transition-colors mb-3"
          >
            {customMode ? "← Use preset amounts" : "Enter custom amount"}
          </button>
          {customMode && (
            <div className="flex items-center gap-2 mb-4">
              <input
                type="number"
                min={10}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="glass-input flex-1 px-4 py-3 rounded-md text-white text-lg"
                placeholder="Amount in RON"
              />
              <span className="text-gray-400 font-medium">RON</span>
            </div>
          )}
        </div>

        {/* Stripe Payment */}
        <div className="glass-card p-6 mb-6 text-center">
          <p className="text-gray-300 mb-2">
            You are about to deposit{" "}
            <span className="text-white font-bold text-xl">{amount} RON</span>
          </p>
          <p className="text-gray-500 text-sm mb-6">
            You will be redirected to Stripe's secure checkout page to complete
            your payment. Your card details are handled entirely by Stripe —
            we never see them.
          </p>
          <a
            href={STRIPE_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-button inline-flex items-center gap-2 px-8 py-4 bg-green-600/20 border-green-500 text-green-300 hover:bg-green-600/40 text-lg font-bold rounded-xl transition-all"
          >
            <span>🔒</span>
            Pay with Card
            <span>→</span>
          </a>
          <p className="text-gray-500 text-xs mt-4">
            Fixed 50 RON deposits. Custom amounts coming soon.
          </p>
        </div>

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
