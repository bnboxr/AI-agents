"""
Historical data fetcher using Binance public API (no API key required).

Fetches real klines/candles, caches them in SQLite, respects rate limits.
No mocks, no simulations — 100% real market data.
"""

import time
import sqlite3
import requests
from typing import Optional
from datetime import datetime, timedelta

from config import (
    BINANCE_BASE_URL,
    RATE_LIMIT_DELAY_MS,
    CACHE_DB_PATH,
    SUPPORTED_SYMBOLS,
    SUPPORTED_INTERVALS,
)


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(CACHE_DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS klines (
            symbol TEXT NOT NULL,
            interval TEXT NOT NULL,
            open_time INTEGER NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL NOT NULL,
            close_time INTEGER NOT NULL,
            quote_volume REAL NOT NULL,
            trades INTEGER NOT NULL,
            taker_buy_base REAL NOT NULL,
            taker_buy_quote REAL NOT NULL,
            ignored REAL NOT NULL,
            PRIMARY KEY (symbol, interval, open_time)
        )"""
    )
    conn.commit()
    return conn


def _cache_get(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    """Return cached rows that fall within [start_ms, end_ms)."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT * FROM klines
           WHERE symbol=? AND interval=? AND open_time >= ? AND open_time < ?
           ORDER BY open_time ASC""",
        (symbol, interval, start_ms, end_ms),
    ).fetchall()
    conn.close()
    cols = [
        "symbol", "interval", "open_time", "open", "high", "low",
        "close", "volume", "close_time", "quote_volume", "trades",
        "taker_buy_base", "taker_buy_quote", "ignored",
    ]
    return [dict(zip(cols, r)) for r in rows]


def _cache_put(symbol: str, interval: str, candles: list[list]) -> None:
    """Insert candles. Each candle is a Binance kline list of 12 values."""
    conn = _get_conn()
    for c in candles:
        conn.execute(
            """INSERT OR REPLACE INTO klines
               (symbol, interval, open_time, open, high, low, close, volume,
                close_time, quote_volume, trades, taker_buy_base, taker_buy_quote, ignored)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [symbol, interval, *c],
        )
    conn.commit()
    conn.close()


def _binance_server_time() -> int:
    """Get current server time from Binance in milliseconds."""
    try:
        resp = requests.get(f"{BINANCE_BASE_URL}/api/v3/time", timeout=10)
        resp.raise_for_status()
        return resp.json()["serverTime"]
    except Exception:
        # Fallback to system time if Binance is unreachable
        return int(datetime.utcnow().timestamp() * 1000)


def fetch_klines(
    symbol: str,
    interval: str,
    days: int,
    end_time_ms: Optional[int] = None,
) -> list[dict]:
    """
    Fetch real klines from Binance for *symbol* over *days* calendar days.

    Uses local SQLite cache; only fetches gaps from Binance.
    Returns list of dicts with keys: open_time, open, high, low, close, volume, close_time.
    """
    if symbol not in SUPPORTED_SYMBOLS:
        raise ValueError(f"Unsupported symbol: {symbol}. Supported: {SUPPORTED_SYMBOLS}")
    if interval not in SUPPORTED_INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}. Supported: {SUPPORTED_INTERVALS}")

    if end_time_ms is None:
        end_time_ms = _binance_server_time()

    start_ms = end_time_ms - int(days * 24 * 60 * 60 * 1000)

    # Check cache first
    cached = _cache_get(symbol, interval, start_ms, end_time_ms)
    if cached:
        return cached

    # Fetch from Binance in batches (max 1000 candles per request)
    url = f"{BINANCE_BASE_URL}/api/v3/klines"
    all_candles: list[list] = []
    fetch_start = start_ms

    while fetch_start < end_time_ms:
        params = {
            "symbol": symbol,
            "interval": interval,
            "startTime": fetch_start,
            "endTime": end_time_ms,
            "limit": 1000,
        }
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        all_candles.extend(batch)
        fetch_start = batch[-1][6] + 1  # close_time + 1ms
        time.sleep(RATE_LIMIT_DELAY_MS / 1000.0)

    # Cache and return
    if all_candles:
        _cache_put(symbol, interval, all_candles)

    result = _cache_get(symbol, interval, start_ms, end_time_ms)
    return result


def klines_to_dicts(candles: list[list]) -> list[dict]:
    """Convert raw Binance kline lists to dicts with named fields."""
    return [
        {
            "open_time": c[0],
            "open": float(c[1]),
            "high": float(c[2]),
            "low": float(c[3]),
            "close": float(c[4]),
            "volume": float(c[5]),
            "close_time": c[6],
            "quote_volume": float(c[7]),
            "trades": c[8],
        }
        for c in candles
    ]
