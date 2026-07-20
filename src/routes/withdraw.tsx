import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAccount, useChainId, useBalance, useWriteContract, useSendTransaction } from "~/lib/demo-wagmi";
import { parseUnits, isAddress, type Address } from "viem";
import { getChainTokens, type TokenInfo } from "~/lib/web3";

// ERC-20 transfer ABI
const ERC20_ABI = [
  {
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Chain names for display
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  56: "BNB Chain",
  137: "Polygon",
  42161: "Arbitrum",
  10: "Optimism",
  8453: "Base",
  43114: "Avalanche",
  250: "Fantom",
  100: "Gnosis",
  324: "zkSync Era",
  59144: "Linea",
  534352: "Scroll",
  5000: "Mantle",
  42220: "Celo",
  1284: "Moonbeam",
};

export const Route = createFileRoute("/withdraw")({
  component: WithdrawPage,
  validateSearch: (search: Record<string, string>) => ({
    token: search.token || "",
  }),
});

function WithdrawPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);
  const [destAddress, setDestAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [showTokenSelector, setShowTokenSelector] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const tokens = getChainTokens(chainId);
  const isNative = selectedToken?.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

  // Balance
  const { data: balance } = useBalance({
    address,
    token: selectedToken && !isNative ? selectedToken.address : undefined,
    query: { enabled: isConnected && !!selectedToken },
  });

  // Write
  const { writeContract: sendERC20, isPending: erc20Pending } = useWriteContract();
  const { sendTransaction: sendNative, isPending: nativePending } = useSendTransaction();

  const isPending = erc20Pending || nativePending;

  // Validate destination
  const validDest = destAddress.length === 0 || isAddress(destAddress);

  const handleSend = () => {
    if (!selectedToken || !destAddress || !amount || !isConnected) return;

    if (isNative) {
      // Native token transfer via wagmi sendTransaction
      const parsed = parseUnits(amount, selectedToken.decimals);
      sendNative({
        to: destAddress as Address,
        value: parsed,
      });
      return;
    }

    const parsed = parseUnits(amount, selectedToken.decimals);
    sendERC20({
      address: selectedToken.address,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [destAddress as Address, parsed],
    });
  };

  const maxAmount = balance ? balance.formatted : "0";

  if (!mounted) {
    return (
      <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-lg mt-16 glass-card p-8 text-center">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg space-y-6 mt-8">
        {/* Header */}
        <section className="animate-fade-in text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center justify-center gap-2">
            <span>📤</span> Send
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Transfer tokens to any address
          </p>
        </section>

        {!isConnected ? (
          <div className="glass-card p-8 text-center animate-fade-in-up">
            <p className="text-gray-400 text-lg mb-4">Connect your wallet to send tokens</p>
            <p className="text-xs text-gray-500">Use the Connect Wallet button in the navbar</p>
          </div>
        ) : (
          <div className="glass-card p-5 space-y-4 animate-fade-in-up">
            {/* Chain Info */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Network</span>
              <span className="text-white font-medium">{CHAIN_NAMES[chainId] || `Chain ${chainId}`}</span>
            </div>

            {/* Token Selector */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Token</label>
              <button
                onClick={() => setShowTokenSelector(!showTokenSelector)}
                className="w-full px-4 py-3 rounded-xl border border-dark-border bg-dark-hover hover:border-accent-blue/40 transition-colors text-sm font-medium text-white flex items-center justify-between"
              >
                <span>{selectedToken ? `${selectedToken.symbol} — ${selectedToken.name}` : "Select token..."}</span>
                <span className="text-xs text-gray-400">▼</span>
              </button>
              {showTokenSelector && (
                <div className="border border-dark-border rounded-xl bg-dark-surface overflow-hidden mt-1">
                  <div className="max-h-48 overflow-y-auto">
                    {tokens.map((t) => (
                      <button
                        key={t.symbol + t.address}
                        onClick={() => { setSelectedToken(t); setShowTokenSelector(false); setAmount(""); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-dark-hover transition-colors text-left"
                      >
                        <span className="text-sm font-medium text-white text-mono-sm">{t.symbol}</span>
                        <span className="text-xs text-gray-400">{t.name}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowTokenSelector(false)}
                    className="w-full px-4 py-2 text-xs text-gray-400 hover:text-white border-t border-dark-border bg-dark-hover/50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Destination Address */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Destination Address</label>
              <input
                type="text"
                placeholder="0x..."
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                className={`w-full bg-dark-hover border rounded-xl px-4 py-3 text-white text-sm text-mono outline-none transition-colors ${
                  destAddress && !validDest ? "border-accent-red" : "border-dark-border focus:border-accent-blue/50"
                }`}
              />
              {destAddress && !validDest && (
                <p className="text-accent-red text-xs mt-1">Invalid Ethereum address format</p>
              )}
            </div>

            {/* Amount */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider">Amount</label>
                {balance && (
                  <span className="text-xs text-gray-500">
                    Balance: {parseFloat(balance.formatted).toFixed(4)} {selectedToken?.symbol || balance.symbol}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 bg-dark-hover border border-dark-border rounded-xl px-4 py-3 text-white text-lg text-mono outline-none focus:border-accent-blue/50 transition-colors"
                />
                <button
                  onClick={() => setAmount(maxAmount)}
                  className="px-3 py-3 rounded-xl border border-dark-border bg-dark-hover hover:border-accent-blue/40 transition-colors text-xs font-medium text-accent-blue"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Estimated Gas */}
            <div className="bg-dark-hover/50 rounded-xl p-3 text-xs border border-dark-border">
              <div className="flex justify-between">
                <span className="text-gray-400">Network Fee</span>
                <span className="text-gray-200 text-mono-sm">Estimated on confirmation</span>
              </div>
            </div>

            {/* Send Button */}
            <button
              onClick={handleSend}
              disabled={
                !selectedToken || !destAddress || !validDest || !amount || parseFloat(amount) <= 0 || isPending
              }
              className="w-full py-3 rounded-xl bg-accent-blue text-white font-semibold hover:bg-accent-blue/80 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-accent-blue/20"
            >
              {isPending ? "Confirming..." : isNative ? "Send (use wallet)" : `Send ${selectedToken?.symbol || ""}`}
            </button>
          </div>
        )}

        {/* Info */}
        <section className="glass-card p-4 animate-fade-in-up">
          <h3 className="text-sm font-semibold text-white mb-1">Cross-Chain Bridge</h3>
          <p className="text-xs text-gray-400">
            To send tokens to a different blockchain, use the Socket/Bungee bridge protocol.
            Bridge integration coming soon — for now, send tokens within the same chain.
          </p>
        </section>
      </div>
    </div>
  );
}
