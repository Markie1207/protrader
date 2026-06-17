"""
routes/prediction.py — AI 股價預測 API
歷史股價：TWSE get_stock_daily()
AI 訊號：讀取 repo 內 results/signals/ 目錄（隨 git push 更新）
"""

import json
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify
from src.data_sources import twse

prediction_bp = Blueprint('prediction', __name__, url_prefix='/api/prediction')

# results/signals/ 在 repo 根目錄（相對於 backend/src/routes/prediction.py → 上三層）
_SIGNALS_DIR = Path(__file__).parents[3] / "results" / "signals"

STOCK_NAMES = {
    "2330": "台積電", "2317": "鴻海",   "2454": "聯發科", "2382": "廣達",
    "2308": "台達電", "2881": "富邦金", "2882": "國泰金", "2891": "中信金",
    "1301": "台塑",   "1303": "南亞",   "2412": "中華電", "3008": "大立光",
    "2886": "兆豐金", "2884": "玉山金", "2357": "華碩",   "2303": "聯電",
    "3711": "日月光", "2379": "瑞昱",   "5880": "合庫金", "2002": "中鋼",
}


def _latest_signal(ticker: str) -> dict:
    """從 results/signals/ 最新 JSON 取得對應股票訊號。"""
    try:
        files = sorted(_SIGNALS_DIR.glob("*.json"), reverse=True)
        if not files:
            raise FileNotFoundError("no signal files")
        with open(files[0], encoding="utf-8") as f:
            data = json.load(f)
        signal_date = data.get("date", files[0].stem)
        for sig in data.get("signals", []):
            if sig.get("ticker") == ticker:
                sig["signal_date"] = signal_date
                return sig
        return {
            "direction": 0, "confidence": 0.5,
            "lstm_prob": 0.5, "tcn_prob": 0.5,
            "ppo_action": 0, "model": "neutral",
            "signal_date": signal_date,
        }
    except Exception:
        return {
            "direction": 0, "confidence": 0.5,
            "lstm_prob": 0.5, "tcn_prob": 0.5,
            "ppo_action": 0, "model": "none",
            "signal_date": "N/A",
        }


def _roc_to_iso(date_str: str) -> str:
    """民國日期 '115-06-13' → ISO '2026-06-13'"""
    parts = date_str.split('-')
    if len(parts) == 3 and len(parts[0]) <= 3:
        return f"{int(parts[0]) + 1911}-{parts[1]}-{parts[2]}"
    return date_str


def _actual_prices(ticker: str, n: int = 5) -> list[dict]:
    """用 TWSE get_stock_daily() 取最近 n 天收盤價。"""
    candles = twse.get_stock_daily(ticker, months=1)
    recent = candles[-n:] if len(candles) >= n else candles
    return [
        {"date": _roc_to_iso(c["date"]), "close": c["close"]}
        for c in recent
    ]


def _next_trading_day(dt: datetime) -> datetime:
    dt += timedelta(days=1)
    while dt.weekday() >= 5:
        dt += timedelta(days=1)
    return dt


def _predicted_prices(actual: list[dict], signal: dict, n: int = 5) -> list[dict]:
    """根據 AI 訊號方向+信心度估算未來 n 個交易日收盤價。"""
    if not actual:
        return []
    direction  = int(signal.get("direction", 0))
    confidence = float(signal.get("confidence", 0.5))
    last_close = float(actual[-1]["close"])
    last_date  = datetime.strptime(actual[-1]["date"], "%Y-%m-%d")
    # 每日預測漲跌幅：最多 ±0.5%，依方向與信心度縮放
    daily_rate = 0.005 * direction * (0.3 + confidence * 0.7)

    result = []
    price, dt = last_close, last_date
    for _ in range(n):
        dt    = _next_trading_day(dt)
        price = round(price * (1 + daily_rate), 1)
        result.append({"date": dt.strftime("%Y-%m-%d"), "close": price})
    return result


@prediction_bp.route('/stocks')
def list_stocks():
    return jsonify([{"ticker": k, "name": v} for k, v in STOCK_NAMES.items()])


@prediction_bp.route('/<ticker>')
def predict(ticker: str):
    try:
        signal  = _latest_signal(ticker)
        actual  = _actual_prices(ticker, n=5)
        pred    = _predicted_prices(actual, signal, n=5)
        dir_map = {1: "買進", -1: "賣出", 0: "觀望"}
        return jsonify({
            "ticker":          ticker,
            "name":            STOCK_NAMES.get(ticker, ticker),
            "signal":          signal,
            "direction_label": dir_map.get(signal.get("direction", 0), "觀望"),
            "actual":          actual,
            "predicted":       pred,
        })
    except Exception as e:
        return jsonify({"error": str(e), "ticker": ticker}), 500
