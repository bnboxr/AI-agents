/**
 * POS Service — Payment session management
 *
 * Manages payment sessions for the crypto POS terminal.
 * Master wallet architecture: all payments go to the platform contract.
 */

import { sql } from "~/lib/db";
import { requireEnv } from "~/lib/env-guard";

// ── Types ────────────────────────────────────────────────────────────

export type PaymentStatus =
  | "pending"
  | "confirming"
  | "confirmed"
  | "failed"
  | "insufficient_funds"
  | "timeout";

export type FailReason = "declined" | "insufficient_funds" | "timeout";

/** Tokens available for post-payment conversion */
export type ConvertibleToken = "USDC" | "USDT" | "MATIC" | "ETH" | "SOL" | "BTC";

export interface PaymentSession {
  sessionId: string;
  amount: number; // in USD
  tokenAmount: string; // in token decimals (string for bigint precision)
  token: "USDC" | "USDT" | "MATIC";
  tokenAddress: string;
  status: PaymentStatus;
  txId?: string;
  payerAddress?: string;
  createdAt: number;
  confirmedAt?: number;
  failReason?: FailReason;
  /** For PWA pre-authorized payments — the NDEF payload from the POS */
  ndefPayload?: string;
}

export interface PaymentRecord {
  sessionId: string;
  amount: number;
  token: string;
  tokenAmount: string;
  status: string;
  txId?: string;
  payerAddress?: string;
  createdAt: number;
  confirmedAt?: number;
}

export interface PriceFeed {
  USDC: number;
  USDT: number;
  MATIC: number;
}

// ── Constants ────────────────────────────────────────────────────────

const POLYGON_AMOY_USDC = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582";
const POLYGON_MAINNET_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const POLYGON_MAINNET_USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
// Wrapped versions of non-native assets on Polygon PoS (chain 137) — used
// as real swap destinations (there is no native ETH/BTC/SOL on Polygon).
const POLYGON_MAINNET_WMATIC = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const POLYGON_MAINNET_WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b2fF8F";
const POLYGON_MAINNET_WBTC = "0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6";
const MATIC_NATIVE = "0x0000000000000000000000000000000000000000";

/** The PaymentSettlement contract address — read from env only (no default). */
export const POS_CONTRACT_ADDRESS: string =
  (typeof process !== "undefined" && process.env?.VITE_POS_CONTRACT_ADDRESS) || "";

/** The platform owner address (from env) */
export const POS_OWNER_ADDRESS: string =
  (typeof process !== "undefined" && process.env?.VITE_POS_OWNER_ADDRESS) || "";

/** Polygon RPC URL — read from env only (no default). */
export const POS_RPC_URL: string =
  (typeof process !== "undefined" && process.env?.VITE_POLYGON_RPC) || "";

/**
 * Env-guarded accessors for live POS settlement config.
 * These THROW a clear error when the variable is absent — they never fall
 * back to a zero address or a demo RPC (owner hard rule).
 */
export function getPosContractAddress(): string {
  return requireEnv("VITE_POS_CONTRACT_ADDRESS");
}

export function getPosRpcUrl(): string {
  return requireEnv("VITE_POLYGON_RPC");
}

function getTokenAddress(token: "USDC" | "USDT" | "MATIC"): string {
  if (token === "USDC") return process.env.VITE_POS_NETWORK === "mainnet" ? POLYGON_MAINNET_USDC : POLYGON_AMOY_USDC;
  if (token === "USDT") {
    // FLAG (blueprint item 3): Amoy has NO mapped USDT — returning the
    // mainnet address on a testnet would be a fabricated value presented as
    // real. Refuse instead.
    if (process.env.VITE_POS_NETWORK !== "mainnet") {
      throw new Error(
        "[POS] Amoy USDT address is not mapped — add the real testnet USDT asset before POS conversion on Amoy. Refusing to use the mainnet address.",
      );
    }
    return POLYGON_MAINNET_USDT;
  }
  return MATIC_NATIVE;
}

function getTokenDecimals(token: "USDC" | "USDT" | "MATIC"): number {
  if (token === "USDC") return 6;
  if (token === "USDT") return 6;
  return 18; // MATIC
}

// ── Session Store (in-memory + optional DB) ──────────────────────────

const sessions = new Map<string, PaymentSession>();

function generateSessionId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "pos_";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ── Price Feed ───────────────────────────────────────────────────────

let cachedPrices: PriceFeed | null = null;
let lastPriceFetch = 0;
const PRICE_CACHE_TTL = 30_000; // 30 seconds

export async function getTokenPrices(): Promise<PriceFeed> {
  const now = Date.now();
  if (cachedPrices && now - lastPriceFetch < PRICE_CACHE_TTL) {
    return cachedPrices;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,tether,matic-network&vs_currencies=usd"
    );
    if (!res.ok) {
      console.warn("[POS] Failed to fetch prices from CoinGecko, using defaults");
      return { USDC: 1.0, USDT: 1.0, MATIC: 0.5 };
    }
    const data = await res.json();
    cachedPrices = {
      USDC: data["usd-coin"]?.usd ?? 1.0,
      USDT: data["tether"]?.usd ?? 1.0,
      MATIC: data["matic-network"]?.usd ?? 0.5,
    };
    lastPriceFetch = now;
    return cachedPrices;
  } catch (err) {
    console.warn("[POS] Price fetch error:", err);
    return cachedPrices ?? { USDC: 1.0, USDT: 1.0, MATIC: 0.5 };
  }
}

// ── Session Management ───────────────────────────────────────────────

export function createPaymentSession(params: {
  amount: number;
  token: "USDC" | "USDT" | "MATIC";
}): PaymentSession {
  const sessionId = generateSessionId();
  const prices = { USDC: 1.0, USDT: 1.0, MATIC: 0.5 }; // Will be populated async
  const price = prices[params.token];
  const decimals = getTokenDecimals(params.token);
  const tokenAmount = BigInt(Math.floor((params.amount / price) * 10 ** decimals)).toString();

  const session: PaymentSession = {
    sessionId,
    amount: params.amount,
    tokenAmount,
    token: params.token,
    tokenAddress: getTokenAddress(params.token),
    status: "pending",
    createdAt: Date.now(),
  };

  sessions.set(sessionId, session);

  // Try to persist to DB if available
  persistSession(session).catch((err) => {
    console.warn("[POS] Failed to persist session to DB:", err);
  });

  return session;
}

export function getPaymentSession(sessionId: string): PaymentSession | undefined {
  return sessions.get(sessionId);
}

export async function confirmPaymentSession(
  sessionId: string,
  txId: string,
  payerAddress: string
): Promise<PaymentSession | undefined> {
  const session = sessions.get(sessionId);
  if (!session) return undefined;

  session.status = "confirmed";
  session.txId = txId;
  session.payerAddress = payerAddress;
  session.confirmedAt = Date.now();

  // Update in DB
  updateSessionStatus(sessionId, "confirmed", txId, payerAddress).catch((err) => {
    console.warn("[POS] Failed to update session in DB:", err);
  });

  return session;
}

export function failPaymentSession(
  sessionId: string,
  reason: FailReason = "declined"
): PaymentSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  session.status =
    reason === "insufficient_funds" ? "insufficient_funds" : reason === "timeout" ? "timeout" : "failed";
  session.failReason = reason;
  // Persist the failure
  updateSessionStatus(sessionId, session.status).catch((err) => {
    console.warn("[POS] Failed to persist session failure:", err);
  });
  return session;
}

/**
 * Mark a session as confirming (transaction submitted, waiting for confirmation)
 */
export function confirmingPaymentSession(sessionId: string): PaymentSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  session.status = "confirming";
  return session;
}

/**
 * Mark a session as timed out
 */
export function timeoutPaymentSession(sessionId: string): PaymentSession | undefined {
  return failPaymentSession(sessionId, "timeout");
}

// ── Payment queries (all payments, not filtered by merchant) ─────────

export async function getAllPayments(
  limit = 50,
  offset = 0
): Promise<PaymentRecord[]> {
  // Try DB first
  try {
    const result = await sql`
      SELECT session_id, amount, token, token_amount, status, tx_id, payer_address, created_at, confirmed_at
      FROM pos_payments
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    if (result.rows && result.rows.length > 0) {
      return result.rows.map(mapRowToPayment);
    }
  } catch (err) {
    console.warn("[POS] DB query failed for payments:", err);
  }

  // Fallback: from in-memory sessions
  const allSessions: PaymentRecord[] = [];
  for (const session of sessions.values()) {
    allSessions.push({
      sessionId: session.sessionId,
      amount: session.amount,
      token: session.token,
      tokenAmount: session.tokenAmount,
      status: session.status,
      txId: session.txId,
      payerAddress: session.payerAddress,
      createdAt: session.createdAt,
      confirmedAt: session.confirmedAt,
    });
  }
  return allSessions.slice(offset, offset + limit);
}

/** @deprecated — use getAllPayments() instead */
export async function getMerchantPayments(
  _merchantAddress?: string,
  limit = 50,
  offset = 0
): Promise<PaymentRecord[]> {
  return getAllPayments(limit, offset);
}

export async function getPlatformStats(): Promise<{
  totalPayments: number;
  totalRevenue: number;
  confirmedPayments: number;
  pendingPayments: number;
}> {
  const payments = await getAllPayments(1000);
  const confirmed = payments.filter((p) => p.status === "confirmed");
  return {
    totalPayments: payments.length,
    totalRevenue: confirmed.reduce((sum, p) => sum + p.amount, 0),
    confirmedPayments: confirmed.length,
    pendingPayments: payments.filter((p) => p.status === "pending").length,
  };
}

// ── DB Helpers ───────────────────────────────────────────────────────

async function persistSession(session: PaymentSession): Promise<void> {
  await sql`
    INSERT INTO pos_payments (session_id, amount, token, token_amount, token_address, merchant, merchant_name, status, created_at)
    VALUES (${session.sessionId}, ${session.amount}, ${session.token}, ${session.tokenAmount}, ${session.tokenAddress}, ${POS_CONTRACT_ADDRESS}, 'Platform Treasury', ${session.status}, ${session.createdAt})
    ON CONFLICT (session_id) DO NOTHING
  `;
}

async function updateSessionStatus(
  sessionId: string,
  status: string,
  txId?: string,
  payerAddress?: string
): Promise<void> {
  await sql`
    UPDATE pos_payments
    SET status = ${status}, tx_id = ${txId ?? null}, payer_address = ${payerAddress ?? null}, confirmed_at = ${
      status === "confirmed" ? Date.now() : null
    }
    WHERE session_id = ${sessionId}
  `;
}

function mapRowToPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    sessionId: row.session_id as string,
    amount: Number(row.amount),
    token: row.token as string,
    tokenAmount: row.token_amount as string,
    status: row.status as string,
    txId: (row.tx_id as string) || undefined,
    payerAddress: (row.payer_address as string) || undefined,
    createdAt: Number(row.created_at),
    confirmedAt: row.confirmed_at ? Number(row.confirmed_at) : undefined,
  };
}

// ── Platform On-Chain Balances ───────────────────────────────────────

export interface TokenBalance {
  token: "USDC" | "USDT" | "MATIC";
  tokenAddress: string;
  balance: string; // raw wei/smallest unit as string
  formatted: string; // human-readable
}

/**
 * Read platform balances from the PaymentSettlement contract.
 * Reads the `totalReceived` mapping on-chain (master wallet).
 */
export async function getPlatformBalances(): Promise<TokenBalance[]> {
  const tokens: Array<{ symbol: "USDC" | "USDT" | "MATIC"; address: string; decimals: number }> = [
    { symbol: "USDC", address: getTokenAddress("USDC"), decimals: 6 },
    { symbol: "USDT", address: getTokenAddress("USDT"), decimals: 6 },
    { symbol: "MATIC", address: MATIC_NATIVE, decimals: 18 },
  ];

  const { createPublicClient, http } = await import("viem");
  const { polygonAmoy, polygon: polygonMainnet } = await import("viem/chains");

  const chain =
    process.env.VITE_POS_NETWORK === "mainnet" ? polygonMainnet : polygonAmoy;

  // No demo RPC / zero-address fallback: these THROW when unset.
  const rpcUrl = getPosRpcUrl();
  const contractAddr = getPosContractAddress() as `0x${string}`;

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const balances: TokenBalance[] = [];

  for (const t of tokens) {
    try {
      const rawBalance = (await client.readContract({
        address: contractAddr,
        abi: PAYMENT_SETTLEMENT_ABI,
        functionName: "totalReceived",
        args: [t.address as `0x${string}`],
      })) as bigint;

      const formatted =
        t.decimals === 18
          ? formatEther(rawBalance)
          : formatUnits(rawBalance, t.decimals);

      balances.push({
        token: t.symbol,
        tokenAddress: t.address,
        balance: rawBalance.toString(),
        formatted,
      });
    } catch (err) {
      console.warn(`[POS] Failed to read balance for ${t.symbol}:`, err);
      balances.push({
        token: t.symbol,
        tokenAddress: t.address,
        balance: "0",
        formatted: "0",
      });
    }
  }

  return balances;
}

/** @deprecated — use getPlatformBalances() instead */
export async function getMerchantOnChainBalances(
  _merchantAddress: string
): Promise<TokenBalance[]> {
  return getPlatformBalances();
}

// Helper: format token units for display
function formatUnits(value: bigint, decimals: number): string {
  if (value === 0n) return "0";
  const divisor = 10n ** BigInt(decimals);
  const intPart = value / divisor;
  const fracPart = value % divisor;
  if (fracPart === 0n) return intPart.toString();
  let fracStr = fracPart.toString().padStart(decimals, "0");
  fracStr = fracStr.replace(/0+$/, "");
  return `${intPart}.${fracStr.slice(0, 6)}`;
}

function formatEther(value: bigint): string {
  return formatUnits(value, 18);
}

// ── EIP-681 URL Builder ──────────────────────────────────────────────

export function buildEIP681Url(params: {
  contractAddress: string;
  token: "USDC" | "USDT" | "MATIC";
  amount: string; // in token decimals
  sessionId: string;
}): string {
  const chainId = process.env.VITE_POS_NETWORK === "mainnet" ? 137 : 80002;
  const contractAddr = params.contractAddress || process.env.VITE_POS_CONTRACT_ADDRESS || "0x";

  if (params.token === "MATIC") {
    // Native MATIC payment
    return `ethereum:${contractAddr}@${chainId}/payWithMatic?string=${params.sessionId}`;
  }

  // ERC-20 payment
  return `ethereum:${contractAddr}@${chainId}/pay?address=${params.token}&uint256=${params.amount}&string=${params.sessionId}`;
}

// ── NFC Payload Builder ──────────────────────────────────────────────

export function buildNFCPayload(params: {
  contractAddress: string;
  token: "USDC" | "USDT" | "MATIC";
  amount: string;
  sessionId: string;
}): {
  url: string;
  ndefMessage: {
    records: Array<{
      recordType: string;
      data: string;
      mediaType?: string;
    }>;
  };
} {
  const eip681Url = buildEIP681Url(params);

  return {
    url: eip681Url,
    ndefMessage: {
      records: [
        {
          recordType: "url",
          data: eip681Url,
        },
        {
          recordType: "text",
          data: JSON.stringify({
            type: "crypto-payment",
            sessionId: params.sessionId,
            amount: params.amount,
            token: params.token,
            contractAddress: params.contractAddress,
            timestamp: Date.now(),
          }),
        },
      ],
    },
  };
}

// ── Contract ABI (minimal for event monitoring + platform interaction) ─

export const PAYMENT_SETTLEMENT_ABI = [
  {
    type: "event",
    name: "PaymentReceived",
    inputs: [
      { indexed: true, name: "id", type: "uint256" },
      { indexed: true, name: "payer", type: "address" },
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
      { indexed: false, name: "sessionId", type: "string" },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: true, name: "to", type: "address" },
    ],
  },
  {
    type: "function",
    name: "payments",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "sessionId", type: "string" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paymentCounter",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "acceptedTokens",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalReceived",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawAll",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// ── Payment Conversion ─────────────────────────────────────────────────

const PARASWAP_API_BASE = "https://api.paraswap.io";
const POLYGON_CHAIN_ID = 137;
const PARASWAP_SLIPPAGE_BPS = 100; // 1%

/** Map a payment/convert token symbol to its REAL address on Polygon PoS (137). */
function getPolygonToken(token: string): { address: string; decimals: number } {
  switch (token) {
    case "USDC":
      return { address: POLYGON_MAINNET_USDC, decimals: 6 };
    case "USDT":
      return { address: POLYGON_MAINNET_USDT, decimals: 6 };
    case "MATIC":
      return { address: POLYGON_MAINNET_WMATIC, decimals: 18 };
    case "ETH":
      return { address: POLYGON_MAINNET_WETH, decimals: 18 };
    case "BTC":
      return { address: POLYGON_MAINNET_WBTC, decimals: 8 };
    case "SOL":
      throw new Error(
        "[POS] SOL conversion on Polygon is not supported — SOL does not exist natively on Polygon (a real cross-chain bridge would be required). No simulated conversion.",
      );
    default:
      throw new Error(
        `[POS] Unsupported conversion target "${token}" on Polygon — refusing to fabricate a rate.`,
      );
  }
}

/**
 * Convert a confirmed payment to another token with a REAL DEX-aggregator
 * swap on Polygon PoS (chain 137) via Paraswap v5 (keyless).
 *
 * Guards (owner hard rule): requires DEPLOYER_PRIVATE_KEY + POLYGON_RPC_URL.
 * When absent this THROWS — it never emits a fake txid, a hardcoded price,
 * or a simulated fee.
 *
 * @returns the real on-chain transaction hash and the real output amount
 *          (raw units of the destination token, from the Paraswap quote).
 */
export async function convertPayment(
  sessionId: string,
  fromToken: string,
  fromAmount: string,
  toToken: ConvertibleToken,
  toChain?: string
): Promise<{ txId: string; amount: string }> {
  // Real conversion is Polygon-mainnet only today. A testnet (Amoy) swap
  // would need its own token addresses + RPC — refuse rather than pretend.
  if (process.env.VITE_POS_NETWORK !== "mainnet") {
    throw new Error(
      "[POS] convertPayment executes ONLY on Polygon mainnet (chain 137). Set VITE_POS_NETWORK=mainnet with real mainnet tokens before converting. No simulated conversion.",
    );
  }

  // The wallet that funds the swap + the RPC the tx is broadcast on.
  const deployerKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  const rpcUrl = requireEnv("POLYGON_RPC_URL");

  // Validate the session exists and is confirmed
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (session.status !== "confirmed") {
    throw new Error(`Cannot convert: payment not yet confirmed (status: ${session.status})`);
  }

  const src = getPolygonToken(fromToken);
  const dest = getPolygonToken(toToken);

  let srcAmount: bigint;
  try {
    srcAmount = BigInt(fromAmount);
  } catch {
    throw new Error(`[POS] fromAmount is not a raw integer amount: "${fromAmount}"`);
  }
  if (srcAmount <= 0n) {
    throw new Error(`[POS] fromAmount must be > 0 (got ${fromAmount})`);
  }

  const { createPublicClient, createWalletClient, http } = await import("viem");
  const { polygon: polygonMainnet } = await import("viem/chains");
  const { privateKeyToAccount } = await import("viem/accounts");

  const account = privateKeyToAccount(deployerKey as `0x${string}`);
  const userAddress = account.address;

  // 1) REAL quote from Paraswap (keyless public API) — no hardcoded prices.
  const pricesUrl = new URL(`${PARASWAP_API_BASE}/prices`);
  pricesUrl.searchParams.set("srcToken", src.address);
  pricesUrl.searchParams.set("destToken", dest.address);
  pricesUrl.searchParams.set("amount", srcAmount.toString());
  pricesUrl.searchParams.set("srcDecimals", String(src.decimals));
  pricesUrl.searchParams.set("destDecimals", String(dest.decimals));
  pricesUrl.searchParams.set("side", "SELL");
  pricesUrl.searchParams.set("network", String(POLYGON_CHAIN_ID));

  const pricesRes = await fetch(pricesUrl.toString());
  if (!pricesRes.ok) {
    throw new Error(
      `[POS] Paraswap price quote failed (HTTP ${pricesRes.status}) — no simulated rate. Check the token pair / restart later.`,
    );
  }
  const pricesJson = (await pricesRes.json()) as {
    priceRoute?: Record<string, unknown>;
  };
  const priceRoute = pricesJson.priceRoute;
  const destAmountRaw = priceRoute?.destAmount as string | undefined;
  if (!priceRoute || !destAmountRaw || BigInt(destAmountRaw) <= 0n) {
    throw new Error(
      `[POS] Paraswap returned no valid route for ${fromToken}→${toToken} — refusing to fabricate an output amount.`,
    );
  }
  const realOutputAmount = destAmountRaw;

  // 2) Build the swap transaction through Paraswap's transaction builder.
  const txBuildRes = await fetch(`${PARASWAP_API_BASE}/transactions/${POLYGON_CHAIN_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      srcToken: src.address,
      destToken: dest.address,
      srcAmount: srcAmount.toString(),
      destAmount: realOutputAmount,
      priceRoute,
      userAddress,
      srcDecimals: src.decimals,
      destDecimals: dest.decimals,
      slippage: PARASWAP_SLIPPAGE_BPS,
    }),
  });
  if (!txBuildRes.ok) {
    throw new Error(
      `[POS] Paraswap transaction build failed (HTTP ${txBuildRes.status}) — no tx was sent.`,
    );
  }
  const txBuildJson = (await txBuildRes.json()) as { txParams?: Record<string, unknown> };
  const txParams = txBuildJson.txParams;
  if (!txParams || typeof txParams.to !== "string" || typeof txParams.data !== "string") {
    throw new Error("[POS] Paraswap returned no executable txParams — no tx was sent.");
  }

  // 3) Sign + broadcast the REAL swap with the DEPLOYER wallet.
  const walletClient = createWalletClient({
    chain: polygonMainnet,
    account,
    transport: http(rpcUrl),
  });

  const txHash = await walletClient.sendTransaction({
    to: txParams.to as `0x${string}`,
    data: txParams.data as `0x${string}`,
    value: BigInt((txParams.value as string) ?? "0x0"),
    ...(txParams.gas ? { gas: BigInt(txParams.gas as string) } : {}),
  });

  const publicClient = createPublicClient({
    chain: polygonMainnet,
    transport: http(rpcUrl),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });

  // Log the real conversion
  console.log("[POS] Payment conversion (REAL swap):", {
    sessionId,
    from: `${fromAmount} ${fromToken} (raw)`,
    to: `${realOutputAmount} ${toToken} (raw)`,
    chain: toChain || "Polygon",
    txHash,
  });

  // Persist conversion record
  try {
    await sql`
      INSERT INTO pos_conversions (session_id, from_token, from_amount, to_token, to_amount, to_chain, tx_id, created_at)
      VALUES (${sessionId}, ${fromToken}, ${fromAmount}, ${toToken}, ${realOutputAmount}, ${toChain || "Polygon"}, ${txHash}, ${Date.now()})
    `;
  } catch (err) {
    console.warn("[POS] Failed to persist conversion to DB:", err);
    // Non-fatal — the real on-chain conversion already happened
  }

  return {
    txId: txHash,
    amount: realOutputAmount,
  };
}

/**
 * Get conversion history for a payment session.
 */
export async function getConversions(sessionId: string): Promise<
  Array<{
    fromToken: string;
    fromAmount: string;
    toToken: string;
    toAmount: string;
    toChain: string;
    txId: string;
    createdAt: number;
  }>
> {
  try {
    const result = await sql`
      SELECT from_token, from_amount, to_token, to_amount, to_chain, tx_id, created_at
      FROM pos_conversions
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
    `;
    if (result.rows && result.rows.length > 0) {
      return result.rows.map((r: Record<string, unknown>) => ({
        fromToken: r.from_token as string,
        fromAmount: r.from_amount as string,
        toToken: r.to_token as string,
        toAmount: r.to_amount as string,
        toChain: (r.to_chain as string) || "Polygon",
        txId: r.tx_id as string,
        createdAt: Number(r.created_at),
      }));
    }
  } catch (err) {
    console.warn("[POS] Failed to query conversions:", err);
  }
  return [];
}
