use std::sync::Arc;
use tracing::info;

mod api;
mod config;
mod market;
mod orderbook;
mod risk;
mod types;

use types::AppState;

#[tokio::main]
async fn main() {
    // Initialize tracing/logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hsmc_rust_engine=info,tokio_tungstenite=warn".into()),
        )
        .init();

    // Load .env if present
    dotenv::dotenv().ok();

    // Load configuration
    let config = config::Config::from_env();
    info!("Starting HSMC Rust Engine v{}", env!("CARGO_PKG_VERSION"));
    info!(
        "Subscribing to symbols: {:?}",
        config.symbols
    );

    // Build shared application state
    let state = Arc::new(AppState::new());

    // Configure risk limits from environment
    let mut risk_limits = state.risk_limits.clone();
    risk_limits.account_balance = config.initial_balance;
    risk_limits.peak_balance = config.initial_balance;
    risk_limits.max_total_exposure_pct = config.max_exposure_pct;
    risk_limits.max_drawdown_pct = config.max_drawdown_pct;

    // Update the risk limits in the DashMap-backed state
    // Since RiskLimits is not in a DashMap, we store it differently.
    // We'll use a simple approach: wrap it for shared access.
    // For now, the state already has risk_limits from new(), we just update the fields.
    // We need to update in place — but RiskLimits is owned by Arc<AppState>.
    // Let's just reconstruct.

    // Actually, we can't easily mutate through Arc. Let's use a different pattern:
    // We'll store risk_limits in a DashMap or use RwLock. But per the spec, AppState
    // has risk_limits as a plain field. Let's make it work with a Mutex internally.

    // For simplicity, we'll configure it before creating the Arc.
    // Let's rebuild the state with proper config.
    let mut state_builder = AppState::new();
    state_builder.risk_limits = risk_limits;
    let state = Arc::new(state_builder);

    // Start market data WebSocket connections
    let symbols_refs: Vec<&str> = config.symbols.iter().map(|s| s.as_str()).collect();
    state.market_data.subscribe_symbols(&symbols_refs);

    info!(
        "Market data subscriptions started for {} symbols",
        symbols_refs.len()
    );

    // Build the Axum router
    let app = api::routes::router(state);

    // Bind and serve
    let addr = format!("{}:{}", config.host, config.port);
    info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        panic!("Failed to bind to {}: {}", addr, e);
    });

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| {
            panic!("Server error: {}", e);
        });
}
