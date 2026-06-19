"""
industry.py — 產業鏈地圖路由
GET  /api/industry-map          取得完整 JSON（含 Grok 最新內容）
POST /api/industry-map/refresh  手動觸發 Grok 更新（供測試用）
"""

from flask import Blueprint, jsonify
from src.data_sources import grok_updater

industry_bp = Blueprint('industry', __name__, url_prefix='/api/industry-map')


@industry_bp.get('')
def get_industry_map():
    """回傳最新產業鏈 JSON"""
    data = grok_updater.get_data()
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@industry_bp.post('/refresh')
def manual_refresh():
    """手動觸發 Grok 更新（用於測試；不建議前端直接呼叫）"""
    import threading
    t = threading.Thread(target=grok_updater.run_update, daemon=True)
    t.start()
    return jsonify({'status': 'started', 'message': 'Grok 更新已在背景執行'})
