"""
Base strategy class.

All strategies inherit from this and implement generate_signal().
"""

from enum import Enum
from dataclasses import dataclass
from typing import Optional

import pandas as pd


class SignalType(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


@dataclass
class Signal:
    signal: SignalType = SignalType.HOLD
    confidence: float = 0.0  # 0..1
    reason: str = ""
    price: Optional[float] = None


class BaseStrategy:
    """
    Abstract base for all trading strategies.

    Subclasses override generate_signal(data) → Signal.
    """

    name: str = "base"
    description: str = "Base strategy"

    def __init__(self, params: Optional[dict] = None):
        self.params = params or {}
        self._validate_params()

    def _validate_params(self):
        """Override to validate strategy params."""
        pass

    def generate_signal(self, data: pd.DataFrame) -> Signal:
        """
        Given a DataFrame of candles (must include: open, high, low, close, volume,
        with a datetime index or timestamp column), return a Signal.
        """
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"{self.name}(params={self.params})"
