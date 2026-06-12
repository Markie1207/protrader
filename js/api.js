/**
 * api.js — 統一 API 層
 * 所有後端請求集中於此，支援自動降級與資料源標示
 *
 * 優先順序：後端 API（Railway）→ TWSE 直連（備用）→ 本地 Mock
 * 前端只需呼叫 API.xxx()，不需要知道資料從哪來
 */

'use strict';

/* ─────────────────────────────────────────
   後端基底 URL
   本地開發：http://localhost:5000
   部署後：你的 Railway URL（由 DEPLOY_CONFIG.js 注入，
           或直接改這裡）
───────────────────────────────────────── */
const BACKEND_URL = (function () {
  // 若頁面是從 localhost 開啟 → 用本地後端
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'http://localhost:5000';
  }
  // 部署後的 Railway URL（請在 deploy 後填入）
  return window.BACKEND_URL || 'https://YOUR_RAILWAY_URL.railway.app';
})();

/* 資料源狀態（顯示於 navbar） */
let _dataSource = 'mock';

function setDataSourceBadge(source) {
  _dataSource = source;
  const el = document.getElementById('data-source-badge');
  if (!el) return;
  const map = {
    Shioaji: { text: '⚡ 即時', color: 'var(--green)' },
    TWSE:    { text: '📡 TWSE', color: 'var(--blue)' },
    mock:    { text: '🔧 模擬', color: 'var(--text3)' },
  };
  const s = map[source] || map['mock'];
  el.textContent  = s.text;
  el.style.color  = s.color;
}

/* ─────────────────────────────────────────
   核心 fetch 包裝
   - 超時 8 秒
   - 失敗自動降級
───────────────────────────────────────── */
async function _fetch(path, fallbackFn) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(BACKEND_URL + path, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[API] 後端不可用 (${path})，降級到 fallback:`, err.message);
    if (typeof fallbackFn === 'function') return fallbackFn();
    return null;
  }
}

/* ─────────────────────────────────────────
   Mock 資料（後端不可用時使用）
───────────────────────────────────────── */
const Mock = {
  taiex() {
    return { source: 'mock', index: 22847, change: 312, change_pct: 1.38 };
  },
  institutional() {
    return {
      source: 'mock',
      foreign:    { net:  18600000000, buy: 0, sell: 0 },
      investment: { net:   4200000000, buy: 0, sell: 0 },
      dealer:     { net:  -800000000,  buy: 0, sell: 0 },
    };
  },
  stockQuote(code) {
    const prices = { '2330': 1050, '2317': 108, '2454': 890, '2308': 310, '3711': 155 };
    return { source: 'mock', code, price: prices[code] || 100, open: 0, high: 0, low: 0 };
  },
  stockHistory(code) {
    const base = { '2330': 900, '2317': 100, '2454': 800, '2308': 270, '3711': 140 }[code] || 100;
    let price  = base;
    const candles = Array.from({ length: 60 }, (_, i) => {
      const open  = price;
      const close = Math.max(base * 0.7, open + (Math.random() - 0.45) * base * 0.02);
      const high  = Math.max(open, close) + Math.random() * base * 0.01;
      const low   = Math.min(open, close) - Math.random() * base * 0.01;
      const d     = new Date(2026, 2, i + 1);
      price = close;
      return {
        date: d.toISOString().slice(0, 10),
        open: +open.toFixed(1), high: +high.toFixed(1),
        low:  +low.toFixed(1),  close: +close.toFixed(1), volume: 10000,
      };
    });
    return { source: 'mock', code, candles };
  },
};

/* ─────────────────────────────────────────
   公開 API 物件
───────────────────────────────────────── */
const API = {

  /** 加權指數即時資料 */
  async getTaiex() {
    const data = await _fetch('/api/market/taiex', Mock.taiex);
    setDataSourceBadge(data?.source || 'mock');
    return data;
  },

  /** 三大法人 */
  async getInstitutional() {
    return await _fetch('/api/market/institutional', Mock.institutional);
  },

  /** 資料源狀態 */
  async getStatus() {
    return await _fetch('/api/market/status', () => ({
      shioaji_available: false, market_open: false, primary_source: 'mock'
    }));
  },

  /** 個股即時報價 */
  async getStockQuote(code) {
    return await _fetch(`/api/stock/${code}/quote`, () => Mock.stockQuote(code));
  },

  /** 個股日線（回傳 candles 陣列） */
  async getStockHistory(code, months = 1) {
    return await _fetch(`/api/stock/${code}/history?months=${months}`, () => Mock.stockHistory(code));
  },

  /** 今日分時（Shioaji only，回放用） */
  async getIntraday(code) {
    return await _fetch(`/api/stock/${code}/intraday`, () => ({ source: 'unavailable', ticks: [] }));
  },

  /** 取得後端 URL（偵錯用） */
  getBackendUrl() { return BACKEND_URL; },
};

/* ─────────────────────────────────────────
   頁面載入時插入資料源標示到 navbar
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav-right');
  if (nav) {
    const badge = document.createElement('span');
    badge.id    = 'data-source-badge';
    badge.style.cssText = 'font-size:11px;font-weight:600;color:var(--text3);';
    badge.textContent   = '🔧 模擬';
    nav.insertBefore(badge, nav.firstChild);
  }

  // 啟動時查詢一次後端狀態
  API.getStatus().then(s => {
    setDataSourceBadge(s?.primary_source || 'mock');
  });
});
