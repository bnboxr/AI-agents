import { useAccount, useReadContract, useBalance } from "wagmi";
import { formatUnits, erc20Abi } from "viem";
import { mainnet } from "wagmi/chains";

// Common tokens to check on Ethereum mainnet
const COMMON_TOKENS: { symbol: string; address: `0x${string}`; icon: string }[] = [
  { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", icon: "💵" },
  { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", icon: "💵" },
  { symbol: "DAI",  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", icon: "🪙" },
  { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", icon: "₿" },
  { symbol: "LINK", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", icon: "🔗" },
  { symbol: "UNI",  address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", icon: "🦄" },
];

export function TokenBalances() {
  const { address, isConnected } = useAccount();
  const { data: ethBalance } = useBalance({ address });

  if (!isConnected || !address) return null;

  return (
    <div className="glass-card p-4 mb-4 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <span>🔷</span> Your Wallet
        </h3>
        <span className="text-xs text-gray-500 bg-dark-hover px-2 py-0.5 rounded-full">
          Ethereum
        </span>
      </div>

      {/* Native ETH */}
      <div className="flex items-center justify-between py-2 border-b border-dark-border/50">
        <span className="flex items-center gap-2 text-sm text-gray-300">
          <span>💎</span> ETH
        </span>
        <span className="text-sm font-mono text-white">
          {ethBalance
            ? parseFloat(formatUnits(ethBalance.value, ethBalance.decimals)).toFixed(4)
            : "0.0000"}
        </span>
      </div>

      {/* ERC20 Tokens */}
      {COMMON_TOKENS.map((token) => (
        <TokenBalanceRow key={token.address} token={token} userAddress={address} />
      ))}

      <p className="text-xs text-gray-500 mt-3 text-center">
        Showing Ethereum mainnet tokens. Switch chain in your wallet for other networks.
      </p>
    </div>
  );
}

function TokenBalanceRow({
  token,
  userAddress,
}: {
  token: { symbol: string; address: `0x${string}`; icon: string };
  userAddress: `0x${string}`;
}) {
  const { data, isLoading } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [userAddress],
    chainId: mainnet.id,
    query: { enabled: !!userAddress, staleTime: 30_000 },
  });

  const balance = data !== undefined ? formatUnits(data as bigint, 6) : null;

  return (
    <div className="flex items-center justify-between py-2 border-b border-dark-border/30">
      <span className="flex items-center gap-2 text-sm text-gray-300">
        <span>{token.icon}</span> {token.symbol}
      </span>
      <span className="text-sm font-mono text-gray-400">
        {isLoading ? "..." : balance ? parseFloat(balance).toFixed(2) : "0.00"}
      </span>
    </div>
  );
}
