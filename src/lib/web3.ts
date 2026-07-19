import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import {
  mainnet,
  bsc,
  polygon,
  arbitrum,
  optimism,
  base,
  avalanche,
  fantom,
  gnosis,
  zksync,
  linea,
  scroll,
  mantle,
  celo,
  moonbeam,
} from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "@wagmi/connectors";

// WalletConnect project ID - public fallback
const WALLETCONNECT_PROJECT_ID = "9b74a7f9b9b99e5b2f2e0b0e4c2c7b8a";

export const config = createConfig({
  chains: [
    mainnet,
    bsc,
    polygon,
    arbitrum,
    optimism,
    base,
    avalanche,
    fantom,
    gnosis,
    zksync,
    linea,
    scroll,
    mantle,
    celo,
    moonbeam,
  ],
  connectors: [
    injected({ target: "metaMask" }),
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: false,
    }),
    coinbaseWallet({
      appName: "Păun AI",
    }),
    injected({ target: "rabby" }),
  ],
  transports: {
    [mainnet.id]: http("https://eth.drpc.org"),
    [bsc.id]: http("https://bsc-dataseed1.binance.org"),
    [polygon.id]: http("https://polygon-rpc.com"),
    [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    [optimism.id]: http("https://mainnet.optimism.io"),
    [base.id]: http("https://mainnet.base.org"),
    [avalanche.id]: http("https://api.avax.network/ext/bc/C/rpc"),
    [fantom.id]: http("https://fantom.drpc.org"),
    [gnosis.id]: http("https://rpc.gnosischain.com"),
    [zksync.id]: http("https://mainnet.era.zksync.io"),
    [linea.id]: http("https://rpc.linea.build"),
    [scroll.id]: http("https://rpc.scroll.io"),
    [mantle.id]: http("https://rpc.mantle.xyz"),
    [celo.id]: http("https://forno.celo.org"),
    [moonbeam.id]: http("https://rpc.api.moonbeam.network"),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

// ── Token Lists ────────────────────────────────────────────────────

export interface TokenInfo {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  logoURI?: string;
  chainId: number;
}

// Common tokens across chains (mainnet by default unless specified)
export const COMMON_TOKENS: Record<string, TokenInfo> = {
  ETH: {
    symbol: "ETH",
    name: "Ether",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`,
    decimals: 18,
    chainId: 1,
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    decimals: 18,
    chainId: 1,
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    chainId: 1,
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
    chainId: 1,
  },
  DAI: {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    decimals: 18,
    chainId: 1,
  },
  WBTC: {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    decimals: 8,
    chainId: 1,
  },
  MATIC: {
    symbol: "MATIC",
    name: "Polygon",
    address: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0",
    decimals: 18,
    chainId: 1,
  },
};

// Get token list for a specific chain
export function getChainTokens(chainId: number): TokenInfo[] {
  const tokens: TokenInfo[] = [];
  // Native token
  const nativeMap: Record<number, TokenInfo> = {
    1: { ...COMMON_TOKENS.ETH, chainId: 1 },
    56: { symbol: "BNB", name: "BNB", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`, decimals: 18, chainId: 56 },
    137: { symbol: "MATIC", name: "Polygon", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`, decimals: 18, chainId: 137 },
    42161: { symbol: "ETH", name: "Ether", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`, decimals: 18, chainId: 42161 },
    10: { symbol: "ETH", name: "Ether", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`, decimals: 18, chainId: 10 },
    8453: { symbol: "ETH", name: "Ether", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`, decimals: 18, chainId: 8453 },
    43114: { symbol: "AVAX", name: "Avalanche", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`, decimals: 18, chainId: 43114 },
    250: { symbol: "FTM", name: "Fantom", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`, decimals: 18, chainId: 250 },
  };

  if (nativeMap[chainId]) {
    tokens.push(nativeMap[chainId]);
  }

  // Add common ERC-20s based on chain
  if (chainId === 1) {
    tokens.push({ ...COMMON_TOKENS.WETH, chainId: 1 });
    tokens.push({ ...COMMON_TOKENS.USDC, chainId: 1 });
    tokens.push({ ...COMMON_TOKENS.USDT, chainId: 1 });
    tokens.push({ ...COMMON_TOKENS.DAI, chainId: 1 });
    tokens.push({ ...COMMON_TOKENS.WBTC, chainId: 1 });
  } else if (chainId === 137) {
    tokens.push({ symbol: "WETH", name: "Wrapped Ether", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, chainId: 137 });
    tokens.push({ symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, chainId: 137 });
    tokens.push({ symbol: "USDT", name: "Tether USD", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, chainId: 137 });
    tokens.push({ symbol: "DAI", name: "Dai Stablecoin", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, chainId: 137 });
    tokens.push({ symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6", decimals: 8, chainId: 137 });
  } else if (chainId === 42161) {
    tokens.push({ symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, chainId: 42161 });
    tokens.push({ symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, chainId: 42161 });
    tokens.push({ symbol: "USDT", name: "Tether USD", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, chainId: 42161 });
    tokens.push({ symbol: "DAI", name: "Dai Stablecoin", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, chainId: 42161 });
  } else if (chainId === 56) {
    tokens.push({ symbol: "WBNB", name: "Wrapped BNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, chainId: 56 });
    tokens.push({ symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, chainId: 56 });
    tokens.push({ symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, chainId: 56 });
  } else if (chainId === 10) {
    tokens.push({ symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, chainId: 10 });
    tokens.push({ symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, chainId: 10 });
    tokens.push({ symbol: "USDT", name: "Tether USD", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, chainId: 10 });
  } else if (chainId === 8453) {
    tokens.push({ symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, chainId: 8453 });
    tokens.push({ symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, chainId: 8453 });
  } else if (chainId === 43114) {
    tokens.push({ symbol: "WAVAX", name: "Wrapped AVAX", address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18, chainId: 43114 });
    tokens.push({ symbol: "USDC", name: "USD Coin", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, chainId: 43114 });
  } else if (chainId === 250) {
    tokens.push({ symbol: "WFTM", name: "Wrapped FTM", address: "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83", decimals: 18, chainId: 250 });
    tokens.push({ symbol: "USDC", name: "USD Coin", address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", decimals: 6, chainId: 250 });
  }

  return tokens;
}
