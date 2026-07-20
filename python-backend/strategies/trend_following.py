"""
Trend Following Strategy — EMA 20/50 crossover.

BUY  when EMA20 crosses above EMA50 (golden cross).
SELL when EMA20 crosses below EMA50 (death cross).
"""

import pandas as pd

from strategies.base import BaseStrategy, Signal, SignalType


class TrendFollowingStrategy(BaseStrategy):
    name = "trend_following"
    description = "EMA 20/50 crossover with golden cross / death cross signals."

    DEFAULT_EMA_FAST = 20
    DEFAULT_EMA_SLOW = 50

    def _validate_params(self):
        self.ema_fast = int(self.params.get("ema_fast", self.DEFAULT_EMA_FAST))
        self.ema_slow = int(self.params.get("ema_slow", self.DEFAULT_EMA_SLOW))
        if self.ema_fast >= self.ema_slow:
            raise ValueError("ema_fast must be less than ema_slow")
        if self.ema_fast < 2:
            raise ValueError("ema_fast must be >= 2")

    def generate_signal(self, data: pd.DataFrame) -> Signal:
        if len(data) < self.ema_slow + 1:
            return Signal(SignalType.HOLD, reason=f"Not enough data (need {self.ema_slow + 1})")

        closes = data["close"].astype(float)
        ema_fast = closes.ewm(span=self.ema_fast, adjust=False).mean()
        ema_slow = closes.ewm(span=self.ema_slow, adjust=False).mean()

        # Current and previous values
        curr_fast = float(ema_fast.iloc[-1])
        curr_slow = float(ema_slow.iloc[-1])
        prev_fast = float(ema_fast.iloc[-2])
        prev_slow = float(ema_slow.iloc[-2])

        price = float(closes.iloc[-1])

        # Golden cross: fast crosses above slow
        if prev_fast <= prev_slow and curr_fast > curr_slow:
            return Signal(
                SignalType.BUY,
                confidence=0.7,
                reason=f"Golden cross: EMA{self.ema_fast}({curr_fast:.2f}) crossed above EMA{self.ema_slow}({curr_slow:.2f})",
                price=price,
            )
        # Death cross: fast crosses below slow
        elif prev_fast >= prev_slow and curr_fast < curr_slow:
            return Signal(
                SignalType.SELL,
                confidence=0.7,
                reason=f"Death cross: EMA{self.ema_fast}({curr_fast:.2f}) crossed below EMA{self.ema_slow}({curr_slow:.2f})",
                price=price,
            )

        return Signal(SignalType.HOLD, reason="No crossover detected", price=price)
