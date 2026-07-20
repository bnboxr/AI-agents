import { internalScan, addActivity, getAgentState, syncAgentStateToDb } from '../agent-runner';
import { dequeue, enqueue } from './queue';
import type { ScanTask, TaskResult } from './types';
import { agentBus } from '../agent-bus';
import { buildPriceContext } from './price-context';
import { runAgentAnalysis } from '../agents/orchestrator';
import { validateTrade, recordTradeResult, initAntiDrain, checkDailyDrawdown } from '../anti-drain';
import { updateChainBalance, getChainBalance, setInitialBalance } from '../chain-balance';
import { refreshCooldowns, canClaim, countAvailableFaucets } from '../faucet-cooldown';
import { isWalletTestnet, getWalletChainConfig } from '../chains-config';
import { getBalance } from '../unified-balance';

const POLL_INTERVAL_MS = 2_000;   // 2s between dispatch polls
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 5_000;    // 5s backoff between retries

let intervalId: ReturnType<typeof setInterval> | null = null;
let activeCount = 0;
let lastFaucetCheck = 0;
const FAUCET_CHECK_INTERVAL_MS = 60_000; // 60s

export function getActiveCount(): number {
  return activeCount;
}

async function executeTask(task: ScanTask): Promise<TaskResult> {
  const startTime = Date.now();
  const agent = getAgentState(task.chainId);

  // Emit scan_started event for live monitor
  agentBus.emit('scan_started', {
    chainId: task.chainId,
    agentName: agent.agentName,
    timestamp: startTime,
  });

  addActivity({
    id: `dispatch-${task.id}`,
    chainId: task.chainId,
    agentName: agent.agentName,
    action: `Scan inițiat pe ${task.chainId} — prioritate ${task.priority}`,
    timestamp: startTime,
    type: 'scan',
  });

  try {
    const result = await internalScan(task.chainId);

    const durationMs = Date.now() - startTime;

    // ── Agent Analysis Pipeline ──────────────────────────────────
    // After each scan, build price context and run the full agent pipeline.
    // This runs in the dispatcher (server context) — catches errors so
    // a single chain's analysis failure doesn't crash the dispatch loop.
    try {
      console.log(`[Dispatcher] ScanTask for chain ${task.chainId} — building price context...`);
      const priceCtx = await buildPriceContext(task.chainId);

      if (priceCtx) {
        console.log(
          `[Orchestrator] runAgentAnalysis starting for chain ${task.chainId} ` +
          `(${priceCtx.token} @ ${priceCtx.currentPrice})`,
        );
        const analysisResult = await runAgentAnalysis({ data: priceCtx });
        const { decision, reports } = analysisResult;

        console.log(
          `[Orchestrator] gatherReports: ${reports.length} agents responded for chain ${task.chainId}`,
        );
        console.log(
          `[Orchestrator] decision: ${decision.action} — confidence ${decision.confidence}% ` +
          `for ${task.chainId}`,
        );

        if (decision.action === 'BUY' || decision.action === 'SELL') {
          // ── Anti-Drain: Validate trade before execution ──────────────
          const isTestnet = isWalletTestnet();
          if (isTestnet) {
            const cfg = getWalletChainConfig();
            const chainId = task.chainId;

            // Initialize anti-drain with current balance if needed
            const bal = await getBalance();
            initAntiDrain(chainId, bal.usdt);

            const validation = validateTrade(
              bal.usdt,
              decision.positionSize,
              decision.confidence,
              chainId,
            );

            if (!validation.allowed) {
              console.warn(
                `[AntiDrain] Trade blocked on ${chainId}: ${validation.reason}`,
              );
              // Skip execution — let the agent know
              agentBus.emit('trade_blocked', {
                chainId,
                reason: validation.reason,
                maxSize: validation.maxSize,
                tier: validation.tier,
              });
              return; // Don't execute blocked trade
            }

            console.log(
              `[AntiDrain] Trade approved on ${chainId}: ` +
              `size ${decision.positionSize} (max ${validation.maxSize?.toFixed(2)}), ` +
              `tier ${validation.tier}`,
            );
          }

          console.log(
            `[Execution] paper trade placed — ${decision.action} ${decision.positionSize} ${priceCtx.token} @ ${priceCtx.currentPrice}`,
          );

          // ── Post-trade: Update chain balance & anti-drain state ─────
          if (isTestnet) {
            const cfg = getWalletChainConfig();
            const chainId = task.chainId;
            // Estimate PnL (simplified — actual PnL tracked on position close)
            const estimatedPnL = 0; // updated on close
            await updateChainBalance(chainId, estimatedPnL);
            recordTradeResult(chainId, estimatedPnL, (await getBalance()).usdt);
          }
        }
      }
    } catch (analysisErr) {
      const analysisMsg = analysisErr instanceof Error ? analysisErr.message : String(analysisErr);
      console.error(
        `[Dispatcher] Agent analysis failed for chain ${task.chainId}: ${analysisMsg}`,
      );
      // Analysis failure is non-fatal — scan results still valid
    }

    // Emit opportunity_found for each opportunity
    for (const opp of result.opportunities) {
      agentBus.emit('opportunity_found', {
        chainId: task.chainId,
        agentName: agent.agentName,
        opportunity: opp,
      });
    }

    // Emit scan_completed
    agentBus.emit('scan_completed', {
      chainId: task.chainId,
      agentName: agent.agentName,
      opportunitiesFound: result.opportunities.length,
      durationMs,
      success: true,
    });

    return {
      taskId: task.id,
      chainId: task.chainId,
      success: true,
      opportunitiesFound: result.opportunities.length,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    addActivity({
      id: `dispatch-err-${task.id}`,
      chainId: task.chainId,
      agentName: agent.agentName,
      action: `Eroare scan ${task.chainId}: ${errorMsg}`,
      timestamp: Date.now(),
      type: 'info',
    });

    // Emit scan_completed with failure
    agentBus.emit('scan_completed', {
      chainId: task.chainId,
      agentName: agent.agentName,
      opportunitiesFound: 0,
      durationMs,
      success: false,
    });

    return {
      taskId: task.id,
      chainId: task.chainId,
      success: false,
      opportunitiesFound: 0,
      durationMs,
      error: errorMsg,
    };
  }
}

function poll(): void {
  // ── Periodic Faucet Cooldown Check ──────────────────────────────
  const now = Date.now();
  if (now - lastFaucetCheck >= FAUCET_CHECK_INTERVAL_MS) {
    lastFaucetCheck = now;
    refreshCooldowns();

    // Log available faucets per testnet chain
    if (isWalletTestnet()) {
      const cfg = getWalletChainConfig();
      const available = countAvailableFaucets(cfg.name.toLowerCase().replace(/\s+/g, "-"));
      if (available > 0 && canClaim(cfg.faucets?.[0] ?? "", cfg.name.toLowerCase().replace(/\s+/g, "-"))) {
        console.log(
          `[Faucet] ${cfg.name}: ${available} faucet(s) available — ready to claim`,
        );
      }
    }
  }

  while (activeCount < MAX_CONCURRENT) {
    const task = dequeue();
    if (!task) break; // queue empty

    activeCount++;

    (async () => {
      try {
        let result = await executeTask(task);

        // Retry up to MAX_RETRIES on failure
        let retries = 0;
        while (!result.success && retries < MAX_RETRIES) {
          retries++;
          console.warn(
            `[Orchestrator Dispatcher] Retry ${retries}/${MAX_RETRIES} for ${task.chainId} — waiting ${RETRY_BACKOFF_MS / 1000}s`
          );

          await new Promise(resolve => setTimeout(resolve, RETRY_BACKOFF_MS));

          // Update agent state before retry
          const state = getAgentState(task.chainId);
          state.status = 'scanning';
          state.lastAction = `Reîncercare scan ${task.chainId} (${retries}/${MAX_RETRIES})`;
          state.lastActionTime = Date.now();

          // Sync state to DB
          syncAgentStateToDb(state);

          result = await executeTask({
            ...task,
            attempts: task.attempts + retries,
          });
        }

        if (result.success) {
          console.log(
            `[Orchestrator Dispatcher] ✓ ${task.chainId}: ${result.opportunitiesFound} oportunități (${result.durationMs}ms)`
          );
        } else {
          console.error(
            `[Orchestrator Dispatcher] ✗ ${task.chainId}: FAILED after ${retries} retries — ${result.error}`
          );
        }
      } finally {
        activeCount--;
      }
    })();
  }
}

export function startDispatcher(): void {
  if (intervalId !== null) {
    return; // already running
  }

  intervalId = setInterval(poll, POLL_INTERVAL_MS);

  // Also poll immediately
  poll();

  console.log(`[Orchestrator Dispatcher] Started — polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent`);
}

export function stopDispatcher(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  console.log('[Orchestrator Dispatcher] Stopped');
}
/home/agent-lead/.profile: line 28: /home/agent-lead/.cargo/env: No such file or directory
/home/agent-lead/.profile: line 28: /home/agent-lead/.cargo/env: No such file or directory
/home/agent-lead/.profile: line 28: /home/agent-lead/.cargo/env: No such file or directory
/home/agent-lead/.profile: line 28: /home/agent-lead/.cargo/env: No such file or directory
