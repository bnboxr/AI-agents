// ── Exchange Module — Barrel Export ─────────────────────────────────

export type {
  ExchangeAdapter,
  OrderBook,
  OrderBookLevel,
  OrderRequest,
  OrderResult,
  Balance,
  AssetBalance,
  Order,
  ArbitrageOpportunity,
  ExchangeConfig,
} from "./types";

export { BinanceAdapter, getBinanceAdapter } from "./binance";
export { BitunixAdapter, getBitunixAdapter } from "./bitunix";

export {
  registerExchange,
  getAllExchangeConfigs,
  getActiveExchanges,
  setExchangeEnabled,
  getExchange,
  getBestPrice,
  detectArbitrage,
  placeOrderBestExchange,
  getAggregatedBalance,
  getExchangeConfigs,
  toggleExchange,
  queryBestPrice,
  scanArbitrage,
} from "./manager";
