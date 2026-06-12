/**
 * m4-strategy.js — 交易策略室
 * BUG-004 修正：自製 Canvas 真實 OHLC K棒（含影線）
 * BUG-009 修正：切換個股時同步刷新 K棒圖
 * BUG-017 修正：策略卡包含壓力位（支撐/壓力）
 * BUG-021 修正：移除冗餘「載入」按鈕，onchange 直接觸發
 */

'use strict';

/* ── 個股策略資料（含壓力位、支撐位） ── */
const strategyCards = {
  '2330': {
    name: '台積電', signal: '強力買進', signalClass: 'badge-green',
    items: [
      { label: '建議進場區', value: '$1,020 ~ $1,050', sub: 'MA20 支撐帶' },
      { label: '第一目標',   value: '$1,180',           sub: '+12.4% 壓力位' },
      { label: '第二目標',   value: '$1,300',           sub: '+23.8% 前高區' },
      { label: '止損位',     value: '$960',             sub: '-8.6% 月線下' },
      { label: '壓力位',     value: '$1,200',           sub: '前高密集成交區' },
      { label: '支撐位',     value: '$980',             sub: '季線 + 缺口下緣' },
      { label: '進場訊號',   value: 'MA5 > MA20',       sub: '外資連買 8 日' },
      { label: '風險報酬比', value: '1 : 2.8',          sub: '風險 $90 / 獲利 $250' },
    ]
  },
  '2317': {
    name: '鴻海', signal: '觀察', signalClass: 'badge-yellow',
    items: [
      { label: '建議進場區', value: '$105 ~ $108',  sub: '震盪整理帶' },
      { label: '第一目標',   value: '$125',         sub: '+16% 前高阻力' },
      { label: '第二目標',   value: '$140',         sub: '+30% 年高' },
      { label: '止損位',     value: '$98',          sub: '-7% 季線' },
      { label: '壓力位',     value: '$125',         sub: '前波高點' },
      { label: '支撐位',     value: '$100',         sub: '年線 + 整理底部' },
      { label: '進場訊號',   value: '等待突破 $110', sub: '法人中立' },
      { label: '風險報酬比', value: '1 : 2.2',      sub: '風險 $9 / 獲利 $20' },
    ]
  },
  '2308': {
    name: '台達電', signal: '買進', signalClass: 'badge-blue',
    items: [
      { label: '建議進場區', value: '$295 ~ $315',  sub: 'MA20 附近' },
      { label: '第一目標',   value: '$370',         sub: '+18% 前高' },
      { label: '第二目標',   value: '$420',         sub: '+34%' },
      { label: '止損位',     value: '$275',         sub: '-9% MA60' },
      { label: '壓力位',     value: '$380',         sub: '前波整理密集區' },
      { label: '支撐位',     value: '$285',         sub: '月線扣抵區' },
      { label: '進場訊號',   value: '外資連買',      sub: '電源管理概念火熱' },
      { label: '風險報酬比', value: '1 : 2.4',      sub: '風險 $30 / 獲利 $72' },
    ]
  },
  '3711': {
    name: '日月光', signal: '強力買進', signalClass: 'badge-green',
    items: [
      { label: '建議進場區', value: '$150 ~ $158',  sub: 'MA5 回測' },
      { label: '第一目標',   value: '$185',         sub: '+18% CoWoS 滿單' },
      { label: '第二目標',   value: '$210',         sub: '+34%' },
      { label: '止損位',     value: '$142',         sub: '-6.5% 月線' },
      { label: '壓力位',     value: '$188',         sub: '52 週高點附近' },
      { label: '支撐位',     value: '$148',         sub: '季線支撐' },
      { label: '進場訊號',   value: 'MA5 > MA20',   sub: '法人全買' },
      { label: '風險報酬比', value: '1 : 3.1',      sub: '風險 $13 / 獲利 $40' },
    ]
  },
  '2303': {
    name: '聯電', signal: '中立', signalClass: '',
    items: [
      { label: '建議進場區', value: '$45 ~ $48',    sub: '等待突破訊號' },
      { label: '第一目標',   value: '$57',          sub: '+19%' },
      { label: '第二目標',   value: '$65',          sub: '+35%' },
      { label: '止損位',     value: '$42',          sub: '-8%' },
      { label: '壓力位',     value: '$55',          sub: '前高整理區' },
      { label: '支撐位',     value: '$44',          sub: '年線支撐' },
      { label: '進場訊號',   value: '等待量能放大', sub: '外資觀望' },
      { label: '風險報酬比', value: '1 : 2.5',      sub: '風險 $5 / 獲利 $12' },
    ]
  }
};

/* ── K棒模擬資料（OHLC）── */
function genKbarData(code) {
  const basePrices = { '2330': 1000, '2317': 105, '2308': 290, '3711': 150, '2303': 46 };
  const base = basePrices[code] || 100;
  const data = [];
  let price = base;
  for (let i = 0; i < 30; i++) {
    const open  = price;
    const chg   = (Math.random() - 0.45) * base * 0.025;
    const close = Math.max(base * 0.7, open + chg);
    const high  = Math.max(open, close) + Math.random() * base * 0.01;
    const low   = Math.min(open, close) - Math.random() * base * 0.01;
    data.push({ open, high, low, close });
    price = close;
  }
  return data;
}

/* ─────────────────────────────────────────
   BUG-004 修正：自製 Canvas K棒
   真實 OHLC：上下影線 + 實體矩形
───────────────────────────────────────── */
function drawCandlestick(canvas, data) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth || 500;
  const H   = 200;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD_L = 10, PAD_R = 10, PAD_T = 10, PAD_B = 20;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // 計算 Y 範圍
  const allPrices = data.flatMap(d => [d.high, d.low]);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;

  const yOf = v => PAD_T + chartH - ((v - minP) / range) * chartH;
  const candleW = Math.max(2, (chartW / data.length) * 0.6);
  const step    = chartW / data.length;

  // 格線
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD_T + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
  }

  // 繪製每根K棒
  data.forEach((d, i) => {
    const x      = PAD_L + step * i + step / 2;
    const isUp   = d.close >= d.open;
    const color  = isUp ? '#f85149' : '#3fb950';

    // 上下影線
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, yOf(d.high));
    ctx.lineTo(x, yOf(d.low));
    ctx.stroke();

    // 實體（矩形）
    const bodyTop = yOf(Math.max(d.open, d.close));
    const bodyBot = yOf(Math.min(d.open, d.close));
    const bodyH   = Math.max(1.5, bodyBot - bodyTop);
    ctx.fillStyle   = color;
    ctx.strokeStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  });

  // 最後一個標價
  const last = data[data.length - 1];
  ctx.fillStyle = '#8b949e';
  ctx.font      = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(last.close.toFixed(1), W - PAD_R, PAD_T - 1);
}

/* ── K棒型態辨識（簡易判斷） ── */
function detectPatterns(data) {
  const patterns = [];
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const bodyRatio = Math.abs(last.close - last.open) / (last.high - last.low + 0.001);
  if (bodyRatio < 0.2) patterns.push({ name: '十字線', desc: '市場猶豫，趨勢可能反轉', color: 'var(--orange)' });
  if (last.close > last.open && (last.open - last.low) > 2 * Math.abs(last.close - last.open)) {
    patterns.push({ name: '鎚頭線', desc: '下影線長，可能底部支撐', color: 'var(--up)' });
  }
  if (prev.close < prev.open && last.close > last.open && last.close > prev.open && last.open < prev.close) {
    patterns.push({ name: '看漲吞噬', desc: '多頭強力反攻，注意量能確認', color: 'var(--up)' });
  }
  if (patterns.length === 0) {
    patterns.push({ name: '趨勢延續', desc: '無明顯反轉型態', color: 'var(--text2)' });
  }
  return patterns;
}

function renderPatternList(code) {
  const el = document.getElementById('pattern-list');
  if (!el) return;
  const data = genKbarData(code);
  const patterns = detectPatterns(data);
  el.innerHTML = patterns.map(p => `
    <div class="pattern-item">
      <span style="color:${p.color};font-weight:600;">${p.name}</span>
      <span style="color:var(--text2)">${p.desc}</span>
    </div>`).join('');
}

/* ─────────────────────────────────────────
   BUG-009 修正：loadStrategyCard 同步刷新 K棒
   BUG-017 修正：策略卡包含壓力位欄位
───────────────────────────────────────── */
function loadStrategyCard(code) {
  const card = strategyCards[code] || strategyCards['2330'];

  const titleEl  = document.getElementById('strategy-stock-title');
  const signalEl = document.getElementById('strategy-signal');
  const gridEl   = document.getElementById('strategy-grid');
  const kbarLabel = document.getElementById('kbar-stock-label');

  if (titleEl)  titleEl.textContent  = `${code} ${card.name}`;
  if (signalEl) { signalEl.textContent = card.signal; signalEl.className = `badge ${card.signalClass}`; }
  if (gridEl) {
    gridEl.innerHTML = card.items.map(item => `
      <div class="strategy-item">
        <div class="strategy-label">${item.label}</div>
        <div class="strategy-value">${item.value}</div>
        <div class="strategy-sub">${item.sub}</div>
      </div>`).join('');
  }
  if (kbarLabel) kbarLabel.textContent = `${code} ${card.name} ─ 近 30 日`;

  // BUG-009 修正：同步刷新 K棒圖
  initKbar(code);
  renderPatternList(code);
}

async function initKbar(code) {
  const canvas = document.getElementById('kbarChart');
  if (!canvas) return;

  // 嘗試從 API 取真實日線
  try {
    const result = await API.getStockHistory(code, 1);
    if (result?.candles && result.candles.length > 0) {
      drawCandlestick(canvas, result.candles.slice(-30));
      return;
    }
  } catch (e) { console.warn('[M4] API K棒失敗，使用 mock', e); }

  // 降級：產生模擬資料
  drawCandlestick(canvas, genKbarData(code));
}

function initStrategy() {
  const sel = document.getElementById('strategy-stock-select');
  const defaultCode = sel ? sel.value : '2330';
  loadStrategyCard(defaultCode);
}
