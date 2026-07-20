// ── WebSocket Market Data Manager ───────────────────────────────────
// Connects to Binance WebSocket for real-time price streams.
// Free, no auth needed. Falls back to CoinGecko REST on failure.
//
// Symbols are mapped from internal token names to Binance USDT pairs.

import { recordMarketPrice } from "../risk-engine";

// ── Types ──────────────────────────────────────────────────────────

export interface PriceTick {
  symbol: string;   // internal symbol (e.g. "BTC", "ETH")
  price: number;
  timestamp: number;
  volume: number;   // trade quantity
}

export type PriceCallback = (tick: PriceTick) => void;

export interface MarketDataState {
  connected: boolean;
  source: "binance-ws" | "coingecko-poll";
  symbolCount: number;
  lastUpdate: number;
  reconnectAttempts: number;
}

// ── Symbol Mapping: internal → Binance stream name ──────────────────

const SYMBOL_TO_BINANCE: Record<string, string> = {
  BTC: "btcusdt",
  ETH: "ethusdt",
  SOL: "solusdt",
  BNB: "bnbusdt",
  XRP: "xrpusdt",
  ADA: "adausdt",
  DOGE: "dogeusdt",
  AVAX: "avaxusdt",
  DOT: "dotusdt",
  MATIC: "maticusdt",
  LINK: "linkusdt",
  UNI: "uniusdt",
  AAVE: "aaveusdt",
  ARB: "arbusdt",
  OP: "opusdt",
  NEAR: "nearusdt",
  SUI: "suiusdt",
  APT: "aptusdt",
};

const BINANCE_TO_SYMBOL: Record<string, string> = {};
for (const [sym, pair] of Object.entries(SYMBOL_TO_BINANCE)) {
  BINANCE_TO_SYMBOL[pair] = sym;
}

// ── CoinGecko ID mapping for fallback ──────────────────────────────

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  ARB: "arbitrum",
  OP: "optimism",
  NEAR: "near",
  SUI: "sui",
  APT: "aptos",
};

// ── Constants ──────────────────────────────────────────────────────

const BINANCE_WS_BASE = "wss://stream.binance.com:9443/stream";
const MAX_STREAMS_PER_CONN = 20;
const RING_BUFFER_CAP = 1000;
const COINGECKO_POLL_MS = 15_000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

// ── Price Cache ────────────────────────────────────────────────────

interface CachedPrice {
  price: number;
  timestamp: number;
}

const priceCache = new Map<string, CachedPrice>();
const priceHistory = new Map<string, PriceTick[]>();
const subscribers = new Set<PriceCallback>();

// ── State ──────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let coingeckoTimer: ReturnType<typeof setInterval> | null = null;
let isUsingFallback = false;
let trackedSymbols: string[] = [];

// ── Ring Buffer ────────────────────────────────────────────────────

function pushHistory(tick: PriceTick): void {
  let buffer = priceHistory.get(tick.symbol);
  if (!buffer) {
    buffer = [];
    priceHistory.set(tick.symbol, buffer);
  }
  buffer.push(tick);
  if (buffer.length > RING_BUFFER_CAP) {
    buffer.shift();
  }
}

// ── Subscriber Management ──────────────────────────────────────────

function notifySubscribers(tick: PriceTick): void {
  for (const cb of subscribers) {
    try {
      cb(tick);
    } catch (err) {
      console.warn("[MarketData] subscriber callback error:", err);
      // subscriber errors shouldn't break the pipe
    }
  }
}

// ── Binance WebSocket ──────────────────────────────────────────────

function buildStreamUrl(symbols: string[]): string {
  const streams = symbols
    .map((s) => SYMBOL_TO_BINANCE[s])
    .filter(Boolean)
    .map((pair) => `${pair}@trade`)
    .join("/");
  return `${BINANCE_WS_BASE}?streams=${streams}`;
}

function connectBinance(symbols: string[]): void {
  if (symbols.length === 0) return;
  trackedSymbols = [...symbols];

  const url = buildStreamUrl(symbols.slice(0, MAX_STREAMS_PER_CONN));

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(`[MarketData] ✓ Binance WebSocket connected (${symbols.length} symbols)`);
      reconnectAttempts = 0;
      isUsingFallback = false;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string);
        if (!raw?.data) return;
        const trade = raw.data;
        const pair: string = trade.s || "";
        const symbol = BINANCE_TO_SYMBOL[pair];
        if (!symbol) return;

        const price = parseFloat(trade.p);
        const volume = parseFloat(trade.q);
        const timestamp = trade.T || Date.now();

        if (isNaN(price) || price <= 0) return;

        const tick: PriceTick = { symbol, price, timestamp, volume };

        // Update cache
        priceCache.set(symbol, { price, timestamp });
        pushHistory(tick);
        notifySubscribers(tick);

        // Feed live price into circuit breaker
        recordMarketPrice(symbol, price);
      } catch (err) {
        console.warn("[MarketData] onmessage parse error:", err);
        // malformed message — skip
      }
    };

    ws.onclose = (event) => {
      console.warn(`[MarketData] Binance WebSocket closed (code=${event.code})`);
      ws = null;
      scheduleReconnect(symbols);
    };

    ws.onerror = () => {
      // onclose will fire after this
      console.error("[MarketData] Binance WebSocket error");
    };
  } catch (err) {
    console.error("[MarketData] Failed to create WebSocket:", err);
    ws = null;
    switchToFallback(symbols);
  }
}

// ── Reconnection Logic ─────────────────────────────────────────────

function scheduleReconnect(symbols: string[]): void {
  if (reconnectTimer) return;

  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_MS,
  );
  reconnectAttempts++;

  console.log(`[MarketData] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isUsingFallback) {
      connectBinance(symbols);
    }
  }, delay);
}

// ── CoinGecko Fallback ─────────────────────────────────────────────

async function pollCoinGecko(symbols: string[]): Promise<void> {
  const coingeckoIds = symbols
    .map((s) => SYMBOL_TO_COINGECKO[s])
    .filter(Boolean);

  if (coingeckoIds.length === 0) return;

  try {
    const ids = coingeckoIds.join(",");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return;

    const data = await res.json();
    const now = Date.now();

    for (const symbol of symbols) {
      const cgId = SYMBOL_TO_COINGECKO[symbol];
      if (!cgId || !data[cgId]?.usd) continue;

      const price = data[cgId].usd;
      const tick: PriceTick = { symbol, price, timestamp: now, volume: 0 };

      priceCache.set(symbol, { price, timestamp: now });
      pushHistory(tick);
      notifySubscribers(tick);

      // Feed live price into circuit breaker (fallback path)
      recordMarketPrice(symbol, price);
    }

    // If we're in fallback and WebSocket comes back, try reconnecting
    if (isUsingFallback && reconnectAttempts < 10) {
      // Periodically attempt WS reconnection
      if (reconnectAttempts % 4 === 0) {
        attemptWsRecovery(symbols);
      }
    }
  } catch (err) {
    console.warn("[MarketData] pollCoinGecko failed:", err);
    // CoinGecko poll failed — will retry on next interval
  }
}

function attemptWsRecovery(symbols: string[]): void {
  if (ws) return; // already connected
  console.log("[MarketData] Attempting WebSocket recovery...");
  connectBinance(symbols);
}

function switchToFallback(symbols: string[]): void {
  if (coingeckoTimer) return; // already in fallback

  isUsingFallback = true;
  console.log("[MarketData] Switching to CoinGecko REST fallback (15s polling)");

  // Initial poll
  pollCoinGecko(symbols);

  // Regular polling
  coingeckoTimer = setInterval(() => {
    pollCoinGecko(symbols);
  }, COINGECKO_POLL_MS);
}

function stopCoinGeckoPolling(): void {
  if (coingeckoTimer) {
    clearInterval(coingeckoTimer);
    coingeckoTimer = null;
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Start the market data stream for the given symbols.
 * Connects to Binance WebSocket; falls back to CoinGecko REST if needed.
 */
export function startMarketData(symbols: string[]): void {
  if (symbols.length === 0) return;

  // Filter to only supported symbols
  const supported = symbols.filter((s) => SYMBOL_TO_BINANCE[s]);
  if (supported.length === 0) {
    console.warn("[MarketData] No supported symbols to track");
    return;
  }

  console.log(`[MarketData] Starting market data for ${supported.length} symbols...`);
  connectBinance(supported);
}

/**
 * Stop the market data stream and clean up.
 */
export function stopMarketData(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  stopCoinGeckoPolling();

  if (ws) {
    ws.onclose = null; // prevent reconnect
    ws.close();
    ws = null;
  }

  isUsingFallback = false;
  reconnectAttempts = 0;
  console.log("[MarketData] Stopped");
}

/**
 * Synchronously get the latest price for a symbol from cache.
 * Returns null if no data available yet.
 */
export function getPrice(symbol: string): number | null {
  const cached = priceCache.get(symbol.toUpperCase());
  if (!cached) return null;
  return cached.price;
}

/**
 * Get the full cached price entry (price + timestamp).
 */
export function getPriceEntry(symbol: string): CachedPrice | null {
  return priceCache.get(symbol.toUpperCase()) ?? null;
}

/**
 * Subscribe to real-time price ticks for all tracked symbols.
 * Callback receives every tick from every symbol.
 * Returns an unsubscribe function.
 */
export function subscribeToPrices(callback: PriceCallback): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Get price history for a symbol from the ring buffer.
 * @param symbol - The token symbol (e.g. "BTC")
 * @param limit - Max number of ticks to return (default: 100)
 */
export function getPriceHistory(symbol: string, limit = 100): PriceTick[] {
  const buffer = priceHistory.get(symbol.toUpperCase());
  if (!buffer) return [];
  return buffer.slice(-limit);
}

/**
 * Get the current state of the market data manager.
 */
export function getMarketDataState(): MarketDataState {
  return {
    connected: ws !== null && ws.readyState === WebSocket.OPEN,
    source: isUsingFallback ? "coingecko-poll" : "binance-ws",
    symbolCount: trackedSymbols.length,
    lastUpdate: Math.max(
      ...Array.from(priceCache.values()).map((p) => p.timestamp),
      0,
    ),
    reconnectAttempts,
  };
}

/**
 * Check if a specific symbol is being tracked.
 */
export function isSymbolTracked(symbol: string): boolean {
  return trackedSymbols.includes(symbol.toUpperCase());
}

/**
 * Get all currently tracked symbols.
 */
export function getTrackedSymbols(): string[] {
  return [...trackedSymbols];
}
