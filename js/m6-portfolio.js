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
   觀察清單資料
──────────────────────────────────────── */
const watchlistData = [
  { code: '2330', name: '台積電', price: 1050, chg: +2.4, target: 1200, sl: 980,  reason: 'AI 晶片需求持續' },
  { code: '2454', name: '聯發科', price:  890, chg: +1.8, target: 1100, sl: 840,  reason: '旗艦 AP 新品週期' },
  { code: '3711', name: '日月光', price:  155, chg: +1.2, target:  188, sl: 142,  reason: 'CoWoS 滿單' },
  { code: '3017', name: '奇鋐',   price:  240, chg: +3.5, target:  300, sl: 220,  reason: '液冷散熱概念' },
  { code: '6230', name: '超眾',   price:  185, chg: +2.1, target:  230, sl: 170,  reason: '散熱族群' },
];

/* 真實持倉資料（與 m1 holdingsData 共用邏輯，各自獨立） */
const realHoldingsData = [
  { code: '2330', name: '台積電', cost: 820, shares: 2, price: 1050, sl: 780,  tp: 1200 },
  { code: '2317', name: '鴻海',   cost: 105, shares: 5, price: 108,  sl: 98,   tp: 130  },
  { code: '2454', name: '聯發科', cost: 1020,shares: 1, price: 890,  sl: 850,  tp: 1300 },
  { code: '2308', name: '台達電', cost: 280, shares: 3, price: 310,  sl: 265,  tp: 380  },
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
function renderWatchlist() {
  const el = document.getElementById('watchlist-content');
  if (!el) return;
  el.innerHTML = watchlistData.map(w => {
    const isUp = w.chg >= 0;
    return `<div class="watchlist-item">
      <div>
        <div style="font-weight:600;">${w.code} ${w.name}</div>
        <div style="font-size:11px;color:var(--text2)">${w.reason}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:600;">$${w.price.toLocaleString()}</div>
        <div class="${isUp ? 'up' : 'dn'}" style="font-size:12px;">${isUp ? '+' : ''}${w.chg}%</div>
      </div>
    </div>`;
  }).join('');
}

/* ────────────────────────────────────────
   真實持倉表格
   BUG-007 修正：nearSL 對比 sl（非 cost）
──────────────────────────────────────── */
function renderRealHoldings() {
  const tbody = document.getElementById('real-holdings-body');
  if (!tbody) return;
  tbody.innerHTML = realHoldingsData.map(h => {
    const pnl    = (h.price - h.cost) * h.shares * 1000;
    const pnlPct = ((h.price - h.cost) / h.cost * 100).toFixed(2);
    const isUp   = h.price >= h.cost;
    // BUG-007 修正
    const nearSL = h.price <= h.sl * 1.05;
    const status = nearSL
      ? `<span class="badge badge-red">⚠️ 接近止損</span>`
      : isUp
        ? `<span class="badge badge-green">正常</span>`
        : `<span class="badge badge-yellow">觀察中</span>`;
    return `<tr>
      <td><strong>${h.code}</strong> <span style="color:var(--text2)">${h.name}</span></td>
      <td>$${h.cost.toLocaleString()}</td>
      <td>${h.shares}張</td>
      <td>$${h.price.toLocaleString()}</td>
      <td class="${isUp ? 'up' : 'dn'}">${isUp ? '+' : ''}$${Math.abs(pnl).toLocaleString()}</td>
      <td class="${isUp ? 'up' : 'dn'}">${isUp ? '+' : ''}${pnlPct}%</td>
      <td>$${h.sl}</td>
      <td>$${h.tp}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
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
  const code   = prompt('股票代碼（例：2330）：');
  const cost   = prompt('均成本（例：820）：');
  const shares = prompt('股數（張）（例：2）：');
  if (code && cost && shares) {
    alert(`✅ 已新增持倉：${code}，成本 $${cost}，${shares} 張`);
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
