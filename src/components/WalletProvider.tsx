import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useConnect, useDisconnect, useBalance, useChainId } from "wagmi";
import { useState, useEffect, type ReactNode } from "react";
import { config } from "~/lib/web3";

const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// ── Connect Button & Modal ────────────────────────────────────────

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { data: ethBalance } = useBalance({ address });
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <button className="px-4 py-2 rounded-lg bg-dark-hover border border-dark-border text-gray-400 text-sm font-medium">
        Connect Wallet
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-hover border border-dark-border/50">
          <span className="w-2 h-2 rounded-full bg-accent-green"></span>
          <span className="text-xs text-gray-300 text-mono-sm">
            {ethBalance ? `${parseFloat(ethBalance.formatted).toFixed(4)} ${ethBalance.symbol}` : "..."}
          </span>
        </div>
        <button
          onClick={() => disconnect()}
          className="px-3 py-1.5 rounded-lg bg-dark-hover border border-dark-border hover:border-accent-blue/40 text-sm font-medium text-gray-300 hover:text-white transition-all duration-200 text-mono-sm"
          title={address}
        >
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/80 transition-all duration-200 shadow-lg shadow-accent-blue/20"
      >
        Connect Wallet
      </button>
      {showModal && <WalletModal onClose={() => setShowModal(false)} />}
    </>
  );
}

function WalletModal({ onClose }: { onClose: () => void }) {
  const { connect, connectors } = useConnect();
  const [connecting, setConnecting] = useState<string | null>(null);

  const walletOptions = [
    { id: "metaMask", name: "MetaMask", icon: "🦊", connector: () => connectors.find(c => c.id === "injected" && c.name === "MetaMask") || connectors.find(c => c.id === "injected") },
    { id: "walletConnect", name: "WalletConnect", icon: "🔗", connector: () => connectors.find(c => c.id === "walletConnect") },
    { id: "coinbase", name: "Coinbase Wallet", icon: "🔵", connector: () => connectors.find(c => c.id === "coinbaseWallet") },
    { id: "rabby", name: "Rabby", icon: "🦎", connector: () => connectors.find(c => c.id === "injected" && (c as any).name === "Rabby") },
    { id: "browser", name: "Browser Wallet", icon: "🌐", connector: () => connectors.find(c => c.id === "injected" && c.name !== "MetaMask") },
  ];

  const handleConnect = async (option: typeof walletOptions[0]) => {
    setConnecting(option.id);
    try {
      const connector = option.connector();
      if (connector) {
        await connect({ connector });
        onClose();
      }
    } catch (err: any) {
      console.error("Connection failed:", err);
    }
    setConnecting(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
      {/* Modal */}
      <div
        className="relative w-full max-w-sm rounded-2xl border border-dark-border bg-dark-surface/95 backdrop-blur-xl shadow-2xl shadow-accent-blue/5 p-6 animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(135deg, rgba(13, 17, 35, 0.95) 0%, rgba(10, 22, 40, 0.95) 100%)",
          borderColor: "rgba(59, 130, 246, 0.15)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>🦚</span> Connect Wallet
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-dark-hover transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4">
          Connect your wallet to access DeFi features: swap, earn yield, and manage your portfolio.
        </p>

        {/* Wallet Options */}
        <div className="space-y-2">
          {walletOptions.map((opt) => {
            const conn = opt.connector();
            if (!conn) return null;
            return (
              <button
                key={opt.id}
                onClick={() => handleConnect(opt)}
                disabled={connecting !== null}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-dark-border hover:border-accent-blue/40 bg-dark-hover/50 hover:bg-dark-hover transition-all duration-200 group disabled:opacity-50"
              >
                <span className="text-2xl">{opt.icon}</span>
                <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">
                  {opt.name}
                </span>
                {connecting === opt.id && (
                  <span className="ml-auto text-accent-blue text-xs animate-pulse">Connecting...</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <p className="text-[0.625rem] text-gray-500 mt-4 text-center">
          By connecting, you agree to interact with blockchain networks at your own risk.
        </p>
      </div>
    </div>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────

export function useIsWalletConnected() {
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return false;
  return isConnected;
}

export function useWalletAddress() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return isConnected ? address : null;
}
