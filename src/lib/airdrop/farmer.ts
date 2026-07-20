// ── Airdrop Farmer — Real On-Chain Interactions ──────────────────────
// Performs swap/bridge on Base (8453) and Arbitrum (42161).
// Only when gas < 50 gwei. Uses ethers v6. No Math.random().

import { ethers } from "ethers";
import { sql, isDbAvailable } from "../db";
import { SUPPORTED_CHAINS } from "../chains-config";
import { getAutonomousPrivateKey } from "../autonomous-wallet";

export interface AirdropProtocol {
  name: string;
  chainId: number;
  contractAddress: string;
  interactionType: "swap" | "bridge";
  abi: ethers.InterfaceAbi;
}

export interface FarmResult {
  success: boolean;
  interactions: number;
  txHashes: string[];
  gasSpent: string;
  totalUsdValue: string;
  skippedReason?: string;
  protocolNames: string[];
  timestamp: number;
}

// ── Minimal swap router ABI (Uniswap V2-style) ────────────────────────

const SWAP_ABI: ethers.InterfaceAbi = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
];

// ── Farm Protocols — real, active ─────────────────────────────────────

const FARM_PROTOCOLS: AirdropProtocol[] = [
  // Base (chainId 8453)
  {
    name: "Aerodrome",
    chainId: 8453,
    contractAddress: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    interactionType: "swap",
    abi: SWAP_ABI,
  },
  {
    name: "BaseSwap",
    chainId: 8453,
    contractAddress: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
    interactionType: "swap",
    abi: SWAP_ABI,
  },
  {
    name: "SushiSwap (Base)",
    chainId: 8453,
    contractAddress: "0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891",
    interactionType: "swap",
    abi: SWAP_ABI,
  },
  {
    name: "Uniswap V3 (Base)",
    chainId: 8453,
    contractAddress: "0x2626664c2603336E57B271c5C0b26F421741e481",
    interactionType: "swap",
    abi: [
      "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
    ],
  },
  {
    name: "Stargate Bridge",
    chainId: 8453,
    contractAddress: "0x45f1A95A4D3f3836523F5c83673c797f4d4d263B",
    interactionType: "bridge",
    abi: [
      "function swapETH(uint16 dstChainId, address payable refundAddress, bytes calldata to, uint256 amountLD, uint256 minAmountLD) payable",
    ],
  },
  // Arbitrum (chainId 42161)
  {
    name: "Camelot",
    chainId: 42161,
    contractAddress: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d",
    interactionType: "swap",
    abi: SWAP_ABI,
  },
  {
    name: "GMX",
    chainId: 42161,
    contractAddress: "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064",
    interactionType: "swap",
    abi: SWAP_ABI,
  },
];

// ── Liquid tokens per chain for swap paths ────────────────────────────

const COMMON_TOKENS: Record<number, string[]> = {
  8453: [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    "0x4200000000000000000000000000000000000006", // WETH
  ],
  42161: [
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────

function getRpc(chainId: number): string {
  for (const [, c] of Object.entries(SUPPORTED_CHAINS)) {
    if (c.chainId === chainId) return c.rpc;
  }
  if (chainId === 8453) return "https://mainnet.base.org";
  if (chainId === 42161) return "https://arb1.arbitrum.io/rpc";
  throw new Error(`No RPC for chainId ${chainId}`);
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickN<T>(items: T[], n: number, seed: number): T[] {
  if (n >= items.length) return [...items];
  const rem = [...items];
  const out: T[] = [];
  let s = seed;
  for (let i = 0; i < n && rem.length > 0; i++) {
    const idx = s % rem.length;
    out.push(rem.splice(idx, 1)[0]);
    s = Math.floor(s / (rem.length + 1)) || s + 7;
  }
  return out;
}

// ── Main Farming Function ──────────────────────────────────────────────

export async function farmAirdrops(
  walletAddress: string,
  chainBalance: number,
): Promise<FarmResult> {
  const ts = Date.now();
  const count = chainBalance < 5 ? 1 : 2;
  const seed = ts + hashString(walletAddress);
  const protocols = pickN(FARM_PROTOCOLS, count, seed);

  // Gas check per chain
  const gasOk = new Map<number, boolean>();
  for (const cid of [...new Set(protocols.map((p) => p.chainId))]) {
    try {
      const p = new ethers.JsonRpcProvider(getRpc(cid));
      const fee = await p.getFeeData();
      const gwei = Number(ethers.formatUnits(fee.gasPrice ?? 0n, "gwei"));
      gasOk.set(cid, gwei <= 50);
    } catch {
      gasOk.set(cid, false);
    }
  }

  const eligible = protocols.filter((p) => gasOk.get(p.chainId) === true);
  if (eligible.length === 0) {
    return {
      success: false,
      interactions: 0,
      txHashes: [],
      gasSpent: "0",
      totalUsdValue: "0",
      skippedReason: "Gas > 50 gwei on all target chains",
      protocolNames: protocols.map((p) => p.name),
      timestamp: ts,
    };
  }

  // Use autonomous wallet if available, fall back to env var
  let pk = await getAutonomousPrivateKey();
  if (!pk) {
    pk = process.env.FARMER_PRIVATE_KEY;
  }
  if (!pk) {
    return {
      success: false,
      interactions: 0,
      txHashes: [],
      gasSpent: "0",
      totalUsdValue: "0",
      skippedReason: "No wallet configured. Generate autonomous wallet in Settings, or set FARMER_PRIVATE_KEY.",
      protocolNames: eligible.map((p) => p.name),
      timestamp: ts,
    };
  }

  // Execute interactions
  const results: { proto: AirdropProtocol; txHash: string; amountEth: string }[] = [];
  let totalGas = 0n;
  let totalUsd = 0;

  for (const proto of eligible) {
    try {
      const provider = new ethers.JsonRpcProvider(getRpc(proto.chainId));
      const signer = new ethers.Wallet(pk, provider);
      const contract = new ethers.Contract(proto.contractAddress, proto.abi, signer);

      const amountUsd = Math.max(chainBalance * 0.005, 0.50);
      const amountWei = ethers.parseEther((amountUsd / 3400).toFixed(8));

      if (proto.interactionType === "swap") {
        const tokens = COMMON_TOKENS[proto.chainId] ?? [];
        if (tokens.length === 0) continue;

        const path = [ethers.ZeroAddress, tokens[(ts + results.length) % tokens.length]];
        const deadline = Math.floor(Date.now() / 1000) + 300;

        if (proto.name === "Uniswap V3 (Base)") {
          const tx = await contract.exactInputSingle(
            {
              tokenIn: ethers.ZeroAddress,
              tokenOut: tokens[0],
              fee: 3000,
              recipient: walletAddress,
              deadline,
              amountIn: amountWei,
              amountOutMinimum: 0,
              sqrtPriceLimitX96: 0,
            },
            { value: amountWei, gasLimit: 300000 },
          );
          const r = await tx.wait(1);
          if (r) {
            totalGas += r.gasUsed * (r.gasPrice ?? 0n);
            totalUsd += amountUsd;
            results.push({ proto, txHash: r.hash, amountEth: ethers.formatEther(amountWei) });
          }
        } else {
          const tx = await contract.swapExactETHForTokens(
            0,
            path,
            walletAddress,
            deadline,
            { value: amountWei, gasLimit: 300000 },
          );
          const r = await tx.wait(1);
          if (r) {
            totalGas += r.gasUsed * (r.gasPrice ?? 0n);
            totalUsd += amountUsd;
            results.push({ proto, txHash: r.hash, amountEth: ethers.formatEther(amountWei) });
          }
        }
      } else if (proto.interactionType === "bridge") {
        const toBytes = ethers.zeroPadValue(walletAddress, 32);
        const tx = await contract.swapETH(
          110,
          walletAddress,
          toBytes,
          amountWei,
          0n,
          { value: amountWei, gasLimit: 500000 },
        );
        const r = await tx.wait(1);
        if (r) {
          totalGas += r.gasUsed * (r.gasPrice ?? 0n);
          totalUsd += amountUsd;
          results.push({ proto, txHash: r.hash, amountEth: ethers.formatEther(amountWei) });
        }
      }
    } catch (err) {
      console.warn(`[Farmer] ${proto.name} failed: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  // Persist
  if (isDbAvailable() && results.length > 0) {
    try {
      for (const r of results) {
        await sql`
          INSERT INTO airdrop_interactions
            (wallet_address, protocol_name, chain_id, interaction_type,
             contract_address, tx_hash, amount_eth, status, created_at)
          VALUES
            (${walletAddress}, ${r.proto.name}, ${r.proto.chainId},
             ${r.proto.interactionType}, ${r.proto.contractAddress},
             ${r.txHash}, ${r.amountEth}, 'confirmed',
             ${new Date(ts).toISOString()})
        `;
      }
    } catch (err) {
      console.warn("[Farmer] DB persist failed:", (err as Error).message);
    }
  }

  return {
    success: results.length > 0,
    interactions: results.length,
    txHashes: results.map((r) => r.txHash),
    gasSpent: ethers.formatEther(totalGas),
    totalUsdValue: totalUsd.toFixed(2),
    protocolNames: results.map((r) => r.proto.name),
    timestamp: ts,
  };
}
