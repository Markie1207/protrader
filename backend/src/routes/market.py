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
    """診斷端點：逐步追蹤 get_focus_stocks() 每個環節"""
    import traceback
    from datetime import date, timedelta
    from src.data_sources import twse as t

    results = {}

    # 步驟 0：STOCK_DAY_ALL 原始第一筆（看欄位順序）
    try:
        import requests as _req
        r0 = _req.get('https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL',
                       params={'response': 'json'}, headers=t.HEADERS, timeout=8)
        d0 = r0.json()
        results['step0_raw'] = {
            'stat': d0.get('stat'),
            'date': d0.get('date'),
            'total_rows': len(d0.get('data', [])),
            'fields': d0.get('fields', []),
            'first_row': d0['data'][0] if d0.get('data') else [],
        }
    except Exception as e:
        results['step0_raw'] = {'error': str(e)}

    # 步驟 1：price_map
    try:
        pm = t.get_stock_day_all()
        results['step1_price_map'] = {
            'count': len(pm),
            'sample': {k: v for k, v in list(pm.items())[:3]} if pm else {}
        }
    except Exception as e:
        results['step1_price_map'] = {'error': str(e), 'tb': traceback.format_exc()}

    # 步驟 2：T86 map
    try:
        t86_map = {}
        t86_date = ''
        for delta in range(5):
            td = date.today() - timedelta(days=delta)
            if td.weekday() >= 5:
                continue
            import requests
            r = requests.get('https://www.twse.com.tw/fund/T86',
                             params={'response': 'json', 'date': td.strftime('%Y%m%d'),
                                     'selectType': 'ALLBUT0999'},
                             headers=t.HEADERS, timeout=8)
            d = r.json()
            if d.get('stat') == 'OK' and len(d.get('data', [])) > 5:
                t86_date = td.strftime('%Y/%m/%d')
                for row in d['data'][:-1]:
                    try:
                        if len(row) < 11: continue
                        code = str(row[0]).strip()
                        if not code.isdigit() or len(code) != 4: continue
                        t86_map[code] = {'f': t._pz(row[4]) + t._pz(row[7]),
                                         'i': t._pz(row[10])}
                    except Exception:
                        pass
                break
        results['step2_t86'] = {'date': t86_date, 'count': len(t86_map),
                                 'sample': {k: v for k, v in list(t86_map.items())[:3]}}
    except Exception as e:
        results['step2_t86'] = {'error': str(e), 'tb': traceback.format_exc()}

    # 步驟 3：篩選結果
    try:
        pm = t.get_stock_day_all()
        skip = {'chg_le0': 0, 'vol': 0, 'price': 0, 'f_neg': 0, 'no_price': 0}
        cands = []
        for code, inst in t86_map.items():
            price = pm.get(code)
            if not price:
                skip['no_price'] += 1; continue
            if price['change_pct'] <= 0:
                skip['chg_le0'] += 1; continue
            if price['volume_k'] < 500:
                skip['vol'] += 1; continue
            if price['close'] < 20:
                skip['price'] += 1; continue
            if inst['f'] < 0:
                skip['f_neg'] += 1; continue
            cands.append({'code': code, 'chg': price['change_pct'],
                          'vol': price['volume_k'], 'f': inst['f']})
        results['step3_filter'] = {'skipped': skip, 'candidates': len(cands),
                                    'top5': sorted(cands, key=lambda x: x['vol'], reverse=True)[:5]}
    except Exception as e:
        results['step3_filter'] = {'error': str(e), 'tb': traceback.format_exc()}

    return jsonify(results)
