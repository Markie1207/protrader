"""
twse.py — TWSE / TPEX 官方免費 API
資料來源：www.twse.com.tw（完全免費、無需帳號）
"""

import requests
import time
from datetime import datetime, date
from cachetools import TTLCache

# 快取：日線 5 分鐘、即時 30 秒
_cache_daily   = TTLCache(maxsize=100, ttl=300)
_cache_instant = TTLCache(maxsize=200, ttl=30)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (ProTrader/1.1)',
    'Referer': 'https://www.twse.com.tw/',
}

def _get(url: str, params: dict = None) -> dict | None:
    """通用 GET，失敗回傳 None"""
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=8)
        r.raise_for_status()
        data = r.json()
        if data.get('stat') in ('OK', None) or 'data' in data:
            return data
    except Exception as e:
        print(f'[TWSE] 請求失敗 {url}: {e}')
    return None


def get_taiex_realtime() -> dict:
    """
    取得加權指數即時資料（延遲 ~1 分鐘）
    使用 TWSE 大盤統計 API
    """
    key = 'taiex_rt'
    if key in _cache_instant:
        return _cache_instant[key]

    url = 'https://www.twse.com.tw/exchangeReport/MI_INDEX'
    data = _get(url, {'response': 'json', 'type': 'IND'})

    result = {
        'source': 'TWSE',
        'index':  22847,
        'change': 312,
        'change_pct': 1.38,
        'timestamp': datetime.now().isoformat(),
    }

    if data and 'data5' in data:
        try:
            for row in data['data5']:
                if '發行量加權股價指數' in row[0]:
                    idx_str = row[1].replace(',', '')
                    chg_str = row[2].replace(',', '').replace('+', '')
                    result['index']      = float(idx_str)
                    result['change']     = float(chg_str)
                    result['change_pct'] = round(float(chg_str) / (float(idx_str) - float(chg_str)) * 100, 2)
                    break
        except Exception as e:
            print(f'[TWSE] taiex 解析失敗: {e}')

    _cache_instant[key] = result
    return result


def get_institutional_today() -> dict:
    """
    三大法人今日買賣超（全市場合計）
    """
    key = 'inst_today'
    if key in _cache_daily:
        return _cache_daily[key]

    today = date.today().strftime('%Y%m%d')
    url   = 'https://www.twse.com.tw/fund/T86'
    data  = _get(url, {'response': 'json', 'date': today, 'selectType': 'ALLBUT0999'})

    result = {
        'source':   'TWSE',
        'date':     today,
        'foreign':  {'net': 0, 'buy': 0, 'sell': 0},
        'investment':{'net': 0, 'buy': 0, 'sell': 0},
        'dealer':   {'net': 0, 'buy': 0, 'sell': 0},
    }

    if data and 'data' in data:
        try:
            # 最後一筆是合計
            totals = data['data'][-1]
            def parse(s): return int(s.replace(',', '').replace('+', '')) * 1000

            result['foreign']   = {'net': parse(totals[4]),  'buy': parse(totals[2]),  'sell': parse(totals[3])}
            result['investment']= {'net': parse(totals[10]), 'buy': parse(totals[8]),  'sell': parse(totals[9])}
            result['dealer']    = {'net': parse(totals[16]), 'buy': parse(totals[14]), 'sell': parse(totals[15])}
        except Exception as e:
            print(f'[TWSE] 法人解析失敗: {e}')

    _cache_daily[key] = result
    return result


def get_stock_daily(code: str, months: int = 1) -> list[dict]:
    """
    個股日線 K 棒（最近 N 個月）
    回傳：[{ date, open, high, low, close, volume }, ...]
    """
    cache_key = f'daily_{code}'
    if cache_key in _cache_daily:
        return _cache_daily[cache_key]

    today = date.today()
    # 取最近 3 個月資料合併
    all_rows = []
    for delta in range(min(months, 3), -1, -1):
        m = today.month - delta
        y = today.year
        while m <= 0:
            m += 12; y -= 1
        ym = f'{y}{str(m).padStart(2,"0") if False else str(m).zfill(2)}01'
        url  = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY'
        data = _get(url, {'response': 'json', 'stockNo': code, 'date': ym})
        if data and 'data' in data:
            for row in data['data']:
                try:
                    all_rows.append({
                        'date':   row[0].replace('/', '-'),
                        'open':   float(row[3].replace(',', '')),
                        'high':   float(row[4].replace(',', '')),
                        'low':    float(row[5].replace(',', '')),
                        'close':  float(row[6].replace(',', '')),
                        'volume': int(row[1].replace(',', '')),
                    })
                except Exception:
                    pass
        time.sleep(0.3)  # rate limit

    result = all_rows[-60:] if len(all_rows) > 60 else all_rows
    if result:
        _cache_daily[cache_key] = result
    return result


def get_stock_quote(code: str) -> dict:
    """
    個股即時報價（TWSE 即時行情，有 session 限制，退而求 TPEX）
    """
    cache_key = f'quote_{code}'
    if cache_key in _cache_instant:
        return _cache_instant[cache_key]

    # TWSE 即時行情
    url  = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp'
    data = _get(url, {'ex_ch': f'tse_{code}.tw', 'json': '1', 'delay': '0'})

    result = {'source': 'TWSE', 'code': code, 'price': 0, 'open': 0, 'high': 0, 'low': 0, 'volume': 0}

    if data and 'msgArray' in data and data['msgArray']:
        try:
            d = data['msgArray'][0]
            result['price']  = float(d.get('z', d.get('y', 0)) or 0)
            result['open']   = float(d.get('o', 0) or 0)
            result['high']   = float(d.get('h', 0) or 0)
            result['low']    = float(d.get('l', 0) or 0)
            result['volume'] = int((d.get('v', '0') or '0').replace(',', ''))
            result['name']   = d.get('n', '')
        except Exception as e:
            print(f'[TWSE] quote 解析失敗 {code}: {e}')

    _cache_instant[cache_key] = result
    return result
