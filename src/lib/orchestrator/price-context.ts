// ── Price Context Builder ───────────────────────────────────────────
// Builds a PriceContext from live WebSocket cache + Binance REST OHLCV.
// Used by the dispatcher to feed runAgentAnalysis with real market data.

import { getPrice } from "../ws/market-data";
import type { PriceContext } from "../agents/orchestrator";
import type { OHLCVBar } from "../agents/market";

// ── Chain ID → Binance Symbol Mapping ──────────────────────────────

const CHAIN_TO_BINANCE_SYMBOL: Record<string, string> = {
  ethereum: "ETHUSDT",
  solana: "SOLUSDT",
  bnb: "BNBUSDT",
  polygon: "MATICUSDT",
  arbitrum: "ETHUSDT",   // Arbitrum uses ETH as native token
  optimism: "ETHUSDT",   // Optimism uses ETH as native token
  base: "ETHUSDT",       // Base uses ETH as native token
  avalanche: "AVAXUSDT",
  fantom: "FTMUSDT",
  gnosis: "XDAIUSDT",
  zksync: "ETHUSDT",     // zkSync uses ETH as native token
  linea: "ETHUSDT",      // Linea uses ETH as native token
  scroll: "ETHUSDT",     // Scroll uses ETH as native token
  mantle: "MNTUSDT",
  celo: "CELOUSDT",
  moonbeam: "GLMRUSDT",
  near: "NEARUSDT",
  aptos: "APTUSDT",
  sui: "SUIUSDT",
  tron: "TRXUSDT",
};

// ── Chain ID → Token Symbol (short) ────────────────────────────────

const CHAIN_TO_TOKEN: Record<string, string> = {
  ethereum: "ETH",
  solana: "SOL",
  bnb: "BNB",
  polygon: "MATIC",
  arbitrum: "ETH",
  optimism: "ETH",
  base: "ETH",
  avalanche: "AVAX",
  fantom: "FTM",
  gnosis: "XDAI",
  zksync: "ETH",
  linea: "ETH",
  scroll: "ETH",
  mantle: "MNT",
  celo: "CELO",
  moonbeam: "GLMR",
  near: "NEAR",
  aptos: "APT",
  sui: "SUI",
  tron: "TRX",
};

// ── Binance OHLCV Fetch ────────────────────────────────────────────

interface BinanceKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

function parseBinanceKlines(raw: unknown[][]): BinanceKline[] {
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
    closeTime: Number(k[6]),
  }));
}

async function fetchOHLCV(symbol: string, interval = "5m", limit = 50): Promise<OHLCVBar[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[PriceContext] Binance OHLCV fetch failed: HTTP ${res.status} for ${symbol}`);
      return [];
    }
    const raw = await res.json() as unknown[][];
    if (!Array.isArray(raw) || raw.length === 0) {
      console.warn(`[PriceContext] Binance OHLCV empty response for ${symbol}`);
      return [];
    }
    const klines = parseBinanceKlines(raw);
    return klines.map((k) => ({
      timestamp: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
  } catch (err) {
    console.warn(`[PriceContext] Binance OHLCV fetch error for ${symbol}:`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public Builder ─────────────────────────────────────────────────

export async function buildPriceContext(chainId: string): Promise<PriceContext | null> {
  const binanceSymbol = CHAIN_TO_BINANCE_SYMBOL[chainId];
  const token = CHAIN_TO_TOKEN[chainId] ?? chainId.toUpperCase();

  if (!binanceSymbol) {
    console.warn(`[PriceContext] No Binance symbol mapping for chain: ${chainId}`);
    return null;
  }

  // Get current price from WebSocket cache
  const currentPrice = getPrice(token);
  if (currentPrice === null) {
    console.warn(`[PriceContext] No live price for ${token} — skipping agent analysis for ${chainId}`);
    return null;
  }

  // Fetch OHLCV from Binance REST
  const ohlcv = await fetchOHLCV(binanceSymbol);

  // Compute 24h metrics from OHLCV data
  let change24h = 0;
  let volume24h = 0;
  let high24h = currentPrice;
  let low24h = currentPrice;
  let atr: number | undefined;

  if (ohlcv.length > 0) {
    const firstBar = ohlcv[0];
    change24h = firstBar.open > 0
      ? ((currentPrice - firstBar.open) / firstBar.open) * 100
      : 0;

    // 24h volume: sum all bar volumes
    volume24h = ohlcv.reduce((sum, bar) => sum + bar.volume, 0);

    // 24h high/low across all bars
    high24h = Math.max(...ohlcv.map((b) => b.high));
    low24h = Math.min(...ohlcv.map((b) => b.low));

    // Simple ATR over the available bars
    if (ohlcv.length >= 2) {
      let trueRangeSum = 0;
      for (let i = 1; i < ohlcv.length; i++) {
        const high = ohlcv[i].high;
        const low = ohlcv[i].low;
        const prevClose = ohlcv[i - 1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRangeSum += tr;
      }
      atr = trueRangeSum / (ohlcv.length - 1);
    }
  }

  console.log(
    `[PriceContext] Built for ${binanceSymbol} (chain: ${chainId}) — price $${currentPrice.toFixed(2)}, ` +
    `${ohlcv.length} OHLCV bars, 24h change ${change24h.toFixed(2)}%, vol $${volume24h.toFixed(0)}`,
  );

  return {
    token,
    chainId,
    currentPrice,
    change24h,
    volume24h,
    high24h,
    low24h,
    ohlcv: ohlcv.length > 0 ? ohlcv : undefined,
    atr,
  };
}
