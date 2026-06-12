"""
routes/health.py — 健康檢查（Railway / Vercel 監控用）
"""

from flask import Blueprint, jsonify
from datetime import datetime

health_bp = Blueprint('health', __name__)


@health_bp.route('/health')
def health():
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})


@health_bp.route('/')
def root():
    return jsonify({
        'service': 'ProTrader API v1.1',
        'endpoints': [
            'GET /health',
            'GET /api/market/taiex',
            'GET /api/market/institutional',
            'GET /api/market/status',
            'GET /api/stock/<code>/quote',
            'GET /api/stock/<code>/history?months=1',
            'GET /api/stock/<code>/intraday',
        ]
    })
