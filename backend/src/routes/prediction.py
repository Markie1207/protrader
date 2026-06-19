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


def _actual_prices(ticker: str, n: int = 10) -> list[dict]:
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
    """
    根據 AI 訊號 + 歷史波動率估算未來 n 個交易日收盤價。
    改良重點：
      1. 使用實際歷史日報酬標準差取代固定 ±0.5%
      2. 信心度隨預測天數衰減（越遠越不確定，逐漸趨平）
      3. 混入近期動能（最近 3 天均值）作為基線修正
    """
    if not actual:
        return []

    direction  = int(signal.get("direction", 0))
    confidence = float(signal.get("confidence", 0.5))
    closes     = [float(p["close"]) for p in actual]
    last_close = closes[-1]
    last_date  = datetime.strptime(actual[-1]["date"], "%Y-%m-%d")

    # 1. 歷史波動率（日報酬標準差），限制在 0.3%~4%
    if len(closes) >= 3:
        rets = [(closes[i] - closes[i - 1]) / max(closes[i - 1], 1e-8)
                for i in range(1, len(closes))]
        hist_vol = (sum(r ** 2 for r in rets) / len(rets)) ** 0.5
        hist_vol = max(0.003, min(hist_vol, 0.04))
    else:
        hist_vol = 0.005

    # 2. 近期動能（最近 3 天平均日報酬），限制在 ±1%
    if len(closes) >= 4:
        momentum = sum((closes[i] - closes[i - 1]) / max(closes[i - 1], 1e-8)
                       for i in range(len(closes) - 3, len(closes))) / 3
        momentum = max(-0.01, min(momentum, 0.01))
    else:
        momentum = 0.0

    # 3. 逐日預測：AI 訊號信心隨時間衰減（decay=0.75/day），混合近期動能
    result = []
    price, dt = last_close, last_date
    for i in range(n):
        decay      = 0.75 ** i                              # 第 i 天信心剩 75%^i
        ai_rate    = hist_vol * direction * confidence * decay
        blend_rate = ai_rate * 0.7 + momentum * 0.3        # 70% AI + 30% 動能
        dt    = _next_trading_day(dt)
        price = round(price * (1 + blend_rate), 1)
        result.append({"date": dt.strftime("%Y-%m-%d"), "close": price})
    return result


@prediction_bp.route('/stocks')
def list_stocks():
    return jsonify([{"ticker": k, "name": v} for k, v in STOCK_NAMES.items()])


@prediction_bp.route('/<ticker>')
def predict(ticker: str):
    try:
        signal  = _latest_signal(ticker)
        actual  = _actual_prices(ticker, n=10)
        pred    = _predicted_prices(actual, signal, n=5)
        dir_map = {1: "買進", -1: "賣出", 0: "觀望"}
        return jsonify({
            "ticker":               ticker,
            "name":                 STOCK_NAMES.get(ticker, ticker),
            "signal":               signal,
            "direction_label":      dir_map.get(signal.get("direction", 0), "觀望"),
            "actual":               actual,
            "predicted":            pred,
            "price_estimation_note": "預測價格依歷史波動率×AI信心度（含衰減）估算，非模型直接輸出，僅供參考",
        })
    except Exception as e:
        return jsonify({"error": str(e), "ticker": ticker}), 500
