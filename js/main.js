/**
 * main.js — 全域導航 / 時鐘 / 市場狀態
 * 修正：BUG-003 / BUG-018 / BUG-024
 */

'use strict';

/* ─────────────────────────────────────────
   BUG-003 修正：移除全域 event 物件依賴，
   改由 HTML 端傳入 el (this)
───────────────────────────────────────── */
function switchPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  el.classList.add('active');
}

/* ─────────────────────────────────────────
   BUG-018 修正：切換 inner panel 時，
   若離開 replay tab 則清除回放 interval
───────────────────────────────────────── */
function switchInner(prefix, panel, el) {
  // 離開 replay 前先清除 interval
  if (prefix === 'pf') {
    const replayPanel = document.getElementById('pf-replay');
    if (replayPanel && replayPanel.classList.contains('active')) {
      if (typeof replayState !== 'undefined' && replayState.interval) {
        clearInterval(replayState.interval);
        replayState.interval = null;
      }
    }
  }

  document.querySelectorAll(`[id^="${prefix}-"]`).forEach(p => p.classList.remove('active'));
  document.getElementById(`${prefix}-${panel}`).classList.add('active');

  const tabs = el.closest('.inner-tabs');
  if (tabs) tabs.querySelectorAll('.inner-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

/* BUG-006 修正：切換到回測報告時才渲染圖表 */
function switchInnerBtReport(el) {
  switchInner('bt', 'report', el);
  if (typeof renderBacktestReport === 'function') {
    renderBacktestReport();
  }
}

/* ─────────────────────────────────────────
   即時時鐘
───────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const el = document.getElementById('clock');
  if (el) el.textContent = `${hh}:${mm}:${ss}`;
}

/* ─────────────────────────────────────────
   BUG-024 修正：市場狀態動態判斷
   開市：週一~五 09:00~13:30
   盤前：週一~五 08:30~09:00
   盤後：週一~五 13:30~15:00
   其餘：休市
───────────────────────────────────────── */
function updateMarketStatus() {
  const now   = new Date();
  const h     = now.getHours();
  const m     = now.getMinutes();
  const day   = now.getDay(); // 0=日 6=六
  const mins  = h * 60 + m;
  const dot   = document.getElementById('market-dot');
  const label = document.getElementById('market-label');
  if (!dot || !label) return;

  const isWeekday = day >= 1 && day <= 5;
  const PRE_START  = 8 * 60 + 30;  // 08:30
  const MKT_START  = 9 * 60;       // 09:00
  const MKT_END    = 13 * 60 + 30; // 13:30
  const AFTER_END  = 15 * 60;      // 15:00

  dot.className = 'status-dot';

  if (isWeekday && mins >= MKT_START && mins < MKT_END) {
    dot.classList.add('open');
    label.textContent = '開市中';
    label.style.color = 'var(--up)';
  } else if (isWeekday && mins >= PRE_START && mins < MKT_START) {
    dot.classList.add('pre');
    label.textContent = '盤前';
    label.style.color = 'var(--orange)';
  } else if (isWeekday && mins >= MKT_END && mins < AFTER_END) {
    dot.classList.add('after');
    label.textContent = '盤後';
    label.style.color = 'var(--purple)';
  } else {
    label.textContent = '休市';
    label.style.color = 'var(--text3)';
  }
}

/* ─────────────────────────────────────────
   初始化
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  updateMarketStatus();
  setInterval(updateClock, 1000);
  setInterval(updateMarketStatus, 60000);

  // 初始化各模組
  if (typeof initDashboard  === 'function') initDashboard();
  if (typeof initGlobal     === 'function') initGlobal();
  if (typeof initSupply     === 'function') initSupply();
  if (typeof initStrategy   === 'function') initStrategy();
  if (typeof initBacktest   === 'function') initBacktest();
  if (typeof initPortfolio  === 'function') initPortfolio();
  if (typeof initPrediction === 'function') initPrediction();
});
