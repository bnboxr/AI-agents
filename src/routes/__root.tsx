import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  Link,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { WalletProvider, ConnectButton, ChainSelector } from "~/components/WalletProvider";
import AlertBell from "~/components/AlertBell";
import AlertToast from "~/components/AlertToast";
import HelpGuide from "~/components/HelpGuide";
import ParticleField from "~/components/ParticleField";
import { isDemoMode, toggleDemo } from "~/lib/demo-mode";

import appCss from "~/styles/app.css?url";

/* ── Live Ticker ─────────────────────────────────────────────────── */

const TICKER_PAIRS = [
  { symbol: "BTC", coingeckoId: "bitcoin" },
  { symbol: "ETH", coingeckoId: "ethereum" },
  { symbol: "SOL", coingeckoId: "solana" },
  { symbol: "BNB", coingeckoId: "binancecoin" },
  { symbol: "ARB", coingeckoId: "arbitrum" },
  { symbol: "OP", coingeckoId: "optimism" },
  { symbol: "MATIC", coingeckoId: "matic-network" },
  { symbol: "AVAX", coingeckoId: "avalanche-2" },
  { symbol: "LINK", coingeckoId: "chainlink" },
  { symbol: "UNI", coingeckoId: "uniswap" },
  { symbol: "AAVE", coingeckoId: "aave" },
  { symbol: "SUI", coingeckoId: "sui" },
  { symbol: "XRP", coingeckoId: "ripple" },
  { symbol: "TRX", coingeckoId: "tron" },
  { symbol: "ATOM", coingeckoId: "cosmos" },
];

interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
}

function LiveTicker() {
  const [prices, setPrices] = useState<TickerData[]>([]);

  useEffect(() => {
    const fetchTicker = async () => {
      const ids = TICKER_PAIRS.map((p) => p.coingeckoId).join(",");
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
        );
        if (!res.ok) return;
        const data = await res.json();
        const result: TickerData[] = TICKER_PAIRS.map((pair) => {
          const d = data[pair.coingeckoId];
          return {
            symbol: pair.symbol,
            price: d?.usd ?? 0,
            change24h: d?.usd_24h_change ?? 0,
          };
        }).filter((p) => p.price > 0);
        setPrices(result);
      } catch {
        // silent
      }
    };

    fetchTicker();
    const interval = setInterval(fetchTicker, 30000);
    return () => clearInterval(interval);
  }, []);

  if (prices.length === 0) return null;

  // Duplicate for seamless scroll
  const tickerItems = [...prices, ...prices];

  return (
    <div className="ticker-container">
      <div className="ticker-track py-1">
        {tickerItems.map((item, i) => (
          <span key={`${item.symbol}-${i}`} className="ticker-item">
            <span className="font-semibold text-[#00e676]">{item.symbol}</span>
            <span className="text-[#b0bec5]">
              ${item.price < 1 ? item.price.toFixed(4) : item.price < 1000 ? item.price.toFixed(2) : item.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
            <span className={item.change24h >= 0 ? "ticker-positive" : "ticker-negative"}>
              {item.change24h >= 0 ? "+" : ""}{item.change24h.toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Route ────────────────────────────────────────────────────────── */

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "HSMC — FinTech Terminal" },
      { name: "description", content: "Multi-chain DeFi platform. Swap, earn yield, and manage your portfolio across 20+ blockchains." },
      { name: "theme-color", content: "#080a0f" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="glass-card p-12 text-center max-w-md blue-glow">
        <h1 className="text-6xl font-black text-gradient-blue mb-4">404</h1>
        <p className="text-[#b0bec5] text-lg">Page not found</p>
        <Link to="/" className="mt-6 inline-block text-[#00e676] hover:text-[#00bcd4] transition-colors">
          ← Back to Home
        </Link>
      </div>
    </div>
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <WalletProvider>
        <NavBar />
        <DemoBanner />
        <LiveTicker />
        <main className="min-h-dvh">
          <Outlet />
        </main>
        <AlertToast />
        <Footer />
        <HelpGuide />
      </WalletProvider>
    </RootDocument>
  );
}

/* ── Navigation ───────────────────────────────────────────────────── */

interface DropdownItem {
  label: string;
  to: string;
}

function NavDropdown({ label, items }: { label: string; items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const handleMouseEnter = () => {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimer = setTimeout(() => setOpen(false), 200);
  };

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        className="nav-link px-2 py-1.5 rounded text-[0.65rem] sm:text-xs font-semibold text-[#546e7a] hover:text-[#00e676] hover:bg-[#0d1117] transition-all duration-150 whitespace-nowrap font-mono tracking-wider flex items-center gap-1"
      >
        {label}
        <svg className={`w-2.5 h-2.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 py-1.5 min-w-[160px] rounded-lg border border-[#1a1f2e] bg-[#0d1117]/95 backdrop-blur-xl shadow-xl shadow-black/40 z-50">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="block px-3 py-1.5 text-[0.65rem] sm:text-[0.7rem] font-semibold text-[#78909c] hover:text-[#00e676] hover:bg-[#141b24] transition-all duration-100 whitespace-nowrap font-mono tracking-wider"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NavBar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const chainsItems: DropdownItem[] = [
    { label: "SOL", to: "/chains/solana" },
    { label: "XRP", to: "/chains/xrp" },
    { label: "TRX", to: "/chains/tron" },
    { label: "ATOM", to: "/chains/cosmos" },
    { label: "All Chains", to: "/chains" },
  ];

  const toolsItems: DropdownItem[] = [
    { label: "ARB", to: "/arbitrage" },
    { label: "BACK", to: "/backtesting" },
    { label: "GAS", to: "/gas" },
    { label: "ALRT", to: "/alerts" },
    { label: "RISK", to: "/risk" },
    { label: "CTRCT", to: "/contracts" },
  ];

  const moreItems: DropdownItem[] = [
    { label: "PORT", to: "/portfolio" },
    { label: "SEND", to: "/withdraw" },
    { label: "DEPO", to: "/deposit" },
    { label: "STAKE", to: "/stake" },
    { label: "VAULT", to: "/vault" },
    { label: "CHAT", to: "/chat" },
    { label: "AGENTS", to: "/agents" },
    { label: "ANALYTICS", to: "/analytics" },
    { label: "NET", to: "/network" },
    { label: "TRAIN", to: "/training" },
    { label: "CFG", to: "/settings" },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="glass-nav">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-2.5">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group shrink-0">
            <span className="text-xl font-black text-[#00e676] font-mono">{">"}</span>
            <span className="text-lg font-bold text-[#e0e6ed] group-hover:text-[#00e676] transition-colors hidden sm:inline font-mono tracking-tight">
              PĂUN_AI
            </span>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-0.5">
            <NavLink to="/">HOME</NavLink>
            <NavLink to="/dashboard">DASH</NavLink>
            <NavLink to="/swap">SWAP</NavLink>
            <NavLink to="/earn">EARN</NavLink>
            <NavLink to="/trade">TRADE</NavLink>
            <NavDropdown label="CHAINS" items={chainsItems} />
            <NavDropdown label="TOOLS" items={toolsItems} />
            <NavDropdown label="MORE" items={moreItems} />
          </div>

          {/* Right side */}
          <div className="shrink-0 ml-2 flex items-center gap-1">
            <ChainSelector />
            <DemoModeToggle />
            <AlertBell />
            <ConnectButton />

            {/* Mobile hamburger */}
            <button
              className="md:hidden ml-1 p-1.5 rounded text-[#546e7a] hover:text-[#00e676] hover:bg-[#0d1117] transition-colors"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[#1a1f2e] bg-[#080a0f]/98 backdrop-blur-xl">
            <div className="px-4 py-3 flex flex-col gap-0.5 max-h-[70vh] overflow-y-auto">
              <MobileNavLink to="/" onClick={() => setMobileOpen(false)}>HOME</MobileNavLink>
              <MobileNavLink to="/dashboard" onClick={() => setMobileOpen(false)}>DASH</MobileNavLink>
              <MobileNavLink to="/swap" onClick={() => setMobileOpen(false)}>SWAP</MobileNavLink>
              <MobileNavLink to="/earn" onClick={() => setMobileOpen(false)}>EARN</MobileNavLink>
              <MobileNavLink to="/trade" onClick={() => setMobileOpen(false)}>TRADE</MobileNavLink>
              <MobileSection>CHAINS</MobileSection>
              {chainsItems.map((item) => (
                <MobileNavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} indent>
                  {item.label}
                </MobileNavLink>
              ))}
              <MobileSection>TOOLS</MobileSection>
              {toolsItems.map((item) => (
                <MobileNavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} indent>
                  {item.label}
                </MobileNavLink>
              ))}
              <MobileSection>MORE</MobileSection>
              {moreItems.map((item) => (
                <MobileNavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} indent>
                  {item.label}
                </MobileNavLink>
              ))}
            </div>
          </div>
        )}
      </nav>
      {/* Animated gradient line — green→cyan pulse */}
      <div className="nav-glow-bar"></div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="nav-link px-2 py-1.5 rounded text-[0.65rem] sm:text-xs font-semibold text-[#546e7a] hover:text-[#00e676] hover:bg-[#0d1117] transition-all duration-150 whitespace-nowrap font-mono tracking-wider"
      activeOptions={{ exact: false }}
      activeProps={{ className: "!text-[#00e676] !bg-[#0d1117] border border-[#1a1f2e]" }}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({ to, children, onClick, indent }: { to: string; children: ReactNode; onClick: () => void; indent?: boolean }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`block py-2 text-xs font-semibold text-[#78909c] hover:text-[#00e676] hover:bg-[#0d1117] rounded transition-colors font-mono tracking-wider ${indent ? "pl-6" : ""}`}
    >
      {children}
    </Link>
  );
}

function MobileSection({ children }: { children: ReactNode }) {
  return (
    <div className="py-1.5 text-[0.6rem] font-bold text-[#546e7a] font-mono tracking-[0.15em] border-t border-[#1a1f2e] mt-1 pt-2">
      {children}
    </div>
  );
}

/* ── Demo Mode Toggle ─────────────────────────────────────────────── */

function DemoModeToggle() {
  const [mounted, setMounted] = useState(false);
  const [demo, setDemo] = useState(true);

  useEffect(() => {
    setMounted(true);
    setDemo(isDemoMode());
  }, []);

  if (!mounted) return null;

  return (
    <button
      onClick={toggleDemo}
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold font-mono transition-all duration-200 flex items-center gap-1.5 ${
        demo
          ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
          : "border-gray-500/30 bg-dark-hover text-gray-400 hover:border-gray-400/50"
      }`}
      title={demo ? "Demo Mode ON — Click to switch to Live" : "Live Mode — Click to switch to Demo"}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${demo ? "bg-yellow-400 animate-pulse" : "bg-gray-500"}`} />
      <span className="hidden sm:inline">{demo ? "DEMO" : "LIVE"}</span>
    </button>
  );
}

/* ── Demo Banner ──────────────────────────────────────────────────── */

function DemoBanner() {
  const [mounted, setMounted] = useState(false);
  const [demo, setDemo] = useState(true);

  useEffect(() => {
    setMounted(true);
    setDemo(isDemoMode());
  }, []);

  if (!mounted || !demo) return null;

  return (
    <div className="fixed top-[52px] left-0 right-0 z-40 flex items-center justify-center gap-2 px-4 py-1.5 bg-yellow-500/15 border-b border-yellow-500/30 backdrop-blur-sm">
      <span className="text-yellow-400 text-xs font-mono font-semibold animate-pulse">⚠️</span>
      <span className="text-yellow-300 text-xs font-mono font-medium">
        DEMO MODE — Simulation only. No real funds.
      </span>
      <span className="text-yellow-400 text-xs font-mono font-semibold animate-pulse">⚠️</span>
    </div>
  );
}

/* ── Footer ───────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-[#1a1f2e] bg-[#080a0f]/95 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-mono text-[#546e7a]">
          <span className="text-[#00e676] font-bold">{">"}</span>
          <span>© {new Date().getFullYear()} PĂUN_AI — All rights reserved.</span>
        </div>
        <div className="flex items-center gap-6 text-xs font-mono text-[#546e7a]">
          <span className="flex items-center gap-1.5">
            <span className="status-dot-online"></span>
            SYS:OPERATIONAL
          </span>
          <span className="hidden sm:inline">v3.0.0-terminal</span>
        </div>
      </div>
    </footer>
  );
}

/* ── Root Document ────────────────────────────────────────────────── */

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="relative bg-[#080a0f]">
        <ParticleField />
        <div
          className="fixed inset-0 pointer-events-none"
          style={{ zIndex: 2 }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
