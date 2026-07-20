import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

// ── Helpers ────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";
const MNEMONIC = process.env.MNEMONIC || "";

function accounts(): string[] | { mnemonic: string } {
  if (MNEMONIC) return { mnemonic: MNEMONIC };
  return [PRIVATE_KEY];
}

const GAS_PRICE = process.env.GAS_PRICE_GWEI === "auto" ? "auto" : parseInt(process.env.GAS_PRICE_GWEI || "50", 10) * 1e9;
const PRIORITY_FEE = parseInt(process.env.PRIORITY_FEE_GWEI || "2", 10) * 1e9;

// ── Config ─────────────────────────────────────────────────────────

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          metadata: {
            bytecodeHash: "none",
          },
        },
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          metadata: {
            bytecodeHash: "none",
          },
        },
      },
    ],
  },

  // Prevent "source file requires different compiler version" errors
  //
  // The OpenZeppelin v5 contracts use 0.8.20+ so both compilers above are fine.

  networks: {
    // ── Hardhat local ─────────────────────────────────────────
    hardhat: {
      chainId: 31337,
      forking: process.env.DEPLOYMENT_MODE === "fork"
        ? {
            url: process.env.ETHEREUM_RPC_URL || "https://eth.drpc.org",
            blockNumber: process.env.FORK_BLOCK_NUMBER === "latest"
              ? undefined
              : parseInt(process.env.FORK_BLOCK_NUMBER || "0", 10),
          }
        : undefined,
      allowUnlimitedContractSize: true,
    },

    // ── Ethereum Mainnet ──────────────────────────────────────
    ethereum: {
      url: process.env.ETHEREUM_RPC_URL || "https://eth.drpc.org",
      chainId: 1,
      accounts: accounts(),
      gasPrice: GAS_PRICE,
      maxPriorityFeePerGas: PRIORITY_FEE,
    },

    // ── Arbitrum One ──────────────────────────────────────────
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: accounts(),
      gasPrice: GAS_PRICE,
    },

    // ── Polygon PoS ───────────────────────────────────────────
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts: accounts(),
      gasPrice: GAS_PRICE,
      maxPriorityFeePerGas: PRIORITY_FEE,
    },

    // ── Base ──────────────────────────────────────────────────
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: accounts(),
      gasPrice: GAS_PRICE,
    },

    // ── Optimism ──────────────────────────────────────────────
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      chainId: 10,
      accounts: accounts(),
      gasPrice: GAS_PRICE,
    },

    // ── Sepolia Testnet (for staging) ─────────────────────────
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "demo"}`,
      chainId: 11155111,
      accounts: accounts(),
    },

    // ── Arbitrum Sepolia ──────────────────────────────────────
    "arbitrum-sepolia": {
      url: `https://arb-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "demo"}`,
      chainId: 421614,
      accounts: accounts(),
    },

    // ── Base Sepolia ──────────────────────────────────────────
    "base-sepolia": {
      url: `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "demo"}`,
      chainId: 84532,
      accounts: accounts(),
    },

    // ── Polygon Mumbai ────────────────────────────────────────
    "polygon-mumbai": {
      url: `https://polygon-mumbai.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "demo"}`,
      chainId: 80001,
      accounts: accounts(),
      gasPrice: 40_000_000_000, // 40 gwei
    },

    // ── Optimism Sepolia ──────────────────────────────────────
    "optimism-sepolia": {
      url: `https://opt-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "demo"}`,
      chainId: 11155420,
      accounts: accounts(),
    },

    // ── Scroll Sepolia ────────────────────────────────────────
    "scroll-sepolia": {
      url: `https://scroll-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "demo"}`,
      chainId: 534351,
      accounts: accounts(),
    },
  },

  // ── Paths ──────────────────────────────────────────────────────
  paths: {
    sources: "./",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
