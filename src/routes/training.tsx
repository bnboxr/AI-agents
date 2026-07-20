// ── Agent Training Dashboard ─────────────────────────────────────────
// Shows per-chain balances, faucet cooldowns, anti-drain status,
// and performance metrics for testnet agent training.
//
// "Fiecare token contează. Profitul se câștigă."

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { SUPPORTED_CHAINS } from "~/lib/chains-config";
import {
  type ChainBalance,
  getAllChainBalances,
  getNativeTokenPrice,
} from "~/lib/chain-balance";
import {
  type FaucetEntry,
  getAvailableFaucets,
  getNextResetTime,
  countAvailableFaucets,
  countTotalFaucets,
  refreshCooldowns,
} from "~/lib/faucet-cooldown";
import {
  type AntiDrainState,
  getAntiDrainState,
  checkDailyDrawdown,
  getAllAntiDrainStates,
  validateTrade,
} from "~/lib/anti-drain";

export const Route = createFileRoute("/training")({
  component: TrainingPage,
});

// ── Chain Row ────────────────────────────────────────────────────────

function ChainRow({ balance, antiDrain }: { balance: ChainBalance; antiDrain: AntiDrainState }) {
  const cfg = SUPPORTED_CHAINS[balance.chainId];
  const pnlColor = balance.totalPnL >= 0 ? "text-[#00e676]" : "text-[#ff5252]";
  const pnlSign = balance.totalPnL >= 0 ? "+" : "";

  // Drawdown display
  const drawdown = checkDailyDrawdown(balance.chainId);
  const drawdownColor =
    drawdown.remainingPct > 60
      ? "text-[#00e676]"
      : drawdown.remainingPct > 30
        ? "text-[#ffb74d]"
        : "text-[#ff5252]";

  // Status indicator
  let statusIcon = "💤";
  let statusText = "No trades yet";
  let statusClass = "text-[#546e7a]";

  if (antiDrain.blockedUntil > 0 && Date.now() < antiDrain.blockedUntil) {
    const hrs = Math.ceil((antiDrain.blockedUntil - Date.now()) / (60 * 60 * 1000));
    statusIcon = "🚫";
    statusText = `Blocked ${hrs}h`;
    statusClass = "text-[#ff5252]";
  } else if (antiDrain.consecutiveLosses >= 2) {
    statusIcon = "🫸";
    statusText = `${antiDrain.consecutiveLosses} losses — 1 more before 24h stop`;
    statusClass = "text-[#ffb74d]";
  } else if (antiDrain.totalTrades > 0) {
    statusIcon = antiDrain.winRate >= 0.6 ? "✅" : "⚠️";
    statusText = `${antiDrain.totalTrades} trades · ${(antiDrain.winRate * 100).toFixed(0)}% WR`;
    statusClass = antiDrain.winRate >= 0.6 ? "text-[#00e676]" : "text-[#ffb74d]";
  }

  const tierLabel =
    antiDrain.tier === "TRUSTED"
      ? "🔵 Trusted"
      : antiDrain.tier === "PROVING"
        ? "🟡 Proving"
        : "⚪ Starter";

  const maxSize = antiDrain.tier === "TRUSTED" ? "5%" : antiDrain.tier === "PROVING" ? "3%" : "2%";

  return (
    <div className="glass-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-[#e0e6ed]">{balance.chainName}</span>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#0d1117] text-[#546e7a]">
            {cfg?.nativeToken ?? "N/A"}
          </span>
        </div>
        <span className={`text-xs font-mono ${statusClass}`}>
          {statusIcon} {statusText}
        </span>
      </div>

      {/* Balance row */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-[#546e7a] font-mono">Balance</span>
        <span className="font-mono text-[#e0e6ed]">
          {balance.nativeBalance.toFixed(4)} {cfg?.nativeToken ?? ""}
          <span className="text-[#546e7a] ml-1">(${balance.usdValue.toFixed(2)})</span>
        </span>
      </div>

      {/* PnL row */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-[#546e7a] font-mono">PnL</span>
        <span className={`font-mono ${pnlColor}`}>
          {pnlSign}${balance.totalPnL.toFixed(2)}
        </span>
      </div>

      {/* Tier & Drawdown */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#546e7a] font-mono">
          {tierLabel} <span className="text-[#2a303c]">|</span> Max {maxSize}/trade
        </span>
        <span className={`font-mono ${drawdownColor}`}>
          Drawdown: {(ANTI_DRAIN_RULES_MAX_DRAWDOWN_PCT * 100 - drawdown.remainingPct).toFixed(1)}% / {ANTI_DRAIN_RULES_MAX_DRAWDOWN_PCT * 100}%
        </span>
      </div>

      {/* Profit locked indicator */}
      {antiDrain.profitLocked > 0 && (
        <div className="text-xs text-[#ffb74d] font-mono">
          🔒 ${antiDrain.profitLocked.toFixed(2)} locked profit
        </div>
      )}

      {/* Progress bar for drawdown */}
      <div className="w-full h-1 rounded-full bg-[#0d1117] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            drawdown.remainingPct > 60
              ? "bg-[#00e676]"
              : drawdown.remainingPct > 30
                ? "bg-[#ffb74d]"
                : "bg-[#ff5252]"
          }`}
          style={{ width: `${Math.max(0, drawdown.remainingPct)}%` }}
        />
      </div>
    </div>
  );
}

const ANTI_DRAIN_RULES_MAX_DRAWDOWN_PCT = 0.15;

// ── Faucet Status Section ────────────────────────────────────────────

function FaucetSection({ chainId }: { chainId: string }) {
  const [faucets, setFaucets] = useState<FaucetEntry[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const update = () => {
      refreshCooldowns();
      setFaucets(getAvailableFaucets(chainId));
      setNow(Date.now());
    };
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, [chainId]);

  if (faucets.length === 0) return null;

  const nextReset = getNextResetTime(chainId);
  const secondsUntilReset = nextReset > 0 ? Math.max(0, Math.ceil((nextReset - now) / 1000)) : 0;
  const nextResetDisplay =
    secondsUntilReset > 0
      ? `${Math.floor(secondsUntilReset / 3600)}h ${Math.floor((secondsUntilReset % 3600) / 60)}m`
      : "Available";

  return (
    <div className="glass-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-[#e0e6ed] font-mono">
          🚰 {SUPPORTED_CHAINS[chainId]?.name ?? chainId}
        </span>
        <span className="text-xs font-mono text-[#b0bec5]">
          {countAvailableFaucets(chainId)}/{countTotalFaucets(chainId)} available
          {nextReset > 0 && (
            <span className="text-[#546e7a] ml-1">
              ⏰ Next: {nextResetDisplay}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {faucets.map((f) => (
          <span
            key={f.name}
            className={`text-xs font-mono px-2 py-0.5 rounded ${
              f.available
                ? "bg-[#00e676]/10 text-[#00e676] border border-[#00e676]/30"
                : "bg-[#ff5252]/10 text-[#ff5252] border border-[#ff5252]/30"
            }`}
          >
            {f.available ? "✅" : "❌"} {f.name}
            {!f.available && f.resetAt > 0 && (
              <span className="ml-1">
                ⏰{Math.ceil(Math.max(0, (f.resetAt - now) / 1000 / 60))}m
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Performance Summary ──────────────────────────────────────────────

function PerformanceSummary({ balances, states }: { balances: ChainBalance[]; states: AntiDrainState[] }) {
  const totalTrades = states.reduce((sum, s) => sum + s.totalTrades, 0);
  const totalWins = states.reduce((sum, s) => sum + Math.round(s.totalTrades * s.winRate), 0);
  const totalPnL = balances.reduce((sum, b) => sum + b.totalPnL, 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100) : 0;

  // Find best chain
  let bestChain: ChainBalance | null = null;
  for (const b of balances) {
    if (!bestChain || b.totalPnL > bestChain.totalPnL) {
      bestChain = b;
    }
  }

  const pnlColor = totalPnL >= 0 ? "text-[#00e676]" : "text-[#ff5252]";
  const pnlSign = totalPnL >= 0 ? "+" : "";

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-bold text-[#e0e6ed] font-mono mb-3">📊 PERFORMANCE</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[#546e7a] font-mono text-xs">Win Rate</div>
          <div className="font-mono text-[#e0e6ed]">{winRate.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[#546e7a] font-mono text-xs">Total PnL</div>
          <div className={`font-mono ${pnlColor}`}>{pnlSign}${totalPnL.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[#546e7a] font-mono text-xs">Total Trades</div>
          <div className="font-mono text-[#e0e6ed]">{totalTrades}</div>
        </div>
        <div>
          <div className="text-[#546e7a] font-mono text-xs">Best Chain</div>
          <div className="font-mono text-[#e0e6ed]">
            {bestChain ? bestChain.chainName : "N/A"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

function TrainingPage() {
  const [balances, setBalances] = useState<ChainBalance[]>([]);
  const [antiDrainStates, setAntiDrainStates] = useState<AntiDrainState[]>([]);
  const [tick, setTick] = useState(0);

  // Periodic refresh
  useEffect(() => {
    const refresh = () => {
      const b = getAllChainBalances();
      const s = getAllAntiDrainStates();
      setBalances(b);
      setAntiDrainStates(s);
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [tick]);

  // Force re-render for countdown timers
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const testnetChains = Object.entries(SUPPORTED_CHAINS).filter(
    ([, cfg]) => cfg.testnet,
  );

  // Also include Solana and TRON mainnet for display
  const solanaChains = Object.entries(SUPPORTED_CHAINS).filter(
    ([id, cfg]) => id === "solana" && !cfg.testnet,
  );
  const tronChains = Object.entries(SUPPORTED_CHAINS).filter(
    ([id, cfg]) => id === "tron" && !cfg.testnet,
  );

  const allDisplayChains = [...testnetChains, ...solanaChains, ...tronChains];

  return (
    <div className="min-h-dvh pt-20 pb-12 px-4 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-black text-[#e0e6ed] font-mono">
            🎯 AGENT TRAINING
          </h1>
          <p className="text-sm text-[#b0bec5] font-mono">
            "Fiecare token contează. Profitul se câștigă."
          </p>
          <div className="flex items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-[#546e7a] font-mono">
              <span className="status-dot-online"></span>
              Testnet Mode
            </span>
            <span className="text-[#2a303c]">|</span>
            <span className="text-xs text-[#00e676] font-mono">
              💡 Non-stop training — "ultimii vigilenți"
            </span>
          </div>
        </div>

        {/* Performance Summary */}
        <PerformanceSummary balances={balances} states={antiDrainStates} />

        {/* Chain Balances Grid */}
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-[#e0e6ed] font-mono flex items-center gap-2">
            <span>⛓️ CHAIN BALANCES</span>
            <span className="text-xs text-[#546e7a] font-normal">
              {testnetChains.length} testnets active
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allDisplayChains.map(([chainId, cfg]) => {
              const bal = balances.find((b) => b.chainId === chainId) ?? {
                chainId,
                chainName: cfg.name,
                nativeBalance: 0,
                usdValue: 0,
                initialBalance: 0,
                currentBalance: 0,
                totalTrades: 0,
                totalPnL: 0,
                lastFaucetClaim: 0,
                faucetsUsed: [],
              };
              const ad = antiDrainStates.find((s) => s.chainId === chainId) ?? {
                chainId,
                consecutiveLosses: 0,
                consecutiveWins: 0,
                totalTrades: 0,
                winRate: 0,
                peakBalance: 0,
                currentBalance: 0,
                dailyDrawdownPct: 0,
                profitLocked: 0,
                blockedUntil: 0,
                tier: "STARTER" as const,
              };
              return <ChainRow key={chainId} balance={bal} antiDrain={ad} />;
            })}
          </div>
        </div>

        {/* Faucet Status */}
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-[#e0e6ed] font-mono">🚰 FAUCET STATUS</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {testnetChains.map(([chainId]) => (
              <FaucetSection key={chainId} chainId={chainId} />
            ))}
          </div>
        </div>

        {/* Anti-Drain Rules Reference */}
        <div className="glass-card p-4">
          <h3 className="text-sm font-bold text-[#e0e6ed] font-mono mb-3">🛡️ ANTI-DRAIN RULES</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs font-mono">
            <div className="p-2 rounded bg-[#0d1117]">
              <div className="text-[#546e7a]">Max Position</div>
              <div className="text-[#00e676]">5% of balance</div>
            </div>
            <div className="p-2 rounded bg-[#0d1117]">
              <div className="text-[#546e7a]">Max Drawdown</div>
              <div className="text-[#ffb74d]">15% / 24h</div>
            </div>
            <div className="p-2 rounded bg-[#0d1117]">
              <div className="text-[#546e7a]">Loss Limit</div>
              <div className="text-[#ff5252]">3 consecutive → 24h stop</div>
            </div>
            <div className="p-2 rounded bg-[#0d1117]">
              <div className="text-[#546e7a]">Profit Lock</div>
              <div className="text-[#00e676]">10% → lock ½</div>
            </div>
            <div className="p-2 rounded bg-[#0d1117]">
              <div className="text-[#546e7a]">Min Confidence</div>
              <div className="text-[#b0bec5]">65%</div>
            </div>
            <div className="p-2 rounded bg-[#0d1117]">
              <div className="text-[#546e7a]">Size Scaling</div>
              <div className="text-[#b0bec5]">2% → 3% → 5%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
