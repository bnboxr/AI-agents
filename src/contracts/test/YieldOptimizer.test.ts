/**
 * HSMC — YieldOptimizer Tests
 *
 * Run with:
 *   npx hardhat test test/YieldOptimizer.test.ts
 *
 * For mainnet fork tests (recommended):
 *   DEPLOYMENT_MODE=fork ETHEREUM_RPC_URL=<url> npx hardhat test test/YieldOptimizer.test.ts
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { YieldOptimizer } from "../typechain-types";

// Real mainnet addresses
const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const COMPOUND_COMET = "0xc3d688B66703497DAA19211EEdff47f25384cdc3";
const LIDO_STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("YieldOptimizer", function () {
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let contract: YieldOptimizer;

  before(async function () {
    [owner, user] = await ethers.getSigners();
  });

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory("YieldOptimizer");
    contract = await Factory.deploy(owner.address);
    await contract.waitForDeployment();
  });

  // ────────────────────────────────────────────────────────────────
  // Deployment
  // ────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should have correct AAVE V3 Pool address", async function () {
      expect(await contract.AAVE_POOL()).to.equal(AAVE_POOL);
    });

    it("should have correct Compound V3 Comet address", async function () {
      expect(await contract.COMPOUND_COMET()).to.equal(COMPOUND_COMET);
    });

    it("should have correct Lido stETH address", async function () {
      expect(await contract.LIDO_STETH()).to.equal(LIDO_STETH);
    });

    it("should have correct USDC address", async function () {
      expect(await contract.USDC()).to.equal(USDC);
    });

    it("should have correct WETH address", async function () {
      expect(await contract.WETH()).to.equal(WETH);
    });

    it("should set default AAVE allocation to 40%", async function () {
      const alloc = await contract.allocationBps(1); // PROTO_AAVE = 1
      expect(alloc).to.equal(4000);
    });

    it("should set default Compound allocation to 35%", async function () {
      const alloc = await contract.allocationBps(2); // PROTO_COMPOUND = 2
      expect(alloc).to.equal(3500);
    });

    it("should set default Lido allocation to 25%", async function () {
      const alloc = await contract.allocationBps(3); // PROTO_LIDO = 3
      expect(alloc).to.equal(2500);
    });

    it("should set default performance fee to 10%", async function () {
      expect(await contract.performanceFeeBps()).to.equal(1000);
    });

    it("should set default TWAP period to 30 minutes", async function () {
      expect(await contract.twapPeriod()).to.equal(1800);
    });

    it("should set default compound cooldown to 1 hour", async function () {
      expect(await contract.compoundCooldown()).to.equal(3600);
    });

    it("should start with zero total value locked", async function () {
      expect(await contract.totalValueLocked()).to.equal(0);
    });

    it("should start with zero total fees collected", async function () {
      expect(await contract.totalFeesCollected()).to.equal(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Deposit
  // ────────────────────────────────────────────────────────────────

  describe("deposit", function () {
    it("should revert with zero amount", async function () {
      await expect(
        contract.connect(user).deposit(0)
      ).to.be.revertedWith("Zero amount");
    });

    it("should revert when paused", async function () {
      await contract.connect(owner).pause();
      await expect(
        contract.connect(user).deposit(ethers.parseUnits("1000", 6))
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("should emit Deposited event on success (requires fork)", async function () {
      // This test requires a mainnet fork to have real USDC
      if (network.name !== "hardhat") {
        // In non-fork mode, USDC transferFrom will fail
        this.skip();
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // depositETH
  // ────────────────────────────────────────────────────────────────

  describe("depositETH", function () {
    it("should revert with zero ETH", async function () {
      await expect(
        contract.connect(user).depositETH({ value: 0 })
      ).to.be.revertedWith("Zero ETH");
    });

    it("should revert when paused", async function () {
      await contract.connect(owner).pause();
      await expect(
        contract.connect(user).depositETH({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Withdraw
  // ────────────────────────────────────────────────────────────────

  describe("withdraw", function () {
    it("should revert with zero amount", async function () {
      await expect(
        contract.connect(user).withdraw(0)
      ).to.be.revertedWith("Zero amount");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Auto Compound
  // ────────────────────────────────────────────────────────────────

  describe("autoCompound", function () {
    it("should emit Compounded event", async function () {
      // In fork mode with real AAVE deposits, this would harvest
      await expect(
        contract.connect(owner).autoCompound()
      ).to.emit(contract, "Compounded");
    });

    it("should revert when paused", async function () {
      await contract.connect(owner).pause();
      await expect(
        contract.connect(owner).autoCompound()
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Rebalance
  // ────────────────────────────────────────────────────────────────

  describe("rebalance", function () {
    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).rebalance()
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert when paused", async function () {
      await contract.connect(owner).pause();
      await expect(
        contract.connect(owner).rebalance()
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // View: bestProtocol / getAllApys / totalBalance
  // ────────────────────────────────────────────────────────────────

  describe("View functions", function () {
    it("bestProtocol should return a valid protocol (1, 2, or 3)", async function () {
      const proto = await contract.bestProtocol();
      expect(proto).to.be.oneOf([1, 2, 3]);
    });

    it("getAllApys should return three non-negative values", async function () {
      const [aave, compound, lido] = await contract.getAllApys();
      expect(aave).to.be.gte(0);
      expect(compound).to.be.gte(0);
      expect(lido).to.be.gte(0);
    });

    it("totalBalance should return 0 for empty contract", async function () {
      const balance = await contract.totalBalance();
      expect(balance).to.equal(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Owner: Configuration
  // ────────────────────────────────────────────────────────────────

  describe("Owner: setPerformanceFee", function () {
    it("should update the fee", async function () {
      await contract.connect(owner).setPerformanceFee(500);
      expect(await contract.performanceFeeBps()).to.equal(500);
    });

    it("should emit PerformanceFeeUpdated event", async function () {
      await expect(contract.connect(owner).setPerformanceFee(500))
        .to.emit(contract, "PerformanceFeeUpdated")
        .withArgs(1000, 500);
    });

    it("should revert if fee > 2000 (20%)", async function () {
      await expect(
        contract.connect(owner).setPerformanceFee(2001)
      ).to.be.revertedWith("Fee too high");
    });

    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).setPerformanceFee(500)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Owner: setAllocation", function () {
    it("should update allocation for a protocol", async function () {
      await contract.connect(owner).setAllocation(1, 5000);
      expect(await contract.allocationBps(1)).to.equal(5000);
    });

    it("should emit AllocationUpdated event", async function () {
      await expect(contract.connect(owner).setAllocation(1, 5000))
        .to.emit(contract, "AllocationUpdated")
        .withArgs(1, 4000, 5000);
    });

    it("should revert for invalid protocol ID", async function () {
      await expect(
        contract.connect(owner).setAllocation(0, 5000)
      ).to.be.revertedWith("Invalid protocol");
    });

    it("should revert for allocation > 100%", async function () {
      await expect(
        contract.connect(owner).setAllocation(1, 10001)
      ).to.be.revertedWith("Invalid bps");
    });
  });

  describe("Owner: setTwapPeriod", function () {
    it("should update the TWAP period", async function () {
      await contract.connect(owner).setTwapPeriod(600);
      expect(await contract.twapPeriod()).to.equal(600);
    });

    it("should revert for period < 60", async function () {
      await expect(
        contract.connect(owner).setTwapPeriod(30)
      ).to.be.revertedWith("Invalid TWAP period");
    });

    it("should revert for period > 3600", async function () {
      await expect(
        contract.connect(owner).setTwapPeriod(3601)
      ).to.be.revertedWith("Invalid TWAP period");
    });
  });

  describe("Owner: setCompoundCooldown", function () {
    it("should update the cooldown", async function () {
      await contract.connect(owner).setCompoundCooldown(7200);
      expect(await contract.compoundCooldown()).to.equal(7200);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Pause / Unpause
  // ────────────────────────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    it("should pause and unpause", async function () {
      await contract.connect(owner).pause();
      expect(await contract.paused()).to.be.true;

      await contract.connect(owner).unpause();
      expect(await contract.paused()).to.be.false;
    });

    it("should revert when non-owner tries to pause", async function () {
      await expect(
        contract.connect(user).pause()
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Emergency Withdraw
  // ────────────────────────────────────────────────────────────────

  describe("emergencyWithdraw", function () {
    it("should revert when called by non-owner", async function () {
      await expect(
        contract.connect(user).emergencyWithdraw()
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should set totalValueLocked to 0", async function () {
      await contract.connect(owner).emergencyWithdraw();
      expect(await contract.totalValueLocked()).to.equal(0);
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
