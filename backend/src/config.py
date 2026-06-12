"""
config.py
"""
import os
from dotenv import load_dotenv

load_dotenv()

SINOPAC_API_KEY    = os.getenv('SINOPAC_API_KEY', '')
SINOPAC_SECRET_KEY = os.getenv('SINOPAC_API_SECRET', os.getenv('SINOPAC_SECRET_KEY', ''))
CACHE_TTL_REALTIME = int(os.getenv('CACHE_TTL_REALTIME', 10))
CACHE_TTL_DAILY    = int(os.getenv('CACHE_TTL_DAILY', 300))
HAS_SINOPAC = bool(SINOPAC_API_KEY and SINOPAC_SECRET_KEY)
