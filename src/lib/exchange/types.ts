// ── Exchange Adapter Types ──────────────────────────────────────────
// Shared interfaces for all exchange integrations.
// All live execution is disabled by default (paper mode).

/** Exchange role: data-only, trading-only, or both. */
export type ExchangeRole = "data" | "trading" | "both";

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];  // sorted: highest price first
  asks: OrderBookLevel[];  // sorted: lowest price first
  timestamp: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;          // required for LIMIT orders
  leverage?: number;       // for futures/perps
  reduceOnly?: boolean;
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  filledQuantity: number;
  avgPrice: number;
  status: "FILLED" | "PARTIALLY_FILLED" | "PENDING" | "CANCELLED" | "REJECTED";
  fee: number;
  feeAsset: string;
  timestamp: number;
  isPaper: boolean;
}

export interface Balance {
  assets: AssetBalance[];
  totalUsdValue: number;
  timestamp: number;
  isPaper: boolean;
}

export interface AssetBalance {
  asset: string;
  free: number;
  locked: number;
  usdValue: number;
}

export interface Order {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  filledQuantity: number;
  price: number;
  avgPrice: number;
  status: "FILLED" | "PARTIALLY_FILLED" | "PENDING" | "CANCELLED" | "REJECTED";
  timestamp: number;
  isPaper: boolean;
}

export interface ExchangeAdapter {
  /** Human-readable exchange name */
  name: string;

  /** Exchange role: data, trading, or both */
  role: ExchangeRole;

  /** Get the current price for a symbol (e.g. "BTCUSDT") */
  getPrice(symbol: string): Promise<number>;

  /** Get the full order book for a symbol */
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;

  /** Place an order (paper mode default) */
  placeOrder(order: OrderRequest): Promise<OrderResult>;

  /** Cancel an existing order */
  cancelOrder(orderId: string): Promise<void>;

  /** Get account balances */
  getBalance(): Promise<Balance>;

  /** Get all open orders */
  getOpenOrders(): Promise<Order[]>;

  /** WebSocket endpoint for real-time data */
  wsEndpoint: string;

  /** Whether this exchange is enabled */
  isEnabled: boolean;

  /** Whether this exchange has real API keys configured */
  isLive: boolean;

  /** Set enabled state */
  setEnabled(enabled: boolean): void;

  // ── Perpetuals (optional) ──────────────────────────────────────────

  /** Place a perpetual futures order */
  placePerpetualOrder?(order: PerpetualOrderRequest): Promise<OrderResult>;

  /** Get open perpetual positions */
  getPerpetualPositions?(symbol?: string): Promise<PerpetualPosition[]>;

  /** Set leverage for a perpetual symbol */
  setLeverage?(symbol: string, leverage: number): Promise<void>;

  /** Close a perpetual position by symbol */
  closePerpetualPosition?(symbol: string): Promise<OrderResult>;
}

export interface ArbitrageOpportunity {
  buyExchange: string;
  sellExchange: string;
  symbol: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  potentialProfit: number;
  timestamp: number;
}

export interface ExchangeConfig {
  exchangeId: string;
  name: string;
  role: ExchangeRole;
  enabled: boolean;
  isLive: boolean;
  apiKeyConfigured: boolean;
}

// ── Perpetuals ──────────────────────────────────────────────────────

export interface PerpetualOrderRequest extends OrderRequest {
  leverage: number;        // 1-125x
  marginMode: "isolated" | "cross";
  reduceOnly?: boolean;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface PerpetualPosition {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  marginMode: "isolated" | "cross";
  unrealizedPnl: number;
  liquidationPrice: number;
  marginUsed: number;
}
