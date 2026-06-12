"""
routes/market.py — 大盤 / 法人 API 路由
"""

from flask import Blueprint, jsonify
from src.data_sources import twse, sinopac

market_bp = Blueprint('market', __name__, url_prefix='/api/market')


@market_bp.route('/taiex')
def taiex():
    """加權指數即時資料（Shioaji 優先，降級 TWSE）"""
    data = sinopac.get_taiex()
    if data:
        return jsonify(data)
    data = twse.get_taiex_realtime()
    return jsonify(data)


@market_bp.route('/institutional')
def institutional():
    """三大法人今日買賣超"""
    data = twse.get_institutional_today()
    return jsonify(data)


@market_bp.route('/status')
def status():
    """資料源狀態（前端顯示資料來源標籤用）"""
    return jsonify({
        'shioaji_available': sinopac.is_available(),
        'market_open':       sinopac._is_market_open(),
        'primary_source':    'Shioaji' if sinopac.is_available() else 'TWSE',
    })
