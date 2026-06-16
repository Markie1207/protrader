/**
 * m1-dashboard.js — 戰情中心
 * 持股：localStorage 可新增/刪除，現價從 API 取得
 * 法人籌碼：bar 寬度動態計算
 * 溫度計：角度修正（Math.PI + score）
 */

'use strict';

/* ── 今日焦點資料（由 API.getFocusList() 動態填入，初始為空） ── */
let focusData = [];

let indexChartInstance = null;

/* ─────────────────────────────────────────
   持股 localStorage 操作
───────────────────────────────────────── */
function loadHoldings() {
  try {
    return JSON.parse(localStorage.getItem('protrader_holdings') || '[]');
  } catch (e) {
    return [];
  }
}

function saveHoldings(data) {
  try {
    localStorage.setItem('protrader_holdings', JSON.stringify(data));
  } catch (e) {
    console.warn('[M1] localStorage 儲存失敗', e);
  }
}

/* ─────────────────────────────────────────
   渲染持股表格（現價從 API 非同步取得）
───────────────────────────────────────── */
async function renderHoldings() {
  const tbody = document.getElementById('holdings-body');
  const badge = document.getElementById('alert-badge');
  const pnlEl = document.getElementById('total-pnl');
  if (!tbody) return;

  const holdings = loadHoldings();

  if (holdings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:20px;">
      尚無持股，點擊「+ 新增持倉」開始追蹤</td></tr>`;
    if (badge) badge.textContent = '0 警示';
    if (pnlEl) { pnlEl.textContent = '+$0'; pnlEl.style.color = ''; }
    return;
  }

  /* 先顯示骨架 */
  tbody.innerHTML = holdings.map(h => `
    <tr>
      <td>
        <strong>${h.code}</strong>
        <span style="color:var(--text2)">${h.name}</span>
        <span style="color:var(--text3);font-size:10px;margin-left:4px;">${h.shares}${h.unit || '張'}</span>
      </td>
      <td>$${Number(h.cost).toLocaleString()}</td>
      <td id="hp-${h.code}" style="color:var(--text3)">—</td>
      <td id="hpct-${h.code}" style="color:var(--text3)">—</td>
      <td id="hst-${h.code}">—</td>
      <td><button onclick="removeHolding('${h.code}')" title="刪除"
            style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;padding:2px 6px;">✕</button></td>
    </tr>`).join('');

  /* 非同步取得現價 */
  let alertCount = 0, pnlTotal = 0;
  await Promise.all(holdings.map(async h => {
    try {
      const q          = await API.getStockQuote(h.code);
      const price      = (q?.price && q.price > 0) ? q.price : h.cost;
      /* 張 = 1000 股；股（零股）= 1 股 */
      const multiplier = (h.unit === '股') ? 1 : 1000;
      const pnl        = (price - h.cost) * h.shares * multiplier;
      const pct        = ((price - h.cost) / h.cost * 100).toFixed(2);
      const isUp       = price >= h.cost;
      const nearSL     = price <= h.sl * 1.05;
      if (nearSL) alertCount++;
      pnlTotal += pnl;

      const hp  = document.getElementById(`hp-${h.code}`);
      const hpc = document.getElementById(`hpct-${h.code}`);
      const hst = document.getElementById(`hst-${h.code}`);
      if (hp)  hp.textContent = `$${Number(price).toLocaleString()}`;
      if (hpc) { hpc.textContent = `${isUp ? '+' : ''}${pct}%`; hpc.className = isUp ? 'up' : 'dn'; }
      if (hst) hst.innerHTML = nearSL
        ? `<span class="badge badge-red">⚠️ 接近止損</span>`
        : isUp
          ? `<span class="badge badge-green">正常</span>`
          : `<span class="badge badge-yellow">觀察中</span>`;
    } catch (e) {
      console.warn(`[M1] 報價失敗 ${h.code}`, e);
    }
  }));

  if (badge) badge.textContent = `${alertCount} 警示`;
  if (pnlEl) {
    const sign = pnlTotal >= 0 ? '+' : '-';
    pnlEl.textContent  = `${sign}$${Math.abs(pnlTotal).toLocaleString()}`;
    pnlEl.style.color  = pnlTotal >= 0 ? 'var(--up)' : 'var(--dn)';
  }
}

/* ─────────────────────────────────────────
   新增持倉（Inline form）
   支援：張 / 股（零股），輸入代號自動帶名稱
───────────────────────────────────────── */
let _autoNameTimer = null;

function autoFetchStockName(code) {
  code = (code || '').trim().toUpperCase();
  clearTimeout(_autoNameTimer);
  if (code.length < 4) return;
  const nameEl = document.getElementById('ah-name');
  const loadEl = document.getElementById('ah-name-load');
  _autoNameTimer = setTimeout(async () => {
    if (loadEl) loadEl.style.display = 'inline';
    try {
      const q = await API.getStockQuote(code);
      if (q?.name && nameEl && !nameEl.value) nameEl.value = q.name;
    } catch (e) { /* silent */ }
    finally { if (loadEl) loadEl.style.display = 'none'; }
  }, 500);
}

function openAddHoldingForm() {
  const existing = document.getElementById('add-holding-form');
  if (existing) { existing.remove(); return; }

  const wrap = document.createElement('div');
  wrap.id = 'add-holding-form';
  wrap.style.cssText = `
    padding:14px; background:var(--bg2); border-radius:8px;
    margin-top:8px; display:grid; grid-template-columns:repeat(3,1fr);
    gap:8px; border:1px solid var(--border);`;
  wrap.innerHTML = `
    <input id="ah-code" class="input-sm" placeholder="股票代號 (2330)" maxlength="6"
           oninput="autoFetchStockName(this.value)">
    <div style="position:relative;">
      <input id="ah-name" class="input-sm" placeholder="名稱（自動帶入）">
      <span id="ah-name-load" style="position:absolute;right:8px;top:6px;
            font-size:10px;color:var(--blue);display:none;">…</span>
    </div>
    <input id="ah-cost" class="input-sm" type="number" placeholder="成本價" min="0" step="0.01">
    <div style="display:flex;gap:4px;">
      <input id="ah-shares" class="input-sm" type="number" placeholder="數量" min="1" style="flex:1;min-width:0;">
      <select id="ah-unit" class="input-sm" style="width:52px;padding:6px 2px;flex-shrink:0;"
              title="張 = 1000股；股 = 零股">
        <option value="張">張</option>
        <option value="股">股</option>
      </select>
    </div>
    <input id="ah-sl" class="input-sm" type="number" placeholder="止損價 (選填)" min="0" step="0.01">
    <input id="ah-tp" class="input-sm" type="number" placeholder="停利價 (選填)" min="0" step="0.01">
    <button class="btn btn-primary btn-sm" onclick="saveNewHolding()" style="grid-column:span 2">確認新增</button>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('add-holding-form').remove()">取消</button>`;

  const card = document.querySelector('#holdings-body')?.closest('.card');
  if (card) card.appendChild(wrap);
  document.getElementById('ah-code')?.focus();
}

function saveNewHolding() {
  const code   = (document.getElementById('ah-code')?.value  || '').trim().toUpperCase();
  const name   = (document.getElementById('ah-name')?.value  || '').trim() || code;
  const cost   = parseFloat(document.getElementById('ah-cost')?.value   || '0');
  const shares = parseFloat(document.getElementById('ah-shares')?.value || '0');
  const unit   = document.getElementById('ah-unit')?.value || '張';
  const slVal  = parseFloat(document.getElementById('ah-sl')?.value     || '0');
  const tpVal  = parseFloat(document.getElementById('ah-tp')?.value     || '0');

  if (!code || cost <= 0 || shares <= 0) {
    alert(`請填入股票代號、成本價、數量（${unit} ≥ 1）`);
    return;
  }

  const sl = slVal > 0 ? slVal : +(cost * 0.9).toFixed(2);
  const tp = tpVal > 0 ? tpVal : +(cost * 1.2).toFixed(2);

  const holdings = loadHoldings();
  const idx   = holdings.findIndex(h => h.code === code);
  const entry = { code, name, cost, shares, unit, sl, tp };
  if (idx >= 0) holdings[idx] = entry; else holdings.push(entry);

  saveHoldings(holdings);
  document.getElementById('add-holding-form')?.remove();
  renderHoldings();
}

function removeHolding(code) {
  if (!confirm(`確定刪除 ${code}？`)) return;
  saveHoldings(loadHoldings().filter(h => h.code !== code));
  renderHoldings();
}

/* ─────────────────────────────────────────
   指數週期圖
───────────────────────────────────────── */
function genTimeLabels(period) {
  const days = ['週一', '週二', '週三', '週四', '週五'];
  const months = Array.from({length: 22}, (_, i) => {
    const d = new Date(Date.now() - (21 - i) * 86400000);
    return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
  });
  switch (period) {
    case '1d': return ['09:00','09:15','09:30','09:45','10:00','10:15','10:30','10:45',
                       '11:00','11:15','11:30','11:45','12:00','12:15','12:30','12:45','13:00','13:15','13:30'];
    case '5d': return days.flatMap(d => ['09:00','10:00','11:00','12:00','13:00'].map(t => `${d} ${t}`));
    case '1m': return months;
    default:   return [];
  }
}

function genIndexData(period) {
  const base = { '1d': 44000, '5d': 43500, '1m': 43000 };
  const b = base[period] || 44000;
  const len = genTimeLabels(period).length;
  return Array.from({length: len}, (_, i) => Math.round(b + (Math.random() - 0.45) * 200 + i * 15));
}

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
        data, borderColor: color, backgroundColor: `${color}22`,
        borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3,
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
   大盤溫度計 + 指標明細展開列
───────────────────────────────────────── */
let _gaugeIndicators = [];   // 最近一次 API 回傳的指標陣列

function renderGauge(score = 73) {
  const canvas = document.getElementById('gaugeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth || 300;
  canvas.width  = w;
  canvas.height = 160;
  const cx = w / 2, cy = 130;
  const r  = Math.min(cx - 20, 100);

  /* 背景弧 */
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI, false);
  ctx.lineWidth   = 18;
  ctx.strokeStyle = '#21262d';
  ctx.stroke();

  /* 值弧（green→yellow→red，從左到當前分數位置） */
  const angle = Math.PI + (score / 100) * Math.PI;
  const grad  = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0,   '#3fb950');
  grad.addColorStop(0.5, '#e3b341');
  grad.addColorStop(1,   '#f85149');
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, angle, false);
  ctx.lineWidth   = 18;
  ctx.strokeStyle = grad;
  ctx.stroke();

  /* 指針 */
  const nx = cx + r * 0.75 * Math.cos(angle);
  const ny = cy + r * 0.75 * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.lineWidth   = 3;
  ctx.strokeStyle = '#e6edf3';
  ctx.stroke();

  /* 圓心小圓點 */
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#e6edf3';
  ctx.fill();

  /* 分數文字 */
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(score, cx, cy - 10);
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px sans-serif';
  ctx.fillText('大盤溫度', cx, cy + 8);
}

/* 指標明細展開列 */
function toggleIndicatorPanel() {
  const panel = document.getElementById('indicator-panel');
  const btn   = document.getElementById('indicator-toggle-btn');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '[ 指標明細 ▼ ]' : '[ 指標明細 ▲ ]';
}

function renderIndicatorPanel(indicators) {
  _gaugeIndicators = indicators || [];
  const panel = document.getElementById('indicator-panel');
  if (!panel || !_gaugeIndicators.length) return;

  const rows = _gaugeIndicators.map(ind => {
    const filled = Math.round(ind.score / 10);
    const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const color  = ind.score >= 60 ? 'var(--up)' : ind.score >= 40 ? 'var(--orange)' : 'var(--dn)';
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;
              border-bottom:1px solid var(--bg3);font-size:11px;">
      <span style="width:56px;color:var(--text2);flex-shrink:0;">${ind.name}</span>
      <span style="width:64px;color:var(--text);flex-shrink:0;">${ind.value}</span>
      <span style="flex:1;color:${color};letter-spacing:1px;font-size:9px;">${bar}</span>
      <span style="width:30px;text-align:right;color:${color};font-weight:600;">${ind.score}</span>
    </div>`;
  }).join('');

  panel.innerHTML = rows;
}

/* ─────────────────────────────────────────
   今日焦點列表
───────────────────────────────────────── */
function renderFocusList() {
  const el = document.getElementById('focus-list');
  if (!el) return;

  const rankColors = ['#f85149', '#e3b341', '#3fb950', '#58a6ff', '#bc8cff'];

  /* 相容新版（stocks 陣列）與舊版（直接陣列） */
  const stocks = Array.isArray(focusData?.stocks) ? focusData.stocks : focusData;

  el.innerHTML = stocks.map(f => {
    const rank      = f.rank ?? 1;
    const color     = rankColors[(rank - 1) % rankColors.length];
    const chgStr    = f.chg ?? (f.change_pct != null ? `${f.change_pct >= 0 ? '+' : ''}${f.change_pct}%` : '—');
    const isUp      = parseFloat(chgStr) >= 0;
    const volStr    = f.volume_ratio != null ? `爆量 ${f.volume_ratio}x` : '';
    const fBuyStr   = f.foreign_buy  != null ? `外資 ${f.foreign_buy >= 0 ? '+' : ''}${Number(f.foreign_buy).toLocaleString()}張` : '';
    const cdStr     = f.foreign_consecutive_days > 0 ? `連買 ${f.foreign_consecutive_days}日` : '';
    const detail    = [volStr, fBuyStr, cdStr].filter(Boolean).join('，') || (f.reason ?? '');

    return `<div class="focus-item">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="focus-rank" style="background:${color}22;color:${color}">${rank}</div>
        <div>
          <div style="font-size:13px;font-weight:600;">${f.code} ${f.name}</div>
          <div style="font-size:11px;color:var(--text2)">${detail}</div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div class="${isUp ? 'up' : 'dn'}" style="font-size:13px;font-weight:600;">${chgStr}</div>
        <div style="font-size:11px;color:var(--text2)">AI 分 ${f.score}</div>
      </div>
    </div>`;
  }).join('');

  const timeEl = document.getElementById('focus-update-time');
  if (timeEl) {
    const d = focusData?.date;
    timeEl.textContent = d ? `資料日期：${d}` : new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }
}

/* ─────────────────────────────────────────
   API 資料更新 Dashboard（加權指數 + 法人籌碼 + 期貨未平倉）
───────────────────────────────────────── */
async function fetchAndUpdateDashboard() {
  /* 加權指數 */
  try {
    const taiex = await API.getTaiex();
    if (taiex) {
      const idxEl = document.getElementById('taiex-val');
      const chgEl = document.getElementById('taiex-chg');
      if (idxEl) idxEl.textContent = Number(taiex.index).toLocaleString();
      if (chgEl) {
        const sign = taiex.change >= 0 ? '+' : '';
        chgEl.textContent = `${sign}${taiex.change} (${sign}${taiex.change_pct}%)`;
        chgEl.className   = taiex.change >= 0 ? 'up' : 'dn';
      }
      // BUG-010 修正：同步更新漲跌箭頭 badge
      const badgeEl = document.getElementById('taiex-badge');
      if (badgeEl) {
        badgeEl.textContent = taiex.change >= 0 ? '▲' : '▼';
        badgeEl.style.color = taiex.change >= 0 ? 'var(--up)' : 'var(--dn)';
      }
    }
  } catch (e) { console.warn('[M1] taiex 更新失敗', e); }

  /* 三大法人 */
  try {
    const inst = await API.getInstitutional();
    if (inst) {
      const fmt = v => (v >= 0 ? '+' : '') + (v / 1e8).toFixed(0) + '億';
      const fNet = inst.foreign?.net    ?? 0;
      const iNet = inst.investment?.net ?? 0;
      const dNet = inst.dealer?.net     ?? 0;

      /* 小卡摘要 */
      const fEl = document.getElementById('inst-foreign');
      const iEl = document.getElementById('inst-invest');
      if (fEl) { fEl.textContent = fmt(fNet); fEl.className = `card-value ${fNet >= 0 ? 'up' : 'dn'}`; }
      if (iEl) { iEl.textContent = fmt(iNet); iEl.className = `card-value ${iNet >= 0 ? 'up' : 'dn'}`; }

      /* chip bar 動態寬度 */
      const maxAbs = Math.max(Math.abs(fNet), Math.abs(iNet), Math.abs(dNet), 1);
      const toW    = v => `${Math.round(Math.abs(v) / maxAbs * 90)}%`;
      const toCol  = v => v >= 0 ? 'var(--up)' : 'var(--dn)';

      [
        { bar: 'chip-bar-foreign', val: 'chip-val-foreign', net: fNet },
        { bar: 'chip-bar-invest',  val: 'chip-val-invest',  net: iNet },
        { bar: 'chip-bar-dealer',  val: 'chip-val-dealer',  net: dNet },
      ].forEach(({ bar, val, net }) => {
        const barEl = document.getElementById(bar);
        const valEl = document.getElementById(val);
        if (barEl) { barEl.style.width = toW(net); barEl.style.background = toCol(net); }
        if (valEl) { valEl.textContent = fmt(net); valEl.className = `chip-val ${net >= 0 ? 'up' : 'dn'}`; }
      });
    }
  } catch (e) { console.warn('[M1] 法人更新失敗', e); }

  /* 期貨未平倉（三大法人） */
  try {
    const oi = await API.getFuturesOI();
    if (oi) {
      const isMock = oi.source === 'mock';

      /* 資料日期 */
      const dateEl = document.getElementById('futures-oi-date');
      if (dateEl) dateEl.textContent = oi.date ? `資料日期：${oi.date}` : '';

      /* source badge */
      const badgeEl = document.getElementById('futures-oi-badge');
      if (badgeEl) {
        badgeEl.style.display = '';
        if (isMock) {
          badgeEl.textContent        = '模擬資料';
          badgeEl.style.background   = 'rgba(255,136,0,0.15)';
          badgeEl.style.color        = 'var(--orange)';
        } else {
          badgeEl.textContent        = '即時';
          badgeEl.style.background   = 'rgba(63,185,80,0.15)';
          badgeEl.style.color        = 'var(--up)';
        }
      }

      const fmtOI  = v => (v == null ? '—' : Number(v).toLocaleString());
      const fmtNet = v => {
        if (v == null) return '—';
        const arrow = v >= 0 ? ' ▲' : ' ▼';
        return (v >= 0 ? '+' : '') + Number(v).toLocaleString() + arrow;
      };
      const netColor = v => v == null ? 'var(--text)' : (v >= 0 ? 'var(--up)' : 'var(--dn)');

      [
        { key: 'dealer',           prefix: 'dealer' },
        { key: 'investment_trust', prefix: 'it'     },
        { key: 'foreign',          prefix: 'fo'     },
      ].forEach(({ key, prefix }) => {
        const grp     = oi[key] || {};
        const longEl  = document.getElementById(`oi-${prefix}-long`);
        const shortEl = document.getElementById(`oi-${prefix}-short`);
        const netEl   = document.getElementById(`oi-${prefix}-net`);
        if (longEl)  longEl.textContent  = fmtOI(grp.long);
        if (shortEl) shortEl.textContent = fmtOI(grp.short);
        if (netEl) {
          netEl.textContent = fmtNet(grp.net);
          netEl.style.color = netColor(grp.net);
        }
      });
    }
  } catch (e) { console.warn('[M1] 期貨OI更新失敗', e); }

  /* 大盤溫度計（真實API） */
  try {
    const temp = await API.getTemperature();
    if (temp && temp.score != null) {
      renderGauge(temp.score);
      renderIndicatorPanel(temp.indicators || []);
      /* 更新 badge 標籤 */
      const badge = document.querySelector('.card-header .badge-yellow, .card-header [class*="badge"]');
      if (badge && temp.label) badge.textContent = temp.label;
    }
  } catch (e) { console.warn('[M1] 溫度計更新失敗', e); }

  /* 今日焦點排序（新版4因子） */
  try {
    /* 讀取 M6 觀察清單作為股票池（有則優先用） */
    let watchCodes = null;
    try {
      const wl = JSON.parse(localStorage.getItem('protrader_watchlist') || '[]');
      if (wl.length) watchCodes = wl.map(w => w.code || w).filter(Boolean);
    } catch (_) {}

    const focus = await API.getFocusList(watchCodes);
    if (focus) {
      focusData = focus;
      renderFocusList();
    }
  } catch (e) { console.warn('[M1] 焦點清單更新失敗', e); }
}

/* ─────────────────────────────────────────
   初始化進入點
───────────────────────────────────────── */
function initDashboard() {
  // 先用 mock 資料讓焦點清單立即顯示，API 回來後再覆蓋
  if (typeof Mock !== 'undefined' && typeof Mock.focusList === 'function') {
    focusData = Mock.focusList();
  }
  renderHoldings();
  renderFocusList();
  renderGauge();
  renderIndexChart('1d');
  fetchAndUpdateDashboard();
}
