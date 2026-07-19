import { internalScan, addActivity, getAgentState } from '../agent-runner';
import { dequeue, enqueue } from './queue';
import type { ScanTask, TaskResult } from './types';

const POLL_INTERVAL_MS = 2_000;   // 2s between dispatch polls
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 5_000;    // 5s backoff between retries

let intervalId: ReturnType<typeof setInterval> | null = null;
let activeCount = 0;

export function getActiveCount(): number {
  return activeCount;
}

async function executeTask(task: ScanTask): Promise<TaskResult> {
  const startTime = Date.now();
  const agent = getAgentState(task.chainId);

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
