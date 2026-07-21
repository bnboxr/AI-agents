/**
 * POS Service — Payment session management
 *
 * Manages payment sessions for the crypto POS terminal.
 * Each session tracks: amount (USD), token, merchant wallet,
 * status (pending/confirmed/failed), and transaction details.
 */

import { sql } from "~/db";

// ── Types ────────────────────────────────────────────────────────────

export interface PaymentSession {
  sessionId: string;
  amount: number; // in USD
  tokenAmount: string; // in token decimals (string for bigint precision)
  token: "USDC" | "USDT" | "MATIC";
  tokenAddress: string;
  merchant: string; // merchant wallet address
  merchantName: string;
  status: "pending" | "confirmed" | "failed";
  txId?: string;
  payerAddress?: string;
  createdAt: number;
  confirmedAt?: number;
}

export interface MerchantPayment {
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
  merchant: string;
  merchantName?: string;
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
    merchant: params.merchant,
    merchantName: params.merchantName || params.merchant.slice(0, 6) + "..." + params.merchant.slice(-4),
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

export function failPaymentSession(sessionId: string): PaymentSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  session.status = "failed";
  return session;
}

// ── Merchant queries ─────────────────────────────────────────────────

export async function getMerchantPayments(
  merchantAddress: string,
  limit = 50,
  offset = 0
): Promise<MerchantPayment[]> {
  // Try DB first
  try {
    const result = await sql`
      SELECT session_id, amount, token, token_amount, status, tx_id, payer_address, created_at, confirmed_at
      FROM pos_payments
      WHERE merchant = ${merchantAddress}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    if (result.rows && result.rows.length > 0) {
      return result.rows.map(mapRowToPayment);
    }
  } catch (err) {
    console.warn("[POS] DB query failed for merchant payments:", err);
  }

  // Fallback: from in-memory sessions
  const merchantSessions: MerchantPayment[] = [];
  for (const session of sessions.values()) {
    if (session.merchant.toLowerCase() === merchantAddress.toLowerCase()) {
      merchantSessions.push({
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
  }
  return merchantSessions.slice(offset, offset + limit);
}

export async function getMerchantStats(merchantAddress: string): Promise<{
  totalPayments: number;
  totalRevenue: number;
  confirmedPayments: number;
  pendingPayments: number;
}> {
  const payments = await getMerchantPayments(merchantAddress, 1000);
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
    VALUES (${session.sessionId}, ${session.amount}, ${session.token}, ${session.tokenAmount}, ${session.tokenAddress}, ${session.merchant}, ${session.merchantName}, ${session.status}, ${session.createdAt})
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

function mapRowToPayment(row: Record<string, unknown>): MerchantPayment {
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

// ── Merchant On-Chain Balance ─────────────────────────────────────────

export interface TokenBalance {
  token: "USDC" | "USDT" | "MATIC";
  tokenAddress: string;
  balance: string; // raw wei/smallest unit as string
  formatted: string; // human-readable
}

/**
 * Read merchant balances from the PaymentSettlement contract.
 * This reads the `merchantBalances` mapping on-chain.
 */
export async function getMerchantOnChainBalances(
  merchantAddress: string
): Promise<TokenBalance[]> {
  const tokens: Array<{ symbol: "USDC" | "USDT" | "MATIC"; address: string; decimals: number }> = [
    { symbol: "USDC", address: getTokenAddress("USDC"), decimals: 6 },
    { symbol: "USDT", address: getTokenAddress("USDT"), decimals: 6 },
    { symbol: "MATIC", address: MATIC_NATIVE, decimals: 18 },
  ];

  // Dynamic import viem to avoid SSR issues
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
        functionName: "merchantBalances",
        args: [merchantAddress as `0x${string}`, t.address as `0x${string}`],
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

// Helper: format token units for display
function formatUnits(value: bigint, decimals: number): string {
  if (value === 0n) return "0";
  const divisor = 10n ** BigInt(decimals);
  const intPart = value / divisor;
  const fracPart = value % divisor;
  if (fracPart === 0n) return intPart.toString();
  let fracStr = fracPart.toString().padStart(decimals, "0");
  // Trim trailing zeros
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
  merchant: string;
  sessionId: string;
}): string {
  const chainId = process.env.VITE_POS_NETWORK === "mainnet" ? 137 : 80002;
  const contractAddr = params.contractAddress || process.env.VITE_POS_CONTRACT_ADDRESS || "0x";

  if (params.token === "MATIC") {
    // Native MATIC payment
    return `ethereum:${contractAddr}@${chainId}/payWithMatic?address=${params.merchant}&sessionId=${params.sessionId}`;
  }

  // ERC-20 payment: first approve, then pay — use the pay function
  return `ethereum:${contractAddr}@${chainId}/pay?address=${params.token}&uint256=${params.amount}&address=${params.merchant}&string=${params.sessionId}`;
}

// ── NFC Payload Builder ──────────────────────────────────────────────

export function buildNFCPayload(params: {
  contractAddress: string;
  token: "USDC" | "USDT" | "MATIC";
  amount: string;
  merchant: string;
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
            merchant: params.merchant,
            contractAddress: params.contractAddress,
            timestamp: Date.now(),
          }),
        },
      ],
    },
  };
}

// ── Contract ABI (minimal for event monitoring) ──────────────────────

export const PAYMENT_SETTLEMENT_ABI = [
  {
    type: "event",
    name: "PaymentReceived",
    inputs: [
      { indexed: true, name: "id", type: "uint256" },
      { indexed: true, name: "payer", type: "address" },
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: true, name: "merchant", type: "address" },
      { indexed: false, name: "timestamp", type: "uint256" },
      { indexed: false, name: "sessionId", type: "string" },
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
      { name: "merchant", type: "address" },
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
  {
    type: "function",
    name: "merchantBalances",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
