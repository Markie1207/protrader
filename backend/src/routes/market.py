"""
routes/market.py — 大盤 / 法人 API 路由
"""

from flask import Blueprint, jsonify
from src.data_sources import twse, sinopac

market_bp = Blueprint('market', __name__, url_prefix='/api/market')


@market_bp.route('/taiex')
def taiex():
    """加權指數即時資料（Shioaji 優先，降級 TWSE；無資料回 503 讓前端用 mock）"""
    data = sinopac.get_taiex()
    if data:
        return jsonify(data)
    data = twse.get_taiex_realtime()
    if data:
        return jsonify(data)
    return jsonify({'error': 'no data'}), 503


@market_bp.route('/institutional')
def institutional():
    """三大法人今日買賣超（無資料回 503 讓前端用 mock）"""
    data = twse.get_institutional_today()
    if data:
        return jsonify(data)
    return jsonify({'error': 'no data'}), 503


@market_bp.route('/status')
def status():
    """資料源狀態（前端顯示資料來源標籤用）"""
    return jsonify({
        'shioaji_available': sinopac.is_available(),
        'market_open':       sinopac._is_market_open(),
        'primary_source':    'Shioaji' if sinopac.is_available() else 'TWSE',
    })


@market_bp.route('/futures_oi')
def futures_oi():
    """外資期貨未平倉口數（路由修正：底線，對應前端 api.js）"""
    data = twse.get_futures_oi()
    return jsonify(data)


@market_bp.route('/focus')
def focus():
    """AI 規則引擎焦點選股（無資料回 503 讓前端降級 mock）"""
    data = twse.get_focus_stocks()
    if data:
        return jsonify(data)
    return jsonify({'error': 'no data'}), 503


@market_bp.route('/debug')
def debug():
    """診斷端點：直接測試 TWSE API 連線（排查 IP 封鎖 / 無資料）"""
    import requests
    from datetime import date, timedelta

    results = {}
    headers = {'User-Agent': 'Mozilla/5.0 (ProTrader/1.1)',
                'Referer': 'https://www.twse.com.tw/'}

    # 測試 1：STOCK_DAY_ALL（不帶日期）
    try:
        r = requests.get('https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL',
                         params={'response': 'json'}, headers=headers, timeout=8)
        d = r.json()
        results['STOCK_DAY_ALL'] = {
            'stat': d.get('stat'), 'rows': len(d.get('data', [])), 'date': d.get('date')
        }
    except Exception as e:
        results['STOCK_DAY_ALL'] = {'error': str(e)}

    # 測試 2：T86（最近交易日）
    for delta in range(5):
        td = date.today() - timedelta(days=delta)
        if td.weekday() >= 5:
            continue
        try:
            r = requests.get('https://www.twse.com.tw/fund/T86',
                             params={'response': 'json', 'date': td.strftime('%Y%m%d'),
                                     'selectType': 'ALLBUT0999'},
                             headers=headers, timeout=8)
            d = r.json()
            results[f'T86_{td}'] = {
                'stat': d.get('stat'), 'rows': len(d.get('data', []))
            }
            break
        except Exception as e:
            results[f'T86_{td}'] = {'error': str(e)}
        break

    # 測試 3：BFI82U
    try:
        today_str = date.today().strftime('%Y%m%d')
        r = requests.get('https://www.twse.com.tw/fund/BFI82U',
                         params={'response': 'json', 'dayDate': today_str, 'type': 'day'},
                         headers=headers, timeout=8)
        d = r.json()
        results['BFI82U'] = {'stat': d.get('stat'), 'rows': len(d.get('data', []))}
    except Exception as e:
        results['BFI82U'] = {'error': str(e)}

    return jsonify(results)
