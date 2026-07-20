use std::cmp::Ordering;
use std::collections::BTreeMap;
use chrono::Utc;
use tracing::{debug, info};

use super::types::*;
use crate::types::Trade;

/// Comparator for bids: highest price first; at equal prices, earliest timestamp first.
fn bid_cmp(a: &Order, b: &Order) -> Ordering {
    b.price
        .partial_cmp(&a.price)
        .unwrap_or(Ordering::Equal)
        .then_with(|| a.timestamp.cmp(&b.timestamp))
        .then_with(|| a.id.cmp(&b.id))
}

/// Comparator for asks: lowest price first; at equal prices, earliest timestamp first.
fn ask_cmp(a: &Order, b: &Order) -> Ordering {
    a.price
        .partial_cmp(&b.price)
        .unwrap_or(Ordering::Equal)
        .then_with(|| a.timestamp.cmp(&b.timestamp))
        .then_with(|| a.id.cmp(&b.id))
}

/// A real price-time priority order book for a single symbol.
///
/// - Bids are stored as a BTreeMap keyed by (negated price, timestamp, id)
/// - Asks are stored as a BTreeMap keyed by (price, timestamp, id)
///
/// We use BTreeMap with a tuple key instead of BinaryHeap so we can
/// efficiently remove individual orders by id (for cancels).
#[derive(Debug, Clone)]
pub struct OrderBook {
    pub symbol: String,
    /// Bids: (neg_price, timestamp, order_id) -> Order
    bids: BTreeMap<(i64, i64, String), Order>,
    /// Asks: (price_ticks, timestamp, order_id) -> Order
    asks: BTreeMap<(i64, i64, String), Order>,
    /// Reverse index: order_id -> (is_bid, key) for fast cancel
    order_index: std::collections::HashMap<String, (bool, (i64, i64, String))>,
}

impl OrderBook {
    pub fn new(symbol: &str) -> Self {
        OrderBook {
            symbol: symbol.to_string(),
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            order_index: std::collections::HashMap::new(),
        }
    }

    /// Convert a price to a tick representation for sorting keys.
    /// Uses 1e8 scaling to preserve precision without floating-point comparison issues.
    fn price_to_ticks(price: f64) -> i64 {
        (price * 100_000_000.0).round() as i64
    }

    /// Place an order into the book. Matches immediately against existing orders
    /// if possible. Returns a list of trades that occurred.
    pub fn place_order(&mut self, mut order: Order) -> (Vec<Trade>, OrderStatus) {
        let mut trades = Vec::new();

        match order.order_type {
            OrderType::Market => {
                // Market order: match against all available liquidity
                if order.side == OrderSide::Buy {
                    while order.remaining() > 0.0 {
                        let best_ask = self.best_ask();
                        if best_ask.is_none() {
                            order.status = OrderStatus::Rejected;
                            return (trades, OrderStatus::Rejected);
                        }
                        let (ask_key, mut ask_order) = best_ask.unwrap();

                        let trade_qty = order.remaining().min(ask_order.remaining());
                        let trade_price = ask_order.price;

                        ask_order.filled += trade_qty;
                        order.filled += trade_qty;

                        let trade = Trade::new(
                            &self.symbol,
                            &order.id,
                            &ask_order.id,
                            trade_price,
                            trade_qty,
                        );
                        trades.push(trade);

                        if ask_order.is_filled() {
                            ask_order.status = OrderStatus::Filled;
                            self.asks.remove(&ask_key);
                            self.order_index.remove(&ask_order.id);
                        } else {
                            ask_order.status = OrderStatus::PartiallyFilled;
                            self.asks.insert(ask_key.clone(), ask_order.clone());
                        }
                    }
                    order.status = OrderStatus::Filled;
                } else {
                    // Sell market order: match against bids
                    while order.remaining() > 0.0 {
                        let best_bid = self.best_bid();
                        if best_bid.is_none() {
                            order.status = OrderStatus::Rejected;
                            return (trades, OrderStatus::Rejected);
                        }
                        let (bid_key, mut bid_order) = best_bid.unwrap();

                        let trade_qty = order.remaining().min(bid_order.remaining());
                        let trade_price = bid_order.price;

                        bid_order.filled += trade_qty;
                        order.filled += trade_qty;

                        let trade = Trade::new(
                            &self.symbol,
                            &bid_order.id,
                            &order.id,
                            trade_price,
                            trade_qty,
                        );
                        trades.push(trade);

                        if bid_order.is_filled() {
                            bid_order.status = OrderStatus::Filled;
                            self.bids.remove(&bid_key);
                            self.order_index.remove(&bid_order.id);
                        } else {
                            bid_order.status = OrderStatus::PartiallyFilled;
                            self.bids.insert(bid_key.clone(), bid_order.clone());
                        }
                    }
                    order.status = OrderStatus::Filled;
                }
                return (trades, order.status);
            }
            OrderType::Limit => {
                // Limit order: try to match at or better than limit price
                if order.side == OrderSide::Buy {
                    while order.remaining() > 0.0 {
                        let best_ask = self.best_ask();
                        match best_ask {
                            Some((ask_key, ask_order)) if ask_order.price <= order.price => {
                                let trade_qty = order.remaining().min(ask_order.remaining());
                                let trade_price = ask_order.price;

                                let mut matched_ask = ask_order.clone();
                                matched_ask.filled += trade_qty;
                                order.filled += trade_qty;

                                let trade = Trade::new(
                                    &self.symbol,
                                    &order.id,
                                    &matched_ask.id,
                                    trade_price,
                                    trade_qty,
                                );
                                trades.push(trade);

                                if matched_ask.is_filled() {
                                    matched_ask.status = OrderStatus::Filled;
                                    self.asks.remove(&ask_key);
                                    self.order_index.remove(&matched_ask.id);
                                } else {
                                    matched_ask.status = OrderStatus::PartiallyFilled;
                                    self.asks.insert(ask_key, matched_ask);
                                }
                            }
                            _ => break, // No more matching asks
                        }
                    }
                } else {
                    // Sell limit: match against bids at or above limit price
                    while order.remaining() > 0.0 {
                        let best_bid = self.best_bid();
                        match best_bid {
                            Some((bid_key, bid_order)) if bid_order.price >= order.price => {
                                let trade_qty = order.remaining().min(bid_order.remaining());
                                let trade_price = bid_order.price;

                                let mut matched_bid = bid_order.clone();
                                matched_bid.filled += trade_qty;
                                order.filled += trade_qty;

                                let trade = Trade::new(
                                    &self.symbol,
                                    &matched_bid.id,
                                    &order.id,
                                    trade_price,
                                    trade_qty,
                                );
                                trades.push(trade);

                                if matched_bid.is_filled() {
                                    matched_bid.status = OrderStatus::Filled;
                                    self.bids.remove(&bid_key);
                                    self.order_index.remove(&matched_bid.id);
                                } else {
                                    matched_bid.status = OrderStatus::PartiallyFilled;
                                    self.bids.insert(bid_key, matched_bid);
                                }
                            }
                            _ => break,
                        }
                    }
                }

                // If there's remaining quantity, add to the book
                if order.remaining() > 0.0 {
                    let ticks = Self::price_to_ticks(order.price);
                    let key = if order.side == OrderSide::Buy {
                        // Bids: negated price for descending sort
                        (-ticks, order.timestamp, order.id.clone())
                    } else {
                        (ticks, order.timestamp, order.id.clone())
                    };

                    order.status = if order.filled > 0.0 {
                        OrderStatus::PartiallyFilled
                    } else {
                        OrderStatus::New
                    };

                    let is_bid = order.side == OrderSide::Buy;
                    self.order_index
                        .insert(order.id.clone(), (is_bid, key.clone()));

                    if is_bid {
                        self.bids.insert(key, order.clone());
                    } else {
                        self.asks.insert(key, order.clone());
                    }
                } else {
                    order.status = OrderStatus::Filled;
                }
                return (trades, order.status);
            }
        }
    }

    /// Cancel an order by id. Returns true if the order was found and cancelled.
    pub fn cancel_order(&mut self, order_id: &str) -> bool {
        if let Some((is_bid, key)) = self.order_index.remove(order_id) {
            if is_bid {
                if let Some(mut order) = self.bids.remove(&key) {
                    order.status = OrderStatus::Cancelled;
                    debug!("Cancelled bid order {}", order_id);
                    return true;
                }
            } else {
                if let Some(mut order) = self.asks.remove(&key) {
                    order.status = OrderStatus::Cancelled;
                    debug!("Cancelled ask order {}", order_id);
                    return true;
                }
            }
        }
        false
    }

    /// Get the best bid (highest price) from the book.
    fn best_bid(&self) -> Option<((i64, i64, String), Order)> {
        // Bids are sorted by (-price, timestamp, id) — last entry is highest price
        self.bids
            .last_key_value()
            .map(|(k, v)| (k.clone(), v.clone()))
    }

    /// Get the best ask (lowest price) from the book.
    fn best_ask(&self) -> Option<((i64, i64, String), Order)> {
        // Asks are sorted by (price, timestamp, id) — first entry is lowest price
        self.asks
            .first_key_value()
            .map(|(k, v)| (k.clone(), v.clone()))
    }

    /// Get the current best bid and ask.
    pub fn get_best_bid_ask(&self) -> BestBidAsk {
        let best_bid = self.bids.last_key_value();
        let best_ask = self.asks.first_key_value();

        BestBidAsk {
            symbol: self.symbol.clone(),
            best_bid: best_bid.map(|(_, o)| o.price),
            best_ask: best_ask.map(|(_, o)| o.price),
            best_bid_qty: best_bid.map(|(_, o)| o.remaining()),
            best_ask_qty: best_ask.map(|(_, o)| o.remaining()),
        }
    }

    /// Get N levels of depth (aggregated by price).
    pub fn get_depth(&self, levels: usize) -> OrderBookDepth {
        let mut bid_levels: Vec<BookLevel> = Vec::new();
        let mut current_price = None;
        let mut current_qty = 0.0;
        let mut current_count = 0usize;

        // Bids iterate in reverse for descending price
        for ((neg_price, _, _), order) in self.bids.iter().rev() {
            let price = -(*neg_price as f64) / 100_000_000.0;

            if current_price == Some(price) {
                current_qty += order.remaining();
                current_count += 1;
            } else {
                if let Some(p) = current_price {
                    bid_levels.push(BookLevel {
                        price: p,
                        quantity: current_qty,
                        order_count: current_count,
                    });
                    if bid_levels.len() >= levels {
                        break;
                    }
                }
                current_price = Some(price);
                current_qty = order.remaining();
                current_count = 1;
            }
        }
        // Push last level
        if let Some(p) = current_price {
            if bid_levels.len() < levels {
                bid_levels.push(BookLevel {
                    price: p,
                    quantity: current_qty,
                    order_count: current_count,
                });
            }
        }

        let mut ask_levels: Vec<BookLevel> = Vec::new();
        let mut current_price = None;
        let mut current_qty = 0.0;
        let mut current_count = 0usize;

        for ((price_ticks, _, _), order) in self.asks.iter() {
            let price = *price_ticks as f64 / 100_000_000.0;

            if current_price == Some(price) {
                current_qty += order.remaining();
                current_count += 1;
            } else {
                if let Some(p) = current_price {
                    ask_levels.push(BookLevel {
                        price: p,
                        quantity: current_qty,
                        order_count: current_count,
                    });
                    if ask_levels.len() >= levels {
                        break;
                    }
                }
                current_price = Some(price);
                current_qty = order.remaining();
                current_count = 1;
            }
        }
        if let Some(p) = current_price {
            if ask_levels.len() < levels {
                ask_levels.push(BookLevel {
                    price: p,
                    quantity: current_qty,
                    order_count: current_count,
                });
            }
        }

        OrderBookDepth {
            symbol: self.symbol.clone(),
            bids: bid_levels,
            asks: ask_levels,
            timestamp: Utc::now().timestamp_millis(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_limit_order_matching() {
        let mut ob = OrderBook::new("BTCUSDT");

        // Place a bid at 50000
        let buy = Order::new("BTCUSDT", OrderSide::Buy, OrderType::Limit, 50000.0, 1.0, 1);
        let (trades, status) = ob.place_order(buy);
        assert_eq!(status, OrderStatus::New);
        assert!(trades.is_empty());

        // Place an ask at 49000 (crosses the bid — should match)
        let sell = Order::new("BTCUSDT", OrderSide::Sell, OrderType::Limit, 49000.0, 0.5, 2);
        let (trades, status) = ob.place_order(sell);
        assert_eq!(status, OrderStatus::Filled);
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].price, 50000.0); // Trade at bid price
        assert_eq!(trades[0].quantity, 0.5);

        // The bid should now be partially filled (0.5 remaining)
        let bba = ob.get_best_bid_ask();
        assert_eq!(bba.best_bid, Some(50000.0));
        assert_eq!(bba.best_bid_qty, Some(0.5));
    }

    #[test]
    fn test_price_time_priority() {
        let mut ob = OrderBook::new("ETHUSDT");

        // Place two bids at same price — earlier timestamp gets priority
        let buy1 = Order::new("ETHUSDT", OrderSide::Buy, OrderType::Limit, 3000.0, 1.0, 100);
        let buy2 = Order::new("ETHUSDT", OrderSide::Buy, OrderType::Limit, 3000.0, 1.0, 200);
        let (t1, _) = ob.place_order(buy1);
        let (t2, _) = ob.place_order(buy2);
        assert!(t1.is_empty());
        assert!(t2.is_empty());

        // A sell that crosses: should match buy1 first (earlier timestamp)
        let sell = Order::new("ETHUSDT", OrderSide::Sell, OrderType::Limit, 2990.0, 1.5, 300);
        let (trades, _) = ob.place_order(sell);
        assert_eq!(trades.len(), 2);
        // First trade should be against buy1
        assert_eq!(trades[0].buy_order_id, buy1.id);
        assert_eq!(trades[0].quantity, 1.0); // All of buy1
        // Second trade against buy2 (0.5 remaining)
        assert_eq!(trades[1].buy_order_id, buy2.id);
        assert_eq!(trades[1].quantity, 0.5);
    }

    #[test]
    fn test_cancel_order() {
        let mut ob = OrderBook::new("SOLUSDT");
        let buy = Order::new("SOLUSDT", OrderSide::Buy, OrderType::Limit, 100.0, 10.0, 1);
        let (_, status) = ob.place_order(buy.clone());
        assert_eq!(status, OrderStatus::New);

        assert!(ob.cancel_order(&buy.id));
        let bba = ob.get_best_bid_ask();
        assert_eq!(bba.best_bid, None);
    }

    #[test]
    fn test_market_order() {
        let mut ob = OrderBook::new("AVAXUSDT");

        // Add some liquidity
        let ask = Order::new("AVAXUSDT", OrderSide::Sell, OrderType::Limit, 20.0, 10.0, 1);
        let (_, _) = ob.place_order(ask);

        // Market buy
        let mkt_buy = Order::new("AVAXUSDT", OrderSide::Buy, OrderType::Market, 0.0, 5.0, 2);
        let (trades, status) = ob.place_order(mkt_buy);
        assert_eq!(status, OrderStatus::Filled);
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].quantity, 5.0);
    }

    #[test]
    fn test_get_depth() {
        let mut ob = OrderBook::new("BTCUSDT");

        ob.place_order(Order::new("BTCUSDT", OrderSide::Buy, OrderType::Limit, 50000.0, 1.0, 1));
        ob.place_order(Order::new("BTCUSDT", OrderSide::Buy, OrderType::Limit, 49900.0, 2.0, 2));
        ob.place_order(Order::new("BTCUSDT", OrderSide::Sell, OrderType::Limit, 51000.0, 1.0, 3));

        let depth = ob.get_depth(5);
        assert_eq!(depth.bids.len(), 2);
        assert_eq!(depth.bids[0].price, 50000.0);
        assert_eq!(depth.bids[1].price, 49900.0);
        assert_eq!(depth.asks.len(), 1);
        assert_eq!(depth.asks[0].price, 51000.0);
    }
}
