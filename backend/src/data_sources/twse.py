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
    三大法人台指期(TX)未平倉口數（TAIFEX open data CSV）

    CSV 結構：依身份別分行
      欄位：日期 / 商品名稱 / 身份別 / 多方未平倉口數 / 空方未平倉口數 / 多空未平倉口數淨額
      身份別值：自營商 / 投信 / 外資及陸資

    快取至隔日 08:00；失敗寫 logs/futures_oi.log，回傳 source='mock'
    """
    CACHE_KEY = 'inst_futures_oi'
    now = datetime.now()

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

    def _int(s) -> int:
        try:
            return int(str(s).replace(',', '').replace(' ', '').replace('+', '') or 0)
        except Exception:
            return 0

    # 身份別 → result key 對照
    IDENTITY_MAP = {
        '自營商':     'dealer',
        '投信':       'investment_trust',
        '外資及陸資': 'foreign',
        '外資':       'foreign',
    }

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

        # 自動偵測分隔符（tab 優先，否則逗號）
        delimiter = '\t' if '\t' in text[:300] else ','
        reader      = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        csv_headers = list(reader.fieldnames or [])
        _log(f'CSV 欄位：{csv_headers}，分隔符：{"tab" if delimiter == chr(9) else "comma"}')

        # 欄位定位（含空格 strip）
        def _col(keywords: list) -> str | None:
            for h in csv_headers:
                hs = h.strip()
                for kw in keywords:
                    if kw in hs:
                        return h
            return None

        # 精確比對欄名（strip 去除前後空白），避免誤匹配交易量欄
        _hmap        = {h.strip(): h for h in csv_headers}
        col_product  = _hmap.get('商品名稱')
        col_date     = _hmap.get('日期')
        col_identity = _hmap.get('身份別')
        col_long     = _hmap.get('多方未平倉口數')
        col_short    = _hmap.get('空方未平倉口數')
        col_net      = _hmap.get('多空未平倉口數淨額')

        if not col_identity:
            raise ValueError(f'找不到身份別欄位，實際欄位：{csv_headers}')

        # 讀取全部列，篩選 TX / 臺股期貨
        tx_rows = []
        for row in reader:
            product = str(row.get(col_product, '') if col_product else '').strip()
            if 'TX' not in product and '臺股期貨' not in product:
                continue
            tx_rows.append(row)

        if not tx_rows:
            raise ValueError(f'篩選後無 TX/臺股期貨資料，商品名稱欄：{col_product}，欄位：{csv_headers}')

        # 取最新日期的列
        if col_date:
            latest_date = max(str(r.get(col_date, '')).strip() for r in tx_rows)
            tx_rows = [r for r in tx_rows if str(r.get(col_date, '')).strip() == latest_date]
        else:
            latest_date = date.today().isoformat()

        _log(f'TX 資料列 {len(tx_rows)} 筆，最新日期：{latest_date}')

        # 依身份別分組
        groups: dict = {}
        for row in tx_rows:
            identity = str(row.get(col_identity, '')).strip()
            key = IDENTITY_MAP.get(identity)
            if key is None:
                continue
            long_v  = _int(row.get(col_long,  0) if col_long  else 0)
            short_v = _int(row.get(col_short, 0) if col_short else 0)
            net_v   = _int(row.get(col_net,   0) if col_net   else long_v - short_v)
            groups[key] = {'long': long_v, 'short': short_v, 'net': net_v}

        if not groups:
            raise ValueError(f'身份別解析結果為空，身份別欄值：{[r.get(col_identity,"") for r in tx_rows]}')

        null_grp = {'long': None, 'short': None, 'net': None}
        result = {
            'source':           'taifex',
            'date':             latest_date,
            'dealer':           groups.get('dealer',           null_grp),
            'investment_trust': groups.get('investment_trust', null_grp),
            'foreign':          groups.get('foreign',          null_grp),
        }

        _log(
            f'成功：dealer_net={groups.get("dealer",{}).get("net")}，'
            f'it_net={groups.get("investment_trust",{}).get("net")}，'
            f'foreign_net={groups.get("foreign",{}).get("net")}'
        )
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


def get_taiex_history(days: int = 10) -> dict | None:
    """
    加權指數近 N 日日線（TWSE FMTQIK 月統計）
    回傳 { records:[{date,close,volume}], consecutive_k:int, volume_slope:float }
    consecutive_k > 0 = 連續紅K天數；< 0 = 連續黑K天數
    volume_slope：最近5日均量趨勢（平均每日 % 變化）
    """
    key = f'taiex_hist_{days}'
    if key in _cache_daily:
        return _cache_daily[key]

    url     = 'https://www.twse.com.tw/exchangeReport/FMTQIK'
    records = []

    for delta_month in range(3):
        m = date.today().month - delta_month
        y = date.today().year
        while m <= 0:
            m += 12; y -= 1
        data = _get(url, {'response': 'json', 'date': f'{y}{m:02d}01'})
        if not (data and 'data' in data):
            time.sleep(0.2)
            continue
        for row in data['data']:
            try:
                # 日期格式：民國 115/06/02
                parts = str(row[0]).strip().split('/')
                iso   = f'{int(parts[0]) + 1911}-{int(parts[1]):02d}-{int(parts[2]):02d}'
                close = float(str(row[4]).replace(',', ''))
                vol   = float(str(row[2]).replace(',', ''))  # 成交金額（仟元）
                records.append({'date': iso, 'close': close, 'volume': vol})
            except Exception:
                pass
        time.sleep(0.2)
        if len(records) >= days:
            break

    if not records:
        return None

    records = sorted(records, key=lambda r: r['date'])[-days:]

    for i in range(len(records)):
        prev = records[i - 1]['close'] if i > 0 else records[i]['close']
        records[i]['is_up'] = records[i]['close'] >= prev

    # 連續紅/黑K（從最後一筆往前）
    consecutive_k = 0
    if len(records) >= 2:
        up    = records[-1]['is_up']
        count = 0
        for r in reversed(records):
            if r['is_up'] == up:
                count += 1
            else:
                break
        consecutive_k = count if up else -count

    # 5日量趨勢
    vols = [r['volume'] for r in records[-5:]]
    if len(vols) >= 2:
        diffs        = [(vols[i] - vols[i-1]) / max(vols[i-1], 1) * 100
                        for i in range(1, len(vols))]
        volume_slope = round(sum(diffs) / len(diffs), 2)
    else:
        volume_slope = 0.0

    result = {
        'records':       records,
        'consecutive_k': consecutive_k,
        'volume_slope':  volume_slope,
        'volume_5day':   vols,
    }
    _cache_daily[key] = result
    return result


def get_market_breadth() -> dict | None:
    """
    漲跌家數（從 STOCK_DAY_ALL 導出，含漲停/跌停統計）
    """
    key = 'market_breadth'
    if key in _cache_daily:
        return _cache_daily[key]

    price_map = get_stock_day_all()
    if not price_map:
        return None

    up = dn = limit_up = limit_dn = unchanged = 0
    for v in price_map.values():
        pct = v['change_pct']
        if pct >= 9.5:     limit_up += 1; up += 1
        elif pct > 0:      up += 1
        elif pct == 0:     unchanged += 1
        elif pct <= -9.5:  limit_dn += 1; dn += 1
        else:              dn += 1

    total = up + dn
    result = {
        'up':             up,
        'down':           dn,
        'unchanged':      unchanged,
        'limit_up':       limit_up,
        'limit_down':     limit_dn,
        'total':          len(price_map),
        'up_ratio':       round(up / max(total, 1) * 100, 1),
        'limit_up_ratio': round(limit_up / max(total, 1) * 100, 1),
    }
    _cache_daily[key] = result
    return result


def get_put_call_ratio() -> dict | None:
    """
    TAIFEX Put/Call Ratio（選擇權未平倉量比率，data_name=PutCallRatio）
    欄位名稱防禦式解析
    """
    key = 'pcr'
    if key in _cache_daily:
        return _cache_daily[key]

    url = (
        'https://www.taifex.com.tw/data_gov/taifex_open_data.asp'
        '?data_name=PutCallRatio'
    )
    req_headers = {
        'User-Agent': 'Mozilla/5.0 (ProTrader/1.1)',
        'Referer':    'https://www.taifex.com.tw/',
    }

    try:
        r = requests.get(url, headers=req_headers, timeout=10)
        r.raise_for_status()

        raw  = r.content
        text = None
        for enc in ('utf-8-sig', 'big5', 'cp950'):
            try:
                text = raw.decode(enc); break
            except Exception:
                continue
        if not text:
            return None

        delimiter   = '\t' if '\t' in text[:300] else ','
        reader      = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        csv_headers = list(reader.fieldnames or [])
        _hmap       = {h.strip(): h for h in csv_headers}

        col_date    = _hmap.get('日期')
        col_pcr_oi  = (_hmap.get('買賣權未平倉量比率')
                       or _hmap.get('買賣權未平倉口數比率'))
        col_pcr_vol = _hmap.get('買賣權成交量比率')

        rows = list(reader)
        if not rows:
            return None

        if col_date:
            latest = max(str(rw.get(col_date, '')).strip() for rw in rows)
            rows   = [rw for rw in rows if str(rw.get(col_date, '')).strip() == latest]
        else:
            latest = date.today().isoformat()

        def _f(s) -> float:
            try:
                return float(str(s).replace(',', '').strip() or 0)
            except Exception:
                return 0.0

        row     = rows[0]
        pcr_oi  = _f(row.get(col_pcr_oi,  0) if col_pcr_oi  else 0)
        pcr_vol = _f(row.get(col_pcr_vol, 0) if col_pcr_vol else 0)
        pcr     = pcr_oi if pcr_oi > 0 else pcr_vol

        if pcr == 0:
            print(f'[PCR] PCR=0，欄位未對應，實際欄位：{csv_headers}')
            return None

        result = {
            'pcr':     round(pcr,     2),
            'pcr_oi':  round(pcr_oi,  2),
            'pcr_vol': round(pcr_vol, 2),
            'date':    latest,
        }
        _cache_daily[key] = result
        return result

    except Exception as e:
        print(f'[TAIFEX] PCR 失敗：{e}')
        return None


def _score_indicator(name: str, value: float) -> int:
    """各溫度指標線性插值換算 0-100 分"""

    def lerp(v, v0, v1, s0, s1) -> int:
        if v <= v0: return int(s0)
        if v >= v1: return int(s1)
        return round(s0 + (v - v0) / (v1 - v0) * (s1 - s0))

    if name == 'foreign_stock':    # 外資現貨 億元
        if value >= 300:  return 100
        if value >= 100:  return lerp(value, 100, 300, 70, 100)
        if value >= 0:    return lerp(value, 0,   100,  50, 70)
        if value >= -300: return lerp(value, -300, 0,    0, 50)
        return 0

    if name == 'invest_stock':     # 投信現貨 億元
        if value >= 100:  return 100
        if value >= 0:    return lerp(value, 0,   100, 50, 100)
        if value >= -50:  return lerp(value, -50,  0,   0,  50)
        return 0

    if name == 'foreign_futures':  # 外資期貨淨口數
        if value >= 5000:  return 100
        if value >= 0:     return lerp(value, 0,     5000, 50, 100)
        if value >= -5000: return lerp(value, -5000, 0,     0,  50)
        return 0

    if name == 'consecutive_k':    # 正=紅K天數，負=黑K天數
        if value >= 5:  return lerp(value, 5,  10, 85, 100)
        if value >= 3:  return lerp(value, 3,   5, 65, 84)
        if value >= 1:  return lerp(value, 1,   3, 55, 64)
        if value == 0:  return 50
        if value >= -2: return lerp(value, -2,  0, 36, 49)
        if value >= -4: return lerp(value, -4, -2, 16, 35)
        return lerp(value, -10, -4, 0, 15)

    if name == 'volume_slope':     # %/日
        if value >= 10:   return lerp(value,  10, 25, 85, 100)
        if value >= 0:    return lerp(value,   0, 10, 65, 84)
        if value >= -5:   return lerp(value,  -5,  0, 45, 55)
        if value >= -10:  return lerp(value, -10, -5, 20, 44)
        return lerp(value, -25, -10, 0, 19)

    if name == 'pcr':              # Put/Call Ratio
        if value <= 0.5:  return 100
        if value <= 0.7:  return lerp(value, 0.5, 0.7, 75, 100)
        if value <= 1.0:  return lerp(value, 0.7, 1.0, 50,  75)
        if value <= 1.5:  return lerp(value, 1.0, 1.5, 25,  50)
        return lerp(value, 1.5, 3.0, 0, 25)

    if name == 'breadth':          # up_ratio (0-1)
        if value >= 0.8:  return lerp(value, 0.8, 1.0, 90, 100)
        if value >= 0.7:  return lerp(value, 0.7, 0.8, 70,  89)
        if value >= 0.45: return lerp(value, 0.45, 0.7, 40, 69)
        if value >= 0.3:  return lerp(value, 0.3, 0.45, 20, 39)
        return lerp(value, 0, 0.3, 0, 19)

    return 50


def calc_temperature() -> dict:
    """
    大盤溫度計：7項指標加權平均
    任一指標失敗 → 排除，其他指標等比例重新分配權重
    """
    key = 'temperature'
    if key in _cache_daily:
        return _cache_daily[key]

    inst = get_institutional_today()
    oi   = get_institutional_futures_oi()
    hist = get_taiex_history(10)
    brd  = get_market_breadth()
    pcr  = get_put_call_ratio()

    # (内部key, 顯示名稱, 分數, 值文字, 基礎權重)
    indicators: list[tuple] = []

    if inst and inst.get('foreign'):
        nb = inst['foreign']['net'] / 1e8
        indicators.append(('foreign_stock', '外資現貨',
                            _score_indicator('foreign_stock', nb),
                            f'{nb:+.0f}億', 15))

    if inst and inst.get('investment'):
        nb = inst['investment']['net'] / 1e8
        indicators.append(('invest_stock', '投信現貨',
                            _score_indicator('invest_stock', nb),
                            f'{nb:+.0f}億', 10))

    if oi and oi.get('source') != 'mock' and oi.get('foreign', {}).get('net') is not None:
        net = oi['foreign']['net']
        indicators.append(('foreign_futures', '外資期貨',
                            _score_indicator('foreign_futures', net),
                            f'{net:+,}口', 15))

    if hist:
        ck  = hist['consecutive_k']
        lbl = (f'紅K {ck}天' if ck > 0 else f'黑K {abs(ck)}天' if ck < 0 else '平盤')
        indicators.append(('consecutive_k', '連續K棒',
                            _score_indicator('consecutive_k', ck),
                            lbl, 15))

    if hist:
        sl = hist['volume_slope']
        indicators.append(('volume_slope', '成交量',
                            _score_indicator('volume_slope', sl),
                            f'{sl:+.1f}%/日', 15))

    if pcr and pcr.get('pcr'):
        p = pcr['pcr']
        indicators.append(('pcr', 'PC Ratio',
                            _score_indicator('pcr', p),
                            str(p), 15))

    if brd:
        ratio = brd['up_ratio'] / 100.0
        indicators.append(('breadth', '漲跌家數',
                            _score_indicator('breadth', ratio),
                            f'{brd["up_ratio"]}%漲', 15))

    total_w = sum(ind[4] for ind in indicators) or 1
    score   = round(sum(ind[2] * ind[4] for ind in indicators) / total_w)

    BANDS = [
        (20,  '極度恐慌', '市場大量拋售，可留意逢低機會', 'darkblue'),
        (40,  '偏空',     '法人持續賣超，謹慎觀望',       'blue'),
        (60,  '中性',     '多空均衡，無明顯方向',         'green'),
        (75,  '偏熱',     '短線過熱，注意追高風險',       'orange'),
        (85,  '過熱',     '籌碼面偏多但需警戒反轉',       'darkorange'),
        (100, '極度貪婪', '市場過度樂觀，高風險區',       'red'),
    ]
    label, desc, color = next(
        (b[1], b[2], b[3]) for b in BANDS if score <= b[0]
    )

    # 當日大盤總成交量（億元）：來自 FMTQIK 成交金額（仟元）÷ 100,000
    volume_yi = None
    if hist and hist.get('volume_5day'):
        try:
            volume_yi = round(hist['volume_5day'][-1] / 100_000)
        except Exception:
            pass

    result = {
        'score':       score,
        'label':       label,
        'description': desc,
        'color':       color,
        'volume':      volume_yi,
        'indicators': [
            {
                'name':   ind[1],
                'value':  ind[3],
                'score':  ind[2],
                'weight': round(ind[4] / total_w, 3),
            }
            for ind in indicators
        ],
        'source': 'computed',
    }
    _cache_daily[key] = result
    return result


def get_volume_ranking(n: int = 20) -> list:
    """
    當日成交量排行前 N 名（從 STOCK_DAY_ALL 導出）
    回傳 [{ code, name, volume_k, close, change_pct }, ...]
    """
    price_map = get_stock_day_all()
    if not price_map:
        return []
    ranked = sorted(price_map.items(), key=lambda x: x[1]['volume_k'], reverse=True)
    return [
        {
            'code':       code,
            'name':       v['name'],
            'volume_k':   v['volume_k'],
            'close':      v['close'],
            'change_pct': v['change_pct'],
        }
        for code, v in ranked[:n]
    ]


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


# ─────────────────────────────────────────
#  新版焦點排序（4因子規則式）
# ─────────────────────────────────────────

FOCUS_POOL = ['2330', '2317', '2454', '2882', '2886', '2603', '6770', '3711', '2379', '2308']


def calc_focus_ranking(pool: list | None = None) -> dict | None:
    """
    今日焦點 AI 排序（3因子規則式評分）
    因子：外資買超排名(40) + 爆量倍數(30) + 當日漲幅(30)
    pool：優先用傳入清單（M6 觀察清單），不足20檔自動補當日成交量排行前20
    回傳前20名
    """
    pool = list(pool) if pool else []

    # 不足 20 檔：從成交量排行補齊（去重保持順序）
    if len(pool) < 20:
        vol_codes = [v['code'] for v in get_volume_ranking(20)]
        seen: set = set(pool)
        for c in vol_codes:
            if c not in seen:
                pool.append(c)
                seen.add(c)
            if len(pool) >= 20:
                break

    cache_key = f'focus_rank_{"_".join(sorted(pool))}'
    if cache_key in _cache_daily:
        return _cache_daily[cache_key]

    # ── T86：只需最近1個交易日 ──
    today_t86: dict = {}
    for delta in range(7):
        try_date = date.today() - timedelta(days=delta)
        if try_date.weekday() >= 5:
            continue
        url  = 'https://www.twse.com.tw/fund/T86'
        data = _get(url, {'response': 'json',
                          'date': try_date.strftime('%Y%m%d'),
                          'selectType': 'ALLBUT0999'})
        if not (data and 'data' in data and len(data['data']) > 5):
            continue
        for row in data['data'][:-1]:
            try:
                code = str(row[0]).strip()
                if code not in pool:
                    continue
                f_net = (_pz(row[4]) + _pz(row[7])) // 1000
                today_t86[code] = {'foreign_net_k': f_net, 'name': str(row[1]).strip()}
            except Exception:
                pass
        if today_t86:
            break

    # ── 當日行情 ──
    price_map = get_stock_day_all()
    if not price_map:
        return None

    # ── 爆量基準：池內中位量（張），不呼叫額外 HTTP 請求 ──
    pool_vols = sorted(
        price_map[c]['volume_k'] for c in pool if c in price_map
    )
    median_vol = pool_vols[len(pool_vols) // 2] if pool_vols else 1

    # ── 外資買超排名換算（第1名40分，線性遞減）──
    pool_inst   = {code: today_t86.get(code, {}).get('foreign_net_k', 0) for code in pool}
    sorted_pool = sorted(pool_inst, key=lambda c: pool_inst[c], reverse=True)
    n           = max(len(sorted_pool), 1)
    rank_score  = {c: round(40 * (n - i) / n) for i, c in enumerate(sorted_pool)}

    # ── 計算得分 ──
    results = []
    for code in pool:
        price = price_map.get(code)
        if not price:
            continue

        chg   = price['change_pct']
        vol_k = price['volume_k']
        f_buy = today_t86.get(code, {}).get('foreign_net_k', 0)
        name  = today_t86.get(code, {}).get('name') or price.get('name', code)

        vol_ratio = min(vol_k / max(median_vol, 1), 3.0)
        vol_score = round(vol_ratio / 3 * 30)
        chg_score = round(min(max(chg, 0), 5) / 5 * 30)
        f_score   = rank_score.get(code, 0)
        total     = min(f_score + vol_score + chg_score, 100)

        results.append({
            'code':         code,
            'name':         name,
            'score':        total,
            'change_pct':   round(chg, 1),
            'volume_ratio': round(vol_ratio, 2),
            'foreign_buy':  f_buy,
            'score_detail': {
                'foreign_rank': f_score,
                'volume':       vol_score,
                'change':       chg_score,
            },
        })

    results.sort(key=lambda x: x['score'], reverse=True)
    for i, r in enumerate(results[:20], 1):
        r['rank'] = i

    result = {
        'date':   date.today().isoformat(),
        'stocks': results[:20],
        'source': 'computed',
    }
    _cache_daily[cache_key] = result
    print(f'[FOCUS_RANK] 完成，共 {len(results[:20])} 支，第一名：{results[0]["code"] if results else "-"}')
    return result
