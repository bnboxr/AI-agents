import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { CHAINS } from "~/lib/chains";
import { AGENTS } from "~/lib/agents";
import { COMMON_TOKENS } from "~/lib/web3";

interface SearchResult {
  type: 'chain' | 'token' | 'agent' | 'page';
  label: string;
  subtitle: string;
  url: string;
  icon: string;
}

const ALL_RESULTS: SearchResult[] = [
  // Pages
  { type: 'page', label: 'Home', subtitle: 'DeFi Command Center', url: '/', icon: '🏠' },
  { type: 'page', label: 'Swap', subtitle: 'Cross-chain token swap', url: '/swap', icon: '🔄' },
  { type: 'page', label: 'Earn', subtitle: 'Yield farming & staking', url: '/earn', icon: '💸' },
  { type: 'page', label: 'Stake', subtitle: 'Auto-staking cu best APY', url: '/stake', icon: '⚡' },
  { type: 'page', label: 'Vault', subtitle: 'Time-locked vault cu auto-compound', url: '/vault', icon: '🏦' },
  { type: 'page', label: 'Agents', subtitle: '20 AI agents monitoring chains', url: '/agents', icon: '🤖' },
  { type: 'page', label: 'Portfolio', subtitle: 'Your portfolio dashboard', url: '/portfolio', icon: '📊' },
  { type: 'page', label: 'Send', subtitle: 'Send tokens', url: '/withdraw', icon: '📤' },
  { type: 'page', label: 'Arbitrage', subtitle: 'Cross-chain arbitrage scanner', url: '/arbitrage', icon: '🔍' },
  { type: 'page', label: 'Chains', subtitle: '20 blockchain networks', url: '/chains', icon: '🔗' },
  { type: 'page', label: 'Contracts', subtitle: 'Smart contracts', url: '/contracts', icon: '📜' },
  // Chains
  ...CHAINS.map(c => ({
    type: 'chain' as const,
    label: c.name,
    subtitle: `${c.nativeToken} • ${c.type.toUpperCase()}`,
    url: `/chains/${c.id}`,
    icon: '🔗',
  })),
  // Agents
  ...Object.entries(AGENTS).map(([chainId, agent]) => ({
    type: 'agent' as const,
    label: agent.name,
    subtitle: `${agent.role} — ${chainId}`,
    url: `/agents?selected=${chainId}`,
    icon: agent.icon,
  })),
  // Tokens
  ...Object.entries(COMMON_TOKENS).map(([_, token]) => ({
    type: 'token' as const,
    label: token.symbol,
    subtitle: token.name,
    url: `/swap?token=${token.symbol}`,
    icon: '🪙',
  })),
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return ALL_RESULTS.filter(r =>
      r.label.toLowerCase().includes(q) ||
      r.subtitle.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      setOpen(false);
      window.location.href = results[selectedIndex].url;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white card transition-colors flex items-center gap-2"
        title="Search (⌘K)"
      >
        <span>🔍</span>
        <span className="hidden lg:inline">Search...</span>
        <span className="hidden lg:inline text-[0.6rem] text-gray-500 bg-dark-border px-1 py-0.5 rounded">⌘K</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
          <div
            className="relative w-full max-w-lg glass-modal p-0 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-border">
              <span className="text-gray-400">🔍</span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search chains, tokens, agents, pages..."
                className="flex-1 bg-transparent text-white text-sm placeholder-gray-400 outline-none"
              />
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded"
              >
                ESC
              </button>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto py-2">
              {query && results.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400">
                  <p className="text-sm">No results found</p>
                </div>
              ) : query && results.length > 0 ? (
                results.map((result, idx) => (
                  <a
                    key={`${result.type}-${result.label}`}
                    href={result.url}
                    onClick={(e) => {
                      e.preventDefault();
                      setOpen(false);
                      window.location.href = result.url;
                    }}
                    className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                      idx === selectedIndex ? 'bg-dark-hover' : ''
                    }`}
                  >
                    <span className="text-lg">{result.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{result.label}</p>
                      <p className="text-xs text-gray-400 truncate">{result.subtitle}</p>
                    </div>
                    <span className="badge-blue text-[0.55rem]">{result.type}</span>
                  </a>
                ))
              ) : (
                <div className="px-4 py-2">
                  <p className="text-xs text-gray-400 px-1 mb-1">Quick Links</p>
                  {[
                    { label: 'Staking', url: '/stake', icon: '⚡' },
                    { label: 'Vault', url: '/vault', icon: '🏦' },
                    { label: 'Agents', url: '/agents', icon: '🤖' },
                    { label: 'Swap', url: '/swap', icon: '🔄' },
                    { label: 'Portfolio', url: '/portfolio', icon: '📊' },
                  ].map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      onClick={(e) => {
                        e.preventDefault();
                        setOpen(false);
                        window.location.href = link.url;
                      }}
                      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-dark-hover transition-colors"
                    >
                      <span>{link.icon}</span>
                      <span className="text-sm text-gray-300">{link.label}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-dark-border flex items-center justify-between text-[0.6rem] text-gray-400">
              <span>↑↓ Navigate</span>
              <span>↵ Open</span>
              <span>ESC Close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
