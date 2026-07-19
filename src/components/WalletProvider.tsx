import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { config, WALLET_LIST, TOP_WALLETS, type WalletMeta } from "~/lib/web3";

// ── Auto-popup localStorage ──────────────────────────────────────
const POPUP_KEY = "paun_wallet_popup_dismissed";
const DISMISS_DURATION = 24 * 60 * 60 * 1000;

function popupDismissed(): boolean {
  if (typeof window === "undefined") return true;
  const ts = localStorage.getItem(POPUP_KEY);
  return ts ? (Date.now() - parseInt(ts, 10)) < DISMISS_DURATION : false;
}
function dismissPopup() {
  if (typeof window !== "undefined") localStorage.setItem(POPUP_KEY, Date.now().toString());
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

// ── Browser wallet detection helpers ──────────────────────────────
function hasAnyInjectedProvider(): boolean {
  if (typeof window === "undefined") return false;
  // Check for legacy window.ethereum
  if ((window as any).ethereum) return true;
  // Check for EIP-6963 announced providers
  if ((window as any).eip6963Providers && (window as any).eip6963Providers.length > 0) return true;
  return false;
}

// ── Connect Button ───────────────────────────────────────────────
export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: ethBalance } = useBalance({ address });
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined" || isConnected || popupDismissed()) return;
    const t = setTimeout(() => setShowModal(true), 2000);
    return () => clearTimeout(t);
  }, [isConnected]);

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
          onClick={() => disconnect()}
          className="px-3 py-1.5 rounded-lg bg-dark-hover border border-dark-border hover:border-accent-blue/40 text-sm font-medium text-gray-300 hover:text-white transition-all duration-200 text-mono-sm"
          title={address}
        >
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
      </div>
    );
  }

  const close = () => { setShowModal(false); dismissPopup(); };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/80 transition-all duration-200 shadow-lg shadow-accent-blue/20"
      >
        Connect Wallet
      </button>
      {showModal && <WalletModal onClose={close} onConnectLater={close} />}
    </>
  );
}

// ── Wallet Modal ─────────────────────────────────────────────────
function WalletModal({ onClose, onConnectLater }: { onClose: () => void; onConnectLater: () => void }) {
  const { connect, connectors: availableConnectors } = useConnect();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [forceRescan, setForceRescan] = useState(0);

  useEffect(() => { setMounted(true); }, []);

  // Determine if any injected wallet is available
  const walletState = useMemo(() => {
    const injectedConnectors = availableConnectors.filter(
      c => c.type === "injected" || c.id === "metaMaskSDK" || c.id === "coinbaseWalletSDK"
    );
    const hasWalletConnect = availableConnectors.some(c => c.id === "walletConnect");
    const hasInjected = injectedConnectors.length > 0 || hasAnyInjectedProvider();
    return { injectedConnectors, hasWalletConnect, hasInjected };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableConnectors, forceRescan]);

  // Map available connectors to wallet metadata
  const { detectedWallets, qrWallets } = useMemo(() => {
    const detected: WalletMeta[] = [];
    const qr: WalletMeta[] = [];

    // Build sets of available connector IDs and rdns values
    const connIds = new Set(availableConnectors.map(c => c.id));
    const connRdns = availableConnectors.flatMap(
      c => (c as any).rdns || []
    ).map((r: string) => r.toLowerCase());

    for (const w of WALLET_LIST) {
      // Exact connector ID match
      if (connIds.has(w.connectorId)) {
        // For injected connector, check rdns match too
        if (w.connectorId === "injected") {
          if (w.rdns && connRdns.includes(w.rdns.toLowerCase())) {
            detected.push(w);
            continue;
          }
          // Don't add generic injected wallets that don't have rdns match
          // unless there's no rdns requirement
          if (!w.rdns) continue;
        } else if (w.connectorId === "walletConnect" || w.category === "walletconnect") {
          qr.push(w);
          continue;
        } else {
          detected.push(w);
          continue;
        }
      }

      // rdns fallback match for injected connector
      if (w.rdns && connRdns.includes(w.rdns.toLowerCase())) {
        detected.push(w);
        continue;
      }

      // WalletConnect and hardware always go to QR section
      if (w.category === "walletconnect" || w.category === "hardware") {
        qr.push(w);
        continue;
      }

      // Name-based match as last resort
      const connNames = availableConnectors.map(c => c.name.toLowerCase());
      if (connNames.some(n => n.includes(w.name.toLowerCase()) || w.name.toLowerCase().includes(n))) {
        detected.push(w);
        continue;
      }
    }

    return { detectedWallets: detected, qrWallets: qr };
  }, [availableConnectors]);

  // ── Connect function ─────────────────────────────────────────
  const doConnect = useCallback(async (wallet: WalletMeta) => {
    setConnecting(wallet.id);
    setError(null);
    try {
      // Strategy 1: Exact connectorId match
      let c = availableConnectors.find(x => x.id === wallet.connectorId);

      // Strategy 2: rdns match (for EIP-6963 discovered providers)
      if (!c && wallet.rdns) {
        c = availableConnectors.find(x => {
          const xRdns: string[] = (x as any).rdns || [];
          return xRdns.some((r: string) => r.toLowerCase() === wallet.rdns!.toLowerCase());
        });
      }

      // Strategy 3: Name match
      if (!c) {
        c = availableConnectors.find(x =>
          x.name.toLowerCase().includes(wallet.name.toLowerCase()) ||
          wallet.name.toLowerCase().includes(x.name.toLowerCase())
        );
      }

      // Strategy 4: For injected/sdk wallets, fall back to generic injected connector
      if (!c && (wallet.category === "injected" || wallet.category === "sdk")) {
        c = availableConnectors.find(x => x.id === "injected" || x.type === "injected");
      }

      // Strategy 5: WalletConnect
      if (!c && wallet.category === "walletconnect") {
        c = availableConnectors.find(x => x.id === "walletConnect");
      }

      if (c) {
        await connect({ connector: c });
        onClose();
      } else {
        setError(`No connector found for ${wallet.name}. Please make sure the wallet is installed and unlocked.`);
      }
    } catch (e: any) {
      const msg = e?.message || e?.toString() || "";
      if (e?.name === "UserRejectedRequestError" || e?.code === "ACTION_REJECTED" || msg.includes("rejected") || msg.includes("denied")) {
        setError("Connection rejected. Please approve the connection request in your wallet.");
      } else if (msg.includes("network") || msg.includes("timeout")) {
        setError("Network error. Please check your connection and try again.");
      } else if (msg.includes("chain") || msg.includes("unsupported")) {
        setError("Unsupported network. Please switch to a supported chain.");
      } else {
        setError(msg || `Failed to connect to ${wallet.name}. Please try again.`);
      }
    } finally {
      setConnecting(null);
    }
  }, [availableConnectors, connect, onClose]);

  const rescan = useCallback(() => {
    setForceRescan(prev => prev + 1);
    setShowInstallGuide(false);
    setError(null);
  }, []);

  // ── Render: No wallet detected at all ─────────────────────────
  if (mounted && !walletState.hasInjected && !showInstallGuide) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 wallet-overlay"
        onClick={e => { if ((e.target as HTMLElement).classList.contains("wallet-overlay")) onClose(); }}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" />
        <div
          className="relative w-full max-w-md animate-fade-in-up wallet-glass rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(13,17,35,0.97) 0%, rgba(10,22,40,0.97) 100%)",
            border: "1px solid rgba(59,130,246,0.15)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.08)",
          }}
        >
          {/* Header */}
          <div
            className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
            style={{ background: "linear-gradient(135deg,rgba(13,17,35,0.98) 0%,rgba(10,22,40,0.98) 100%)", borderBottom: "1px solid rgba(59,130,246,0.08)", backdropFilter: "blur(12px)" }}
          >
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-xl">🦚</span>
              <span className="text-gradient-blue">Connect Wallet</span>
            </h2>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">✕</button>
          </div>

          {/* No Wallet Body */}
          <div className="p-6 text-center space-y-5">
            <div className="text-5xl mb-2">🛡️</div>
            <h3 className="text-xl font-bold text-white">No Wallet Detected</h3>
            <p className="text-sm text-gray-400 max-w-xs mx-auto">
              You need a browser wallet extension to connect. Choose one of the options below to get started in seconds.
            </p>

            <button
              onClick={() => setShowInstallGuide(true)}
              className="glass-button w-full py-3 text-base"
            >
              Install a Wallet
            </button>

            {/* WalletConnect fallback — always available */}
            {walletState.hasWalletConnect && (
              <>
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 h-px bg-dark-border" />
                  <span className="text-xs text-gray-500 uppercase">or use mobile</span>
                  <div className="flex-1 h-px bg-dark-border" />
                </div>
                <button
                  onClick={() => {
                    const wc = WALLET_LIST.find(w => w.id === "walletconnect");
                    if (wc) doConnect(wc);
                  }}
                  disabled={connecting !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-accent-blue/20 bg-accent-blue/5 hover:bg-accent-blue/10 transition-all duration-200 group disabled:opacity-40"
                >
                  <span className="text-xl">🔗</span>
                  <span className="text-sm font-medium text-gray-200 group-hover:text-white">WalletConnect (QR Code)</span>
                  {connecting === "walletconnect" && <span className="text-accent-blue animate-pulse">⏳</span>}
                </button>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 text-center border-t" style={{ borderColor: "rgba(59,130,246,0.08)" }}>
            <button onClick={onConnectLater} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Connect Later
            </button>
            <p className="text-[0.625rem] text-gray-600 mt-1.5">
              By connecting, you agree to interact with blockchain networks at your own risk.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Install Guide (shown when user clicks "Install a Wallet") ──
  if (mounted && !walletState.hasInjected && showInstallGuide) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 wallet-overlay"
        onClick={e => { if ((e.target as HTMLElement).classList.contains("wallet-overlay")) onClose(); }}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" />
        <div
          className="relative w-full max-w-md animate-fade-in-up wallet-glass rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(13,17,35,0.97) 0%, rgba(10,22,40,0.97) 100%)",
            border: "1px solid rgba(59,130,246,0.15)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.08)",
          }}
        >
          {/* Header */}
          <div
            className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
            style={{ background: "linear-gradient(135deg,rgba(13,17,35,0.98) 0%,rgba(10,22,40,0.98) 100%)", borderBottom: "1px solid rgba(59,130,246,0.08)", backdropFilter: "blur(12px)" }}
          >
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-xl">⬇️</span>
              <span className="text-gradient-blue">Install a Wallet</span>
            </h2>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">✕</button>
          </div>

          <div className="p-6 space-y-5">
            {/* Step-by-step instructions */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-blue/20 text-accent-blue text-xs font-bold flex items-center justify-center">1</span>
                <div>
                  <p className="text-sm font-medium text-white">Click Install below</p>
                  <p className="text-xs text-gray-400">Opens the official download page in a new tab</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-blue/20 text-accent-blue text-xs font-bold flex items-center justify-center">2</span>
                <div>
                  <p className="text-sm font-medium text-white">Create wallet or import seed</p>
                  <p className="text-xs text-gray-400">Follow the wallet's onboarding to set up your account</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-blue/20 text-accent-blue text-xs font-bold flex items-center justify-center">3</span>
                <div>
                  <p className="text-sm font-medium text-white">Come back and connect</p>
                  <p className="text-xs text-gray-400">Click "I've installed it" below once ready</p>
                </div>
              </div>
            </div>

            {/* Wallet options */}
            <div className="space-y-2">
              {TOP_WALLETS.map(w => (
                <a
                  key={w.id}
                  href={w.installUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dark-border hover:border-accent-blue/40 bg-dark-hover/30 hover:bg-dark-hover/60 transition-all duration-200 group"
                >
                  <span className="text-2xl">{w.icon}</span>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">{w.name}</p>
                    <p className="text-[0.625rem] text-gray-500">Official download →</p>
                  </div>
                  <span className="text-sm text-gray-600 group-hover:text-accent-blue transition-colors">↗</span>
                </a>
              ))}
            </div>

            {/* "I've installed it" button */}
            <button
              onClick={rescan}
              className="w-full py-2.5 rounded-xl border border-accent-green/30 bg-accent-green/10 text-accent-green text-sm font-medium hover:bg-accent-green/20 transition-all duration-200"
            >
              ✅ I've installed it — scan again
            </button>

            <button
              onClick={() => setShowInstallGuide(false)}
              className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Normal wallet selection modal (wallets detected) ──
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 wallet-overlay"
      onClick={e => { if ((e.target as HTMLElement).classList.contains("wallet-overlay")) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl animate-fade-in-up wallet-glass scrollbar-hide"
        style={{
          background: "linear-gradient(135deg, rgba(13,17,35,0.97) 0%, rgba(10,22,40,0.97) 100%)",
          border: "1px solid rgba(59,130,246,0.15)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.08)",
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
          style={{ background: "linear-gradient(135deg,rgba(13,17,35,0.98) 0%,rgba(10,22,40,0.98) 100%)", borderBottom: "1px solid rgba(59,130,246,0.08)", backdropFilter: "blur(12px)" }}
        >
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">🦚</span>
            <span className="text-gradient-blue">Connect Wallet</span>
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-accent-red/30 bg-accent-red/5">
              <span className="text-sm shrink-0 mt-0.5">⚠️</span>
              <p className="text-xs text-accent-red leading-relaxed">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-gray-500 hover:text-gray-300 text-xs shrink-0">✕</button>
            </div>
          )}

          {/* Detected wallets */}
          {detectedWallets.length > 0 && mounted && (
            <div>
              <h3 className="text-xs font-semibold text-accent-green uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                Detected
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {detectedWallets.map(w => (
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

          {/* Mobile / QR */}
          <div>
            <h3 className="text-xs font-semibold text-accent-blue uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <span>📱</span> Mobile / QR Code
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {qrWallets.map(w => (
                <WalletCard
                  key={w.id}
                  wallet={w}
                  connecting={connecting}
                  onClick={() => doConnect(w)}
                />
              ))}
            </div>
          </div>

          {/* Re-scan for newly installed wallets */}
          {!walletState.hasInjected && (
            <button
              onClick={rescan}
              className="w-full py-2 rounded-lg border border-dark-border bg-dark-hover/30 hover:bg-dark-hover/60 text-xs text-gray-400 hover:text-gray-200 transition-all duration-200"
            >
              🔄 Scan for newly installed wallets
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 text-center border-t" style={{ borderColor: "rgba(59,130,246,0.08)" }}>
          <button onClick={onConnectLater} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Connect Later
          </button>
          <p className="text-[0.625rem] text-gray-600 mt-1.5">
            By connecting, you agree to interact with blockchain networks at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Wallet Card ───────────────────────────────────────────────────
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
