import { useState, useEffect, useCallback, useRef } from "react";

type TabId =
  | "quickstart"
  | "pages"
  | "glossary"
  | "faq"
  | "tips";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "quickstart", label: "Quick Start" },
  { id: "pages", label: "Pages" },
  { id: "glossary", label: "Glossary" },
  { id: "faq", label: "FAQ" },
  { id: "tips", label: "Tips" },
];

export default function HelpGuide() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("quickstart");
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    },
    [open],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll when panel is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        open &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        // Don't close if clicking the trigger button (it toggles)
        const trigger = document.getElementById("help-guide-trigger");
        if (trigger && trigger.contains(e.target as Node)) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <>
      {/* Floating Trigger Button */}
      <button
        id="help-guide-trigger"
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-[100] w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl bg-gradient-to-br from-blue-900/80 to-blue-950/80 border border-blue-500/20 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_20px_rgba(59,130,246,0.15)] hover:border-blue-400/40 hover:shadow-[0_4px_24px_rgba(0,0,0,0.5),0_0_30px_rgba(59,130,246,0.25)] transition-all duration-300 animate-glow-pulse cursor-pointer"
        aria-label="Open help guide"
        style={{
          boxShadow: open
            ? "0 4px 24px rgba(0,0,0,0.5), 0 0 35px rgba(59,130,246,0.3)"
            : undefined,
        }}
      >
        <span className="drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]">
          ?
        </span>
      </button>

      {/* Overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[101] bg-black/50 backdrop-blur-sm transition-opacity duration-300"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 z-[102] h-full w-full max-w-[400px] flex flex-col bg-gradient-to-br from-[#0d1123]/98 to-[#0a1628]/98 border-l border-blue-500/15 backdrop-blur-2xl shadow-[0_0_60px_rgba(0,0,0,0.6),-4px_0_40px_rgba(59,130,246,0.05)] transform transition-transform duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/10 shrink-0">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">🦚</span>
            <span className="text-gradient-blue">Păun AI Guide</span>
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close help guide"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-blue-500/10 shrink-0 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-200 cursor-pointer relative ${
                activeTab === tab.id
                  ? "text-white after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded after:bg-gradient-to-r after:from-accent-blue after:to-accent-cyan"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === "quickstart" && <QuickStartTab />}
          {activeTab === "pages" && <PagesTab />}
          {activeTab === "glossary" && <GlossaryTab />}
          {activeTab === "faq" && <FAQTab />}
          {activeTab === "tips" && <TipsTab />}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-blue-500/10 shrink-0 flex items-center gap-2 text-xs text-gray-400">
          <span className="status-dot-online"></span>
          <span>Press ESC to close</span>
        </div>
      </div>

      {/* Inline styles for the slide animation */}
      <style>{`
        .duration-400 {
          transition-duration: 400ms;
        }
      `}</style>
    </>
  );
}

/* ─── Tab Content Components ─────────────────────────────────── */

function QuickStartTab() {
  const steps = [
    {
      num: "1",
      title: "Connect Wallet",
      desc: "Click Connect Wallet button top-right. Supports MetaMask, WalletConnect, Coinbase, and 25+ more.",
    },
    {
      num: "2",
      title: "Fund Account",
      desc: "Ensure your wallet holds tokens (ETH, USDC, USDT, etc.)",
    },
    {
      num: "3",
      title: "Explore",
      desc: "Use navbar: Swap, Earn, Stake, Portfolio, Agents, Analytics",
    },
    {
      num: "4",
      title: "Start Earning",
      desc: "Deposit into AAVE V3 on Earn page, or stake on Stake page",
    },
    {
      num: "5",
      title: "Let Agents Work",
      desc: "Orchestrator automatically scans 20 blockchains for opportunities",
    },
  ];

  return (
    <div className="space-y-4">
      {steps.map((step) => (
        <div
          key={step.num}
          className="flex gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 hover:border-blue-500/25 transition-all duration-200"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-blue/80 to-accent-cyan/80 flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-[0_0_12px_rgba(59,130,246,0.3)]">
            {step.num}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-0.5">
              {step.title}
            </h4>
            <p className="text-xs text-gray-400 leading-relaxed">{step.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PagesTab() {
  const pages = [
    {
      name: "Home / Dashboard",
      desc: "Portfolio chart, agent feed, chain overview",
    },
    {
      name: "Swap",
      desc: "Trade tokens via Uniswap V3, real-time quotes",
    },
    {
      name: "Earn",
      desc: "Deposit into AAVE V3 pools, earn yield",
    },
    {
      name: "Stake",
      desc: "Stake ETH/SOL/NEAR via Lido, Rocket Pool, Marinade",
    },
    {
      name: "Vault",
      desc: "Time-locked yield vault, 4 tiers (Flex/30d/90d/365d)",
    },
    {
      name: "Portfolio",
      desc: "All token balances with USD values",
    },
    {
      name: "Arbitrage",
      desc: "Flash loan + cross-chain arbitrage monitoring",
    },
    {
      name: "Chains",
      desc: "Real-time status for 20 blockchains",
    },
    {
      name: "Contracts",
      desc: "Smart contracts: FlashLoan, CrossChain, YieldOptimizer, PaunVault",
    },
    {
      name: "Agents",
      desc: "20 AI agents status, one per blockchain",
    },
    {
      name: "Analytics",
      desc: "Profit, gas, TVL charts",
    },
    {
      name: "Settings",
      desc: "API keys for OpenAI, Anthropic, etc.",
    },
    {
      name: "Chat",
      desc: "AI assistant, ask anything about your portfolio",
    },
  ];

  return (
    <div className="space-y-1.5">
      {pages.map((page) => (
        <div
          key={page.name}
          className="p-3 rounded-lg hover:bg-blue-500/5 border border-transparent hover:border-blue-500/10 transition-all duration-200"
        >
          <h4 className="text-sm font-medium text-white">{page.name}</h4>
          <p className="text-xs text-gray-400 mt-0.5">{page.desc}</p>
        </div>
      ))}
    </div>
  );
}

function GlossaryTab() {
  const terms = [
    {
      term: "Agent",
      def: "AI bot scanning one blockchain for opportunities",
    },
    {
      term: "Orchestrator",
      def: "Brain that schedules and coordinates all agents",
    },
    {
      term: "Flash Loan",
      def: "Borrow and repay in one transaction, used for arbitrage",
    },
    {
      term: "APY",
      def: "Annual Percentage Yield from staking/lending",
    },
    {
      term: "Gas",
      def: "Transaction fee on blockchain (paid in native token)",
    },
    {
      term: "AAVE",
      def: "Largest DeFi lending protocol",
    },
    {
      term: "Uniswap V3",
      def: "Decentralized exchange with concentrated liquidity",
    },
    {
      term: "LayerZero",
      def: "Cross-chain messaging protocol",
    },
    {
      term: "EVM",
      def: "Ethereum Virtual Machine (used by ETH, BNB, Polygon, Arbitrum, etc.)",
    },
    {
      term: "Solana / NEAR / Aptos / Sui",
      def: "Non-EVM high-speed blockchains",
    },
  ];

  return (
    <div className="space-y-3">
      {terms.map((t) => (
        <div key={t.term} className="border-b border-blue-500/5 pb-3 last:border-0">
          <h4 className="text-sm font-semibold text-gradient-blue inline">
            {t.term}
          </h4>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">{t.def}</p>
        </div>
      ))}
    </div>
  );
}

function FAQTab() {
  const faqs = [
    {
      q: "Do I need to be online for agents to work?",
      a: "No. Agents run 24/7 on the server.",
    },
    {
      q: "Are my funds safe?",
      a: "You control your wallet keys. Platform never has custody.",
    },
    {
      q: "What chains are supported?",
      a: "20 chains including Ethereum, Solana, BNB, Polygon, Arbitrum, Optimism, Base, Avalanche, and more.",
    },
    {
      q: "How do I add API keys?",
      a: 'Go to Settings page, enter your keys, click Test to verify.',
    },
    {
      q: "Can I talk to the AI?",
      a: 'Yes! Go to Chat and type commands like "scan ethereum" or "what\'s my portfolio worth?"',
    },
  ];

  return (
    <div className="space-y-3">
      {faqs.map((faq, idx) => (
        <div
          key={idx}
          className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10"
        >
          <h4 className="text-sm font-medium text-white">{faq.q}</h4>
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{faq.a}</p>
        </div>
      ))}
    </div>
  );
}

function TipsTab() {
  const tips = [
    'Use Chat to control agents: "scan all chains for arbitrage"',
    "Set API keys in Settings to unlock AI features",
    "Check Analytics daily for profit tracking",
    "Use Vault time-locks for higher APY tiers",
    "Monitor Agents page to see which chains are most active",
  ];

  return (
    <div className="space-y-3">
      {tips.map((tip, idx) => (
        <div
          key={idx}
          className="flex gap-3 p-3 rounded-xl bg-gradient-to-r from-blue-500/5 to-cyan-500/5 border border-blue-500/10 hover:border-blue-500/25 transition-all duration-200"
        >
          <span className="text-accent-cyan text-sm mt-0.5 shrink-0">💡</span>
          <p className="text-sm text-gray-300 leading-relaxed">{tip}</p>
        </div>
      ))}
    </div>
  );
}
