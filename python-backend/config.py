"""
HSMC Python Backend — Environment Configuration.

All values read from environment variables with sensible defaults.
No hardcoded secrets. No mock values.
"""

import os
from dotenv import load_dotenv

load_dotenv()


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (ValueError, TypeError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, default))
    except (ValueError, TypeError):
        return default


# Binance API (public endpoints work without keys)
BINANCE_API_KEY: str = _env("BINANCE_API_KEY")
BINANCE_SECRET: str = _env("BINANCE_SECRET")
BINANCE_BASE_URL: str = _env("BINANCE_BASE_URL", "https://api.binance.us")

# Backtesting defaults
BACKTEST_INITIAL_CAPITAL: float = _env_float("BACKTEST_INITIAL_CAPITAL", 10000.0)
BACKTEST_MAX_PAIRS: int = _env_int("BACKTEST_MAX_PAIRS", 20)
BACKTEST_COMMISSION: float = _env_float("BACKTEST_COMMISSION", 0.001)  # 0.1%
BACKTEST_SLIPPAGE: float = _env_float("BACKTEST_SLIPPAGE", 0.0005)  # 0.05%

# Walk-forward
WF_TRAIN_DAYS: int = _env_int("WF_TRAIN_DAYS", 60)
WF_TEST_DAYS: int = _env_int("WF_TEST_DAYS", 20)

# Rate limiting (Binance: 1200 req/min)
RATE_LIMIT_DELAY_MS: int = _env_int("RATE_LIMIT_DELAY_MS", 100)

# Server
PORT: int = _env_int("PORT", 8001)

# Cache
CACHE_DB_PATH: str = os.path.join(os.path.dirname(__file__), "backtesting", "cache.db")

# Supported symbols for backtesting
SUPPORTED_SYMBOLS: list[str] = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
    "ADAUSDT", "DOGEUSDT", "LTCUSDT", "XRPUSDT",
]

SUPPORTED_INTERVALS: list[str] = ["1m", "5m", "15m", "1h", "4h", "1d"]
