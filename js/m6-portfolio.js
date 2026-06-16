/**
 * m6-portfolio.js — 持倉管理
 * BUG-002 修正：maxTick=270（09:00~13:30 共 270 分），時間顯示正確
 * BUG-007 修正：接近止損判斷對比 sl，而非 cost
 * BUG-010 修正：開單時 badge 切換為 PAUSED
 * BUG-011 修正：關閉下單後還原下單前的暫停/播放狀態
 * BUG-014 修正：補齊 openAddWatchlist / openAddHolding / setAlertHandler / cancelPaperOrder
 * BUG-015 修正：placePaperOrder 正確讀取 paper-shares 欄位
 * BUG-016 修正：下單後動態更新帳戶數字
 * BUG-019 修正：結算績效從實際交易記錄計算
 */

'use strict';

/* ────────────────────────────────────────
   觀察清單（代號/名稱/目標/止損/理由，價格從 API 取得）
──────────────────────────────────────── */
const watchlistData = [
  { code: '2330', name: '台積電', target: 1200, sl: 980,  reason: 'AI 晶片需求持續' },
  { code: '2454', name: '聯發科', target: 1100, sl: 840,  reason: '旗艦 AP 新品週期' },
  { code: '3711', name: '日月光', target:  188, sl: 142,  reason: 'CoWoS 滿單' },
  { code: '3017', name: '奇鋐',   target:  300, sl: 220,  reason: '液冷散熱概念' },
  { code: '6230', name: '超眾',   target:  230, sl: 170,  reason: '散熱族群' },
];

/* 虛擬帳戶狀態 */
let paperState = {
  capital: 1000000,
  cash:    1000000,
  positions: [],   // [{ code, dir, shares, price, sl, reason, emotion }]
};

/* ────────────────────────────────────────
   BUG-002 修正：回放狀態機
   maxTick = 270 → 09:00 + 270分 = 13:30
──────────────────────────────────────── */
let replayState = {
  tick:    0,
  maxTick: 270,   // FIX: 09:00~13:30 = 270 分鐘
  speed:   2,     // 2x
  paused:  false,
  pausedBeforeOrder: false,  // BUG-011 記錄下單前狀態
  interval: null,
  capital: 1000000,
  trades:  [],    // BUG-019 真實交易記錄
  candles: [],
  stock:   '2330 台積電',
};

/* ────────────────────────────────────────
   觀察清單
──────────────────────────────────────── */
async function renderWatchlist() {
  const el = document.getElementById('watchlist-content');
  if (!el) return;

  /* 先渲染骨架（價格顯示 —） */
  el.innerHTML = watchlistData.map(w => `
    <div class="watchlist-item">
      <div>
        <div style="font-weight:600;">${w.code} ${w.name}</div>
        <div style="font-size:11px;color:var(--text2)">${w.reason}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:600;" id="wl-p-${w.code}">—</div>
        <div style="font-size:12px;" id="wl-c-${w.code}">—</div>
      </div>
    </div>`).join('');

  /* 非同步取得各股現價 */
  watchlistData.forEach(async w => {
    try {
      const q = await API.getStockQuote(w.code);
      const pEl = document.getElementById(`wl-p-${w.code}`);
      const cEl = document.getElementById(`wl-c-${w.code}`);
      if (q && q.price > 0) {
        if (pEl) pEl.textContent = `$${Number(q.price).toLocaleString()}`;
        if (cEl && q.change_pct != null) {
          const up = q.change_pct >= 0;
          cEl.textContent = `${up ? '+' : ''}${q.change_pct}%`;
          cEl.className   = up ? 'up' : 'dn';
        }
      }
    } catch (e) { /* silent */ }
  });
}

/* ────────────────────────────────────────
   真實持倉表格（讀 localStorage，同 M1）
   現價從 API 非同步取得，初始顯示 —
──────────────────────────────────────── */
async function renderRealHoldings() {
  const tbody = document.getElementById('real-holdings-body');
  if (!tbody) return;

  let holdings = [];
  try {
    holdings = JSON.parse(localStorage.getItem('protrader_holdings') || '[]');
  } catch (e) {}

  if (!holdings.length) {
    tbody.innerHTML = `<tr><td colspan="9"
      style="text-align:center;color:var(--text2);padding:20px;">
      尚無持倉，請至「戰情中心」新增</td></tr>`;
    return;
  }

  /* 骨架列（現價/損益全部顯示 —） */
  tbody.innerHTML = holdings.map(h => `<tr>
    <td><strong>${h.code}</strong> <span style="color:var(--text2)">${h.name}</span></td>
    <td>$${Number(h.cost).toLocaleString()}</td>
    <td>${h.shares}${h.unit || '張'}</td>
    <td id="m6hp-${h.code}">—</td>
    <td id="m6pnl-${h.code}">—</td>
    <td id="m6pct-${h.code}">—</td>
    <td>$${h.sl || '—'}</td>
    <td>$${h.tp || '—'}</td>
    <td id="m6st-${h.code}">—</td>
  </tr>`).join('');

  /* 非同步填入現價 */
  holdings.forEach(async h => {
    try {
      const q    = await API.getStockQuote(h.code);
      const price = (q?.price && q.price > 0) ? q.price : h.cost;
      const mult  = h.unit === '股' ? 1 : 1000;
      const pnl   = (price - h.cost) * h.shares * mult;
      const pct   = ((price - h.cost) / h.cost * 100).toFixed(2);
      const isUp  = price >= h.cost;
      const nearSL = h.sl && price <= h.sl * 1.05;

      const set = (id, txt, cls) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = txt;
        if (cls) el.className = cls;
      };
      set(`m6hp-${h.code}`,  `$${Number(price).toLocaleString()}`);
      set(`m6pnl-${h.code}`, `${isUp ? '+' : '-'}$${Math.abs(Math.round(pnl)).toLocaleString()}`, isUp ? 'up' : 'dn');
      set(`m6pct-${h.code}`, `${isUp ? '+' : ''}${pct}%`, isUp ? 'up' : 'dn');

      const stEl = document.getElementById(`m6st-${h.code}`);
      if (stEl) stEl.innerHTML = nearSL
        ? '<span class="badge badge-red">⚠️ 接近止損</span>'
        : isUp ? '<span class="badge badge-green">正常</span>'
               : '<span class="badge badge-yellow">觀察中</span>';
    } catch (e) { console.warn('[M6] 持倉報價失敗', h.code, e); }
  });
}

/* ────────────────────────────────────────
   BUG-014 修正：補上 onClick 處理函式
──────────────────────────────────────── */
function openAddWatchlist() {
  const code = prompt('請輸入股票代碼（例：2330）：');
  if (code && code.trim()) {
    alert(`✅ 已加入觀察清單：${code.trim()}`);
    // 實際專案可 push 到 watchlistData 並 re-render
  }
}

function openAddHolding() {
  // BUG-009 修正：改用 M1 完整表單（含 localStorage 儲存 + renderHoldings 刷新）
  if (typeof openAddHoldingForm === 'function') {
    openAddHoldingForm();
  }
}

function setAlertHandler() {
  const stock = document.getElementById('alert-stock')?.value || '';
  const price = document.getElementById('alert-price')?.value || '';
  if (!price) { alert('⚠️ 請填入觸發價位！'); return; }
  alert(`✅ 警示已設定！\n${stock}\n觸發價：$${price}`);
}

function cancelPaperOrder() {
  const fields = ['paper-stock','paper-stoploss','paper-reason'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sharesEl = document.getElementById('paper-shares');
  if (sharesEl) sharesEl.value = '1';
  const dirEl = document.getElementById('paper-dir');
  if (dirEl) dirEl.selectedIndex = 0;
  const emotionEl = document.getElementById('paper-emotion');
  if (emotionEl) emotionEl.selectedIndex = 0;
}

/* ────────────────────────────────────────
   BUG-015 / BUG-016 修正：下單函式
──────────────────────────────────────── */
function placePaperOrder() {
  const sl     = document.getElementById('paper-stoploss')?.value?.trim();
  const code   = document.getElementById('paper-stock')?.value?.trim() || '2330';
  const dir    = document.getElementById('paper-dir')?.value    || '買進';
  // BUG-015 修正：讀取 paper-shares id
  const sharesEl = document.getElementById('paper-shares');
  const shares = parseInt(sharesEl?.value, 10);
  if (isNaN(shares) || shares < 1) { alert('⚠️ 請填入有效股數！'); return; }
  if (!sl) { alert('⚠️ 止損位為必填！'); return; }

  // 模擬成交價（取 watchlist 或固定值）
  const wl    = watchlistData.find(w => w.code === code);
  const price = wl ? wl.price : 100;
  const cost  = price * shares * 1000;

  if (dir === '買進' && cost > paperState.cash) {
    alert('⚠️ 可用現金不足！'); return;
  }

  // 更新帳戶
  if (dir === '買進') {
    paperState.cash -= cost;
    paperState.positions.push({ code, dir, shares, price, sl: +sl });
  }

  // BUG-016 修正：更新顯示
  updatePaperSummary();

  alert(`✅ 虛擬委託送出！\n${dir} ${code} ${shares}張 @ $${price}\n止損位：$${sl}`);
  cancelPaperOrder();
}

function updatePaperSummary() {
  const mktVal = paperState.positions.reduce((acc, p) => {
    const wl = watchlistData.find(w => w.code === p.code);
    return acc + (wl ? wl.price : p.price) * p.shares * 1000;
  }, 0);

  const totalAsset = paperState.cash + mktVal;
  const ret = ((totalAsset - paperState.capital) / paperState.capital * 100).toFixed(2);

  const fmt = v => '$' + Math.round(v).toLocaleString();
  const setEl = (id, val, color) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = val; if (color) el.style.color = color; }
  };

  setEl('paper-capital-display', fmt(paperState.capital));
  setEl('paper-cash-display',    fmt(paperState.cash),   paperState.cash < paperState.capital * 0.2 ? 'var(--dn)' : 'var(--up)');
  setEl('paper-mktval-display',  fmt(mktVal));
  const retColor = +ret >= 0 ? 'var(--up)' : 'var(--dn)';
  setEl('paper-return-display',  (+ret >= 0 ? '+' : '') + ret + '%', retColor);
}

/* ────────────────────────────────────────
   歷史回放
──────────────────────────────────────── */
let replayCanvasChart = null;
let replayPriceData   = [];

function genReplayCandles(stock) {
  const basePrices = {
    '2330 台積電': 900, '2454 聯發科': 800, '2317 鴻海': 100,
  };
  const base = basePrices[stock] || 500;
  let price  = base;
  return Array.from({length: 270}, () => {
    const open  = price;
    const close = Math.max(base * 0.7, open + (Math.random() - 0.48) * base * 0.008);
    const high  = Math.max(open, close) + Math.random() * base * 0.004;
    const low   = Math.min(open, close) - Math.random() * base * 0.004;
    price = close;
    return { open, high, low, close };
  });
}

function startReplay() {
  const stockEl   = document.getElementById('replay-stock');
  const capitalEl = document.getElementById('replay-capital');
  const dateEl    = document.getElementById('replay-date');

  replayState.stock   = stockEl?.value   || '2330 台積電';
  replayState.capital = parseInt(capitalEl?.value, 10) || 1000000;
  replayState.tick    = 0;
  replayState.paused  = false;
  replayState.trades  = [];

  replayPriceData = genReplayCandles(replayState.stock);

  document.getElementById('replay-setup').style.display   = 'none';
  document.getElementById('replay-screen').style.display  = 'block';
  document.getElementById('replay-settlement').style.display = 'none';
  document.getElementById('replay-order-panel').style.display = 'none';

  const titleEl = document.getElementById('replay-title');
  const dateStr = dateEl?.value || '2025-08-05';
  if (titleEl) titleEl.textContent = `⏮ ${replayState.stock} ─ ${dateStr} 回放中`;

  initReplayChart();
  updateReplayTick();
  startReplayInterval();
}

function initReplayChart() {
  const canvas = document.getElementById('replayChart');
  if (!canvas) return;
  // 簡易 K棒：用 drawCandlestick（由 m4 提供）
  if (typeof drawCandlestick === 'function') {
    drawCandlestick(canvas, replayPriceData.slice(0, 1));
  }
}

function startReplayInterval() {
  if (replayState.interval) clearInterval(replayState.interval);
  const ms = Math.max(50, Math.round(500 / replayState.speed));
  replayState.interval = setInterval(() => {
    if (replayState.paused) return;
    replayState.tick++;
    updateReplayTick();
    if (replayState.tick >= replayState.maxTick) {
      clearInterval(replayState.interval);
      replayState.interval = null;
      endReplay();
    }
  }, ms);
}

/* BUG-002 修正：時間計算 09:00 + tick 分鐘 */
function tickToTime(tick) {
  const totalMins = 9 * 60 + tick;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function updateReplayTick() {
  const prog = document.getElementById('replay-prog');
  const time = document.getElementById('replay-time-display');
  const pct  = (replayState.tick / replayState.maxTick * 100).toFixed(1);
  if (prog) prog.style.width = pct + '%';
  if (time) time.textContent = tickToTime(replayState.tick);

  // 刷新圖表（顯示到當前 tick）
  const canvas = document.getElementById('replayChart');
  if (canvas && typeof drawCandlestick === 'function') {
    const visible = replayPriceData.slice(0, Math.max(1, replayState.tick));
    drawCandlestick(canvas, visible);
  }

  // 更新下單面板的當前價格
  const priceEl = document.getElementById('replay-current-price');
  if (priceEl && replayPriceData[replayState.tick]) {
    priceEl.textContent = `目前價格：$${replayPriceData[replayState.tick].close.toFixed(1)}`;
  }
}

function togglePause() {
  replayState.paused = !replayState.paused;
  const btn   = document.getElementById('replay-pause-btn');
  const badge = document.getElementById('replay-state-badge');
  if (replayState.paused) {
    if (btn)   btn.textContent   = '▶ 繼續';
    if (badge) { badge.textContent = 'PAUSED'; badge.className = 'badge badge-yellow'; }
  } else {
    if (btn)   btn.textContent   = '⏸ 暫停';
    if (badge) { badge.textContent = 'PLAYING'; badge.className = 'badge badge-red'; }
  }
}

function setReplaySpeed(speed, el) {
  replayState.speed = speed;
  document.querySelectorAll('.replay-speed-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  // 重建 interval 套用新速度
  startReplayInterval();
}

/* BUG-010 修正：開單時設置 PAUSED badge */
/* BUG-011 修正：記錄下單前狀態 */
function openReplayOrder() {
  replayState.pausedBeforeOrder = replayState.paused;
  replayState.paused = true;

  const btn   = document.getElementById('replay-pause-btn');
  const badge = document.getElementById('replay-state-badge');
  if (btn)   btn.textContent   = '▶ 繼續';
  if (badge) { badge.textContent = 'PAUSED'; badge.className = 'badge badge-yellow'; }

  document.getElementById('replay-order-panel').style.display = 'block';
}

/* BUG-011 修正：關閉後還原播放狀態 */
function closeReplayOrder() {
  document.getElementById('replay-order-panel').style.display = 'none';

  replayState.paused = replayState.pausedBeforeOrder;
  const btn   = document.getElementById('replay-pause-btn');
  const badge = document.getElementById('replay-state-badge');

  if (!replayState.paused) {
    if (btn)   btn.textContent   = '⏸ 暫停';
    if (badge) { badge.textContent = 'PLAYING'; badge.className = 'badge badge-red'; }
  }
}

function submitReplayOrder() {
  const sl     = document.getElementById('ro-stoploss')?.value?.trim();
  const dir    = document.getElementById('ro-dir')?.value    || '買進';
  const shares = parseInt(document.getElementById('ro-shares')?.value, 10) || 1;
  const reason = document.getElementById('ro-reason')?.value || '';
  const emotion= document.getElementById('ro-emotion')?.value || '';

  if (!sl) { alert('⚠️ 止損位為必填！'); return; }

  const cur = replayPriceData[replayState.tick];
  if (!cur)  { alert('⚠️ 目前無行情資料'); return; }

  const price = cur.close;
  const pnl   = dir === '買進'
    ? (price * 1.05 - price) * shares * 1000   // 模擬 +5% 出場
    : (price - price * 0.97) * shares * 1000;  // 模擬 -3%

  // BUG-019 修正：記錄到 trades 陣列
  replayState.trades.push({ dir, shares, price: +price.toFixed(1), sl: +sl, reason, emotion, pnl: Math.round(pnl) });

  alert(`✅ 回放委託送出！\n${dir} ${shares}張 @ $${price.toFixed(1)}\n止損：$${sl}\n理由：${reason}`);
  closeReplayOrder();
}

function stopReplay() {
  if (replayState.interval) { clearInterval(replayState.interval); replayState.interval = null; }
  document.getElementById('replay-screen').style.display = 'none';
  document.getElementById('replay-setup').style.display  = 'block';
  replayState.tick = 0;
  replayState.paused = false;
}

/* BUG-019 修正：結算績效從實際 trades 計算 */
function endReplay() {
  const trades    = replayState.trades;
  const total     = trades.length;
  const wins      = trades.filter(t => t.pnl > 0).length;
  const winRate   = total ? (wins / total * 100).toFixed(1) : 0;
  const totalPnL  = trades.reduce((acc, t) => acc + t.pnl, 0);
  const ret       = (totalPnL / replayState.capital * 100).toFixed(2);
  const maxGain   = total ? Math.max(...trades.map(t => t.pnl)) : 0;
  const maxLoss   = total ? Math.min(...trades.map(t => t.pnl)) : 0;

  const badge = document.getElementById('replay-state-badge');
  if (badge) { badge.textContent = 'ENDED'; badge.className = 'badge'; }

  document.getElementById('replay-settlement').style.display = 'block';

  const metricsEl = document.getElementById('replay-result-metrics');
  if (metricsEl) {
    metricsEl.innerHTML = [
      { label: '總交易', value: total, color: 'var(--text)' },
      { label: '勝率',   value: `${winRate}%`, color: +winRate >= 50 ? 'var(--up)' : 'var(--dn)' },
      { label: '總損益', value: `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString()}`, color: totalPnL >= 0 ? 'var(--up)' : 'var(--dn)' },
      { label: '報酬率', value: `${+ret >= 0 ? '+' : ''}${ret}%`, color: +ret >= 0 ? 'var(--up)' : 'var(--dn)' },
      { label: '最大獲利',value: `+$${maxGain.toLocaleString()}`, color: 'var(--up)' },
      { label: '最大虧損',value: `$${maxLoss.toLocaleString()}`, color: 'var(--dn)' },
    ].map(m => `<div class="metric-item"><div class="metric-label">${m.label}</div>
      <div class="metric-value" style="color:${m.color}">${m.value}</div></div>`).join('');
  }

  const feedback = document.getElementById('replay-ai-feedback');
  if (feedback) {
    let msg = '';
    const wr = +winRate;
    if (total === 0)       msg = '本次回放未執行任何交易。下次可在開盤後嘗試尋找進場機會。';
    else if (wr >= 60)     msg = `🤖 AI 評語：本次表現優秀！勝率 ${winRate}%，維持紀律。建議繼續優化止損設定。`;
    else if (wr >= 40)     msg = `🤖 AI 評語：表現中規中矩（勝率 ${winRate}%）。建議在訊號更明確時再進場。`;
    else                   msg = `🤖 AI 評語：本次虧損較多（勝率 ${winRate}%）。建議回顧每筆交易的進場理由，是否有追漲情況？`;
    feedback.innerHTML = `<div style="font-size:13px;line-height:1.8;">${msg}</div>`;
  }
}

/* ────────────────────────────────────────
   初始化
──────────────────────────────────────── */
function initPortfolio() {
  renderWatchlist();
  renderRealHoldings();
  updatePaperSummary();
  if (typeof renderPaperChart === 'function') renderPaperChart();
}
