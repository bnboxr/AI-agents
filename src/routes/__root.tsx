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

function NavBar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="glass-nav">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-2.5">
          <Link to="/" className="flex items-center gap-2 group shrink-0">
            <span className="text-xl font-black text-[#00e676] font-mono">{">"}</span>
            <span className="text-lg font-bold text-[#e0e6ed] group-hover:text-[#00e676] transition-colors hidden sm:inline font-mono tracking-tight">
              PĂUN_AI
            </span>
          </Link>
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
            <NavLink to="/dashboard">DASH</NavLink>
            <NavLink to="/">HOME</NavLink>
            <NavLink to="/swap">SWAP</NavLink>
            <NavLink to="/earn">EARN</NavLink>
            <NavLink to="/portfolio">PORT</NavLink>
            <NavLink to="/withdraw">SEND</NavLink>
            <NavLink to="/arbitrage">ARB</NavLink>
            <NavLink to="/chains">CHAINS</NavLink>
            <NavLink to="/chains/solana">SOL</NavLink>
            <NavLink to="/contracts">CTRCT</NavLink>
            <NavLink to="/settings">CFG</NavLink>
            <NavLink to="/deposit">DEPO</NavLink>
            <NavLink to="/trade">TRADE</NavLink>
            <NavLink to="/chat">CHAT</NavLink>
            <NavLink to="/risk">RISK</NavLink>
            <NavLink to="/backtesting">BACK</NavLink>
            <NavLink to="/gas">GAS</NavLink>
            <NavLink to="/alerts">ALRT</NavLink>
            <NavLink to="/training">TRAIN</NavLink>
            <NavLink to="/network">NET</NavLink>
          </div>
          <div className="shrink-0 ml-2 flex items-center gap-1">
            <ChainSelector />
            <AlertBell />
            <ConnectButton />
          </div>
        </div>
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
      activeProps={{ className: "text-[#00e676] bg-[#0d1117] border border-[#1a1f2e]" }}
      inactiveProps={{}}
    >
      {children}
    </Link>
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
