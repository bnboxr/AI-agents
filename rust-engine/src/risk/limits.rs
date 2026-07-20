use serde::{Deserialize, Serialize};

/// Per-symbol position limit configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolLimits {
    /// Maximum position size (in base asset units) allowed for this symbol.
    pub max_position_size: f64,
    /// Maximum notional value allowed for this symbol.
    pub max_notional: f64,
    /// Maximum leverage allowed for this symbol.
    pub max_leverage: f64,
}

impl Default for SymbolLimits {
    fn default() -> Self {
        SymbolLimits {
            max_position_size: 100.0,
            max_notional: 1_000_000.0,
            max_leverage: 5.0,
        }
    }
}

/// Global risk limits configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimits {
    /// Maximum total exposure as fraction of portfolio (e.g., 0.8 = 80%).
    pub max_total_exposure_pct: f64,
    /// Maximum drawdown before trading is halted (as fraction, e.g. 0.25 = 25%).
    pub max_drawdown_pct: f64,
    /// Per-symbol limits.
    pub symbol_limits: std::collections::HashMap<String, SymbolLimits>,
    /// Account balance used for pre-trade checks.
    pub account_balance: f64,
    /// Peak account balance (for drawdown calculation).
    pub peak_balance: f64,
}

impl Default for RiskLimits {
    fn default() -> Self {
        RiskLimits {
            max_total_exposure_pct: 0.8,
            max_drawdown_pct: 0.25,
            symbol_limits: std::collections::HashMap::new(),
            account_balance: 100_000.0,
            peak_balance: 100_000.0,
        }
    }
}

impl RiskLimits {
    /// Get symbol limits, falling back to defaults if not configured.
    pub fn get_symbol_limits(&self, symbol: &str) -> SymbolLimits {
        self.symbol_limits
            .get(symbol)
            .cloned()
            .unwrap_or_default()
    }

    /// Current drawdown as a fraction (0.0 = at peak, 1.0 = wiped out).
    pub fn current_drawdown(&self) -> f64 {
        if self.peak_balance <= 0.0 {
            return 0.0;
        }
        1.0 - (self.account_balance / self.peak_balance)
    }
}
