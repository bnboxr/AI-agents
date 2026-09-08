// ── Copy Trading ───────────────────────────────────────────────
// Real wallet monitoring via Etherscan API (free tier, no key needed
// for basic usage). Mirror trades through REAL signed exchange orders
// (Binance/Bitunix — Phase A). Missing exchange keys → THROW, never a
// placeholder copy trade.
//
// Zero seededRandom — all data from real on-chain sources.
//
// References:
//   Etherscan: https://api.etherscan.io/api?module=account&action=txlist&address={addr}
//   COPY_TRADE_WALLETS env var: comma-separated addresses to track

import { requireEnv } from "~/lib/env-guard";
import { getBinanceAdapter, getBitunixAdapter, type ExchangeAdapter } from "~/lib/exchange";

// ── Types ──────────────────────────────────────────────────────

export interface TrackedWallet {
  address: string;
  label: string;
  addedAt: number;
  totalTxs: number;
  profitableTrades: number;
  winRate: number;
  totalPnL: number;
  lastTxHash: string | null;
  lastTradeAt: number;
  lastCheckedAt: number;
  status: "tracking" | "paused";
  chain: "ethereum" | "arbitrum" | "base";
}

export interface CopyTrade {
  id: string;
  walletAddress: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  size: number;            // original trade size (watched wallet)
  copiedSize: number;      // our copied size
  entryTime: number;
  exitPrice: number | null;
  exitTime: number | null;
  pnl: number | null;
  txHash: string;
  /** Real exchange order id for the mirror entry (Phase A signed order) */
  orderId?: string;
  /** Real exchange order id for the closing order */
  exitOrderId?: string;
  status: "open" | "closed" | "liquidated";
}

export interface CopyTradeState {
  trackedWallets: TrackedWallet[];
  openTrades: CopyTrade[];
  closedTrades: CopyTrade[];
  copyPercent: number;
  maxPositionSize: number;
  totalPnL: number;
  totalTrades: number;
  profitableTrades: number;
  lastUpdate: number;
  lastScanAt: number;
  paperMode: boolean;
}

export interface EtherscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;           // in wei
  timeStamp: string;
  input: string;
  isError: string;
  gasUsed: string;
  gasPrice: string;
  contractAddress: string;
}

// ── Etherscan API ──────────────────────────────────────────────

const ETHERSCAN_BASE = "https://api.etherscan.io/api";
const ARBISCAN_BASE = "https://api.arbiscan.io/api";
const BASESCAN_BASE = "https://api.basescan.org/api";

const API_BASES: Record<string, string> = {
  ethereum: ETHERSCAN_BASE,
  arbitrum: ARBISCAN_BASE,
  base: BASESCAN_BASE,
};

// Well-known DEX router addresses (used to detect swaps vs transfers)
const DEX_ROUTERS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 Router 1
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap V3 Router 2
  "0x1111111254fb6c44bac0bed2854e76f90643097d", // 1inch v5
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x Exchange
  "0x881d40237659c251811cec9c364ef91dc08d300c", // Metamask Swap
  "0x6131b5fae19ea4f9d964eac0408e4408b66337b5", // KyberSwap
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch v4
].map((a) => a.toLowerCase()));

// ── Known token addresses (DEX-traded) ─────────────────────────

const KNOWN_TOKENS: Record<string, string> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "WBTC",
  "0x514910771af9ca656af840dff83e8264ecf986ca": "LINK",
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": "UNI",
  "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": "AAVE",
  "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce": "SHIB",
  "0xbb0e17ef65f82ab018d8edd776e8dd940327b28b": "AXS",
};

// ── In-memory state ──────────────────────────────────────────

function loadWalletsFromEnv(): Omit<TrackedWallet, "addedAt" | "lastTxHash" | "lastTradeAt" | "lastCheckedAt">[] {
  try {
    const raw = typeof process !== "undefined" && process.env?.COPY_TRADE_WALLETS;
    if (!raw) return [];
    const addresses = raw.split(",").map((a) => a.trim()).filter(Boolean);
    return addresses.map((addr) => ({
      address: addr,
      label: `Wallet ${addr.slice(0, 6)}...${addr.slice(-4)}`,
      totalTxs: 0,
      profitableTrades: 0,
      winRate: 0,
      totalPnL: 0,
      status: "tracking" as const,
      chain: "ethereum" as const,
    }));
  } catch {
    return [];
  }
}

const SEED_WALLETS = loadWalletsFromEnv();

let _state: CopyTradeState = {
  trackedWallets: SEED_WALLETS.map((w) => ({
    ...w,
    addedAt: Date.now(),
    lastTxHash: null,
    lastTradeAt: 0,
    lastCheckedAt: 0,
  })),
  openTrades: [],
  closedTrades: [],
  copyPercent: 10,
  maxPositionSize: 500,
  totalPnL: 0,
  totalTrades: 0,
  profitableTrades: 0,
  lastUpdate: Date.now(),
  lastScanAt: 0,
  paperMode: SEED_WALLETS.length === 0,
};

// ── Etherscan fetchers ─────────────────────────────────────────

async function fetchWalletTransactions(
  address: string,
  chain: string,
  page = 1,
  offset = 20,
): Promise<EtherscanTx[]> {
  const base = API_BASES[chain] ?? ETHERSCAN_BASE;
  const url = `${base}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${offset}&sort=desc`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const json = await resp.json();
    if (json.status !== "1" || !Array.isArray(json.result)) return [];
    return json.result as EtherscanTx[];
  } catch (err) {
    console.warn(`[CopyTrade] Etherscan fetch failed for ${address}:`, err);
    return [];
  }
}

/**
 * Detect if a transaction is a DEX swap.
 * Heuristic: the `to` address is a known DEX router, OR the input
 * data contains standard swap function selectors (0x38ed1739 = swapExactTokensForTokens, etc.)
 */
function isDexSwap(tx: EtherscanTx): boolean {
  const to = tx.to?.toLowerCase() ?? "";
  if (DEX_ROUTERS.has(to)) return true;

  const input = tx.input ?? "";
  const swapSelectors = [
    "0x38ed1739", // swapExactTokensForTokens
    "0x8803dbee", // swapTokensForExactTokens
    "0x7ff36ab5", // swapExactETHForTokens
    "0x4a25d94a", // swapTokensForExactETH
    "0x18cbafe5", // swapExactTokensForETH
    "0xfb3bdb41", // swapETHForExactTokens
    "0x5c11d795", // swapExactTokensForTokensSupportingFeeOnTransferTokens
    "0xb6f9de95", // swapExactETHForTokensSupportingFeeOnTransferTokens
    "0x414bf389", // exactInputSingle (Uniswap V3)
    "0xdb3e2198", // exactOutputSingle (Uniswap V3)
    "0x12aa3caf", // 1inch swap
    "0x0502b1c5", // 0x fillOrder
  ];
  return swapSelectors.some((sel) => input.startsWith(sel));
}

function decodeSwapToken(tx: EtherscanTx): string | null {
  const to = tx.to?.toLowerCase() ?? "";
  if (KNOWN_TOKENS[to]) return KNOWN_TOKENS[to];

  // Check contractAddress (token being transferred)
  if (tx.contractAddress && KNOWN_TOKENS[tx.contractAddress.toLowerCase()]) {
    return KNOWN_TOKENS[tx.contractAddress.toLowerCase()];
  }

  return null;
}

/**
 * Approximate trade direction and size from transaction.
 * The USD size is the REAL ETH value × the REAL market price of ETH
 * (CoinGecko / exchange ticker) — never a fabricated "$2000/ETH" or a
 * flat "$500" placeholder. Token→token swaps whose USD value cannot be
 * decoded are skipped (return null) instead of inventing a size.
 */
async function approximateTradeFromTx(tx: EtherscanTx): Promise<{
  symbol: string;
  direction: "long" | "short";
  size: number;
} | null> {
  const valueEth = Number(tx.value) / 1e18;

  if (valueEth > 0.01) {
    // Sending ETH to a DEX — buying tokens (long)
    const token = decodeSwapToken(tx);
    const symbol = token ?? "TOKEN";
    const ethUsd = await fetchRealEthUsdPrice();
    if (ethUsd <= 0) return null;
    const size = +(valueEth * ethUsd).toFixed(2);
    if (size <= 0) return null;
    return {
      symbol: `${symbol}/ETH`,
      direction: "long",
      size,
    };
  }

  if (valueEth < 0.0001 && isDexSwap(tx)) {
    // Token-to-token swap — the USD size is NOT decodable from tx.value.
    // Never fabricate a "$500" placeholder: skip.
    return null;
  }

  return null;
}

// ── Live copy execution (real orders) ─────────────────────────

let cachedEthUsd: { price: number; ts: number } | null = null;

/** Real ETH/USD price (CoinGecko, 60s cache) — used for real trade sizing. */
async function fetchRealEthUsdPrice(): Promise<number> {
  const now = Date.now();
  if (cachedEthUsd && now - cachedEthUsd.ts < 60_000) return cachedEthUsd.price;
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return 0;
    const json = (await resp.json()) as { ethereum?: { usd?: number } };
    const price = json.ethereum?.usd;
    if (typeof price === "number" && price > 0) {
      cachedEthUsd = { price, ts: now };
      return price;
    }
  } catch {
    // fall through
  }
  // Real fallback: Binance public ticker (keyless market data).
  try {
    const price = await getBinanceAdapter().getPrice("ETHUSDT");
    if (price > 0) {
      cachedEthUsd = { price, ts: now };
      return price;
    }
  } catch {
    // no price available — caller refuses the trade
  }
  return 0;
}

/**
 * Pick the live signed exchange adapter (Phase A). When neither Binance
 * nor Bitunix has real keys, this THROWS the clear error — never returns
 * a paper adapter and never records a placeholder trade.
 */
function requireLiveCopyAdapter(): ExchangeAdapter {
  const binance = getBinanceAdapter();
  if (binance.isLive) return binance;
  const bitunix = getBitunixAdapter();
  if (bitunix.isLive) return bitunix;
  // Guard surfaces the exact missing vars (never reached when present).
  requireEnv("BINANCE_API_KEY");
  requireEnv("BITUNIX_API_KEY");
  throw new Error(
    "[CopyTrade] Live mirror requires exchange keys (BINANCE_*/BITUNIX_*) — add keys to Secrets. No placeholder copy trades.",
  );
}

/** Map "TOKEN/ETH" → the base asset for the exchange pair ("TOKEN"). */
function exchangeBaseFromSymbol(symbol: string): string | null {
  const base = symbol.split("/")[0]?.trim().toUpperCase();
  if (!base || base === "TOKEN") return null; // unknown asset — never invent a pair
  return base;
}

/**
 * Place a REAL MARKET order on a live exchange and return the real
 * orderId + avgPrice. Throws on rejection / missing avgPrice — the entry
 * price of a copy trade always comes from the exchange, never from a zero.
 */
async function placeLiveCopyOrder(opts: {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
}): Promise<{ orderId: string; avgPrice: number }> {
  const adapter = requireLiveCopyAdapter();
  const base = exchangeBaseFromSymbol(opts.symbol);
  if (!base) {
    throw new Error(`[CopyTrade] Cannot mirror unknown asset "${opts.symbol}" — no invented pair.`);
  }
  if (opts.quantity <= 0) {
    throw new Error(`[CopyTrade] Cannot place an order with quantity ${opts.quantity}.`);
  }

  const result = await adapter.placeOrder({
    symbol: base,
    side: opts.side,
    type: "MARKET",
    quantity: opts.quantity,
  });

  if (result.status === "REJECTED" || result.status === "CANCELLED") {
    throw new Error(`[CopyTrade] ${adapter.name} rejected order ${result.orderId} (${result.status}).`);
  }
  if (result.avgPrice <= 0) {
    throw new Error(
      `[CopyTrade] Order ${result.orderId} returned no avgPrice — not recording a fake entry price.`,
    );
  }
  return { orderId: result.orderId, avgPrice: result.avgPrice };
}

// ── Public API ────────────────────────────────────────────────

/**
 * Scan tracked wallets for new transactions and mirror them.
 * Called periodically (every 30-60s) by the dashboard or a cron.
 */
export async function scanWallets(): Promise<CopyTradeState> {
  const now = Date.now();
  _state.lastScanAt = now;

  for (const wallet of _state.trackedWallets) {
    if (wallet.status !== "tracking") continue;

    try {
      const txs = await fetchWalletTransactions(wallet.address, wallet.chain, 1, 10);

      // Filter for new transactions (since last check)
      const newTxs = txs.filter((tx) => {
        if (!wallet.lastCheckedAt) return true;
        const txTime = Number(tx.timeStamp) * 1000;
        return txTime > wallet.lastCheckedAt;
      });

      for (const tx of newTxs) {
        wallet.totalTxs++;
        wallet.lastTxHash = tx.hash;
        wallet.lastTradeAt = Number(tx.timeStamp) * 1000;

        // Only mirror DEX swaps
        if (!isDexSwap(tx)) continue;

        const approx = await approximateTradeFromTx(tx);
        if (!approx) continue;

        // Real copy size (capped), then a REAL market order on a live exchange.
        const copiedSize = Math.min(
          +(approx.size * (_state.copyPercent / 100)).toFixed(2),
          _state.maxPositionSize,
        );
        if (copiedSize <= 0) continue;

        try {
          const order = await placeLiveCopyOrder({
            symbol: approx.symbol,
            side: approx.direction === "long" ? "BUY" : "SELL",
            quantity: copiedSize,
          });

          const ct: CopyTrade = {
            id: `ct-${Date.now()}-${tx.hash.slice(0, 8)}`,
            walletAddress: wallet.address,
            symbol: approx.symbol,
            direction: approx.direction,
            entryPrice: order.avgPrice, // REAL exchange fill price
            size: approx.size,          // REAL USD value of the whale trade
            copiedSize,
            entryTime: Number(tx.timeStamp) * 1000,
            exitPrice: null,
            exitTime: null,
            pnl: null,
            txHash: tx.hash,
            orderId: order.orderId,
            status: "open",
          };

          _state.openTrades.push(ct);
          console.log(
            `[CopyTrade] Mirrored ${approx.symbol} ${approx.direction} — order ${order.orderId} @ ${order.avgPrice} (${copiedSize})`,
          );
        } catch (err) {
          // No placeholder trade is ever recorded: log the real failure and
          // continue scanning (error surfaces, nothing is fabricated).
          console.error(`[CopyTrade] Mirror failed for ${approx.symbol}:`, (err as Error).message);
        }

        // Auto-close old trades (after 24h) via real SELL/BUY orders.
        await closeOldTrades(now);
      }

      wallet.lastCheckedAt = now;
    } catch (err) {
      console.warn(`[CopyTrade] Scan failed for ${wallet.address}:`, err);
    }
  }

  _state.lastUpdate = now;
  return getCopyTradeState();
}

async function closeOldTrades(now: number): Promise<void> {
  // Close trades older than 24 hours with a REAL closing order. PnL is
  // computed from real exit fills — never a fabricated pnl=0.
  const MAX_HOLD_MS = 24 * 60 * 60 * 1000;
  for (let i = _state.openTrades.length - 1; i >= 0; i--) {
    const trade = _state.openTrades[i];
    if (now - trade.entryTime <= MAX_HOLD_MS || trade.status !== "open") continue;

    try {
      const closeSide = trade.direction === "long" ? "SELL" : "BUY";
      const order = await placeLiveCopyOrder({
        symbol: trade.symbol,
        side: closeSide,
        quantity: trade.copiedSize,
      });

      const exitPrice = order.avgPrice;
      const pnl =
        trade.direction === "long"
          ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * trade.copiedSize
          : ((trade.entryPrice - exitPrice) / trade.entryPrice) * trade.copiedSize;

      trade.exitPrice = exitPrice;
      trade.exitTime = now;
      trade.pnl = +pnl.toFixed(2);
      trade.status = "closed";
      trade.exitOrderId = order.orderId;
      _state.closedTrades.push(trade);
      _state.openTrades.splice(i, 1);
      _state.totalTrades++;
      _state.totalPnL += trade.pnl ?? 0;
      if ((trade.pnl ?? 0) > 0) _state.profitableTrades++;
      console.log(
        `[CopyTrade] Closed ${trade.symbol} ${trade.direction} — ${closeSide} order ${order.orderId} @ ${exitPrice}, pnl ${trade.pnl}`,
      );
    } catch (err) {
      // Real close failed (e.g. exchange keys absent). The trade stays OPEN
      // rather than being closed with a fabricated pnl=0. Error surfaces.
      console.error(`[CopyTrade] Failed to close ${trade.id} with a real order:`, (err as Error).message);
    }
  }
}

/**
 * Start tracking a wallet.
 */
export function followWallet(
  address: string,
  chain: "ethereum" | "arbitrum" | "base" = "ethereum",
  label?: string,
): TrackedWallet {
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
    chain,
    addedAt: Date.now(),
    totalTxs: 0,
    profitableTrades: 0,
    winRate: 0,
    totalPnL: 0,
    lastTxHash: null,
    lastTradeAt: 0,
    lastCheckedAt: 0,
    status: "tracking",
  };

  _state.trackedWallets.push(wallet);
  _state.paperMode = false; // we have real wallets
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
 * Mirror a specific trade (when we detect it programmatically).
 * Places a REAL market order on a live exchange; the entry price comes
 * from the actual fill — throws when no exchange keys are configured.
 */
export async function mirrorTrade(trade: {
  walletAddress: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  size: number;
  txHash?: string;
}): Promise<CopyTrade> {
  const wallet = _state.trackedWallets.find(
    (w) => w.address.toLowerCase() === trade.walletAddress.toLowerCase(),
  );

  const copiedSize = Math.min(
    +(trade.size * (_state.copyPercent / 100)).toFixed(2),
    _state.maxPositionSize,
  );
  if (copiedSize <= 0) {
    throw new Error(`[CopyTrade] Copied size for ${trade.symbol} is 0 — no empty order.`);
  }

  // REAL order first — the recorded entry price is the real fill, never the
  // caller-provided estimate and never a zero.
  const order = await placeLiveCopyOrder({
    symbol: trade.symbol,
    side: trade.direction === "long" ? "BUY" : "SELL",
    quantity: copiedSize,
  });

  const ct: CopyTrade = {
    id: `ct-${Date.now()}-${(trade.txHash ?? _state.openTrades.length.toString(36)).slice(0, 8)}`,
    walletAddress: trade.walletAddress,
    symbol: trade.symbol,
    direction: trade.direction,
    entryPrice: order.avgPrice,
    size: trade.size,
    copiedSize,
    entryTime: Date.now(),
    exitPrice: null,
    exitTime: null,
    pnl: null,
    txHash: trade.txHash ?? "",
    orderId: order.orderId,
    status: "open",
  };

  if (wallet) {
    wallet.lastTradeAt = Date.now();
    wallet.totalTxs++;
  }

  _state.openTrades.push(ct);
  _state.lastUpdate = Date.now();
  return { ...ct };
}

/**
 * Get current copy trade state.
 */
export function getCopyTradeState(): CopyTradeState {
  _state.lastUpdate = Date.now();

  return {
    ..._state,
    trackedWallets: _state.trackedWallets.map((w) => ({ ...w })),
    openTrades: _state.openTrades.map((t) => ({ ...t })),
    closedTrades: _state.closedTrades.slice(-20).map((t) => ({ ...t })),
  };
}

/**
 * Set copy percentage.
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
 * Fetch recent transactions for a specific wallet (for UI display).
 */
export async function fetchWalletHistory(
  address: string,
  chain = "ethereum",
): Promise<EtherscanTx[]> {
  return fetchWalletTransactions(address, chain, 1, 20);
}

/**
 * Reset all copy trade state.
 */
export function resetCopyTradeState(): void {
  _state = {
    trackedWallets: SEED_WALLETS.map((w) => ({
      ...w,
      addedAt: Date.now(),
      lastTxHash: null,
      lastTradeAt: 0,
      lastCheckedAt: 0,
    })),
    openTrades: [],
    closedTrades: [],
    copyPercent: 10,
    maxPositionSize: 500,
    totalPnL: 0,
    totalTrades: 0,
    profitableTrades: 0,
    lastUpdate: Date.now(),
    lastScanAt: 0,
    paperMode: SEED_WALLETS.length === 0,
  };
}
