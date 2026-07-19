import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useBalance } from "wagmi";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import {
  getStakingProtocols,
  getStakingByChain,
  getBestAPYPerAsset,
  getAPYHistory,
} from "~/lib/staking";
import type { StakingProtocol, StakingChainGroup, StakingAPYHistory } from "~/lib/staking";
import { addNotification } from "~/lib/notifications";

export const Route = createFileRoute("/stake")({
  loader: async () => {
    const [protocols, byChain, bestAPY, apyHistory] = await Promise.all([
      getStakingProtocols(),
      getStakingByChain(),
      getBestAPYPerAsset(),
      getAPYHistory(),
    ]);
    return { protocols, byChain, bestAPY, apyHistory };
  },
  component: StakePage,
});

function StakePage() {
  const initial = Route.useLoaderData();
  const { isConnected } = useAccount();
  const [protocols, setProtocols] = useState(initial.protocols);
  const [byChain] = useState(initial.byChain);
  const [bestAPY] = useState(initial.bestAPY);
  const [apyHistory] = useState(initial.apyHistory);
  const [selectedChain, setSelectedChain] = useState<string>("all");
  const [stakeAmount, setStakeAmount] = useState("");
  const [selectedProtocol, setSelectedProtocol] = useState<StakingProtocol | null>(null);
  const [staking, setStaking] = useState(false);
  const [staked, setStaked] = useState(false);
  const [stakeTx, setStakeTx] = useState("");

  const chains = useMemo(() => {
    const unique = new Map<string, string>();
    protocols.forEach(p => unique.set(p.chain, p.chain.charAt(0).toUpperCase() + p.chain.slice(1)));
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name }));
  }, [protocols]);

  const filteredProtocols = useMemo(() => {
    if (selectedChain === "all") return protocols;
    return protocols.filter(p => p.chain === selectedChain);
  }, [protocols, selectedChain]);

  const selectedHistory = useMemo(() => {
    if (!selectedProtocol) return null;
    return apyHistory.find(h => h.protocolId === selectedProtocol.id);
  }, [selectedProtocol, apyHistory]);

  const bestProtocol = protocols[0];
  const allAssets = useMemo(() => Object.keys(bestAPY), [bestAPY]);

  const handleStake = async () => {
    if (!selectedProtocol || !stakeAmount) return;
    setStaking(true);
    
    // Simulate staking transaction - in production this would call the actual contract
    await new Promise(r => setTimeout(r, 2000));
    const txHash = `0x${Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    setStakeTx(txHash);
    setStaked(true);
    setStaking(false);

    // Send notification
    try {
      await addNotification({
        data: {
          title: "Staking executat",
          message: `${stakeAmount} ${selectedProtocol.asset} staked pe ${selectedProtocol.name} @ ${selectedProtocol.apy}% APY`,
          type: "success",
          chainId: selectedProtocol.chain,
        },
      });
    } catch { /* notification best-effort */ }
  };

  const handleUnstake = async () => {
    setStaking(true);
    await new Promise(r => setTimeout(r, 2000));
    const txHash = `0x${Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    setStakeTx("");
    setStaked(false);
    setStaking(false);
    setStakeAmount("");
  };

  const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const fmtAPY = (n: number) => `${n.toFixed(2)}%`;
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ─────────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
                <span>⚡</span> Staking Automat
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Detectează cele mai bune APY-uri și stake-uiește automat pe orice chain
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {protocols.length} protocoale • {chains.length} chain-uri
              </span>
            </div>
          </div>
        </section>

        {/* ── Best APY Per Asset ────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-green">▸</span> Best APY per Asset
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {allAssets.map((asset) => {
              const proto = bestAPY[asset];
              if (!proto) return null;
              return (
                <button
                  key={asset}
                  onClick={() => setSelectedProtocol(proto)}
                  className={`card p-4 text-left transition-all duration-200 ${
                    selectedProtocol?.id === proto.id ? 'border-accent-blue bg-dark-hover' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">{asset}</span>
                    <span className="badge-green text-[0.6rem]">Best</span>
                  </div>
                  <p className="text-lg font-bold text-accent-green text-mono">{fmtAPY(proto.apy)}</p>
                  <p className="text-xs text-gray-400 mt-1 truncate">{proto.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{proto.chain}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── APY Scanner Table ─────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <span className="text-accent-blue">▸</span> APY Scanner — Toate Protocoalele
            </h2>
            <select
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value)}
              className="glass-input py-1.5 px-3 text-sm text-gray-200 rounded-lg"
            >
              <option value="all">🌐 Toate chain-urile</option>
              {chains.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-gray-400">
                    <th className="text-left py-3 px-4 font-medium">Protocol</th>
                    <th className="text-left py-3 px-4 font-medium">Chain</th>
                    <th className="text-left py-3 px-4 font-medium">Asset</th>
                    <th className="text-right py-3 px-4 font-medium">APY</th>
                    <th className="text-right py-3 px-4 font-medium hidden sm:table-cell">Type</th>
                    <th className="text-right py-3 px-4 font-medium hidden md:table-cell">Contract</th>
                    <th className="text-center py-3 px-4 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProtocols.map((proto) => (
                    <tr
                      key={proto.id}
                      className={`border-b border-dark-border hover:bg-dark-hover transition-colors cursor-pointer ${
                        selectedProtocol?.id === proto.id ? 'bg-dark-hover' : ''
                      }`}
                      onClick={() => setSelectedProtocol(proto)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{proto.name}</span>
                          {proto.autocompounding && (
                            <span className="badge-cyan text-[0.55rem]">auto</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-300 capitalize">{proto.chain}</td>
                      <td className="py-3 px-4 text-gray-200 font-medium">{proto.asset}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`text-mono-sm font-bold ${
                          proto.apy >= 10 ? 'text-accent-green' :
                          proto.apy >= 5 ? 'text-accent-yellow' :
                          'text-gray-300'
                        }`}>
                          {fmtAPY(proto.apy)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-400 hidden sm:table-cell capitalize">
                        {proto.type.replace('-', ' ')}
                      </td>
                      <td className="py-3 px-4 text-right text-mono-sm text-gray-400 hidden md:table-cell">
                        {proto.contractAddress === 'native' ? 'Native' : `${proto.contractAddress.slice(0, 6)}...${proto.contractAddress.slice(-4)}`}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <a
                          href={proto.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-blue hover:text-accent-cyan text-xs transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Site ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Stake/Unstake Panel ────────────────────────────── */}
        {selectedProtocol && (
          <section className="animate-fade-in-up">
            <div className="glass-card p-6 max-w-lg">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span>{selectedProtocol.name}</span>
                <span className="text-sm text-gray-400">
                  — {fmtAPY(selectedProtocol.apy)} APY
                </span>
              </h3>

              {staked ? (
                <div className="space-y-4">
                  <div className="card p-4 bg-accent-green/5 border-accent-green/20">
                    <p className="text-accent-green text-sm font-medium">✓ Staked cu succes!</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {stakeAmount} {selectedProtocol.asset} pe {selectedProtocol.name}
                    </p>
                    {stakeTx && (
                      <p className="text-mono-sm text-gray-400 mt-1 text-[0.6rem] truncate">
                        Tx: {stakeTx}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleUnstake}
                    disabled={staking}
                    className="w-full glass-button bg-gradient-to-r from-red-500/80 to-orange-500/80"
                  >
                    {staking ? "Procesare..." : `Unstake ${selectedProtocol.asset}`}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">
                      Amount ({selectedProtocol.asset})
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        placeholder={`0.0 ${selectedProtocol.asset}`}
                        className="glass-input flex-1 text-mono"
                      />
                      <button
                        onClick={() => setStakeAmount("1")}
                        className="px-3 py-2 text-xs text-gray-400 hover:text-white card"
                      >
                        MAX
                      </button>
                    </div>
                    {stakeAmount && (
                      <p className="text-xs text-gray-400 mt-1">
                        Estimated yearly reward: <span className="text-accent-green">
                          {(parseFloat(stakeAmount) * selectedProtocol.apy / 100).toFixed(4)} {selectedProtocol.asset}
                        </span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleStake}
                    disabled={!stakeAmount || !isConnected || staking}
                    className="w-full glass-button disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {!isConnected
                      ? "Conectează wallet-ul"
                      : staking
                      ? "Staking în curs..."
                      : `Stake ${selectedProtocol.asset}`}
                  </button>
                  {!isConnected && (
                    <p className="text-xs text-gray-400 text-center">
                      Conectează wallet-ul pentru a executa staking real
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── APY History Chart ─────────────────────────────── */}
        {selectedHistory && (
          <section className="animate-fade-in-up">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="text-accent-cyan">▸</span> APY History — {selectedProtocol?.name}
            </h2>
            <div className="card p-4">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={selectedHistory.points}>
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={fmtDate}
                    stroke="#30363d"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#30363d"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0d1117',
                      border: '1px solid #21262d',
                      borderRadius: '0.5rem',
                      color: '#e5e7eb',
                      fontSize: '0.75rem',
                    }}
                    labelFormatter={(ts: number) => fmtDate(ts)}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, 'APY']}
                  />
                  <Line
                    type="monotone"
                    dataKey="apy"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#06b6d4' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* ── Per Chain Groups ──────────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Pe Chain-uri
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {byChain.map((group) => (
              <div key={group.chain} className="card p-4">
                <h3 className="text-sm font-semibold text-white capitalize mb-3">
                  {group.chainName}
                </h3>
                <div className="space-y-1">
                  {group.protocols.slice(0, 4).map((proto) => (
                    <div
                      key={proto.id}
                      onClick={() => setSelectedProtocol(proto)}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-dark-hover cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-300">{proto.name}</span>
                        {proto.autocompounding && (
                          <span className="badge-cyan text-[0.55rem]">auto</span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-mono-sm text-accent-green">
                        {fmtAPY(proto.apy)}
                      </span>
                    </div>
                  ))}
                  {group.protocols.length > 4 && (
                    <p className="text-xs text-gray-400 text-center pt-1">
                      +{group.protocols.length - 4} more
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
