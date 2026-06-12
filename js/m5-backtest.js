/**
 * m5-backtest.js — 回測實驗室
 * BUG-005 修正：Chart 實例銷毀管理（destroy before re-create）
 * BUG-006 修正：圖表在 tab 顯示後才初始化（由 main.js switchInnerBtReport 觸發）
 * BUG-022 修正：月份標籤改用中文（1月…12月）
 * BUG-023 修正：優化器表格有完整內容
 */

'use strict';

/* ── Chart 實例管理 ── */
let equityChartInstance  = null;
let paperChartInstance   = null;

/* ── 回測結果模擬資料 ── */
const backtestResult = {
  totalReturn: 48.7,
  annualReturn: 22.3,
  maxDrawdown: -12.4,
  sharpe: 1.84,
  winRate: 63.2,
  totalTrades: 87,
  avgWin: 8.4,
  avgLoss: -4.1,
  profitFactor: 2.08,
  calmar: 1.80,
};

/* BUG-022 修正：中文月份標籤 */
const CN_MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

/* ─────────────────────────────────────────
   策略 JSON 預覽
───────────────────────────────────────── */
function updateStrategyJSON() {
  const el = document.getElementById('strategy-json');
  if (!el) return;
  const entry = document.getElementById('bt-entry')?.value || '';
  const logic = document.getElementById('bt-logic')?.value || '';
  const sl    = document.getElementById('bt-sl')?.value    || '';
  const tp    = document.getElementById('bt-tp')?.value    || '';
  const start = document.getElementById('bt-start')?.value || '';
  const end   = document.getElementById('bt-end')?.value   || '';

  el.textContent = JSON.stringify({
    version: '1.1',
    entry:   { signal: entry, logic },
    exit:    { stopLoss: sl, takeProfit: tp },
    period:  { start, end },
    universe: 'TAIEX_TOP200',
    position: { maxPositions: 5, sizePerTrade: '20%' }
  }, null, 2);
}

function runBacktest() {
  // 模擬延遲後切換到報告
  const reportTab = document.querySelector('.inner-tab:nth-child(2)');
  if (reportTab) {
    setTimeout(() => {
      switchInnerBtReport(reportTab);
    }, 400);
  }
}

/* ─────────────────────────────────────────
   BUG-005 修正：銷毀舊圖表再重建
   BUG-006 修正：只在 tab 顯示時呼叫（由 switchInnerBtReport 觸發）
───────────────────────────────────────── */
function renderBacktestReport() {
  renderBtMetrics();
  renderEquityChart();
  renderHeatmap();
  renderOptimizerTable();
}

function renderBtMetrics() {
  const el = document.getElementById('bt-metrics');
  if (!el) return;
  const metrics = [
    { label: '總報酬',    value: `+${backtestResult.totalReturn}%`,   color: 'var(--green)' },
    { label: '年化報酬',  value: `+${backtestResult.annualReturn}%`,  color: 'var(--green)' },
    { label: '最大回撤',  value: `${backtestResult.maxDrawdown}%`,    color: 'var(--red)' },
    { label: 'Sharpe',   value: backtestResult.sharpe,                color: 'var(--blue)' },
    { label: '勝率',      value: `${backtestResult.winRate}%`,         color: 'var(--green)' },
    { label: '總筆數',    value: backtestResult.totalTrades,           color: 'var(--text)' },
    { label: '均獲利',    value: `+${backtestResult.avgWin}%`,         color: 'var(--green)' },
    { label: '均虧損',    value: `${backtestResult.avgLoss}%`,         color: 'var(--red)' },
  ];
  el.innerHTML = metrics.map(m => `
    <div class="metric-item">
      <div class="metric-label">${m.label}</div>
      <div class="metric-value" style="color:${m.color}">${m.value}</div>
    </div>`).join('');
}

function renderEquityChart() {
  const ctx = document.getElementById('equityChart');
  if (!ctx) return;

  // BUG-005 修正：銷毀後重建
  if (equityChartInstance) {
    equityChartInstance.destroy();
    equityChartInstance = null;
  }

  const labels = [];
  const data   = [];
  // BUG-022 修正：中文月份（2023 ~ 2026）
  for (let y = 2023; y <= 2026; y++) {
    for (let m = 0; m < 12; m++) {
      if (y === 2026 && m >= 6) break;
      labels.push(`${y}/${CN_MONTHS[m]}`);
      data.push(Math.round(100000 + Math.random() * 5000 + labels.length * 1200));
    }
  }

  equityChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '淨值',
        data,
        borderColor: '#3fb950',
        backgroundColor: '#3fb95022',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#484f58', maxTicksLimit: 10, maxRotation: 0 }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
      }
    }
  });
}

function renderHeatmap() {
  const el = document.getElementById('heatmap-wrap');
  if (!el) return;
  const years  = [2023, 2024, 2025];
  const colFn  = v => {
    if (v >= 5)  return 'hm-pos-hi';
    if (v >= 2)  return 'hm-pos-mid';
    if (v >= 0)  return 'hm-pos-lo';
    if (v >= -2) return 'hm-neg-lo';
    if (v >= -5) return 'hm-neg-mid';
    return 'hm-neg-hi';
  };
  // BUG-022 修正：表頭用中文月份
  let html = `<table class="heatmap-table">
    <thead><tr><th>年份</th>${CN_MONTHS.map(m => `<th>${m}</th>`).join('')}<th>全年</th></tr></thead>
    <tbody>`;
  years.forEach(y => {
    const vals = Array.from({length:12}, () => +(Math.random() * 14 - 5).toFixed(1));
    const total = vals.reduce((a, b) => a + b, 0).toFixed(1);
    html += `<tr><td style="font-weight:600">${y}</td>`;
    vals.forEach(v => {
      html += `<td class="${colFn(v)}">${v > 0 ? '+' : ''}${v}%</td>`;
    });
    html += `<td style="font-weight:600;color:${+total >= 0 ? 'var(--green)' : 'var(--red)'}">${+total >= 0 ? '+' : ''}${total}%</td></tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

/* BUG-023 修正：優化器表格有實際內容 */
function renderOptimizerTable() {
  const el = document.getElementById('optimizer-table');
  if (!el) return;
  const fast = [5, 5, 5, 10, 10, 10];
  const slow = [20, 30, 60, 20, 30, 60];
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="color:var(--text3);">
      <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">快線(MA)</th>
      <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">慢線(MA)</th>
      <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">總報酬</th>
      <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">勝率</th>
      <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">Sharpe</th>
      <th style="padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)">最大回撤</th>
    </tr></thead>
    <tbody>`;
  for (let i = 0; i < 6; i++) {
    const ret   = +(Math.random() * 60 + 10).toFixed(1);
    const wr    = +(Math.random() * 30 + 45).toFixed(1);
    const sh    = +(Math.random() * 1.5 + 0.8).toFixed(2);
    const dd    = -(Math.random() * 15 + 5).toFixed(1);
    const best  = i === 0;
    html += `<tr style="${best ? 'background:rgba(63,185,80,.08)' : ''}">
      <td style="padding:8px 10px;border-bottom:1px solid var(--bg3)">${fast[i]}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--bg3)">${slow[i]}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--bg3);color:var(--green)">+${ret}%${best ? ' ⭐' : ''}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--bg3)">${wr}%</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--bg3)">${sh}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--bg3);color:var(--red)">${dd}%</td>
    </tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

/* ─────────────────────────────────────────
   虛擬建倉績效圖（M6 paper 呼叫）
───────────────────────────────────────── */
function renderPaperChart() {
  const ctx = document.getElementById('paperChart');
  if (!ctx) return;
  if (paperChartInstance) {
    paperChartInstance.destroy();
    paperChartInstance = null;
  }
  const labels = Array.from({length:20}, (_, i) => `第${i+1}筆`);
  let val = 1000000;
  const data = labels.map(() => {
    val += (Math.random() - 0.4) * 30000;
    return Math.round(val);
  });
  paperChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ data, borderColor: '#58a6ff', backgroundColor: '#58a6ff22', borderWidth: 2, pointRadius: 0, fill: true }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#484f58', maxTicksLimit: 6 }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
      }
    }
  });
}

function initBacktest() {
  updateStrategyJSON();
  renderOptimizerTable();
}
