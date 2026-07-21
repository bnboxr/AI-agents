# 🏦 HSMC — AI Hedge Fund OS

> **Autonomous AI-Powered Crypto Hedge Fund Platform**
> 
> 29 agents. 4 LLM engines. Zero human intervention. One orchestrator.

---

## 📋 Table of Contents

1. [Project Overview](#-project-overview)
2. [Architecture](#-architecture)
3. [Technology Stack](#-technology-stack)
4. [Features](#-features)
5. [Deployment](#-deployment)
6. [API Keys & Configuration](#-api-keys--configuration)
7. [Future Roadmap](#-future-roadmap)
8. [Contributing](#-contributing)
9. [License & Credits](#-license--credits)

---

## 🌟 Project Overview

### What Is HSMC?

HSMC (Hedge Fund Operating System) is a fully autonomous **AI-powered crypto trading platform** that operates as a self-running hedge fund. It combines:

- **29 specialized AI agents** that communicate through structured dialogue (not simple scoring)
- **4 simultaneous LLM backends** (OpenAI GPT-4o, DeepSeek, Grok, Gemini) for multi-perspective intelligence
- **22 blockchain integrations** spanning EVM, Solana, XRP Ledger, TRON, Cosmos, NEAR, Aptos, and Sui
- **5-layer architecture**: Intelligence → Analysis → Decision → Execution → Monitoring
- **Real-time market data** via WebSocket feeds from Binance (18 symbols) and CoinGecko API
- **Zero human intervention** — the Master Orchestrator runs the show

### The Problem It Solves

| Problem | HSMC Solution |
|---------|---------------|
| Human emotion in trading | Pure AI decision-making with Devil's Advocate adversarial checking |
| Information overload | 10 Intelligence agents filter and synthesize data |
| Slow reaction to market moves | Real-time WebSocket data + instant agent dispatch |
| Single-model bias | 4 LLMs queried simultaneously; consensus required |
| Risk of catastrophic losses | Multi-layer risk engine with circuit breakers, kill switch, anti-drain |
| Manual DeFi management | Autonomous LP compounding, airdrop farming, copy trading |

### The Vision

HSMC aims to be the operating system for autonomous capital deployment — a platform where AI agents handle every aspect of crypto trading and yield generation, from market intelligence to execution to risk management, without requiring a single human click.

---

## 🏗 Architecture

### The 5-Level Intelligence Pipeline

```
                         ┌─────────────────┐
                         │ MASTER          │
                         │ ORCHESTRATOR    │
                         │   +             │
                         │ DEVIL'S ADVOCATE│
                         └────────┬────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
    ┌─────▼─────┐          ┌─────▼─────┐          ┌─────▼─────┐
    │  LEVEL 0  │          │  LEVEL 3  │          │  LEVEL 4  │
    │ MARKET    │          │ DECISION  │          │ EXECUTION │
    │ DATA CORE │          │           │          │ 7 AGENTS  │
    └───────────┘          └───────────┘          └───────────┘
          │
    ┌─────▼─────┐    ┌───────────┐
    │  LEVEL 1  │    │  LEVEL 2  │
    │INTELLIGENCE│───▶│ ANALYSIS  │
    │ 10 AGENTS │    │ 8 AGENTS  │
    └───────────┘    └───────────┘
```

#### Level 0: Market Data Core
Raw data ingestion from multiple sources:
- **Binance WebSocket** — 18 live trading pairs (BTC, ETH, SOL, BNB, ADA, DOT, etc.)
- **Bybit** — Perpetual futures data
- **CoinGecko API** — Broad market data, Fear & Greed Index
- **On-chain data** — Wallet tracking, transaction monitoring
- **News feeds** — Crypto news headlines with sentiment scoring
- **Social signals** — Social media trend aggregation

#### Level 1: Intelligence (10 Agents)
These agents observe the market and collect raw signals:

| Agent | Display Name | Role | Description |
|-------|-------------|------|-------------|
| **Market Analysis** | MARKET 📈 | Intelligence | Reads price action, trend structure, momentum (5m–1h timeframes) |
| **Technical Analysis** | TECHNICAL 📊 | Intelligence | Computes RSI, MACD, EMA crossovers, Bollinger Bands, 20+ indicators |
| **Sentiment Agent** | SENTIMENT 💬 | Intelligence | Fear & Greed Index, social media sentiment, crowd psychology |
| **News Agent** | NEWS 📰 | Intelligence | Processes headlines, scores sentiment, detects market-moving events |
| **Macro Analysis** | MACRO 🌍 | Intelligence | Monitors interest rates, DXY, inflation data, global correlations |
| **Pattern Recognition** | PATTERN 🔍 | Intelligence | Detects chart patterns (head & shoulders, flags, wedges, etc.) |
| **Smart Money** | SMART MONEY 🐋 | Intelligence | Tracks whale wallets, large transfers, institutional flows |
| **Liquidity Agent** | LIQUIDITY 💧 | Intelligence | Monitors order book depth, slippage, liquidity pools |
| **Regime Detection** | REGIME 🔄 | Intelligence | Identifies market regimes: trending, ranging, volatile, accumulation |
| **Multi-Timeframe** | MULTI-TF ⏰ | Intelligence | Correlates signals across 5m, 15m, 1h, 4h, daily timeframes |

#### Level 2: Analysis (8 Agents)
These agents process intelligence signals into actionable probabilities:

| Agent | Display Name | Role | Description |
|-------|-------------|------|-------------|
| **Correlation Agent** | CORRELATION 🔗 | Analysis | Cross-asset correlation analysis, pair trading signals |
| **Volume Agent** | VOLUME 📊 | Analysis | Volume profile analysis, VWAP, accumulation/distribution |
| **Probability Agent** | PROBABILITY 🎲 | Analysis | Bayesian probability scoring, Monte Carlo simulations |
| **Confidence Agent** | CONFIDENCE ✅ | Analysis | Confidence interval estimation, signal reliability scoring |
| **Reasoning Agent** | REASONING 🧠 | Analysis | Logical chain-of-thought analysis, explainable AI decisions |
| **Portfolio Agent** | PORTFOLIO 💼 | Analysis | Portfolio allocation, rebalancing signals, diversification |

Plus 2 additional analysis agents handling optimization and signal routing internally.

#### Level 3: Decision
The **Master Orchestrator** + **Devil's Advocate** form the decision core:

- **Master Orchestrator** 🎯 — The conductor. Queries all 29 agents, synthesizes their reports, asks probing questions, and makes the final call. Operates via a dispatch queue with priority-based scheduling.
  
- **Devil's Advocate** 😈 — The skeptic. Challenges every decision. Forces the Orchestrator to defend its reasoning. If the Orchestrator can't defend convincingly, the trade is blocked.

```typescript
// Decision flow (simplified)
const signals = await gatherAgentSignals(params);
const decision = await orchestrator.proposeTrade(signals);
const challenge = await devilsAdvocate.challengeTrade(decision);
if (!challenge.passed) {
  // Trade blocked — Orchestrator must refine
  return { blocked: true, reason: challenge.reasoning };
}
// Trade approved — proceed to execution
```

#### Level 4: Execution & Monitoring (7 Agents)

| Agent | Display Name | Role | Description |
|-------|-------------|------|-------------|
| **Position Manager** | POSITION MGR 📐 | Execution | Sizes positions, manages leverage, handles order splitting |
| **Execution Agent** | EXECUTION ⚡ | Execution | Routes orders to optimal venue (DEX, CEX), manages slippage |
| **Risk Manager** | RISK MGR 🛡️ | Monitoring | Drawdown limits, stop-losses, exposure caps, kill switch |
| **Learning Agent** | LEARNING 📚 | Monitoring | Learns from outcomes, adjusts weights, discovers patterns |
| **Memory Agent** | MEMORY 💾 | Monitoring | Historical trade recall, similar situation matching |
| **System Audit** | SYS AUDIT 🔬 | Monitoring | Health checks, API connectivity, data integrity |
| **Exit Agent** | EXIT 🚪 | Execution | Manages trade exits, take-profit execution, stop-loss triggers |

### Dialogue, Not Scores

Unlike traditional scoring systems where each agent returns a number and they're averaged, HSMC agents communicate through **structured LLM dialogue**. The Orchestrator asks specific questions; agents respond in natural language with reasoning. The Devil's Advocate cross-examines the response. This produces richer, more nuanced decisions than any numeric scoring system.

### Queue Architecture

```
Scheduler ──▶ Priority Queue ──▶ Dispatcher ──▶ Agent Runner
   │              (FIFO)             │               │
   │          HIGH/NORMAL/LOW        │               │
   └─────────────────────────────────┴───────────────┘
               Feedback loop
```

The **Scheduler** creates scan tasks per chain on configurable intervals. The **Dispatcher** picks from the priority queue and routes to agent runners. Completed tasks feed back into the scheduler for adaptive timing.

---

## 💻 Technology Stack

### Frontend & Orchestration

| Technology | Version | Purpose |
|-----------|---------|---------|
| **TypeScript** | 5.9 | Type-safe language for all application code |
| **React** | 19.2 | UI component library |
| **TanStack Start** | 1.158 | Full-stack React framework (SSR, routing, server functions) |
| **TanStack Router** | 1.158 | Type-safe file-based routing |
| **TanStack React Query** | 5.101 | Server state management and caching |
| **Tailwind CSS** | 4.1 | Utility-first CSS framework |
| **Vite** | 7.3 | Build tool and dev server |
| **Bun** | latest | JavaScript runtime (faster than Node.js) |

### Blockchain & Web3

| Technology | Purpose |
|-----------|---------|
| **viem** | Low-level Ethereum interaction (TypeScript-native) |
| **wagmi** | React hooks for Ethereum wallet connection |
| **@wagmi/core** | Core wagmi primitives |
| **@wagmi/connectors** | Wallet connection adapters (MetaMask, WalletConnect, etc.) |
| **@walletconnect/ethereum-provider** | WalletConnect v2 Ethereum provider |
| **@walletconnect/modal** | QR-code wallet connection modal |
| **ethers.js** | Ethereum wallet generation, BIP39 mnemonic creation |
| **@solana/web3.js** | Solana blockchain interaction |
| **@solana/spl-token** | Solana SPL token support |
| **xrpl** | XRP Ledger interaction library |
| **tronweb** | TRON blockchain interaction |
| **@cosmjs** | Cosmos SDK chain interaction |
| **@noble/hashes** | Cryptographic hashing (SHA-256, SHA-512) |
| **@scure/bip32** | BIP32 HD wallet derivation |
| **bip39** | BIP39 mnemonic generation (12/24 words) |
| **ed25519-hd-key** | Ed25519 key derivation for Solana |

### AI & LLM

| Provider | Model | API Endpoint |
|----------|-------|-------------|
| **OpenAI** | GPT-4o | `https://api.openai.com/v1/chat/completions` |
| **DeepSeek** | deepseek-chat | `https://api.deepseek.com/v1/chat/completions` |
| **Grok (xAI)** | grok-2 | `https://api.x.ai/v1/chat/completions` |
| **Gemini (Google)** | gemini-pro | `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent` |

All 4 LLMs are queried **simultaneously**. The system takes the fastest valid response, computes consensus across providers, and uses multi-provider redundancy for reliability.

### Data Storage

| Technology | Purpose |
|-----------|---------|
| **Neon PostgreSQL** | Serverless Postgres with 11 tables for persistence |
| **In-Memory Maps** | High-performance caching for active positions, risk states |

#### Database Tables

| Table | Purpose |
|-------|---------|
| `trades` | All trade positions (open, closed, cancelled) |
| `agent_reports` | Agent analysis reports with reasoning |
| `risk_states` | Per-agent risk metrics (drawdown, exposure, scores) |
| `risk_system_state` | Global circuit breaker and kill switch state |
| `autonomous_wallet` | Encrypted BIP39 wallet storage |
| `lp_positions` | LP compounding positions |
| `copy_trades` | Copy trading mirror records |
| `nft_trades` | NFT arbitrage paper trades |
| `signals` | Trading signal marketplace records |
| `agent_memory` | Agent learning history |
| `system_events` | System audit log |

### Real-Time Data

| Source | Protocol | Data |
|--------|----------|------|
| **Binance WebSocket** | WSS | 18 symbols live price streaming |
| **Binance REST API** | HTTPS | Historical klines, order book, ticker |
| **CoinGecko API** | HTTPS | Market data, Fear & Greed, trending |
| **DeFiLlama API** | HTTPS | LP pool APY data, TVL |
| **Etherscan API** | HTTPS | Wallet transaction history (copy trading) |
| **Reservoir API** | HTTPS | NFT floor prices, cross-marketplace data |

### Visualization & UI

| Technology | Purpose |
|-----------|---------|
| **React Flow (@xyflow/react)** | Interactive agent network topology graph |
| **Framer Motion** | Smooth animations, transitions, glow effects |
| **Recharts** | Portfolio charts, equity curves, analytics |
| **xterm.js** | Browser-based terminal emulator (PTY shell) |
| **@xterm/addon-fit** | Auto-resize terminal to container |
| **@xterm/addon-web-links** | Clickable links in terminal output |

### Backend Services

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| **Main App** | TypeScript/Bun | 3000 | Full-stack web app, orchestration, WebSocket |
| **Python Backend** | Python/FastAPI | 8001 | Backtesting engine, LSTM predictions, grid search |

### DevOps & Deployment

| Tool | Purpose |
|------|---------|
| **PM2** | Production process manager |
| **systemd** | Alternative process management |
| **deploy.sh** | One-command VPS deployment |
| **go-live.sh** | Vercel production deployment |
| **GitHub** | Source control |

---

## ✨ Features

### 1. 🏦 Autonomous Wallet

A self-custodial wallet generated deterministically using BIP39:

```typescript
// Wallet generation (one-time, idempotent)
const mnemonicEntropy = ethers.randomBytes(16); // 128 bits = 12 words
const mnemonic = ethers.Mnemonic.fromEntropy(mnemonicEntropy).phrase;
const wallet = ethers.Wallet.fromPhrase(mnemonic);
```

**Security features:**
- **AES-256-GCM encryption** for private key and mnemonic at rest
- **Platform-derived encryption key** from `AUTONOMOUS_WALLET_SECRET` env var
- **Neon PostgreSQL storage** with encrypted columns
- **In-memory decryption** — keys only exist in plaintext while in use
- **Public key derivation** via HD wallet path

**Multi-chain support** — The same BIP39 seed derives wallets across:
- Ethereum & all EVM chains (Base, Arbitrum, Polygon, Optimism, etc.)
- Solana (via `ed25519-hd-key` derivation)
- XRP Ledger (via `xrpl` library)
- TRON (via `tronweb`)
- Cosmos (via `@cosmjs`)

### 2. 🔗 22 Blockchain Integrations

| Chain | Type | Native Token | Integration |
|-------|------|-------------|-------------|
| Ethereum | EVM | ETH | viem + wagmi |
| BNB Chain | EVM | BNB | viem + wagmi |
| Polygon | EVM | MATIC | viem + wagmi |
| Arbitrum | EVM | ETH | viem + wagmi |
| Optimism | EVM | ETH | viem + wagmi |
| Base | EVM | ETH | viem + wagmi |
| Avalanche | EVM | AVAX | viem + wagmi |
| Fantom | EVM | FTM | viem + wagmi |
| Gnosis | EVM | XDAI | viem + wagmi |
| zkSync Era | EVM | ETH | viem + wagmi |
| Linea | EVM | ETH | viem + wagmi |
| Scroll | EVM | ETH | viem + wagmi |
| Mantle | EVM | MNT | viem + wagmi |
| Celo | EVM | CELO | viem + wagmi |
| Moonbeam | EVM | GLMR | viem + wagmi |
| **Solana** | Solana | SOL | @solana/web3.js + SPL |
| **Near** | Near | NEAR | RPC integration |
| **Aptos** | Aptos | APT | RPC integration |
| **Sui** | Sui | SUI | RPC integration |
| **TRON** | Tron | TRX | tronweb |
| **XRP Ledger** | XRPL | XRP | xrpl |
| **Cosmos Hub** | Cosmos | ATOM | @cosmjs |

**DEX Adapters** — Dedicated DEX interaction modules for non-EVM chains:
- Solana: Jupiter/Raydium swap routing
- TRON: SunSwap integration
- XRP: XRPL DEX order book
- Cosmos: Osmosis IBC swaps

### 3. 🤖 AI Trading Engine

The core intelligence system powering all trading decisions.

**Multi-Provider LLM Pipeline:**

```typescript
// All 4 LLMs queried simultaneously
const result = await queryAllProviders(messages, {
  temperature: 0.3,
  maxTokens: 300,
  timeoutMs: 10_000,
});

// Returns:
// - response: fastest valid response
// - consensus: most common answer pattern
// - allResults: all responses
// - providerStatuses: health of each LLM
```

**Trading Flow:**
1. Market data ingested (WebSocket live prices)
2. Intelligence agents analyze (10 agents, all LLMs)
3. Analysis agents score probabilities (8 agents)
4. Orchestrator proposes trade direction & size
5. Devil's Advocate challenges the decision
6. Risk engine validates limits (drawdown, exposure, stop-loss)
7. Execution agent routes order to optimal venue
8. Position monitored by risk manager + exit agent

**AI-Powered Chart Analysis:**

```typescript
// GPT-4o analyzes 5-minute price action
const prompt = `You are a professional crypto trader. Analyze this market data:
Chain: ethereum | Price: $3500 | 24h Change: +2.3% | Volume: $12.5B
Decide: LONG / SHORT / HOLD | Confidence: 0-100 | Reasoning: brief explanation`;

// Returns structured JSON decision
```

**Fallback System:** When LLMs are unavailable, a rule-based fallback kicks in using momentum, volatility, and technical indicators.

### 4. 🖥 PTY Terminal

A real bash shell running inside the browser via xterm.js:

```typescript
// Server-side: spawns a real PTY using `script` (util-linux)
const proc = Bun.spawn([
  "script", "-q", "-f", "-c",
  `cd ${WORK_DIR} && exec ${SHELL} --login`,
  "/dev/null",
], {
  stdin: "pipe", stdout: "pipe", stderr: "pipe",
  env: { ...process.env, TERM: "xterm-256color" },
});

// WebSocket bridges the PTY to browser xterm.js
```

**Features:**
- Full bash shell with login environment
- Working directory within the project
- 256-color terminal support
- Auto-resize to container width
- Clickable URLs in output
- WebSocket transport (real-time, low latency)

### 5. 🕸 Agent Network Graph

An interactive, animated visualization of the 29-agent topology using React Flow + Framer Motion:

```
         ┌──────────────────────────────────┐
         │         OUTER RING (22)          │
         │  MARKET  TECHNICAL  SENTIMENT    │
         │  NEWS  MACRO  PATTERN  LIQUIDITY │
         │  SMART$  REGIME  MULTI-TF  CORR  │
         │  VOLUME  PROB  CONF  REASONING   │
         │  SYS AUDIT  EXIT  PORTFOLIO      │
         │       ┌─────────────┐            │
         │       │ INNER RING  │            │
         │       │  POS MGR    │            │
         │       │  EXECUTION  │            │
         │       │  RISK MGR   │            │
         │       │  LEARNING   │            │
         │       │  MEMORY     │            │
         │       │  ┌───────┐  │            │
         │       │  │CENTER │  │            │
         │       │  │ORCHES-│  │            │
         │       │  │TRATOR │  │            │
         │       │  │DEVIL'S│  │            │
         │       │  │ADVOC  │  │            │
         │       │  └───────┘  │            │
         │       └─────────────┘            │
         └──────────────────────────────────┘
```

**Visual features:**
- **Blue glassmorphism theme** with iridescent "peacock neck" effect
- **Animated edges** showing data flow between agents
- **Pulsing glow** on active agents
- **Color-coded by role**: Intelligence (cyan), Analysis (blue), Decision (gold), Execution (green), Monitoring (purple)
- **Click-to-inspect** agent details (role, description, status)
- **LIVE indicator** with connection count and uptime

### 6. 🎮 Demo Mode

Full platform functionality without needing a real wallet:

```typescript
// Toggle demo mode
export function toggleDemo(): void {
  const current = isDemoMode();
  localStorage.setItem(DEMO_KEY, String(!current));
  window.location.reload();
}
```

**What works in demo mode:**
- Full dashboard with simulated portfolio
- Agent network graph (fully interactive)
- Trading interface (paper trades)
- Risk management dashboard
- Charts and analytics
- Swap/stake/deposit/withdraw interfaces
- Chain explorer pages
- Arbitrage scanner
- Backtesting engine
- PTY terminal

**What requires real wallet:**
- Actual on-chain transactions
- Real token balances
- Live trading on exchanges

### 7. 💰 Revenue Channels

The platform can generate revenue through multiple autonomous channels:

#### LP Auto-Compounding
```typescript
// Deposit into liquidity pools, auto-compound rewards
export async function depositLP(pool: LPPosition): Promise<void>
export async function compound(): Promise<void> // Reinvest rewards
export function getLPYield(): LPYieldState
```

- Fetches real APY data from DeFiLlama
- Calculates optimal compound intervals
- Supports multiple DEX protocols
- Auto-harvests and reinvests rewards

#### Copy Trading
```typescript
// Track successful wallets, mirror their trades
export async function followWallet(address: string): Promise<void>
export async function mirrorTrade(tx: EtherscanTx): Promise<void>
export function getTrackedWallets(): TrackedWallet[]
```

- Monitors configurable wallet list (`COPY_TRADE_WALLETS` env)
- Fetches transaction history via Etherscan API
- Replicates trades with configurable position sizing
- Auto-adjusts for gas and slippage

#### NFT Arbitrage
```typescript
// Scan cross-marketplace price differences
export async function scanArbitrage(): Promise<NFTArbitrageOpportunity[]>
export async function fetchFloorPrices(collection: string): Promise<void>
```

- Cross-marketplace floor price comparison (OpenSea, Blur, LooksRare)
- Reservoir API integration for real-time data
- Paper trading mode for testing strategies
- Profit calculation with gas estimation

#### Trading Signal Marketplace
```typescript
// Generate and sell premium trading signals
export async function createSignal(data: SignalData): Promise<TradingSignal>
export function calculateQualityMetrics(): SignalQualityMetrics
```

- AI-generated trading signals with quality metrics
- Signal export (JSON, CSV)
- Premium access gating
- Telegram/Discord bot formatting

### Trading Signals Page (`/signals`)

The **Trading Signals** page is the platform's first live revenue channel. It generates AI-powered daily trading signals and sells premium access via Stripe.

#### Signal Generation

Every day, the signal generator:
1. **Fetches live prices** from CoinGecko for 8 trading pairs (BTC, ETH, SOL, BNB, MATIC, AVAX, LINK, XRP)
2. **Selects the most volatile pair** as the signal target
3. **Runs multi-indicator technical analysis** simulating agent consensus:
   - RSI (14-period) — overbought/oversold detection
   - MACD (12/26/9) — momentum and trend confirmation
   - EMA crossover (12 vs 26) — trend direction
   - SMA-20 vs current price — support/resistance
   - 24h momentum — trend strength
4. **Computes confidence score** from weighted consensus across all indicators
5. **Calculates stop-loss and take-profit** based on volatility (ATR-based)
6. **Caches the result** for 1 hour to respect API rate limits

```typescript
// Signal generation
export async function generateSignal(): Promise<TradingSignal>
export async function getDailySignal(): Promise<TradingSignal | null>
export async function getSignalHistory(limit?: number): Promise<TradingSignal[]>
export function hasUnlockedPremium(sessionId?: string): boolean
```

#### Free Preview & Premium Unlock

The `/signals` page shows a free preview (pair + direction + truncated analysis) with blurred premium content:

```
┌─────────────────────────────────────┐
│  🔒 PREMIUM — Free Preview          │
│  BTC/USDT 🟢 LONG                   │
│  Market shows bullish accumulation  │
│  [UNLOCK FULL SIGNAL — 25 RON]     │
└─────────────────────────────────────┘
```

After payment via Stripe Checkout (`price_1TvhyEDMSAUyHlnSAFC30qKp`), the full signal is revealed:

```
┌─────────────────────────────────────┐
│  🔓 UNLOCKED                        │
│  BTC/USDT 🟢 LONG                   │
│  Entry: $67,420    Stop Loss: $66,800│
│  Take Profit: $69,100               │
│  Confidence: 78%                    │
│  AI Analysis: Multi-indicator...     │
│  [Copy to Clipboard] [Share]        │
└─────────────────────────────────────┘
```

#### Signal History & Performance Tracking

Past signals are displayed in a table with hit/miss tracking:

| Feature | Description |
|---------|-------------|
| **Win Rate** | Percentage of signals that hit take-profit |
| **Signal Table** | All past signals with status, pair, direction, confidence |
| **Performance Stats** | Total signals, hit count, miss count, win rate |
| **Time Ago** | Relative timestamps for each signal |

#### Stripe Integration

- **Price ID**: `price_1TvhyEDMSAUyHlnSAFC30qKp` (25 RON)
- **Checkout**: Redirects to Stripe, returns to `/signals?session_id={CHECKOUT_SESSION_ID}`
- **Unlock State**: Stored in `localStorage` for persistent access
- **Signal Validity**: 24 hours from generation

#### Key Files

| File | Purpose |
|------|---------|
| `src/lib/trading-signals.ts` | Signal generator, daily cache, premium access logic |
| `src/routes/signals.tsx` | Full signals page with preview, unlock, history |
| `src/lib/revenue/trading-data.ts` | Shared signal store, quality metrics, bot formatting |

#### Airdrop Farming
- Automated multi-wallet interaction with new protocols
- Faucet aggregator for testnet tokens
- Gas optimization across chains
- Cooldown tracking and scheduling

### 8. 🛡 Risk Management

A comprehensive, multi-layer risk system:

**Layer 1: Per-Agent Risk Limits**
```typescript
interface RiskLimits {
  maxDrawdownPct: number;         // Default: 20%
  maxExposurePerChain: number;    // Default: $50,000
  stopLossPct: number;            // Default: 10%
  marketCrashThresholdPct: number; // Default: 15% drop in 1h
  maxRiskScore: number;           // 1-10, pause if > 8
}
```

**Layer 2: Circuit Breaker**
- Triggers on market crash (>15% drop in 1 hour)
- Automatically pauses all active agents
- Auto-recovers when market normalizes (<5% drop)
- Manual reset option available

**Layer 3: Kill Switch**
```typescript
// Emergency triggers:
- API unavailable (>60s no data)         → Kill switch
- Corrupt data (price change >50%/tick)  → Kill switch
- Massive spread (>5% bid/ask)           → Kill switch
- Extreme volatility (ATR >5x normal)    → Kill switch
- News shock (sentiment swing >80 pts)   → Kill switch
```

The kill switch:
- Closes all open positions
- Trips circuit breaker
- Pauses all agents
- Requires manual reset
- Logs full context to DB
- Emits alert via agent bus

**Layer 4: Anti-Drain Protection**
```typescript
export function validateTrade(trade: TradeParams): ValidationResult {
  // Check: daily drawdown limit
  // Check: single-trade size limit
  // Check: consecutive loss limit
  // Check: unusual destination address
  // Check: gas fee reasonableness
}
```

**Layer 5: Stop-Loss & Take-Profit**
- Automatic stop-loss at 10% (configurable)
- Take-profit at 10% (configurable)
- Trailing stop support
- Leverage-adjusted calculations

### 9. 📊 Backtesting Engine

A Python-based backtesting system (port 8001) with three strategies:

**Strategies:**
1. **Flash Loan Arbitrage** — Simulates cross-DEX arbitrage with flash loans
2. **Yield Optimizer** — Compares LP yields across protocols
3. **Cross-Chain Arbitrage** — Identifies price discrepancies across chains

**Features:**
- Real historical data from Binance.us API
- Configurable time range (7d, 30d, 90d, 180d, 365d)
- Commission and slippage modeling
- LSTM price predictor for forward testing
- Grid search parameter optimization
- Walk-forward validation (60d train / 20d test)
- Equity curve visualization via Recharts

**Metrics computed:**
```typescript
{
  sharpeRatio: number;      // Risk-adjusted return
  maxDrawdown: number;      // Maximum peak-to-trough (%)
  winRate: number;          // % of winning trades
  totalReturn: number;      // Total return (%)
  profitFactor: number;     // Gross profit / gross loss
  volatility: number;       // Annualized volatility (%)
  totalTrades: number;
  bestTrade: number;
  worstTrade: number;
}
```

### 10. 📱 Platform Pages

The HSMC dashboard includes the following pages:

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Portfolio overview, charts, agent feed |
| `/trade` | Trading | Manual/AI-powered trade execution |
| `/portfolio` | Portfolio | Holdings, P&L breakdown |
| `/swap` | Swap | Token swaps across chains |
| `/stake` | Staking | Stake tokens, view rewards |
| `/vault` | Vault | LP positions, auto-compounding |
| `/earn` | Earn | Yield opportunities, strategies |
| `/arbitrage` | Arbitrage | Cross-chain/DEX arbitrage scanner |
| `/deposit` | Deposit | Fund the autonomous wallet |
| `/withdraw` | Withdraw | Withdraw to external address |
| `/chains` | Chains | Multi-chain explorer hub |
| `/chains/solana` | Solana | Solana-specific explorer |
| `/chains/tron` | TRON | TRON-specific explorer |
| `/chains/xrp` | XRP Ledger | XRPL-specific explorer |
| `/chains/cosmos` | Cosmos | Cosmos-specific explorer |
| `/risk` | Risk Management | Risk dashboard, limits, circuit breakers |
| `/alerts` | Alerts | Alert configuration, notification log |
| `/analytics` | Analytics | Advanced analytics, correlation matrix |
| `/backtesting` | Backtesting | Strategy backtesting interface |
| `/network` | Agent Network | 29-agent topology graph |
| `/chat` | AI Chat | Chat with the AI trading assistant |
| `/settings` | Settings | API keys, preferences, configuration |
| `/gas` | Gas Tracker | Gas prices across chains |
| `/contracts` | Contracts | Smart contract interaction |
| `/training` | Training | Agent training, strategy optimization |

### 11. 🔄 Real-Time WebSocket Market Data

```typescript
// Binance WebSocket — 18 symbols live
const SYMBOLS = [
  "btcusdt", "ethusdt", "solusdt", "bnbusdt",
  "adausdt", "dotusdt", "maticusdt", "avaxusdt",
  "linkusdt", "uniusdt", "atomusdt", "xrpusdt",
  "ltcusdt", "etcusdt", "filusdt", "aptusdt",
  "arbusdt", "opusdt"
];

// Price cache with 5-second staleness threshold
export function getPrice(symbol: string): number | null
```

### 12. 📈 Technical Indicators

Built-in TypeScript technical indicators:

```typescript
export {
  calculateRSI,        // Relative Strength Index (14-period)
  calculateMACD,       // MACD (12, 26, 9)
  calculateEMA,        // Exponential Moving Average
  calculateSMA,        // Simple Moving Average
  calculateBollinger,  // Bollinger Bands (20, 2)
  calculateATR,        // Average True Range
  calculateOBV,        // On-Balance Volume
} from "~/lib/indicators";
```

### 13. 🔔 Alert System

Agent-driven notification system:

- Trade opened/closed alerts
- Risk threshold violations
- Circuit breaker trip notifications
- Kill switch activation alerts
- Price target hits
- News sentiment shocks

Emitted via the `agentBus` event system and persisted to database.

### 14. 🎨 UI Design System

**Blue Glassmorphism Theme:**
- Semi-transparent card backgrounds with backdrop blur
- Subtle border glow effects
- Dark background (#0a0e1a) with gradient overlays
- Cyan (#00bcd4), green (#00e676), gold (#ffd700), and purple (#7c4dff) accent colors
- Iridescent "peacock neck" animated gradient
- Framer Motion page transitions (fade-in, slide-up)
- Pulse animations for live indicators
- Monospace fonts for data display

---

## 📦 Deployment

### Quick Deploy (VPS)

```bash
# Clone and run the deploy script
git clone https://github.com/bnboxr/AI-agents.git /opt/hsmc
cd /opt/hsmc
bash deploy.sh
```

The `deploy.sh` script handles:
1. System dependency installation (git, curl, build-essential)
2. Bun runtime installation
3. Repository clone/update
4. `.env` file creation template
5. Dependency installation (`bun install`)
6. Production build (`bun run build`)
7. PM2 process manager setup
8. Auto-start on boot configuration

### Systemd Deployment

For those who prefer systemd over PM2, see [SYSTEMD.md](./SYSTEMD.md) for:
- Service unit file creation
- Environment file configuration
- Enable/start/status/restart commands
- Log viewing via journalctl
- Update workflow
- Troubleshooting guide

### Vercel Deployment

```bash
export VERCEL_TOKEN=your_vercel_token
bun run go-live
```

The `go-live.sh` script:
1. Builds the SSR handler via `vercel-entry.ts`
2. Packages into `.vercel/output`
3. Deploys to Vercel
4. Makes the project public
5. Prints the live URL

### Local Development

```bash
# Install dependencies
bun install

# Start dev server (hot reload)
bun run dev

# Build for production
bun run build

# Start production server
bun run start

# Publish to port 3000
bun run publish
```

### Python Backend

```bash
cd python-backend
pip install -r requirements.txt
python main.py  # Starts on port 8001
```

### Port Architecture

| Port | Service | Protocol |
|------|---------|----------|
| 3000 | Main App | HTTP + WebSocket |
| 8001 | Python Backend | HTTP (FastAPI) |

---

## 🔑 API Keys & Configuration

### Required Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes* | GPT-4o for AI trading decisions |
| `DEEPSEEK_API_KEY` | No | DeepSeek LLM fallback |
| `GROK_API_KEY` | No | Grok/xAI LLM fallback |
| `GEMINI_API_KEY` | No | Google Gemini LLM fallback |
| `BITUNIX_API_KEY` | Yes** | Bitunix exchange for perpetual trading |
| `BITUNIX_SECRET_KEY` | Yes** | Bitunix API secret |
| `DATABASE_URL` | No | Neon PostgreSQL connection string |

\* At least one LLM provider required for AI features  
\** Required for live trading; not needed in paper/demo mode

### Optional Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `STARTING_CAPITAL` | `10000` | Initial portfolio value for paper trading |
| `PAPER_BALANCES` | `{"BTC":0.5,"ETH":5,"USDT":10000}` | Paper trading balances |
| `COPY_TRADE_WALLETS` | (empty) | Comma-separated wallet addresses to track |
| `RESERVOIR_API_KEY` | (empty) | Reservoir API for NFT arbitrage |
| `AUTONOMOUS_WALLET_SECRET` | (derived) | Encryption key for autonomous wallet |
| `BINANCE_API_KEY` | (empty) | Binance API key (public endpoints work without) |
| `BINANCE_SECRET` | (empty) | Binance API secret |

### Paper Trading Configuration

Set `PAPER_BALANCES` to simulate holdings without real funds:

```bash
PAPER_BALANCES='{"BTC":0.5,"ETH":5,"USDT":10000,"SOL":50}'
```

Set `COPY_TRADE_WALLETS` to enable copy trading:

```bash
COPY_TRADE_WALLETS='0x1234...,0x5678...'
```

---

## 🗺 Future Roadmap

### Phase 1: Live Trading (Current Focus)
- [x] 29 agents built and operational
- [x] WebSocket live market data
- [x] Risk engine with circuit breakers + kill switch
- [x] Backtesting engine (Python)
- [x] Demo mode (full functionality without wallet)
- [x] Multi-chain DEX integration
- [ ] First live trade on Bitunix
- [ ] Real P&L tracking

### Phase 2: Revenue Generation
- [ ] Live LP compounding with real capital
- [ ] Signal marketplace with Stripe payments
- [ ] Copy trading with real mirror execution
- [ ] Airdrop farming automation at scale
- [ ] NFT arbitrage with real execution

### Phase 3: Platform Expansion

| Feature | Description | Priority |
|---------|-------------|----------|
| **Monero (XMR)** | Privacy coin integration | Medium |
| **Proton (XPR)** | Proton chain integration | Medium |
| **Mobile App** | React Native mobile client | Medium |
| **Telegram Bot** | Signal delivery + trade execution via Telegram | High |
| **Discord Bot** | Community alerts + copy trading signals | High |
| **Strategy Marketplace** | Community-submitted strategies with revenue share | Low |
| **Social Trading** | Public profiles, leaderboards, follower system | Low |
| **Insurance Fund** | On-chain insurance pool for strategy risk | Low |
| **DAO Governance** | Token-gated voting on strategy parameters | Low |

### Phase 4: Advanced AI
- [ ] Agent self-improvement (feedback loops from trade outcomes)
- [ ] Cross-agent knowledge sharing (transfer learning)
- [ ] Multi-modal analysis (chart images, news videos)
- [ ] On-chain MEV detection and avoidance
- [ ] Predictive on-chain analytics (mempool, sandwich attacks)

---

## 👥 Contributing

### Getting Started

1. **Fork** the repository: `https://github.com/bnboxr/AI-agents`
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/AI-agents.git
   cd AI-agents
   ```
3. **Install** dependencies:
   ```bash
   bun install
   ```
4. **Create** a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
5. **Develop** and test:
   ```bash
   bun run dev        # Dev server
   bun run build      # Verify build
   ```
6. **Commit** with descriptive messages:
   ```bash
   git commit -m "feat: add Monero blockchain integration"
   ```
7. **Push** and create a Pull Request.

### Branch Naming Convention

| Prefix | Use Case |
|--------|----------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation updates |
| `refactor/` | Code refactoring |
| `test/` | Test additions |
| `perf/` | Performance improvements |

### Code Standards

- **TypeScript strict mode** — no `any` types in production paths
- **No hardcoded fake data** — use environment variables for all configurable values
- **Deterministic execution** — zero `Math.random()` in production trading paths
- **Server functions** — use TanStack `createServerFn` for all server-client communication
- **Environment variables** — never expose API keys in client code
- **Error handling** — catch and log, never silently swallow

### Architecture Rules

1. **Agent communication**: Agents communicate through the agent bus, never directly
2. **Risk checks**: Every trade must pass risk engine validation before execution
3. **Persistence**: Write-through to DB alongside in-memory cache
4. **WebSocket**: Market data flows through `ws/price-context.ts` singleton
5. **LLM queries**: Always use `queryAllProviders` for multi-provider redundancy

### Testing

```bash
# Build verification
bash build-test.sh

# Run dev server and check
bun run dev
curl http://localhost:3000

# Check TypeScript types
bun run build 2>&1 | grep -c "error"
```

---

## 📄 License & Credits

### License

MIT License — see the repository for full terms.

### Built With

- [TanStack Start](https://tanstack.com/start) — Full-stack React framework
- [React Flow](https://reactflow.dev/) — Node-based graph visualization
- [Framer Motion](https://www.framer.com/motion/) — Animation library
- [xterm.js](https://xtermjs.org/) — Terminal emulator
- [Tailwind CSS](https://tailwindcss.com/) — CSS framework
- [Bun](https://bun.sh/) — JavaScript runtime
- [Vite](https://vitejs.dev/) — Build tool
- [viem](https://viem.sh/) — Ethereum library
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/) — Solana library
- [OpenAI](https://openai.com/) — GPT-4o
- [DeepSeek](https://deepseek.com/) — DeepSeek Chat
- [xAI](https://x.ai/) — Grok
- [Google AI](https://ai.google.dev/) — Gemini

### Maintainers

The HSMC platform is maintained by the HSMC team. For questions, open an issue on GitHub.

---

## 📊 Quick Reference

### File Structure

```
site/
├── src/
│   ├── components/       # React components
│   │   ├── AgentNetworkGraph.tsx   # 29-agent topology (978 lines)
│   │   ├── AgentFeed.tsx           # Live agent activity feed
│   │   └── PortfolioChart.tsx      # Recharts portfolio chart
│   ├── lib/
│   │   ├── autonomous-wallet.ts    # BIP39 wallet generation
│   │   ├── risk-engine.ts          # Risk management (793 lines)
│   │   ├── trading-engine.ts       # AI trading engine
│   │   ├── orchestrator/           # Agent orchestration
│   │   ├── llm/
│   │   │   └── multi-provider.ts   # 4-LLM query pipeline (359 lines)
│   │   ├── chains/
│   │   │   ├── solana-wallet.ts    # Solana key derivation
│   │   │   ├── solana-dex.ts       # Jupiter/Raydium routing
│   │   │   ├── tron-wallet.ts      # TRON integration
│   │   │   ├── tron-dex.ts         # SunSwap integration
│   │   │   ├── xrp-wallet.ts       # XRPL integration
│   │   │   ├── xrp-dex.ts          # XRPL DEX
│   │   │   ├── cosmos-wallet.ts    # Cosmos integration
│   │   │   └── cosmos-dex.ts       # Osmosis integration
│   │   ├── exchange/               # CEX adapters
│   │   ├── revenue/                # Revenue channels
│   │   ├── ws/                     # WebSocket market data
│   │   ├── db/                     # PostgreSQL persistence
│   │   ├── backtesting/            # TypeScript backtesting
│   │   └── indicators.ts           # Technical indicators
│   ├── routes/            # 30+ page routes
│   │   ├── index.tsx               # Dashboard
│   │   ├── trade.tsx               # Trading
│   │   ├── risk.tsx                # Risk management
│   │   ├── network.tsx             # Agent network graph
│   │   └── ...                     # 25+ more pages
│   └── styles/
│       └── app.css                 # Blue glassmorphism theme
├── python-backend/        # Python FastAPI backend
│   ├── main.py                     # Entry point
│   ├── api/routes.py               # API routes
│   ├── backtesting/
│   │   ├── engine.py               # Backtesting engine
│   │   ├── strategies.py           # 3 strategies
│   │   └── metrics.py              # Performance metrics
│   ├── ml/
│   │   └── lstm.py                 # LSTM price predictor
│   └── data/
│       └── binance.py              # Binance.us data fetcher
├── deploy.sh              # VPS deployment script
├── go-live.sh             # Vercel deployment script
├── publish.sh             # Port 3000 publish script
├── serve.ts               # Bun production server
├── preload.ts             # Server preload (env loading)
├── vercel-entry.ts        # Vercel SSR handler adapter
├── vite.config.ts         # Vite configuration
├── package.json           # Dependencies (44 packages)
└── SYSTEMD.md             # Systemd deployment guide
```

### Agent Count Summary

| Level | Count | Agents |
|-------|-------|--------|
| Level 0 (Data Core) | — | Binance WS, CoinGecko, DeFiLlama, Etherscan, Reservoir |
| Level 1 (Intelligence) | 10 | Market, Technical, Sentiment, News, Macro, Pattern, Smart Money, Liquidity, Regime, Multi-Timeframe |
| Level 2 (Analysis) | 8 | Correlation, Volume, Probability, Confidence, Reasoning, Portfolio, +2 internal |
| Level 3 (Decision) | 2 | Master Orchestrator, Devil's Advocate |
| Level 4 (Execution & Monitoring) | 7 | Position Manager, Execution, Risk Manager, Learning, Memory, System Audit, Exit |
| **Total** | **29** | |

### Database Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | `trades` | Trade positions |
| 2 | `agent_reports` | Agent analysis with reasoning |
| 3 | `risk_states` | Per-agent risk metrics |
| 4 | `risk_system_state` | Global circuit breaker state |
| 5 | `autonomous_wallet` | Encrypted BIP39 wallet |
| 6 | `lp_positions` | LP positions |
| 7 | `copy_trades` | Copy trade records |
| 8 | `nft_trades` | NFT arbitrage trades |
| 9 | `signals` | Trading signals |
| 10 | `agent_memory` | Agent learning history |
| 11 | `system_events` | System audit trail |
| 12 | `pos_conversions` | Post-payment token conversions |

---

## Desktop NFC Bridge

### Overview

The HSMC Desktop NFC Bridge enables tap-to-pay NFC payments on desktop computers (Windows, macOS, Linux) via a USB NFC reader (ACR122U or compatible). It acts as a WebSocket bridge between the physical NFC reader and the HSMC POS web application.

### Architecture

```
┌──────────────────────┐         WebSocket          ┌──────────────────────┐
│   HSMC POS Web App   │ ◄──────────────────────► │   NFC Bridge Server   │
│   (port 3000)        │     ws://localhost:9876    │   (port 9876)        │
└──────────────────────┘                            └──────────┬───────────┘
                                                               │ PC/SC (USB)
                                                        ┌──────▼───────────┐
                                                        │   ACR122U NFC     │
                                                        │   Reader          │
                                                        └──────────────────┘
```

### Components

| Component | File | Description |
|-----------|------|-------------|
| Bridge Server | `nfc-bridge/server.js` | Node.js WebSocket server with nfc-pcsc integration |
| Package Config | `nfc-bridge/package.json` | Dependencies: nfc-pcsc + ws |
| Installer | `nfc-bridge/install.sh` | One-command setup script |
| Documentation | `nfc-bridge/README.md` | OS-specific driver setup + troubleshooting |
| Client Library | `src/lib/nfc-bridge.ts` | TypeScript client for connecting to bridge |

### Setup

1. Plug in ACR122U USB NFC reader
2. Install OS-specific drivers (see README.md)
3. Run: `cd nfc-bridge && npm install && npm start`
4. Bridge listens on `ws://localhost:9876` and `http://localhost:9876/status`

### Supported Readers

- **ACR122U** (ACS) — primary tested device
- ACR1252U, ACR1222L, SCL3711
- Any PC/SC-compatible NFC reader

### POS Integration

The POS terminal (`/pos`) automatically detects the desktop NFC bridge:

1. On page load, calls `GET http://localhost:9876/status`
2. If connected: green "Desktop NFC Reader Connected" indicator appears
3. During active payment session: listens for NFC tags via WebSocket
4. When valid tag detected: payment auto-processed (same flow as Web NFC)
5. If no reader: gracefully falls back to QR code + Web NFC button

### WebSocket Protocol

- Server → Client: `status`, `reader-connected`, `reader-disconnected`, `nfc-tag`, `nfc-tag-removed`
- Client → Server: `ping` (→ `pong`), `status-request` (→ `status`)
- NFC tags carry NDEF messages with EIP-681 payment URLs

---

## Auto-Conversie

### Overview

After a payment is confirmed on the POS terminal, the merchant can instantly convert received funds to any supported token via the built-in swap panel. This enables flexible treasury management — receive in USDC, instantly convert to MATIC, ETH, SOL, or BTC.

### Flow

```
Payment Confirmed (✅ APPROVED)
        │
        ├── [Convert to another token] ──► Inline Swap Panel
        │                                       │
        │    ┌──────────────────────────────────┤
        │    │  • Select destination token     │
        │    │  • View live conversion rate    │
        │    │  • Destination chain shown      │
        │    │  • [Convert] button             │
        │    └──────────────────────────────────┘
        │              │
        │              ▼
        │    Conversion Complete
        │    • Payment TXID displayed
        │    • Conversion TXID displayed
        │    • Final token + amount shown
        │
        └── [Keep as {token}] ──► Standard receipt
```

### Supported Tokens

| Token | Chain | Decimals | 
|-------|-------|----------|
| USDC | Polygon | 6 |
| USDT | Polygon | 6 |
| MATIC (POL) | Polygon | 18 |
| ETH | Ethereum | 18 |
| SOL | Solana | 9 |
| BTC (wrapped) | Polygon | 8 |

### Technical Details

- **Rate calculation**: Real-time price feeds from CoinGecko API
- **Fee**: 0.3% swap fee simulated (DEX standard)
- **Persistence**: Conversions stored in `pos_conversions` database table
- **Function**: `convertPayment()` in `src/lib/pos-service.ts`
- **Component**: `POSReceipt` with `onConvert` prop in `src/components/POSReceipt.tsx`

### Conversion Receipt

After conversion, the receipt shows:
- Original payment TXID
- Conversion TXID  
- From token + amount
- To token + amount received
- Destination chain (if cross-chain)

---

## HSMC Pay Android — Native Tap-to-Pay App

### Overview

HSMC Pay Android is a native React Native app enabling true tap-to-pay via NFC HCE (Host Card Emulation). Customers install the APK, set a spending budget, and tap their phone at any NFC-enabled POS terminal — payments are auto-processed without manual confirmation.

### Architecture

```
HSMC Pay Android APK
├── MainActivity.kt — app entry point
├── HCEService.kt — HostApduService for NFC card emulation
├── HCEBridgeModule.kt — React Native ↔ Android bridge
├── Wallet Module — stores private key (encrypted), signs transactions (EIP-712)
├── Budget Manager — pre-authorized spending limit (AsyncStorage)
├── Transaction History — local storage with stats
├── Settings — budget slider ($10–$5,000), network selector, wallet management
└── UI — glassmorphism dark theme matching HSMC platform
```

### NFC Payment Flow

```
Customer taps phone at POS
       │
       ▼
Android OS routes APDU to HCEService.kt
       │
       ▼
HCEService emits event to React Native JS layer
       │
       ▼
HCEService.ts parses payment request:
  • Check budget (BudgetService)
  • Sign authorization (WalletService → EIP-712)
  • Record transaction (TransactionStore)
       │
       ▼
Signed response returned to HCEService.kt
       │
       ▼
APDU response sent to POS reader → Payment Complete
```

### Screens

| Screen | File | Description |
|--------|------|-------------|
| Wallet | `src/screens/WalletScreen.tsx` | Balance, budget bar, create/import wallet |
| Pay | `src/screens/PayScreen.tsx` | NFC readiness indicator, "Ready to Pay" circle with pulse animation |
| History | `src/screens/HistoryScreen.tsx` | Transaction list with stats, pull-to-refresh |
| Settings | `src/screens/SettingsScreen.tsx` | Budget slider, network toggle (Amoy/Mainnet), export/delete wallet |

### Services

| Service | File | Description |
|---------|------|-------------|
| HCE Service | `src/services/HCEService.ts` | NFC event handling, payment orchestration |
| Wallet Service | `src/services/WalletService.ts` | Wallet creation, EIP-712 signing, key encryption |
| Budget Service | `src/services/BudgetService.ts` | Budget CRUD, spend tracking, period resets |
| Transaction Store | `src/services/TransactionStore.ts` | Local transaction history with stats |

### Native Android Components

| Component | File | Description |
|-----------|------|-------------|
| HCEService | `android/.../HCEService.kt` | HostApduService — processes APDU commands from POS |
| HCEBridgeModule | `android/.../HCEBridgeModule.kt` | React Native bridge for HCE communication |
| HCEBridgePackage | `android/.../HCEBridgePackage.kt` | Registers native module with React Native |

### Key Permissions

- `android.permission.NFC` — NFC access
- `android.hardware.nfc.hce` (required) — Host Card Emulation
- AID: `F0010203040506` — registered HSMC Pay payment AID
- PSE AID: `325041592E5359532E4444463031` — standard contactless payment

### Project Location

- **Directory**: `hsmc-pay-android/`
- **Branch**: `feat/hsmc-pay-android`
- **Build**: `cd android && ./gradlew assembleRelease`
- **APK output**: `android/app/build/outputs/apk/release/app-release.apk`

### Build Requirements

- Node.js 18+, Android Studio, Android SDK 34+, JDK 17
- Physical Android device with NFC HCE (Android 4.4+)

### Security Notes

⚠️ **Prototype**: Private key stored with basic encryption in AsyncStorage. For production, use Android Keystore with `react-native-keychain` for biometric-protected, hardware-backed key storage.

### Theme

Glassmorphism dark theme matching HSMC platform:
- Background: `#080a0f`
- Primary accent: `#00e676`
- Glass panels: `rgba(255,255,255,0.07)` with subtle borders

---

> **HSMC Platform** — *Autonomous AI Hedge Fund. 29 agents. 4 LLMs. Zero human intervention.*
