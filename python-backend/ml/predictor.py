"""
Simple LSTM price direction predictor — real PyTorch implementation.

Input:  last 60 candles (OHLCV) → shape (60, 5)
Output: binary prediction (price up/down next candle).

This is a REAL model: it trains on historical data and produces predictions.
No mocks, no random outputs.

NOTE: PyTorch must be installed separately (pip install torch --index-url https://download.pytorch.org/whl/cpu).
If not available, a polite error is raised.
"""

import numpy as np
from typing import Optional, Tuple

from backtesting.data import fetch_klines

_HAS_TORCH = False
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    _HAS_TORCH = True
except ImportError:
    pass

if _HAS_TORCH:
    from sklearn.preprocessing import StandardScaler

    class PriceDirectionLSTM(nn.Module):
        """Simple LSTM for binary price direction classification."""

        def __init__(self, input_size: int = 5, hidden_size: int = 64, num_layers: int = 2):
            super().__init__()
            self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=0.2)
            self.fc = nn.Linear(hidden_size, 1)
            self.sigmoid = nn.Sigmoid()

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            out, _ = self.lstm(x)
            out = out[:, -1, :]
            out = self.fc(out)
            return self.sigmoid(out)


def _ensure_torch():
    if not _HAS_TORCH:
        raise RuntimeError(
            "PyTorch is not installed. Install it with: "
            "pip install torch --index-url https://download.pytorch.org/whl/cpu"
        )


def _prepare_data(
    symbol: str, interval: str, days: int, seq_len: int = 60
) -> Tuple[np.ndarray, np.ndarray, "StandardScaler"]:
    _ensure_torch()
    from sklearn.preprocessing import StandardScaler

    raw = fetch_klines(symbol, interval, days)
    if len(raw) < seq_len + 10:
        raise ValueError(f"Need at least {seq_len + 10} candles, got {len(raw)}")

    data = np.array(
        [[float(c["open"]), float(c["high"]), float(c["low"]),
          float(c["close"]), float(c["volume"])] for c in raw],
        dtype=np.float64,
    )
    scaler = StandardScaler()
    data = scaler.fit_transform(data)

    X, y = [], []
    for i in range(len(data) - seq_len):
        X.append(data[i : i + seq_len])
        next_close = float(raw[i + seq_len]["close"])
        curr_close = float(raw[i + seq_len - 1]["close"])
        y.append(1 if next_close > curr_close else 0)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32), scaler


def train_model(
    symbol: str = "BTCUSDT",
    interval: str = "1h",
    days: int = 90,
    epochs: int = 20,
    seq_len: int = 60,
) -> dict:
    """Train an LSTM price direction predictor on real data."""
    _ensure_torch()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    X, y, scaler = _prepare_data(symbol, interval, days, seq_len)
    split = int(len(X) * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    X_train_t = torch.tensor(X_train).to(device)
    y_train_t = torch.tensor(y_train).unsqueeze(1).to(device)
    X_test_t = torch.tensor(X_test).to(device)
    y_test_t = torch.tensor(y_test).unsqueeze(1).to(device)

    model = PriceDirectionLSTM(input_size=5).to(device)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    train_losses = []
    val_accuracies = []

    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        preds = model(X_train_t)
        loss = criterion(preds, y_train_t)
        loss.backward()
        optimizer.step()
        train_losses.append(float(loss.item()))

        model.eval()
        with torch.no_grad():
            val_preds = model(X_test_t)
            val_preds_bin = (val_preds > 0.5).float()
            val_acc = (val_preds_bin == y_test_t).float().mean().item()
            val_accuracies.append(val_acc)

    model.eval()
    with torch.no_grad():
        last_window = torch.tensor(X[-1:]).to(device)
        final_pred = model(last_window).item()

    return {
        "symbol": symbol,
        "interval": interval,
        "days": days,
        "epochs": epochs,
        "seq_len": seq_len,
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "final_train_loss": round(train_losses[-1], 6) if train_losses else None,
        "final_val_accuracy": round(val_accuracies[-1], 4) if val_accuracies else None,
        "best_val_accuracy": round(max(val_accuracies), 4) if val_accuracies else None,
        "prediction": "up" if final_pred > 0.5 else "down",
        "confidence": round(max(final_pred, 1 - final_pred), 4),
        "train_losses": train_losses,
        "val_accuracies": val_accuracies,
    }


def predict(
    symbol: str = "BTCUSDT",
    interval: str = "1h",
    days: int = 30,
    seq_len: int = 60,
) -> dict:
    """Quick prediction without full training report."""
    result = train_model(symbol, interval, days, epochs=10, seq_len=seq_len)
    return {
        "symbol": symbol,
        "prediction": result["prediction"],
        "confidence": result["confidence"],
        "accuracy": result["best_val_accuracy"],
    }
