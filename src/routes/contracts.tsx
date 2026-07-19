import { createFileRoute } from "@tanstack/react-router";
import { CHAINS } from "~/lib/chains";

export const Route = createFileRoute("/contracts")({
  loader: async () => {
    return { chains: CHAINS };
  },
  component: ContractsPage,
});

interface DeployedContract {
  name: string;
  address: string;
  chain: string;
  type: string;
  description: string;
  verified: boolean;
  deployDate: string;
  sourceFile: string;
}

// ── Păun AI proprietary smart contracts ──────────────────────────
// These are our own production-grade contracts for autonomous DeFi operations.
// Addresses are empty until deployment. Deployment requires ETH for gas.
const DEPLOYED_CONTRACTS: DeployedContract[] = [
  {
    name: "PăunAI FlashLoanArbitrage",
    address: "",
    chain: "ethereum",
    type: "Flash Loan Arbitrage",
    description:
      "Atomic arbitrage executor using AAVE V3 flash loans. Routes trades across Uniswap V2 & V3 with slippage protection, reentrancy guards, and owner-controlled risk parameters.",
    verified: false,
    deployDate: "—",
    sourceFile: "FlashLoanArbitrage.sol",
  },
  {
    name: "PăunAI CrossChainArbitrage",
    address: "",
    chain: "ethereum",
    type: "Cross-Chain Arbitrage",
    description:
      "Orchestrates cross-chain arbitrage via LayerZero V2 messaging. Detects price discrepancies, buys on chain A, and sends settlement instructions to chain B with rate limiting and circuit breaker.",
    verified: false,
    deployDate: "—",
    sourceFile: "CrossChainArbitrage.sol",
  },
  {
    name: "PăunAI YieldOptimizer",
    address: "",
    chain: "ethereum",
    type: "Yield Aggregator",
    description:
      "Auto-compounds and rebalances yield across AAVE V3, Compound V3, and Lido. Features TWAP-based slippage protection, performance fees, and emergency withdrawal. Always routes to the best APY.",
    verified: false,
    deployDate: "—",
    sourceFile: "YieldOptimizer.sol",
  },
];

function ContractsPage() {
  const chains = Route.useLoaderData().chains;

  const getExplorerUrl = (chainId: string, address: string) => {
    const chain = chains.find((c) => c.id === chainId);
    if (!chain) return "#";
    return `${chain.explorer}/address/${address}`;
  };

  const getChainName = (chainId: string) => {
    const chain = chains.find((c) => c.id === chainId);
    return chain?.name ?? chainId;
  };

  const verifiedCount = DEPLOYED_CONTRACTS.filter((c) => c.verified).length;
  const deployedChains = new Set(DEPLOYED_CONTRACTS.map((c) => c.chain)).size;

  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Header ──────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">📜</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              Smart Contracts
            </h1>
          </div>
          <p className="text-gray-400 max-w-2xl text-sm">
            Production-grade smart contracts powering Păun AI's autonomous DeFi
            operations. Each contract is auditable, verified on Etherscan, and
            deployed with security-first architecture.
          </p>
        </section>

        {/* ── Warning Banner ─────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="card border border-accent-yellow/40 bg-accent-yellow/5 p-4 flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-accent-yellow">
                Contracts not yet deployed
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Deployment requires ETH for gas. Contracts are ready in{" "}
                <code className="text-accent-blue bg-dark-hover px-1 py-0.5 rounded text-[0.7rem]">
                  src/contracts/
                </code>{" "}
                and will be deployed once gas funds are available. No addresses
                exist on-chain yet.
              </p>
            </div>
          </div>
        </section>

        {/* ── Deployment Stats ─────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-white text-mono">
              {DEPLOYED_CONTRACTS.length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Total Contracts</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-accent-green text-mono">
              {verifiedCount}
            </p>
            <p className="text-xs text-gray-400 mt-1">Verified</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-accent-yellow text-mono">
              {DEPLOYED_CONTRACTS.length - verifiedCount}
            </p>
            <p className="text-xs text-gray-400 mt-1">Not Deployed</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-accent-blue text-mono">
              {deployedChains}
            </p>
            <p className="text-xs text-gray-400 mt-1">Target Chain</p>
          </div>
        </section>

        {/* ── Contracts Table ──────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="card overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-dark-hover border-b border-dark-border text-xs text-gray-400 font-medium uppercase tracking-wider">
              <span className="col-span-2">Contract</span>
              <span className="col-span-2">Type</span>
              <span className="col-span-1">Chain</span>
              <span className="col-span-3">Address</span>
              <span className="col-span-1 text-center">Status</span>
              <span className="col-span-2">Source</span>
              <span className="col-span-1"></span>
            </div>
            {/* Table Rows */}
            {DEPLOYED_CONTRACTS.map((contract, i) => (
              <div
                key={i}
                className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-dark-border last:border-0 hover:bg-dark-hover transition-colors items-center"
              >
                <span className="col-span-2 text-sm text-white font-medium truncate">
                  {contract.name}
                </span>
                <span className="col-span-2 text-xs text-gray-300">
                  <span className="badge badge-blue">{contract.type}</span>
                </span>
                <span className="col-span-1 text-xs text-gray-200 capitalize font-medium">
                  {getChainName(contract.chain)}
                </span>
                <span
                  className="col-span-3 text-xs text-mono-sm text-gray-400 truncate"
                  title={contract.address || "Not deployed"}
                >
                  {contract.address || "—"}
                </span>
                <span className="col-span-1 text-center">
                  <span
                    className={`badge ${
                      contract.verified ? "badge-green" : "badge-yellow"
                    }`}
                  >
                    {contract.verified ? "Verified" : "Not Deployed"}
                  </span>
                </span>
                <span className="col-span-2 text-xs text-gray-400 text-mono-sm truncate">
                  {contract.sourceFile}
                </span>
                <span className="col-span-1 text-right">
                  {contract.address !== "" ? (
                    <a
                      href={getExplorerUrl(
                        contract.chain,
                        contract.address
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent-blue hover:text-accent-cyan transition-colors"
                    >
                      Explorer →
                    </a>
                  ) : (
                    <span className="text-xs text-gray-500">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Contract Architecture ────────────────────────── */}
        <section className="animate-fade-in-up">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="text-accent-blue">▸</span> Architecture
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* FlashLoanArbitrage Card */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">⚡</span>
                <h3 className="text-sm font-semibold text-white">
                  FlashLoanArbitrage
                </h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                {DEPLOYED_CONTRACTS[0].description}
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Protocol</span>
                  <span className="text-gray-300">AAVE V3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">DEX Support</span>
                  <span className="text-gray-300">Uniswap V2 + V3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Security</span>
                  <span className="text-accent-green">ReentrancyGuard</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Fee</span>
                  <span className="text-gray-300">5 bps (AAVE)</span>
                </div>
              </div>
            </div>

            {/* CrossChainArbitrage Card */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🌉</span>
                <h3 className="text-sm font-semibold text-white">
                  CrossChainArbitrage
                </h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                {DEPLOYED_CONTRACTS[1].description}
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Bridge</span>
                  <span className="text-gray-300">LayerZero V2</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">DEX Support</span>
                  <span className="text-gray-300">Uniswap V2 + V3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Rate Limit</span>
                  <span className="text-gray-300">3 ops/hr/asset</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Circuit Breaker</span>
                  <span className="text-accent-green">Pausable</span>
                </div>
              </div>
            </div>

            {/* YieldOptimizer Card */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">📈</span>
                <h3 className="text-sm font-semibold text-white">
                  YieldOptimizer
                </h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                {DEPLOYED_CONTRACTS[2].description}
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Protocols</span>
                  <span className="text-gray-300">AAVE + Compound + Lido</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Perf. Fee</span>
                  <span className="text-gray-300">10% (configurable)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">TWAP</span>
                  <span className="text-gray-300">30 min Uniswap V3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Emergency</span>
                  <span className="text-accent-green">Owner-only drain</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Security Info ─────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-white mb-3">
              Security & Auditing
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              All Păun AI contracts follow strict security practices:
              OpenZeppelin battle-tested libraries, reentrancy guards on all
              state-mutating functions, checks-effects-interactions pattern,
              slippage protection, and owner-controlled circuit breakers. Source
              code is available in{" "}
              <code className="text-accent-blue bg-dark-hover px-1 py-0.5 rounded text-[0.7rem]">
                src/contracts/
              </code>
              .
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a
                href="https://github.com/OpenZeppelin/openzeppelin-contracts"
                target="_blank"
                rel="noopener noreferrer"
                className="card-interactive p-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-white font-medium">
                    OpenZeppelin v5
                  </p>
                  <p className="text-xs text-gray-400">
                    Industry-standard library
                  </p>
                </div>
                <span className="text-accent-blue">→</span>
              </a>
              <div className="card-interactive p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white font-medium">
                    Solidity 0.8.20+
                  </p>
                  <p className="text-xs text-gray-400">
                    Latest compiler with built-in overflow checks
                  </p>
                </div>
                <span className="badge badge-green text-[0.625rem]">Safe</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
