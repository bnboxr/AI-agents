// ── pSOL Auto-Staking ───────────────────────────────────────────────
// Marinade Finance Liquid Staking on Solana
// Contract: pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL
//
// Paper mode by default — all Solana calls are mocked.
// When @solana/web3.js becomes available, uncomment the live paths.

// ── Types ──────────────────────────────────────────────────────────

export interface PSolStakingState {
  /** Total SOL staked (deposited into Marinade) */
  stakedSOL: number;
  /** Accumulated staking rewards (in SOL terms) */
  earnedSOL: number;
  /** Current Marinade APY as a percentage (e.g., 6.5 = 6.5%) */
  apy: number;
  /** pSOL token balance (tracked locally, mirrors stakedSOL + earnedSOL) */
  psolBalance: number;
  /** Timestamp of last APY update (ms since epoch) */
  lastAPYUpdate: number;
  /** Timestamp of last compound cycle (ms since epoch) */
  lastCompound: number;
  /** Number of compound cycles completed */
  compoundCount: number;
  /** Whether we are in paper mode */
  paperMode: boolean;
  /** Last action log entry */
  lastAction: string;
  /** Action log history (for debugging) */
  actionLog: string[];
}

// ── Constants ──────────────────────────────────────────────────────

/** Marinade Finance program ID on Solana mainnet */
export const MARINADE_PROGRAM_ID = "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL";

/** Minimum SOL amount to trigger auto-stake */
export const PSOL_STAKE_THRESHOLD = 0.01;

/** Default APY estimate (updated from Marinade API when available) */
const DEFAULT_APY = 6.5;

/** APY refresh interval: 1 hour in ms */
const APY_REFRESH_INTERVAL = 3_600_000;

/** Compound interval: 24 hours in ms */
const COMPOUND_INTERVAL = 86_400_000;

/** Maximum action log entries */
const MAX_ACTION_LOG = 200;

// ── State ──────────────────────────────────────────────────────────

const state: PSolStakingState = {
  stakedSOL: 0,
  earnedSOL: 0,
  apy: DEFAULT_APY,
  psolBalance: 0,
  lastAPYUpdate: 0,
  lastCompound: 0,
  compoundCount: 0,
  paperMode: true,
  lastAction: "pSOL staking initialized — paper mode",
  actionLog: ["[pSOL] Initialized in paper mode. Marinade contract: " + MARINADE_PROGRAM_ID],
};

// ── Private helpers ────────────────────────────────────────────────

function logAction(action: string): void {
  const entry = `[${new Date().toISOString()}] ${action}`;
  state.lastAction = action;
  state.actionLog.push(entry);
  if (state.actionLog.length > MAX_ACTION_LOG) {
    state.actionLog = state.actionLog.slice(-MAX_ACTION_LOG);
  }
  // Always log to console in paper mode, to a monitoring system in live mode
  console.log(`🥩 pSOL: ${action}`);
}

/**
 * Fetch Marinade APY from the stats API.
 * Returns the APY as a percentage (e.g., 6.5 = 6.5%).
 */
async function fetchMarinadeAPY(): Promise<number> {
  try {
    const res = await fetch("https://stats.marinade.finance/api/marinade/tlv", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return DEFAULT_APY;
    const data = await res.json();
    // Marinade API returns APY as decimal (e.g., 0.065 = 6.5%)
    const apyDecimal = data?.apy ? parseFloat(data.apy) : null;
    if (apyDecimal !== null && apyDecimal > 0) {
      return Math.round(apyDecimal * 100 * 100) / 100;
    }
    return DEFAULT_APY;
  } catch {
    return DEFAULT_APY;
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get the current pSOL staking state snapshot.
 */
export function getPSolState(): PSolStakingState {
  return { ...state, actionLog: [...state.actionLog] };
}

/**
 * Get the staked balance (total SOL staked via Marinade).
 * In paper mode: returns the local tracked balance.
 * In live mode: would query the Marinade pSOL token account on-chain.
 */
export function getPSolStakedBalance(): number {
  // Paper mode: return locally tracked staked balance
  // Live mode: would call connection.getTokenAccountBalance(pSolTokenAccount)
  //   const balance = await connection.getTokenAccountBalance(pSolTokenAccount);
  //   return balance.value.uiAmount ?? 0;
  logAction(`getStakedBalance() → ${state.stakedSOL.toFixed(4)} SOL staked`);
  return state.stakedSOL;
}

/**
 * Get the current Marinade APY.
 * Cached for APY_REFRESH_INTERVAL; refreshes from API when stale.
 */
export async function getPSolAPY(): Promise<number> {
  const now = Date.now();
  if (now - state.lastAPYUpdate < APY_REFRESH_INTERVAL) {
    return state.apy;
  }
  const apy = await fetchMarinadeAPY();
  state.apy = apy;
  state.lastAPYUpdate = now;
  logAction(`getAPY() → refreshed: ${apy}%`);
  return apy;
}

/**
 * Deposit SOL into Marinade Finance to receive pSOL.
 *
 * Paper mode: logs what WOULD happen, updates local state.
 * Live mode: would build and send the Marinade deposit instruction.
 *
 * @param amountSOL — Amount of SOL to stake
 * @returns The resulting staking state
 */
export async function depositStake(amountSOL: number): Promise<PSolStakingState> {
  if (amountSOL <= 0) {
    logAction(`depositStake(${amountSOL}) → SKIPPED: amount must be > 0`);
    return getPSolState();
  }

  if (state.paperMode) {
    // ── Paper Mode ───────────────────────────────────────────────
    // Log what WOULD happen with the Marinade deposit instruction:
    //
    //   const tx = new Transaction().add(
    //     createDepositInstruction({
    //       marinadeFinanceProgramId: new PublicKey(MARINADE_PROGRAM_ID),
    //       userTransferAuthority: wallet.publicKey,
    //       userReserveTokenAccount: sourceTokenAccount,
    //       marinadeState: marinadeStateAccount,
    //       msolMint: msolMintAddress,
    //       msolMintAuthority: msolMintAuthorityAddress,
    //       liqPoolMsolLeg: liqPoolMsolLegAccount,
    //       liqPoolMsolLegAuthority: liqPoolMsolLegAuthority,
    //       reservePda: reservePdaAccount,
    //       mintTo: destinationTokenAccount,
    //       systemProgram: SystemProgram.programId,
    //       tokenProgram: TOKEN_PROGRAM_ID,
    //     })
    //   );
    //   const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);
    //   console.log(`Marinade deposit tx: ${signature}`);

    // Marinade exchange rate: ~1 SOL ≈ 1 pSOL (with slight variance from staking rewards)
    // In reality, Marinade uses an appreciating exchange rate for mSOL;
    // pSOL is a proxy for this. For paper mode, we use 1:1.
    const psolReceived = amountSOL; // 1:1 in paper mode (real rate varies with staking rewards)

    state.stakedSOL += amountSOL;
    state.psolBalance += psolReceived;

    logAction(
      `depositStake(${amountSOL} SOL) → PAPER MODE: Would call Marinade deposit ` +
        `(program: ${MARINADE_PROGRAM_ID.slice(0, 8)}...), ` +
        `received ${psolReceived.toFixed(4)} pSOL. ` +
        `New stake: ${state.stakedSOL.toFixed(4)} SOL`
    );
  } else {
    // ── Live Mode ────────────────────────────────────────────────
    // Real Solana transaction would execute here
    throw new Error(
      "Live Solana mode not yet implemented. " +
        "Install @solana/web3.js and configure wallet to enable live pSOL staking."
    );
  }

  return getPSolState();
}

/**
 * Compound accumulated staking rewards into the staked balance.
 *
 * Marinade's mSOL (pSOL proxy) appreciates in value relative to SOL over time
 * as staking rewards accrue. This function calculates the yield earned since
 * the last compound and adds it to earnedSOL.
 *
 * In live mode: would check the current pSOL/SOL exchange rate vs the rate
 * at deposit time to calculate accrued rewards.
 */
export async function compoundYield(): Promise<PSolStakingState> {
  const now = Date.now();

  if (state.stakedSOL === 0) {
    logAction("compoundYield() → SKIPPED: no stake to compound");
    return getPSolState();
  }

  // Only compound once per COMPOUND_INTERVAL
  if (now - state.lastCompound < COMPOUND_INTERVAL) {
    logAction(
      `compoundYield() → SKIPPED: last compound was ${Math.round((now - state.lastCompound) / 3600000)}h ago`
    );
    return getPSolState();
  }

  // Refresh APY first
  await getPSolAPY();

  // Calculate yield for the period since last compound
  const hoursSinceLastCompound = (now - state.lastCompound) / 3600000;
  const hoursInYear = 365 * 24;
  const periodYield = state.stakedSOL * (state.apy / 100) * (hoursSinceLastCompound / hoursInYear);

  if (periodYield <= 0.000001) {
    logAction(
      `compoundYield() → SKIPPED: yield too small (${periodYield.toFixed(8)} SOL)`
    );
    return getPSolState();
  }

  if (state.paperMode) {
    // ── Paper Mode ───────────────────────────────────────────────
    // Marinade mSOL appreciates automatically — no explicit "claim rewards" tx.
    // In paper mode, we simulate the appreciation by adding to earnedSOL.
    state.earnedSOL += periodYield;
    state.stakedSOL += periodYield; // Auto-compound: yield becomes principal
    state.psolBalance += periodYield;
    state.compoundCount++;
    state.lastCompound = now;

    logAction(
      `compoundYield() → PAPER MODE: +${periodYield.toFixed(6)} SOL earned ` +
        `(@ ${state.apy}% APY, ${hoursSinceLastCompound.toFixed(1)}h since last compound). ` +
        `Compound #${state.compoundCount}. Total earned: ${state.earnedSOL.toFixed(6)} SOL`
    );
  } else {
    // ── Live Mode ────────────────────────────────────────────────
    // Marinade mSOL appreciates in value — no explicit compound tx needed.
    // We would query the exchange rate to calculate real accrued rewards.
    //   const msolBalance = await getMSolBalance();
    //   const exchangeRate = await getMarinadeExchangeRate();
    //   const solValue = msolBalance * exchangeRate;
    //   const earned = solValue - state.stakedSOL + state.earnedSOL;
    throw new Error(
      "Live Solana mode not yet implemented. " +
        "Install @solana/web3.js to enable live pSOL compounding."
    );
  }

  return getPSolState();
}

/**
 * Trigger auto-stake: if payout is above the threshold, deposit it into pSOL.
 *
 * Called by the Capital Manager after `recordProfit()` updates the payout.
 * Only stakes if payout >= PSOL_STAKE_THRESHOLD (0.01 SOL).
 *
 * @param payoutAmount — The current owner payout amount from Capital Manager
 * @returns The resulting staking state (staked or not)
 */
export async function triggerAutoStake(payoutAmount: number): Promise<PSolStakingState> {
  if (payoutAmount < PSOL_STAKE_THRESHOLD) {
    logAction(
      `triggerAutoStake(${payoutAmount}) → BELOW THRESHOLD (min: ${PSOL_STAKE_THRESHOLD} SOL)`
    );
    return getPSolState();
  }

  logAction(
    `triggerAutoStake(${payoutAmount}) → THRESHOLD MET: auto-staking ${payoutAmount} SOL into pSOL`
  );

  return depositStake(payoutAmount);
}

// ── Initialization ─────────────────────────────────────────────────

// Attempt to fetch the real APY on module load
fetchMarinadeAPY()
  .then((apy) => {
    state.apy = apy;
    state.lastAPYUpdate = Date.now();
    logAction(`Initial APY fetch: ${apy}%`);
  })
  .catch(() => {
    logAction(`Initial APY fetch failed, using default: ${DEFAULT_APY}%`);
  });
