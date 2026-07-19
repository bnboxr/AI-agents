import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { useState, useEffect, useMemo, type ReactNode } from "react";
import { config, WALLET_LIST, type WalletMeta } from "~/lib/web3";

const queryClient = new QueryClient();

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
  return (
    <WagmiProvider config={config} reconnectOnMount={true}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
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

  if (!mounted) return <button className="px-4 py-2 rounded-lg bg-dark-hover border border-dark-border text-gray-400 text-sm font-medium">Connect Wallet</button>;

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-hover border border-dark-border/50">
          <span className="w-2 h-2 rounded-full bg-accent-green" />
          <span className="text-xs text-gray-300 text-mono-sm">
            {ethBalance ? `${parseFloat(formatUnits(ethBalance.value, ethBalance.decimals)).toFixed(4)} ${ethBalance.symbol}` : "..."}
          </span>
        </div>
        <button onClick={() => disconnect()} className="px-3 py-1.5 rounded-lg bg-dark-hover border border-dark-border hover:border-accent-blue/40 text-sm font-medium text-gray-300 hover:text-white transition-all duration-200 text-mono-sm" title={address}>
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
      </div>
    );
  }

  const close = () => { setShowModal(false); dismissPopup(); };

  return (
    <>
      <button onClick={() => setShowModal(true)} className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/80 transition-all duration-200 shadow-lg shadow-accent-blue/20">
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Categorize
  const { installed, qr, notDetected } = useMemo(() => {
    const inst: WalletMeta[] = [], q: WalletMeta[] = [];
    const connIds = new Set(availableConnectors.map(c => c.id));

    for (const w of WALLET_LIST) {
      let detected = false;
      if (connIds.has(w.id)) detected = true;
      if ((w.category === "injected" || w.category === "sdk") && !detected) {
        for (const c of availableConnectors) {
          if (c.type === "injected") {
            const cn = c.name.toLowerCase(), wn = w.name.toLowerCase(), wr = w.rdns?.toLowerCase() || "";
            if (cn.includes(wn) || wn.includes(cn) || (w.rdns && c.id.includes(wr)) || c.id === w.id) { detected = true; break; }
          }
        }
      }
      if (w.category === "walletconnect" || w.category === "hardware") { q.push(w); continue; }
      if (detected) inst.push(w);
    }
    const nd = WALLET_LIST.filter(w => w.category !== "walletconnect" && w.category !== "hardware" && !inst.some(i => i.id === w.id));
    return { installed: inst, qr: q, notDetected: nd };
  }, [availableConnectors]);

  const doConnect = async (wallet: WalletMeta) => {
    setConnecting(wallet.id);
    try {
      let c = availableConnectors.find(x => x.id === wallet.id);
      if (!c && (wallet.category === "injected")) c = availableConnectors.find(x => x.type === "injected" && (x.name.toLowerCase().includes(wallet.name.toLowerCase()) || (wallet.rdns && x.id.includes(wallet.rdns))));
      if (!c && (wallet.category === "injected")) c = availableConnectors.find(x => x.type === "injected");
      if (!c && (wallet.category === "walletconnect" || wallet.category === "hardware")) c = availableConnectors.find(x => x.id === "walletConnect" || x.id === "safe");
      if (!c && wallet.category === "sdk") c = availableConnectors.find(x => x.id.includes(wallet.id));
      if (c) { await connect({ connector: c }); onClose(); }
      else console.warn(`No connector for ${wallet.name}`);
    } catch (e: any) { console.error(e); }
    setConnecting(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 wallet-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("wallet-overlay")) onClose(); }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" />
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl animate-fade-in-up wallet-glass scrollbar-hide" style={{ background: "linear-gradient(135deg, rgba(13,17,35,0.97) 0%, rgba(10,22,40,0.97) 100%)", border: "1px solid rgba(59,130,246,0.15)", boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.08)" }}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4" style={{ background: "linear-gradient(135deg,rgba(13,17,35,0.98) 0%,rgba(10,22,40,0.98) 100%)", borderBottom: "1px solid rgba(59,130,246,0.08)", backdropFilter: "blur(12px)" }}>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><span className="text-xl">🦚</span><span className="text-gradient-blue">Connect Wallet</span></h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">✕</button>
        </div>
        <div className="p-6 space-y-5">
          {/* Installed */}
          {installed.length > 0 && mounted && (
            <div>
              <h3 className="text-xs font-semibold text-accent-green uppercase tracking-wider mb-3 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />Installed</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {installed.map(w => <WalletCard key={w.id} wallet={w} connecting={connecting} onClick={() => doConnect(w)} highlight />)}
              </div>
            </div>
          )}
          {/* Mobile / QR */}
          <div>
            <h3 className="text-xs font-semibold text-accent-blue uppercase tracking-wider mb-3 flex items-center gap-1.5"><span>📱</span> Mobile / QR Code</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {qr.map(w => <WalletCard key={w.id} wallet={w} connecting={connecting} onClick={() => doConnect(w)} />)}
            </div>
          </div>
          {/* Install links */}
          {notDetected.length > 0 && mounted && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><span>⬇️</span> Don't have a wallet?</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 opacity-70 hover:opacity-100 transition-opacity">
                {notDetected.filter(w => w.category === "injected" || w.category === "sdk").slice(0, 15).map(w => (
                  <a key={w.id + "-install"} href={w.installUrl || "#"} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dark-border hover:border-accent-blue/30 bg-dark-hover/30 hover:bg-dark-hover/60 transition-all duration-200 group">
                    <span className="text-lg">{w.icon}</span>
                    <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors truncate">{w.name}</span>
                    <span className="ml-auto text-[0.6rem] text-gray-600 group-hover:text-accent-blue transition-colors">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-3 text-center border-t" style={{ borderColor: "rgba(59,130,246,0.08)" }}>
          <button onClick={onConnectLater} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Connect Later</button>
          <p className="text-[0.625rem] text-gray-600 mt-1.5">By connecting, you agree to interact with blockchain networks at your own risk.</p>
        </div>
      </div>
    </div>
  );
}

function WalletCard({ wallet, connecting, onClick, highlight }: { wallet: WalletMeta; connecting: string | null; onClick: () => void; highlight?: boolean }) {
  return (
    <button onClick={onClick} disabled={connecting !== null}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-200 group disabled:opacity-40 ${highlight ? "border-accent-green/30 bg-accent-green/5 hover:border-accent-green/50 hover:bg-accent-green/10" : "border-dark-border bg-dark-hover/30 hover:border-accent-blue/30 hover:bg-dark-hover/60"}`}>
      <span className="text-xl shrink-0">{wallet.icon}</span>
      <span className="text-xs font-medium text-gray-200 group-hover:text-white transition-colors truncate">{wallet.name}</span>
      {connecting === wallet.id && <span className="ml-auto text-accent-blue text-[0.6rem] animate-pulse">⏳</span>}
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
