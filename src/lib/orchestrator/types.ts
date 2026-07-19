export type TaskPriority = 'HIGH' | 'NORMAL' | 'LOW';

export interface ScanTask {
  id: string;
  chainId: string;
  priority: TaskPriority;
  type: 'scan';
  createdAt: number;
  attempts: number;
}

export interface TaskResult {
  taskId: string;
  chainId: string;
  success: boolean;
  opportunitiesFound: number;
  durationMs: number;
  error?: string;
}

export interface OrchestratorState {
  running: boolean;
  activeTasks: number;
  queuedTasks: number;
  lastScanByChain: Record<string, number>;
}
