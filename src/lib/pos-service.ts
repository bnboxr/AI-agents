/**
 * POS Service — Payment session management
 *
 * Manages payment sessions for the crypto POS terminal.
 * Master wallet architecture: all payments go to the platform contract.
 */

import { sql } from "~/lib/db";

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
const MATIC_NATIVE = "0x0000000000000000000000000000000000000000";

/** The PaymentSettlement contract address (from env or default) */
export const POS_CONTRACT_ADDRESS: string =
  (typeof process !== "undefined" && process.env?.VITE_POS_CONTRACT_ADDRESS) ||
  "0x0000000000000000000000000000000000000000";

/** The platform owner address (from env) */
export const POS_OWNER_ADDRESS: string =
  (typeof process !== "undefined" && process.env?.VITE_POS_OWNER_ADDRESS) || "";

/** Polygon Amoy testnet RPC URL */
export const POS_RPC_URL: string =
  (typeof process !== "undefined" && process.env?.VITE_POLYGON_RPC) ||
  "https://polygon-amoy.g.alchemy.com/v2/demo";

function getTokenAddress(token: "USDC" | "USDT" | "MATIC"): string {
  if (token === "USDC") return process.env.VITE_POS_NETWORK === "mainnet" ? POLYGON_MAINNET_USDC : POLYGON_AMOY_USDC;
  if (token === "USDT") return POLYGON_MAINNET_USDT;
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

  const rpcUrl =
    (typeof process !== "undefined" && process.env?.VITE_POLYGON_RPC) ||
    "https://polygon-amoy.g.alchemy.com/v2/demo";

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const contractAddr = POS_CONTRACT_ADDRESS as `0x${string}`;

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

/**
 * Convert a confirmed payment to another token via DEX integration.
 *
 * Uses the platform's existing swap infrastructure. After payment confirmation,
 * the merchant can instantly convert received funds to any supported token.
 *
 * Currently a simulated conversion — in production, this routes through
 * the DEX aggregator (1inch, Paraswap, or Uniswap on Polygon).
 */
export async function convertPayment(
  sessionId: string,
  fromToken: string,
  fromAmount: string,
  toToken: ConvertibleToken,
  toChain?: string
): Promise<{ txId: string; amount: string }> {
  // Validate the session exists and is confirmed
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (session.status !== "confirmed") {
    throw new Error(`Cannot convert: payment not yet confirmed (status: ${session.status})`);
  }

  // Convert amount from raw token units to float for rate calculation
  const fromDecimals = fromToken === "MATIC" ? 18 : 6;
  const fromAmountFloat = Number(BigInt(fromAmount)) / 10 ** fromDecimals;

  // Get current prices for rate estimation
  const prices = await getTokenPrices().catch(() => ({
    USDC: 1.0,
    USDT: 1.0,
    MATIC: 0.5,
  }));

  // Extended prices for cross-chain tokens (fallback estimates)
  const extendedPrices: Record<string, number> = {
    USDC: prices.USDC ?? 1.0,
    USDT: prices.USDT ?? 1.0,
    MATIC: prices.MATIC ?? 0.5,
    ETH: 3400,
    SOL: 180,
    BTC: 67000,
  };

  const fromPrice = extendedPrices[fromToken] || 1;
  const toPrice = extendedPrices[toToken] || 1;

  // Calculate output amount with 0.3% fee (DEX fee simulation)
  const effectiveAmount = fromAmountFloat * 0.997; // 0.3% swap fee
  const outputAmount = (effectiveAmount * fromPrice) / toPrice;

  // Convert to target token decimals
  const toDecimals = toToken === "MATIC" || toToken === "ETH" || toToken === "SOL" ? 18 : toToken === "BTC" ? 8 : 6;
  const outputRaw = BigInt(Math.floor(outputAmount * 10 ** toDecimals)).toString();

  // Generate a conversion TXID
  const txId =
    "0xconv_" +
    Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

  // Log the conversion
  console.log("[POS] Payment conversion:", {
    sessionId,
    from: `${fromAmountFloat} ${fromToken}`,
    to: `${outputAmount.toFixed(6)} ${toToken}`,
    chain: toChain || "Polygon",
    txId,
  });

  // Persist conversion record
  try {
    await sql`
      INSERT INTO pos_conversions (session_id, from_token, from_amount, to_token, to_amount, to_chain, tx_id, created_at)
      VALUES (${sessionId}, ${fromToken}, ${fromAmount}, ${toToken}, ${outputRaw}, ${toChain || "Polygon"}, ${txId}, ${Date.now()})
    `;
  } catch (err) {
    console.warn("[POS] Failed to persist conversion to DB:", err);
    // Non-fatal — conversion still succeeds
  }

  return {
    txId,
    amount: outputRaw,
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
