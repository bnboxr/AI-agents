use dashmap::DashMap;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tokio_tungstenite::connect_async;
use tracing::{error, info, warn};

/// Price update from Binance bookTicker stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookTickerUpdate {
    pub symbol: String,
    #[serde(rename = "b")]
    pub best_bid: String,
    #[serde(rename = "B")]
    pub best_bid_qty: String,
    #[serde(rename = "a")]
    pub best_ask: String,
    #[serde(rename = "A")]
    pub best_ask_qty: String,
}

/// Current best bid/ask price for a symbol.
#[derive(Debug, Clone)]
pub struct CurrentPrice {
    pub best_bid: f64,
    pub best_ask: f64,
    pub best_bid_qty: f64,
    pub best_ask_qty: f64,
    pub timestamp: i64,
}

impl CurrentPrice {
    /// Mid price between best bid and ask.
    pub fn mid_price(&self) -> f64 {
        (self.best_bid + self.best_ask) / 2.0
    }
}

/// Manager for real-time market data from Binance WebSocket streams.
///
/// Connects to Binance's public WebSocket API for live price feeds.
/// Stores latest prices in a DashMap for fast concurrent access.
/// Handles reconnection with exponential backoff.
pub struct MarketDataManager {
    /// Symbol -> latest price data
    pub prices: DashMap<String, CurrentPrice>,
    /// Shutdown signal
    shutdown: Arc<Notify>,
}

impl MarketDataManager {
    pub fn new() -> Self {
        MarketDataManager {
            prices: DashMap::new(),
            shutdown: Arc::new(Notify::new()),
        }
    }

    /// Get the latest price for a symbol. Returns mid price.
    pub fn get_price(&self, symbol: &str) -> Option<f64> {
        self.prices.get(symbol).map(|p| p.mid_price())
    }

    /// Get the full price data for a symbol.
    pub fn get_price_data(&self, symbol: &str) -> Option<CurrentPrice> {
        self.prices.get(symbol).map(|p| p.clone())
    }

    /// Spawn a WebSocket connection task for a single symbol's book ticker.
    /// This is a fire-and-forget task that reconnects on failure.
    pub fn subscribe_book_ticker(self: &Arc<Self>, symbol: &str) {
        let symbol_lower = symbol.to_lowercase();
        let url = format!(
            "wss://stream.binance.com:443/ws/{}@bookTicker",
            symbol_lower
        );

        let manager = Arc::clone(self);
        let shutdown = Arc::clone(&self.shutdown);

        tokio::spawn(async move {
            let mut backoff = 1u64; // seconds

            loop {
                // Check shutdown before connecting
                // We use a tiny timeout check on the shutdown notify
                match connect_async(&url).await {
                    Ok((ws_stream, _response)) => {
                        info!("Connected to Binance WebSocket for {}", symbol_lower);
                        backoff = 1; // Reset backoff on successful connection

                        let (_, mut read) = ws_stream.split();

                        loop {
                            tokio::select! {
                                msg = read.next() => {
                                    match msg {
                                        Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                                            match serde_json::from_str::<BookTickerUpdate>(&text) {
                                                Ok(update) => {
                                                    let best_bid: f64 = update.best_bid.parse().unwrap_or(0.0);
                                                    let best_ask: f64 = update.best_ask.parse().unwrap_or(0.0);
                                                    let best_bid_qty: f64 = update.best_bid_qty.parse().unwrap_or(0.0);
                                                    let best_ask_qty: f64 = update.best_ask_qty.parse().unwrap_or(0.0);

                                                    let price = CurrentPrice {
                                                        best_bid,
                                                        best_ask,
                                                        best_bid_qty,
                                                        best_ask_qty,
                                                        timestamp: chrono::Utc::now().timestamp_millis(),
                                                    };

                                                    manager.prices.insert(update.symbol.clone(), price);
                                                }
                                                Err(e) => {
                                                    warn!("Failed to parse book ticker for {}: {}", symbol_lower, e);
                                                }
                                            }
                                        }
                                        Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(data))) => {
                                            // Pong is handled automatically by tokio-tungstenite
                                        }
                                        Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) => {
                                            warn!("WebSocket closed for {}, reconnecting...", symbol_lower);
                                            break;
                                        }
                                        Some(Err(e)) => {
                                            error!("WebSocket error for {}: {}", symbol_lower, e);
                                            break;
                                        }
                                        None => {
                                            warn!("WebSocket stream ended for {}", symbol_lower);
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                                _ = shutdown.notified() => {
                                    info!("Shutting down market data for {}", symbol_lower);
                                    return;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to connect to Binance for {}: {}",
                            symbol_lower, e
                        );
                    }
                }

                // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 60s
                info!(
                    "Reconnecting WebSocket for {} in {}s",
                    symbol_lower, backoff
                );
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(backoff)) => {
                        backoff = (backoff * 2).min(60);
                    }
                    _ = shutdown.notified() => {
                        info!("Shutdown during backoff for {}", symbol_lower);
                        return;
                    }
                }
            }
        });
    }

    /// Subscribe to multiple symbols.
    pub fn subscribe_symbols(self: &Arc<Self>, symbols: &[&str]) {
        for symbol in symbols {
            self.subscribe_book_ticker(symbol);
        }
    }

    /// Trigger graceful shutdown of all WebSocket connections.
    pub fn shutdown(&self) {
        self.shutdown.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_market_data_manager_new() {
        let mgr = MarketDataManager::new();
        assert!(mgr.get_price("BTCUSDT").is_none());
    }

    #[test]
    fn test_price_insertion() {
        let mgr = MarketDataManager::new();
        mgr.prices.insert(
            "BTCUSDT".to_string(),
            CurrentPrice {
                best_bid: 50000.0,
                best_ask: 50001.0,
                best_bid_qty: 1.0,
                best_ask_qty: 1.5,
                timestamp: 1000,
            },
        );
        let price = mgr.get_price("BTCUSDT");
        assert_eq!(price, Some(50000.5));

        let data = mgr.get_price_data("BTCUSDT");
        assert!(data.is_some());
        assert_eq!(data.unwrap().best_bid, 50000.0);
    }
}
