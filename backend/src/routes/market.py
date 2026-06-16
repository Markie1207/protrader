"""
routes/market.py — 大盤 / 法人 API 路由
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
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
    """三大法人台指期未平倉口數（dealer / investment_trust / foreign）"""
    data = twse.get_institutional_futures_oi()
    return jsonify(data)


@market_bp.route('/temperature')
def temperature():
    """大盤溫度計：7項指標加權平均，回傳分數 + 各指標明細"""
    data = twse.calc_temperature()
    if data:
        return jsonify(data)
    return jsonify({'error': 'no data'}), 503


@market_bp.route('/volume_ranking')
def volume_ranking():
    """當日成交量排行前20名（從 STOCK_DAY_ALL 導出）"""
    data = twse.get_volume_ranking(20)
    return jsonify(data)


@market_bp.route('/focus')
def focus():
    """今日焦點 AI 排序（新版4因子，降級舊版規則引擎）"""
    codes_qs = request.args.get('codes', '')
    pool     = [c.strip() for c in codes_qs.split(',') if c.strip()] or None

    data = twse.calc_focus_ranking(pool)
    if data:
        return jsonify(data)

    # 降級：舊版全市場篩選
    old = twse.get_focus_stocks()
    if old:
        return jsonify({
            'date':   datetime.today().strftime('%Y-%m-%d'),
            'stocks': old,
            'source': 'legacy',
        })
    return jsonify({'error': 'no data'}), 503


@market_bp.route('/news')
def news():
    """Google News RSS 台股財經新聞（最新 10 則，依時間降序）"""
    import xml.etree.ElementTree as ET
    import requests as _req
    import html, re
    from cachetools import TTLCache
    from email.utils import parsedate_to_datetime

    _news_cache = getattr(news, '_cache', None)
    if _news_cache is None:
        news._cache = TTLCache(maxsize=1, ttl=300)
        _news_cache = news._cache

    if 'data' in _news_cache:
        return jsonify(_news_cache['data'])

    queries = ['台股 外資', '台積電 法人', '台股 盤勢', '美伊 戰爭 台股', '台股 今日']
    raw     = []   # [(datetime, item_dict)]
    seen    = set()
    headers = {'User-Agent': 'Mozilla/5.0'}

    for q in queries:
        try:
            url  = f'https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'
            r    = _req.get(url, headers=headers, timeout=6)
            root = ET.fromstring(r.content)
            for item in root.iter('item'):
                title = html.unescape(item.findtext('title') or '')
                title = re.sub(r'\s*-\s*[^-]+$', '', title).strip()
                link  = item.findtext('link') or ''
                pub   = item.findtext('pubDate') or ''
                src   = item.findtext('{https://news.google.com/rss}source') or                         item.findtext('source') or 'Google News'
                if not title or title in seen:
                    continue
                seen.add(title)
                try:
                    dt   = parsedate_to_datetime(pub)
                    tstr = dt.strftime('%m/%d %H:%M')
                except Exception:
                    dt   = datetime.min
                    tstr = pub[:16]
                raw.append((dt, {'title': title, 'time': tstr,
                                 'src': src, 'url': link, 'tag': '新聞'}))
        except Exception as e:
            print(f'[NEWS] RSS 失敗 ({q}): {e}')

    # 依時間降序（最新在前），取前 10 則
    raw.sort(key=lambda x: x[0], reverse=True)
    result = [it for _, it in raw[:10]]
    if result:
        _news_cache['data'] = result
    return jsonify(result)
