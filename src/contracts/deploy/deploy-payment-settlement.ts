/**
 * PaymentSettlement — Dedicated deployment script (hardhat)
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... POLYGON_AMOY_RPC_URL=https://... \
 *     npx hardhat run deploy/deploy-payment-settlement.ts --network polygon-amoy
 *   or, mainnet:
 *     npx hardhat run deploy/deploy-payment-settlement.ts --network polygon
 *
 * Env required (throw when absent — owner hard rule, no demo defaults):
 *   DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) — funded deployer
 *   POLYGON_AMOY_RPC_URL when targeting Amoy (or POLYGON_RPC_URL for mainnet,
 *   already wired in hardhat.config.ts networks)
 *
 * Optional:
 *   POLYGONSCAN_API_KEY — contract verification
 *   VITE_POS_OWNER_ADDRESS — post-deploy transferOwnership target
 *
 * The contract itself: PaymentSettlement.sol (constructor() → owner = deployer).
 */

import { ethers, network, run } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// ── Env guards ─────────────────────────────────────────────────────────

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
  const key =
    process.env.DEPLOYER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    "";
  if (!key || key.trim().length === 0) {
    throw new Error(
      "[deploy] PaymentSettlement requires DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) — add it to Secrets. Refusing to deploy with an empty key.",
    );
  }
  return key;
}

// ── Verify ─────────────────────────────────────────────────────────────

async function verifyContract(address: string, constructorArgs: unknown[]): Promise<void> {
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log("  ⏭  Skipping verification on local network");
    return;
  }
  if (!process.env.POLYGONSCAN_API_KEY) {
    console.log("  ⏭  Skipping verification (POLYGONSCAN_API_KEY not set)");
    return;
  }
  console.log(`  🔍 Verifying PaymentSettlement at ${address}...`);
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  try {
    await run("verify:verify", { address, constructorArguments: constructorArgs });
    console.log("  ✅ PaymentSettlement verified");
  } catch (err: any) {
    if (String(err?.message ?? "").includes("Already Verified")) {
      console.log("  ✅ PaymentSettlement already verified");
    } else {
      console.warn(`  ⚠️  Verification failed: ${String(err?.message ?? err).slice(0, 200)}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<string> {
  console.log("\n🦚  PaymentSettlement — Dedicated Deployment");
  console.log("═══════════════════════════════════════");

  if (network.name !== "polygon-amoy" && network.name !== "polygon") {
    throw new Error(
      `[deploy] PaymentSettlement must deploy to --network polygon-amoy (80002) or polygon (137); got "${network.name}".`,
    );
  }

  // Guards FIRST — fail loudly before any network call.
  resolveDeployerKey();
  if (network.name === "polygon-amoy") {
    requireEnv("POLYGON_AMOY_RPC_URL");
  } else {
    requireEnv("POLYGON_RPC_URL");
  }

  const deployer = await ethers.provider.getSigner();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  console.log(`  Network:     ${network.name} (chainId: ${network.config.chainId})`);
  console.log(`  Deployer:    ${deployerAddr}`);
  console.log(`  Balance:     ${ethers.formatEther(balance)} native\n`);

  const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
  const settlement = await PaymentSettlement.deploy();
  await settlement.waitForDeployment();
  const addr = await settlement.getAddress();
  console.log(`  ✅ Deployed at: ${addr}`);

  await verifyContract(addr, []);

  // Optional post-deploy ownership transfer (contract has transferOwnership).
  const ownerTarget = process.env.VITE_POS_OWNER_ADDRESS;
  if (ownerTarget && ownerTarget.toLowerCase() !== deployerAddr.toLowerCase()) {
    console.log(`  🔑 Transferring ownership to ${ownerTarget}...`);
    const tx = await settlement.transferOwnership(ownerTarget);
    await tx.wait(1);
    console.log("  ✅ Ownership transferred");
  }

  console.log("\n  📌 Add to your .env:");
  console.log(`     VITE_POS_CONTRACT_ADDRESS=${addr}`);
  console.log(`     VITE_POS_NETWORK=${network.name === "polygon" ? "mainnet" : "amoy"}\n`);
  return addr;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });