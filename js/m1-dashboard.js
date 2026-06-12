/**
 * m1-dashboard.js — 戰情中心
 * 修正：BUG-008 / BUG-012 / BUG-013 / BUG-020
 * 資料源：API.getTaiex() / API.getInstitutional() / API.getStockQuote()
 */

'use strict';

/* ── 持股基本資料（成本/止損/停利由使用者設定，現價從 API 取得）── */
const holdingsData = [
  { code: '2330', name: '台積電', cost: 820,  price: 1050, shares: 2,  sl: 780,  tp: 1200 },
  { code: '2317', name: '鴻海',   cost: 105,  price: 108,  shares: 5,  sl: 98,   tp: 130  },
  { code: '2454', name: '聯發科', cost: 1020, price: 890,  shares: 1,  sl: 850,  tp: 1300 },
  { code: '2308', name: '台達電', cost: 280,  price: 310,  shares: 3,  sl: 265,  tp: 380  },
];

/* ── 今日焦點資料 ── */
const focusData = [
  { rank: 1, code: '2330', name: '台積電', reason: 'AI 晶片訂單持續上修',      score: 94, chg: '+2.4%' },
  { rank: 2, code: '2454', name: '聯發科', reason: '旗艦 AP 新品發表倒數',     score: 87, chg: '+1.8%' },
  { rank: 3, code: '3711', name: '日月光', reason: '先進封裝 CoWoS 產能滿載',  score: 83, chg: '+1.2%' },
  { rank: 4, code: '2308', name: '台達電', reason: '資料中心電源管理需求爆發', score: 79, chg: '+0.9%' },
  { rank: 5, code: '2317', name: '鴻海',   reason: 'AI 伺服器組裝份額提升',   score: 74, chg: '+0.6%' },
];

/* ── 指數圖 Chart.js 實例 ── */
let indexChartInstance = null;

/* ─────────────────────────────────────────
   BUG-012 修正：各週期生成合理時間標籤
───────────────────────────────────────── */
function genTimeLabels(period) {
  const days = ['週一', '週二', '週三', '週四', '週五'];
  const months = Array.from({length: 22}, (_, i) => {
    const d = new Date(Date.now() - (21 - i) * 86400000);
    return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
  });

  switch (period) {
    case '1d':
      return ['09:00','09:15','09:30','09:45','10:00','10:15','10:30','10:45',
              '11:00','11:15','11:30','11:45','12:00','12:15','12:30','12:45',
              '13:00','13:15','13:30'];
    case '5d':
      return days.flatMap(d => ['09:00','10:00','11:00','12:00','13:00'].map(t => `${d} ${t}`));
    case '1m':
      return months;
    default:
      return [];
  }
}

/* ─────────────────────────────────────────
   指數走勢圖資料（模擬）
───────────────────────────────────────── */
function genIndexData(period) {
  const base = { '1d': 22500, '5d': 22000, '1m': 21000 };
  const b = base[period] || 22000;
  const len = genTimeLabels(period).length;
  return Array.from({length: len}, (_, i) => Math.round(b + (Math.random() - 0.45) * 150 + i * 12));
}

/* ─────────────────────────────────────────
   BUG-008 修正：setChartPeriod 只重置 .period-btn，
   不影響其他 .btn-ghost 按鈕
───────────────────────────────────────── */
function setChartPeriod(period, el) {
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.remove('active-period');
    b.style.background = '';
    b.style.color = '';
  });
  el.classList.add('active-period');
  renderIndexChart(period);
}

function renderIndexChart(period = '1d') {
  const ctx = document.getElementById('indexChart');
  if (!ctx) return;
  const labels = genTimeLabels(period);
  const data   = genIndexData(period);
  const color  = '#58a6ff';

  if (indexChartInstance) { indexChartInstance.destroy(); }
  indexChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: `${color}22`,
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
        x: { ticks: { color: '#484f58', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
      }
    }
  });
}

/* ─────────────────────────────────────────
   BUG-013 修正：警示數量動態計算（接近止損=近 5%）
   BUG-020 修正：損益動態計算，不寫死數字
   BUG-007（M6 同邏輯）：比對 sl 而非 cost
───────────────────────────────────────── */
function renderHoldings() {
  const tbody  = document.getElementById('holdings-body');
  const badge  = document.getElementById('alert-badge');
  const pnlEl  = document.getElementById('total-pnl');
  if (!tbody) return;

  let alertCount = 0;
  let pnlTotal   = 0;

  tbody.innerHTML = holdingsData.map(h => {
    const pnl     = (h.price - h.cost) * h.shares * 1000;
    const pnlPct  = ((h.price - h.cost) / h.cost * 100).toFixed(2);
    const isUp    = h.price >= h.cost;
    // BUG-007 修正：接近止損 → 與 sl 比較，而非 cost
    const nearSL  = h.price <= h.sl * 1.05;
    if (nearSL) alertCount++;
    pnlTotal += pnl;

    const statusBadge = nearSL
      ? `<span class="badge badge-red">⚠️ 接近止損</span>`
      : isUp
        ? `<span class="badge badge-green">正常</span>`
        : `<span class="badge badge-yellow">觀察中</span>`;

    return `<tr>
      <td><strong>${h.code}</strong> <span style="color:var(--text2)">${h.name}</span></td>
      <td>$${h.cost.toLocaleString()}</td>
      <td>$${h.price.toLocaleString()}</td>
      <td class="${isUp ? 'up' : 'dn'}">${isUp ? '+' : ''}${pnlPct}%</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  if (badge) badge.textContent = `${alertCount} 警示`;

  if (pnlEl) {
    const sign = pnlTotal >= 0 ? '+' : '-';
    pnlEl.textContent = `${sign}$${Math.abs(pnlTotal).toLocaleString()}`;
    pnlEl.style.color = pnlTotal >= 0 ? 'var(--green)' : 'var(--red)';
  }
}

/* ─────────────────────────────────────────
   大盤溫度計（Canvas 半圓儀表）
───────────────────────────────────────── */
function renderGauge(score = 73) {
  const canvas = document.getElementById('gaugeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth || 300;
  canvas.width  = w;
  canvas.height = 160;
  const cx = w / 2, cy = 130;
  const r  = Math.min(cx - 20, 100);

  // 背景弧
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0, false);
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#21262d';
  ctx.stroke();

  // 值弧（0~100 → π~0）
  const angle = Math.PI - (score / 100) * Math.PI;
  const grad  = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0,   '#3fb950');
  grad.addColorStop(0.5, '#e3b341');
  grad.addColorStop(1,   '#f85149');
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, angle, false);
  ctx.lineWidth = 18;
  ctx.strokeStyle = grad;
  ctx.stroke();

  // 指針
  const nx = cx + r * 0.75 * Math.cos(angle);
  const ny = cy + r * 0.75 * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e6edf3';
  ctx.stroke();

  // 分數文字
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(score, cx, cy - 4);
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px sans-serif';
  ctx.fillText('大盤溫度', cx, cy + 14);
}

/* ─────────────────────────────────────────
   今日焦點列表
───────────────────────────────────────── */
function renderFocusList() {
  const el = document.getElementById('focus-list');
  if (!el) return;
  const rankColors = ['#f85149','#e3b341','#3fb950','#58a6ff','#bc8cff'];
  el.innerHTML = focusData.map(f => `
    <div class="focus-item">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="focus-rank" style="background:${rankColors[f.rank-1]}22;color:${rankColors[f.rank-1]}">${f.rank}</div>
        <div>
          <div style="font-size:13px;font-weight:600;">${f.code} ${f.name}</div>
          <div style="font-size:11px;color:var(--text2)">${f.reason}</div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div class="up" style="font-size:13px;font-weight:600;">${f.chg}</div>
        <div style="font-size:11px;color:var(--text2)">AI 分 ${f.score}</div>
      </div>
    </div>`).join('');
}

/* ─────────────────────────────────────────
   模組初始化入口
────────────────────────────────────────────────────────────────────────── */

/* API 資料更新 Dashboard */
async function fetchAndUpdateDashboard() {
  try {
    const taiex = await API.getTaiex();
    if (taiex) {
      const idxEl  = document.getElementById('taiex-val');
      const chgEl  = document.getElementById('taiex-chg');
      if (idxEl) idxEl.textContent = Number(taiex.index).toLocaleString();
      if (chgEl) {
        const sign = taiex.change >= 0 ? '+' : '';
        chgEl.textContent = `${sign}${taiex.change} (${sign}${taiex.change_pct}%)`;
        chgEl.className = taiex.change >= 0 ? 'up' : 'dn';
      }
    }
  } catch (e) { console.warn('[M1] taiex 更新失敗', e); }

  try {
    const inst = await API.getInstitutional();
    if (inst) {
      const fmt = v => (v >= 0 ? '+' : '') + (v / 1e8).toFixed(0) + '億';
      const fEl = document.getElementById('inst-foreign');
      const iEl = document.getElementById('inst-invest');
      const dEl = document.getElementById('inst-dealer');
      if (fEl) fEl.textContent = fmt(inst.foreign?.net ?? 0);
      if (iEl) iEl.textContent = fmt(inst.investment?.net ?? 0);
      if (dEl) dEl.textContent = fmt(inst.dealer?.net ?? 0);
    }
  } catch (e) { console.warn('[M1] institutional 更新失敗', e); }

  // 更新「今日焦點」時間顯示
  const timeEl = document.getElementById('focus-update-time');
  if (timeEl) {
    const now = new Date();
    timeEl.textContent = `更新 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }
}

function initDashboard() {
  renderIndexChart('1d');
  renderGauge(73);
  renderFocusList();
  renderHoldings();
  fetchAndUpdateDashboard();
  // 每 60 秒更新一次
  setInterval(fetchAndUpdateDashboard, 60000);
}
     