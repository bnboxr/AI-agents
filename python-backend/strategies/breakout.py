"""
Breakout Strategy — 20-period high/low channel.

BUY  when price breaks above 20-period high (breakout to upside).
SELL when price breaks below 20-period low (breakdown).
"""

import pandas as pd

from strategies.base import BaseStrategy, Signal, SignalType


class BreakoutStrategy(BaseStrategy):
    name = "breakout"
    description = "20-period high/low channel breakout."

    DEFAULT_CHANNEL_PERIOD = 20

    def _validate_params(self):
        self.period = int(self.params.get("period", self.DEFAULT_CHANNEL_PERIOD))
        if self.period < 2:
            raise ValueError("period must be >= 2")

    def generate_signal(self, data: pd.DataFrame) -> Signal:
        if len(data) < self.period + 1:
            return Signal(SignalType.HOLD, reason=f"Not enough data (need {self.period + 1})")

        highs = data["high"].astype(float)
        lows = data["low"].astype(float)
        price = float(data["close"].iloc[-1])

        # Channel: highest high and lowest low over last `period` candles (excluding current)
        channel_high = float(highs.iloc[-(self.period + 1):-1].max())
        channel_low = float(lows.iloc[-(self.period + 1):-1].min())

        # Previous price (to detect break)
        prev_price = float(data["close"].iloc[-2])

        # Breakout: current price > channel high AND previous was below/at
        if price > channel_high and prev_price <= channel_high:
            return Signal(
                SignalType.BUY,
                confidence=0.65,
                reason=f"Breakout: price({price:.2f}) broke above {self.period}-period high({channel_high:.2f})",
                price=price,
            )
        # Breakdown: current price < channel low AND previous was above/at
        elif price < channel_low and prev_price >= channel_low:
            return Signal(
                SignalType.SELL,
                confidence=0.65,
                reason=f"Breakdown: price({price:.2f}) broke below {self.period}-period low({channel_low:.2f})",
                price=price,
            )

        return Signal(SignalType.HOLD, reason="No breakout signal", price=price)
