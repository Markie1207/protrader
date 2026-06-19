/**
 * m7-prediction.js — 股價預測頁
 * 顯示前 5 天實際股價 + AI 預測後 5 天走勢
 */

'use strict';

let _predChart = null;
let _predStocks = [];
let _lastPredData = null;  // 最後載入的預測資料（虛擬帳戶跟單使用）

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

    _lastPredData = data;
    _renderSignalCards(data);
    _renderPredChart(data);
    _renderPredTable(data);
    vaRender();
    vaUpdateFollowBtn();
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

/* ══════════════════════════════════════════════════════
   虛擬帳戶（VA）
   Storage key: protrader_va
   { positions: [...], history: [...] }
══════════════════════════════════════════════════════ */

const VA_KEY = 'protrader_va';

function vaLoad() {
  try {
    return JSON.parse(localStorage.getItem(VA_KEY)) || { positions: [], history: [] };
  } catch (e) {
    return { positions: [], history: [] };
  }
}

function vaSave(va) {
  try { localStorage.setItem(VA_KEY, JSON.stringify(va)); } catch (e) {}
}

function vaToday() {
  return new Date().toISOString().slice(0, 10);
}

/* 跟單：依目前 AI 訊號買入或賣出 */
function vaFollowSignal() {
  if (!_lastPredData) return;
  const sig    = _lastPredData.signal || {};
  const dir    = sig.direction ?? 0;
  const ticker = _lastPredData.ticker;
  const name   = _lastPredData.name || ticker;
  const actual = _lastPredData.actual || [];
  const price  = actual.length ? actual[actual.length - 1].close : null;

  if (!price) { _vaMsg('無法取得現價，請稍後再試'); return; }

  const va  = vaLoad();
  const has = va.positions.some(p => p.ticker === ticker);

  if (dir === 1 && !has) {
    va.positions.push({ ticker, name, entry_price: price, entry_date: vaToday(), confidence: sig.confidence ?? 0 });
    va.history.push({ ticker, name, action: 'buy', price, date: vaToday(), pnl_pct: null });
    vaSave(va);
    _vaMsg(`已買入 ${ticker} ${name} @ $${price}`);
  } else if (dir === -1 && has) {
    _vaDoClose(ticker, price);
    return;
  } else if (dir === 1 && has) {
    _vaMsg(`${ticker} 已在持倉中`);
  } else if (dir === -1 && !has) {
    _vaMsg(`${ticker} 無持倉可賣出`);
  } else {
    _vaMsg('目前訊號為觀望，不執行');
  }

  vaRender();
  vaUpdateFollowBtn();
}

/* 平倉（持倉表格的平倉按鈕） */
async function vaClosePosition(ticker) {
  let price = null;

  if (_lastPredData?.ticker === ticker) {
    const actual = _lastPredData.actual || [];
    price = actual.length ? actual[actual.length - 1].close : null;
  }

  if (!price) {
    const hist = await API.getStockHistory(ticker, 1);
    const candles = hist?.candles || [];
    price = candles.length ? candles[candles.length - 1].close : null;
  }

  if (!price) { _vaMsg('無法取得現價，請稍後再試'); return; }
  _vaDoClose(ticker, price);
  vaRender();
  vaUpdateFollowBtn();
}

function _vaDoClose(ticker, price) {
  const va  = vaLoad();
  const idx = va.positions.findIndex(p => p.ticker === ticker);
  if (idx === -1) return;

  const pos     = va.positions[idx];
  const pnl_pct = ((price - pos.entry_price) / pos.entry_price * 100);
  va.positions.splice(idx, 1);
  va.history.push({
    ticker, name: pos.name, action: 'sell',
    price, date: vaToday(), pnl_pct: +pnl_pct.toFixed(2),
  });
  vaSave(va);
  _vaMsg(`已平倉 ${ticker} @ $${price}，損益 ${pnl_pct >= 0 ? '+' : ''}${pnl_pct.toFixed(2)}%`);
}

/* 重置帳戶 */
function vaReset() {
  if (!confirm('確定清除所有虛擬帳戶紀錄？')) return;
  vaSave({ positions: [], history: [] });
  vaRender();
  vaUpdateFollowBtn();
  _vaMsg('虛擬帳戶已重置');
}

/* 渲染虛擬帳戶 UI */
function vaRender() {
  const va = vaLoad();

  // 摘要
  const totalPnl = va.history.filter(h => h.pnl_pct !== null).reduce((s, h) => s + h.pnl_pct, 0);
  const pnlColor = totalPnl > 0 ? '#ef4444' : totalPnl < 0 ? '#22c55e' : 'var(--text2)';
  _setEl('va-pos-count',  va.positions.length);
  _setEl('va-hist-count', va.history.length);
  _setEl('va-total-pnl',  va.history.length ? `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%` : '—');
  const pnlEl = document.getElementById('va-total-pnl');
  if (pnlEl && va.history.length) pnlEl.style.color = pnlColor;

  // 持倉
  const posTbody = document.getElementById('va-positions-body');
  if (posTbody) {
    posTbody.innerHTML = va.positions.length
      ? va.positions.map(p => `
          <tr>
            <td style="padding:5px 6px;">${p.ticker}<span style="color:var(--text3);font-size:10px;margin-left:4px;">${p.name}</span></td>
            <td style="padding:5px 6px;text-align:right;">$${p.entry_price.toFixed(1)}</td>
            <td style="padding:5px 6px;text-align:right;color:var(--text3);font-size:11px;">${p.entry_date}</td>
            <td style="padding:5px 6px;text-align:center;">
              <button onclick="vaClosePosition('${p.ticker}')"
                style="background:var(--bg3);color:var(--text2);border:1px solid var(--border);
                       border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">
                平倉
              </button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:10px;">尚無持倉</td></tr>';
  }

  // 歷史（最新在上）
  const histTbody = document.getElementById('va-history-body');
  if (histTbody) {
    const sorted = [...va.history].reverse();
    histTbody.innerHTML = sorted.length
      ? sorted.map(h => {
          const isBuy = h.action === 'buy';
          const pnlStr = h.pnl_pct !== null
            ? `<span style="color:${h.pnl_pct >= 0 ? '#ef4444' : '#22c55e'}">${h.pnl_pct >= 0 ? '+' : ''}${h.pnl_pct}%</span>`
            : '—';
          return `<tr>
            <td style="padding:4px 6px;">${h.ticker}<span style="color:var(--text3);font-size:10px;margin-left:4px;">${h.name}</span></td>
            <td style="padding:4px 6px;text-align:center;color:${isBuy ? '#ef4444' : '#22c55e'};font-weight:700;">${isBuy ? '買入' : '賣出'}</td>
            <td style="padding:4px 6px;text-align:right;">$${h.price.toFixed(1)}</td>
            <td style="padding:4px 6px;text-align:right;">${pnlStr}</td>
            <td style="padding:4px 6px;text-align:right;color:var(--text3);font-size:11px;">${h.date}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" style="color:var(--text3);text-align:center;padding:10px;">尚無紀錄</td></tr>';
  }
}

/* 更新跟單按鈕狀態 */
function vaUpdateFollowBtn() {
  const btn = document.getElementById('va-follow-btn');
  const msg = document.getElementById('va-status-msg');
  if (!btn) return;

  if (!_lastPredData) {
    btn.textContent = '跟單';
    btn.disabled = true;
    btn.style.opacity = '0.4';
    return;
  }

  const va     = vaLoad();
  const dir    = _lastPredData.signal?.direction ?? 0;
  const ticker = _lastPredData.ticker;
  const has    = va.positions.some(p => p.ticker === ticker);

  btn.disabled = false;
  btn.style.opacity = '1';

  if (dir === 1 && !has) {
    btn.textContent = '跟單買入';
    btn.style.background = '#ef4444';
    if (msg) msg.textContent = `AI 看多 ${ticker}，點擊跟單買入`;
  } else if (dir === -1 && has) {
    btn.textContent = '跟單賣出';
    btn.style.background = '#22c55e';
    if (msg) msg.textContent = `AI 看空 ${ticker}，點擊跟單賣出`;
  } else if (dir === 1 && has) {
    btn.textContent = '已持有';
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.style.background = 'var(--bg3)';
    if (msg) msg.style.color = 'var(--text3)', msg.textContent = `${ticker} 已在持倉中`;
  } else if (dir === -1 && !has) {
    btn.textContent = '無倉可賣';
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.style.background = 'var(--bg3)';
    if (msg) msg.textContent = `${ticker} 無持倉`;
  } else {
    btn.textContent = '觀望';
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.style.background = 'var(--bg3)';
    if (msg) msg.textContent = `AI 對 ${ticker} 目前觀望`;
  }
}

function _setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _vaMsg(text) {
  const el = document.getElementById('va-status-msg');
  if (el) { el.textContent = text; el.style.color = 'var(--blue)'; }
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
