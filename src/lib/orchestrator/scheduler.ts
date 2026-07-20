import { CHAINS } from '../chains';
import { getAgentState } from '../agent-runner';
import { enqueue } from './queue';
import type { ScanTask, TaskPriority } from './types';
import { farmAirdrops } from '../airdrop/farmer';
import { getMasterWallet } from '../airdrop/wallet-manager';
import { getSyncBalance } from '../unified-balance';

const SCAN_INTERVAL_MS = 15_000; // 15s between scheduler ticks
const MIN_SCAN_GAP_MS = 60_000;   // Don't scan the same chain more than once per 60s
const STAGGER_OFFSET_MS = 3_000;  // 3s offset per chain for initial scans
const FARMER_INTERVAL_MS = 21_600_000; // 6 hours between airdrop farming runs
let _scanTaskIdCounter = 0;

let intervalId: ReturnType<typeof setInterval> | null = null;
let farmerIntervalId: ReturnType<typeof setInterval> | null = null;
let farmerWarnedNoWallet = false;
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
        id: `scan_${chain.id}_${now.toString(36)}_${(_scanTaskIdCounter++).toString(36)}`,
        chainId: chain.id,
        priority: determinePriority(chain.id),
        type: 'scan',
        createdAt: now,
        attempts: 0,
      };
      enqueue(task);
      console.log(`[Scheduler] Tick — enqueuing scan for chain ${chain.id} (priority: ${task.priority})`);
    }
  }
}

async function runFarmer(): Promise<void> {
  try {
    // Resolve wallet address: prefer wallet-manager master, fall back to env
    const masterWallet = getMasterWallet();
    const walletAddress: string | undefined =
      masterWallet?.address ??
      (typeof process !== "undefined" && process.env?.FARMER_WALLET_ADDRESS) ??
      undefined;

    if (!walletAddress) {
      if (!farmerWarnedNoWallet) {
        console.warn(
          "[Farmer] No wallet address configured — set FARMER_WALLET_ADDRESS env or init wallet-manager. Skipping airdrop farming.",
        );
        farmerWarnedNoWallet = true;
      }
      return;
    }
    farmerWarnedNoWallet = false;

    const balance = getSyncBalance();
    const chainBalance = balance.usdt;

    console.log(
      `[Farmer] Starting airdrop farming — wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}, balance: ${chainBalance.toFixed(2)}`,
    );

    const result = await farmAirdrops(walletAddress, chainBalance);

    if (result.success) {
      console.log(
        `[Farmer] interactions: ${result.interactions}, protocols: [${result.protocolNames.join(", ")}]`,
      );
    } else {
      console.log(
        `[Farmer] No interactions performed — ${result.skippedReason ?? "unknown reason"}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Farmer] Farming run failed: ${msg}`);
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

  // Start airdrop farmer interval (6 hours); also run once after 30s on startup
  farmerIntervalId = setInterval(runFarmer, FARMER_INTERVAL_MS);
  setTimeout(runFarmer, 30_000);

  console.log(`[Orchestrator Scheduler] Started — ticking every ${SCAN_INTERVAL_MS / 1000}s, min gap ${MIN_SCAN_GAP_MS / 1000}s, farmer every ${FARMER_INTERVAL_MS / 3_600_000}h`);
}

export function stopScheduler(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (farmerIntervalId !== null) {
    clearInterval(farmerIntervalId);
    farmerIntervalId = null;
  }

  for (const timer of initialStaggerTimers) {
    clearTimeout(timer);
  }
  initialStaggerTimers = [];

  console.log('[Orchestrator Scheduler] Stopped');
}
