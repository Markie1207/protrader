/**
 * m4-strategy.js — 交易策略篩選器
 * 6 種規則篩股策略，取代下拉選單
 * 點擊策略卡 → 顯示篩選條件 + 符合股票清單 + K棒辨識
 */

'use strict';

/* ── 6 種篩股策略定義 ── */
const screeners = [
  {
    id: 'momentum',
    name: '動能突破',
    icon: '🚀',
    desc: '股價突破近期壓力，量能同步放大',
    rules: [
      '收盤突破 MA20 且站穩',
      '成交量 > 20 日均量 × 1.5 倍',
      '外資連買 ≥ 2 日',
      '近 5 日漲幅 > +3%',
    ],
    badge: '熱門', badgeClass: 'badge-red',
    stocks: [
      { code: '2330', name: '台積電', signal: 'MA20 站穩突破', score: 92 },
      { code: '3711', name: '日月光', signal: '量價齊揚',       score: 88 },
      { code: '2454', name: '聯發科', signal: '外資連買 6 日',  score: 85 },
      { code: '6669', name: '緯穎',   signal: '突破前高整理區', score: 81 },
      { code: '2382', name: '廣達',   signal: '伺服器題材爆發', score: 78 },
    ],
  },
  {
    id: 'institutional',
    name: '法人買超',
    icon: '🏦',
    desc: '三大法人連續買超，籌碼穩定轉強',
    rules: [
      '外資連買 ≥ 3 日',
      '投信近 5 日淨買超 > +1 億',
      '自營商避險部位增加',
      '融券比率 < 2%',
    ],
    badge: '穩健', badgeClass: 'badge-blue',
    stocks: [
      { code: '2330', name: '台積電', signal: '外資連買 8 日', score: 94 },
      { code: '2308', name: '台達電', signal: '投信持續加碼',  score: 87 },
      { code: '3711', name: '日月光', signal: '三大法人全買',  score: 84 },
      { code: '2049', name: '上銀',   signal: '外資轉多頭',   score: 80 },
    ],
  },
  {
    id: 'breakout',
    name: '箱型突破',
    icon: '📦',
    desc: '盤整後向上突破，短線爆發機會大',
    rules: [
      '突破近 30 日盤整高點',
      '當日成交量 > 5,000 張',
      '收盤創近 20 日新高',
      '連續 3 日上漲',
    ],
    badge: '短線', badgeClass: 'badge-yellow',
    stocks: [
      { code: '2049', name: '上銀',   signal: '突破 90 日整理', score: 89 },
      { code: '6230', name: '超眾',   signal: '量增向上突破',   score: 86 },
      { code: '3017', name: '奇鋐',   signal: '箱型頂部攻堅',  score: 82 },
      { code: '4966', name: '譜瑞',   signal: '連 3 紅放量',   score: 79 },
      { code: '3037', name: '欣興',   signal: '季線向上穿越',  score: 76 },
    ],
  },
  {
    id: 'chips',
    name: '籌碼集中',
    icon: '💎',
    desc: '外資 / 主力持續吸籌，散戶退出',
    rules: [
      '外資持股比例週增 > +0.5%',
      '三大法人合計買超 > +5 億',
      '散戶周轉率降低',
      '集保戶數減少（集中信號）',
    ],
    badge: '中長線', badgeClass: 'badge-green',
    stocks: [
      { code: '2330', name: '台積電', signal: '外資持股 71%',   score: 96 },
      { code: '2454', name: '聯發科', signal: '投信持續加碼',   score: 90 },
      { code: '2308', name: '台達電', signal: '籌碼高度集中',   score: 86 },
      { code: '3711', name: '日月光', signal: '外資近歷史高',   score: 83 },
    ],
  },
  {
    id: 'reversal',
    name: '超跌反彈',
    icon: '🔄',
    desc: 'RSI 超賣後回升，KD 黃金交叉訊號',
    rules: [
      'RSI(14) 從 < 30 回升突破 30',
      'KD 黃金交叉（%K 上穿 %D）',
      '乖離率 < −8% 收斂中',
      '外資由賣轉中性',
    ],
    badge: '反彈', badgeClass: 'badge-purple',
    stocks: [
      { code: '2303', name: '聯電',    signal: 'RSI 從 26 回升', score: 77 },
      { code: '2317', name: '鴻海',    signal: 'KD 黃金交叉',    score: 74 },
      { code: '3576', name: '聯合再生', signal: '乖離率收斂',    score: 71 },
      { code: '2344', name: '華邦電',  signal: '季線支撐反彈',   score: 68 },
    ],
  },
  {
    id: 'catalyst',
    name: '業績題材',
    icon: '📊',
    desc: '近期法說 / 財報 / 新品即將催化',
    rules: [
      'EPS 年增率 > +20%',
      '下季法說或財報日近 1 個月內',
      '分析師近 30 日上調評等 ≥ 2 家',
      '月營收連 3 個月 YoY > +15%',
    ],
    badge: '基本面', badgeClass: 'badge-blue',
    stocks: [
      { code: '2330', name: '台積電', signal: 'Q2 EPS +35% 預估', score: 95 },
      { code: '2454', name: '聯發科', signal: '法說日即將到來',    score: 88 },
      { code: '6669', name: '緯穎',   signal: '月營收連創新高',    score: 85 },
      { code: '3711', name: '日月光', signal: '年增 +28%',         score: 82 },
      { code: '2382', name: '廣達',   signal: 'AI 伺服器拉貨旺',  score: 79 },
    ],
  },
];

let currentScreener = null;

/* ─────────────────────────────────────────
   渲染策略選擇卡
───────────────────────────────────────── */
function renderScreenerCards() {
  const container = document.getElementById('screener-cards');
  if (!container) return;
  container.innerHTML = screeners.map(s => {
    const isActive = currentScreener?.id === s.id;
    return `
    <div onclick="selectScreener('${s.id}')"
         style="background:var(--bg3);border-radius:10px;padding:14px;cursor:pointer;
                border:1.5px solid ${isActive ? 'var(--blue)' : 'var(--border)'};
                transition:border-color .15s,transform .1s;
                ${isActive ? 'transform:translateY(-2px);' : ''}">
      <div style="font-size:22px;margin-bottom:6px;">${s.icon}</div>
      <div style="font-weight:700;font-size:13px;color:${isActive ? 'var(--blue)' : 'var(--text)'};
                  margin-bottom:4px;">${s.name}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px;line-height:1.4;">${s.desc}</div>
      <span class="badge ${s.badgeClass}">${s.badge}</span>
    </div>`;
  }).join('');
}

/* ─────────────────────────────────────────
   選取策略
───────────────────────────────────────── */
function selectScreener(id) {
  currentScreener = screeners.find(s => s.id === id) || null;
  if (!currentScreener) return;
  renderScreenerCards();
  renderScreenerDetail(currentScreener);
}

/* ─────────────────────────────────────────
   渲染篩選條件 + 股票清單
───────────────────────────────────────── */
function renderScreenerDetail(screener) {
  const titleEl  = document.getElementById('strategy-stock-title');
  const sigEl    = document.getElementById('strategy-signal');
  const rulesEl  = document.getElementById('screener-rules');
  const gridEl   = document.getElementById('strategy-grid');

  if (titleEl) titleEl.textContent = `${screener.icon} ${screener.name}`;
  if (sigEl)   { sigEl.textContent = screener.badge; sigEl.className = `badge ${screener.badgeClass}`; }

  /* Rules */
  if (rulesEl) {
    rulesEl.innerHTML = `
      <div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px;letter-spacing:.5px;">
        篩選條件
      </div>
      ${screener.rules.map(r => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;
                    border-bottom:1px solid var(--bg3);">
          <span style="color:var(--green);font-size:11px;flex-shrink:0;">✓</span>
          <span>${r}</span>
        </div>`).join('')}`;
  }

  /* Stock list */
  if (gridEl) {
    gridEl.innerHTML = `
      <div style="font-size:11px;color:var(--text2);font-weight:600;margin:12px 0 8px;letter-spacing:.5px;">
        符合條件 — ${screener.stocks.length} 檔
      </div>
      ${screener.stocks.map(s => `
        <div onclick="loadStockKbar('${s.code}','${s.name}')"
             style="display:flex;justify-content:space-between;align-items:center;
                    padding:10px 12px;background:var(--bg3);border-radius:8px;
                    margin-bottom:6px;cursor:pointer;
                    border:1px solid var(--border);transition:border-color .15s;"
             onmouseenter="this.style.borderColor='var(--blue)'"
             onmouseleave="this.style.borderColor='var(--border)'">
          <div>
            <div style="font-weight:700;font-size:13px;">
              ${s.code} <span style="color:var(--text2);font-weight:400;">${s.name}</span>
            </div>
            <div style="font-size:11px;color:var(--blue);margin-top:2px;">${s.signal}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:20px;font-weight:700;
                        color:${s.score >= 85 ? 'var(--up)' : s.score >= 70 ? 'var(--orange)' : 'var(--text2)'};">
              ${s.score}
            </div>
            <div style="font-size:10px;color:var(--text3);">評分</div>
          </div>
        </div>`).join('')}`;

    /* Default: load K-bar for first stock */
    if (screener.stocks.length > 0) {
      const first = screener.stocks[0];
      loadStockKbar(first.code, first.name);
    }
  }
}

/* ─────────────────────────────────────────
   載入個股 K 棒
───────────────────────────────────────── */
function loadStockKbar(code, name) {
  const kbarLabel = document.getElementById('kbar-stock-label');
  if (kbarLabel) kbarLabel.textContent = `${code} ${name} — 近 30 日`;
  initKbar(code);
  renderPatternList(code);
}

/* ── K棒模擬資料（OHLC）── */
function genKbarData(code) {
  const basePrices = {
    '2330': 1000, '2317': 105, '2308': 290,
    '3711': 150,  '2303': 46,  '2454': 800,
    '6669': 1200, '2382': 250, '2049': 320,
    '6230': 180,  '3017': 190, '4966': 560,
    '3037': 180,  '2344': 22,  '3576': 35,
  };
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
   Canvas K棒（真實 OHLC：影線 + 實體）
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

  const allPrices = data.flatMap(d => [d.high, d.low]);
  const minP  = Math.min(...allPrices);
  const maxP  = Math.max(...allPrices);
  const range = maxP - minP || 1;

  const yOf     = v => PAD_T + chartH - ((v - minP) / range) * chartH;
  const candleW = Math.max(2, (chartW / data.length) * 0.6);
  const step    = chartW / data.length;

  ctx.strokeStyle = '#21262d';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD_T + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
  }

  data.forEach((d, i) => {
    const x     = PAD_L + step * i + step / 2;
    const isUp  = d.close >= d.open;
    const color = isUp ? '#f85149' : '#3fb950';

    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, yOf(d.high));
    ctx.lineTo(x, yOf(d.low));
    ctx.stroke();

    const bodyTop = yOf(Math.max(d.open, d.close));
    const bodyBot = yOf(Math.min(d.open, d.close));
    const bodyH   = Math.max(1.5, bodyBot - bodyTop);
    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  });

  const last = data[data.length - 1];
  ctx.fillStyle = '#8b949e';
  ctx.font      = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(last.close.toFixed(1), W - PAD_R, PAD_T - 1);
}

/* ── K棒型態辨識 ── */
function detectPatterns(data) {
  const patterns = [];
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const bodyRatio = Math.abs(last.close - last.open) / (last.high - last.low + 0.001);
  if (bodyRatio < 0.2)
    patterns.push({ name: '十字線', desc: '市場猶豫，趨勢可能反轉', color: 'var(--orange)' });
  if (last.close > last.open && (last.open - last.low) > 2 * Math.abs(last.close - last.open))
    patterns.push({ name: '鎚頭線', desc: '下影線長，可能底部支撐', color: 'var(--up)' });
  if (prev && prev.close < prev.open && last.close > last.open &&
      last.close > prev.open && last.open < prev.close)
    patterns.push({ name: '看漲吞噬', desc: '多頭強力反攻，注意量能確認', color: 'var(--up)' });
  if (patterns.length === 0)
    patterns.push({ name: '趨勢延續', desc: '無明顯反轉型態', color: 'var(--text2)' });
  return patterns;
}

function renderPatternList(code) {
  const el = document.getElementById('pattern-list');
  if (!el) return;
  const data     = genKbarData(code);
  const patterns = detectPatterns(data);
  el.innerHTML   = patterns.map(p => `
    <div class="pattern-item">
      <span style="color:${p.color};font-weight:600;">${p.name}</span>
      <span style="color:var(--text2)">${p.desc}</span>
    </div>`).join('');
}

async function initKbar(code) {
  const canvas = document.getElementById('kbarChart');
  if (!canvas) return;
  try {
    const result = await API.getStockHistory(code, 1);
    if (result?.candles && result.candles.length > 0) {
      drawCandlestick(canvas, result.candles.slice(-30));
      return;
    }
  } catch (e) { /* 降級使用 mock */ }
  drawCandlestick(canvas, genKbarData(code));
}

/* ─────────────────────────────────────────
   初始化
───────────────────────────────────────── */
function initStrategy() {
  renderScreenerCards();
  selectScreener('momentum');
}
