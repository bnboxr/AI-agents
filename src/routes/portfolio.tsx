import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useChainId, useBalance, useReadContracts } from "~/lib/demo-wagmi";
import { formatUnits, type Address } from "viem";
import { getChainTokens, type TokenInfo } from "~/lib/web3";

// ── ERC-20 Balance ABI ────────────────────────────────────────────
const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
});

interface TokenBalance {
  symbol: string;
  name: string;
  address: `0x${string}`;
  balance: string;
  balanceRaw: bigint;
  decimals: number;
  priceUSD: number | null;
  valueUSD: number | null;
  isNative: boolean;
}

// Simple price feed from CoinGecko free API
async function fetchPrices(symbols: string[]): Promise<Record<string, { usd: number; change24h: number } | null>> {
  const ids = symbols
    .map((s) => {
      const map: Record<string, string> = {
        ETH: "ethereum",
        WETH: "ethereum",
        BTC: "bitcoin",
        WBTC: "wrapped-bitcoin",
        USDC: "usd-coin",
        USDT: "tether",
        DAI: "dai",
        MATIC: "matic-network",
        BNB: "binancecoin",
        WBNB: "binancecoin",
        AVAX: "avalanche-2",
        WAVAX: "avalanche-2",
        FTM: "fantom",
        WFTM: "fantom",
        LINK: "chainlink",
        UNI: "uniswap",
        AAVE: "aave",
      };
      return map[s] || s.toLowerCase();
    })
    .filter(Boolean);

  if (ids.length === 0) return {};

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const result: Record<string, { usd: number; change24h: number } | null> = {};
    for (const sym of symbols) {
      const map: Record<string, string> = {
        ETH: "ethereum", WETH: "ethereum",
        WBTC: "wrapped-bitcoin",
        USDC: "usd-coin", USDT: "tether", DAI: "dai",
        MATIC: "matic-network",
        BNB: "binancecoin", WBNB: "binancecoin",
        AVAX: "avalanche-2", WAVAX: "avalanche-2",
        FTM: "fantom", WFTM: "fantom",
      };
      const id = map[sym] || sym.toLowerCase();
      result[sym] = data[id] || null;
    }
    return result;
  } catch {
    return {};
  }
}

function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [prices, setPrices] = useState<Record<string, { usd: number; change24h: number } | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { setMounted(true); }, []);

  const tokens = getChainTokens(chainId);
  const erc20Tokens = tokens.filter((t) => t.address !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

  // Native balance
  const { data: nativeBalance } = useBalance({ address, query: { enabled: isConnected } });

  // ERC-20 balances
  const { data: erc20Balances } = useReadContracts({
    contracts: erc20Tokens.map((t) => ({
      address: t.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [address as Address],
    })),
    query: { enabled: isConnected && erc20Tokens.length > 0 },
  });

  // Fetch prices
  useEffect(() => {
    if (!isConnected) return;
    const allSymbols = tokens.map((t) => t.symbol);
    fetchPrices(allSymbols).then((p) => {
      setPrices(p);
      setLoading(false);
    });
  }, [isConnected, chainId]);

  const balances: TokenBalance[] = useMemo(() => {
    const result: TokenBalance[] = [];

    // Native token
    if (nativeBalance) {
      const nativeToken = tokens.find((t) => t.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
      const symbol = nativeToken?.symbol || nativeBalance.symbol;
      const priceData = prices[symbol];
      const balanceNum = parseFloat(nativeBalance.formatted);
      result.push({
        symbol,
        name: nativeToken?.name || symbol,
        address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`,
        balance: balanceNum.toFixed(6),
        balanceRaw: nativeBalance.value,
        decimals: nativeBalance.decimals,
        priceUSD: priceData?.usd || null,
        valueUSD: priceData ? balanceNum * priceData.usd : null,
        isNative: true,
      });
    }

    // ERC-20 tokens
    erc20Tokens.forEach((token, i) => {
      const bal = erc20Balances?.[i];
      if (bal?.status === "success" && bal.result && bal.result > 0n) {
        const balanceNum = parseFloat(formatUnits(bal.result, token.decimals));
        if (balanceNum > 0) {
          const priceData = prices[token.symbol];
          result.push({
            symbol: token.symbol,
            name: token.name,
            address: token.address,
            balance: balanceNum.toFixed(6),
            balanceRaw: bal.result,
            decimals: token.decimals,
            priceUSD: priceData?.usd || null,
            valueUSD: priceData ? balanceNum * priceData.usd : null,
            isNative: false,
          });
        }
      }
    });

    return result;
  }, [nativeBalance, erc20Balances, tokens, prices]);

  const totalValue = balances.reduce((sum, b) => sum + (b.valueUSD || 0), 0);

  const fmtPrice = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!mounted) {
    return (
      <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl mt-16 glass-card p-8 text-center">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6 mt-8">
        {/* Header */}
        <section className="animate-fade-in text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center justify-center gap-2">
            <span>💼</span> Portfolio
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Your assets across the connected blockchain
          </p>
        </section>

        {!isConnected ? (
          <div className="glass-card p-8 text-center animate-fade-in-up">
            <p className="text-gray-400 text-lg mb-4">Connect your wallet to view portfolio</p>
            <p className="text-xs text-gray-500">Use the Connect Wallet button in the navbar</p>
          </div>
        ) : loading ? (
          <div className="glass-card p-8 text-center animate-fade-in-up">
            <p className="text-gray-400">Fetching balances and prices...</p>
          </div>
        ) : (
          <>
            {/* Total Value */}
            <div className="glass-card p-6 text-center animate-fade-in-up">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Portfolio Value</p>
              <p className="text-3xl font-bold text-white text-mono">
                {fmtPrice(totalValue)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {balances.length} token(s) on chain {chainId}
              </p>
            </div>

            {/* Token List */}
            <div className="glass-card overflow-hidden animate-fade-in-up">
              {balances.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400 text-lg">No tokens found</p>
                  <p className="text-xs text-gray-500 mt-1">Your wallet may be empty on this chain</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-5 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
                    <span>Token</span>
                    <span className="text-right">Balance</span>
                    <span className="text-right">Price</span>
                    <span className="text-right">Value</span>
                    <span className="text-right">Action</span>
                  </div>
                  {balances.map((b, i) => (
                    <div
                      key={b.symbol + i}
                      className="grid grid-cols-5 gap-2 px-4 py-3 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors items-center"
                    >
                      <div>
                        <span className="text-sm text-white font-medium text-mono-sm">{b.symbol}</span>
                        <span className="text-[0.625rem] text-gray-500 block">{b.isNative ? "Native" : "ERC-20"}</span>
                      </div>
                      <span className="text-sm text-gray-200 text-right text-mono-sm">
                        {parseFloat(b.balance).toFixed(4)}
                      </span>
                      <span className="text-sm text-gray-200 text-right text-mono-sm">
                        {b.priceUSD !== null ? fmtPrice(b.priceUSD) : "—"}
                      </span>
                      <span className="text-sm text-white text-right text-mono-sm font-semibold">
                        {b.valueUSD !== null ? fmtPrice(b.valueUSD) : "—"}
                      </span>
                      <span className="text-right">
                        {!b.isNative && (
                          <Link
                            to="/withdraw"
                            search={{ token: b.symbol }}
                            className="text-xs text-accent-blue hover:text-accent-cyan transition-colors"
                          >
                            Send →
                          </Link>
                        )}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
