import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  Link,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WalletProvider, ConnectButton } from "~/components/WalletProvider";
import AlertBell from "~/components/AlertBell";
import AlertToast from "~/components/AlertToast";
import HelpGuide from "~/components/HelpGuide";
import ParticleField from "~/components/ParticleField";

import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Păun AI — DeFi Command Center" },
      { name: "description", content: "Multi-chain DeFi platform. Swap, earn yield, and manage your portfolio across 20+ blockchains." },
      { name: "theme-color", content: "#000000" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-dvh items-center justify-center bg-darker">
      <div className="glass-card p-12 text-center max-w-md">
        <h1 className="text-6xl font-black text-gradient-blue mb-4">404</h1>
        <p className="text-gray-400 text-lg">Page not found</p>
        <Link to="/" className="mt-6 inline-block text-accent-blue hover:text-accent-cyan transition-colors">
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

function NavBar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-darker/95 border-b border-dark-border" style={{ backdropFilter: 'blur(16px)' }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-3">
        <Link to="/" className="flex items-center gap-2 group shrink-0">
          <span className="text-xl">🦚</span>
          <span className="text-lg font-bold text-white group-hover:text-accent-blue transition-colors hidden sm:inline">
            Păun AI
          </span>
        </Link>
        <div className="flex items-center gap-0.5 overflow-x-auto">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/swap">Swap</NavLink>
          <NavLink to="/earn">Earn</NavLink>
          <NavLink to="/portfolio">Portfolio</NavLink>
          <NavLink to="/withdraw">Send</NavLink>
          <NavLink to="/arbitrage">Arbitrage</NavLink>
          <NavLink to="/chains">Chains</NavLink>
          <NavLink to="/contracts">Contracts</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          <NavLink to="/deposit">Deposit</NavLink>
          <NavLink to="/trade">Trade</NavLink>
          <NavLink to="/chat">Chat</NavLink>
          <NavLink to="/risk">Risk</NavLink>
          <NavLink to="/backtesting">Backtesting</NavLink>
          <NavLink to="/gas">Gas</NavLink>
          <NavLink to="/alerts">Alerts</NavLink>
        </div>
        <div className="shrink-0 ml-2 flex items-center gap-1">
          <AlertBell />
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="px-2.5 py-1.5 rounded-md text-xs sm:text-sm font-medium text-gray-400 hover:text-white hover:bg-dark-hover transition-all duration-150 whitespace-nowrap"
      activeProps={{ className: "text-white bg-dark-border" }}
      inactiveProps={{}}
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="border-t border-dark-border bg-darker">
      <div className="mx-auto max-w-7xl px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="text-base">🦚</span>
          <span>© {new Date().getFullYear()} Păun AI. All rights reserved.</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="status-dot-online"></span>
            System Operational
          </span>
        </div>
      </div>
    </footer>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-darker relative">
        <ParticleField />
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 2, background: "radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.03) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(6,182,212,0.03) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(139,92,246,0.03) 0%, transparent 50%)" }} />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
