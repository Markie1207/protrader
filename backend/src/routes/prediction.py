"""
routes/prediction.py — AI 股價預測 API（v2 XGBoost 行業模型）
訊號來源：protrader-ai results/signals/YYYY-MM-DD.json（由 generate_signals.py 產生）
歷史股價：TWSE get_stock_daily()
"""

import hashlib
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request
from src.data_sources import twse

prediction_bp = Blueprint('prediction', __name__, url_prefix='/api/prediction')

_SIGNALS_DIR = Path(__file__).parents[3] / "results" / "signals"


def _load_latest_signals() -> tuple[dict, str]:
    """載入最新訊號 JSON，回傳 (signals_by_ticker, signal_date)。"""
    try:
        files = sorted(_SIGNALS_DIR.glob("*.json"), reverse=True)
        if not files:
            return {}, "N/A"
        with open(files[0], encoding="utf-8") as f:
            data = json.load(f)
        sig_date = data.get("date", files[0].stem)
        by_ticker = {s["ticker"]: s for s in data.get("signals", [])}
        return by_ticker, sig_date
    except Exception:
        return {}, "N/A"


def _latest_signal(ticker: str) -> dict:
    by_ticker, sig_date = _load_latest_signals()
    if ticker in by_ticker:
        s = by_ticker[ticker]
        s["signal_date"] = sig_date
        return s
    return {
        "direction": 0, "confidence": 0.5,
        "xgb_prob": 0.5, "lstm_prob": 0.5, "tcn_prob": 0.5,
        "ppo_action": 0, "model": "neutral", "signal_date": sig_date,
    }


def _roc_to_iso(date_str: str) -> str:
    parts = date_str.split('-')
    if len(parts) == 3 and len(parts[0]) <= 3:
        return f"{int(parts[0]) + 1911}-{parts[1]}-{parts[2]}"
    return date_str


def _actual_prices(ticker: str, n: int = 10) -> list[dict]:
    candles = twse.get_stock_daily(ticker, months=1)
    recent = candles[-n:] if len(candles) >= n else candles
    return [{"date": _roc_to_iso(c["date"]), "close": c["close"]} for c in recent]


def _next_trading_day(dt: datetime) -> datetime:
    dt += timedelta(days=1)
    while dt.weekday() >= 5:
        dt += timedelta(days=1)
    return dt


def _predicted_prices(actual: list[dict], signal: dict, n: int = 5) -> list[dict]:
    if not actual:
        return []
    direction  = int(signal.get("direction", 0))
    confidence = float(signal.get("confidence", 0.5))
    closes     = [float(p["close"]) for p in actual]
    last_close = closes[-1]
    last_date  = datetime.strptime(actual[-1]["date"], "%Y-%m-%d")

    if len(closes) >= 3:
        rets = [(closes[i] - closes[i-1]) / max(closes[i-1], 1e-8) for i in range(1, len(closes))]
        hist_vol = max(0.003, min((sum(r**2 for r in rets) / len(rets))**0.5, 0.04))
    else:
        hist_vol = 0.005

    if len(closes) >= 4:
        momentum = max(-0.01, min(
            sum((closes[i]-closes[i-1]) / max(closes[i-1], 1e-8)
                for i in range(len(closes)-3, len(closes))) / 3, 0.01))
    else:
        momentum = 0.0

    seed = int(hashlib.md5(f"{actual[-1]['date']}_{len(closes)}".encode()).hexdigest()[:8], 16)
    rng  = random.Random(seed)

    result, price, dt = [], last_close, last_date
    for i in range(n):
        decay      = 0.75 ** i
        trend      = hist_vol * direction * confidence * decay * 0.7 + momentum * 0.3
        noise      = rng.gauss(0, hist_vol * (1.0 + i * 0.25) * 0.55)
        dt    = _next_trading_day(dt)
        price = round(price * (1 + trend + noise), 1)
        result.append({"date": dt.strftime("%Y-%m-%d"), "close": price})
    return result


@prediction_bp.route('/stocks')
def list_stocks():
    """回傳所有有訊號的股票清單（從最新 JSON 動態讀取）。"""
    by_ticker, sig_date = _load_latest_signals()
    stocks = [
        {"ticker": t, "name": s.get("name", t), "industry": s.get("industry", ""),
         "confidence": s.get("confidence", 0.5), "direction": s.get("direction", 0)}
        for t, s in by_ticker.items()
    ]
    # 預設只回傳買入訊號，可用 ?all=1 取全部
    show_all = request.args.get("all", "0") == "1"
    if not show_all:
        stocks = [s for s in stocks if s["direction"] == 1]
    stocks.sort(key=lambda x: -x["confidence"])
    return jsonify({"date": sig_date, "stocks": stocks, "total": len(stocks)})


@prediction_bp.route('/top')
def top_signals():
    """回傳高信心買入訊號（P>=threshold），預設 threshold=0.60。"""
    by_ticker, sig_date = _load_latest_signals()
    threshold = float(request.args.get("threshold", 0.60))
    limit = int(request.args.get("limit", 20))
    top = [
        s for s in by_ticker.values()
        if s.get("direction", 0) == 1 and s.get("confidence", 0) >= threshold
    ]
    top.sort(key=lambda x: -x["confidence"])
    return jsonify({"date": sig_date, "threshold": threshold, "signals": top[:limit]})


@prediction_bp.route('/<ticker>')
def predict(ticker: str):
    try:
        signal = _latest_signal(ticker)
        actual = _actual_prices(ticker, n=10)
        pred   = _predicted_prices(actual, signal, n=5)
        dir_map = {1: "買進", -1: "賣出", 0: "觀望"}
        return jsonify({
            "ticker":           ticker,
            "name":             signal.get("name", ticker),
            "industry":         signal.get("industry", ""),
            "signal":           signal,
            "direction_label":  dir_map.get(signal.get("direction", 0), "觀望"),
            "actual":           actual,
            "predicted":        pred,
            "model_version":    signal.get("model", "v2"),
            "price_estimation_note": "預測價格依歷史波動率×AI信心度估算，非模型直接輸出，僅供參考",
        })
    except Exception as e:
        return jsonify({"error": str(e), "ticker": ticker}), 500
