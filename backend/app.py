"""
app.py — ProTrader 後端主程式
Flask + CORS + Shioaji / TWSE 雙資料源
"""

import atexit
from flask import Flask
from flask_cors import CORS
from src.routes.health  import health_bp
from src.routes.market  import market_bp
from src.routes.stock   import stock_bp
from src.data_sources   import sinopac

app = Flask(__name__)

# 允許所有來源（前端 Vercel 網域）
# 生產環境建議改為指定網域：origins=["https://your-app.vercel.app"]
CORS(app, origins='*')

# 註冊路由
app.register_blueprint(health_bp)
app.register_blueprint(market_bp)
app.register_blueprint(stock_bp)

# 關閉時登出 Shioaji
atexit.register(sinopac.logout)


if __name__ == '__main__':
    import os
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
