"""
routes/stock.py — 個股資料 API 路由
"""

from flask import Blueprint, jsonify, request
from src.data_sources import twse, sinopac

stock_bp = Blueprint('stock', __name__, url_prefix='/api/stock')


@stock_bp.route('/<code>/quote')
def quote(code: str):
    """
    個股即時報價
    優先 Shioaji（開盤中）→ 降級 TWSE
    """
    # 嘗試 Shioaji
    data = sinopac.get_realtime_quote(code)
    if data:
        return jsonify(data)

    # 降級 TWSE
    data = twse.get_stock_quote(code)
    return jsonify(data)


@stock_bp.route('/<code>/history')
def history(code: str):
    """
    個股日線 K 棒
    ?months=1  （預設 1 個月）
    """
    months = int(request.args.get('months', 1))
    data   = twse.get_stock_daily(code, months=months)
    return jsonify({'source': 'TWSE', 'code': code, 'candles': data})


@stock_bp.route('/<code>/intraday')
def intraday(code: str):
    """
    今日分時 K 棒（Shioaji only）
    回放功能使用
    """
    data = sinopac.get_intraday_ticks(code)
    if not data:
        return jsonify({'source': 'unavailable', 'code': code, 'ticks': []})
    return jsonify({'source': 'Shioaji', 'code': code, 'ticks': data})
