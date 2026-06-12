# ProTrader 部署指南

## 整體架構

```
前端 (Vercel)  ←→  後端 (Railway)  ←→  永豐金 Shioaji / TWSE
```

---

## Step 1：開設 GitHub 帳號

1. 前往 https://github.com → 點 **Sign up**
2. 填入 Email、密碼、用戶名
3. 完成 Email 驗證

---

## Step 2：安裝 Git 並上傳程式碼

```bash
# 確認 Git 已安裝（Windows 已安裝 Git Bash）
git --version

# 前端 repo
cd D:\Claude\trading_system_V4
git init
git add .
git commit -m "初始化前端"
# 到 GitHub 建立 repo: protrader-frontend
git remote add origin https://github.com/你的帳號/protrader-frontend.git
git push -u origin main

# 後端 repo
cd D:\Claude\trading_system_V4_backend
git init
git add .
git commit -m "初始化後端"
# 到 GitHub 建立 repo: protrader-backend
git remote add origin https://github.com/你的帳號/protrader-backend.git
git push -u origin main
```

---

## Step 3：部署後端到 Railway

1. 前往 https://railway.app → 用 GitHub 帳號登入
2. 點 **New Project** → **Deploy from GitHub repo**
3. 選擇 `protrader-backend`
4. Railway 會自動偵測 `Procfile` 並部署

### 設定環境變數（重要！）

Railway 儀表板 → 你的專案 → **Variables** → 新增：

| 變數名稱 | 值 |
|---------|-----|
| `SINOPAC_API_KEY` | 你的永豐金 API Key |
| `SINOPAC_SECRET_KEY` | 你的永豐金 Secret Key |
| `FLASK_ENV` | `production` |

5. 部署完成後，複製你的 Railway URL：
   例如 `https://protrader-backend-production.up.railway.app`

---

## Step 4：前端填入後端 URL

編輯 `D:\Claude\trading_system_V4\js\api.js`，找到這行：

```javascript
return window.BACKEND_URL || 'https://YOUR_RAILWAY_URL.railway.app';
```

改為你的 Railway URL：

```javascript
return window.BACKEND_URL || 'https://protrader-backend-production.up.railway.app';
```

重新 push 前端：

```bash
cd D:\Claude\trading_system_V4
git add js/api.js
git commit -m "設定後端 URL"
git push
```

---

## Step 5：部署前端到 Vercel

1. 前往 https://vercel.com → 用 GitHub 帳號登入
2. 點 **New Project** → Import `protrader-frontend`
3. 框架選 **Other**，不需要 build command
4. 點 **Deploy**

部署完成後，Vercel 會給你一個網址，例如：
`https://protrader-frontend.vercel.app`

把這個網址分享給其他人即可。

---

## 資料源狀態說明

| 狀態標示 | 說明 |
|---------|------|
| ⚡ 即時 | Shioaji 連線中，盤中即時資料 |
| 📡 TWSE | 後端在線，使用 TWSE 官方 API（延遲 ~1 分鐘）|
| 🔧 模擬 | 後端離線，使用前端模擬資料 |

---

## 本地開發

```bash
cd D:\Claude\trading_system_V4_backend

# 建立虛擬環境
python -m venv .venv
.venv\Scripts\activate

# 安裝套件
pip install -r requirements.txt

# 複製 .env
copy .env.example .env
# 編輯 .env 填入 API Key

# 啟動後端
python app.py
# → 運行在 http://localhost:5000

# 另開視窗，啟動前端（任意靜態伺服器）
cd D:\Claude\trading_system_V4
npx serve .
# → 開啟 http://localhost:3000
```

---

## 常見問題

**Q：Railway 免費方案夠用嗎？**
A：免費方案每月 500 小時，台股只有盤中需要 API，其餘時間可暫停，非常夠用。

**Q：Shioaji 放在雲端安全嗎？**
A：API Key 放在 Railway 環境變數，不進 Git，與放在本機相同安全等級。

**Q：別人看到的是我的帳戶資料嗎？**
A：不會。後端只提供市場公開資料（指數、法人、報價），不涉及個人帳戶。
