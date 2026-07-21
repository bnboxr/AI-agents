/**
 * POSReceipt — Printable receipt component for crypto payments
 * Master wallet architecture — funds go to Platform Treasury
 */

import { type PaymentSession } from "~/lib/pos-service";

interface POSReceiptProps {
  session: PaymentSession;
  onClose?: () => void;
}

export default function POSReceipt({ session, onClose }: POSReceiptProps) {
  const date = new Date(session.confirmedAt || session.createdAt);
  const polygonScanBase =
    process.env.VITE_POS_NETWORK === "mainnet"
      ? "https://polygonscan.com"
      : "https://amoy.polygonscan.com";

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    try {
      const style = document.createElement("style");
      style.textContent = `
        @media print {
          body * { visibility: hidden; }
          #pos-receipt, #pos-receipt * { visibility: visible; }
          #pos-receipt { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `;
      document.head.appendChild(style);
      window.print();
      setTimeout(() => document.head.removeChild(style), 1000);
    } catch (err) {
      console.warn("[POS] PDF download error:", err);
    }
  };

  const tokenSymbol =
    session.token === "MATIC" ? "MATIC" : session.token;

  const explorerUrl = session.txId
    ? `${polygonScanBase}/tx/${session.txId}`
    : null;

  return (
    <div id="pos-receipt" className="glass-card p-6 max-w-md mx-auto font-mono text-sm">
      {/* Header */}
      <div className="text-center border-b border-[#1a1f2e] pb-4 mb-4">
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-[#00e676] font-black text-2xl">{">"}</span>
          <span className="text-[#e0e6ed] font-bold text-lg">PĂUN_AI POS</span>
        </div>
        <p className="text-[#546e7a] text-xs">
          Crypto Payment Receipt
        </p>
        <p className="text-[#00e676] text-xs mt-1 font-semibold">
          ✓ PAID
        </p>
      </div>

      {/* Settlement Info */}
      <div className="mb-4">
        <p className="text-[#546e7a] text-xs uppercase tracking-wider mb-1">
          Settlement
        </p>
        <p className="text-[#b0bec5] text-sm font-medium">
          Funds received by Platform Treasury
        </p>
        <p className="text-[#455a64] text-xs font-mono">
          Master Wallet · Polygon Network
        </p>
      </div>

      {/* Amount */}
      <div className="border-t border-b border-[#1a1f2e] py-4 my-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[#546e7a] text-xs uppercase">Amount (USD)</span>
          <span className="text-[#e0e6ed] text-xl font-bold">
            ${session.amount.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[#546e7a] text-xs uppercase">Amount ({tokenSymbol})</span>
          <span className="text-[#00e676] font-bold">
            {formatTokenAmount(session.tokenAmount, session.token)}
          </span>
        </div>
      </div>

      {/* Transaction Details */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between">
          <span className="text-[#546e7a] text-xs">Date</span>
          <span className="text-[#b0bec5] text-xs">{formatDate(date)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#546e7a] text-xs">Session ID</span>
          <span className="text-[#b0bec5] text-xs font-mono">{session.sessionId}</span>
        </div>
        {session.txId && (
          <div className="flex justify-between">
            <span className="text-[#546e7a] text-xs">TX ID</span>
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00bcd4] text-xs font-mono hover:text-[#00e676] transition-colors truncate max-w-[200px]"
              >
                {session.txId.slice(0, 10)}...{session.txId.slice(-6)}
              </a>
            ) : (
              <span className="text-[#b0bec5] text-xs font-mono">
                {session.txId.slice(0, 10)}...{session.txId.slice(-6)}
              </span>
            )}
          </div>
        )}
        {session.payerAddress && (
          <div className="flex justify-between">
            <span className="text-[#546e7a] text-xs">Payer</span>
            <span className="text-[#b0bec5] text-xs font-mono">
              {session.payerAddress.slice(0, 8)}...{session.payerAddress.slice(-6)}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[#1a1f2e] pt-4 text-center">
        <p className="text-[#00e676] text-xs font-semibold mb-2">
          ✅ Funds received by Platform Treasury
        </p>
        <p className="text-[#546e7a] text-xs mb-3">
          Settled on Polygon · {date.toISOString()}
        </p>
        <div className="flex gap-3 justify-center no-print">
          <button
            onClick={handlePrint}
            className="glass-button text-xs px-4 py-1.5"
          >
            🖨 Print
          </button>
          <button
            onClick={handleDownloadPDF}
            className="glass-button text-xs px-4 py-1.5"
          >
            📥 PDF
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="glass-button text-xs px-4 py-1.5 border-[#1a1f2e] text-[#546e7a]"
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTokenAmount(amount: string, token: "USDC" | "USDT" | "MATIC"): string {
  try {
    const val = BigInt(amount);
    const decimals = token === "MATIC" ? 18 : 6;
    const divisor = BigInt(10) ** BigInt(decimals);
    const intPart = val / divisor;
    const fracPart = val % divisor;

    if (fracPart === 0n) return intPart.toString();

    const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
    const displayFrac = fracStr.slice(0, 6);
    return `${intPart}.${displayFrac}`;
  } catch {
    return amount;
  }
}
