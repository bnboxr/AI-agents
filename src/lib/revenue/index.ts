// ── Revenue Channels Index ─────────────────────────────────────
// All revenue channels in paper-mode simulation.
// Platforms: LP Auto-Compounder, Copy Trading, NFT Arbitrage.

export {
  depositLP,
  getLPYield,
  compound,
  closePosition,
  getLPState,
  resetLPState,
} from "./lp-compounder";

export type { LPPosition, LPYieldState } from "./lp-compounder";

export {
  followWallet,
  unfollowWallet,
  copyTrade,
  getCopyTradeState,
  setCopyPercent,
  setMaxPositionSize,
  getTrackedWallets,
  resetCopyTradeState,
} from "./copy-trade";

export type { TrackedWallet, CopyTrade, CopyTradeState } from "./copy-trade";

export {
  scanArbitrage,
  getTopCollections,
  executePaperTrade,
  getNFTArbitrageState,
  getPaperTradeProfit,
  resetNFTState,
} from "./nft-arbitrage";

export type {
  NFTCollection,
  NFTArbitrageOpportunity,
  NFTArbitrageState,
  PaperNFTTrade,
} from "./nft-arbitrage";
