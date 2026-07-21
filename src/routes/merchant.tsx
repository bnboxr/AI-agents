/**
 * Platform Treasury — Payment history & master wallet management
 *
 * Shows all payments received, total revenue, on-chain balances.
 * Only the platform owner can withdraw funds from the master wallet.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "~/lib/demo-wagmi";
import {
  getAllPayments,
  getPlatformBalances,
  POS_CONTRACT_ADDRESS,
  POS_OWNER_ADDRESS,
  PAYMENT_SETTLEMENT_ABI,
  type PaymentRecord,
  type TokenBalance,
} from "~/lib/pos-service";

interface TreasuryData {
  payments: PaymentRecord[];
  stats: {
    totalPayments: number;
    totalRevenue: number;
    confirmedPayments: number;
    pendingPayments: number;
  };
}

export const Route = createFileRoute("/merchant")({
  component: PlatformTreasury,
});

function PlatformTreasury() {
  const { address, isConnected } = useAccount();
  const [data, setData] = useState<TreasuryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "confirmed" | "pending">("all");
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [ownerAddress, setOwnerAddress] = useState<string>("");
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawTxId, setWithdrawTxId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const isOwner = isConnected && address && ownerAddress &&
    address.toLowerCase() === ownerAddress.toLowerCase();

  // Fetch owner from contract
  useEffect(() => {
    fetchOwner();
  }, []);

  const fetchOwner = async () => {
    try {
      const { createPublicClient, http } = await import("viem");
      const { polygonAmoy, polygon: polygonMainnet } = await import("viem/chains");
      const chain =
        (typeof process !== "undefined" && process.env?.VITE_POS_NETWORK) === "mainnet"
          ? polygonMainnet
          : polygonAmoy;
      const rpcUrl =
        (typeof process !== "undefined" && process.env?.VITE_POLYGON_RPC) ||
        "https://polygon-amoy.g.alchemy.com/v2/demo";

      const client = createPublicClient({ chain, transport: http(rpcUrl) });
      const contractOwner = await client.readContract({
        address: POS_CONTRACT_ADDRESS as `0x${string}`,
        abi: PAYMENT_SETTLEMENT_ABI,
        functionName: "owner",
      }) as string;

      setOwnerAddress(contractOwner);
    } catch (err) {
      console.warn("[Treasury] Failed to fetch owner:", err);
      if (POS_OWNER_ADDRESS) setOwnerAddress(POS_OWNER_ADDRESS);
    }
  };

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payments = await getAllPayments(200);
      const confirmed = payments.filter((p) => p.status === "confirmed");
      setData({
        payments,
        stats: {
          totalPayments: payments.length,
          totalRevenue: confirmed.reduce((s, p) => s + p.amount, 0),
          confirmedPayments: confirmed.length,
          pendingPayments: payments.filter((p) => p.status === "pending").length,
        },
      });
    } catch (err) {
      console.warn("[Treasury] Fetch error:", err);
      setError("Failed to fetch payments");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const result = await getPlatformBalances();
      setBalances(result);
    } catch (err) {
      console.warn("[Treasury] Balance fetch error:", err);
    }
    setBalancesLoading(false);
  }, []);

  useEffect(() => {
    fetchBalances();
  }, []);

  const handleWithdraw = useCallback(
    async (tokenAddress: string, tokenSymbol: string, amount: bigint) => {
      if (!amount || amount <= 0n) return;
      if (!window.ethereum) {
        setWithdrawError("No wallet detected. Please install MetaMask.");
        return;
      }

      setWithdrawing(tokenSymbol);
      setWithdrawError(null);
      setWithdrawTxId(null);

      try {
        const { createWalletClient, custom } = await import("viem");
        const { polygonAmoy, polygon: polygonMainnet } = await import("viem/chains");

        const chain =
          (typeof process !== "undefined" && process.env?.VITE_POS_NETWORK) === "mainnet"
            ? polygonMainnet
            : polygonAmoy;

        const walletClient = createWalletClient({
          chain,
          transport: custom(window.ethereum),
        });

        const [account] = await walletClient.requestAddresses();

        const hash = await walletClient.writeContract({
          address: POS_CONTRACT_ADDRESS as `0x${string}`,
          abi: PAYMENT_SETTLEMENT_ABI,
          functionName: "withdraw",
          args: [tokenAddress as `0x${string}`, amount],
          account,
          chain,
        });

        setWithdrawTxId(hash);
        console.log(`[Treasury] Withdraw TX: ${hash}`);

        setTimeout(() => fetchBalances(), 5000);
      } catch (err: any) {
        console.warn("[Treasury] Withdraw error:", err);
        setWithdrawError(err?.message || "Withdraw failed");
      }

      setWithdrawing(null);
    },
    [fetchBalances]
  );

  const handleWithdrawAll = useCallback(
    async (tokenAddress: string, tokenSymbol: string) => {
      if (!window.ethereum) {
        setWithdrawError("No wallet detected. Please install MetaMask.");
        return;
      }

      setWithdrawing(tokenSymbol);
      setWithdrawError(null);
      setWithdrawTxId(null);

      try {
        const { createWalletClient, custom } = await import("viem");
        const { polygonAmoy, polygon: polygonMainnet } = await import("viem/chains");

        const chain =
          (typeof process !== "undefined" && process.env?.VITE_POS_NETWORK) === "mainnet"
            ? polygonMainnet
            : polygonAmoy;

        const walletClient = createWalletClient({
          chain,
          transport: custom(window.ethereum),
        });

        const [account] = await walletClient.requestAddresses();

        const hash = await walletClient.writeContract({
          address: POS_CONTRACT_ADDRESS as `0x${string}`,
          abi: PAYMENT_SETTLEMENT_ABI,
          functionName: "withdrawAll",
          args: [tokenAddress as `0x${string}`],
          account,
          chain,
        });

        setWithdrawTxId(hash);
        console.log(`[Treasury] WithdrawAll TX: ${hash}`);

        setTimeout(() => fetchBalances(), 5000);
      } catch (err: any) {
        console.warn("[Treasury] WithdrawAll error:", err);
        setWithdrawError(err?.message || "Withdraw failed");
      }

      setWithdrawing(null);
    },
    [fetchBalances]
  );

  const handleExportCSV = () => {
    if (!data?.payments.length) return;
    const headers = ["Date", "Session ID", "Amount (USD)", "Token", "Token Amount", "Status", "TX ID", "Payer"];
    const rows = data.payments.map((p) => [
      new Date(p.createdAt).toISOString(),
      p.sessionId,
      p.amount.toFixed(2),
      p.token,
      p.tokenAmount,
      p.status,
      p.txId || "",
      p.payerAddress || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `platform-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredPayments = data?.payments.filter((p) => {
    if (activeTab === "all") return true;
    return p.status === activeTab;
  }) || [];

  const dailyBreakdown = getDailyBreakdown(data?.payments || []);

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8 min-h-dvh">
      <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-[#e0e6ed] font-mono tracking-tight">
              <span className="text-[#00e676]">{">"}</span> Platform Treasury
            </h1>
            <p className="text-[#546e7a] text-sm mt-1 font-mono">
              Master wallet · All payments · Owner-only withdrawals
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchPayments} disabled={loading} className="glass-button text-xs px-4 py-2">
              {loading ? "⟳ Refreshing..." : "⟳ Refresh"}
            </button>
            <button onClick={handleExportCSV} disabled={!data?.payments.length} className="glass-button text-xs px-4 py-2">
              📥 Export CSV
            </button>
          </div>
        </div>

        {/* Owner indicator */}
        {isOwner && (
          <div className="glass-card p-3 border-[#00e676]/30 bg-[#00e676]/5">
            <p className="text-[#00e676] text-xs font-mono text-center">
              🔑 Connected as Owner — you can withdraw funds
            </p>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Revenue" value={`${data.stats.totalRevenue.toFixed(2)}`} icon="💰" positive />
            <StatCard label="Total Payments" value={String(data.stats.totalPayments)} icon="📊" positive />
            <StatCard label="Confirmed" value={String(data.stats.confirmedPayments)} icon="✅" positive />
            <StatCard label="Pending" value={String(data.stats.pendingPayments)} icon="⏳" positive={data.stats.pendingPayments === 0} />
          </div>
        )}

        {/* ── On-Chain Balances (Master Wallet) ───────────────────── */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[#546e7a] text-xs uppercase tracking-wider font-mono">
              💰 Master Wallet Balances
            </h3>
            <button
              onClick={fetchBalances}
              disabled={balancesLoading}
              className="glass-button text-xs px-3 py-1"
            >
              {balancesLoading ? "⟳" : "⟳ Refresh"}
            </button>
          </div>

          {withdrawTxId && (
            <div className="mb-3 p-2 bg-[#00e676]/10 border border-[#00e676]/30 rounded-lg">
              <p className="text-[#00e676] text-xs font-mono">
                ✅ Withdraw TX:{" "}
                <a
                  href={`https://polygonscan.com/tx/${withdrawTxId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00bcd4] hover:text-[#00e676] transition-colors"
                >
                  {withdrawTxId.slice(0, 10)}...
                </a>
              </p>
            </div>
          )}

          {withdrawError && (
            <div className="mb-3 p-2 bg-[#ff3d00]/10 border border-[#ff3d00]/30 rounded-lg">
              <p className="text-[#ff3d00] text-xs font-mono">{withdrawError}</p>
            </div>
          )}

          {balances.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {balances.map((b) => (
                <div
                  key={b.token}
                  className="bg-[#0a0d14] rounded-lg p-3 border border-[#1a1f2e]"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[#b0bec5] text-sm font-bold font-mono">
                      {b.token === "MATIC" ? "POL" : b.token}
                    </span>
                  </div>
                  <p className="text-[#00e676] text-lg font-black font-mono mb-2">
                    {b.formatted}
                  </p>
                  <div className="flex gap-1">
                    <button
                      onClick={() =>
                        handleWithdrawAll(b.tokenAddress, b.token)
                      }
                      disabled={
                        withdrawing === b.token ||
                        !isOwner ||
                        !b.balance ||
                        BigInt(b.balance) <= 0n
                      }
                      title={!isOwner ? "Only the platform owner can withdraw" : ""}
                      className={`flex-1 text-xs py-1.5 rounded font-mono font-bold transition-all ${
                        withdrawing === b.token
                          ? "bg-[#1a1f2e] text-[#546e7a] cursor-wait"
                          : !isOwner || !b.balance || BigInt(b.balance) <= 0n
                            ? "bg-[#1a1f2e] text-[#455a64] cursor-not-allowed"
                            : "bg-[#00e676]/10 border border-[#00e676]/30 text-[#00e676] hover:bg-[#00e676]/20 active:scale-95"
                      }`}
                    >
                      {withdrawing === b.token ? "⟳" : "Withdraw All"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : balancesLoading ? (
            <div className="text-center py-4">
              <div className="animate-spin text-lg mb-2">⟳</div>
              <p className="text-[#546e7a] text-xs font-mono">Loading balances...</p>
            </div>
          ) : (
            <p className="text-[#546e7a] text-xs font-mono text-center py-4">
              No balances to display.
            </p>
          )}
        </div>

        {dailyBreakdown.length > 0 && (
          <div className="glass-card p-4">
            <h3 className="text-[#546e7a] text-xs uppercase tracking-wider mb-3 font-mono">Per-Day Breakdown</h3>
            <div className="space-y-1">
              {dailyBreakdown.slice(0, 14).map((day) => (
                <div key={day.date} className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-[#0a0d14] transition-colors">
                  <span className="text-[#b0bec5] text-xs font-mono">{day.date}</span>
                  <div className="flex gap-4">
                    <span className="text-[#546e7a] text-xs font-mono">{day.count} txns</span>
                    <span className="text-[#00e676] text-xs font-mono font-semibold">${day.total.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="glass-card p-4 border-[#ff3d00]/30 bg-[#ff3d00]/5">
            <p className="text-[#ff3d00] text-sm font-mono text-center">{error}</p>
          </div>
        )}

        {data && (
          <div className="flex gap-2 border-b border-[#1a1f2e] pb-2">
            {(["all", "confirmed", "pending"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-t text-xs font-bold font-mono uppercase tracking-wider transition-colors ${
                  activeTab === tab
                    ? "text-[#00e676] border-b-2 border-[#00e676] -mb-[3px]"
                    : "text-[#546e7a] hover:text-[#b0bec5]"
                }`}
              >
                {tab}
                {tab === "all" && ` (${data.stats.totalPayments})`}
                {tab === "confirmed" && ` (${data.stats.confirmedPayments})`}
                {tab === "pending" && ` (${data.stats.pendingPayments})`}
              </button>
            ))}
          </div>
        )}

        {data && filteredPayments.length > 0 ? (
          <div className="glass-card overflow-x-auto">
            <table className="terminal-table w-full">
              <thead>
                <tr>
                  <th>Date</th><th>Amount</th><th>Token</th><th>Status</th><th>TX ID</th><th>Payer</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((p) => (
                  <tr key={p.sessionId}>
                    <td className="text-xs">{new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="terminal-number-positive font-semibold">${p.amount.toFixed(2)}</td>
                    <td><span className="badge-green text-[0.6rem]">{p.token === "MATIC" ? "POL" : p.token}</span></td>
                    <td>
                      <span className={`badge text-[0.6rem] ${p.status === "confirmed" ? "badge-green" : p.status === "pending" ? "badge-yellow" : "badge-red"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td>
                      {p.txId ? (
                        <a href={`https://polygonscan.com/tx/${p.txId}`} target="_blank" rel="noopener noreferrer" className="text-[#00bcd4] text-xs font-mono hover:text-[#00e676] transition-colors">
                          {p.txId.slice(0, 8)}...
                        </a>
                      ) : (
                        <span className="text-[#455a64] text-xs">—</span>
                      )}
                    </td>
                    <td>
                      {p.payerAddress ? (
                        <span className="text-[#546e7a] text-xs font-mono">{p.payerAddress.slice(0, 6)}...{p.payerAddress.slice(-4)}</span>
                      ) : (
                        <span className="text-[#455a64] text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data ? (
          <div className="glass-card p-12 text-center">
            <p className="text-[#546e7a] font-mono text-sm">No {activeTab !== "all" ? activeTab : ""} payments found</p>
          </div>
        ) : !loading && !error ? (
          <div className="glass-card p-12 text-center">
            <p className="text-[#546e7a] font-mono text-sm">Loading treasury data...</p>
          </div>
        ) : null}

        {loading && (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin text-2xl mb-2">⟳</div>
            <p className="text-[#b0bec5] font-mono text-sm">Loading payments...</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, positive }: { label: string; value: string; icon: string; positive: boolean }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[#546e7a] uppercase tracking-wider font-mono">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={`text-xl font-bold font-mono ${positive ? "text-[#00e676]" : "text-[#ffab00]"}`}>{value}</p>
    </div>
  );
}

function getDailyBreakdown(payments: PaymentRecord[]): { date: string; total: number; count: number }[] {
  const days = new Map<string, { total: number; count: number }>();
  for (const p of payments) {
    if (p.status !== "confirmed") continue;
    const date = new Date(p.createdAt).toISOString().slice(0, 10);
    const existing = days.get(date) || { total: 0, count: 0 };
    existing.total += p.amount;
    existing.count += 1;
    days.set(date, existing);
  }
  return Array.from(days.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
