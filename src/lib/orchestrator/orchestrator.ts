import { startScheduler, stopScheduler } from './scheduler';
import { startDispatcher, stopDispatcher, getActiveCount } from './dispatcher';
import { size, clear, getQueueSnapshot } from './queue';
import { getAgentState } from '../agent-runner';
import { CHAINS } from '../chains';
import type { OrchestratorState } from './types';

let running = false;

export function startOrchestrator(): void {
  if (running) {
    console.log('[Orchestrator] Already running — idempotent start skipped');
    return;
  }

  console.log('[Orchestrator] Starting agent orchestration engine...');

  // Start dispatcher first so it's ready to consume tasks
  startDispatcher();

  // Start scheduler to feed the queue
  startScheduler();

  running = true;
  console.log('[Orchestrator] ✓ Orchestration engine is live');
}

export function stopOrchestrator(): void {
  if (!running) {
    return;
  }

  console.log('[Orchestrator] Stopping orchestration engine...');

  stopScheduler();
  stopDispatcher();
  clear();

  running = false;
  console.log('[Orchestrator] ✓ Orchestration engine stopped');
}

export function getState(): OrchestratorState {
  const lastScanByChain: Record<string, number> = {};
  for (const chain of CHAINS) {
    const state = getAgentState(chain.id);
    lastScanByChain[chain.id] = state.lastActionTime;
  }

  return {
    running,
    activeTasks: getActiveCount(),
    queuedTasks: size(),
    lastScanByChain,
  };
}

export { getQueueSnapshot } from './queue';
