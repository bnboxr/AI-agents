use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{error, info};

use crate::orderbook::engine::OrderBook;
use crate::orderbook::types::*;
use crate::risk::checker::{self, PositionTracker};
use crate::types::AppState;

/// Shared state wrapper for Axum.
type SharedState = Arc<AppState>;

/// Build the Axum router with all API routes.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/order", post(place_order))
        .route("/api/order/{id}", delete(cancel_order))
        .route("/api/orderbook/{symbol}", get(get_orderbook))
        .route("/api/orderbook/{symbol}/depth/{levels}", get(get_orderbook_depth))
        .route("/api/trades/{symbol}", get(get_trades))
        .route("/api/risk/check", post(risk_check))
        .route("/api/price/{symbol}", get(get_price))
        .with_state(state)
}

// ─── Request / Response types ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PlaceOrderRequest {
    pub symbol: String,
    pub side: String,       // "Buy" or "Sell"
    pub order_type: String, // "Limit" or "Market"
    pub price: f64,
    pub quantity: f64,
}

#[derive(Debug, Serialize)]
pub struct PlaceOrderResponse {
    pub order_id: String,
    pub status: String,
    pub trades: Vec<crate::types::Trade>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RiskCheckRequest {
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub price: f64,
    pub quantity: f64,
}

#[derive(Debug, Serialize)]
pub struct RiskCheckResponse {
    pub passed: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CancelOrderResponse {
    pub success: bool,
    pub order_id: String,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub timestamp: i64,
    pub symbols_tracked: usize,
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async fn health_check(State(state): State<SharedState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        timestamp: Utc::now().timestamp_millis(),
        symbols_tracked: state.market_data.prices.len(),
    })
}

async fn place_order(
    State(state): State<SharedState>,
    Json(req): Json<PlaceOrderRequest>,
) -> (StatusCode, Json<PlaceOrderResponse>) {
    // Parse side
    let side = match req.side.to_lowercase().as_str() {
        "buy" => OrderSide::Buy,
        "sell" => OrderSide::Sell,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(PlaceOrderResponse {
                    order_id: String::new(),
                    status: "Rejected".to_string(),
                    trades: vec![],
                    error: Some("Invalid side: must be 'Buy' or 'Sell'".to_string()),
                }),
            );
        }
    };

    // Parse order type
    let order_type = match req.order_type.to_lowercase().as_str() {
        "limit" => OrderType::Limit,
        "market" => OrderType::Market,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(PlaceOrderResponse {
                    order_id: String::new(),
                    status: "Rejected".to_string(),
                    trades: vec![],
                    error: Some("Invalid order_type: must be 'Limit' or 'Market'".to_string()),
                }),
            );
        }
    };

    let symbol_upper = req.symbol.to_uppercase();
    let now = Utc::now().timestamp_millis();

    let order = Order::new(
        &symbol_upper,
        side.clone(),
        order_type.clone(),
        req.price,
        req.quantity,
        now,
    );

    // ── Risk check ──
    let current_price = state.market_data.get_price(&symbol_upper);
    let positions = PositionTracker::new(); // In production, this would be loaded from DB

    if let Err(risk_err) = checker::check_order(&order, &state.risk_limits, &positions, current_price)
    {
        tracing::warn!("Risk check failed for {}: {}", order.id, risk_err);
        return (
            StatusCode::FORBIDDEN,
            Json(PlaceOrderResponse {
                order_id: order.id,
                status: "Rejected".to_string(),
                trades: vec![],
                error: Some(risk_err.to_string()),
            }),
        );
    }

    // ── Place in order book ──
    let symbol_upper_clone = symbol_upper.clone();
    let mut ob = state
        .order_books
        .entry(symbol_upper.clone())
        .or_insert_with(|| OrderBook::new(&symbol_upper_clone));

    let (trades, status) = ob.place_order(order.clone());

    // Record trades
    if !trades.is_empty() {
        let mut trade_list = state
            .trades
            .entry(symbol_upper.clone())
            .or_insert_with(Vec::new);
        trade_list.extend(trades.clone());
    }

    info!(
        "Order {} placed: {:?} {} {} @ {} qty={}, status={:?}, trades={}",
        order.id,
        side,
        order_type,
        symbol_upper,
        req.price,
        req.quantity,
        status,
        trades.len()
    );

    (
        StatusCode::OK,
        Json(PlaceOrderResponse {
            order_id: order.id,
            status: format!("{:?}", status),
            trades,
            error: None,
        }),
    )
}

async fn cancel_order(
    State(state): State<SharedState>,
    Path(order_id): Path<String>,
) -> (StatusCode, Json<CancelOrderResponse>) {
    // Search all order books for this order
    for mut entry in state.order_books.iter_mut() {
        if entry.value_mut().cancel_order(&order_id) {
            return (
                StatusCode::OK,
                Json(CancelOrderResponse {
                    success: true,
                    order_id,
                }),
            );
        }
    }

    (
        StatusCode::NOT_FOUND,
        Json(CancelOrderResponse {
            success: false,
            order_id,
        }),
    )
}

async fn get_orderbook(
    State(state): State<SharedState>,
    Path(symbol): Path<String>,
) -> (StatusCode, Json<Option<OrderBookDepth>>) {
    let symbol_upper = symbol.to_uppercase();
    if let Some(ob) = state.order_books.get(&symbol_upper) {
        let depth = ob.get_depth(20);
        (StatusCode::OK, Json(Some(depth)))
    } else {
        (StatusCode::OK, Json(None))
    }
}

async fn get_orderbook_depth(
    State(state): State<SharedState>,
    Path((symbol, levels)): Path<(String, usize)>,
) -> (StatusCode, Json<Option<OrderBookDepth>>) {
    let symbol_upper = symbol.to_uppercase();
    let levels = levels.min(100); // Cap at 100 levels
    if let Some(ob) = state.order_books.get(&symbol_upper) {
        let depth = ob.get_depth(levels);
        (StatusCode::OK, Json(Some(depth)))
    } else {
        (StatusCode::OK, Json(None))
    }
}

async fn get_trades(
    State(state): State<SharedState>,
    Path(symbol): Path<String>,
) -> (StatusCode, Json<Vec<crate::types::Trade>>) {
    let symbol_upper = symbol.to_uppercase();
    let trades = state
        .trades
        .get(&symbol_upper)
        .map(|t| t.clone())
        .unwrap_or_default();
    (StatusCode::OK, Json(trades))
}

async fn risk_check(
    State(state): State<SharedState>,
    Json(req): Json<RiskCheckRequest>,
) -> (StatusCode, Json<RiskCheckResponse>) {
    let side = match req.side.to_lowercase().as_str() {
        "buy" => OrderSide::Buy,
        "sell" => OrderSide::Sell,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(RiskCheckResponse {
                    passed: false,
                    errors: vec!["Invalid side".to_string()],
                }),
            );
        }
    };

    let order_type = match req.order_type.to_lowercase().as_str() {
        "limit" => OrderType::Limit,
        "market" => OrderType::Market,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(RiskCheckResponse {
                    passed: false,
                    errors: vec!["Invalid order_type".to_string()],
                }),
            );
        }
    };

    let symbol_upper = req.symbol.to_uppercase();
    let order = Order::new(&symbol_upper, side, order_type, req.price, req.quantity, 0);
    let current_price = state.market_data.get_price(&symbol_upper);
    let positions = PositionTracker::new(); // In production: load from DB

    match checker::check_order(&order, &state.risk_limits, &positions, current_price) {
        Ok(()) => (
            StatusCode::OK,
            Json(RiskCheckResponse {
                passed: true,
                errors: vec![],
            }),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(RiskCheckResponse {
                passed: false,
                errors: vec![e.to_string()],
            }),
        ),
    }
}

async fn get_price(
    State(state): State<SharedState>,
    Path(symbol): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let symbol_upper = symbol.to_uppercase();

    match state.market_data.get_price_data(&symbol_upper) {
        Some(price) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "symbol": symbol_upper,
                "best_bid": price.best_bid,
                "best_ask": price.best_ask,
                "best_bid_qty": price.best_bid_qty,
                "best_ask_qty": price.best_ask_qty,
                "mid_price": price.mid_price(),
                "timestamp": price.timestamp,
                "source": "binance_websocket"
            })),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "symbol": symbol_upper,
                "error": "No price data available yet",
                "source": "binance_websocket"
            })),
        ),
    }
}
/home/agent-lead/.profile: line 28: /home/agent-lead/.cargo/env: No such file or directory
