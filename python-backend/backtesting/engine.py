"""
Backtesting Engine — Real event-driven backtester.

Walks through historical candles bar-by-bar, executes strategy signals,
applies commission + slippage, and tracks equity curve + trades.

Zero mock data. Uses real Binance klines via backtesting.data.
"""

import math
from datetime import datetime
from typing import Optional

import pandas as pd

from backtesting.data import fetch_klines
from backtesting.metrics import compute_all_metrics
from strategies.base import Signal, SignalType
from strategies.trend_following import TrendFollowingStrategy
from strategies.mean_reversion import MeanReversionStrategy
from strategies.breakout import BreakoutStrategy
from config import BACKTEST_INITIAL_CAPITAL, BACKTEST_COMMISSION, BACKTEST_SLIPPAGE

STRATEGY_MAP = {
    "trend_following": TrendFollowingStrategy,
    "mean_reversion": MeanReversionStrategy,
    "breakout": BreakoutStrategy,
}


def _apply_commission(price: float, amount: float, side: str) -> float:
    """Return the cost of commission in quote currency."""
    return price * amount * BACKTEST_COMMISSION


def _apply_slippage(price: float, side: str) -> float:
    """Adjust price for slippage: buy gets worse, sell gets worse."""
    if side == "buy":
        return price * (1 + BACKTEST_SLIPPAGE)
    else:
        return price * (1 - BACKTEST_SLIPPAGE)


def run_backtest(
    symbol: str,
    strategy_name: str,
    interval: str = "1h",
    days: int = 30,
    initial_capital: Optional[float] = None,
    params: Optional[dict] = None,
) -> dict:
    """
    Run a full backtest on *symbol* using *strategy_name*.

    Args:
        symbol: e.g., 'BTCUSDT'.
        strategy_name: one of 'trend_following', 'mean_reversion', 'breakout'.
        interval: Binance kline interval.
        days: how many days of history to use.
        initial_capital: starting capital in USDT (default from config).
        params: strategy-specific parameters override.

    Returns:
        dict with keys: metrics, trades, equity_curve, config.
    """
    if strategy_name not in STRATEGY_MAP:
        raise ValueError(
            f"Unknown strategy: {strategy_name}. Available: {list(STRATEGY_MAP)}"
        )

    capital = initial_capital or BACKTEST_INITIAL_CAPITAL

    # Fetch real historical data
    raw = fetch_klines(symbol, interval, days)
    if len(raw) < 50:
        raise ValueError(
            f"Not enough data for {symbol} ({len(raw)} candles). Need at least 50."
        )

    # Build DataFrame
    df = pd.DataFrame(raw)
    df = df.rename(
        columns={
            "open_time": "timestamp",
            "open": "open",
            "high": "high",
            "low": "low",
            "close": "close",
            "volume": "volume",
        }
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df.sort_values("timestamp").reset_index(drop=True)
    required_cols = ["timestamp", "open", "high", "low", "close", "volume"]
    df = df[required_cols]

    # Instantiate strategy
    strategy_cls = STRATEGY_MAP[strategy_name]
    strategy = strategy_cls(params=params or {})

    # Simulation state
    cash = capital
    position = 0.0  # units of base asset
    equity_curve: list[float] = []
    trades: list[dict] = []
    in_trade = False
    entry_price = 0.0
    entry_time: Optional[datetime] = None

    # Walk through each candle
    for i in range(len(df)):
        row = df.iloc[i]
        price = float(row["close"])
        current_time = row["timestamp"].to_pydatetime()

        # Feed data window to strategy
        window = df.iloc[max(0, i - 99): i + 1].copy()
        signal: Signal = strategy.generate_signal(window)

        # Execute signal
        if signal.signal == SignalType.BUY and not in_trade:
            # Enter long
            entry_price_adj = _apply_slippage(price, "buy")
            position = cash / entry_price_adj
            commission = _apply_commission(entry_price_adj, position, "buy")
            cash = 0.0  # fully allocated
            cash -= commission  # pay commission from cash-equivalent
            if cash < 0:
                cash = 0.0
            entry_price = price
            entry_time = current_time
            in_trade = True

        elif signal.signal == SignalType.SELL and in_trade:
            # Exit position
            exit_price_adj = _apply_slippage(price, "sell")
            cash = position * exit_price_adj
            commission = _apply_commission(exit_price_adj, position, "sell")
            cash -= commission
            pnl = cash - capital
            trades.append({
                "entry_price": round(entry_price, 4),
                "exit_price": round(price, 4),
                "entry_time": int(entry_time.timestamp() * 1000) if entry_time else 0,
                "exit_time": int(current_time.timestamp() * 1000),
                "pnl": round(pnl, 4),
                "side": "long",
            })
            position = 0.0
            capital = cash  # update base for next trade PnL calc
            in_trade = False
            entry_price = 0.0
            entry_time = None

        # Track equity
        current_equity = cash + (position * price if in_trade else 0)
        equity_curve.append(current_equity)

    # Close any open position at last price
    if in_trade and position > 0:
        last_price = float(df.iloc[-1]["close"])
        exit_price_adj = _apply_slippage(last_price, "sell")
        cash = position * exit_price_adj
        commission = _apply_commission(exit_price_adj, position, "sell")
        cash -= commission
        pnl = cash - capital
        trades.append({
            "entry_price": round(entry_price, 4),
            "exit_price": round(last_price, 4),
            "entry_time": int(entry_time.timestamp() * 1000) if entry_time else 0,
            "exit_time": int(df.iloc[-1]["timestamp"].timestamp() * 1000),
            "pnl": round(pnl, 4),
            "side": "long",
        })
        equity_curve[-1] = cash  # update last equity point
        capital = cash

    metrics = compute_all_metrics(equity_curve, trades, initial_capital or BACKTEST_INITIAL_CAPITAL)

    return {
        "symbol": symbol,
        "strategy": strategy_name,
        "interval": interval,
        "days": days,
        "params": params or {},
        "metrics": metrics,
        "trades": trades,
        "equity_curve": [round(e, 2) for e in equity_curve],
    }
