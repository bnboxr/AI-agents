/**
 * HSMC — Deploy All Contracts
 *
 * Usage:
 *   npx hardhat run deploy/deploy-all.ts --network <name>
 *
 * Supported networks: ethereum, arbitrum, polygon, base, optimism, sepolia
 *
 * After deployment, verify with:
 *   npx hardhat verify --network <name> <address> <constructor-args...>
 * Or set DEPLOYMENT_MODE=mainnet in .env for auto-verification.
 */

import { ethers, network, run } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface DeployedContract {
  name: string;
  address: string;
  constructorArgs: unknown[];
}

interface DeploymentResult {
  chainName: string;
  chainId: number;
  timestamp: string;
  contracts: DeployedContract[];
}

// ─────────────────────────────────────────────────────────────────────
// Chain-specific LayerZero EIDs for CrossChainArbitrage constructor
// ─────────────────────────────────────────────────────────────────────

const LZ_EIDS: Record<string, number[]> = {
  ethereum: [30110, 30111, 30109, 30184], // Arbitrum, Optimism, Polygon, Base
  arbitrum: [30101, 30111, 30109, 30184],  // Ethereum, Optimism, Polygon, Base
  polygon: [30101, 30110, 30111, 30184],   // Ethereum, Arbitrum, Optimism, Base
  base: [30101, 30110, 30111, 30109],     // Ethereum, Arbitrum, Optimism, Polygon
  optimism: [30101, 30110, 30109, 30184],  // Ethereum, Arbitrum, Polygon, Base
  sepolia: [40161],                         // Sepolia testnet peer
};

// ─────────────────────────────────────────────────────────────────────
// Constructor args from env
// ─────────────────────────────────────────────────────────────────────

function getFlashLoanArgs(): [string, bigint] {
  const owner = process.env.FLASH_LOAN_OWNER || process.env.DEPLOYER_ADDRESS || "";
  const minProfit = BigInt(process.env.FLASH_LOAN_MIN_PROFIT || "1000000000000000000"); // 1 ETH
  if (!owner) throw new Error("FLASH_LOAN_OWNER or DEPLOYER_ADDRESS must be set");
  return [owner, minProfit];
}

function getCrossChainArgs(): [string, number[]] {
  const owner = process.env.CROSS_CHAIN_OWNER || process.env.DEPLOYER_ADDRESS || "";
  const eids = LZ_EIDS[network.name] || [30110, 30109];
  if (!owner) throw new Error("CROSS_CHAIN_OWNER or DEPLOYER_ADDRESS must be set");
  return [owner, eids];
}

function getYieldOptimizerArgs(): [string] {
  const owner = process.env.YIELD_OPTIMIZER_OWNER || process.env.DEPLOYER_ADDRESS || "";
  if (!owner) throw new Error("YIELD_OPTIMIZER_OWNER or DEPLOYER_ADDRESS must be set");
  return [owner];
}

// ─────────────────────────────────────────────────────────────────────
// Verification helper
// ─────────────────────────────────────────────────────────────────────

async function verifyContract(
  address: string,
  constructorArgs: unknown[],
  contractName: string
): Promise<void> {
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log(`  ⏭  Skipping verification on local network for ${contractName}`);
    return;
  }

  console.log(`  🔍 Verifying ${contractName} at ${address}...`);

  // Wait for Etherscan to index the contract
  await new Promise((resolve) => setTimeout(resolve, 15_000));

  try {
    await run("verify:verify", {
      address,
      constructorArguments: constructorArgs,
    });
    console.log(`  ✅ ${contractName} verified on ${network.name}`);
  } catch (err: any) {
    if (err.message?.includes("Already Verified")) {
      console.log(`  ✅ ${contractName} already verified`);
    } else {
      console.warn(`  ⚠️  Verification failed for ${contractName}: ${err.message?.slice(0, 200)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main deployment routine
// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<DeploymentResult> {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("\n🦚  HSMC — Contract Deployment");
  console.log("═══════════════════════════════════════");
  console.log(`  Network:     ${network.name} (chainId: ${network.config.chainId})`);
  console.log(`  Deployer:    ${deployer.address}`);
  console.log(`  Balance:     ${ethers.formatEther(balance)} ETH\n`);

  const singleContract = process.env.DEPLOY_SINGLE_CONTRACT || "";
  const result: DeploymentResult = {
    chainName: network.name,
    chainId: Number(network.config.chainId),
    timestamp: new Date().toISOString(),
    contracts: [],
  };

  // ──────────────────────────────────────────────────────────────
  // 1. HSMCVault (no deps — deploy first)
  // ──────────────────────────────────────────────────────────────
  if (!singleContract || singleContract === "HSMCVault") {
    console.log("📜 Deploying HSMCVault...");
    const vaultOwner = process.env.VAULT_OWNER || process.env.DEPLOYER_ADDRESS || deployer.address;
    const HSMCVault = await ethers.getContractFactory("HSMCVault");
    const vault = await HSMCVault.deploy(vaultOwner);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log(`  ✅ Deployed at: ${vaultAddr}`);
    result.contracts.push({
      name: "HSMCVault",
      address: vaultAddr,
      constructorArgs: [vaultOwner],
    });

    await verifyContract(vaultAddr, [vaultOwner], "HSMCVault");
  }

  // ──────────────────────────────────────────────────────────────
  // 2. YieldOptimizer
  // ──────────────────────────────────────────────────────────────
  if (!singleContract || singleContract === "YieldOptimizer") {
    console.log("\n📜 Deploying YieldOptimizer...");
    const yieldArgs = getYieldOptimizerArgs();
    const YieldOptimizer = await ethers.getContractFactory("YieldOptimizer");
    const yieldOpt = await YieldOptimizer.deploy(...yieldArgs);
    await yieldOpt.waitForDeployment();
    const yieldAddr = await yieldOpt.getAddress();
    console.log(`  ✅ Deployed at: ${yieldAddr}`);
    result.contracts.push({
      name: "YieldOptimizer",
      address: yieldAddr,
      constructorArgs: yieldArgs,
    });

    await verifyContract(yieldAddr, yieldArgs, "YieldOptimizer");
  }

  // ──────────────────────────────────────────────────────────────
  // 3. FlashLoanArbitrage
  // ──────────────────────────────────────────────────────────────
  if (!singleContract || singleContract === "FlashLoanArbitrage") {
    console.log("\n📜 Deploying FlashLoanArbitrage...");
    const flashArgs = getFlashLoanArgs();
    const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
    const flashLoan = await FlashLoanArbitrage.deploy(...flashArgs);
    await flashLoan.waitForDeployment();
    const flashAddr = await flashLoan.getAddress();
    console.log(`  ✅ Deployed at: ${flashAddr}`);
    result.contracts.push({
      name: "FlashLoanArbitrage",
      address: flashAddr,
      constructorArgs: flashArgs,
    });

    await verifyContract(flashAddr, flashArgs, "FlashLoanArbitrage");
  }

  // ──────────────────────────────────────────────────────────────
  // 4. CrossChainArbitrage
  // ──────────────────────────────────────────────────────────────
  if (!singleContract || singleContract === "CrossChainArbitrage") {
    console.log("\n📜 Deploying CrossChainArbitrage...");
    const crossArgs = getCrossChainArgs();
    const CrossChainArbitrage = await ethers.getContractFactory("CrossChainArbitrage");
    const crossChain = await CrossChainArbitrage.deploy(...crossArgs);
    await crossChain.waitForDeployment();
    const crossAddr = await crossChain.getAddress();
    console.log(`  ✅ Deployed at: ${crossAddr}`);
    result.contracts.push({
      name: "CrossChainArbitrage",
      address: crossAddr,
      constructorArgs: crossArgs.map((a) => (Array.isArray(a) ? a.map(Number) : a)),
    });

    await verifyContract(crossAddr, crossArgs, "CrossChainArbitrage");
  }

  // ──────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════");
  console.log("🦚  Deployment Summary");
  console.log("═══════════════════════════════════════");
  for (const c of result.contracts) {
    console.log(`  ${c.name}: ${c.address}`);
  }
  console.log("");

  // Save deployment artifacts for the frontend
  const fs = await import("fs");
  const outPath = "./deployed-addresses.json";
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`📝 Deployment output saved to ${outPath}\n`);

  return result;
}

main()
  .then((result) => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
