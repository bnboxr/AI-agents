import { createServerFn } from "@tanstack/react-start";

// ── Types ──────────────────────────────────────────────────────────

export interface PriceFeedResult {
  usd: number;
  change24h: number;
  source: 'coingecko' | '1inch' | 'uniswap' | 'fallback';
  timestamp: number;
}

export interface MultiPriceResult {
  [tokenId: string]: { usd: number; change24h: number } | null;
}

// ── Cache ──────────────────────────────────────────────────────────

const priceCache = new Map<string, { data: PriceFeedResult; ts: number }>();
const CACHE_TTL = 30_000; // 30 seconds
const REQUEST_TIMEOUT = 5_000;

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Source 1: CoinGecko ───────────────────────────────────────────

async function tryCoinGecko(coingeckoId: string): Promise<PriceFeedResult | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_24hr_change=true`,
      {},
      5000
    );
    if (!res.ok) return null;
    const data = await res.json();
    const token = data[coingeckoId];
    if (!token?.usd) return null;
    return {
      usd: token.usd,
      change24h: token.usd_24h_change ?? 0,
      source: 'coingecko',
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

// ── Source 2: 1inch Price API ─────────────────────────────────────

// 1inch token addresses on Ethereum mainnet
const ONEINCH_TOKEN_MAP: Record<string, string> = {
  ethereum: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // native ETH
  'wrapped-bitcoin': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  'usd-coin': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'tether': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'dai': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  'matic-network': '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0',
  'avalanche-2': '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  'fantom': '0x4E15361FD6b4BB609Fa63C81A2be19d873717870',
};

async function try1Inch(coingeckoId: string): Promise<PriceFeedResult | null> {
  const tokenAddr = ONEINCH_TOKEN_MAP[coingeckoId];
  if (!tokenAddr) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.1inch.dev/price/v1.0/1/${tokenAddr}`,
      { headers: { 'Accept': 'application/json' } },
      4000
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data?.price ?? '0');
    if (!price || price <= 0) return null;
    return {
      usd: price,
      change24h: 0,
      source: '1inch',
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

// ── Source 3: Uniswap V3 Pool Price Oracle ─────────────────────────

// Use Uniswap V3 ETH/USDC pool as price oracle
const UNISWAP_V3_ETH_USDC = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';

async function tryUniswapV3(coingeckoId: string): Promise<PriceFeedResult | null> {
  if (coingeckoId !== 'ethereum') return null; // Only ETH for now
  try {
    // Query the Uniswap V3 subgraph for the ETH/USDC pool price
    const query = {
      query: `{
        pool(id: "${UNISWAP_V3_ETH_USDC.toLowerCase()}") {
          token0Price
          token1Price
          token0 { symbol }
        }
      }`
    };
    const res = await fetchWithTimeout(
      'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      },
      4000
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pool = data?.data?.pool;
    if (!pool) return null;
    // token0 is USDC, token1 is WETH (in this pool)
    // token0Price = price of token0 in token1, so 1/token0Price = ETH in USDC
    const price = parseFloat(pool.token1Price);
    if (!price || price <= 0) return null;
    return {
      usd: Math.round(price * 100) / 100,
      change24h: 0,
      source: 'uniswap',
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

// ── Robust Price Fetch with Fallback Chain ────────────────────────

export async function getRobustPrice(coingeckoId: string): Promise<PriceFeedResult | null> {
  // Check cache
  const cached = priceCache.get(coingeckoId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  // Try sources in order
  const sources = [tryCoinGecko, try1Inch, tryUniswapV3];
  
  for (const source of sources) {
    const result = await source(coingeckoId);
    if (result) {
      priceCache.set(coingeckoId, { data: result, ts: Date.now() });
      return result;
    }
  }

  // Use stale cache if available
  if (cached) return cached.data;
  
  return null;
}

// ── Multi-price fetch ─────────────────────────────────────────────

export async function getRobustMultiPrices(coingeckoIds: string[]): Promise<MultiPriceResult> {
  const result: MultiPriceResult = {};
  
  // Try CoinGecko bulk first (most efficient)
  try {
    const ids = coingeckoIds.join(',');
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      {},
      6000
    );
    if (res.ok) {
      const data = await res.json();
      for (const id of coingeckoIds) {
        if (data[id]?.usd) {
          result[id] = { usd: data[id].usd, change24h: data[id].usd_24h_change ?? 0 };
          priceCache.set(id, {
            data: { usd: data[id].usd, change24h: data[id].usd_24h_change ?? 0, source: 'coingecko', timestamp: Date.now() },
            ts: Date.now(),
          });
        }
      }
      // If we got all, return
      if (Object.keys(result).length === coingeckoIds.length) return result;
    }
  } catch { /* fall through */ }

  // For any missing, try individual fallback
  const missing = coingeckoIds.filter(id => !result[id]);
  for (const id of missing) {
    const price = await getRobustPrice(id);
    if (price) {
      result[id] = { usd: price.usd, change24h: price.change24h };
    } else {
      result[id] = null;
    }
  }

  return result;
}

// ── Server Functions ──────────────────────────────────────────────

export const fetchPriceRobust = createServerFn({ method: 'GET' }).handler(async (): Promise<{
  btc: { usd: number; change24h: number } | null;
  eth: { usd: number; change24h: number } | null;
}> => {
  const prices = await getRobustMultiPrices(['bitcoin', 'ethereum']);
  return {
    btc: prices['bitcoin'],
    eth: prices['ethereum'],
  };
});

export const fetchAllNativePricesRobust = createServerFn({ method: 'GET' }).handler(async (): Promise<MultiPriceResult> => {
  const ids = [
    'bitcoin', 'ethereum', 'binancecoin', 'matic-network',
    'avalanche-2', 'fantom', 'solana', 'near', 'aptos',
    'sui', 'tron', 'mantle', 'celo', 'moonbeam',
  ];
  return getRobustMultiPrices(ids);
});
