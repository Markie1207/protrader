/**
 * m7-prediction.js — 股價預測頁
 * 顯示前 5 天實際股價 + AI 預測後 5 天走勢
 */

'use strict';

let _predChart = null;
let _predStocks = [];

/* ── 初始化 ── */
async function initPrediction() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/prediction/stocks`);
    _predStocks = await res.json();
    _buildStockSelector();
    // 預設載入第一檔
    if (_predStocks.length > 0) {
      document.getElementById('pred-ticker-select').value = _predStocks[0].ticker;
      await loadPrediction(_predStocks[0].ticker);
    }
  } catch (e) {
    _showPredError('無法載入股票清單：' + e.message);
  }
}

function _buildStockSelector() {
  const sel = document.getElementById('pred-ticker-select');
  if (!sel) return;
  sel.innerHTML = _predStocks.map(s =>
    `<option value="${s.ticker}">${s.ticker} ${s.name}</option>`
  ).join('');
}

/* ── 載入預測資料 ── */
async function loadPrediction(ticker) {
  if (!ticker) ticker = document.getElementById('pred-ticker-select').value;
  _setPredLoading(true);

  try {
    const res  = await fetch(`${BACKEND_URL}/api/prediction/${ticker}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    _renderSignalCards(data);
    _renderPredChart(data);
    _renderPredTable(data);
    document.getElementById('pred-update-time').textContent =
      '更新時間：' + new Date().toLocaleTimeString('zh-TW');
  } catch (e) {
    _showPredError('載入失敗：' + e.message);
  } finally {
    _setPredLoading(false);
  }
}

/* ── 信號卡片 ── */
function _renderSignalCards(data) {
  const sig = data.signal || {};
  const dir = sig.direction ?? 0;
  const dirLabel = data.direction_label || '觀望';
  const dirColor = dir === 1 ? 'var(--up)' : dir === -1 ? 'var(--dn)' : 'var(--text2)';
  const dirIcon  = dir === 1 ? '▲' : dir === -1 ? '▼' : '─';

  // 主信號
  document.getElementById('pred-signal-label').textContent  = dirIcon + ' ' + dirLabel;
  document.getElementById('pred-signal-label').style.color  = dirColor;
  document.getElementById('pred-conf').textContent =
    (sig.confidence !== undefined ? (sig.confidence * 100).toFixed(0) + '%' : '—');
  document.getElementById('pred-model-tag').textContent = sig.model || '—';
  document.getElementById('pred-signal-date').textContent   = '訊號日期：' + (sig.signal_date || '—');

  // LSTM / TCN / PPO
  _setProbBar('pred-lstm-bar', 'pred-lstm-val', sig.lstm_prob);
  _setProbBar('pred-tcn-bar',  'pred-tcn-val',  sig.tcn_prob);

  const ppoEl = document.getElementById('pred-ppo-val');
  if (ppoEl) {
    const ppoAct = sig.ppo_action;
    ppoEl.textContent = ppoAct === 1 ? '做多' : ppoAct === 0 ? '觀望' : '—';
    ppoEl.style.color = ppoAct === 1 ? 'var(--up)' : 'var(--text2)';
  }

  // 股票名稱
  const nameEl = document.getElementById('pred-stock-name');
  if (nameEl) nameEl.textContent = data.ticker + '　' + data.name;
}

function _setProbBar(barId, valId, prob) {
  const bar = document.getElementById(barId);
  const val = document.getElementById(valId);
  if (!bar || !val || prob === undefined) return;
  const pct = Math.round((prob || 0) * 100);
  bar.style.width = pct + '%';
  bar.style.background = pct >= 55 ? 'var(--up)' : pct <= 45 ? 'var(--dn)' : 'var(--text3)';
  val.textContent = pct + '%';
}

/* ── Chart.js 折線圖 ── */
function _renderPredChart(data) {
  const ctx = document.getElementById('predChart');
  if (!ctx) return;

  const actual    = data.actual    || [];
  const predicted = data.predicted || [];
  const dir       = data.signal?.direction ?? 0;

  // 合併時間軸
  const allDates  = [...actual.map(d => d.date), ...predicted.map(d => d.date)];
  const actualPts = actual.map(d => d.close);
  // 預測線從最後一個實際點接上去
  const predPts   = [
    ...Array(actual.length - 1).fill(null),
    actual.length > 0 ? actual[actual.length - 1].close : null,
    ...predicted.map(d => d.close),
  ];

  const predColor = dir === 1 ? '#f85149' : dir === -1 ? '#3fb950' : '#8b949e';

  if (_predChart) { _predChart.destroy(); _predChart = null; }

  _predChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allDates,
      datasets: [
        {
          label: '實際收盤價',
          data: actualPts,
          borderColor: '#58a6ff',
          backgroundColor: 'rgba(88,166,255,0.08)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#58a6ff',
          tension: 0.3,
          fill: false,
        },
        {
          label: 'AI 預測',
          data: predPts,
          borderColor: predColor,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: (ctx) => ctx.dataIndex < actual.length ? 0 : 4,
          pointBackgroundColor: predColor,
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#8b949e', font: { size: 12 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}：$${ctx.parsed.y?.toFixed(1) ?? '—'}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8b949e', font: { size: 11 } },
          grid:  { color: '#21262d' },
        },
        y: {
          ticks: {
            color: '#8b949e',
            font: { size: 11 },
            callback: (v) => '$' + v.toFixed(0),
          },
          grid: { color: '#21262d' },
        },
      },
    },
  });

  // 分隔線標記（今日/預測 分界）
  const dividerEl = document.getElementById('pred-chart-divider-label');
  if (dividerEl) {
    dividerEl.textContent = '← 實際　預測 →';
  }
}

/* ── 資料表格 ── */
function _renderPredTable(data) {
  const tbody = document.getElementById('pred-table-body');
  if (!tbody) return;

  const rows = [
    ...( data.actual    || [] ).map(d => ({ ...d, type: 'actual' })),
    ...( data.predicted || [] ).map(d => ({ ...d, type: 'pred'   })),
  ];

  const dir = data.signal?.direction ?? 0;
  tbody.innerHTML = rows.map(r => {
    const isPred  = r.type === 'pred';
    const color   = isPred
      ? (dir === 1 ? 'var(--up)' : dir === -1 ? 'var(--dn)' : 'var(--text2)')
      : 'var(--text)';
    const tag     = isPred ? '<span style="font-size:10px;color:var(--text3)">[預測]</span>' : '';
    return `<tr>
      <td>${r.date} ${tag}</td>
      <td style="text-align:right;color:${color};font-weight:${isPred ? '600' : '400'}">
        $${Number(r.close).toFixed(1)}
      </td>
      <td style="text-align:center;color:var(--text3);font-size:11px">
        ${isPred ? '預測' : '實際'}
      </td>
    </tr>`;
  }).join('');
}

/* ── 工具函式 ── */
function _setPredLoading(on) {
  const el = document.getElementById('pred-loading');
  if (el) el.style.display = on ? 'block' : 'none';
}

function _showPredError(msg) {
  const el = document.getElementById('pred-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  setTimeout(() => { if (el) el.style.display = 'none'; }, 5000);
}
