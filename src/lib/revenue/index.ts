// ── Revenue Channels Index ─────────────────────────────────────
// All revenue channels backed by real data sources.
// Platforms: LP Auto-Compounder, Copy Trading, NFT Arbitrage, Trading Data Signals.

export {
  depositLP,
  getLPYield,
  compound,
  closePosition,
  getLPState,
  resetLPState,
  fetchDeFiLlamaPools,
  discoverPools,
  refreshAPYs,
  computeOptimalCompoundInterval,
} from "./lp-compounder";

export type { LPPosition, LPYieldState, DeFiLlamaPool } from "./lp-compounder";

export {
  followWallet,
  unfollowWallet,
  mirrorTrade,
  scanWallets,
  getCopyTradeState,
  setCopyPercent,
  setMaxPositionSize,
  getTrackedWallets,
  fetchWalletHistory,
  resetCopyTradeState,
} from "./copy-trade";

export type { TrackedWallet, CopyTrade, CopyTradeState, EtherscanTx } from "./copy-trade";

export {
  scanArbitrage,
  fetchFloorPrices,
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

export {
  createSignal,
  resolveSignal,
  exportSignals,
  getSignalHistory,
  getSignalById,
  calculateQualityMetrics,
  getSignalSummary,
  checkPremiumAccess,
  getSignalPaymentLink,
  formatSignalForBot,
  getBotSignals,
  resetSignalData,
} from "./trading-data";

export type {
  TradingSignal,
  SignalQualityMetrics,
  SignalExportRequest,
  SignalExportResponse,
} from "./trading-data";
