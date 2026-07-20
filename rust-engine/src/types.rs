use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use dashmap::DashMap;

use crate::market::data::MarketDataManager;
use crate::orderbook::engine::OrderBook;
use crate::risk::limits::RiskLimits;

/// Shared application state, accessible from all Axum handlers.
pub struct AppState {
    /// Per-symbol order books: symbol -> OrderBook
    pub order_books: DashMap<String, OrderBook>,
    /// Real-time market data manager
    pub market_data: Arc<MarketDataManager>,
    /// Risk limits configuration
    pub risk_limits: RiskLimits,
    /// Trade history per symbol: symbol -> Vec<Trade>
    pub trades: DashMap<String, Vec<Trade>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            order_books: DashMap::new(),
            market_data: Arc::new(MarketDataManager::new()),
            risk_limits: RiskLimits::default(),
            trades: DashMap::new(),
        }
    }
}

/// A completed trade between two orders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub buy_order_id: String,
    pub sell_order_id: String,
    pub price: f64,
    pub quantity: f64,
    pub timestamp: i64,
}

impl Trade {
    pub fn new(
        symbol: &str,
        buy_order_id: &str,
        sell_order_id: &str,
        price: f64,
        quantity: f64,
    ) -> Self {
        Trade {
            id: uuid::Uuid::new_v4().to_string(),
            symbol: symbol.to_string(),
            buy_order_id: buy_order_id.to_string(),
            sell_order_id: sell_order_id.to_string(),
            price,
            quantity,
            timestamp: Utc::now().timestamp_millis(),
        }
    }
}
