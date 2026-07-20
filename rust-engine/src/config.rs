use std::env;

/// Application configuration from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// Server listen address
    pub host: String,
    /// Server listen port
    pub port: u16,
    /// Binance WebSocket symbols to subscribe to (comma-separated)
    pub symbols: Vec<String>,
    /// Initial account balance for risk checks
    pub initial_balance: f64,
    /// Maximum total exposure as fraction of portfolio
    pub max_exposure_pct: f64,
    /// Maximum drawdown before trading halts
    pub max_drawdown_pct: f64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            host: "0.0.0.0".to_string(),
            port: 8002,
            symbols: vec![
                "btcusdt".to_string(),
                "ethusdt".to_string(),
                "solusdt".to_string(),
                "avaxusdt".to_string(),
                "maticusdt".to_string(),
                "arbusdt".to_string(),
                "opusdt".to_string(),
                "linkusdt".to_string(),
                "dogeusdt".to_string(),
                "suiusdt".to_string(),
            ],
            initial_balance: 100_000.0,
            max_exposure_pct: 0.8,
            max_drawdown_pct: 0.25,
        }
    }
}

impl Config {
    /// Load configuration from environment variables, falling back to defaults.
    pub fn from_env() -> Self {
        let mut config = Config::default();

        if let Ok(host) = env::var("HOST") {
            config.host = host;
        }

        if let Ok(port_str) = env::var("PORT") {
            if let Ok(port) = port_str.parse::<u16>() {
                config.port = port;
            }
        }

        if let Ok(symbols_str) = env::var("MARKET_SYMBOLS") {
            config.symbols = symbols_str
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect();
        }

        if let Ok(bal_str) = env::var("INITIAL_BALANCE") {
            if let Ok(bal) = bal_str.parse::<f64>() {
                config.initial_balance = bal;
            }
        }

        if let Ok(exp_str) = env::var("MAX_EXPOSURE_PCT") {
            if let Ok(exp) = exp_str.parse::<f64>() {
                config.max_exposure_pct = exp;
            }
        }

        if let Ok(dd_str) = env::var("MAX_DRAWDOWN_PCT") {
            if let Ok(dd) = dd_str.parse::<f64>() {
                config.max_drawdown_pct = dd;
            }
        }

        config
    }
}
/home/agent-lead/.profile: line 28: /home/agent-lead/.cargo/env: No such file or directory
