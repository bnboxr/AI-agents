/**
 * HSMC — Deploy Single Contract
 *
 * Usage:
 *   npx hardhat run deploy/deploy-contract.ts --network <name>
 *
 * Set DEPLOY_CONTRACT env var to one of:
 *   FlashLoanArbitrage, CrossChainArbitrage, HSMCVault, YieldOptimizer
 *
 * Example:
 *   DEPLOY_CONTRACT=HSMCVault npx hardhat run deploy/deploy-contract.ts --network sepolia
 */

import { ethers, network, run } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function getDeployerAddress(): string {
  return process.env.DEPLOYER_ADDRESS || "";
}

const LZ_EIDS: Record<string, number[]> = {
  ethereum: [30110, 30111, 30109, 30184],
  arbitrum: [30101, 30111, 30109, 30184],
  polygon: [30101, 30110, 30111, 30184],
  base: [30101, 30110, 30111, 30109],
  optimism: [30101, 30110, 30109, 30184],
  sepolia: [40161],
  "arbitrum-sepolia": [40231],
  "base-sepolia": [40245],
  "polygon-mumbai": [40161],
  "optimism-sepolia": [40232],
  "scroll-sepolia": [40170],
};

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
  await new Promise((resolve) => setTimeout(resolve, 15_000));

  try {
    await run("verify:verify", { address, constructorArguments: constructorArgs });
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
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const contractName = process.env.DEPLOY_CONTRACT || "";
  if (!contractName) {
    console.error("❌ Set DEPLOY_CONTRACT to one of: FlashLoanArbitrage, CrossChainArbitrage, HSMCVault, YieldOptimizer");
    process.exit(1);
  }

  const validContracts = ["FlashLoanArbitrage", "CrossChainArbitrage", "HSMCVault", "YieldOptimizer"];
  if (!validContracts.includes(contractName)) {
    console.error(`❌ Unknown contract: ${contractName}. Must be one of: ${validContracts.join(", ")}`);
    process.exit(1);
  }

  const deployer = await ethers.provider.getSigner();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  console.log("\n🦚  HSMC — Single Contract Deployment");
  console.log("═══════════════════════════════════════");
  console.log(`  Contract:    ${contractName}`);
  console.log(`  Network:     ${network.name} (chainId: ${network.config.chainId})`);
  console.log(`  Deployer:    ${deployerAddr}`);
  console.log(`  Balance:     ${ethers.formatEther(balance)} ETH\n`);

  let args: unknown[] = [];
  const owner = getDeployerAddress() || deployerAddr;

  switch (contractName) {
    case "HSMCVault": {
      // HSMCVault: constructor(address _owner)
      console.log("📜 Deploying HSMCVault...");
      args = [owner];
      const HSMCVault = await ethers.getContractFactory("HSMCVault");
      const vault = await HSMCVault.deploy(...args);
      await vault.waitForDeployment();
      const vaultAddr = await vault.getAddress();
      console.log(`  ✅ Deployed at: ${vaultAddr}`);
      await verifyContract(vaultAddr, args, "HSMCVault");
      console.log(`\n  HSMCVault: ${vaultAddr}`);
      break;
    }

    case "YieldOptimizer": {
      // YieldOptimizer: constructor(address _owner)
      console.log("📜 Deploying YieldOptimizer...");
      args = [owner];
      const YieldOptimizer = await ethers.getContractFactory("YieldOptimizer");
      const yieldOpt = await YieldOptimizer.deploy(...args);
      await yieldOpt.waitForDeployment();
      const yieldAddr = await yieldOpt.getAddress();
      console.log(`  ✅ Deployed at: ${yieldAddr}`);
      await verifyContract(yieldAddr, args, "YieldOptimizer");
      console.log(`\n  YieldOptimizer: ${yieldAddr}`);
      break;
    }

    case "FlashLoanArbitrage": {
      // FlashLoanArbitrage: constructor(address _owner, uint256 _minProfit)
      const minProfit = BigInt(process.env.FLASH_LOAN_MIN_PROFIT || "1000000000000000000");
      console.log("📜 Deploying FlashLoanArbitrage...");
      args = [owner, minProfit];
      const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
      const flashLoan = await FlashLoanArbitrage.deploy(...args);
      await flashLoan.waitForDeployment();
      const flashAddr = await flashLoan.getAddress();
      console.log(`  ✅ Deployed at: ${flashAddr}`);
      await verifyContract(flashAddr, args, "FlashLoanArbitrage");
      console.log(`\n  FlashLoanArbitrage: ${flashAddr}`);
      break;
    }

    case "CrossChainArbitrage": {
      // CrossChainArbitrage: constructor(address _owner, uint32[] _peerEids)
      const eids = LZ_EIDS[network.name] || [40161];
      console.log("📜 Deploying CrossChainArbitrage...");
      args = [owner, eids];
      const CrossChainArbitrage = await ethers.getContractFactory("CrossChainArbitrage");
      const crossChain = await CrossChainArbitrage.deploy(...args);
      await crossChain.waitForDeployment();
      const crossAddr = await crossChain.getAddress();
      console.log(`  ✅ Deployed at: ${crossAddr}`);
      await verifyContract(crossAddr, args, "CrossChainArbitrage");
      console.log(`\n  CrossChainArbitrage: ${crossAddr}`);
      break;
    }
  }

  console.log("═══════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
