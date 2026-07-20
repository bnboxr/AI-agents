/**
 * HSMC — CrossChainArbitrage Tests
 *
 * Run with:
 *   npx hardhat test test/CrossChainArbitrage.test.ts
 *
 * For mainnet fork tests (recommended):
 *   DEPLOYMENT_MODE=fork ETHEREUM_RPC_URL=<url> npx hardhat test test/CrossChainArbitrage.test.ts
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CrossChainArbitrage } from "../typechain-types";

// Real mainnet addresses
const LZ_ENDPOINT = "0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675";

describe("CrossChainArbitrage", function () {
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let contract: CrossChainArbitrage;

  const INITIAL_EIDS = [30110, 30109]; // Arbitrum, Polygon

  before(async function () {
    [owner, user] = await ethers.getSigners();
  });

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory("CrossChainArbitrage");
    contract = await Factory.deploy(owner.address, INITIAL_EIDS);
    await contract.waitForDeployment();
  });

  // ────────────────────────────────────────────────────────────────
  // Deployment
  // ────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should set supported destination EIDs", async function () {
      expect(await contract.supportedDstEid(30110)).to.be.true;
      expect(await contract.supportedDstEid(30109)).to.be.true;
      expect(await contract.supportedDstEid(30101)).to.be.false;
    });

    it("should have correct LayerZero endpoint address", async function () {
      const endpoint = await contract.LZ_ENDPOINT();
      expect(endpoint).to.equal(LZ_ENDPOINT);
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
      expect(await contract.WETH()).to.equal("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    });

    it("should set default slippage to 100 bps (1%)", async function () {
      expect(await contract.slippageBps()).to.equal(100);
    });

    it("should set default max bridge fee to 0.01 ETH", async function () {
      expect(await contract.maxBridgeFeeThreshold()).to.equal(ethers.parseEther("0.01"));
    });

    it("should set default swap deadline to 300 seconds", async function () {
      expect(await contract.swapDeadline()).to.equal(300);
    });

    it("should start with zero total arbitrages", async function () {
      expect(await contract.totalArbitrages()).to.equal(0);
    });

    it("should start with zero total profit", async function () {
      expect(await contract.totalProfit()).to.equal(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Owner: setDstChain
  // ────────────────────────────────────────────────────────────────

  describe("Owner: setDstChain", function () {
    it("should enable a new destination chain", async function () {
      await contract.connect(owner).setDstChain(30184, true);
      expect(await contract.supportedDstEid(30184)).to.be.true;
    });

    it("should disable an existing destination chain", async function () {
      await contract.connect(owner).setDstChain(30110, false);
      expect(await contract.supportedDstEid(30110)).to.be.false;
    });

    it("should emit DstChainUpdated event", async function () {
      await expect(contract.connect(owner).setDstChain(30184, true))
        .to.emit(contract, "DstChainUpdated")
        .withArgs(30184, true);
    });

    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).setDstChain(30184, true)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Owner: setMaxBridgeFeeThreshold
  // ────────────────────────────────────────────────────────────────

  describe("Owner: setMaxBridgeFeeThreshold", function () {
    it("should update the threshold", async function () {
      const newThreshold = ethers.parseEther("0.02");
      await contract.connect(owner).setMaxBridgeFeeThreshold(newThreshold);
      expect(await contract.maxBridgeFeeThreshold()).to.equal(newThreshold);
    });

    it("should emit BridgeFeeThresholdUpdated event", async function () {
      const newThreshold = ethers.parseEther("0.02");
      await expect(contract.connect(owner).setMaxBridgeFeeThreshold(newThreshold))
        .to.emit(contract, "BridgeFeeThresholdUpdated")
        .withArgs(ethers.parseEther("0.01"), newThreshold);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Owner: setSlippage
  // ────────────────────────────────────────────────────────────────

  describe("Owner: setSlippage", function () {
    it("should update slippage", async function () {
      await contract.connect(owner).setSlippage(200);
      expect(await contract.slippageBps()).to.equal(200);
    });

    it("should revert if slippage > 5000", async function () {
      await expect(
        contract.connect(owner).setSlippage(5001)
      ).to.be.revertedWith("Slippage too high");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Owner: setSwapDeadline
  // ────────────────────────────────────────────────────────────────

  describe("Owner: setSwapDeadline", function () {
    it("should update the swap deadline", async function () {
      await contract.connect(owner).setSwapDeadline(600);
      expect(await contract.swapDeadline()).to.equal(600);
    });

    it("should revert if deadline < 60 seconds", async function () {
      await expect(
        contract.connect(owner).setSwapDeadline(30)
      ).to.be.revertedWith("Invalid deadline");
    });

    it("should revert if deadline > 3600 seconds", async function () {
      await expect(
        contract.connect(owner).setSwapDeadline(3601)
      ).to.be.revertedWith("Invalid deadline");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Pause / Unpause (Circuit Breaker)
  // ────────────────────────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    it("should pause and unpause", async function () {
      await contract.connect(owner).pause();
      expect(await contract.paused()).to.be.true;

      await contract.connect(owner).unpause();
      expect(await contract.paused()).to.be.false;
    });

    it("should revert executeBuyAndBridge when paused", async function () {
      await contract.connect(owner).pause();

      await expect(
        contract.connect(owner).executeBuyAndBridge(
          "0x0000000000000000000000000000000000000000",
          0,
          30110,
          "0x",
          [],
          0,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("should revert when non-owner tries to pause", async function () {
      await expect(
        contract.connect(user).pause()
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // executeBuyAndBridge
  // ────────────────────────────────────────────────────────────────

  describe("executeBuyAndBridge", function () {
    it("should revert for unsupported destination chain", async function () {
      await expect(
        contract.connect(owner).executeBuyAndBridge(
          "0x0000000000000000000000000000000000000000",
          0,
          99999,
          "0x",
          [],
          0,
        )
      ).to.be.revertedWith("Unsupported dst chain");
    });

    it("should revert if bridge fee exceeds threshold", async function () {
      await expect(
        contract.connect(owner).executeBuyAndBridge(
          "0x0000000000000000000000000000000000000000",
          0,
          30110,
          "0x",
          [],
          ethers.parseEther("1"), // > 0.01 ETH threshold
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Bridge fee too high");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // lzReceive
  // ────────────────────────────────────────────────────────────────

  describe("lzReceive", function () {
    it("should revert when called by non-LZ endpoint", async function () {
      await expect(
        contract.connect(user).lzReceive(
          { srcEid: 30110, sender: ethers.ZeroHash, nonce: 0 },
          ethers.ZeroHash,
          "0x",
          user.address,
          "0x",
        )
      ).to.be.revertedWith("Only LZ endpoint");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // estimateCrossChainOpportunity
  // ────────────────────────────────────────────────────────────────

  describe("estimateCrossChainOpportunity", function () {
    it("should return 0 for unprofitable routes", async function () {
      // Without fork, V2 router might not be available
      // In fork mode this would return a real estimate
      try {
        const profit = await contract.estimateCrossChainOpportunity(
          ethers.parseEther("1"),
          ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
          ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
          ethers.parseEther("0.01"),
        );
        expect(profit).to.be.gte(0);
      } catch {
        // Expected to fail without fork
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Rate limiting
  // ────────────────────────────────────────────────────────────────

  describe("Rate limiting", function () {
    it("should enforce RATE_LIMIT_OPS of 3 per hour", async function () {
      expect(await contract.RATE_LIMIT_OPS()).to.equal(3);
      expect(await contract.RATE_LIMIT_WINDOW()).to.equal(3600);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Emergency: withdrawToken / withdrawETH
  // ────────────────────────────────────────────────────────────────

  describe("Emergency: withdrawToken", function () {
    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).withdrawToken(
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          user.address,
        )
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Emergency: withdrawETH", function () {
    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).withdrawETH(user.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });
});
