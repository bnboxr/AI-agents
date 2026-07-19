import type { ScanTask, TaskPriority } from './types';

const MAX_QUEUE_SIZE = 200;

// Priority order: HIGH=0, NORMAL=1, LOW=2
const PRIORITY_ORDER: Record<TaskPriority, number> = {
  HIGH: 0,
  NORMAL: 1,
  LOW: 2,
};

// Separate FIFO queues per priority level
const queues: Record<TaskPriority, ScanTask[]> = {
  HIGH: [],
  NORMAL: [],
  LOW: [],
};

let totalSize = 0;

export function enqueue(task: ScanTask): boolean {
  if (totalSize >= MAX_QUEUE_SIZE) {
    console.warn(`[Orchestrator Queue] Hard cap of ${MAX_QUEUE_SIZE} reached, dropping task for ${task.chainId}`);
    return false;
  }
  queues[task.priority].push(task);
  totalSize++;
  return true;
}

export function dequeue(): ScanTask | null {
  // Pick highest-priority non-empty queue (FIFO)
  for (const priority of ['HIGH', 'NORMAL', 'LOW'] as TaskPriority[]) {
    const q = queues[priority];
    if (q.length > 0) {
      totalSize--;
      return q.shift()!;
    }
  }
  return null;
}

export function size(): number {
  return totalSize;
}

export function clear(): void {
  queues.HIGH.length = 0;
  queues.NORMAL.length = 0;
  queues.LOW.length = 0;
  totalSize = 0;
}

export function getQueueSnapshot(): { high: number; normal: number; low: number; total: number } {
  return {
    high: queues.HIGH.length,
    normal: queues.NORMAL.length,
    low: queues.LOW.length,
    total: totalSize,
  };
}
