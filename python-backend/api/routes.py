"""
REST API routes consumed by the HSMC TypeScript frontend.

All endpoints use real data — zero mock values.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backtesting.engine import run_backtest
from backtesting.metrics import compute_all_metrics
from backtesting.data import fetch_klines, klines_to_dicts
from ml.optimizer import grid_search, walk_forward_optimization
from ml.predictor import train_model, predict
from config import SUPPORTED_SYMBOLS, SUPPORTED_INTERVALS

router = APIRouter(prefix="/api")

# In-memory store for backtest results (production would use DB)
_results_store: dict[str, dict] = {}


# ── Request/Response models ──────────────────────────────────────────

class BacktestRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT", description="Trading pair, e.g. BTCUSDT")
    strategy: str = Field(default="trend_following", description="Strategy name")
    interval: str = Field(default="1h", description="Kline interval")
    days: int = Field(default=30, ge=1, le=365, description="Days of history")
    initial_capital: Optional[float] = Field(default=None, description="Starting capital in USDT")
    params: Optional[dict] = Field(default=None, description="Strategy parameter overrides")


class OptimizeRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    strategy: str = Field(default="trend_following")
    interval: str = Field(default="1h")
    days: int = Field(default=60, ge=1, le=365)
    metric: str = Field(default="sharpe_ratio")


class PredictRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    interval: str = Field(default="1h")
    days: int = Field(default=30, ge=1, le=365)


# ── Routes ───────────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {"status": "ok", "service": "HSMC Python Backend", "version": "1.0.0"}


@router.get("/strategies")
async def list_strategies():
    """Return available strategies with descriptions."""
    return {
        "strategies": [
            {
                "name": "trend_following",
                "description": "EMA 20/50 crossover — golden cross / death cross signals.",
                "params": ["ema_fast", "ema_slow"],
            },
            {
                "name": "mean_reversion",
                "description": "Bollinger Bands (20,2) + RSI(14) — oversold/overbought.",
                "params": ["bb_period", "bb_std", "rsi_period", "rsi_oversold", "rsi_overbought"],
            },
            {
                "name": "breakout",
                "description": "20-period high/low channel breakout.",
                "params": ["period"],
            },
        ]
    }


@router.post("/backtest")
async def run_backtest_endpoint(req: BacktestRequest):
    """Run a full backtest and return metrics, trades, and equity curve."""
    if req.symbol not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported symbol: {req.symbol}. Supported: {SUPPORTED_SYMBOLS}")
    if req.interval not in SUPPORTED_INTERVALS:
        raise HTTPException(400, f"Unsupported interval: {req.interval}")

    try:
        result = run_backtest(
            symbol=req.symbol,
            strategy_name=req.strategy,
            interval=req.interval,
            days=req.days,
            initial_capital=req.initial_capital,
            params=req.params,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Backtest failed: {str(e)}")

    # Store for retrieval
    result_id = str(uuid.uuid4())[:8]
    _results_store[result_id] = result

    return {"id": result_id, **result}


@router.get("/backtest/{result_id}")
async def get_backtest_result(result_id: str):
    """Retrieve a previously run backtest by ID."""
    result = _results_store.get(result_id)
    if not result:
        raise HTTPException(404, f"Backtest {result_id} not found")
    return result


@router.post("/optimize")
async def optimize_endpoint(req: OptimizeRequest):
    """Run grid search optimization for strategy parameters."""
    try:
        result = grid_search(
            symbol=req.symbol,
            strategy_name=req.strategy,
            interval=req.interval,
            days=req.days,
            metric=req.metric,
        )
    except Exception as e:
        raise HTTPException(500, f"Optimization failed: {str(e)}")
    return result


@router.post("/optimize/walk-forward")
async def walk_forward_endpoint(req: OptimizeRequest):
    """Run walk-forward optimization."""
    try:
        result = walk_forward_optimization(
            symbol=req.symbol,
            strategy_name=req.strategy,
            interval=req.interval,
            total_days=req.days,
        )
    except Exception as e:
        raise HTTPException(500, f"Walk-forward optimization failed: {str(e)}")
    return result


@router.get("/metrics/{symbol}")
async def get_market_metrics(symbol: str, interval: str = "1h", days: int = 7):
    """Get current market metrics for a symbol (volatility, volume profile, etc.)."""
    if symbol not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported symbol: {symbol}")

    try:
        raw = fetch_klines(symbol, interval, days)
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch data: {str(e)}")

    if not raw:
        raise HTTPException(404, f"No data for {symbol}")

    closes = [float(c["close"]) for c in raw]
    volumes = [float(c["volume"]) for c in raw]
    highs = [float(c["high"]) for c in raw]
    lows = [float(c["low"]) for c in raw]

    # Basic stats
    import statistics
    returns = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0:
            returns.append((closes[i] - closes[i - 1]) / closes[i - 1])

    volatility = statistics.stdev(returns) * (365 ** 0.5) if len(returns) > 1 else 0.0

    return {
        "symbol": symbol,
        "interval": interval,
        "candles": len(raw),
        "current_price": closes[-1] if closes else None,
        "high_period": max(highs) if highs else None,
        "low_period": min(lows) if lows else None,
        "avg_volume": sum(volumes) / len(volumes) if volumes else 0.0,
        "volatility_annualized": round(volatility * 100, 2),
        "price_change_pct": round(((closes[-1] - closes[0]) / closes[0]) * 100, 2) if len(closes) > 1 else 0.0,
    }


@router.post("/predict")
async def predict_endpoint(req: PredictRequest):
    """Train a quick LSTM model and return price direction prediction."""
    try:
        result = predict(
            symbol=req.symbol,
            interval=req.interval,
            days=req.days,
        )
    except RuntimeError as e:
        raise HTTPException(501, f"ML not available: {str(e)}")
    except Exception as e:
        raise HTTPException(500, f"Prediction failed: {str(e)}")
    return result


@router.post("/predict/train")
async def train_endpoint(req: PredictRequest):
    """Full LSTM training run with detailed metrics."""
    try:
        result = train_model(
            symbol=req.symbol,
            interval=req.interval,
            days=req.days,
            epochs=20,
        )
    except RuntimeError as e:
        raise HTTPException(501, f"ML not available: {str(e)}")
    except Exception as e:
        raise HTTPException(500, f"Training failed: {str(e)}")
    return result
