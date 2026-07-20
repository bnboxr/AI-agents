import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useConnect, useDisconnect, useBalance, useChainId, useSwitchChain, useChains } from "~/lib/demo-wagmi";
import { formatUnits } from "viem";
import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { config, type WalletMeta, WALLET_LIST } from "~/lib/web3";
import { TokenBalances } from "~/components/TokenBalances";

// ── Browser global augmentations ────────────────────────────────────

/** EIP-6963 provider info announced by browser wallets. */
interface EIP6963ProviderInfo {
  rdns: string;
  name: string;
  icon: string;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: unknown;
}

declare global {
  interface Window {
    eip6963Providers?: EIP6963ProviderDetail[];
    ethereum?: unknown;
  }
}

/** Wagmi connector may include EIP-6963 rdns array at runtime. */
interface ConnectorWithRdns {
  rdns?: string[];
}

// ── Provider ─────────────────────────────────────────────────────
export function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 0, refetchOnWindowFocus: false },
    },
  }));
  return (
    <WagmiProvider config={config} reconnectOnMount={true}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

// ── Connect Button (navbar) ──────────────────────────────────────
export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
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
          <span className="w-2 h-2 rounded-full bg-accent-green" />
          <span className="text-xs text-gray-300 text-mono-sm">
            {ethBalance
              ? `${parseFloat(formatUnits(ethBalance.value, ethBalance.decimals)).toFixed(4)} ${ethBalance.symbol}`
              : "..."}
          </span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-1.5 rounded-lg bg-dark-hover border border-dark-border hover:border-accent-blue/40 text-sm font-medium text-gray-300 hover:text-white transition-all duration-200 text-mono-sm"
          title={address}
        >
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
        <button
          onClick={() => disconnect()}
          className="px-2 py-1.5 rounded-lg text-gray-500 hover:text-red-400 text-xs transition-colors"
          title="Disconnect"
        >
          ✕
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

// ── EIP-6963 helper ─────────────────────────────────────────────

const CHAIN_STORAGE_KEY = "hsmc:preferred-chain";

const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  56: "BSC",
  137: "Polygon",
  42161: "Arbitrum",
  10: "Optimism",
  8453: "Base",
  43114: "Avalanche",
  250: "Fantom",
  100: "Gnosis",
  324: "zkSync",
  59144: "Linea",
  534352: "Scroll",
  5000: "Mantle",
  42220: "Celo",
  1284: "Moonbeam",
};

const CHAIN_ICONS: Record<number, string> = {
  1: "🔷",
  56: "🟡",
  137: "🟣",
  42161: "🔵",
  10: "🔴",
  8453: "🔘",
  43114: "❄️",
  250: "👻",
  100: "🦉",
  324: "💎",
  59144: "📐",
  534352: "📜",
  5000: "🔥",
  42220: "🌿",
  1284: "🌙",
};

function getSavedChainId(): number {
  if (typeof window === "undefined") return 1;
  try {
    const saved = localStorage.getItem(CHAIN_STORAGE_KEY);
    if (saved) {
      const id = parseInt(saved, 10);
      if (CHAIN_LABELS[id]) return id;
    }
  } catch { /* localStorage not available */ }
  return 1;
}

function saveChainId(chainId: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAIN_STORAGE_KEY, String(chainId));
  } catch { /* ignore */ }
}

// ── Chain Selector (navbar dropdown) ─────────────────────────────
export function ChainSelector() {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const chains = useChains();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Auto-switch to saved chain on mount
  useEffect(() => {
    if (!mounted) return;
    const saved = getSavedChainId();
    if (saved !== chainId && CHAIN_LABELS[saved]) {
      const targetChain = chains.find((c) => c.id === saved);
      if (targetChain) {
        switchChain({ chainId: saved });
      }
    }
  }, [mounted]);

  if (!mounted) {
    return (
      <button className="px-3 py-2 rounded-lg bg-dark-hover border border-dark-border text-gray-400 text-xs font-medium flex items-center gap-1.5">
        <span>{CHAIN_ICONS[1]}</span>
        <span className="hidden sm:inline">Ethereum</span>
      </button>
    );
  }

  const currentLabel = CHAIN_LABELS[chainId] ?? `Chain ${chainId}`;
  const currentIcon = CHAIN_ICONS[chainId] ?? "⛓️";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-2 rounded-lg bg-dark-hover border border-dark-border hover:border-accent-blue/40 text-gray-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all duration-200"
        title={`Current: ${currentLabel}`}
      >
        <span>{currentIcon}</span>
        <span className="hidden sm:inline">{currentLabel}</span>
        <span className="text-gray-500 text-[0.6rem] ml-0.5">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-2 z-50 w-56 max-h-80 overflow-y-auto rounded-xl border border-dark-border shadow-2xl animate-fade-in-up"
            style={{
              background: "linear-gradient(135deg, rgba(13,17,35,0.98) 0%, rgba(10,22,40,0.98) 100%)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.08)",
            }}
          >
            <div className="p-1.5">
              {chains
                .filter((c) => CHAIN_LABELS[c.id])
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      saveChainId(c.id);
                      switchChain({ chainId: c.id });
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                      c.id === chainId
                        ? "bg-accent-blue/10 border border-accent-blue/20 text-white"
                        : "text-gray-400 hover:text-white hover:bg-dark-hover border border-transparent"
                    }`}
                  >
                    <span className="text-lg">{CHAIN_ICONS[c.id] ?? "⛓️"}</span>
                    <span className="flex-1 text-left font-medium">
                      {CHAIN_LABELS[c.id]}
                    </span>
                    {c.id === chainId && (
                      <span className="text-accent-blue text-xs">●</span>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
function useDetectedWallets() {
  const [eip6963Providers, setEip6963Providers] = useState<{ rdns: string; name: string; icon?: string }[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Collect already-announced EIP-6963 providers
    const providers = window.eip6963Providers || [];
    const mapped = providers.map((p: EIP6963ProviderDetail) => ({
      rdns: (p.info?.rdns || "").toLowerCase(),
      name: p.info?.name || "",
      icon: p.info?.icon || "",
    }));
    if (mapped.length > 0) setEip6963Providers(mapped);

    // Listen for new announcements
    const handler = (e: CustomEvent) => {
      const info = e.detail?.info;
      if (info?.rdns) {
        setEip6963Providers(prev => {
          const rdns = info.rdns.toLowerCase();
          if (prev.some(p => p.rdns === rdns)) return prev;
          return [...prev, { rdns, name: info.name || "", icon: info.icon || "" }];
        });
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("eip6963:announceProvider", handler as EventListener);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("eip6963:announceProvider", handler as EventListener);
      }
    };
  }, []);

  return eip6963Providers;
}

function hasLegacyEthereum(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.ethereum;
}

// ── Wallet Modal ─────────────────────────────────────────────────
function WalletModal({ onClose }: { onClose: () => void }) {
  const { connect, connectors: availableConnectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();
  const chains = useChains();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  const eip6963Providers = useDetectedWallets();

  useEffect(() => { setMounted(true); }, []);

  const connectorIds = useMemo(() => new Set(availableConnectors.map(c => c.id)), [availableConnectors]);
  const connectorRdns = useMemo(
    () => availableConnectors.flatMap(c => (c as ConnectorWithRdns).rdns || []).map((r: string) => r.toLowerCase()),
    [availableConnectors]
  );
  const connectorNames = useMemo(() => availableConnectors.map(c => c.name.toLowerCase()), [availableConnectors]);

  // Sort wallets into categories
  const { detectedWallets, qrWallets, otherWallets } = useMemo(() => {
    const detected: WalletMeta[] = [];
    const qr: WalletMeta[] = [];
    const other: WalletMeta[] = [];

    for (const w of WALLET_LIST) {
      // WalletConnect always goes to QR
      if (w.id === "walletconnect") {
        qr.push(w);
        continue;
      }

      // Hardware wallets in QR/other section
      if (w.category === "hardware") {
        other.push(w);
        continue;
      }

      // Check if this wallet is actually available
      let isAvailable = false;

      // Direct connector ID match
      if (connectorIds.has(w.connectorId)) {
        isAvailable = true;
      }

      // EIP-6963 rdns match
      if (!isAvailable && w.rdns) {
        const rdnsLower = w.rdns.toLowerCase();
        if (
          connectorRdns.includes(rdnsLower) ||
          eip6963Providers.some(p => p.rdns === rdnsLower)
        ) {
          isAvailable = true;
        }
      }

      if (isAvailable) {
        detected.push(w);
      } else {
        // If it's an injected wallet not detected, show in other
        if (w.category === "injected" || w.category === "sdk") {
          other.push(w);
        } else if (w.category === "walletconnect") {
          qr.push(w);
        } else {
          other.push(w);
        }
      }
    }

    return { detectedWallets: detected, qrWallets: qr, otherWallets: other };
  }, [connectorIds, connectorRdns, connectorNames, eip6963Providers]);

  // Also check for legacy window.ethereum
  const hasAnyWallet = mounted && (detectedWallets.length > 0 || hasLegacyEthereum());

  // ── Connect function ─────────────────────────────────────────
  const doConnect = useCallback(async (wallet: WalletMeta) => {
    setConnecting(wallet.id);
    setError(null);
    try {
      let c = availableConnectors.find(x => x.id === wallet.connectorId);

      // rdns fallback
      if (!c && wallet.rdns) {
        c = availableConnectors.find(x =>
          (x as ConnectorWithRdns).rdns?.some((r: string) => r.toLowerCase() === wallet.rdns!.toLowerCase())
        );
      }

      // Name fallback
      if (!c) {
        c = availableConnectors.find(x =>
          x.name.toLowerCase().includes(wallet.name.toLowerCase()) ||
          wallet.name.toLowerCase().includes(x.name.toLowerCase())
        );
      }

      // Generic injected fallback
      if (!c && (wallet.category === "injected" || wallet.category === "sdk")) {
        c = availableConnectors.find(x => x.id === "injected" || x.type === "injected");
      }

      // WalletConnect fallback
      if (!c && wallet.category === "walletconnect") {
        c = availableConnectors.find(x => x.id === "walletConnect");
      }

      if (c) {
        await connect({ connector: c });
        onClose();
      } else {
        setError(`No connector found for ${wallet.name}. Please install the wallet extension and try again.`);
      }
    } catch (e: any) {
      const msg = e?.message || e?.toString() || "";
      if (msg.includes("rejected") || msg.includes("denied") || e?.code === "ACTION_REJECTED" || e?.name === "UserRejectedRequestError") {
        setError("Connection rejected. Please approve the connection request in your wallet.");
      } else if (msg.includes("network") || msg.includes("timeout")) {
        setError("Network error. Please check your connection and try again.");
      } else if (msg.includes("chain") || msg.includes("unsupported")) {
        setError("Unsupported network. Please switch to a supported chain.");
      } else if (msg.includes("@walletconnect/ethereum-provider")) {
        setError("WalletConnect is initializing. Please try again in a moment.");
      } else {
        setError(msg || `Failed to connect to ${wallet.name}. Please try again.`);
      }
    } finally {
      setConnecting(null);
    }
  }, [availableConnectors, connect, onClose]);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 wallet-overlay"
      onClick={e => { if ((e.target as HTMLElement).classList.contains("wallet-overlay")) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl animate-fade-in-up wallet-glass"
        style={{
          background: "linear-gradient(135deg, rgba(13,17,35,0.97) 0%, rgba(10,22,40,0.97) 100%)",
          border: "1px solid rgba(59,130,246,0.15)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.08)",
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
          style={{
            background: "linear-gradient(135deg,rgba(13,17,35,0.98) 0%,rgba(10,22,40,0.98) 100%)",
            borderBottom: "1px solid rgba(59,130,246,0.08)",
            backdropFilter: "blur(12px)"
          }}
        >
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">🦚</span>
            <span className="text-gradient-blue">Connect Wallet</span>
          </h2>
          <div className="flex items-center gap-2">
            {/* Chain selector in modal */}
            <div className="relative">
              <button
                onClick={() => setChainOpen(!chainOpen)}
                className="px-2.5 py-1.5 rounded-lg bg-dark-hover border border-dark-border hover:border-accent-blue/40 text-gray-400 hover:text-white text-xs font-medium flex items-center gap-1 transition-all duration-200"
                title={`Network: ${CHAIN_LABELS[chainId] ?? `Chain ${chainId}`}`}
              >
                <span>{CHAIN_ICONS[chainId] ?? "⛓️"}</span>
                <span className="hidden sm:inline text-[0.65rem]">{CHAIN_LABELS[chainId] ?? chainId}</span>
                <span className="text-gray-600 text-[0.5rem]">▼</span>
              </button>
              {chainOpen && (
                <>
                  <div className="fixed inset-0 z-50" onClick={() => setChainOpen(false)} />
                  <div
                    className="absolute right-0 mt-2 z-[60] w-52 max-h-64 overflow-y-auto rounded-xl border border-dark-border shadow-2xl"
                    style={{
                      background: "linear-gradient(135deg, rgba(13,17,35,0.99) 0%, rgba(10,22,40,0.99) 100%)",
                      boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(59,130,246,0.1)",
                    }}
                  >
                    <div className="p-1">
                      {chains
                        .filter((c) => CHAIN_LABELS[c.id])
                        .map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              saveChainId(c.id);
                              switchChain({ chainId: c.id });
                              setChainOpen(false);
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all duration-150 ${
                              c.id === chainId
                                ? "bg-accent-blue/10 border border-accent-blue/20 text-white"
                                : "text-gray-400 hover:text-white hover:bg-dark-hover border border-transparent"
                            }`}
                          >
                            <span className="text-base">{CHAIN_ICONS[c.id] ?? "⛓️"}</span>
                            <span className="flex-1 text-left">{CHAIN_LABELS[c.id]}</span>
                            {c.id === chainId && (
                              <span className="text-accent-blue text-[0.5rem]">●</span>
                            )}
                          </button>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
              ✕
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Show token balances when connected */}
          <TokenBalances />

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-accent-red/30 bg-accent-red/5">
              <span className="text-sm shrink-0 mt-0.5">⚠️</span>
              <p className="text-xs text-accent-red leading-relaxed flex-1">{error}</p>
              <button onClick={() => setError(null)} className="text-gray-500 hover:text-gray-300 text-xs shrink-0">✕</button>
            </div>
          )}

          {/* Detected browser wallets */}
          {detectedWallets.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-accent-green uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                Detected
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {detectedWallets.slice(0, 6).map(w => (
                  <WalletCard
                    key={w.id}
                    wallet={w}
                    connecting={connecting}
                    onClick={() => doConnect(w)}
                    highlight
                  />
                ))}
              </div>
            </div>
          )}

          {/* WalletConnect QR code — always prominent */}
          {qrWallets.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-accent-blue uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <span>📱</span> Scan with Mobile
              </h3>
              {qrWallets.map(w => (
                <WalletConnectCard
                  key={w.id}
                  wallet={w}
                  connecting={connecting}
                  onClick={() => doConnect(w)}
                />
              ))}
            </div>
          )}

          {/* Other wallet options (not detected) */}
          {otherWallets.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <span>🔌</span> Other Wallets
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {otherWallets.slice(0, 8).map(w => (
                  <WalletCard
                    key={w.id}
                    wallet={w}
                    connecting={connecting}
                    onClick={() => doConnect(w)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* No wallets detected at all — show install prompts */}
          {mounted && !hasAnyWallet && (
            <div className="text-center space-y-3 py-2">
              <div className="text-4xl">🛡️</div>
              <p className="text-sm text-gray-400">
                No browser wallet detected. Use WalletConnect above with your mobile wallet, or install a browser extension.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 text-center border-t" style={{ borderColor: "rgba(59,130,246,0.08)" }}>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Cancel
          </button>
          <p className="text-[0.625rem] text-gray-600 mt-1.5">
            By connecting, you agree to interact with blockchain networks at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── WalletConnect QR Card (prominent, full-width) ───────────────
function WalletConnectCard({
  wallet,
  connecting,
  onClick,
}: {
  wallet: WalletMeta;
  connecting: string | null;
  onClick: () => void;
}) {
  const isLoading = connecting === wallet.id;

  return (
    <button
      onClick={onClick}
      disabled={connecting !== null}
      className="w-full flex items-center gap-4 px-4 py-4 rounded-xl border border-accent-blue/30 bg-accent-blue/5 hover:border-accent-blue/50 hover:bg-accent-blue/10 transition-all duration-200 group disabled:opacity-40"
    >
      <div className="w-10 h-10 rounded-xl bg-accent-blue/10 flex items-center justify-center text-2xl shrink-0">
        📱
      </div>
      <div className="flex-1 text-left">
        <span className="text-sm font-semibold text-white group-hover:text-accent-blue transition-colors">
          {wallet.name}
        </span>
        <p className="text-xs text-gray-400 mt-0.5">
          Scan QR code with your mobile wallet
        </p>
      </div>
      <div className="w-8 h-8 rounded-lg bg-accent-blue/20 flex items-center justify-center shrink-0">
        {isLoading ? (
          <svg className="animate-spin h-4 w-4 text-accent-blue" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <span className="text-accent-blue text-lg">▸</span>
        )}
      </div>
    </button>
  );
}

// ── Wallet Card (grid item) ──────────────────────────────────────
function WalletCard({
  wallet,
  connecting,
  onClick,
  highlight,
}: {
  wallet: WalletMeta;
  connecting: string | null;
  onClick: () => void;
  highlight?: boolean;
}) {
  const isLoading = connecting === wallet.id;

  return (
    <button
      onClick={onClick}
      disabled={connecting !== null}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-200 group disabled:opacity-40 ${
        highlight
          ? "border-accent-green/30 bg-accent-green/5 hover:border-accent-green/50 hover:bg-accent-green/10"
          : "border-dark-border bg-dark-hover/30 hover:border-accent-blue/30 hover:bg-dark-hover/60"
      }`}
    >
      <span className="text-xl shrink-0">{wallet.icon}</span>
      <span className="text-xs font-medium text-gray-200 group-hover:text-white transition-colors truncate">
        {wallet.name}
      </span>
      {isLoading && (
        <span className="ml-auto flex items-center">
          <svg className="animate-spin h-3.5 w-3.5 text-accent-blue" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </span>
      )}
    </button>
  );
}

// ── Hooks ────────────────────────────────────────────────────────
export function useIsWalletConnected() {
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted ? isConnected : false;
}

export function useWalletAddress() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted && isConnected ? address : null;
}
