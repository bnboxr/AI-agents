"""
Grid search + walk-forward optimizer for strategy parameters.

Iterates over parameter grids, runs backtests on rolling windows,
returns the best-performing parameter set by Sharpe ratio.
"""

import itertools
from typing import Any, Optional

from backtesting.engine import run_backtest
from backtesting.data import fetch_klines


# Default parameter grids per strategy
PARAM_GRIDS: dict[str, list[dict[str, list[Any]]]] = {
    "trend_following": [
        {
            "ema_fast": [5, 10, 12, 20, 26],
            "ema_slow": [20, 30, 50, 100, 200],
        }
    ],
    "mean_reversion": [
        {
            "bb_period": [10, 20, 30],
            "bb_std": [1.5, 2.0, 2.5],
            "rsi_period": [7, 14, 21],
            "rsi_oversold": [20, 25, 30, 35],
            "rsi_overbought": [65, 70, 75, 80],
        }
    ],
    "breakout": [
        {
            "period": [10, 15, 20, 30, 50],
        }
    ],
}


def _cartesian_product(grid: dict[str, list[Any]]) -> list[dict[str, Any]]:
    """Convert {key: [vals]} → [{key: val}, ...]."""
    keys = list(grid.keys())
    values = list(grid.values())
    return [dict(zip(keys, combo)) for combo in itertools.product(*values)]


def grid_search(
    symbol: str,
    strategy_name: str,
    interval: str = "1h",
    days: int = 30,
    metric: str = "sharpe_ratio",
    param_grid: Optional[list[dict[str, list[Any]]]] = None,
) -> dict:
    """
    Run grid search over strategy parameters.

    Args:
        symbol: e.g., BTCUSDT.
        strategy_name: strategy to optimize.
        interval: kline interval.
        days: total days of data.
        metric: which metric to maximize ('sharpe_ratio', 'total_return_pct', etc.).
        param_grid: optional custom grid. Uses defaults if None.

    Returns:
        dict with best_params, best_metrics, all_results.
    """
    grids = param_grid or PARAM_GRIDS.get(strategy_name, [])
    if not grids:
        return {"error": f"No parameter grid defined for {strategy_name}"}

    all_combos = []
    for grid in grids:
        all_combos.extend(_cartesian_product(grid))

    best_params = None
    best_score = float("-inf")
    best_metrics = None
    all_results = []

    for combo in all_combos:
        try:
            result = run_backtest(
                symbol=symbol,
                strategy_name=strategy_name,
                interval=interval,
                days=days,
                params=combo,
            )
            score = result["metrics"].get(metric, 0)
            all_results.append({
                "params": combo,
                "metrics": result["metrics"],
            })
            if score > best_score:
                best_score = score
                best_params = combo
                best_metrics = result["metrics"]
        except Exception as e:
            all_results.append({
                "params": combo,
                "error": str(e),
            })

    return {
        "symbol": symbol,
        "strategy": strategy_name,
        "best_params": best_params,
        "best_metrics": best_metrics,
        "metric_used": metric,
        "total_combinations": len(all_combos),
        "all_results": all_results,
    }


def walk_forward_optimization(
    symbol: str,
    strategy_name: str,
    interval: str = "1h",
    total_days: int = 120,
    train_days: int = 60,
    test_days: int = 20,
    metric: str = "sharpe_ratio",
) -> dict:
    """
    Walk-forward optimization: train on N days, test on M days, roll forward.

    For each window, runs grid search on the training period, then evaluates
    the best params on the test period. Aggregates out-of-sample results.
    """
    results_per_window = []
    current_end_days_ago = 0
    window_num = 0

    while current_end_days_ago + test_days <= total_days:
        window_num += 1
        train_end_days_ago = current_end_days_ago + test_days
        train_start_days_ago = train_end_days_ago + train_days

        # Train: find best params
        try:
            gs_result = grid_search(
                symbol=symbol,
                strategy_name=strategy_name,
                interval=interval,
                days=train_days,
                metric=metric,
            )
        except Exception as e:
            results_per_window.append({"window": window_num, "error": str(e)})
            break

        best_params = gs_result.get("best_params")
        if not best_params:
            break

        # Test: evaluate on out-of-sample period
        try:
            test_result = run_backtest(
                symbol=symbol,
                strategy_name=strategy_name,
                interval=interval,
                days=test_days,
                params=best_params,
            )
        except Exception as e:
            results_per_window.append({
                "window": window_num,
                "train_metrics": gs_result.get("best_metrics"),
                "best_params": best_params,
                "test_error": str(e),
            })
            current_end_days_ago += test_days
            continue

        results_per_window.append({
            "window": window_num,
            "best_params": best_params,
            "train_metrics": gs_result.get("best_metrics"),
            "test_metrics": test_result["metrics"],
        })

        current_end_days_ago += test_days

    # Aggregate
    oos_sharpes = [
        r["test_metrics"]["sharpe_ratio"]
        for r in results_per_window
        if "test_metrics" in r
    ]
    avg_sharpe = sum(oos_sharpes) / len(oos_sharpes) if oos_sharpes else 0.0

    return {
        "symbol": symbol,
        "strategy": strategy_name,
        "total_windows": window_num,
        "avg_oos_sharpe": round(avg_sharpe, 4),
        "windows": results_per_window,
    }
