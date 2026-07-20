// ── DEX Adapter (Paper Trading) ──────────────────────────────────────
// Simulates on-chain DEX swaps (Uniswap V3) with real market prices
// from CoinGecko. Paper mode — no wallet connection needed.
//
// DEX trading pairs: ETH/USDC, ETH/USDT, WBTC/USDC, WBTC/ETH, SOL/USDC,
// UNI/ETH, LINK/ETH, AAVE/ETH, MATIC/USDC
//
// Slippage model: 0.3% Uniswap pool fee + configurable price impact (default 0.5%)

import type {
  ExchangeAdapter,
  ExchangeRole,
  OrderBook,
  OrderBookLevel,
  OrderRequest,
  OrderResult,
  Balance,
  AssetBalance,
  Order,
} from "./types";
import { getWalletChainId, getWalletChainConfig, isWalletTestnet } from "../chains-config";
import type { WalletChainConfig } from "../chains-config";

// ── Constants ──────────────────────────────────────────────────────

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const REQUEST_TIMEOUT = 8_000;

/** Default DEX slippage: 0.3% pool fee + 0.5% price impact = 0.8% */
const DEFAULT_DEX_SLIPPAGE = 0.008;

/** DEX trading pairs symbol → CoinGecko ID + base/quote mapping */
const DEX_PAIRS: Record<string, { baseId: string; quoteId: string; baseDecimals: number }> = {
  "ETH/USDC":  { baseId: "ethereum",       quoteId: "usd-coin",      baseDecimals: 18 },
  "ETH/USDT":  { baseId: "ethereum",       quoteId: "tether",        baseDecimals: 18 },
  "WBTC/USDC": { baseId: "wrapped-bitcoin", quoteId: "usd-coin",     baseDecimals: 8  },
  "WBTC/ETH":  { baseId: "wrapped-bitcoin", quoteId: "ethereum",     baseDecimals: 8  },
  "SOL/USDC":  { baseId: "solana",         quoteId: "usd-coin",      baseDecimals: 9  },
  "UNI/ETH":   { baseId: "uniswap",        quoteId: "ethereum",      baseDecimals: 18 },
  "LINK/ETH":  { baseId: "chainlink",      quoteId: "ethereum",      baseDecimals: 18 },
  "AAVE/ETH":  { baseId: "aave",           quoteId: "ethereum",      baseDecimals: 18 },
  "MATIC/USDC":{ baseId: "matic-network",  quoteId: "usd-coin",      baseDecimals: 18 },
  "SOL/USDT":  { baseId: "solana",         quoteId: "tether",        baseDecimals: 9  },
  "XRP/USD":   { baseId: "ripple",         quoteId: "usd-coin",      baseDecimals: 6  },
  "XRP/BTC":   { baseId: "ripple",         quoteId: "bitcoin",       baseDecimals: 6  },
};

/** CoinGecko IDs we query for pricing */
const COINGECKO_IDS = [...new Set([
  ...Object.values(DEX_PAIRS).flatMap(p => [p.baseId, p.quoteId]),
])];

// Already includes: ethereum, usd-coin, tether, wrapped-bitcoin, solana,
// uniswap, chainlink, aave, matic-network

// ── Get DEX slippage from settings (localStorage) ──────────────────

function getDexSlippageSetting(): number {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("hsmc_dex_slippage");
      if (stored) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val > 0 && val <= 0.1) return val; // 0-10%
      }
    }
  } catch {
    // localStorage not available
  }
  return DEFAULT_DEX_SLIPPAGE;
}

function getPreferredDex(): string {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("hsmc_preferred_dex");
      if (stored === "uniswap_v3" || stored === "uniswap_v2" || stored === "sushiswap") return stored;
    }
  } catch { /* ignore */ }
  return "uniswap_v3";
}

function getGasPreference(): "fast" | "medium" | "slow" {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("hsmc_gas_preference");
      if (stored === "fast" || stored === "medium" || stored === "slow") return stored;
    }
  } catch { /* ignore */ }
  return "medium";
}

// ── Paper Trading State ────────────────────────────────────────────

const paperOrders = new Map<string, Order>();

/** Paper balance entries */
const paperBalances: AssetBalance[] = [];

/** Track paper DEX positions. Key = symbol (e.g., "ETHUSDC"). */
interface DexPosition {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  pair: string; // e.g., "ETH/USDC"
  chainId: string; // wallet chain id (e.g., "ethereum", "arbitrum")
  chainName: string; // human-readable (e.g., "Ethereum", "Arbitrum")
  routerAddress: string; // Uniswap V3 router on this chain
}

const paperDexPositions = new Map<string, DexPosition>();

let paperOrderCounter = 0;
let _paperBalancesInitialized = false;

// ── Symbol Helpers ─────────────────────────────────────────────────

/** Normalize symbol to DEX pair format: "ETHUSDC" → "ETH/USDC" */
function toDexPair(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper.includes("/")) return upper;

  // Try exact match in known pairs
  for (const pair of Object.keys(DEX_PAIRS)) {
    if (pair.replace("/", "") === upper) return pair;
  }
  // Default: assume USDT quote
  if (upper.endsWith("USDT")) {
    const base = upper.slice(0, -4);
    return `${base}/USDT`;
  }
  if (upper.endsWith("USDC")) {
    const base = upper.slice(0, -4);
    return `${base}/USDC`;
  }
  return `${upper}/USDT`;
}

function getRawSymbol(dexPair: string): string {
  return dexPair.replace("/", "");
}

/** Get CoinGecko base ID from DEX pair */
function getBaseCoinId(pair: string): string {
  const info = DEX_PAIRS[pair];
  if (info) return info.baseId;
  // Fallback: try to derive from base asset
  const base = pair.split("/")[0]?.toLowerCase() ?? "";
  return baseIdMap[base] ?? base;
}

function getQuoteCoinId(pair: string): string {
  const info = DEX_PAIRS[pair];
  if (info) return info.quoteId;
  const quote = pair.split("/")[1]?.toLowerCase() ?? "tether";
  return baseIdMap[quote] ?? quote;
}

const baseIdMap: Record<string, string> = {
  btc: "bitcoin", eth: "ethereum", sol: "solana", bnb: "binancecoin",
  xrp: "ripple", ada: "cardano", doge: "dogecoin", avax: "avalanche-2",
  dot: "polkadot", matic: "matic-network", link: "chainlink",
  uni: "uniswap", aave: "aave", arb: "arbitrum", op: "optimism",
  near: "near", sui: "sui", apt: "aptos", wbtc: "wrapped-bitcoin",
  usdc: "usd-coin", usdt: "tether", dai: "dai",
};

// ── Price Fetching ─────────────────────────────────────────────────

/** In-memory price cache to avoid hitting CoinGecko rate limits */
const priceCache = new Map<string, { price: number; ts: number }>();
const PRICE_CACHE_TTL = 30_000; // 30 seconds

async function fetchCoinGeckoPrices(ids: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  const uncached = ids.filter(id => {
    const cached = priceCache.get(id);
    return !cached || (now - cached.ts) > PRICE_CACHE_TTL;
  });

  if (uncached.length === 0) {
    const result: Record<string, number> = {};
    for (const id of ids) {
      result[id] = priceCache.get(id)!.price;
    }
    return result;
  }

  try {
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${uncached.join(",")}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT) },
    );
    if (res.ok) {
      const data = await res.json() as Record<string, { usd: number }>;
      for (const [id, val] of Object.entries(data)) {
        if (val?.usd) {
          priceCache.set(id, { price: val.usd, ts: now });
        }
      }
    }
  } catch (err) {
    console.warn("[DEX] CoinGecko price fetch failed:", err);
  }

  // Return whatever we have (cached + fresh)
  const result: Record<string, number> = {};
  for (const id of ids) {
    result[id] = priceCache.get(id)?.price ?? 0;
  }
  return result;
}

async function fetchDexPrice(pair: string): Promise<number> {
  const baseId = getBaseCoinId(pair);
  const quoteId = getQuoteCoinId(pair);
  const prices = await fetchCoinGeckoPrices([baseId, quoteId]);

  const basePrice = prices[baseId];
  const quotePrice = prices[quoteId];

  if (basePrice <= 0) {
    throw new Error(`No DEX price available for ${pair} (missing ${baseId})`);
  }

  // If quote is a stablecoin, basePrice IS the pair price
  // Otherwise, compute cross rate
  if (quotePrice > 0 && quotePrice !== 1) {
    // e.g., WBTC/ETH: base = WBTC price in USD, quote = ETH price in USD
    return basePrice / quotePrice;
  }

  return basePrice;
}

// ── Balance Management ─────────────────────────────────────────────

function ensurePaperBalances(): void {
  if (_paperBalancesInitialized) return;
  try {
    const { getSyncBalance } = require("../unified-balance");
    const bal = getSyncBalance();
    paperBalances.length = 0;
    paperBalances.push({
      asset: "USDT",
      free: bal.usdt,
      locked: 0,
      usdValue: bal.usdt,
    });
    // Also add USDC (1:1 with USDT for simplicity)
    paperBalances.push({
      asset: "USDC",
      free: bal.usdt,
      locked: 0,
      usdValue: bal.usdt,
    });
    _paperBalancesInitialized = true;
  } catch {
    paperBalances.push({
      asset: "USDT",
      free: 1_000_000,
      locked: 0,
      usdValue: 1_000_000,
    });
    paperBalances.push({
      asset: "USDC",
      free: 1_000_000,
      locked: 0,
      usdValue: 1_000_000,
    });
    _paperBalancesInitialized = true;
  }
}

// ── Paper Trading Engine ───────────────────────────────────────────

async function dexPaperPlaceOrder(orderReq: OrderRequest): Promise<OrderResult> {
  ensurePaperBalances();
  const pair = toDexPair(orderReq.symbol);
  const rawPair = getRawSymbol(pair);
  let marketPrice: number;

  try {
    marketPrice = await fetchDexPrice(pair);
  } catch (err) {
    console.warn("[DEX] dexPaperPlaceOrder price fetch failed:", err);
    marketPrice = getDexFallbackPrice(pair);
  }

  // DEX slippage: pool fee (0.3%) + price impact (from settings)
  const slippageSetting = getDexSlippageSetting();
  const dexSlippage = orderReq.type === "MARKET" ? slippageSetting : slippageSetting * 0.5;
  const slippageDir = orderReq.side === "BUY" ? 1 : -1;
  const execPrice = marketPrice * (1 + dexSlippage * slippageDir);

  paperOrderCounter++;
  const orderId = `paper_dex_${Date.now()}_${paperOrderCounter}`;

  const order: Order = {
    orderId,
    symbol: pair,
    side: orderReq.side,
    type: orderReq.type,
    quantity: orderReq.quantity,
    filledQuantity: orderReq.quantity,
    price: orderReq.price ?? execPrice,
    avgPrice: execPrice,
    status: "FILLED",
    timestamp: Date.now(),
    isPaper: true,
  };

  paperOrders.set(orderId, order);

  // Update paper balances
  const quoteAmount = orderReq.quantity * execPrice;
  const fee = quoteAmount * 0.003; // 0.3% Uniswap pool fee
  const baseAsset = pair.split("/")[0] ?? "UNKNOWN";
  const quoteAsset = pair.split("/")[1] ?? "USDT";

  let baseBal = paperBalances.find((b) => b.asset === baseAsset);
  let quoteBal = paperBalances.find((b) => b.asset === quoteAsset);

  if (!baseBal) {
    baseBal = { asset: baseAsset, free: 0, locked: 0, usdValue: 0 };
    paperBalances.push(baseBal);
  }
  if (!quoteBal) {
    quoteBal = { asset: quoteAsset, free: 0, locked: 0, usdValue: 0 };
    paperBalances.push(quoteBal);
  }

  if (orderReq.side === "BUY") {
    quoteBal.free -= (quoteAmount + fee);
    baseBal.free += orderReq.quantity;
    // Simulate gas cost for DEX trade
    const gasCost = estimateGasCost();
    quoteBal.free -= gasCost;

    paperDexPositions.set(rawPair, {
      symbol: rawPair,
      side: "LONG",
      quantity: orderReq.quantity,
      entryPrice: execPrice,
      pair,
      chainId: getCurrentChainId(),
      chainName: getCurrentChainName(),
      routerAddress: getCurrentRouterAddress(),
    });
  } else {
    baseBal.free -= orderReq.quantity;
    quoteBal.free += (quoteAmount - fee);
    const gasCost = estimateGasCost();
    quoteBal.free -= gasCost;

    paperDexPositions.set(rawPair, {
      symbol: rawPair,
      side: "SHORT",
      quantity: orderReq.quantity,
      entryPrice: execPrice,
      pair,
      chainId: getCurrentChainId(),
      chainName: getCurrentChainName(),
      routerAddress: getCurrentRouterAddress(),
    });
  }

  const result: OrderResult = {
    orderId,
    symbol: rawPair,
    side: orderReq.side,
    type: orderReq.type,
    quantity: orderReq.quantity,
    filledQuantity: orderReq.quantity,
    avgPrice: execPrice,
    status: "FILLED",
    fee: fee + estimateGasCost(),
    feeAsset: "USDT",
    timestamp: Date.now(),
    isPaper: true,
  };

  return result;
}

async function dexPaperCloseOrder(symbol: string): Promise<OrderResult & { realizedPnl: number; exitPrice: number }> {
  ensurePaperBalances();
  const rawSymbol = symbol.includes("/") ? getRawSymbol(symbol) : symbol;
  const pair = toDexPair(rawSymbol);

  const pos = paperDexPositions.get(rawSymbol);
  if (!pos) {
    throw new Error(`No open DEX position for ${rawSymbol}`);
  }

  let exitPrice: number;
  try {
    exitPrice = await fetchDexPrice(pos.pair);
  } catch {
    exitPrice = getDexFallbackPrice(pos.pair);
  }

  // Apply DEX slippage for exit
  const exitSide = pos.side === "LONG" ? "SELL" : "BUY";
  const slippageSetting = getDexSlippageSetting();
  const slippageDir = exitSide === "SELL" ? -1 : 1;
  const execPrice = exitPrice * (1 + slippageSetting * slippageDir);

  // Calculate PnL
  const realizedPnl = pos.side === "LONG"
    ? (execPrice - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - execPrice) * pos.quantity;

  const closingValue = pos.quantity * execPrice;
  const fee = closingValue * 0.003; // 0.3% pool fee
  const gasCost = estimateGasCost();

  // Update balances
  const quoteAsset = pos.pair.split("/")[1] ?? "USDT";
  const baseAsset = pos.pair.split("/")[0] ?? "UNKNOWN";
  const quoteBal = paperBalances.find((b) => b.asset === quoteAsset);
  const baseBal = paperBalances.find((b) => b.asset === baseAsset);

  if (pos.side === "LONG") {
    if (quoteBal) {
      quoteBal.free += (closingValue - fee - gasCost);
    }
    if (baseBal) {
      baseBal.free -= pos.quantity;
    }
  } else {
    // SHORT close: buy back base, return to balance
    if (quoteBal) {
      quoteBal.free -= (closingValue + fee + gasCost);
    }
    if (baseBal) {
      baseBal.free += pos.quantity;
    }
  }

  // Remove position
  paperDexPositions.delete(rawSymbol);

  paperOrderCounter++;
  const orderId = `paper_dex_close_${Date.now()}_${paperOrderCounter}`;

  return {
    orderId,
    symbol: rawSymbol,
    side: exitSide,
    type: "MARKET",
    quantity: pos.quantity,
    filledQuantity: pos.quantity,
    avgPrice: execPrice,
    status: "FILLED",
    fee: fee + gasCost,
    feeAsset: "USDT",
    timestamp: Date.now(),
    isPaper: true,
    realizedPnl,
    exitPrice: execPrice,
  };
}

/** Estimate gas cost in USD for a DEX swap */
function estimateGasCost(): number {
  const gasPref = getGasPreference();
  // Average Uniswap V3 swap: ~150k gas units
  const gasUnits = 150_000;
  // Gas prices in gwei based on preference
  const gweiByPref: Record<string, number> = {
    fast: 50,
    medium: 25,
    slow: 10,
  };
  const gwei = gweiByPref[gasPref] ?? 25;
  // ETH price ~ $3500 (approximate, will use cached price if available)
  const ethPrice = priceCache.get("ethereum")?.price ?? 3_500;
  // Cost = gasUnits * gwei * 1e-9 * ethPrice
  return gasUnits * gwei * 1e-9 * ethPrice;
}

// ── Fallback prices ────────────────────────────────────────────────

function getDexFallbackPrice(pair: string): number {
  const base = pair.split("/")[0] ?? "";
  const fallbacks: Record<string, number> = {
    BTC: 67_000, WBTC: 67_000, ETH: 3_500, SOL: 170, BNB: 600,
    XRP: 0.60, ADA: 0.45, DOGE: 0.12, AVAX: 35, DOT: 7,
    MATIC: 0.70, LINK: 14, UNI: 8, AAVE: 100, ARB: 1.2,
    OP: 2.5, NEAR: 5, SUI: 1.5, APT: 9,
  };
  const basePrice = fallbacks[base] ?? 100;

  // Cross-rate pairs
  if (pair === "WBTC/ETH") return fallbacks["WBTC"]! / fallbacks["ETH"]!;
  if (pair === "UNI/ETH") return fallbacks["UNI"]! / fallbacks["ETH"]!;
  if (pair === "LINK/ETH") return fallbacks["LINK"]! / fallbacks["ETH"]!;
  if (pair === "AAVE/ETH") return fallbacks["AAVE"]! / fallbacks["ETH"]!;

  return basePrice;
}

// ── Chain-aware helpers ─────────────────────────────────────────────

/** Get the current wallet chain ID */
function getCurrentChainId(): string {
  return getWalletChainId();
}

/** Get the current wallet chain name */
function getCurrentChainName(): string {
  return getWalletChainConfig().name;
}

/** Get the Uniswap V3 router address for the current chain */
function getCurrentRouterAddress(): string {
  return getWalletChainConfig().uniswapV3Router ?? "0xE592427A0AEce92De3Edee1F18E0157C05861564";
}

// ── DEX Adapter Class ──────────────────────────────────────────────

class DexAdapter implements ExchangeAdapter {
  name = "DEX (Uniswap V3)";
  role: ExchangeRole = "trading";
  wsEndpoint = ""; // DEX uses on-chain reads, not WebSocket
  isEnabled = true;
  isLive = false;

  constructor() {
    // DEX adapter is always paper mode — no real API keys needed
    // In the future, could check for wallet connection + RPC URL
  }

  /** Get the current chain config for display purposes */
  getChainConfig(): WalletChainConfig {
    return getWalletChainConfig();
  }

  /** Get the Uniswap V3 router address for the current chain */
  getRouterAddress(): string {
    return getCurrentRouterAddress();
  }

  /** Check if the current chain is a testnet */
  get isTestnet(): boolean {
    return isWalletTestnet();
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  async getPrice(symbol: string): Promise<number> {
    return fetchDexPrice(toDexPair(symbol));
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const pair = toDexPair(symbol);
    const rawPair = getRawSymbol(pair);

    try {
      const midPrice = await fetchDexPrice(pair);
      const slippageSetting = getDexSlippageSetting();

      // Simulate Uniswap V3 order book around mid price
      const levels = Math.min(depth, 10);
      const bids: OrderBookLevel[] = [];
      const asks: OrderBookLevel[] = [];

      for (let i = 0; i < levels; i++) {
        const spread = slippageSetting * ((i + 1) / levels);
        bids.push({
          price: midPrice * (1 - spread - 0.003), // bid below mid - pool fee
          quantity: 0.5 + i * 0.5,
        });
        asks.push({
          price: midPrice * (1 + spread + 0.003), // ask above mid + pool fee
          quantity: 0.5 + i * 0.5,
        });
      }

      return { symbol: rawPair, bids: bids.reverse(), asks, timestamp: Date.now() };
    } catch (err) {
      console.error(`[DEX] OrderBook error for ${rawPair}:`, err);
      return { symbol: rawPair, bids: [], asks: [], timestamp: Date.now() };
    }
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    return dexPaperPlaceOrder(order);
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = paperOrders.get(orderId);
    if (order) {
      order.status = "CANCELLED";
      paperOrders.set(orderId, order);
      return;
    }
    throw new Error(`Order ${orderId} not found on DEX.`);
  }

  async closePaperPosition(symbol: string): Promise<OrderResult & { realizedPnl: number; exitPrice: number }> {
    return dexPaperCloseOrder(symbol);
  }

  getPaperDexPositions(): DexPosition[] {
    return Array.from(paperDexPositions.values());
  }

  async getBalance(): Promise<Balance> {
    ensurePaperBalances();

    // Update USD values for non-stablecoin assets
    const allCoinIds = [...new Set(paperBalances.map(b => {
      const id = baseIdMap[b.asset.toLowerCase()] ?? b.asset.toLowerCase();
      return id;
    }))];

    if (allCoinIds.length > 0) {
      try {
        const prices = await fetchCoinGeckoPrices(allCoinIds);
        for (const bal of paperBalances) {
          const id = baseIdMap[bal.asset.toLowerCase()] ?? bal.asset.toLowerCase();
          if (prices[id] && prices[id] > 0) {
            bal.usdValue = (bal.free + bal.locked) * prices[id];
          } else if (bal.asset === "USDT" || bal.asset === "USDC") {
            bal.usdValue = bal.free + bal.locked;
          }
        }
      } catch { /* keep stale values */ }
    }

    const totalUsd = paperBalances.reduce((sum, b) => sum + b.usdValue, 0);
    return {
      assets: [...paperBalances],
      totalUsdValue: totalUsd,
      timestamp: Date.now(),
      isPaper: true,
    };
  }

  async getOpenOrders(): Promise<Order[]> {
    return Array.from(paperOrders.values()).filter(
      (o) => o.status === "PENDING" || o.status === "PARTIALLY_FILLED",
    );
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let instance: DexAdapter | null = null;

export function getDexAdapter(): DexAdapter {
  if (!instance) {
    instance = new DexAdapter();
  }
  return instance;
}

export { DexAdapter };
export type { DexPosition };
export {
  DEX_PAIRS,
  getDexSlippageSetting,
  getPreferredDex,
  getGasPreference,
};
