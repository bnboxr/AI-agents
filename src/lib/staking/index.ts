// ── Staking Module Index ─────────────────────────────────────────
// Re-exports from protocols (existing staking) and pSOL auto-staking

export {
  getStakingProtocols,
  getStakingByChain,
  getBestAPYPerAsset,
  getAPYHistory,
} from "./protocols";

export type { StakingProtocol, StakingChainGroup, StakingAPYHistory } from "./protocols";

export {
  getPSolState,
  getPSolStakedBalance,
  getPSolAPY,
  depositStake,
  compoundYield,
  triggerAutoStake,
  PSOL_STAKE_THRESHOLD,
} from "./psol";

export type { PSolStakingState } from "./psol";
