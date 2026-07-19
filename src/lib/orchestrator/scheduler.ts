import { CHAINS } from '../chains';
import { getAgentState } from '../agent-runner';
import { enqueue } from './queue';
import type { ScanTask, TaskPriority } from './types';

const SCAN_INTERVAL_MS = 15_000; // 15s between scheduler ticks
const MIN_SCAN_GAP_MS = 60_000;   // Don't scan the same chain more than once per 60s
const STAGGER_OFFSET_MS = 3_000;  // 3s offset per chain for initial scans

let intervalId: ReturnType<typeof setInterval> | null = null;
let initialStaggerTimers: ReturnType<typeof setTimeout>[] = [];

function determinePriority(chainId: string): TaskPriority {
  const state = getAgentState(chainId);

  // Chains with recent opportunities → HIGH
  // We detect "recent opportunities" by checking if the last action mentions opportunities found
  if (state.lastAction && state.lastAction.includes('oportunit')) {
    return 'HIGH';
  }

  // Agent 'active' → NORMAL
  if (state.status === 'active' || state.status === 'scanning') {
    return 'NORMAL';
  }

  // 'idle' / 'error' → LOW
  return 'LOW';
}

function tick(): void {
  const now = Date.now();

  for (const chain of CHAINS) {
    // Check when this chain was last scanned via agent state
    const state = getAgentState(chain.id);
    const timeSinceLastScan = now - state.lastActionTime;

    if (timeSinceLastScan >= MIN_SCAN_GAP_MS) {
      const task: ScanTask = {
        id: `scan-${chain.id}-${now}-${Math.random().toString(36).slice(2, 6)}`,
        chainId: chain.id,
        priority: determinePriority(chain.id),
        type: 'scan',
        createdAt: now,
        attempts: 0,
      };
      enqueue(task);
    }
  }
}

export function startScheduler(): void {
  if (intervalId !== null) {
    return; // already running
  }

  // Stagger initial scans across first 60s (index * 3s offset)
  CHAINS.forEach((chain, index) => {
    const offset = index * STAGGER_OFFSET_MS;
    const timer = setTimeout(() => {
      const now = Date.now();
      const state = getAgentState(chain.id);

      // Only enqueue initial scan if enough time has passed since last action
      if (now - state.lastActionTime >= MIN_SCAN_GAP_MS) {
        const task: ScanTask = {
          id: `scan-${chain.id}-${now}-init`,
          chainId: chain.id,
          priority: determinePriority(chain.id),
          type: 'scan',
          createdAt: now,
          attempts: 0,
        };
        enqueue(task);
      }
    }, offset);
    initialStaggerTimers.push(timer);
  });

  // Start regular tick interval
  intervalId = setInterval(tick, SCAN_INTERVAL_MS);

  console.log(`[Orchestrator Scheduler] Started — ticking every ${SCAN_INTERVAL_MS / 1000}s, min gap ${MIN_SCAN_GAP_MS / 1000}s`);
}

export function stopScheduler(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  for (const timer of initialStaggerTimers) {
    clearTimeout(timer);
  }
  initialStaggerTimers = [];

  console.log('[Orchestrator Scheduler] Stopped');
}
