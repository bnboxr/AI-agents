/**
 * PaymentSettlement Contract Deployment Script
 *
 * Usage:
 *   npx hardhat run src/contracts/deploy.ts --network polygon-amoy
 *   npx hardhat run src/contracts/deploy.ts --network polygon
 *
 * Requires compiled artifacts (run `npx hardhat compile` in src/contracts
 * first — they live at src/contracts/artifacts/contracts/PaymentSettlement.sol/).
 *
 * Environment variables (missing → throw, no demo fallback):
 *   DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) — deployer private key (without 0x prefix)
 *   POLYGON_AMOY_RPC_URL — Amoy testnet RPC URL
 *   POLYGON_RPC_URL — Polygon mainnet RPC URL
 */

import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ── Real compiled artifact (never an empty "0x" bytecode) ─────────────
// hardhat build artifacts: src/contracts/artifacts/contracts/PaymentSettlement.sol/PaymentSettlement.json
const ARTIFACT_CANDIDATES = [
  "./artifacts/contracts/PaymentSettlement.sol/PaymentSettlement.json",
  "./src/contracts/artifacts/contracts/PaymentSettlement.sol/PaymentSettlement.json",
];

function loadArtifact(): { bytecode: string; abi: unknown[] } {
  for (const candidate of ARTIFACT_CANDIDATES) {
    if (existsSync(candidate)) {
      const raw = JSON.parse(readFileSync(candidate, "utf8")) as {
        bytecode?: string;
        abi?: unknown[];
      };
      if (raw.bytecode && raw.abi && raw.bytecode !== "0x" && raw.bytecode.length > 2) {
        return { bytecode: raw.bytecode, abi: raw.abi };
      }
      throw new Error(
        `[deploy] Artifact ${candidate} exists but has no real bytecode/ABI — re-run 'npx hardhat compile' and retry.`,
      );
    }
  }
  throw new Error(
    "[deploy] PaymentSettlement artifact not found — run `npx hardhat compile` in src/contracts first. Refusing to deploy empty bytecode.",
  );
}

// ── Env guards (owner hard rule) ───────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[deploy] PaymentSettlement requires ${name} — add it to Secrets. Refusing to simulate.`,
    );
  }
  return value;
}

function resolveDeployerKey(): string {
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
  if (!key || key.trim().length === 0) {
    throw new Error(
      "[deploy] PaymentSettlement requires DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) — add it to Secrets. Refusing to deploy with an empty key.",
    );
  }
  return key;
}

// ── Configuration ────────────────────────────────────────────────────

interface DeployConfig {
  chain: typeof polygon | typeof polygonAmoy;
  rpcUrl: string;
  chainName: string;
}

async function getConfig(): Promise<DeployConfig> {
  const network = process.env.DEPLOY_NETWORK || "amoy";

  if (network === "mainnet" || network === "polygon") {
    const rpcUrl = requireEnv("POLYGON_RPC_URL");
    return { chain: polygon, rpcUrl, chainName: "Polygon Mainnet" };
  }

  // Amoy testnet — no demo RPC fallback
  const rpcUrl = requireEnv("POLYGON_AMOY_RPC_URL");
  return { chain: polygonAmoy, rpcUrl, chainName: "Polygon Amoy (Testnet)" };
}

// ── Deploy ───────────────────────────────────────────────────────────

async function main() {
  console.log("═══ PaymentSettlement Contract Deployer ═══\n");

  const { bytecode: CONTRACT_BYTECODE, abi: CONTRACT_ABI } = loadArtifact();
  const privateKey = resolveDeployerKey();

  const config = await getConfig();
  console.log(`📡 Network: ${config.chainName}`);
  console.log(`🔗 RPC:     ${config.rpcUrl}\n`);

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
    account,
  });

  console.log(`👛 Deployer: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Balance:  ${balance} wei\n`);

  if (balance === 0n) {
    console.error("❌ Deployer has no funds. Fund the wallet or use a faucet.");
    process.exit(1);
  }

  console.log("🚀 Deploying PaymentSettlement...\n");

  try {
    const txHash = await walletClient.deployContract({
      abi: CONTRACT_ABI,
      bytecode: CONTRACT_BYTECODE as `0x${string}`,
      account,
    });

    console.log(`📝 TX Hash: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const contractAddress = receipt.contractAddress;

    if (!contractAddress) {
      console.error("❌ Deployment failed — no contract address in receipt.");
      process.exit(1);
    }

    console.log("\n✅ PaymentSettlement deployed successfully!");
    console.log(`📍 Address:  ${contractAddress}`);
    console.log(`🔗 Explorer: ${config.chain.blockExplorers?.default.url}/address/${contractAddress}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed}`);
    console.log(`📦 Block:    ${receipt.blockNumber}\n`);

    // Verify token configuration
    console.log("📋 Accepted tokens:");
    console.log("   USDC:  0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 (mainnet)");
    console.log("   USDC:  0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 (amoy)");
    console.log("   USDT:  0xc2132D05D31c914a87C6611C10748AEb04B58e8F (mainnet)");
    console.log("   MATIC: native\n");

    console.log("📌 Add to your .env file:");
    console.log(`   VITE_POS_CONTRACT_ADDRESS=${contractAddress}\n`);

  } catch (err) {
    console.error("❌ Deployment failed:", err);
    process.exit(1);
  }
}

// Only run when executed directly
if (import.meta.main || require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

export { main };
