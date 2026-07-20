import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useBalance } from "wagmi";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
});

// ── Vault Tier Configuration ──────────────────────────────────────

interface VaultTier {
  id: string;
  name: string;
  lockDays: number;
  apy: number;
  penalty: number; // early withdrawal penalty %
  color: string;
}

const TIERS: VaultTier[] = [
  { id: 'flex', name: 'Flex', lockDays: 0, apy: 2.5, penalty: 0, color: '#3b82f6' },
  { id: '30d', name: '30 Days', lockDays: 30, apy: 5.5, penalty: 5, color: '#06b6d4' },
  { id: '90d', name: '90 Days', lockDays: 90, apy: 8.5, penalty: 10, color: '#14b8a6' },
  { id: '365d', name: '365 Days', lockDays: 365, apy: 13.0, penalty: 20, color: '#22c55e' },
];

const SUPPORTED_TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'USDT', name: 'Tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'DAI', name: 'Dai', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  { symbol: 'ETH', name: 'Ether', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18 },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
];

interface VaultDeposit {
  id: string;
  token: typeof SUPPORTED_TOKENS[0];
  amount: number;
  tier: VaultTier;
  timestamp: number;
  unlockTime: number;
  rewards: number;
}

function VaultPage() {
  const { address, isConnected } = useAccount();
  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0]);
  const [selectedTier, setSelectedTier] = useState<VaultTier>(TIERS[1]);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [deposits, setDeposits] = useState<VaultDeposit[]>([]);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const totalDeposited = useMemo(() => deposits.reduce((sum, d) => sum + d.amount, 0), [deposits]);
  const totalRewards = useMemo(() => deposits.reduce((sum, d) => sum + d.rewards, 0), [deposits]);

  const handleDeposit = async () => {
    if (!depositAmount || !isConnected) return;
    setDepositing(true);

    await new Promise(r => setTimeout(r, 2000));

    const amount = parseFloat(depositAmount);
    const now = Date.now();
    const deposit: VaultDeposit = {
      id: `dep-${now}-${Math.random().toString(36).slice(2, 6)}`,
      token: selectedToken,
      amount,
      tier: selectedTier,
      timestamp: now,
      unlockTime: now + selectedTier.lockDays * 86_400_000,
      rewards: 0,
    };

    setDeposits(prev => [deposit, ...prev]);
    setDepositAmount("");
    setDepositing(false);
  };

  const handleWithdraw = async (depositId: string) => {
    setWithdrawingId(depositId);
    await new Promise(r => setTimeout(r, 2000));
    setDeposits(prev => prev.filter(d => d.id !== depositId));
    setWithdrawingId(null);
  };

  // Simulate real-time reward accumulation
  useEffect(() => {
    const interval = setInterval(() => {
      setDeposits(prev => prev.map(d => {
        const elapsed = (Date.now() - d.timestamp) / (365 * 86_400_000);
        const reward = d.amount * (d.tier.apy / 100) * elapsed;
        return { ...d, rewards: Math.round(reward * 1e6) / 1e6 };
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const fmtAPY = (n: number) => `${n.toFixed(1)}%`;
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeLeft = (unlockTime: number) => {
    const diff = unlockTime - Date.now();
    if (diff <= 0) return "Unlocked";
    const days = Math.ceil(diff / 86_400_000);
    return `${days}d left`;
  };

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ─────────────────────────────────────────── */}
        <section className="animate-fade-in">
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
            <span>🏦</span> HSMCVault
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Depune orice token și crește automat cu compound și rebalansare automată
          </p>
        </section>

        {/* ── Vault Stats ────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up">
          <StatCard label="Total Deposited" value={fmtUSD(totalDeposited)} icon="💰" />
          <StatCard label="Total Rewards" value={fmtUSD(totalRewards)} icon="✨" positive={totalRewards > 0} />
          <StatCard label="Active Deposits" value={deposits.length.toString()} icon="📦" />
          <StatCard label="Auto-Compound" value="Enabled" icon="🔄" positive={true} />
        </section>

        {/* ── Tiers ──────────────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Time-Locked Tiers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TIERS.map((tier) => (
              <button
                key={tier.id}
                onClick={() => setSelectedTier(tier)}
                className={`card p-4 text-left transition-all duration-200 ${
                  selectedTier.id === tier.id ? 'border-accent-blue bg-dark-hover scale-[1.02]' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-white">{tier.name}</span>
                  <span className="text-xs text-gray-400">
                    {tier.lockDays === 0 ? 'No lock' : `${tier.lockDays}d lock`}
                  </span>
                </div>
                <p className="text-2xl font-bold text-mono" style={{ color: tier.color }}>
                  {fmtAPY(tier.apy)}
                </p>
                <p className="text-xs text-gray-400 mt-1">APY</p>
                {tier.penalty > 0 && (
                  <p className="text-xs text-accent-red mt-2">
                    {tier.penalty}% early withdrawal penalty
                  </p>
                )}
                {tier.id === 'flex' && (
                  <p className="text-xs text-accent-green mt-2">No penalty — withdraw anytime</p>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* ── Deposit Panel ──────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-6 max-w-xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <span>📥</span> Deposit
            </h3>

            <div className="space-y-4">
              {/* Token Select */}
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Token</label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {SUPPORTED_TOKENS.map((token) => (
                    <button
                      key={token.symbol}
                      onClick={() => setSelectedToken(token)}
                      className={`py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                        selectedToken.symbol === token.symbol
                          ? 'bg-accent-blue text-white'
                          : 'card text-gray-300 hover:text-white'
                      }`}
                    >
                      {token.symbol}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Amount</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder={`0.0 ${selectedToken.symbol}`}
                    className="glass-input flex-1 text-mono"
                  />
                </div>
              </div>

              {/* Selected Tier */}
              <div className="glass-card p-3 flex items-center justify-between">
                <span className="text-sm text-gray-300">Selected Tier:</span>
                <span className="text-sm font-bold text-white">
                  {selectedTier.name} — {fmtAPY(selectedTier.apy)}
                </span>
              </div>

              {/* Estimated Rewards */}
              {depositAmount && (
                <div className="glass-card p-3 bg-accent-green/5 border-accent-green/20">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Estimated yearly reward:</span>
                    <span className="text-accent-green text-mono-sm font-bold">
                      {(parseFloat(depositAmount) * selectedTier.apy / 100).toFixed(4)} {selectedToken.symbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-gray-400">Unlock date:</span>
                    <span className="text-gray-300 text-mono-sm">
                      {selectedTier.lockDays === 0 ? 'Immediately' : fmtDate(Date.now() + selectedTier.lockDays * 86_400_000)}
                    </span>
                  </div>
                </div>
              )}

              {/* Deposit Button */}
              <button
                onClick={handleDeposit}
                disabled={!depositAmount || !isConnected || depositing}
                className="w-full glass-button disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {!isConnected
                  ? "Conectează wallet-ul"
                  : depositing
                  ? "Depunere în curs..."
                  : `Deposit ${selectedToken.symbol}`}
              </button>
            </div>
          </div>
        </section>

        {/* ── My Deposits ────────────────────────────────────── */}
        {deposits.length > 0 && (
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-green">▸</span> My Deposits
            </h2>
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-dark-border text-gray-400">
                      <th className="text-left py-3 px-4 font-medium">Token</th>
                      <th className="text-left py-3 px-4 font-medium">Amount</th>
                      <th className="text-left py-3 px-4 font-medium">Tier</th>
                      <th className="text-right py-3 px-4 font-medium">APY</th>
                      <th className="text-right py-3 px-4 font-medium hidden sm:table-cell">Rewards</th>
                      <th className="text-right py-3 px-4 font-medium hidden md:table-cell">Unlock</th>
                      <th className="text-center py-3 px-4 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((dep) => (
                      <tr key={dep.id} className="border-b border-dark-border hover:bg-dark-hover transition-colors">
                        <td className="py-3 px-4">
                          <span className="text-white font-medium">{dep.token.symbol}</span>
                        </td>
                        <td className="py-3 px-4 text-mono-sm text-gray-200">
                          {dep.amount.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-gray-300">{dep.tier.name}</td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-mono-sm font-bold" style={{ color: dep.tier.color }}>
                            {fmtAPY(dep.tier.apy)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-mono-sm text-accent-green hidden sm:table-cell">
                          +{dep.rewards.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-400 hidden md:table-cell">
                          {dep.tier.lockDays === 0 ? (
                            <span className="text-accent-green">Any time</span>
                          ) : (
                            <span>{timeLeft(dep.unlockTime)}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleWithdraw(dep.id)}
                            disabled={withdrawingId === dep.id}
                            className="px-3 py-1 rounded-lg text-xs bg-accent-red/10 text-accent-red border border-accent-red/20 hover:bg-accent-red/20 transition-colors disabled:opacity-40"
                          >
                            {withdrawingId === dep.id ? "..." : "Withdraw"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ── Contract Info ──────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
              <span>📜</span> HSMCVault Contract
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-gray-400">Contract:</span>
                <p className="text-mono-sm text-gray-200 mt-0.5">src/contracts/HSMCVault.sol</p>
              </div>
              <div>
                <span className="text-gray-400">Performance Fee:</span>
                <p className="text-mono-sm text-gray-200 mt-0.5">1%</p>
              </div>
              <div>
                <span className="text-gray-400">Auto-Compound:</span>
                <p className="text-mono-sm text-accent-green mt-0.5">✓ Enabled</p>
              </div>
              <div>
                <span className="text-gray-400">Auto-Rebalance:</span>
                <p className="text-mono-sm text-accent-green mt-0.5">✓ Between AAVE/Compound/Lido</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, positive }: { label: string; value: string; icon: string; positive?: boolean }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={`text-xl font-bold text-mono ${positive === true ? 'text-accent-green' : positive === false ? 'text-accent-red' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}
