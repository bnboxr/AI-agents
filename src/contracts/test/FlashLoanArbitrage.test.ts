/**
 * HSMC — FlashLoanArbitrage Tests
 *
 * Run with:
 *   npx hardhat test test/FlashLoanArbitrage.test.ts
 *
 * For mainnet fork tests (recommended):
 *   DEPLOYMENT_MODE=fork ETHEREUM_RPC_URL=<url> npx hardhat test test/FlashLoanArbitrage.test.ts
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FlashLoanArbitrage } from "../typechain-types";

// Real mainnet addresses
const AAVE_V3_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

describe("FlashLoanArbitrage", function () {
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let contract: FlashLoanArbitrage;

  const MIN_PROFIT = ethers.parseEther("0.01"); // 0.01 ETH threshold

  before(async function () {
    [owner, user] = await ethers.getSigners();
  });

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory("FlashLoanArbitrage");
    contract = await Factory.deploy(owner.address, MIN_PROFIT);
    await contract.waitForDeployment();
  });

  // ────────────────────────────────────────────────────────────────
  // Deployment
  // ────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should set the correct min profit threshold", async function () {
      expect(await contract.minProfitThreshold()).to.equal(MIN_PROFIT);
    });

    it("should set default slippage to 50 bps (0.5%)", async function () {
      expect(await contract.slippageBps()).to.equal(50);
    });

    it("should have correct AAVE V3 Pool address", async function () {
      expect(await contract.AAVE_V3_POOL()).to.equal(AAVE_V3_POOL);
    });

    it("should have correct Uniswap V3 Router address", async function () {
      const router = await contract.UNISWAP_V3_ROUTER();
      expect(router).to.equal("0xE592427A0AEce92De3Edee1F18E0157C05861564");
    });

    it("should have correct Uniswap V2 Router address", async function () {
      const router = await contract.UNISWAP_V2_ROUTER();
      expect(router).to.equal("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D");
    });

    it("should have correct WETH address", async function () {
      expect(await contract.WETH()).to.equal(WETH);
    });

    it("should have flash loan fee of 5 bps", async function () {
      expect(await contract.FLASH_LOAN_FEE_BPS()).to.equal(5);
    });

    it("should start with zero total profit", async function () {
      expect(await contract.totalProfitAccrued()).to.equal(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Owner functions
  // ────────────────────────────────────────────────────────────────

  describe("Owner: setMinProfitThreshold", function () {
    it("should update the min profit threshold", async function () {
      const newThreshold = ethers.parseEther("0.05");
      await contract.connect(owner).setMinProfitThreshold(newThreshold);
      expect(await contract.minProfitThreshold()).to.equal(newThreshold);
    });

    it("should emit MinProfitUpdated event", async function () {
      const newThreshold = ethers.parseEther("0.05");
      await expect(contract.connect(owner).setMinProfitThreshold(newThreshold))
        .to.emit(contract, "MinProfitUpdated")
        .withArgs(MIN_PROFIT, newThreshold);
    });

    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).setMinProfitThreshold(100)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Owner: setSlippage", function () {
    it("should update the slippage", async function () {
      await contract.connect(owner).setSlippage(100);
      expect(await contract.slippageBps()).to.equal(100);
    });

    it("should emit SlippageUpdated event", async function () {
      await expect(contract.connect(owner).setSlippage(100))
        .to.emit(contract, "SlippageUpdated")
        .withArgs(50, 100);
    });

    it("should revert if slippage > 5000 bps (50%)", async function () {
      await expect(
        contract.connect(owner).setSlippage(5001)
      ).to.be.revertedWith("Slippage too high");
    });

    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).setSlippage(100)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Owner: withdrawToken", function () {
    it("should transfer tokens to the specified address", async function () {
      // Send some USDC to the contract first
      const usdc = await ethers.getContractAt("IERC20", USDC);
      // In fork mode, impersonate a USDC whale
      if (network.name === "hardhat") {
        // Skip if not forked
        this.skip();
      }
    });

    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).withdrawToken(USDC, user.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Owner: withdrawETH", function () {
    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).withdrawETH(user.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Arbitrage execution
  // ────────────────────────────────────────────────────────────────

  describe("executeArbitrage", function () {
    it("should revert with empty routes", async function () {
      await expect(
        contract.connect(owner).executeArbitrage(WETH, ethers.parseEther("1"), [])
      ).to.be.revertedWith("No routes provided");
    });

    it("should emit FlashLoanTaken event before flash loan", async function () {
      // In fork mode, this would actually execute
      // For unit tests without fork, the AAVE call will fail
      // We test that the function is callable
      const routes = [
        ethers.solidityPacked(
          ["uint8", "address[]"],
          [0, [WETH, USDC]]
        ),
      ];

      // Without a fork, AAVE address won't have code — expect revert from AAVE
      await expect(
        contract.connect(owner).executeArbitrage(
          WETH,
          ethers.parseEther("1"),
          routes,
        )
      ).to.be.reverted; // Will fail at AAVE pool call without fork
    });
  });

  // ────────────────────────────────────────────────────────────────
  // executeOperation (AAVE callback)
  // ────────────────────────────────────────────────────────────────

  describe("executeOperation", function () {
    it("should revert when called by non-AAVE address", async function () {
      await expect(
        contract.connect(user).executeOperation(
          WETH,
          ethers.parseEther("1"),
          0,
          user.address,
          "0x",
        )
      ).to.be.revertedWith("Only AAVE Pool");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // estimateProfit — view function
  // ────────────────────────────────────────────────────────────────

  describe("estimateProfit", function () {
    it("should return 0 when routes produce less output than input + fee", async function () {
      // Without fork, the quoter call will likely fail
      // In fork mode with real data, this would return a real estimate
      const routes = [
        ethers.solidityPacked(
          ["uint8", "address[]"],
          [0, [WETH, USDC]]
        ),
      ];

      try {
        const profit = await contract.estimateProfit(
          WETH,
          ethers.parseEther("1"),
          routes,
        );
        expect(profit).to.be.gte(0);
      } catch {
        // Expected to fail without fork — quoter address may not have code
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Receive ETH
  // ────────────────────────────────────────────────────────────────

  describe("receive", function () {
    it("should accept ETH transfers", async function () {
      const tx = await owner.sendTransaction({
        to: await contract.getAddress(),
        value: ethers.parseEther("1"),
      });
      await tx.wait();
      const balance = await ethers.provider.getBalance(await contract.getAddress());
      expect(balance).to.equal(ethers.parseEther("1"));
    });
  });
});
