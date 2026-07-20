"""
Financial metrics calculator.

Computes real metrics: Sharpe, Sortino, Max Drawdown, Win Rate,
Profit Factor, Total Return, Avg Trade Duration.

All calculations are deterministic — no random values, no mocks.
"""

import math
import numpy as np
from typing import Optional


def sharpe_ratio(returns: list[float], risk_free_rate: float = 0.0) -> float:
    """
    Annualized Sharpe Ratio.

    Args:
        returns: list of periodic returns (e.g., daily).
        risk_free_rate: annual risk-free rate (default 0).
    """
    if not returns or len(returns) < 2:
        return 0.0
    arr = np.array(returns, dtype=np.float64)
    excess = arr - (risk_free_rate / 365)  # daily risk-free
    mean_excess = float(np.mean(excess))
    std_excess = float(np.std(excess, ddof=1))
    if std_excess == 0:
        return 0.0
    return (mean_excess / std_excess) * math.sqrt(365)


def sortino_ratio(returns: list[float], risk_free_rate: float = 0.0) -> float:
    """
    Annualized Sortino Ratio (downside deviation only).
    """
    if not returns or len(returns) < 2:
        return 0.0
    arr = np.array(returns, dtype=np.float64)
    excess = arr - (risk_free_rate / 365)
    downside = arr[arr < 0]
    if len(downside) < 2:
        return 0.0
    downside_std = float(np.std(downside, ddof=1))
    if downside_std == 0:
        return 0.0
    mean_excess = float(np.mean(excess))
    return (mean_excess / downside_std) * math.sqrt(365)


def max_drawdown(equity_curve: list[float]) -> float:
    """
    Maximum drawdown as a fraction (e.g., 0.25 = 25%).

    Peak-to-trough decline over the entire equity curve.
    """
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]
    mdd = 0.0
    for val in equity_curve:
        if val > peak:
            peak = val
        dd = (peak - val) / peak if peak > 0 else 0.0
        if dd > mdd:
            mdd = dd
    return mdd


def win_rate(trades: list[dict]) -> float:
    """
    Fraction of trades that were profitable.
    Each trade dict must have 'pnl' key (positive = win).
    """
    if not trades:
        return 0.0
    wins = sum(1 for t in trades if t.get("pnl", 0) > 0)
    return wins / len(trades)


def profit_factor(trades: list[dict]) -> float:
    """
    Gross profit / gross loss.
    """
    if not trades:
        return 0.0
    gross_profit = sum(t["pnl"] for t in trades if t.get("pnl", 0) > 0)
    gross_loss = abs(sum(t["pnl"] for t in trades if t.get("pnl", 0) < 0))
    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def total_return(initial_capital: float, final_equity: float) -> float:
    """Total return as a fraction."""
    if initial_capital <= 0:
        return 0.0
    return (final_equity - initial_capital) / initial_capital


def average_trade_duration(trades: list[dict]) -> float:
    """
    Average trade duration in hours.
    Each trade dict must have 'entry_time' and 'exit_time' (ms timestamps).
    """
    if not trades:
        return 0.0
    durations = []
    for t in trades:
        entry = t.get("entry_time", 0)
        exit_ = t.get("exit_time", 0)
        if entry and exit_ and exit_ > entry:
            durations.append((exit_ - entry) / (1000 * 60 * 60))  # ms → hours
    if not durations:
        return 0.0
    return sum(durations) / len(durations)


def compute_all_metrics(
    equity_curve: list[float],
    trades: list[dict],
    initial_capital: float,
) -> dict:
    """
    Compute the full metrics object from an equity curve and trade list.

    Returns a dict ready for API response.
    """
    returns = []
    for i in range(1, len(equity_curve)):
        if equity_curve[i - 1] > 0:
            ret = (equity_curve[i] - equity_curve[i - 1]) / equity_curve[i - 1]
            returns.append(ret)

    final_equity = equity_curve[-1] if equity_curve else initial_capital

    return {
        "sharpe_ratio": round(sharpe_ratio(returns), 4),
        "sortino_ratio": round(sortino_ratio(returns), 4),
        "max_drawdown_pct": round(max_drawdown(equity_curve) * 100, 2),
        "win_rate_pct": round(win_rate(trades) * 100, 2),
        "profit_factor": round(profit_factor(trades), 4),
        "total_return_pct": round(total_return(initial_capital, final_equity) * 100, 2),
        "total_trades": len(trades),
        "avg_trade_duration_hours": round(average_trade_duration(trades), 2),
        "initial_capital": initial_capital,
        "final_equity": round(final_equity, 2),
    }
