"""
twse.py — TWSE / TPEX / TAIFEX 官方免費 API
資料來源：www.twse.com.tw、openapi.taifex.com.tw（完全免費、無需帳號）
"""

import requests
import time
from datetime import datetime, date
from cachetools import TTLCache

_cache_daily   = TTLCache(maxsize=100, ttl=300)
_cache_instant = TTLCache(maxsize=200, ttl=30)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (ProTrader/1.1)',
    'Referer': 'https://www.twse.com.tw/',
}

def _get(url: str, params: dict = None, headers: dict = None) -> dict | None:
    """通用 GET，失敗回傳 None"""
    try:
        r = requests.get(url, params=params, headers=headers or HEADERS, timeout=8)
        r.raise_for_status()
        data = r.json()
        if data.get('stat') in ('OK', None) or 'data' in data or isinstance(data, list):
            return data
    except Exception as e:
        print(f'[TWSE] 請求失敗 {url}: {e}')
    return None


def get_taiex_realtime() -> dict:
    """
    取得加權指數（延遲 ~1 分鐘）
    主路由：Shioaji；本函式為備援
    """
    key = 'taiex_rt'
    if key in _cache_instant:
        return _cache_instant[key]

    url = 'https://www.twse.com.tw/exchangeReport/MI_INDEX'
    data = _get(url, {'response': 'json', 'type': 'IND'})

    result = {
        'source':     'TWSE',
        'index':      44169,
        'change':     0,
        'change_pct': 0.0,
        'timestamp':  datetime.now().isoformat(),
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
    三大法人今日買賣超金額（BFI82U 大盤合計端點）
    外資 = 外資及陸資(不含外資自營商) + 外資自營商
    投信 = 投信
    自營商 = 自營商(自行買賣) + 自營商(避險)
    """
    key = 'inst_today'
    if key in _cache_daily:
        return _cache_daily[key]

    today = date.today().strftime('%Y%m%d')
    url   = 'https://www.twse.com.tw/fund/BFI82U'
    data  = _get(url, {'response': 'json', 'dayDate': today, 'type': 'day'})

    result = {
        'source':     'TWSE',
        'date':       today,
        'foreign':    {'net': 0, 'buy': 0, 'sell': 0},
        'investment': {'net': 0, 'buy': 0, 'sell': 0},
        'dealer':     {'net': 0, 'buy': 0, 'sell': 0},
    }

    if data and 'data' in data:
        try:
            def parse(s: str) -> int:
                s = str(s).replace(',', '').replace('+', '').replace(' ', '')
                return int(s) if s and s not in ('-', '') else 0

            f_buy = f_sell = f_net = 0
            i_buy = i_sell = i_net = 0
            d_buy = d_sell = d_net = 0

            for row in data['data']:
                name = str(row[0]).strip()
                b, s, n = parse(row[1]), parse(row[2]), parse(row[3])

                if '外資及陸資' in name and '自營商' not in name:
                    f_buy += b; f_sell += s; f_net += n
                elif '外資自營商' in name:
                    f_buy += b; f_sell += s; f_net += n
                elif '投信' in name:
                    i_buy, i_sell, i_net = b, s, n
                elif '自營商' in name:
                    d_buy += b; d_sell += s; d_net += n

            result['foreign']    = {'net': f_net, 'buy': f_buy, 'sell': f_sell}
            result['investment'] = {'net': i_net, 'buy': i_buy, 'sell': i_sell}
            result['dealer']     = {'net': d_net, 'buy': d_buy, 'sell': d_sell}

        except Exception as e:
            print(f'[TWSE] 法人解析失敗 (BFI82U): {e}')

    else:
        # BFI82U 無資料（盤後可能還未更新），改用 T86 備援
        result = _get_institutional_t86(today, result)

    _cache_daily[key] = result
    return result


def _get_institutional_t86(today: str, fallback: dict) -> dict:
    """T86 個股合計備援"""
    url  = 'https://www.twse.com.tw/fund/T86'
    data = _get(url, {'response': 'json', 'date': today, 'selectType': 'ALLBUT0999'})
    if data and 'data' in data:
        try:
            totals = data['data'][-1]
            def p(s): return int(str(s).replace(',', '').replace('+', '')) * 1000
            fallback['foreign']    = {'net': p(totals[4]),  'buy': p(totals[2]),  'sell': p(totals[3])}
            fallback['investment'] = {'net': p(totals[10]), 'buy': p(totals[8]),  'sell': p(totals[9])}
            fallback['dealer']     = {'net': p(totals[16]), 'buy': p(totals[14]), 'sell': p(totals[15])}
            fallback['source']     = 'TWSE-T86'
        except Exception as e:
            print(f'[TWSE] T86 備援解析失敗: {e}')
    return fallback


def get_futures_oi() -> dict:
    """
    外資期貨未平倉口數（台指期 TX，TAIFEX Open API）
    回傳：{ source, date, foreign_net, foreign_long, foreign_short, unit }
    """
    key = 'futures_oi'
    if key in _cache_daily:
        return _cache_daily[key]

    today_str = date.today().strftime('%Y-%m-%d')
    result = {
        'source':        'mock',
        'date':          today_str,
        'foreign_net':   0,
        'foreign_long':  0,
        'foreign_short': 0,
        'unit':          '口',
    }

    url  = 'https://openapi.taifex.com.tw/v1/DailyForeignInvestorsPositions'
    data = _get(url, {'queryDate': today_str},
                headers={'User-Agent': 'Mozilla/5.0 (ProTrader/1.1)',
                         'Accept': 'application/json'})

    if data and isinstance(data, list):
        try:
            for row in data:
                name = str(row.get('ContractName', row.get('商品名稱', '')))
                if 'TX' in name or '臺股期貨' in name or '台股期貨' in name:
                    lo = int(row.get('LongOpenInterest',
                              row.get('外資多方未平倉口數', 0)) or 0)
                    so = int(row.get('ShortOpenInterest',
                              row.get('外資空方未平倉口數', 0)) or 0)
                    no = int(row.get('NetOpenInterest',
                              row.get('外資淨未平倉口數', lo - so)) or lo - so)
                    result.update({
                        'source':        'TAIFEX',
                        'foreign_long':  lo,
                        'foreign_short': so,
                        'foreign_net':   no,
                        'date':          row.get('Date', today_str),
                    })
                    break
        except Exception as e:
            print(f'[TAIFEX] 期貨未平倉解析失敗: {e}')

    _cache_daily[key] = result
    return result


def get_stock_daily(code: str, months: int = 1) -> list[dict]:
    """個股日線 K 棒（最近 N 個月）"""
    cache_key = f'daily_{code}'
    if cache_key in _cache_daily:
        return _cache_daily[cache_key]

    today    = date.today()
    all_rows = []
    for delta in range(min(months, 3), -1, -1):
        m = today.month - delta
        y = today.year
        while m <= 0:
            m += 12; y -= 1
        ym   = f'{y}{str(m).zfill(2)}01'
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
        time.sleep(0.3)

    result = all_rows[-60:] if len(all_rows) > 60 else all_rows
    if result:
        _cache_daily[cache_key] = result
    return result


def get_stock_quote(code: str) -> dict:
    """個股即時報價（TWSE 即時行情）"""
    cache_key = f'quote_{code}'
    if cache_key in _cache_instant:
        return _cache_instant[cache_key]

    url  = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp'
    data = _get(url, {'ex_ch': f'tse_{code}.tw', 'json': '1', 'delay': '0'})

    result = {'source': 'TWSE', 'code': code, 'price': 0,
              'open': 0, 'high': 0, 'low': 0, 'volume': 0}

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
