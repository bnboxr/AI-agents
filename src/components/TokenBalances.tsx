import { useAccount, useBalance, useReadContract } from "~/lib/demo-wagmi";
import { formatUnits, erc20Abi } from "viem";
import {
  mainnet, bsc, polygon, arbitrum, optimism, base,
  avalanche, fantom, gnosis, zksync, linea, scroll, mantle, celo, moonbeam,
} from "wagmi/chains";

// ── Token config per chain ─────────────────────────────────────────
interface TokenInfo { symbol: string; address: `0x${string}`; icon: string; decimals: number; }

const CHAIN_TOKENS: Record<number, { name: string; icon: string; tokens: TokenInfo[] }> = {
  [mainnet.id]: { name: "Ethereum", icon: "🔷", tokens: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", icon: "💵", decimals: 6 },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", icon: "💵", decimals: 6 },
    { symbol: "DAI",  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", icon: "🪙", decimals: 18 },
    { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", icon: "₿", decimals: 8 },
  ]},
  [bsc.id]: { name: "BNB Chain", icon: "🟡", tokens: [
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", icon: "💵", decimals: 18 },
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", icon: "💵", decimals: 18 },
  ]},
  [polygon.id]: { name: "Polygon", icon: "🟣", tokens: [
    { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", icon: "💵", decimals: 6 },
    { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", icon: "💵", decimals: 6 },
  ]},
  [arbitrum.id]: { name: "Arbitrum", icon: "🔵", tokens: [
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", icon: "💵", decimals: 6 },
    { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", icon: "💵", decimals: 6 },
  ]},
  [optimism.id]: { name: "Optimism", icon: "🔴", tokens: [
    { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", icon: "💵", decimals: 6 },
  ]},
  [base.id]: { name: "Base", icon: "🔘", tokens: [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", icon: "💵", decimals: 6 },
  ]},
  [avalanche.id]: { name: "Avalanche", icon: "❄️", tokens: [
    { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", icon: "💵", decimals: 6 },
  ]},
  [fantom.id]: { name: "Fantom", icon: "👻", tokens: [
    { symbol: "USDC", address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", icon: "💵", decimals: 6 },
  ]},
  [gnosis.id]: { name: "Gnosis", icon: "🦉", tokens: [
    { symbol: "USDC", address: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", icon: "💵", decimals: 6 },
  ]},
  [zksync.id]: { name: "zkSync", icon: "⚡", tokens: [
    { symbol: "USDC", address: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", icon: "💵", decimals: 6 },
  ]},
  [linea.id]: { name: "Linea", icon: "📏", tokens: [
    { symbol: "USDC", address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", icon: "💵", decimals: 6 },
  ]},
  [scroll.id]: { name: "Scroll", icon: "📜", tokens: [
    { symbol: "USDC", address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", icon: "💵", decimals: 6 },
  ]},
  [mantle.id]: { name: "Mantle", icon: "🛡️", tokens: [
    { symbol: "USDC", address: "0x09Bc4E0D864854c6aFb6eB9A9cdF58aC190D0dF9", icon: "💵", decimals: 6 },
  ]},
  [celo.id]: { name: "Celo", icon: "🌿", tokens: [
    { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", icon: "💵", decimals: 6 },
  ]},
  [moonbeam.id]: { name: "Moonbeam", icon: "🌙", tokens: [
    { symbol: "USDC", address: "0x931715FEE2d06333043d11F658C8CE934aC61D0c", icon: "💵", decimals: 6 },
  ]},
};

export function TokenBalances() {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address) return null;

  return (
    <div className="glass-card p-4 mb-4 max-w-md mx-auto max-h-[60vh] overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
        <span>🌐</span> Multi-Chain Wallet
      </h3>
      {Object.entries(CHAIN_TOKENS).map(([chainId, chain]) => (
        <ChainBalances key={chainId} chainId={Number(chainId)} chain={chain} userAddress={address} />
      ))}
      <p className="text-xs text-gray-500 mt-3 text-center">
        Showing USDC/USDT/DAI across 15 chains. Native tokens + major ERC20s.
      </p>
    </div>
  );
}

function ChainBalances({ chainId, chain, userAddress }: { chainId: number; chain: typeof CHAIN_TOKENS[number]; userAddress: `0x${string}` }) {
  const { data: nativeBal } = useBalance({ address: userAddress, chainId });

  // Only render if there's a native balance or we find tokens
  const hasNative = nativeBal && nativeBal.value > 0n;

  return (
    <div className="mb-3 pb-3 border-b border-dark-border/30 last:border-0 last:mb-0 last:pb-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{chain.icon}</span>
        <span className="text-xs font-semibold text-gray-300">{chain.name}</span>
        {hasNative && (
          <span className="text-xs font-mono text-accent-green ml-auto">
            {parseFloat(formatUnits(nativeBal!.value, nativeBal!.decimals)).toFixed(4)} {nativeBal!.symbol}
          </span>
        )}
      </div>
      {chain.tokens.map(token => (
        <TokenRow key={token.address} token={token} userAddress={userAddress} chainId={chainId} />
      ))}
    </div>
  );
}

function TokenRow({ token, userAddress, chainId }: { token: TokenInfo; userAddress: `0x${string}`; chainId: number }) {
  const { data, isLoading } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [userAddress],
    chainId,
    query: { enabled: !!userAddress, staleTime: 30_000 },
  });

  const balance = data !== undefined ? formatUnits(data as bigint, token.decimals) : null;
  const hasBalance = balance && parseFloat(balance) > 0;

  return (
    <div className="flex items-center justify-between py-1.5 pl-4">
      <span className="flex items-center gap-1.5 text-xs text-gray-400">
        <span>{token.icon}</span> {token.symbol}
      </span>
      <span className={`text-xs font-mono ${hasBalance ? "text-white" : "text-gray-600"}`}>
        {isLoading ? "..." : balance ? parseFloat(balance).toFixed(2) : "0.00"}
      </span>
    </div>
  );
}
