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
  return window.BACKEND_URL || 'https://protrader-production.up.railway.app';
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
    return { source: 'mock', index: 44169, change: 312, change_pct: 0.71 };
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
  futuresOI() {
    return {
      source:           'mock',
      date:             null,
      dealer:           { long: null, short: null, net: null },
      investment_trust: { long: null, short: null, net: null },
      foreign:          { long: null, short: null, net: null },
    };
  },
  temperature() {
    return {
      source: 'mock', score: 55, label: '中性',
      description: '多空均衡，無明顯方向', color: 'green',
      indicators: [],
    };
  },
  focusRanking() {
    return {
      source: 'mock', date: null,
      stocks: [
        { rank:1, code:'2330', name:'台積電', score:80, change_pct:1.2,
          volume_ratio:1.5, foreign_buy:8000,
          score_detail:{ foreign_rank:32, volume:22, change:26 } },
        { rank:2, code:'2317', name:'鴻海',   score:65, change_pct:0.8,
          volume_ratio:1.2, foreign_buy:3200,
          score_detail:{ foreign_rank:24, volume:18, change:24 } },
      ],
    };
  },
  focusList() {
    return [
      { rank: 1, code: '2603', name: '長榮',   score: 91, chg: '+3.1%', reason: '成交量 68,420 張（市場高度關注），外資買超 9,230 張', data_date: '模擬資料' },
      { rank: 2, code: '2882', name: '國泰金', score: 84, chg: '+1.6%', reason: '成交量 52,110 張（市場高度關注），外資買超 4,580 張', data_date: '模擬資料' },
      { rank: 3, code: '2330', name: '台積電', score: 79, chg: '+2.4%', reason: '成交量 38,900 張，外資買超 12,456 張', data_date: '模擬資料' },
      { rank: 4, code: '2886', name: '兆豐金', score: 73, chg: '+0.8%', reason: '成交量 31,540 張，外資買超 2,100 張', data_date: '模擬資料' },
      { rank: 5, code: '2454', name: '聯發科', score: 67, chg: '+1.8%', reason: '成交量 18,760 張，外資買超 3,210 張', data_date: '模擬資料' },
    ];
  },
  newsList() {
    return [
      { title: 'TSMC 5nm 訂單量 Q3 創新高，AI 推動需求',  time: '09:42', src: '電子時報', tag: '新聞', url: '#' },
      { title: 'Fed 官員：通膨持穩，年內降息路徑清晰',     time: '09:28', src: 'Bloomberg',  tag: '新聞', url: '#' },
      { title: '外資連買 8 日，加碼半導體 ETF',            time: '09:15', src: '財訊',       tag: '新聞', url: '#' },
    ];
  },
  stockHistory(code) {
    const base = { '2330': 900, '2317': 100, '2454': 800, '2308': 270, '3711': 140 }[code] || 100;
    let price  = base;
    const candles = Array.from({ length: 60 }, (_, i) => {
      const open  = price;
      const close = Math.max(base * 0.7, open + (Math.random() - 0.45) * base * 0.02);
      const high  = Math.max(open, close) + Math.random() * base * 0.01;
      const low   = Math.min(open, close) - Math.random() * base * 0.01;
      const d     = new Date(Date.now() - (59 - i) * 86400000);
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

  /** 外資台指期未平倉 */
  async getFuturesOI() {
    return await _fetch('/api/market/futures_oi', Mock.futuresOI);
  },

  /** 大盤溫度計（7項指標加權分） */
  async getTemperature() {
    return await _fetch('/api/market/temperature', Mock.temperature);
  },

  /** 今日焦點 AI 排序（4因子規則式，可傳自訂股票池） */
  async getFocusList(codes = null) {
    const qs = codes ? `?codes=${codes.join(',')}` : '';
    return await _fetch(`/api/market/focus${qs}`, Mock.focusRanking);
  },

  /** AI 規則引擎焦點選股（後端算分，失敗降級 mock） */
  async getFocusList() {
    return await _fetch('/api/market/focus', Mock.focusList);
  },

  /** Google News RSS 台股即時新聞（失敗降級 mock） */
  async getNews() {
    return await _fetch('/api/market/news', Mock.newsList);
  },

  /** 取得後端 URL（偵錯用） */
  getBackendUrl() { return BACKEND_URL; },
};

/* 頁面載入時插入資料源標示到 navbar
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav-right');
  if (nav) {
    const badge = document.createElement('span');
    badge.id    = 'data-source-badge';
    badge.style.cssText = 'font-size:11px;font-weight:600;color:var(--text3);';
    badge.textContent   = '\ud83d\udd27 \u6a21\u64ec';
    nav.insertBefore(badge, nav.firstChild);
  }

  API.getStatus().then(s => {
    setDataSourceBadge(s?.primary_source || 'mock');
  }).catch(() => {});
});
