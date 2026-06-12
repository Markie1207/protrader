"""
config.py — 環境設定讀取
"""

import os
from dotenv import load_dotenv

load_dotenv()

# 永豐金 API
SINOPAC_API_KEY    = os.getenv('SINOPAC_API_KEY', '')
SINOPAC_SECRET_KEY = os.getenv('SINOPAC_SECRET_KEY', '')

# 快取 TTL（秒）
CACHE_TTL_REALTIME = int(os.getenv('CACHE_TTL_REALTIME', 10))
CACHE_TTL_DAILY    = int(os.getenv('CACHE_TTL_DAILY', 300))

# 是否有設定 Shioaji 金鑰
HAS_SINOPAC = bool(SINOPAC_API_KEY and SINOPAC_SECRET_KEY)
