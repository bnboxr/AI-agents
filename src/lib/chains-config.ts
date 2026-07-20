// ── Wallet Chain Configuration ───────────────────────────────────────
// Mainnet + testnet chain definitions for wallet/DEX trading.
// Used by the chain selector in Settings and the DEX adapter.

export interface WalletChainConfig {
  chainId: number;
  name: string;
  rpc: string;
  explorer: string;
  testnet?: boolean;
  /** Uniswap V3 SwapRouter address on this chain */
  uniswapV3Router?: string;
  /** Native token symbol */
  nativeToken: string;
  /** Faucet links (only for testnets) */
  faucets?: string[];
}

export const SUPPORTED_CHAINS: Record<string, WalletChainConfig> = {
  ethereum: {
    chainId: 1,
    name: "Ethereum",
    rpc: "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    uniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    nativeToken: "ETH",
  },
  sepolia: {
    chainId: 11155111,
    name: "Sepolia",
    rpc: "https://rpc.sepolia.org",
    explorer: "https://sepolia.etherscan.io",
    testnet: true,
    uniswapV3Router: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
    nativeToken: "ETH",
    faucets: [
      "https://sepoliafaucet.com",
      "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
    ],
  },
  arbitrum: {
    chainId: 42161,
    name: "Arbitrum",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    uniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    nativeToken: "ETH",
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    testnet: true,
    uniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    nativeToken: "ETH",
    faucets: [
      "https://faucet.quicknode.com/arbitrum/sepolia",
    ],
  },
  base: {
    chainId: 8453,
    name: "Base",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    uniswapV3Router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    nativeToken: "ETH",
  },
  "base-sepolia": {
    chainId: 84532,
    name: "Base Sepolia",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    testnet: true,
    uniswapV3Router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    nativeToken: "ETH",
    faucets: [
      "https://faucet.quicknode.com/base/sepolia",
    ],
  },
  polygon: {
    chainId: 137,
    name: "Polygon",
    rpc: "https://polygon.llamarpc.com",
    explorer: "https://polygonscan.com",
    uniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    nativeToken: "MATIC",
  },
  mumbai: {
    chainId: 80001,
    name: "Mumbai",
    rpc: "https://rpc-mumbai.maticvigil.com",
    explorer: "https://mumbai.polygonscan.com",
    testnet: true,
    uniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    nativeToken: "MATIC",
    faucets: [
      "https://faucet.polygon.technology/",
    ],
  },
};

/** Wallet chain storage key */
const WALLET_CHAIN_KEY = "hsmc_wallet_chain";
const DEFAULT_WALLET_CHAIN = "ethereum";

/** Read wallet chain preference from localStorage */
export function getWalletChainId(): string {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(WALLET_CHAIN_KEY);
      if (stored && SUPPORTED_CHAINS[stored]) {
        return stored;
      }
    }
  } catch {
    // localStorage not available (SSR)
  }
  return DEFAULT_WALLET_CHAIN;
}

/** Get the chain config for the currently selected wallet chain */
export function getWalletChainConfig(): WalletChainConfig {
  const id = getWalletChainId();
  return SUPPORTED_CHAINS[id] ?? SUPPORTED_CHAINS[DEFAULT_WALLET_CHAIN];
}

/** Get the numeric chainId for the current wallet chain */
export function getWalletChain(): number {
  return getWalletChainConfig().chainId;
}

/** Get the human-readable name of the current wallet chain */
export function getWalletChainName(): string {
  return getWalletChainConfig().name;
}

/** Is the current wallet chain a testnet? */
export function isWalletTestnet(): boolean {
  return getWalletChainConfig().testnet ?? false;
}

/** Persist wallet chain preference to localStorage */
export function setWalletChain(chainId: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (SUPPORTED_CHAINS[chainId]) {
        window.localStorage.setItem(WALLET_CHAIN_KEY, chainId);
      }
    }
  } catch {
    // localStorage not available
  }
}

/** Get all supported chain IDs */
export function listWalletChainIds(): string[] {
  return Object.keys(SUPPORTED_CHAINS);
}
