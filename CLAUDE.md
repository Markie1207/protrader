# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 架構概覽

**雙 Origin 部署**：
- **前端**：Vercel 靜態托管（`index.html`、`js/`、`css/`、`industry_map.json`）
- **後端**：Railway 執行 Flask（`backend/`，`cd backend && gunicorn app:app`）

Railway 使用**根目錄**的 `Procfile` 與 `requirements.txt`，不是 `backend/` 裡的。新增 Python 套件必須加進根目錄 `requirements.txt`。

## 本地開發

```bash
# 後端（在 backend/ 下執行）
cd backend
pip install -r ../requirements.txt   # 注意：requirements.txt 在根目錄
python app.py                         # http://localhost:5000

# 語法檢查（Python）
python -c "import ast; ast.parse(open('backend/app.py', encoding='utf-8').read())"

# 語法檢查（JS）
node --check js/m3-supply.js

# 前端：直接用瀏覽器開啟 index.html
# localhost 時 BACKEND_URL 自動指向 http://localhost:5000
```

## 前端架構

單頁應用，七個分頁（M1–M7），各有對應的 JS 模組：

| 分頁 | 檔案 | 說明 |
|------|------|------|
| M1 戰情中心 | `js/m1-dashboard.js` | 大盤指數、法人籌碼、溫度計 |
| M2 全球情報站 | `js/m2-global.js` | 全球市場 |
| M3 產業鏈地圖 | `js/m3-supply.js` | D3 心智圖（桌機）/ 摺疊卡片（手機）|
| M4 交易策略室 | `js/m4-strategy.js` | 策略篩選、K棒型態 |
| M5 回測實驗室 | `js/m5-backtest.js` | 策略回測 |
| M6 持倉管理 | `js/m6-portfolio.js` | 持倉、觀察清單 |
| M7 股價預測 | `js/m7-prediction.js` | AI 訊號讀取 |

**`js/main.js`**：全域導覽、`switchPage()`、時鐘。  
**`js/api.js`**：所有 HTTP 請求的唯一出口，三層降級：Railway → TWSE 直連 → Mock。前端模組**只能**呼叫 `API.xxx()`，禁止直接 fetch。

**初始值規則**：所有欄位初始顯示 `—`，API 回傳後才填值。`null` 回傳維持 `—`，絕不顯示 `0`。

## 後端架構

```
backend/
  app.py              # Flask 入口；APScheduler（每日描述更新、每週公司更新）
  src/
    config.py         # 環境變數（Shioaji keys、cache TTL）
    routes/           # Blueprint，每支路由只包裝 data_sources，不做解析
    data_sources/
      sinopac.py      # 永豐金 Shioaji 即時資料（盤中）
      twse.py         # TWSE/TAIFEX 官方爬蟲（盤後降級）
      grok_updater.py # Gemini API 自動更新 industry_map.json
```

**資料流**：`sinopac → twse → mock`，每層失敗自動降級。  
**快取**：TTLCache（記憶體），無 Redis。盤後快取 key 格式：`{type}_{YYYYMMDD}`。  
**CSV 編碼**：依序嘗試 `utf-8-sig → big5 → cp950`。

## M3 產業鏈地圖 — 重要細節

`industry_map.json` 有**兩份**，必須同步：
- `industry_map.json`（根目錄）→ Vercel 靜態服務（前端 fallback 用）
- `backend/industry_map.json` → Railway 啟動時讀入記憶體

修改後必須同步：
```bash
cp industry_map.json backend/industry_map.json
```

前端從 `BACKEND_URL + '/api/industry-map'` 取資料（不是靜態檔）。

**Gemini 自動更新**（`grok_updater.py`）：
- 每日 UTC 00:00：更新 `key_theme / key_risk / market_size / growth_rate`（直接生效）
- 每週日 UTC 02:00：更新公司清單 + 建議新鏈 → 存為 `industry_map_draft.json`（需人工審核）
- Railway ephemeral filesystem：草稿在重啟後消失，`approve_draft` 前需確認草稿仍存在
- 環境變數：`GEMINI_API_KEY`（必填）、`GEMINI_MODEL`（選填，預設 `gemini-3.1-flash-lite`）
- 測試連線：`GET /api/industry-map/test-grok`
- 手動觸發完整更新：`POST /api/industry-map/refresh-full`

## Railway 環境變數

| 變數 | 用途 |
|------|------|
| `SINOPAC_API_KEY` | 永豐金 API |
| `SINOPAC_API_SECRET` | 永豐金 Secret |
| `GEMINI_API_KEY` | Gemini 自動更新（必填才會更新） |
| `GEMINI_MODEL` | 模型名稱（預設 `gemini-3.1-flash-lite`） |

## 後端 API 端點

```
GET  /api/market/taiex              加權指數
GET  /api/market/institutional      三大法人今日買賣超
GET  /api/stock/<code>/quote        個股即時報價
GET  /api/stock/<code>/history      個股日線
GET  /api/industry-map              產業鏈完整資料
GET  /api/industry-map/draft        草稿狀態
POST /api/industry-map/draft/approve 套用草稿
POST /api/industry-map/draft/reject  捨棄草稿
POST /api/industry-map/refresh-full  觸發完整更新（背景）
GET  /api/industry-map/test-grok     測試 Gemini 連線
GET  /api/prediction/<ticker>        AI 訊號
```

## 子目錄規範

詳見各目錄的 CLAUDE.md（子規範優先）：
- `backend/src/routes/CLAUDE.md` — Response schema、錯誤格式、命名
- `backend/src/data_sources/CLAUDE.md` — 已知資料源 URL、CSV 編碼、mock 降級規則
- `js/CLAUDE.md` — 初始值規則、Chart.js 慣例（紅漲綠跌）、API 呼叫規範
