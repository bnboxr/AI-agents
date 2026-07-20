// ── Exchange Module — Barrel Export ─────────────────────────────────

export type {
  ExchangeAdapter,
  ExchangeRole,
  OrderBook,
  OrderBookLevel,
  OrderRequest,
  OrderResult,
  Balance,
  AssetBalance,
  Order,
  ArbitrageOpportunity,
  ExchangeConfig,
  PerpetualOrderRequest,
  PerpetualPosition,
} from "./types";

export { BinanceAdapter, getBinanceAdapter } from "./binance";
export { BitunixAdapter, getBitunixAdapter } from "./bitunix";

export {
  registerExchange,
  getAllExchangeConfigs,
  getActiveExchanges,
  getTradingExchanges,
  getDataExchanges,
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
