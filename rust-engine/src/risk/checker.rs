use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use super::limits::RiskLimits;
use crate::orderbook::types::{Order, OrderSide, OrderType};

/// Errors that can occur during pre-trade risk checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RiskError {
    InsufficientBalance {
        required: f64,
        available: f64,
    },
    NoPositionToSell {
        symbol: String,
    },
    MaxPositionSizeExceeded {
        symbol: String,
        current: f64,
        max: f64,
        additional: f64,
    },
    MaxNotionalExceeded {
        symbol: String,
        notional: f64,
        max: f64,
    },
    MaxTotalExposureExceeded {
        current_exposure_pct: f64,
        max_exposure_pct: f64,
    },
    MaxDrawdownExceeded {
        current_drawdown_pct: f64,
        max_drawdown_pct: f64,
    },
    MarketOrderWithoutLiquidity {
        symbol: String,
    },
}

impl std::fmt::Display for RiskError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RiskError::InsufficientBalance { required, available } => {
                write!(f, "Insufficient balance: required {required}, available {available}")
            }
            RiskError::NoPositionToSell { symbol } => {
                write!(f, "No position to sell for {symbol}")
            }
            RiskError::MaxPositionSizeExceeded { symbol, current, max, additional } => {
                write!(
                    f,
                    "Max position size exceeded for {symbol}: current {current}, max {max}, additional {additional}"
                )
            }
            RiskError::MaxNotionalExceeded { symbol, notional, max } => {
                write!(f, "Max notional exceeded for {symbol}: {notional} > {max}")
            }
            RiskError::MaxTotalExposureExceeded { current_exposure_pct, max_exposure_pct } => {
                write!(
                    f,
                    "Max total exposure exceeded: {:.1}% > {:.1}%",
                    current_exposure_pct * 100.0,
                    max_exposure_pct * 100.0
                )
            }
            RiskError::MaxDrawdownExceeded { current_drawdown_pct, max_drawdown_pct } => {
                write!(
                    f,
                    "Max drawdown exceeded: {:.1}% > {:.1}%",
                    current_drawdown_pct * 100.0,
                    max_drawdown_pct * 100.0
                )
            }
            RiskError::MarketOrderWithoutLiquidity { symbol } => {
                write!(f, "Market order for {symbol} with no available liquidity")
            }
        }
    }
}

/// Current positions tracker. In production this would be backed by a database.
#[derive(Debug, Clone, Default)]
pub struct PositionTracker {
    /// symbol -> current position size (positive = long, negative = short)
    positions: std::collections::HashMap<String, f64>,
}

impl PositionTracker {
    pub fn new() -> Self {
        PositionTracker {
            positions: std::collections::HashMap::new(),
        }
    }

    /// Get current position for a symbol.
    pub fn get_position(&self, symbol: &str) -> f64 {
        self.positions.get(symbol).copied().unwrap_or(0.0)
    }

    /// Update position after a trade.
    pub fn update_position(&mut self, symbol: &str, side: &OrderSide, quantity: f64) {
        let entry = self.positions.entry(symbol.to_string()).or_insert(0.0);
        match side {
            OrderSide::Buy => *entry += quantity,
            OrderSide::Sell => *entry -= quantity,
        }
    }

    /// Total notional exposure across all positions (sum of absolute position values).
    pub fn total_exposure(&self) -> f64 {
        self.positions.values().map(|v| v.abs()).sum()
    }
}

/// Run all pre-trade risk checks. Returns Ok(()) if all checks pass.
pub fn check_order(
    order: &Order,
    limits: &RiskLimits,
    positions: &PositionTracker,
    current_price: Option<f64>,
) -> Result<(), RiskError> {
    let symbol_limits = limits.get_symbol_limits(&order.symbol);

    // 1. Drawdown check
    let drawdown = limits.current_drawdown();
    if drawdown > limits.max_drawdown_pct {
        warn!(
            "Max drawdown exceeded: {:.2}% > {:.2}%",
            drawdown * 100.0,
            limits.max_drawdown_pct * 100.0
        );
        return Err(RiskError::MaxDrawdownExceeded {
            current_drawdown_pct: drawdown,
            max_drawdown_pct: limits.max_drawdown_pct,
        });
    }

    // Calculate order notional value
    let price = match order.order_type {
        OrderType::Market => current_price.unwrap_or(0.0),
        OrderType::Limit => order.price,
    };
    let order_notional = price * order.quantity;

    match order.side {
        OrderSide::Buy => {
            // 2. Balance check
            if order_notional > limits.account_balance {
                return Err(RiskError::InsufficientBalance {
                    required: order_notional,
                    available: limits.account_balance,
                });
            }

            // 3. Notional check
            if order_notional > symbol_limits.max_notional {
                return Err(RiskError::MaxNotionalExceeded {
                    symbol: order.symbol.clone(),
                    notional: order_notional,
                    max: symbol_limits.max_notional,
                });
            }

            // 4. Position size check
            let current_position = positions.get_position(&order.symbol);
            let new_position = current_position + order.quantity;
            if new_position > symbol_limits.max_position_size {
                return Err(RiskError::MaxPositionSizeExceeded {
                    symbol: order.symbol.clone(),
                    current: current_position,
                    max: symbol_limits.max_position_size,
                    additional: order.quantity,
                });
            }

            // 5. Total exposure check
            let current_exposure = positions.total_exposure();
            let new_exposure = current_exposure + order_notional;
            let max_exposure = limits.account_balance * limits.max_total_exposure_pct;
            let new_exposure_pct = new_exposure / limits.account_balance;

            if new_exposure_pct > limits.max_total_exposure_pct {
                return Err(RiskError::MaxTotalExposureExceeded {
                    current_exposure_pct: new_exposure_pct,
                    max_exposure_pct: limits.max_total_exposure_pct,
                });
            }
        }
        OrderSide::Sell => {
            // 2. Position check — must have position to sell
            let current_position = positions.get_position(&order.symbol);
            if current_position < order.quantity {
                return Err(RiskError::NoPositionToSell {
                    symbol: order.symbol.clone(),
                });
            }

            // 3. Notional check
            if order_notional > symbol_limits.max_notional {
                return Err(RiskError::MaxNotionalExceeded {
                    symbol: order.symbol.clone(),
                    notional: order_notional,
                    max: symbol_limits.max_notional,
                });
            }
        }
    }

    // Market order check — warn if no liquidity estimate available
    if order.order_type == OrderType::Market && current_price.is_none() {
        info!(
            "Market order for {} — no current price available for liquidity check",
            order.symbol
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insufficient_balance() {
        let mut limits = RiskLimits::default();
        limits.account_balance = 1000.0;

        let order = Order::new("BTCUSDT", OrderSide::Buy, OrderType::Limit, 50000.0, 1.0, 1);
        let positions = PositionTracker::new();

        let result = check_order(&order, &limits, &positions, Some(50000.0));
        assert!(result.is_err());
        match result.unwrap_err() {
            RiskError::InsufficientBalance { required, available } => {
                assert_eq!(required, 50000.0);
                assert_eq!(available, 1000.0);
            }
            _ => panic!("Wrong error type"),
        }
    }

    #[test]
    fn test_no_position_to_sell() {
        let limits = RiskLimits::default();
        let order = Order::new("BTCUSDT", OrderSide::Sell, OrderType::Limit, 50000.0, 1.0, 1);
        let positions = PositionTracker::new();

        let result = check_order(&order, &limits, &positions, Some(50000.0));
        assert!(result.is_err());
        match result.unwrap_err() {
            RiskError::NoPositionToSell { .. } => {}
            _ => panic!("Wrong error type"),
        }
    }

    #[test]
    fn test_valid_buy_passes() {
        let limits = RiskLimits::default(); // 100k balance
        let order = Order::new("BTCUSDT", OrderSide::Buy, OrderType::Limit, 50000.0, 1.0, 1);
        let positions = PositionTracker::new();

        let result = check_order(&order, &limits, &positions, Some(50000.0));
        assert!(result.is_ok());
    }
}
