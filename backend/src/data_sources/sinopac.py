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
    now = datetime.now()
    if now.weekday() >= 5:
        return False
    t = now.time()
    return dtime(9, 0) <= t <= dtime(13, 30)


def _init_shioaji():
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


def get_realtime_quote(code):
    global _api, _ready
    if not HAS_SINOPAC or not _SHIOAJI_AVAILABLE or not _is_market_open():
        return None
    cache_key = f'sj_{code}'
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]
    if not _ready:
        if not _init_shioaji():
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
    global _api, _ready
    if not HAS_SINOPAC or not _SHIOAJI_AVAILABLE or not _ready:
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


def is_available():
    return _ready and _is_market_open()


def logout():
    global _api, _ready
    if _api and _ready:
        try:
            _api.logout()
        except Exception:
            pass
    _ready = False
