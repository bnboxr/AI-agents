import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

// ── Helpers ────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";
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
  },

  // ── Etherscan verification ──────────────────────────────────────
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "optimisticEthereum",
        chainId: 10,
        urls: {
          apiURL: "https://api-optimistic.etherscan.io/api",
          browserURL: "https://optimistic.etherscan.io",
        },
      },
      {
        network: "arbitrumOne",
        chainId: 42161,
        urls: {
          apiURL: "https://api.arbiscan.io/api",
          browserURL: "https://arbiscan.io",
        },
      },
    ],
  },

  // ── Gas reporter (optional CI tool) ────────────────────────────
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    outputFile: "gas-report.txt",
    noColors: true,
  },

  // ── Contract sizer ─────────────────────────────────────────────
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
    disambiguatePaths: false,
  },

  // ── Paths ──────────────────────────────────────────────────────
  paths: {
    sources: "./",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: {
    timeout: 120000, // 2 minutes — fork tests can be slow
  },
};

export default config;
