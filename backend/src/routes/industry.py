"""
industry.py — 產業鏈地圖路由

GET  /api/industry-map              取得正式資料
GET  /api/industry-map/draft        取得草稿狀態（has_draft / 摘要）
GET  /api/industry-map/draft/data   取得完整草稿內容
POST /api/industry-map/draft/approve 套用草稿 → 正式生效
POST /api/industry-map/draft/reject  捨棄草稿
POST /api/industry-map/refresh       手動觸發描述更新（背景）
POST /api/industry-map/refresh-full  手動觸發公司+新鏈更新（背景，產生草稿）
"""

import threading
from flask import Blueprint, jsonify
from src.data_sources import grok_updater

industry_bp = Blueprint('industry', __name__, url_prefix='/api/industry-map')


@industry_bp.get('')
def get_industry_map():
    data = grok_updater.get_data()
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@industry_bp.get('/draft')
def get_draft_status():
    return jsonify(grok_updater.get_draft_status())


@industry_bp.get('/draft/data')
def get_draft_data():
    draft = grok_updater.get_draft_data()
    if draft is None:
        return jsonify({'error': True, 'message': '目前沒有草稿'}), 404
    return jsonify(draft)


@industry_bp.post('/draft/approve')
def approve_draft():
    ok = grok_updater.approve_draft()
    if ok:
        return jsonify({'status': 'ok', 'message': '草稿已套用為正式資料'})
    return jsonify({'error': True, 'message': '套用失敗，草稿不存在或讀取錯誤'}), 400


@industry_bp.post('/draft/reject')
def reject_draft():
    grok_updater.reject_draft()
    return jsonify({'status': 'ok', 'message': '草稿已捨棄'})


@industry_bp.post('/refresh')
def manual_refresh_descriptions():
    """背景觸發描述更新（直接生效）"""
    t = threading.Thread(target=grok_updater.run_update_descriptions, daemon=True)
    t.start()
    return jsonify({'status': 'started', 'message': '描述更新已在背景執行'})


@industry_bp.post('/refresh-full')
def manual_refresh_full():
    """背景觸發完整更新（產生草稿，需審核）"""
    t = threading.Thread(target=grok_updater.run_update_companies, daemon=True)
    t.start()
    return jsonify({'status': 'started', 'message': '公司清單更新已在背景執行，完成後請至產業鏈地圖審核草稿'})


@industry_bp.get('/test-grok')
def test_grok():
    """同步測試 Grok API 連線（約 5-10 秒），回傳成功/失敗與錯誤原因"""
    result = grok_updater.test_connection()
    code = 200 if result.get('ok') else 400
    return jsonify(result), code


@industry_bp.get('/test-github')
def test_github():
    """測試 GitHub API 連線：commit 測試檔後刪除，驗證 Token 與 Repo 設定"""
    from src.data_sources import github_storage
    result = github_storage.test_connection()
    code = 200 if result.get('ok') else 400
    return jsonify(result), code


@industry_bp.get('/test-search')
def test_search():
    """測試 Google Search grounding 連線（約 5-10 秒）"""
    result = grok_updater.test_search_connection()
    code = 200 if result.get('ok') else 400
    return jsonify(result), code


@industry_bp.post('/discover-themes')
def discover_themes():
    """背景執行：用 Google Search grounding 搜尋最新熱門台股題材"""
    t = threading.Thread(target=grok_updater.run_discover_themes, daemon=True)
    t.start()
    return jsonify({'status': 'started', 'message': '題材搜尋已在背景執行（約 15-30 秒），完成後請呼叫 GET /api/industry-map/themes 查看結果'})


@industry_bp.get('/themes')
def get_themes():
    """取得最近一次 discover-themes 的結果"""
    result = grok_updater.get_themes()
    if result is None:
        return jsonify({'error': True, 'message': '尚未執行 discover-themes'}), 404
    return jsonify(result)
