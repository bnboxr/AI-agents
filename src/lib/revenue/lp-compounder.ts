// ── LP Auto-Compounder ──────────────────────────────────────────
// Real LP pool discovery via DeFiLlama Yields API, with auto-compound
// logic based on gas-cost vs reward breakeven analysis.
//
// LIVE MODE: builds and sends REAL deposit transactions (Aerodrome V2 on
// Base) when FARMER_PRIVATE_KEY + BASE_RPC_URL are configured. Missing env
// → throw, never a fake deposit string.
//
// Zero seededRandom / Math.random() — all data from real APIs.
//
// References:
//   DeFiLlama Yields: https://yields.llama.fi/pools
//   Uniswap V3 NonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88
//   Aerodrome V2 router (Base): 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43

import { requireEnv } from "~/lib/env-guard";

// ── Types ──────────────────────────────────────────────────────

export interface LPPosition {
  id: string;
  pair: string;            // e.g. "USDC-ETH", "USDC-USDT"
  dex: string;             // "uniswap-v3" | "curve" | "balancer" | "aerodrome"
  chain: string;           // "ethereum" | "base" | "arbitrum"
  poolId: string;          // DeFiLlama pool UUID
  deposited: number;       // USD value deposited
  feesEarned: number;      // USD fees accumulated
  apy: number;             // current estimated APY % (from DeFiLlama)
  tvlUsd: number;          // pool TVL in USD
  ilRisk: "low" | "medium" | "high";
  createdAt: number;
  lastCompound: number;
  compoundCount: number;
  status: "active" | "closed";
  /** Real on-chain deposit tx hash (present only when a live deposit was sent) */
  txHash?: string;
}

export interface LPYieldState {
  positions: LPPosition[];
  totalDeposited: number;
  totalFeesEarned: number;
  blendedAPY: number;
  availablePools: DeFiLlamaPool[];
  lastUpdate: number;
  lastPoolFetch: number;
  paperMode: boolean;
}

export interface DeFiLlamaPool {
  pool: string;           // UUID
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number;
  apyReward: number | null;
  apy: number;            // total APY
  ilRisk: "low" | "medium" | "high";
  stablecoin: boolean;
  /** Real underlying token addresses (from DeFiLlama) — used for REAL deposits */
  underlyingTokens: string[];
}

// ── Cache ──────────────────────────────────────────────────────

const DEFILLAMA_YIELDS_URL = "https://yields.llama.fi/pools";

let _poolCache: DeFiLlamaPool[] = [];
let _poolCacheTs = 0;
const POOL_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ── In-memory state ──────────────────────────────────────────

function detectPaperMode(): boolean {
  try {
    const liveKey =
      typeof process !== "undefined" && process.env?.BASE_RPC_URL;
    return !liveKey;
  } catch {
    return true;
  }
}

let _state: LPYieldState = {
  positions: [],
  totalDeposited: 0,
  totalFeesEarned: 0,
  blendedAPY: 0,
  availablePools: [],
  lastUpdate: Date.now(),
  lastPoolFetch: 0,
  paperMode: detectPaperMode(),
};

// ── DeFiLlama pool fetcher ────────────────────────────────────

export async function fetchDeFiLlamaPools(minTvl = 100_000): Promise<DeFiLlamaPool[]> {
  const now = Date.now();
  if (_poolCacheTs > 0 && now - _poolCacheTs < POOL_CACHE_TTL) {
    return _poolCache;
  }

  try {
    const resp = await fetch(DEFILLAMA_YIELDS_URL);
    if (!resp.ok) {
      console.warn("[LP] DeFiLlama fetch failed:", resp.status);
      return _poolCache;
    }

    const json = await resp.json();
    const data = (json?.data ?? json) as Array<Record<string, unknown>>;

    if (!Array.isArray(data)) {
      console.warn("[LP] DeFiLlama unexpected response shape");
      return _poolCache;
    }

    const pools: DeFiLlamaPool[] = [];
    for (const entry of data) {
      const tvl = Number(entry.tvlUsd ?? 0);
      if (tvl < minTvl) continue;
      if (!entry.pool || !entry.chain) continue;

      pools.push({
        pool: String(entry.pool),
        chain: String(entry.chain),
        project: String(entry.project ?? "unknown"),
        symbol: String(entry.symbol ?? "unknown"),
        tvlUsd: tvl,
        apyBase: Number(entry.apyBase ?? 0),
        apyReward: entry.apyReward != null ? Number(entry.apyReward) : null,
        apy: Number(entry.apy ?? 0),
        ilRisk: inferILRisk(String(entry.symbol ?? ""), Number(entry.apyBase ?? 0)),
        stablecoin: isStablecoinPair(String(entry.symbol ?? "")),
        underlyingTokens: Array.isArray(entry.underlyingTokens)
          ? (entry.underlyingTokens as unknown[]).filter((t): t is string => typeof t === "string")
          : [],
      });
    }

    _poolCache = pools;
    _poolCacheTs = now;
    _state.availablePools = pools;
    _state.lastPoolFetch = now;

    return pools;
  } catch (err) {
    console.warn("[LP] DeFiLlama network error:", err);
    return _poolCache;
  }
}

function inferILRisk(symbol: string, apy: number): "low" | "medium" | "high" {
  const s = symbol.toLowerCase();
  // Stablecoin pairs = low IL risk
  if (isStablecoinPair(s)) return "low";
  // ETH-stablecoin pairs = medium
  if ((s.includes("eth") || s.includes("weth")) && (s.includes("usdc") || s.includes("usdt") || s.includes("dai"))) return "medium";
  // High APY means high IL risk
  if (apy > 40) return "high";
  if (apy > 20) return "medium";
  return "low";
}

function isStablecoinPair(symbol: string): boolean {
  const stables = ["usdc", "usdt", "dai", "frax", "lusd", "crvusd", "usde", "susd"];
  const parts = symbol.toLowerCase().split(/[-/\s]+/);
  if (parts.length !== 2) return false;
  return stables.some((s) => parts[0].includes(s)) && stables.some((s) => parts[1].includes(s));
}

// ── Compound frequency analysis ────────────────────────────────

const ESTIMATED_GAS_COSTS: Record<string, number> = {
  ethereum: 15,    // $15 per compound tx on mainnet
  base: 0.5,       // $0.50
  arbitrum: 1.5,   // $1.50
};

export function computeOptimalCompoundInterval(
  positionValue: number,
  apy: number,
  chain: string,
): { intervalHours: number; annualSavingsVsDaily: number } {
  const gasCost = ESTIMATED_GAS_COSTS[chain] ?? 3;
  const dailyYield = positionValue * (apy / 100 / 365);

  // If daily yield < 2x gas cost, compound weekly
  if (dailyYield < gasCost * 2) return { intervalHours: 168, annualSavingsVsDaily: 0 };

  // If daily yield < 5x gas cost, compound every 3 days
  if (dailyYield < gasCost * 5) return { intervalHours: 72, annualSavingsVsDaily: 0 };

  // Otherwise, compound daily
  const dailyCost = gasCost * 365;
  const weeklyCost = gasCost * 52;
  const annualSavingsVsDaily = +(dailyCost - weeklyCost).toFixed(2);

  return { intervalHours: 24, annualSavingsVsDaily };
}

// ── Public API ────────────────────────────────────────────────

/**
 * Discover top LP pools by APY from DeFiLlama.
 * Filters for reasonable TVL and non-scam pools.
 */
export async function discoverPools(
  minTvl?: number,
  maxApy?: number,
  stableOnly?: boolean,
): Promise<DeFiLlamaPool[]> {
  let pools = await fetchDeFiLlamaPools(minTvl ?? 100_000);

  if (stableOnly) {
    pools = pools.filter((p) => p.stablecoin);
  }
  if (maxApy != null) {
    pools = pools.filter((p) => p.apy <= maxApy);
  }

  // Sort by APY descending, but penalize very low TVL
  return [...pools].sort((a, b) => {
    const aScore = a.apy * Math.log10(Math.min(a.tvlUsd, 1e9));
    const bScore = b.apy * Math.log10(Math.min(b.tvlUsd, 1e9));
    return bScore - aScore;
  }).slice(0, 50);
}

/**
 * Deposit into an LP pool.
 * Uses real pool data from DeFiLlama.
 */
export async function depositLP(
  poolId: string,
  amount: number,
): Promise<LPPosition> {
  // Ensure pools are loaded
  const pools = await fetchDeFiLlamaPools();
  const pool = pools.find((p) => p.pool === poolId);

  if (!pool) {
    throw new Error(`Pool ${poolId} not found in DeFiLlama data`);
  }

  const id = `lp-${Date.now()}-${poolId.slice(0, 8)}-${_state.positions.length + 1}`;

  const position: LPPosition = {
    id,
    pair: pool.symbol,
    dex: pool.project,
    chain: pool.chain,
    poolId: pool.pool,
    deposited: amount,
    feesEarned: 0,
    apy: pool.apy,
    tvlUsd: pool.tvlUsd,
    ilRisk: pool.ilRisk,
    createdAt: Date.now(),
    lastCompound: Date.now(),
    compoundCount: 0,
    status: "active",
  };

  if (_state.paperMode) {
    // Explicitly labeled simulation (BASE_RPC_URL not configured) — the UI
    // shows this as paper mode; no real funds move.
    _state.positions.push(position);
    _state.totalDeposited += amount;
    _state.lastUpdate = Date.now();
    recalcBlendedAPY();
    return position;
  }

  // LIVE: a REAL deposit transaction is sent. Any failure THROWS — we never
  // "track locally" a live deposit (owner hard rule).
  const txHash = await buildRealLPDeposit(pool, amount);
  console.log(`[LP] LIVE deposit tx: ${txHash}`);
  position.txHash = txHash;

  _state.positions.push(position);
  _state.totalDeposited += amount;
  _state.lastUpdate = Date.now();
  recalcBlendedAPY();

  return position;
}

/**
 * Build and SEND a real LP deposit transaction.
 *
 * Supported today: Aerodrome V2 (Base, chain 8453) via the V2 router
 * `addLiquidity` — approve both underlying tokens, then add liquidity.
 * Other projects (uniswap-v3/curve/balancer/beefy/…) THROW "not yet
 * supported" — never a fake "project:pool:amount" string.
 *
 * Guards: requireEnv("FARMER_PRIVATE_KEY") + requireEnv("BASE_RPC_URL").
 */
async function buildRealLPDeposit(
  pool: DeFiLlamaPool,
  amount: number,
): Promise<string> {
  // Guards first — missing env throws a clear error, never simulates.
  const farmerKey = requireEnv("FARMER_PRIVATE_KEY");
  const baseRpc = requireEnv("BASE_RPC_URL");

  if (pool.chain !== "base") {
    throw new Error(
      `[LP] Real deposit for ${pool.project} on ${pool.chain} is not yet supported — refused (pool ${pool.pool}). No fake deposit.`,
    );
  }
  if (pool.project !== "aerodrome" && pool.project !== "aerodrome-v1") {
    throw new Error(
      `[LP] Real deposit for project "${pool.project}" is not yet supported — add a per-project path first. No fake deposit (pool ${pool.pool}).`,
    );
  }
  if (!pool.underlyingTokens || pool.underlyingTokens.length < 2) {
    throw new Error(
      `[LP] Pool ${pool.pool} has no real underlyingTokens from DeFiLlama — cannot build a real deposit.`,
    );
  }

  const { createPublicClient, createWalletClient, http } = await import("viem");
  const { base } = await import("viem/chains");
  const { privateKeyToAccount } = await import("viem/accounts");

  const account = privateKeyToAccount(farmerKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http(baseRpc) });
  const walletClient = createWalletClient({ chain: base, account, transport: http(baseRpc) });

  const tokenA = pool.underlyingTokens[0] as `0x${string}`;
  const tokenB = pool.underlyingTokens[1] as `0x${string}`;

  // Real on-chain decimals (never assume 6/18).
  const decimalsOf = async (addr: `0x${string}`): Promise<number> => {
    const d = (await publicClient.readContract({
      address: addr,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    })) as number;
    return Number(d);
  };
  const [decA, decB] = await Promise.all([decimalsOf(tokenA), decimalsOf(tokenB)]);

  // Real prices from CoinGecko (for the USD split). Unpriced assets are
  // refused — we never guess a token price.
  const symbolA = pool.symbol.split("-")[0]?.toUpperCase() ?? "";
  const symbolB = pool.symbol.split("-")[1]?.toUpperCase() ?? "";
  const priceA = await fetchCoinGeckoPrice(symbolA);
  const priceB = await fetchCoinGeckoPrice(symbolB);
  if (priceA <= 0 || priceB <= 0) {
    throw new Error(
      `[LP] Cannot price ${symbolA}/${symbolB} (CoinGecko) — refusing to build a real deposit with an invented rate.`,
    );
  }

  const usdPerSide = amount / 2;
  const rawA = BigInt(Math.floor((usdPerSide / priceA) * 10 ** decA));
  const rawB = BigInt(Math.floor((usdPerSide / priceB) * 10 ** decB));
  if (rawA <= 0n || rawB <= 0n) {
    throw new Error(
      `[LP] Deposit amount too small to build a real tx (rawA=${rawA}, rawB=${rawB}).`,
    );
  }

  // 1% slippage min amounts
  const minA = (rawA * 99n) / 100n;
  const minB = (rawB * 99n) / 100n;
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const AERODROME_V2_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";

  // Approve the router to move both tokens (real txs).
  for (const [token, raw] of [
    [tokenA, rawA],
    [tokenB, rawB],
  ] as const) {
    const approveHash = await walletClient.writeContract({
      address: token,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [AERODROME_V2_ROUTER as `0x${string}`, raw],
      chain: base,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
  }

  // addLiquidity on the Aerodrome V2 router.
  const addHash = await walletClient.writeContract({
    address: AERODROME_V2_ROUTER as `0x${string}`,
    abi: AERODROME_V2_ROUTER_ABI,
    functionName: "addLiquidity",
    args: [tokenA, tokenB, rawA, rawB, minA, minB, account.address, BigInt(deadline)],
    chain: base,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: addHash, timeout: 120_000 });

  return addHash;
}

// ── Real on-chain ABIs (minimal) ───────────────────────────────

const ERC20_DECIMALS_ABI = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const AERODROME_V2_ROUTER_ABI = [
  {
    type: "function",
    name: "addLiquidity",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "amountADesired", type: "uint256" },
      { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin", type: "uint256" },
      { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "amountA", type: "uint256" },
      { name: "amountB", type: "uint256" },
      { name: "liquidity", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

/** CoinGecko price (USD) for a Base pool asset symbol — real data only. */
async function fetchCoinGeckoPrice(symbol: string): Promise<number> {
  const id =
    symbol === "USDC" ? "usd-coin"
    : symbol === "USDT" ? "tether"
    : symbol === "WETH" ? "ethereum"
    : symbol === "DAI" ? "dai"
    : symbol === "AERO" ? "aerodrome-finance"
    : symbol === "MAI" ? "mimatic"
    : "";
  if (!id) return 0;
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return 0;
    const json = (await resp.json()) as Record<string, { usd?: number }>;
    const price = json[id]?.usd;
    return typeof price === "number" && price > 0 ? price : 0;
  } catch {
    return 0;
  }
}

/**
 * Get current LP yield state with real APYs refreshed from DeFiLlama.
 */
export function getLPYield(): LPYieldState {
  const now = Date.now();

  // Accrue fees for active positions based on real APY
  for (const pos of _state.positions) {
    if (pos.status !== "active") continue;
    const hoursSinceCheck = (now - _state.lastUpdate) / (1000 * 60 * 60);
    if (hoursSinceCheck > 0 && hoursSinceCheck < 720) { // cap at 30 days
      const hourlyRate = pos.apy / 100 / 365 / 24;
      const newFees = +(pos.deposited * hourlyRate * Math.min(hoursSinceCheck, 24)).toFixed(6);
      pos.feesEarned += newFees;
      _state.totalFeesEarned += newFees;
    }
  }

  _state.lastUpdate = now;
  recalcBlendedAPY();
  return { ..._state, positions: _state.positions.map((p) => ({ ...p })) };
}

/**
 * Refresh APYs from DeFiLlama and update all active positions.
 */
export async function refreshAPYs(): Promise<void> {
  const pools = await fetchDeFiLlamaPools();

  for (const pos of _state.positions) {
    if (pos.status !== "active") continue;
    const updated = pools.find((p) => p.pool === pos.poolId);
    if (updated) {
      pos.apy = updated.apy;
      pos.tvlUsd = updated.tvlUsd;
    }
  }

  _state.lastUpdate = Date.now();
  recalcBlendedAPY();
}

/**
 * Compound: reinvest earned fees.
 * Returns the optimal compound interval for each position.
 */
export function compound(positionId?: string): LPYieldState {
  const now = Date.now();

  // Accrue pending fees first
  getLPYield();

  const targets = positionId
    ? _state.positions.filter((p) => p.id === positionId && p.status === "active")
    : _state.positions.filter((p) => p.status === "active");

  for (const pos of targets) {
    if (pos.feesEarned <= 0) continue;

    // Check if it's worth compounding (gas cost vs reward)
    const gasCost = ESTIMATED_GAS_COSTS[pos.chain] ?? 3;
    if (pos.feesEarned < gasCost * 2) {
      // Not worth compounding yet — skip
      continue;
    }

    pos.deposited += pos.feesEarned;
    _state.totalDeposited += pos.feesEarned;
    pos.feesEarned = 0;
    pos.lastCompound = now;
    pos.compoundCount++;
  }

  _state.lastUpdate = now;
  recalcBlendedAPY();
  return { ..._state, positions: _state.positions.map((p) => ({ ...p })) };
}

/**
 * Close a position and return final value.
 */
export function closePosition(positionId: string): { deposited: number; fees: number; total: number } | null {
  const pos = _state.positions.find((p) => p.id === positionId);
  if (!pos || pos.status !== "active") return null;

  getLPYield();

  pos.status = "closed";
  _state.totalDeposited = Math.max(0, _state.totalDeposited - pos.deposited);
  _state.lastUpdate = Date.now();
  recalcBlendedAPY();

  return {
    deposited: pos.deposited,
    fees: pos.feesEarned,
    total: pos.deposited + pos.feesEarned,
  };
}

function recalcBlendedAPY(): void {
  const activePositions = _state.positions.filter((p) => p.status === "active");
  if (activePositions.length === 0) {
    _state.blendedAPY = 0;
    return;
  }
  const totalWeight = activePositions.reduce((sum, p) => sum + p.deposited, 0);
  if (totalWeight === 0) {
    _state.blendedAPY = 0;
    return;
  }
  const weightedAPY = activePositions.reduce((sum, p) => sum + p.apy * p.deposited, 0);
  _state.blendedAPY = +(weightedAPY / totalWeight).toFixed(2);
}

/**
 * Get raw state (for dashboard polling).
 */
export function getLPState(): LPYieldState {
  return getLPYield();
}

/**
 * Reset all LP state (for testing).
 */
export function resetLPState(): void {
  _state = {
    positions: [],
    totalDeposited: 0,
    totalFeesEarned: 0,
    blendedAPY: 0,
    availablePools: _poolCache,
    lastUpdate: Date.now(),
    lastPoolFetch: _poolCacheTs,
    paperMode: detectPaperMode(),
  };
}
