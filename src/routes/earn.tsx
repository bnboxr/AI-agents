import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "~/lib/demo-wagmi";
import {
  getActiveAirdrops,
  getAirdropState,
  addWallet,
  removeWallet,
  pauseWallet,
  checkEligibility,
  recordClaim,
  type Airdrop,
  type FarmedWallet,
  type AirdropFarmingState,
} from "~/lib/airdrop-farmer";

export const Route = createFileRoute("/earn")({
  loader: async () => {
    const [airdrops, state] = await Promise.all([
      getActiveAirdrops(),
      Promise.resolve(getAirdropState()),
    ]);
    return { airdrops, state };
  },
  component: EarnPage,
});

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  upcoming: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  claimable: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  ended: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const CATEGORY_ICONS: Record<string, string> = {
  defi: "💰",
  l2: "⚡",
  infra: "🔗",
  nft: "🎨",
  gaming: "🎮",
  wallet: "👛",
  other: "📦",
};

function EarnPage() {
  const { address, isConnected } = useAccount();
  const { airdrops: initialAirdrops, state: initialState } = Route.useLoaderData();
  const [airdrops, setAirdrops] = useState<Airdrop[]>(initialAirdrops);
  const [state, setState] = useState<AirdropFarmingState>(initialState);
  const [loading, setLoading] = useState(false);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddWallet, setShowAddWallet] = useState(false);

  // New wallet form
  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [newWalletLabel, setNewWalletLabel] = useState("");
  const [newWalletChain, setNewWalletChain] = useState("ethereum");

  // Claim form
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimAmount, setClaimAmount] = useState("");
  const [claimTxHash, setClaimTxHash] = useState("");

  // Refresh
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const fresh = await getActiveAirdrops();
        setAirdrops(fresh);
        setState(getAirdropState());
      } catch { /* keep stale */ }
    }, 120_000); // 2 min
    return () => clearInterval(interval);
  }, []);

  const handleCheckEligibility = useCallback(async () => {
    setEligibilityLoading(true);
    try {
      const results = await checkEligibility();
      setState(getAirdropState());
      // Refresh airdrops
      const fresh = await getActiveAirdrops();
      setAirdrops(fresh);
    } catch (err) {
      console.warn("Eligibility check failed:", err);
    }
    setEligibilityLoading(false);
  }, []);

  const handleAddWallet = () => {
    if (!newWalletAddress.trim()) return;
    addWallet(newWalletAddress.trim(), newWalletLabel || undefined, newWalletChain);
    setNewWalletAddress("");
    setNewWalletLabel("");
    setState(getAirdropState());
    setShowAddWallet(false);
  };

  const handleRemoveWallet = (addr: string) => {
    removeWallet(addr);
    setState(getAirdropState());
  };

  const handlePauseWallet = (addr: string) => {
    pauseWallet(addr);
    setState(getAirdropState());
  };

  const handleRecordClaim = (walletAddress: string, airdropId: string) => {
    const amount = parseFloat(claimAmount);
    const airdrop = airdrops.find(a => a.id === airdropId);
    if (!airdrop || isNaN(amount) || !claimTxHash.trim()) return;
    recordClaim(walletAddress, airdropId, amount, amount * (airdrop.estimatedValue > 0 ? airdrop.estimatedValue / 1000 : 1), claimTxHash.trim());
    setClaiming(null);
    setClaimAmount("");
    setClaimTxHash("");
    setState(getAirdropState());
  };

  // Filters
  const filteredAirdrops = airdrops.filter(a => {
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    if (filterCategory !== "all" && a.category !== filterCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match = a.protocol.toLowerCase().includes(q) ||
        a.token.toLowerCase().includes(q) ||
        a.chain.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const categories = [...new Set(airdrops.map(a => a.category))];

  const fmtUSD = (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` :
    n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` :
    `$${n.toFixed(2)}`;

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <section className="animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
                <span>🪂</span> Airdrop Farmer
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Track active airdrops, check wallet eligibility, and manage multi-wallet farming
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{airdrops.length} airdrops tracked</span>
              <span className="text-xs text-accent-green">● Live</span>
            </div>
          </div>
        </section>

        {/* Stats Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-white text-mono">{state.farmedWallets.length}</p>
            <p className="text-xs text-gray-400 mt-1">Wallets</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-blue text-mono">
              {airdrops.filter(a => a.status === "active" || a.status === "claimable").length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Active Airdrops</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-green text-mono">{fmtUSD(state.totalClaimedValue)}</p>
            <p className="text-xs text-gray-400 mt-1">Total Claimed</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-accent-yellow text-mono">{fmtUSD(state.totalPendingValue)}</p>
            <p className="text-xs text-gray-400 mt-1">Pending Claims</p>
          </div>
        </section>

        {/* Wallets Section */}
        <section className="animate-fade-in-up">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <span className="text-accent-blue">▸</span> Farmed Wallets ({state.farmedWallets.length})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleCheckEligibility}
                disabled={eligibilityLoading || state.farmedWallets.length === 0}
                className="glass-button px-3 py-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-40"
              >
                {eligibilityLoading ? "Checking..." : "🔍 Check Eligibility"}
              </button>
              <button
                onClick={() => setShowAddWallet(!showAddWallet)}
                className="glass-button px-3 py-1.5 text-xs bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue/20"
              >
                + Add Wallet
              </button>
            </div>
          </div>

          {showAddWallet && (
            <div className="glass-card p-4 mb-3 animate-fade-in-up">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Wallet address (0x...)"
                  value={newWalletAddress}
                  onChange={e => setNewWalletAddress(e.target.value)}
                  className="glass-input flex-1 min-w-[200px] px-3 py-2 rounded-lg text-white text-sm font-mono"
                />
                <input
                  type="text"
                  placeholder="Label (optional)"
                  value={newWalletLabel}
                  onChange={e => setNewWalletLabel(e.target.value)}
                  className="glass-input w-32 px-3 py-2 rounded-lg text-white text-sm"
                />
                <select
                  value={newWalletChain}
                  onChange={e => setNewWalletChain(e.target.value)}
                  className="glass-input px-3 py-2 rounded-lg text-white text-sm"
                >
                  <option value="ethereum">Ethereum</option>
                  <option value="arbitrum">Arbitrum</option>
                  <option value="optimism">Optimism</option>
                  <option value="base">Base</option>
                  <option value="polygon">Polygon</option>
                  <option value="solana">Solana</option>
                </select>
                <button onClick={handleAddWallet} className="glass-button px-4 py-2 bg-accent-green/20 border-accent-green/30 text-accent-green text-sm">
                  Add
                </button>
              </div>
            </div>
          )}

          {state.farmedWallets.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-gray-400 text-lg mb-2">No wallets added yet</p>
              <p className="text-gray-500 text-sm">
                Add wallets to start farming airdrops. Use the "Add Wallet" button above.
              </p>
              <p className="text-gray-500 text-xs mt-2">
                Tip: Connect from navbar to auto-add your connected wallet
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {state.farmedWallets.map(wallet => {
                const claimableCount = wallet.eligibleAirdrops.filter(e => !e.claimed).length;
                const claimedCount = wallet.eligibleAirdrops.filter(e => e.claimed).length;
                return (
                  <div key={wallet.address} className={`glass-card p-4 ${wallet.status === "paused" ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-bold text-white">{wallet.label}</p>
                        <p className="text-xs text-gray-400 font-mono truncate max-w-[200px]">{wallet.address}</p>
                      </div>
                      <span className={`text-[0.6rem] px-2 py-0.5 rounded-full border ${wallet.status === "active" ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-gray-500/10 text-gray-400 border-gray-500/30"}`}>
                        {wallet.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">
                        {claimableCount} pending · {claimedCount} claimed
                      </span>
                      <span className="text-accent-green font-medium">{fmtUSD(wallet.totalClaimed)} claimed</span>
                    </div>
                    {wallet.eligibleAirdrops.filter(e => !e.claimed).length > 0 && (
                      <div className="mt-2 pt-2 border-t border-dark-border">
                        <p className="text-xs text-gray-400 mb-1">Claimable:</p>
                        {wallet.eligibleAirdrops.filter(e => !e.claimed).slice(0, 3).map(e => {
                          const ad = airdrops.find(a => a.id === e.airdropId);
                          return (
                            <div key={e.airdropId} className="flex items-center justify-between text-xs py-1">
                              <span className="text-white">{ad?.protocol ?? e.airdropId}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-accent-yellow">{ad ? fmtUSD(ad.estimatedValue) : "?"}</span>
                                <button
                                  onClick={() => setClaiming(`${wallet.address}:${e.airdropId}`)}
                                  className="text-[0.6rem] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20 hover:bg-accent-blue/20"
                                >
                                  Claim
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {wallet.eligibleAirdrops.filter(e => !e.claimed).length > 3 && (
                          <p className="text-xs text-gray-500 mt-1">+{wallet.eligibleAirdrops.filter(e => !e.claimed).length - 3} more</p>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handlePauseWallet(wallet.address)}
                        className="text-[0.6rem] text-gray-400 hover:text-white transition-colors"
                      >
                        {wallet.status === "active" ? "⏸ Pause" : "▶ Resume"}
                      </button>
                      <button
                        onClick={() => handleRemoveWallet(wallet.address)}
                        className="text-[0.6rem] text-red-400 hover:text-red-300 transition-colors"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Claim Modal */}
          {claiming && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="glass-card p-6 max-w-md w-full mx-4 animate-fade-in-up">
                <h3 className="text-lg font-bold text-white mb-4">Record Claim</h3>
                <div className="space-y-3">
                  <p className="text-sm text-gray-400">
                    {airdrops.find(a => a.id === claiming.split(":")[1])?.protocol ?? "Unknown"} —{" "}
                    {airdrops.find(a => a.id === claiming.split(":")[1])?.token ?? "TBA"}
                  </p>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Token Amount</label>
                    <input
                      type="number"
                      value={claimAmount}
                      onChange={e => setClaimAmount(e.target.value)}
                      placeholder="0.0"
                      className="glass-input w-full px-3 py-2 rounded-lg text-white text-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Transaction Hash</label>
                    <input
                      type="text"
                      value={claimTxHash}
                      onChange={e => setClaimTxHash(e.target.value)}
                      placeholder="0x..."
                      className="glass-input w-full px-3 py-2 rounded-lg text-white text-mono text-xs"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setClaiming(null)}
                      className="flex-1 glass-button py-2 text-gray-400"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        const [walletAddr, airdropId] = claiming.split(":");
                        handleRecordClaim(walletAddr, airdropId);
                      }}
                      disabled={!claimAmount || !claimTxHash.trim()}
                      className="flex-1 glass-button py-2 bg-accent-green/20 border-accent-green/30 text-accent-green disabled:opacity-40"
                    >
                      Confirm Claim
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Airdrops Table */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-green">▸</span> Active Airdrops
          </h2>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="glass-input px-3 py-1.5 rounded-lg text-xs text-gray-300"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="claimable">Claimable</option>
              <option value="upcoming">Upcoming</option>
              <option value="ended">Ended</option>
            </select>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="glass-input px-3 py-1.5 rounded-lg text-xs text-gray-300"
            >
              <option value="all">All Categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{CATEGORY_ICONS[c] ?? ""} {c}</option>
              ))}
            </select>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="glass-input px-3 py-1.5 rounded-lg text-xs text-gray-300 w-40"
            />
            <span className="text-xs text-gray-500 ml-auto">{filteredAirdrops.length} results</span>
          </div>

          <div className="glass-card overflow-hidden">
            {airdrops.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400">Loading airdrop data...</p>
              </div>
            ) : filteredAirdrops.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400">No airdrops match your filters</p>
                <p className="text-xs text-gray-500 mt-1">Try adjusting the filters above</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-dark-border text-gray-400">
                      <th className="text-left py-3 px-4 font-medium">Protocol</th>
                      <th className="text-left py-3 px-4 font-medium">Token</th>
                      <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">Chain</th>
                      <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Category</th>
                      <th className="text-center py-3 px-4 font-medium">Status</th>
                      <th className="text-right py-3 px-4 font-medium">Est. Value</th>
                      <th className="text-right py-3 px-4 font-medium hidden sm:table-cell">Total</th>
                      <th className="text-center py-3 px-4 font-medium">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAirdrops.map(a => (
                      <tr key={a.id} className="border-b border-dark-border hover:bg-dark-hover transition-colors">
                        <td className="py-3 px-4">
                          <span className="text-white font-medium">{a.protocol}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-200">{a.token}</td>
                        <td className="py-3 px-4 text-gray-400 capitalize hidden sm:table-cell">{a.chain}</td>
                        <td className="py-3 px-4 text-gray-400 hidden md:table-cell">
                          {CATEGORY_ICONS[a.category] ?? ""} {a.category}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-[0.6rem] px-2 py-0.5 rounded-full border ${STATUS_COLORS[a.status] ?? ""}`}>
                            {a.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-accent-green font-bold">
                          {a.estimatedValue > 0 ? fmtUSD(a.estimatedValue) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-400 hidden sm:table-cell">
                          {a.totalValue > 0 ? fmtUSD(a.totalValue) : "—"}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:text-accent-cyan text-xs transition-colors">
                            Site ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Claims History */}
        {state.claims.length > 0 && (
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-yellow">▸</span> Claims History
            </h2>
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-dark-border text-gray-400">
                      <th className="text-left py-2 px-4 font-medium">Protocol</th>
                      <th className="text-right py-2 px-4 font-medium">Amount</th>
                      <th className="text-right py-2 px-4 font-medium">Value</th>
                      <th className="text-left py-2 px-4 font-medium hidden sm:table-cell">Tx Hash</th>
                      <th className="text-right py-2 px-4 font-medium hidden md:table-cell">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.claims.slice(-10).reverse().map(c => (
                      <tr key={c.id} className="border-b border-dark-border hover:bg-dark-hover">
                        <td className="py-2 px-4">
                          <span className="text-white">{c.protocol}</span>
                          <span className="text-gray-400 ml-1">({c.token})</span>
                        </td>
                        <td className="py-2 px-4 text-right text-gray-200 font-mono text-[0.65rem]">{c.amount.toLocaleString()}</td>
                        <td className="py-2 px-4 text-right text-accent-green font-bold">{fmtUSD(c.valueUsd)}</td>
                        <td className="py-2 px-4 text-gray-400 font-mono text-[0.6rem] hidden sm:table-cell truncate max-w-[120px]">{c.txHash}</td>
                        <td className="py-2 px-4 text-right text-gray-400 hidden md:table-cell">{fmtDate(c.claimedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Info */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-white mb-3">How Airdrop Farming Works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-gray-400">
              <div>
                <p className="text-accent-cyan font-medium mb-1">1. Add Wallets</p>
                <p>Add the wallet addresses you want to farm with. Each wallet tracks its own eligibility separately.</p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">2. Check Eligibility</p>
                <p>We check each wallet against active airdrops using on-chain activity heuristics and protocol APIs.</p>
              </div>
              <div>
                <p className="text-accent-cyan font-medium mb-1">3. Claim & Track</p>
                <p>Record claims with transaction hashes. Track total claimed value and pending claims across all wallets.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
