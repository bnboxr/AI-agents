// ── Exchange Adapter Types ──────────────────────────────────────────
// Shared interfaces for all exchange integrations.
// All live execution is disabled by default (paper mode).

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
  enabled: boolean;
  isLive: boolean;
  apiKeyConfigured: boolean;
}
