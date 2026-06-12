"""
sinopac.py - 永豐金 Shioaji 即時資料封裝
"""
import threading
from datetime import datetime, time as dtime
from cachetools import TTLCache
from src.config import SINOPAC_API_KEY, SINOPAC_SECRET_KEY, HAS_SINOPAC, CACHE_TTL_REALTIME

try:
    import shioaji as _sj_module
    _SHIOAJI_AVAILABLE = True
except ImportError:
    _sj_module = None
    _SHIOAJI_AVAILABLE = False

_cache = TTLCache(maxsize=200, ttl=CACHE_TTL_REALTIME)
_lock  = threading.Lock()
_api   = None
_ready = False


def _is_market_open():
    """判斷台股是否在盤中（週一~五 09:00~13:30）"""
    now = datetime.now()
    if now.weekday() >= 5:
        return False
    t = now.time()
    return dtime(9, 0) <= t <= dtime(13, 30)


def _is_weekday():
    """是否為交易日（週一~五）"""
    return datetime.now().weekday() < 5


def _init_shioaji():
    """嘗試初始化 Shioaji，成功回傳 True（模擬帳號隨時可登入）"""
    global _api, _ready
    if not HAS_SINOPAC or not _SHIOAJI_AVAILABLE:
        return False
    try:
        _api = _sj_module.Shioaji(simulation=True)
        _api.login(api_key=SINOPAC_API_KEY, secret_key=SINOPAC_SECRET_KEY)
        _ready = True
        print('[Shioaji] 登入成功')
        return True
    except Exception as e:
        print(f'[Shioaji] 登入失敗: {e}')
        _ready = False
        return False


def _ensure_ready():
    """確保 Shioaji 已登入"""
    global _ready
    if not _ready:
        _init_shioaji()
    return _ready


def get_taiex():
    """取得加權指數快照（任何時間皆可，盤後回傳收盤值）"""
    if not HAS_SINOPAC or not _SHIOAJI_AVAILABLE:
        return None
    if not _ensure_ready():
        return None
    cache_key = 'sj_taiex'
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]
    try:
        contract = _api.Contracts.Indexs.TSE.TSE001
        snap     = _api.snapshots([contract])[0]
        result   = {
            'source':     'Shioaji',
            'index':      float(snap.close),
            'change':     float(snap.change_price),
            'change_pct': round(float(snap.change_rate), 2),
            'timestamp':  datetime.now().isoformat(),
        }
        with _lock:
            _cache[cache_key] = result
        return result
    except Exception as e:
        print(f'[Shioaji] TAIEX 失敗: {e}')
        return None


def get_realtime_quote(code):
    """報價快照：盤中=即時；盤後=最後成交價"""
    global _api, _ready
    if not HAS_SINOPAC or not _SHIOAJI_AVAILABLE:
        return None
    cache_key = f'sj_rt_{code}'
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]
    if not _ensure_ready():
        return None
    try:
        contract = _api.Contracts.Stocks[code]
        snapshot = _api.snapshots([contract])[0]
        result = {
            'source': 'Shioaji', 'code': code,
            'price': snapshot.close, 'open': snapshot.open,
            'high': snapshot.high, 'low': snapshot.low,
            'volume': snapshot.volume,
            'change': snapshot.change_price,
            'change_pct': snapshot.change_rate,
            'timestamp': datetime.now().isoformat(),
        }
        with _lock:
            _cache[cache_key] = result
        return result
    except Exception as e:
        print(f'[Shioaji] 報價失敗 {code}: {e}')
        _ready = False
        return None


def get_intraday_ticks(code):
    """今日分時 K 棒：盤中或盤後皆可取得"""
    if not HAS_SINOPAC or not _SHIOAJI_AVAILABLE:
        return []
    if not _ensure_ready():
        return []
    try:
        contract = _api.Contracts.Stocks[code]
        kbars    = _api.kbars(contract, start=datetime.today().strftime('%Y-%m-%d'))
        df       = kbars.to_df()
        return [
            {'time': str(row.ts), 'open': float(row.Open),
             'high': float(row.High), 'low': float(row.Low),
             'close': float(row.Close), 'volume': int(row.Volume)}
            for _, row in df.iterrows()
        ]
    except Exception as e:
        print(f'[Shioaji] 分時失敗 {code}: {e}')
        return []


def get_historical_kbars(code, start_date, end_date=None):
    """歷史日線：任何時間皆可取得"""
    if not HAS_SINOPAC or not _SHIOAJI_AVAILABLE:
        return []
    if not _ensure_ready():
        return []
    try:
        if end_date is None:
            end_date = datetime.today().strftime('%Y-%m-%d')
        contract = _api.Contracts.Stocks[code]
        kbars    = _api.kbars(contract, start=start_date, end=end_date,
                              resolution='1D')
        df       = kbars.to_df()
        return [
            {'date': str(row.ts)[:10],
             'open': float(row.Open), 'high': float(row.High),
             'low': float(row.Low), 'close': float(row.Close),
             'volume': int(row.Volume)}
            for _, row in df.iterrows()
        ]
    except Exception as e:
        print(f'[Shioaji] 歷史日線失敗 {code}: {e}')
        return []


def is_available():
    """回傳 Shioaji 目前是否可用（登入狀態）"""
    return _ready


def is_realtime_available():
    """即時報價是否可用（需盤中）"""
    return _ready and _is_market_open()


def logout():
    global _api, _ready
    if _api and _ready:
        try:
            _api.logout()
        except Exception:
            pass
    _ready = False
