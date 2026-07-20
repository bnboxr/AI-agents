"""
Mean Reversion Strategy — Bollinger Bands (20,2) + RSI(14).

BUY  when price < lower band AND RSI < 30 (oversold).
SELL when price > upper band AND RSI > 70 (overbought).
"""

import numpy as np
import pandas as pd

from strategies.base import BaseStrategy, Signal, SignalType


class MeanReversionStrategy(BaseStrategy):
    name = "mean_reversion"
    description = "Bollinger Bands (20,2) + RSI(14) mean reversion."

    DEFAULT_BB_PERIOD = 20
    DEFAULT_BB_STD = 2.0
    DEFAULT_RSI_PERIOD = 14
    DEFAULT_RSI_OVERSOLD = 30
    DEFAULT_RSI_OVERBOUGHT = 70

    def _validate_params(self):
        self.bb_period = int(self.params.get("bb_period", self.DEFAULT_BB_PERIOD))
        self.bb_std = float(self.params.get("bb_std", self.DEFAULT_BB_STD))
        self.rsi_period = int(self.params.get("rsi_period", self.DEFAULT_RSI_PERIOD))
        self.rsi_oversold = int(self.params.get("rsi_oversold", self.DEFAULT_RSI_OVERSOLD))
        self.rsi_overbought = int(self.params.get("rsi_overbought", self.DEFAULT_RSI_OVERBOUGHT))

    @staticmethod
    def _compute_rsi(closes: pd.Series, period: int) -> pd.Series:
        """Wilder's RSI."""
        delta = closes.diff()
        gain = delta.clip(lower=0)
        loss = (-delta).clip(lower=0)
        avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        return 100.0 - (100.0 / (1.0 + rs))

    def generate_signal(self, data: pd.DataFrame) -> Signal:
        min_len = max(self.bb_period, self.rsi_period) + 1
        if len(data) < min_len:
            return Signal(SignalType.HOLD, reason=f"Not enough data (need {min_len})")

        closes = data["close"].astype(float)
        price = float(closes.iloc[-1])

        # Bollinger Bands
        sma = closes.rolling(window=self.bb_period).mean()
        std = closes.rolling(window=self.bb_period).std()
        upper = sma + self.bb_std * std
        lower = sma - self.bb_std * std

        curr_lower = float(lower.iloc[-1])
        curr_upper = float(upper.iloc[-1])

        # RSI
        rsi_series = self._compute_rsi(closes, self.rsi_period)
        curr_rsi = float(rsi_series.iloc[-1])

        # Oversold → BUY
        if price < curr_lower and curr_rsi < self.rsi_oversold:
            return Signal(
                SignalType.BUY,
                confidence=min(0.9, 1.0 - curr_rsi / 100.0),
                reason=f"Oversold: price({price:.2f}) < lower_band({curr_lower:.2f}), RSI({curr_rsi:.1f}) < {self.rsi_oversold}",
                price=price,
            )
        # Overbought → SELL
        elif price > curr_upper and curr_rsi > self.rsi_overbought:
            return Signal(
                SignalType.SELL,
                confidence=min(0.9, curr_rsi / 100.0),
                reason=f"Overbought: price({price:.2f}) > upper_band({curr_upper:.2f}), RSI({curr_rsi:.1f}) > {self.rsi_overbought}",
                price=price,
            )

        return Signal(SignalType.HOLD, reason="No mean reversion signal", price=price)
