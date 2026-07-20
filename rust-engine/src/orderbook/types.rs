use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum OrderType {
    Limit,
    Market,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum OrderStatus {
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: f64,
    pub quantity: f64,
    pub filled: f64,
    pub timestamp: i64,
    pub status: OrderStatus,
}

impl Order {
    pub fn new(
        symbol: &str,
        side: OrderSide,
        order_type: OrderType,
        price: f64,
        quantity: f64,
        timestamp: i64,
    ) -> Self {
        Order {
            id: uuid::Uuid::new_v4().to_string(),
            symbol: symbol.to_string(),
            side,
            order_type,
            price,
            quantity,
            filled: 0.0,
            timestamp,
            status: OrderStatus::New,
        }
    }

    /// The remaining quantity to be filled.
    pub fn remaining(&self) -> f64 {
        self.quantity - self.filled
    }

    /// Whether this order is completely filled.
    pub fn is_filled(&self) -> bool {
        self.remaining() <= 0.0
    }
}

/// A single level in the order book (aggregated by price).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookLevel {
    pub price: f64,
    pub quantity: f64,
    pub order_count: usize,
}

/// Depth snapshot for an order book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookDepth {
    pub symbol: String,
    pub bids: Vec<BookLevel>,
    pub asks: Vec<BookLevel>,
    pub timestamp: i64,
}

/// Best bid/ask (top of book).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BestBidAsk {
    pub symbol: String,
    pub best_bid: Option<f64>,
    pub best_ask: Option<f64>,
    pub best_bid_qty: Option<f64>,
    pub best_ask_qty: Option<f64>,
}
