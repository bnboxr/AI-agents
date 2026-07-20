import { createServerFn } from "@tanstack/react-start";
import { CHAINS, type ChainConfig } from "./chains";

// ── Types ──────────────────────────────────────────────────────────
export interface ChainStatus {
  id: string;
  name: string;
  nativeToken: string;
  explorer: string;
  online: boolean;
  blockHeight: number | null;
  gasPrice: number | null; // gwei for EVM, native units otherwise
  latency: number | null; // ms
  error?: string;
}

export interface PriceData {
  btc: { usd: number; change24h: number } | null;
  eth: { usd: number; change24h: number } | null;
}

export interface FearGreedData {
  value: number;
  classification: string;
  timestamp: number;
}

// ── RPC Helpers ────────────────────────────────────────────────────

async function rpcCall(url: string, method: string, params: unknown[] = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Per-chain status check ─────────────────────────────────────────

async function checkEVMChain(chain: ChainConfig): Promise<ChainStatus> {
  const start = Date.now();
  try {
    const [blockHex, gasHex] = await Promise.all([
      rpcCall(chain.rpc, 'eth_blockNumber'),
      rpcCall(chain.rpc, 'eth_gasPrice'),
    ]);
    const latency = Date.now() - start;
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: true,
      blockHeight: parseInt(blockHex, 16),
      gasPrice: Math.round(parseInt(gasHex, 16) / 1e9 * 10) / 10, // wei → gwei
      latency,
    };
  } catch (err: any) {
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: false,
      blockHeight: null,
      gasPrice: null,
      latency: Date.now() - start,
      error: err.message || 'Connection failed',
    };
  }
}

async function checkSolanaChain(chain: ChainConfig): Promise<ChainStatus> {
  const start = Date.now();
  try {
    const blockHeight = await rpcCall(chain.rpc, 'getBlockHeight');
    const latency = Date.now() - start;
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: true,
      blockHeight,
      gasPrice: null, // Solana doesn't have gas price in traditional sense
      latency,
    };
  } catch (err: any) {
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: false,
      blockHeight: null,
      gasPrice: null,
      latency: Date.now() - start,
      error: err.message || 'Connection failed',
    };
  }
}

async function checkNearChain(chain: ChainConfig): Promise<ChainStatus> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'status', params: [] }),
    });
    const data = await res.json();
    const latency = Date.now() - start;
    const blockHeight = data?.result?.sync_info?.latest_block_height ?? null;
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: true,
      blockHeight,
      gasPrice: null,
      latency,
    };
  } catch (err: any) {
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: false,
      blockHeight: null,
      gasPrice: null,
      latency: Date.now() - start,
      error: err.message || 'Connection failed',
    };
  }
}

async function checkAptosChain(chain: ChainConfig): Promise<ChainStatus> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLedgerInfo', params: [] }),
    });
    const data = await res.json();
    const latency = Date.now() - start;
    const blockHeight = data?.result?.block_height ?? data?.result?.ledger_version ?? null;
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: true,
      blockHeight,
      gasPrice: null,
      latency,
    };
  } catch (err: any) {
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: false,
      blockHeight: null,
      gasPrice: null,
      latency: Date.now() - start,
      error: err.message || 'Connection failed',
    };
  }
}

async function checkSuiChain(chain: ChainConfig): Promise<ChainStatus> {
  const start = Date.now();
  try {
    const seq = await rpcCall(chain.rpc, 'sui_getLatestCheckpointSequenceNumber');
    const latency = Date.now() - start;
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: true,
      blockHeight: parseInt(seq, 10),
      gasPrice: null,
      latency,
    };
  } catch (err: any) {
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: false,
      blockHeight: null,
      gasPrice: null,
      latency: Date.now() - start,
      error: err.message || 'Connection failed',
    };
  }
}

async function checkTronChain(chain: ChainConfig): Promise<ChainStatus> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${chain.rpc}/wallet/getnowblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    const latency = Date.now() - start;
    const blockHeight = data?.block_header?.raw_data?.number ?? null;
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: true,
      blockHeight,
      gasPrice: null,
      latency,
    };
  } catch (err: any) {
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: false,
      blockHeight: null,
      gasPrice: null,
      latency: Date.now() - start,
      error: err.message || 'Connection failed',
    };
  }
}

async function checkCosmosChain(chain: ChainConfig): Promise<ChainStatus> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${chain.rpc}/abci_info?`, {}, 8000);
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Non-JSON response from Cosmos RPC");
    }
    const latency = Date.now() - start;
    const blockHeight = data?.result?.response?.last_block_height
      ? parseInt(data.result.response.last_block_height, 10)
      : null;
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: true,
      blockHeight,
      gasPrice: null,
      latency,
    };
  } catch (err: any) {
    return {
      id: chain.id,
      name: chain.name,
      nativeToken: chain.nativeToken,
      explorer: chain.explorer,
      online: false,
      blockHeight: null,
      gasPrice: null,
      latency: Date.now() - start,
      error: err.message || 'Connection failed',
    };
  }
}

/** XRP Ledger uses WebSocket (wss://) which is incompatible with HTTP fetch.
 *  We cannot easily query XRP ledger status via a simple HTTP REST call,
 *  so we gracefully return N/A rather than showing a misleading error. */
async function checkXrpChain(chain: ChainConfig): Promise<ChainStatus> {
  return {
    id: chain.id,
    name: chain.name,
    nativeToken: chain.nativeToken,
    explorer: chain.explorer,
    online: true, // Assume online — WS check requires persistent connection
    blockHeight: null,
    gasPrice: null,
    latency: null,
  };
}

export async function checkChain(chain: ChainConfig): Promise<ChainStatus> {
  switch (chain.type) {
    case 'evm': return checkEVMChain(chain);
    case 'solana': return checkSolanaChain(chain);
    case 'near': return checkNearChain(chain);
    case 'aptos': return checkAptosChain(chain);
    case 'sui': return checkSuiChain(chain);
    case 'tron': return checkTronChain(chain);
    case 'cosmos': return checkCosmosChain(chain);
    case 'xrp': return checkXrpChain(chain);
    default: return checkEVMChain(chain);
  }
}

// ── Server Functions ───────────────────────────────────────────────

export const getAllChainStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const results = await Promise.all(CHAINS.map(checkChain));
  return results.sort((a, b) => a.name.localeCompare(b.name));
});

export const getChainStatus = createServerFn({ method: 'POST' }).handler(async ({ data }: { data: string }) => {
  // Client-side only: TanStack Start wraps the argument in { data: ... }
  const chain = CHAINS.find((c) => c.id === data);
  if (!chain) throw new Error(`Chain not found: ${data}`);
  return checkChain(chain);
});

// ── Price Feeds ────────────────────────────────────────────────────

export const getPrices = createServerFn({ method: 'GET' }).handler(async (): Promise<PriceData> => {
  try {
    const res = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true',
      {},
      6000
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      btc: data.bitcoin ? { usd: data.bitcoin.usd, change24h: data.bitcoin.usd_24h_change ?? 0 } : null,
      eth: data.ethereum ? { usd: data.ethereum.usd, change24h: data.ethereum.usd_24h_change ?? 0 } : null,
    };
  } catch (err) {
    console.warn("[Blockchain] getPrices CoinGecko failed:", err);
    return { btc: null, eth: null };
  }
});

// ── Fear & Greed Index ─────────────────────────────────────────────

export const getFearGreed = createServerFn({ method: 'GET' }).handler(async (): Promise<FearGreedData | null> => {
  try {
    const res = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1', {}, 6000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const item = data?.data?.[0];
    if (!item) return null;
    return {
      value: parseInt(item.value, 10),
      classification: item.value_classification || 'Neutral',
      timestamp: parseInt(item.timestamp, 10),
    };
  } catch (err) {
    console.warn("[Blockchain] getFearGreed failed:", err);
    return null;
  }
});

// ── Arbitrage Scanner ──────────────────────────────────────────────

export interface ArbitrageOpportunity {
  pair: string;
  sourceChain: string;
  destChain: string;
  sourcePrice: number;
  destPrice: number;
  profitPct: number;
  estTime: string;
}

export const getArbitrageOpportunities = createServerFn({ method: 'GET' }).handler(async (): Promise<ArbitrageOpportunity[]> => {
  // Cross-chain arbitrage requires per-chain DEX price data.
  // CoinGecko returns aggregated prices — not suitable for cross-chain spread detection.
  // No real DEX data available: return empty results (no fabricated data).
  console.warn("[Blockchain] No real per-chain DEX price data available — cannot compute arbitrage opportunities");
  return [];
});

// ── Mempool Watcher ────────────────────────────────────────────────

export interface MempoolTx {
  hash: string;
  from: string;
  to: string;
  value: number; // in ETH
  chain: string;
  timestamp: number;
}

/** Etherscan API transaction shape (raw response). */
interface EtherscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
}

interface EtherscanResponse {
  status: string;
  message?: string;
  result?: EtherscanTx[];
}

export const getMempoolTxs = createServerFn({ method: 'GET' }).handler(async (): Promise<MempoolTx[]> => {
  // Query public mempool data from Blocknative or similar
  // For now, we use Etherscan's public API for recent large txs as an approximation
  try {
    const res = await fetchWithTimeout(
      'https://api.etherscan.io/api?module=account&action=txlist&address=0x0000000000000000000000000000000000000000&startblock=0&endblock=99999999&page=1&offset=5&sort=desc',
      {},
      5000
    );
    // Etherscan requires API key for real data, so fall back gracefully
    if (!res.ok) throw new Error('Mempool API unavailable');
    const data = await res.json() as unknown as EtherscanResponse;
    if (data.status !== '1' || !data.result) throw new Error('No mempool data');

    return data.result.slice(0, 5).map((tx: EtherscanTx): MempoolTx => ({
      hash: tx.hash?.slice(0, 10) + '...' || '0x...',
      from: tx.from?.slice(0, 8) + '...' || '0x...',
      to: tx.to?.slice(0, 8) + '...' || '0x...',
      value: parseFloat(tx.value || '0') / 1e18,
      chain: 'ethereum',
      timestamp: parseInt(tx.timeStamp || '0', 10),
    }));
  } catch (err) {
    console.warn("[Blockchain] getMempoolTxs failed:", err);
    return [];
  }
});
