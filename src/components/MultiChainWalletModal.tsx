import { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useBalance } from "~/lib/demo-wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatUnits } from "viem";

/* ── Types ──────────────────────────────────────────────────────── */
type ChainId = "evm" | "solana" | "xrp" | "tron" | "cosmos";

interface ChainInfo {
  id: ChainId;
  label: string;
  icon: string;
  wallets: WalletInfo[];
}

interface WalletInfo {
  id: string;
  name: string;
  icon: string;
  detectKey: string;
  url: string;
}

/* ── Chain Config ────────────────────────────────────────────────── */
const CHAINS: ChainInfo[] = [
  {
    id: "evm", label: "EVM", icon: "🔷",
    wallets: [
      { id: "metamask", name: "MetaMask", icon: "🦊", detectKey: "ethereum", url: "https://metamask.io" },
      { id: "coinbase", name: "Coinbase", icon: "🔵", detectKey: "coinbaseWalletExtension", url: "https://coinbase.com/wallet" },
      { id: "walletconnect", name: "WalletConnect", icon: "📱", detectKey: "", url: "https://walletconnect.com" },
    ],
  },
  {
    id: "solana", label: "Solana", icon: "◎",
    wallets: [
      { id: "phantom", name: "Phantom", icon: "👻", detectKey: "phantom", url: "https://phantom.app" },
      { id: "solflare", name: "Solflare", icon: "🔥", detectKey: "solflare", url: "https://solflare.com" },
      { id: "backpack", name: "Backpack", icon: "🎒", detectKey: "backpack", url: "https://backpack.app" },
    ],
  },
  {
    id: "xrp", label: "XRP", icon: "✧",
    wallets: [
      { id: "xumm", name: "Xumm", icon: "🛡️", detectKey: "xumm", url: "https://xumm.app" },
      { id: "gemwallet", name: "Gem Wallet", icon: "💎", detectKey: "gemwallet", url: "https://gemwallet.com" },
      { id: "xaman", name: "Xaman", icon: "⚡", detectKey: "xaman", url: "https://xaman.app" },
    ],
  },
  {
    id: "tron", label: "TRON", icon: "🌐",
    wallets: [
      { id: "tronlink", name: "TronLink", icon: "🔗", detectKey: "tronLink", url: "https://tronlink.org" },
      { id: "tronwallet", name: "TronWallet", icon: "💧", detectKey: "tronwallet", url: "https://tronwallet.me" },
    ],
  },
  {
    id: "cosmos", label: "Cosmos", icon: "☄️",
    wallets: [
      { id: "keplr", name: "Keplr", icon: "🔑", detectKey: "keplr", url: "https://keplr.app" },
      { id: "leap", name: "Leap", icon: "⬇️", detectKey: "leap", url: "https://leapwallet.io" },
      { id: "cosmostation", name: "Cosmostation", icon: "🪐", detectKey: "cosmostation", url: "https://cosmostation.io" },
    ],
  },
];

/* ── Wallet Detection Hook ───────────────────────────────────────── */
function useWalletDetected(detectKey: string): boolean {
  const [detected, setDetected] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !detectKey) return;
    if ((window as any)[detectKey]) { setDetected(true); return; }
    const timer = setTimeout(() => {
      if ((window as any)[detectKey]) setDetected(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [detectKey]);
  return detected;
}

/* ── Wallet Grid ─────────────────────────────────────────────────── */
function WalletGrid({ wallets }: { wallets: WalletInfo[] }) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {wallets.map((w) => {
        const detected = useWalletDetected(w.detectKey);
        return (
          <a
            key={w.id}
            href={detected ? "#" : w.url}
            target={detected ? undefined : "_blank"}
            rel={detected ? undefined : "noopener noreferrer"}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200 ${
              detected
                ? "border-accent-green/40 bg-accent-green/5 hover:bg-accent-green/10 hover:border-accent-green/60"
                : "border-dark-border bg-dark-hover/30 hover:bg-dark-hover/60 hover:border-accent-blue/30"
            }`}
          >
            <span className="text-2xl shrink-0">{w.icon}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-200">{w.name}</span>
                {detected && (
                  <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-bold bg-accent-green/20 text-accent-green font-mono">
                    DETECTED
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {detected ? "Click to connect" : "Not installed — click to install"}
              </p>
            </div>
            {detected ? (
              <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            ) : (
              <span className="text-xs text-accent-blue font-mono">↗</span>
            )}
          </a>
        );
      })}
    </div>
  );
}

/* ── Tab: EVM ────────────────────────────────────────────────────── */
function EVMTab() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connectors, connect } = useConnect();
  const { data: balance } = useBalance({ address });
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async (connector: (typeof connectors)[0]) => {
    setConnecting(true);
    try {
      await connect({ connector });
    } catch {}
    setConnecting(false);
  };

  return (
    <div className="space-y-4">
      {isConnected && address ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-dark-hover/50 border border-accent-green/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <div>
              <span className="text-sm text-gray-200 font-mono">
                {address.slice(0, 6)}...{address.slice(-4)}
              </span>
              {balance && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} {balance.symbol}
                </p>
              )}
            </div>
          </div>
          <button onClick={() => disconnect()} className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300">✕</button>
        </div>
      ) : (
        <div className="space-y-2">
          {connectors.map((conn) => (
            <button
              key={conn.id}
              onClick={() => handleConnect(conn)}
              disabled={connecting}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-dark-border bg-dark-hover/30 hover:bg-dark-hover/60 hover:border-accent-blue/30 transition-all disabled:opacity-40"
            >
              <span className="text-lg shrink-0">
                {conn.id === "io.metamask" ? "🦊" : conn.id === "coinbaseWalletSDK" ? "🔵" : "📱"}
              </span>
              <span className="text-sm font-medium text-gray-200">{conn.name}</span>
              {connecting && <span className="ml-auto text-xs text-accent-blue">Connecting...</span>}
            </button>
          ))}
        </div>
      )}
      <WalletGrid wallets={CHAINS[0].wallets} />
    </div>
  );
}

/* ── Tab: Solana ─────────────────────────────────────────────────── */
function SolanaTab() {
  const { publicKey, disconnect, select, wallets, connect, connecting } = useWallet();
  const [showPicker, setShowPicker] = useState(false);

  const handleConnect = async (name: string) => {
    select(name);
    await connect().catch(() => {});
    setShowPicker(false);
  };

  return (
    <div className="space-y-4">
      {publicKey ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-dark-hover/50 border border-accent-green/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <span className="text-sm text-gray-200 font-mono">
              {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
            </span>
          </div>
          <button onClick={() => disconnect()} className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300">✕</button>
        </div>
      ) : (
        <div className="relative">
          <button
            onClick={() => setShowPicker(!showPicker)}
            disabled={connecting}
            className="w-full px-4 py-2.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-white text-sm font-medium hover:bg-accent-blue/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {connecting ? (
              <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg><span>Connecting...</span></>
            ) : (
              <><span>◎</span><span>Connect Solana Wallet</span></>
            )}
          </button>
          {showPicker && (
            <div className="absolute top-full left-0 right-0 mt-1 py-1.5 rounded-lg border border-dark-border bg-[#0d1117]/95 backdrop-blur-xl shadow-xl z-50">
              {wallets.filter((w) => w.adapter.name).map((w) => (
                <button
                  key={w.adapter.name}
                  onClick={() => handleConnect(w.adapter.name)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-gray-200 hover:text-white hover:bg-dark-hover transition-colors"
                >
                  <span>{w.adapter.icon || "◎"}</span>
                  <span className="font-medium">{w.adapter.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <WalletGrid wallets={CHAINS[1].wallets} />
    </div>
  );
}

/* ── Tab: XRP ────────────────────────────────────────────────────── */
function XRPTab() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const detected = typeof window !== "undefined" && !!(window as any).xumm;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const xumm = (window as any).xumm;
    if (xumm?.address) setAddress(xumm.address);
  }, []);

  const connectXumm = async () => {
    setConnecting(true);
    try {
      const xumm = (window as any).xumm;
      if (xumm?.address) setAddress(xumm.address);
      else if (xumm?.connect) {
        const resp = await xumm.connect("xumm");
        if (resp?.address) setAddress(resp.address);
      }
    } catch {}
    setConnecting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-dark-hover/50 border border-dark-border">
        <span className={`w-2 h-2 rounded-full ${detected ? "bg-accent-green animate-pulse" : "bg-gray-500"}`} />
        <span className="text-xs font-mono text-gray-300">
          {detected ? "Xumm detected in browser" : "Xumm wallet not detected"}
        </span>
      </div>
      {address ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-dark-hover/50 border border-accent-green/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <span className="text-sm text-gray-200 font-mono">{address.slice(0, 8)}...{address.slice(-4)}</span>
          </div>
          <button onClick={() => setAddress(null)} className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300">✕</button>
        </div>
      ) : (
        <button onClick={connectXumm} disabled={connecting}
          className="w-full px-4 py-2.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-white text-sm font-medium hover:bg-accent-blue/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {connecting ? (
            <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg><span>Connecting...</span></>
          ) : (<><span>🛡️</span><span>Connect Xumm Wallet</span></>)}
        </button>
      )}
      <WalletGrid wallets={CHAINS[2].wallets} />
    </div>
  );
}

/* ── Tab: TRON ───────────────────────────────────────────────────── */
function TRONTab() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const detected = typeof window !== "undefined" && !!(window as any).tronLink;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tl = (window as any).tronLink;
    if (tl?.address) setAddress(tl.address);
    if (tl?.on) tl.on("addressChanged", (addr: string) => setAddress(addr));
  }, []);

  const connectTron = async () => {
    setConnecting(true);
    try {
      const tl = (window as any).tronLink;
      if (tl?.request) {
        const resp = await tl.request({ method: "tron_requestAccounts" });
        if (resp?.address) setAddress(resp.address);
      } else if (tl?.connect) {
        setAddress(await tl.connect());
      }
    } catch {}
    setConnecting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-dark-hover/50 border border-dark-border">
        <span className={`w-2 h-2 rounded-full ${detected ? "bg-accent-green animate-pulse" : "bg-gray-500"}`} />
        <span className="text-xs font-mono text-gray-300">
          {detected ? "TronLink detected in browser" : "TronLink not detected"}
        </span>
      </div>
      {address ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-dark-hover/50 border border-accent-green/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <span className="text-sm text-gray-200 font-mono">T{address.slice(1, 8)}...{address.slice(-4)}</span>
          </div>
          <button onClick={() => setAddress(null)} className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300">✕</button>
        </div>
      ) : (
        <button onClick={connectTron} disabled={connecting}
          className="w-full px-4 py-2.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-white text-sm font-medium hover:bg-accent-blue/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {connecting ? (
            <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg><span>Connecting...</span></>
          ) : (<><span>🔗</span><span>Connect TronLink</span></>)}
        </button>
      )}
      <WalletGrid wallets={CHAINS[3].wallets} />
    </div>
  );
}

/* ── Tab: Cosmos ─────────────────────────────────────────────────── */
function CosmosTab() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const detected = typeof window !== "undefined" && !!(window as any).keplr;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = (window as any).keplr;
    if (k?.address) setAddress(k.address);
    const check = async () => {
      try {
        if (k?.getKey) {
          const key = await k.getKey("cosmoshub-4").catch(() => null) || await k.getKey("cosmoshub").catch(() => null);
          if (key?.bech32Address) setAddress(key.bech32Address);
        }
      } catch {}
    };
    check();
  }, []);

  const connectKeplr = async () => {
    setConnecting(true);
    try {
      const k = (window as any).keplr;
      if (k?.enable) {
        await k.enable("cosmoshub-4").catch(() => k.enable("cosmoshub"));
        const key = await k.getKey("cosmoshub-4").catch(() => k.getKey("cosmoshub"));
        if (key?.bech32Address) setAddress(key.bech32Address);
      }
    } catch {}
    setConnecting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-dark-hover/50 border border-dark-border">
        <span className={`w-2 h-2 rounded-full ${detected ? "bg-accent-green animate-pulse" : "bg-gray-500"}`} />
        <span className="text-xs font-mono text-gray-300">
          {detected ? "Keplr detected in browser" : "Keplr not detected"}
        </span>
      </div>
      {address ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-dark-hover/50 border border-accent-green/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <span className="text-sm text-gray-200 font-mono">{address.slice(0, 8)}...{address.slice(-4)}</span>
          </div>
          <button onClick={() => setAddress(null)} className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300">✕</button>
        </div>
      ) : (
        <button onClick={connectKeplr} disabled={connecting}
          className="w-full px-4 py-2.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-white text-sm font-medium hover:bg-accent-blue/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {connecting ? (
            <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg><span>Connecting...</span></>
          ) : (<><span>🔑</span><span>Connect Keplr</span></>)}
        </button>
      )}
      <WalletGrid wallets={CHAINS[4].wallets} />
    </div>
  );
}

/* ── Tab Content Map ─────────────────────────────────────────────── */
const TAB_CONTENT: Record<ChainId, () => JSX.Element> = {
  evm: EVMTab,
  solana: SolanaTab,
  xrp: XRPTab,
  tron: TRONTab,
  cosmos: CosmosTab,
};

/* ── Main Modal ──────────────────────────────────────────────────── */
export function MultiChainWalletModal({ onClose }: { onClose: () => void }) {
  const [activeChain, setActiveChain] = useState<ChainId>("evm");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1a1f2e] bg-[#0d1117]/95 backdrop-blur-2xl shadow-2xl shadow-black/50 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1f2e]">
          <h2 className="text-sm font-bold text-gray-200 font-mono tracking-wider">CONNECT WALLET</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-dark-hover transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex border-b border-[#1a1f2e] overflow-x-auto">
          {CHAINS.map((chain) => (
            <button
              key={chain.id}
              onClick={() => setActiveChain(chain.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-semibold transition-all duration-200 whitespace-nowrap border-b-2 ${
                activeChain === chain.id
                  ? "border-accent-green text-accent-green bg-accent-green/5"
                  : "border-transparent text-[#546e7a] hover:text-gray-300 hover:bg-dark-hover/50"
              }`}
            >
              <span>{chain.icon}</span>
              <span>{chain.label}</span>
            </button>
          ))}
        </div>
        <div className="p-5 max-h-[400px] overflow-y-auto">
          {TAB_CONTENT[activeChain]()}
        </div>
        <div className="px-5 py-3 border-t border-[#1a1f2e]">
          <p className="text-[0.6rem] text-gray-500 font-mono text-center">
            By connecting, you agree to interact with blockchain networks at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── MultiChainWalletButton (Navbar) ─────────────────────────────── */
export function MultiChainWalletButton() {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { publicKey: solanaPubkey } = useWallet();
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const connectedChains: string[] = [];
  if (evmConnected && evmAddress) connectedChains.push("EVM");
  if (solanaPubkey) connectedChains.push("SOL");

  if (!mounted) {
    return (
      <button className="px-4 py-2 rounded-lg bg-dark-hover border border-dark-border text-gray-400 text-sm font-medium">
        Connect Wallet
      </button>
    );
  }

  if (connectedChains.length > 0) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-1.5 rounded-lg bg-dark-hover border border-dark-border hover:border-accent-blue/40 text-sm font-medium text-gray-300 hover:text-white transition-all duration-200 text-mono-sm flex items-center gap-1.5"
        >
          <span className="w-2 h-2 rounded-full bg-accent-green" />
          <span className="hidden sm:inline">{connectedChains.join("+")}</span>
          <span className="sm:hidden">
            {evmAddress ? `${evmAddress.slice(0, 4)}...${evmAddress.slice(-3)}` : ""}
          </span>
        </button>
        {showModal && <MultiChainWalletModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/80 transition-all duration-200 shadow-lg shadow-accent-blue/20 flex items-center gap-1.5"
      >
        <span>🔗</span>
        <span className="hidden sm:inline">Connect</span>
      </button>
      {showModal && <MultiChainWalletModal onClose={() => setShowModal(false)} />}
    </>
  );
}