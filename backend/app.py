"""
app.py — ProTrader 後端主程式
Flask + CORS + Shioaji / TWSE 雙資料源 + APScheduler Grok 每日更新
"""

import atexit
import os

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask
from flask_cors import CORS

from src.routes.health      import health_bp
from src.routes.market      import market_bp
from src.routes.stock       import stock_bp
from src.routes.prediction  import prediction_bp
from src.routes.industry    import industry_bp
from src.data_sources       import sinopac
from src.data_sources       import grok_updater

app = Flask(__name__)

# 允許所有來源（前端 Vercel 網域）
CORS(app, origins='*')

# 註冊路由
app.register_blueprint(health_bp)
app.register_blueprint(market_bp)
app.register_blueprint(stock_bp)
app.register_blueprint(prediction_bp)
app.register_blueprint(industry_bp)

# 啟動時載入產業鏈資料
grok_updater.load_data()

# APScheduler：每天 UTC 00:00（台灣 08:00）呼叫 Grok 更新
# 只在主進程啟動，避免 gunicorn 多 worker 重複執行
_is_main_worker = os.getenv('GUNICORN_WORKER_ID', '0') == '0' or \
                  os.getenv('SERVER_SOFTWARE', '').startswith('gunicorn') is False

scheduler = BackgroundScheduler(timezone='UTC')
scheduler.add_job(
    grok_updater.run_update,
    trigger='cron',
    hour=0,
    minute=0,
    id='daily_grok_update',
    max_instances=1,
    coalesce=True,
)
scheduler.start()

# 關閉時清理
atexit.register(sinopac.logout)
atexit.register(scheduler.shutdown)


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
