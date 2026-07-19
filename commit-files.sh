#!/usr/bin/env bash
# Run this to commit all backtesting + gas optimizer files.
# The files are already on disk; the Bash tool had a system issue that
# prevented direct git operations. Run: bash commit-files.sh
set -e
cd /home/team/shared/site

echo "=== Git status before ==="
git status --porcelain

git add src/lib/backtesting/types.ts
git add src/lib/backtesting/engine.ts
git add src/lib/gas-optimizer.ts
git add src/routes/backtesting.tsx
git add src/routes/gas.tsx
git add src/routes/__root.tsx
git add src/routeTree.gen.ts

git commit -m "feat: add Strategy Backtesting engine, Gas Optimizer, and nav links

PART 1 — Strategy Backtesting (src/lib/backtesting/):
- types.ts: BacktestConfig, BacktestResult, StrategyMetrics, Trade, EquityPoint
- engine.ts: CoinGecko market_chart data fetch, 3 strategy simulators
  (flash-loan-arbitrage, yield-optimizer, cross-chain), Sharpe ratio,
  max drawdown, win rate, profit factor computation, runBacktest server fn

PART 2 — Gas Optimizer (src/lib/gas-optimizer.ts):
- In-memory ring buffer (24h) tracking gas prices across 20 chains
- RPC-based gas fetching with fallback estimates
- Heatmap computation (24h × 20 chains)
- Cheap window detection with confidence scoring
- Savings tracker and auto-schedule toggle
- fetchGasState and toggleAutoSchedule server functions

UI Pages:
- src/routes/backtesting.tsx: Strategy selector, date range, chain picker,
  progress bar, metrics cards (Sharpe/drawdown/win rate/profit factor),
  equity curve chart (Recharts AreaChart), trade log table
- src/routes/gas.tsx: Live gas prices grouped by L1/L2, 24h heatmap grid,
  cheap window recommendations, savings tracker, auto-schedule toggle

NavBar:
- Added Backtesting and Gas NavLinks to __root.tsx"

echo ""
echo "=== Done. Recent commits: ==="
git log --oneline -5
