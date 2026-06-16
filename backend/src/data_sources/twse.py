"""
twse.py — TWSE / TPEX / TAIFEX 官方免費 API
資料來源：www.twse.com.tw、openapi.taifex.com.tw（完全免費、無需帳號）
"""

import csv
import io
import os
import requests
import time
from datetime import datetime, date, timedelta
from cachetools import TTLCache

_cache_daily   = TTLCache(maxsize=100, ttl=300)
_cache_instant = TTLCache(maxsize=200, ttl=30)

# 三大法人期貨 OI 專用快取（TTL 至隔日 08:00，重啟清空）
_inst_oi_cache: dict = {}

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
    取得加權指數（盤中即時；盤後/假日自動回溯最近交易日收盤）
    主路由：Shioaji；本函式為備援
    """
    from datetime import timedelta

    key = 'taiex_rt'
    if key in _cache_instant:
        return _cache_instant[key]

    url    = 'https://www.twse.com.tw/exchangeReport/MI_INDEX'
    result = None

    def _parse_mi(data, label='TWSE') -> dict | None:
        for k in ('data5', 'data4', 'data3'):
            for row in data.get(k, []):
                if '發行量加權股價指數' in str(row[0]):
                    try:
                        idx = float(str(row[1]).replace(',', ''))
                        chg = float(str(row[2]).replace(',', '').replace('+', ''))
                        return {
                            'source':     label,
                            'index':      idx,
                            'change':     chg,
                            'change_pct': round(chg / (idx - chg) * 100, 2) if idx != chg else 0.0,
                            'timestamp':  datetime.now().isoformat(),
                        }
                    except Exception:
                        pass
        return None

    # 1. 先試即時（不帶日期，盤中有效）
    data = _get(url, {'response': 'json', 'type': 'IND'})
    if data:
        result = _parse_mi(data)

    # 2. 無即時資料 → 回溯最近 5 個交易日取收盤
    if not result:
        for delta in range(1, 6):
            try_date = date.today() - timedelta(days=delta)
            if try_date.weekday() >= 5:
                continue
            data = _get(url, {'response': 'json',
                               'date': try_date.strftime('%Y%m%d'),
                               'type': 'IND'})
            if data:
                result = _parse_mi(data, label='TWSE-close')
                if result:
                    result['date'] = try_date.isoformat()
                    print(f'[TWSE] 加權指數使用 {try_date} 收盤資料')
                    break

    if result:
        _cache_instant[key] = result
    return result  # None 時由 route 回 503，前端降級 mock


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

    from datetime import timedelta

    url    = 'https://www.twse.com.tw/fund/BFI82U'
    result = None
    data   = None
    today  = date.today().strftime('%Y%m%d')

    # 回溯最近 5 個交易日，找到有資料的最新一天
    for delta in range(6):
        try_date = date.today() - timedelta(days=delta)
        if try_date.weekday() >= 5:          # 跳過週末
            continue
        d_str = try_date.strftime('%Y%m%d')
        data  = _get(url, {'response': 'json', 'dayDate': d_str, 'type': 'day'})
        if data and 'data' in data:
            today = d_str
            if delta > 0:
                print(f'[TWSE] BFI82U 使用 {try_date} 資料（最近交易日）')
            break
        data = None

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

            # 修正：直接建立 result dict（原為 None）
            result = {
                'source':     'TWSE',
                'date':       today,
                'foreign':    {'net': f_net, 'buy': f_buy, 'sell': f_sell},
                'investment': {'net': i_net, 'buy': i_buy, 'sell': i_sell},
                'dealer':     {'net': d_net, 'buy': d_buy, 'sell': d_sell},
            }

        except Exception as e:
            print(f'[TWSE] 法人解析失敗 (BFI82U): {e}')

    else:
        # BFI82U 無資料，改用 T86 備援
        fallback = {
            'source':     'TWSE',
            'date':       today,
            'foreign':    {'net': 0, 'buy': 0, 'sell': 0},
            'investment': {'net': 0, 'buy': 0, 'sell': 0},
            'dealer':     {'net': 0, 'buy': 0, 'sell': 0},
        }
        result = _get_institutional_t86(today, fallback)
        if result and result['foreign']['net'] == 0 and result['investment']['net'] == 0:
            result = None

    if result:
        _cache_daily[key] = result
    return result  # None 時由 route 回 503，前端降級 mock


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


def get_institutional_futures_oi() -> dict:
    """
    三大法人台指期未平倉口數（TAIFEX open data CSV）
    契約 TX，快取至隔日 08:00
    失敗寫 logs/futures_oi.log，回傳 source='mock' 含 null 欄位
    """
    CACHE_KEY = 'inst_futures_oi'
    now = datetime.now()

    # 自訂快取（TTL 至隔日 08:00）
    cached = _inst_oi_cache.get(CACHE_KEY)
    if cached and now < cached['_expires']:
        return {k: v for k, v in cached.items() if k != '_expires'}

    mock_result = {
        'source':           'mock',
        'date':             date.today().isoformat(),
        'dealer':           {'long': None, 'short': None, 'net': None},
        'investment_trust': {'long': None, 'short': None, 'net': None},
        'foreign':          {'long': None, 'short': None, 'net': None},
    }

    def _next_08() -> datetime:
        target = now.replace(hour=8, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        return target

    def _log(msg: str) -> None:
        try:
            os.makedirs('logs', exist_ok=True)
            with open('logs/futures_oi.log', 'a', encoding='utf-8') as f:
                f.write(f'[{now.strftime("%Y-%m-%d %H:%M:%S")}] {msg}\n')
        except Exception:
            pass

    FIELD_MAP = {
        'date':        ['日期', 'Date', 'date'],
        'code':        ['契約代碼', 'ContractCode', 'contract'],
        'dealer_long':  ['自營商_多方未平倉口數', 'Dealer_Long',              'dealer_long'],
        'dealer_short': ['自營商_空方未平倉口數', 'Dealer_Short',             'dealer_short'],
        'dealer_net':   ['自營商_多空淨額',       'Dealer_Net',               'dealer_net'],
        'it_long':      ['投信_多方未平倉口數',   'InvestmentTrust_Long',     'investment_trust_long'],
        'it_short':     ['投信_空方未平倉口數',   'InvestmentTrust_Short',    'investment_trust_short'],
        'it_net':       ['投信_多空淨額',         'InvestmentTrust_Net',      'investment_trust_net'],
        'fo_long':      ['外資及陸資_多方未平倉口數', 'Foreign_Long',          'foreign_long'],
        'fo_short':     ['外資及陸資_空方未平倉口數', 'Foreign_Short',         'foreign_short'],
        'fo_net':       ['外資及陸資_多空淨額',      'Foreign_Net',           'foreign_net'],
    }

    def _find_col(csv_headers: list, candidates: list) -> str | None:
        for c in candidates:
            if c in csv_headers:
                return c
        return None

    def _int(s) -> int:
        try:
            return int(str(s).replace(',', '').replace(' ', '') or 0)
        except Exception:
            return 0

    url = (
        'https://www.taifex.com.tw/data_gov/taifex_open_data.asp'
        '?data_name=MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate'
    )
    req_headers = {
        'User-Agent': 'Mozilla/5.0 (ProTrader/1.1)',
        'Referer':    'https://www.taifex.com.tw/',
    }

    try:
        r = requests.get(url, headers=req_headers, timeout=12)
        r.raise_for_status()

        raw  = r.content
        text = None
        for enc in ('utf-8-sig', 'big5', 'cp950'):
            try:
                text = raw.decode(enc)
                break
            except Exception:
                continue
        if text is None:
            raise ValueError('CSV 解碼失敗（嘗試 utf-8-sig / big5 / cp950）')

        reader      = csv.DictReader(io.StringIO(text))
        csv_headers = list(reader.fieldnames or [])
        _log(f'CSV 欄位：{csv_headers}')

        col      = {k: _find_col(csv_headers, v) for k, v in FIELD_MAP.items()}
        code_col = col['code']
        if not code_col:
            raise ValueError(f'找不到契約代碼欄位，實際欄位：{csv_headers}')

        result     = None
        data_date  = date.today().isoformat()

        for row in reader:
            if str(row.get(code_col, '')).strip() != 'TX':
                continue

            if col['date']:
                data_date = str(row.get(col['date'], '')).strip() or data_date

            def _get_int(field_key: str) -> int | None:
                c = col.get(field_key)
                return _int(row.get(c, 0)) if c else None

            d_long, d_short, d_net = _get_int('dealer_long'), _get_int('dealer_short'), _get_int('dealer_net')
            i_long, i_short, i_net = _get_int('it_long'),     _get_int('it_short'),     _get_int('it_net')
            f_long, f_short, f_net = _get_int('fo_long'),     _get_int('fo_short'),     _get_int('fo_net')

            if d_net is None and d_long is not None and d_short is not None:
                d_net = d_long - d_short
            if i_net is None and i_long is not None and i_short is not None:
                i_net = i_long - i_short
            if f_net is None and f_long is not None and f_short is not None:
                f_net = f_long - f_short

            result = {
                'source':           'taifex',
                'date':             data_date,
                'dealer':           {'long': d_long,  'short': d_short,  'net': d_net},
                'investment_trust': {'long': i_long,  'short': i_short,  'net': i_net},
                'foreign':          {'long': f_long,  'short': f_short,  'net': f_net},
            }
            break

        if result is None:
            raise ValueError('CSV 中無 TX 資料列')

        _log(f'成功：date={data_date}, dealer_net={d_net}, it_net={i_net}, foreign_net={f_net}')
        _inst_oi_cache[CACHE_KEY] = {**result, '_expires': _next_08()}
        return result

    except Exception as e:
        _log(f'失敗：{e}')
        print(f'[TAIFEX-CSV] get_institutional_futures_oi 失敗：{e}')
        return mock_result


# deprecated：保留舊簽名一個版本，供平滑過渡
def get_futures_oi() -> dict:
    """
    外資期貨未平倉口數（台指期 TX，TAIFEX Open API）
    依序嘗試：今日 / 昨日 / 前日，格式 YYYYMMDD 與 YYYY-MM-DD 各試一次
    """
    from datetime import timedelta

    key = 'futures_oi'
    if key in _cache_daily:
        return _cache_daily[key]

    result = {
        'source':        'mock',
        'date':          date.today().isoformat(),
        'foreign_net':   0,
        'foreign_long':  0,
        'foreign_short': 0,
        'unit':          '口',
    }

    url     = 'https://openapi.taifex.com.tw/v1/DailyForeignInvestorsPositions'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
        'Referer':    'https://www.taifex.com.tw/',
    }

    def _try_parse(data, date_str):
        if not (data and isinstance(data, list)):
            return False
        for row in data:
            name = str(row.get('ContractName',
                       row.get('contractName',
                       row.get('商品名稱', ''))))
            if 'TX' not in name and '臺股期貨' not in name and '台股期貨' not in name:
                continue
            try:
                lo = int(row.get('LongOpenInterest',
                         row.get('longOI',
                         row.get('外資多方未平倉口數', 0))) or 0)
                so = int(row.get('ShortOpenInterest',
                         row.get('shortOI',
                         row.get('外資空方未平倉口數', 0))) or 0)
                no_raw = row.get('NetOpenInterest',
                         row.get('netOI',
                         row.get('外資淨未平倉口數', None)))
                no = int(no_raw or lo - so)
                result.update({
                    'source':        'TAIFEX',
                    'foreign_long':  lo,
                    'foreign_short': so,
                    'foreign_net':   no,
                    'date':          row.get('Date', row.get('queryDate', date_str)),
                })
                return True
            except Exception as e:
                print(f'[TAIFEX] 單列解析失敗: {e}')
        return False

    for delta in range(4):
        try_date = date.today() - timedelta(days=delta)
        for fmt in ('%Y%m%d', '%Y-%m-%d'):
            date_str = try_date.strftime(fmt)
            try:
                data = _get(url, {'queryDate': date_str}, headers=headers)
                if _try_parse(data, date_str):
                    print(f'[TAIFEX] 成功 queryDate={date_str}')
                    _cache_daily[key] = result
                    return result
            except Exception as e:
                print(f'[TAIFEX] 請求失敗 date={date_str}: {e}')

    print('[TAIFEX] 全部日期皆失敗，回傳 mock')
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


# ─────────────────────────────────────────
#  AI 焦點規則引擎
# ─────────────────────────────────────────

# 熱門題材股票代號（手動維護，有 +5 題材加分）
_HOT_THEME_CODES = {
    '2330', '2454', '3711', '2308', '2317',  # AI 伺服器主鏈
    '3034', '4938', '6669', '3661', '2379',  # CoWoS / HBM
    '2382', '3008', '4958', '6409', '8016',  # 散熱 / PCB
    '2303', '2357', '2376', '2377', '3231',  # 半導體 / 整機
}


def _pz(s) -> int:
    """T86 千股欄位 → 整數（單位：張）"""
    try:
        return int(str(s).replace(',', '').replace('+', '').replace(' ', '') or 0)
    except Exception:
        return 0


def get_stock_day_all() -> dict:
    """最近交易日所有上市股票收盤行情（自動回溯，支援週末/假日）
    回傳: { code: { name, close, change_pct, volume_k } }
    """
    from datetime import timedelta

    key = 'stock_day_all'
    if key in _cache_daily:
        return _cache_daily[key]

    url    = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL'
    result = {}

    # 先試不帶日期（API 通常回最新交易日）
    data = _get(url, {'response': 'json'})

    # 若資料不足（非交易日），回溯最近 5 個交易日
    if not (data and 'data' in data and len(data.get('data', [])) > 100):
        for delta in range(1, 6):
            try_date = date.today() - timedelta(days=delta)
            if try_date.weekday() >= 5:
                continue
            data = _get(url, {'response': 'json',
                               'date': try_date.strftime('%Y%m%d')})
            if data and 'data' in data and len(data.get('data', [])) > 100:
                print(f'[TWSE] STOCK_DAY_ALL 使用 {try_date} 資料')
                break
        else:
            data = None

    if data and 'data' in data:
        for row in data['data']:
            try:
                if len(row) < 10:
                    continue
                code = str(row[0]).strip()
                if not code.isdigit() or len(code) != 4:
                    continue
                close = float(str(row[7]).replace(',', '') or 0)  # row[7]=收盤價
                if close <= 0:
                    continue
                # row[8]=漲跌價差（含符號，如 +0.38 / -1.20），無獨立符號欄
                chg_signed  = float(str(row[8]).replace(',', '') or 0)
                prev_close  = close - chg_signed
                change_pct  = round(chg_signed / prev_close * 100, 2) if prev_close > 0 else 0.0
                volume_k    = int(str(row[2]).replace(',', '') or 0) // 1000  # 股 → 張
                result[code] = {
                    'name':       str(row[1]).strip(),
                    'close':      close,
                    'change_pct': round(change_pct, 2),
                    'volume_k':   volume_k,
                }
            except Exception:
                continue

    if result:
        _cache_daily[key] = result
    return result


def _score_focus(f_k: int, i_k: int, chg: float, vol_k: int, is_hot: bool) -> int:
    """計算 AI 分數（滿分 100）
    新權重：量能(50) + 外資買超(40) + 漲幅(10)
    —— 避免大型股因為外資絕對量過大而壟斷排行
    f_k:   外資淨買超（張）
    vol_k: 成交量（張）
    chg:   當日漲幅（%）
    """
    # 量能分（50）—— 相對換手率導向，讓中小型股也有機會
    if vol_k >= 50000:
        v = 50.0
    elif vol_k >= 10000:
        v = 20.0 + (vol_k - 10000) / 40000 * 30
    elif vol_k >= 3000:
        v = 5.0 + (vol_k - 3000) / 7000 * 15
    else:
        v = (vol_k / 3000) * 5

    # 外資買超分（40）
    if f_k >= 5000:
        f = 40.0
    elif f_k >= 1000:
        f = 20.0 + (f_k - 1000) / 4000 * 20
    elif f_k >= 0:
        f = (f_k / 1000) * 20
    else:
        f = 0.0

    # 漲幅分（10）
    if chg >= 3.0:
        c = 10.0
    elif chg >= 1.0:
        c = 4.0 + (chg - 1.0) / 2.0 * 6
    elif chg >= 0.0:
        c = chg * 4.0
    else:
        c = 0.0

    return min(int(round(v + f + c)), 100)


def _gen_reason(f_k: int, i_k: int, chg: float, vol_k: int = 0) -> str:
    """根據量能、外資、漲幅三因子自動生成理由"""
    parts = []
    if vol_k >= 10000:
        parts.append(f'成交量 {vol_k:,} 張（市場高度關注）')
    elif vol_k >= 3000:
        parts.append(f'成交量 {vol_k:,} 張')
    if f_k >= 1000:
        parts.append(f'外資買超 {f_k:,} 張')
    elif f_k > 0:
        parts.append('外資小幅買進')
    if chg >= 2.0:
        parts.append(f'強勢上漲 {chg:+.1f}%')
    return '，'.join(parts[:2]) if parts else '量能放大、籌碼偏多'


def get_focus_stocks() -> list | None:
    """規則引擎選股：回傳今日焦點前 5 名
    資料來源：T86（個股三大法人）+ STOCK_DAY_ALL（收盤行情）
    篩選條件：漲幅>0、量>500張、股價>20元、外資or投信至少一方買超
    """
    from datetime import timedelta

    key = 'focus_stocks'
    if key in _cache_daily:
        return _cache_daily[key]

    # 嘗試最近 4 個交易日取 T86（含昨日；週末自動跳過）
    t86_map: dict = {}
    t86_date: str = ''          # 記錄實際取到的資料日期
    for delta in range(5):
        try_date = date.today() - timedelta(days=delta)
        if try_date.weekday() >= 5:          # 跳過週末
            continue
        url  = 'https://www.twse.com.tw/fund/T86'
        data = _get(url, {'response': 'json',
                          'date': try_date.strftime('%Y%m%d'),
                          'selectType': 'ALLBUT0999'})
        if not (data and 'data' in data and len(data['data']) > 5):
            continue
        for row in data['data'][:-1]:        # 最後列為合計，跳過
            try:
                if len(row) < 11:
                    continue
                code = str(row[0]).strip()
                if not code.isdigit() or len(code) != 4:
                    continue
                # 外資及陸資[4] + 外資自營商[7]
                # T86 單位為股，除以 1000 換算為張
                f_net = (_pz(row[4]) + _pz(row[7])) // 1000
                i_net = _pz(row[10]) // 1000
                t86_map[code] = {
                    'name':     str(row[1]).strip(),
                    'foreign_k': f_net,
                    'invest_k':  i_net,
                }
            except Exception:
                continue
        if t86_map:
            t86_date = try_date.strftime('%Y/%m/%d')
            print(f'[FOCUS] T86 使用 {t86_date} 資料（前一交易日）')
            break

    if not t86_map:
        print('[FOCUS] T86 無資料，回傳 None')
        return None

    # 取收盤行情
    price_map = get_stock_day_all()
    if not price_map:
        print('[FOCUS] STOCK_DAY_ALL 無資料，回傳 None')
        return None

    # 計算分數 + 篩選
    candidates = []
    for code, inst in t86_map.items():
        price = price_map.get(code)
        if not price:
            continue
        chg   = price['change_pct']
        vol   = price['volume_k']
        close = price['close']
        f_k   = inst['foreign_k']
        i_k   = inst['invest_k']

        # 篩選門檻
        if chg <= 0:
            continue
        if vol < 500:
            continue
        if close < 20:
            continue
        if f_k < 0:                        # 外資賣超 → 排除（量能+外資為主軸）
            continue

        score = _score_focus(f_k, i_k, chg, vol, code in _HOT_THEME_CODES)
        candidates.append({
            'rank':   0,
            'code':   code,
            'name':   inst['name'] or price['name'],
            'score':  score,
            'chg':    f'{chg:+.1f}%',
            'reason': _gen_reason(f_k, i_k, chg, vol),
        })

    if not candidates:
        print('[FOCUS] 無符合篩選條件的股票，回傳 None')
        return None

    candidates.sort(key=lambda x: x['score'], reverse=True)
    result = []
    for i, item in enumerate(candidates[:5], 1):
        item['rank'] = i
        item['data_date'] = t86_date   # 前一交易日日期，供前端顯示
        result.append(item)

    _cache_daily[key] = result
    print(f'[FOCUS] 選出 {len(result)} 支，資料日期 {t86_date}，第一名：{result[0]["code"]} {result[0]["name"]} ({result[0]["score"]}分)')
    return result
