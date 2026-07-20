// ── Copy Trading ───────────────────────────────────────────────
// Live-mode copy trading: follow profitable wallets
// and mirror their trades with a configurable size percentage.
//
// Uses deterministic seeded random for reproducible simulation data
// when no live wallet data is available.

import { seededRandom, seededRandomInt, seededPick } from "~/lib/deterministic-random";

// ── Types ──────────────────────────────────────────────────────

export interface TrackedWallet {
  address: string;
  label: string;
  addedAt: number;
  totalTrades: number;
  profitableTrades: number;
  winRate: number;
  totalPnL: number;       // USD profit of the wallet being copied
  lastTradeAt: number;
  status: "tracking" | "paused";
}

export interface CopyTrade {
  id: string;
  walletAddress: string;
  symbol: string;          // e.g. "ETH/USDC"
  direction: "long" | "short";
  entryPrice: number;
  size: number;            // original trade size (watched wallet)
  copiedSize: number;      // our copied size (size * copyPercent)
  entryTime: number;
  exitPrice: number | null;
  exitTime: number | null;
  pnl: number | null;      // realized PnL in USD
  status: "open" | "closed" | "liquidated";
}

export interface CopyTradeState {
  trackedWallets: TrackedWallet[];
  openTrades: CopyTrade[];
  closedTrades: CopyTrade[];
  copyPercent: number;     // % of original trade size to copy (default 10%)
  maxPositionSize: number;  // maximum USD per copy trade
  totalPnL: number;
  totalTrades: number;
  profitableTrades: number;
  lastUpdate: number;
  paperMode: boolean;
}

// ── Simulated whale wallets ───────────────────────────────────

// Seed wallets can be populated at runtime or via COPY_TRADE_WALLETS env var
// (JSON array of {address, label}). Structure preserved for runtime additions.
function loadSeedWallets(): Omit<TrackedWallet, "addedAt" | "lastTradeAt">[] {
  try {
    const raw = typeof process !== "undefined" && process.env?.COPY_TRADE_WALLETS;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((w: { address: string; label: string }) => ({
          address: w.address,
          label: w.label,
          totalTrades: 0,
          profitableTrades: 0,
          winRate: 0,
          totalPnL: 0,
          status: "tracking" as const,
        }));
      }
    }
  } catch {
    // Ignore parse errors — fall through to empty array
  }
  return [];
}

const SEED_WALLETS: Omit<TrackedWallet, "addedAt" | "lastTradeAt">[] = loadSeedWallets();

const SIMULATED_SYMBOLS = [
  "ETH/USDC", "BTC/USDC", "SOL/USDC", "ARB/USDC", "OP/USDC",
  "LINK/USDC", "MATIC/USDC", "PEPE/USDC", "WIF/USDC", "BONK/USDC",
];

// ── In-memory state ──────────────────────────────────────────

let _state: CopyTradeState = {
  trackedWallets: SEED_WALLETS.map((w) => ({
    ...w,
    addedAt: Date.now() - seededRandomInt(w.address, 0, 30) * 24 * 60 * 60 * 1000,
    lastTradeAt: Date.now() - seededRandomInt(w.address + "-lt", 0, 12) * 60 * 60 * 1000,
  })),
  openTrades: [],
  closedTrades: [],
  copyPercent: 10,    // copy 10% of original size
  maxPositionSize: 500,
  totalPnL: 0,
  totalTrades: 0,
  profitableTrades: 0,
  lastUpdate: Date.now(),
  paperMode: !(typeof process !== "undefined" && process.env?.COPY_TRADE_WALLETS && process.env?.BINANCE_API_KEY),
};

// ── Internal helpers ──────────────────────────────────────────

function generateCopyTrade(wallet: TrackedWallet): CopyTrade {
  const seed = wallet.address + "-" + wallet.totalTrades;
  const symbol = seededPick(seed + "-sym", SIMULATED_SYMBOLS);
  const direction = seededRandom(seed + "-dir") > 0.4 ? "long" : "short";
  const entryPrice = symbol.startsWith("ETH") ? 3000 + seededRandom(seed + "-p") * 200
    : symbol.startsWith("BTC") ? 65000 + seededRandom(seed + "-p") * 5000
    : symbol.startsWith("SOL") ? 120 + seededRandom(seed + "-p") * 30
    : 10 + seededRandom(seed + "-p") * 100;
  const originalSize = 1000 + seededRandom(seed + "-sz") * 49000; // $1K-$50K
  const copiedSize = Math.min(
    Math.round(originalSize * (_state.copyPercent / 100) * 100) / 100,
    _state.maxPositionSize,
  );

  wallet.lastTradeAt = Date.now();
  wallet.totalTrades++;

  return {
    id: `ct-${Date.now()}-${wallet.totalTrades}`,
    walletAddress: wallet.address,
    symbol,
    direction,
    entryPrice: +entryPrice.toFixed(2),
    size: +originalSize.toFixed(2),
    copiedSize: +copiedSize.toFixed(2),
    entryTime: Date.now(),
    exitPrice: null,
    exitTime: null,
    pnl: null,
    status: "open",
  };
}

function simulateTradeOutcome(trade: CopyTrade): void {
  // Simulate price movement (±2%)
  const movePct = (seededRandom(trade.id + "-mv") - 0.45) * 0.04; // slight bullish bias
  const exitPrice = trade.entryPrice * (1 + movePct);

  trade.exitPrice = +exitPrice.toFixed(2);
  trade.exitTime = Date.now();
  trade.status = "closed";

  if (trade.direction === "long") {
    trade.pnl = +((exitPrice - trade.entryPrice) / trade.entryPrice * trade.copiedSize).toFixed(2);
  } else {
    trade.pnl = +((trade.entryPrice - exitPrice) / trade.entryPrice * trade.copiedSize).toFixed(2);
  }

  _state.totalPnL += trade.pnl;
  _state.totalTrades++;
  if (trade.pnl > 0) _state.profitableTrades++;

  // Update wallet stats
  const wallet = _state.trackedWallets.find((w) => w.address === trade.walletAddress);
  if (wallet) {
    wallet.totalPnL += trade.pnl * (trade.size / trade.copiedSize); // scale to original
    if (trade.pnl > 0) wallet.profitableTrades++;
    wallet.totalTrades++;
    wallet.winRate = wallet.profitableTrades / wallet.totalTrades;
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Start tracking a wallet for copy trading.
 */
export function followWallet(address: string, label?: string): TrackedWallet {
  const existing = _state.trackedWallets.find(
    (w) => w.address.toLowerCase() === address.toLowerCase(),
  );
  if (existing) {
    if (existing.status === "paused") {
      existing.status = "tracking";
    }
    return { ...existing };
  }

  const wallet: TrackedWallet = {
    address,
    label: label || `Wallet ${address.slice(0, 6)}...${address.slice(-4)}`,
    addedAt: Date.now(),
    totalTrades: 0,
    profitableTrades: 0,
    winRate: 0,
    totalPnL: 0,
    lastTradeAt: 0,
    status: "tracking",
  };

  _state.trackedWallets.push(wallet);
  _state.lastUpdate = Date.now();
  return { ...wallet };
}

/**
 * Pause tracking a wallet.
 */
export function unfollowWallet(address: string): boolean {
  const wallet = _state.trackedWallets.find(
    (w) => w.address.toLowerCase() === address.toLowerCase(),
  );
  if (!wallet) return false;
  wallet.status = "paused";
  _state.lastUpdate = Date.now();
  return true;
}

/**
 * Mirror a trade from a tracked wallet.
 * Paper mode — simulates opening a copy trade.
 */
export function copyTrade(trade?: {
  walletAddress: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  size: number;
}): CopyTrade {
  const wallet = _state.trackedWallets.find(
    (w) => w.address.toLowerCase() === trade?.walletAddress?.toLowerCase(),
  );

  const ct: CopyTrade = trade
    ? {
        id: `ct-${Date.now()}-${wallet.totalTrades ?? 0}`,
        walletAddress: trade.walletAddress,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        size: trade.size,
        copiedSize: Math.min(
          +(trade.size * (_state.copyPercent / 100)).toFixed(2),
          _state.maxPositionSize,
        ),
        entryTime: Date.now(),
        exitPrice: null,
        exitTime: null,
        pnl: null,
        status: "open",
      }
    : generateCopyTrade(wallet || _state.trackedWallets[0]);

  if (!wallet) {
    // Try to fallback to a tracked wallet — if simulating
    const fallback = _state.trackedWallets.find((w) => w.status === "tracking");
    if (fallback) {
      fallback.lastTradeAt = Date.now();
      fallback.totalTrades++;
    }
  }

  _state.openTrades.push(ct);

  // Simulate closing some older open trades
  while (_state.openTrades.length > 5) {
    const oldest = _state.openTrades.shift();
    if (oldest) {
      simulateTradeOutcome(oldest);
      _state.closedTrades.push(oldest);
    }
  }

  _state.lastUpdate = Date.now();
  return { ...ct };
}

/**
 * Get current copy trade state.
 */
export function getCopyTradeState(): CopyTradeState {
  _state.lastUpdate = Date.now();

  // Auto-close trades that have been open > 4 hours (simulation)
  const now = Date.now();
  for (let i = _state.openTrades.length - 1; i >= 0; i--) {
    const trade = _state.openTrades[i];
    if (now - trade.entryTime > 4 * 60 * 60 * 1000) {
      simulateTradeOutcome(trade);
      _state.closedTrades.push(trade);
      _state.openTrades.splice(i, 1);
    }
  }

  return {
    ..._state,
    trackedWallets: _state.trackedWallets.map((w) => ({ ...w })),
    openTrades: _state.openTrades.map((t) => ({ ...t })),
    closedTrades: _state.closedTrades.slice(-20).map((t) => ({ ...t })), // last 20
  };
}

/**
 * Set the copy percentage (how much of wallet's trade size to mirror).
 */
export function setCopyPercent(pct: number): void {
  _state.copyPercent = Math.max(1, Math.min(100, pct));
  _state.lastUpdate = Date.now();
}

/**
 * Set max position size per copy trade.
 */
export function setMaxPositionSize(usd: number): void {
  _state.maxPositionSize = Math.max(10, usd);
  _state.lastUpdate = Date.now();
}

/**
 * Get tracked wallets.
 */
export function getTrackedWallets(): TrackedWallet[] {
  return _state.trackedWallets.map((w) => ({ ...w }));
}

/**
 * Reset all copy trade state.
 */
export function resetCopyTradeState(): void {
  _state = {
    trackedWallets: SEED_WALLETS.map((w) => ({
      ...w,
      addedAt: Date.now() - seededRandomInt(w.address + "-rst", 0, 30) * 24 * 60 * 60 * 1000,
      lastTradeAt: Date.now() - seededRandomInt(w.address + "-rst-lt", 0, 12) * 60 * 60 * 1000,
    })),
    openTrades: [],
    closedTrades: [],
    copyPercent: 10,
    maxPositionSize: 500,
    totalPnL: 0,
    totalTrades: 0,
    profitableTrades: 0,
    lastUpdate: Date.now(),
    paperMode: !(typeof process !== "undefined" && process.env?.COPY_TRADE_WALLETS && process.env?.BINANCE_API_KEY),
  };
}
