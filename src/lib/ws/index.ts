// ── WebSocket Market Data — Public API ────────────────────────────

export {
  startMarketData,
  stopMarketData,
  getPrice,
  getPriceEntry,
  subscribeToPrices,
  getPriceHistory,
  getMarketDataState,
  isSymbolTracked,
  getTrackedSymbols,
  type PriceTick,
  type PriceCallback,
  type MarketDataState,
} from "./market-data";

export {
  initPriceContext,
  shutdownPriceContext,
  getPrice as getPriceCtx,
  getPrices,
  getPriceWithTimestamp,
  getPriceHistory as getPriceHistoryCtx,
  getState,
  isInitialized,
  getAllCachedPrices,
  DEFAULT_SYMBOLS,
} from "./price-context";
