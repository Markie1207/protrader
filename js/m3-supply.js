/**
 * m3-supply.js — 產業鏈地圖
 * 10 條熱門產業鏈，上游 / 中游 / 下游 欄位式 SVG 顯示
 */

'use strict';

/* ─────────────────────────────────────────
   10 條產業鏈定義（上游 / 中游 / 下游）
   hot: true → 節點高亮標示
───────────────────────────────────────── */
const chains = {

  GPU_AI: {
    title: 'GPU / AI Server 供應鏈',
    upstream: [
      { code: 'NVDA', name: 'NVIDIA',  role: 'GPU 設計',    type: 'us' },
      { code: 'AMD',  name: 'AMD',     role: 'AI 加速器',   type: 'us' },
      { code: 'MRVL', name: 'Marvell', role: 'DPU/網路IC',  type: 'us' },
    ],
    midstream: [
      { code: '2330', name: '台積電', role: 'CoWoS 封裝',  hot: true },
      { code: '3711', name: '日月光', role: '先進封裝',     hot: true },
      { code: '2308', name: '台達電', role: '電源模組' },
      { code: '2383', name: '台光電', role: '高速 ABF 基板' },
      { code: '3037', name: '欣興',   role: 'ABF 載板' },
    ],
    downstream: [
      { code: '2382', name: '廣達',   role: 'AI 伺服器',   hot: true },
      { code: '6669', name: '緯穎',   role: 'CSP 伺服器' },
      { code: '3231', name: '緯創',   role: '機架系統' },
      { code: '2356', name: '英業達', role: '伺服器代工' },
    ],
  },

  Memory: {
    title: 'HBM / 記憶體供應鏈',
    upstream: [
      { code: 'SKH', name: 'SK Hynix', role: 'HBM 主導',  type: 'kr' },
      { code: 'SAM', name: 'Samsung',  role: 'DRAM 製造', type: 'kr' },
      { code: 'MU',  name: 'Micron',   role: 'HBM3E',     type: 'us' },
    ],
    midstream: [
      { code: '2330', name: '台積電', role: 'HBM3 CoWoS 封裝', hot: true },
      { code: '2408', name: '南亞科', role: 'DRAM 製造' },
      { code: '2344', name: '華邦電', role: 'NOR Flash' },
      { code: '6770', name: '力積電', role: '特殊記憶體' },
    ],
    downstream: [
      { code: '3711', name: '日月光', role: 'HBM 模組封裝', hot: true },
      { code: '2337', name: '旺宏',   role: 'Flash 應用' },
      { code: '2454', name: '聯發科', role: 'AI 晶片客戶' },
    ],
  },

  CPO: {
    title: 'CPO 共封裝光學供應鏈',
    upstream: [
      { code: 'INTC', name: 'Intel',    role: 'CPO 規格制定', type: 'us' },
      { code: 'AVGO', name: 'Broadcom', role: '光子 IC',      type: 'us' },
    ],
    midstream: [
      { code: '2330', name: '台積電', role: '光電共封裝',  hot: true },
      { code: '3019', name: '亞光',   role: '光收發模組' },
      { code: '2034', name: '新光電', role: '光纖陣列' },
      { code: '3714', name: '富采',   role: '雷射晶粒' },
      { code: '4966', name: '譜瑞',   role: '高速 SerDes', hot: true },
    ],
    downstream: [
      { code: '6669', name: '緯穎',   role: '光交換系統', hot: true },
      { code: '2327', name: '國巨',   role: '被動元件' },
      { code: '2382', name: '廣達',   role: '超高速網路交換機' },
    ],
  },

  Cooling: {
    title: '液冷 / AI 散熱供應鏈',
    upstream: [
      { code: 'NVDA', name: 'NVIDIA', role: 'GPU 熱設計規格', type: 'us' },
      { code: 'AMD',  name: 'AMD',    role: 'CPU 熱設計規格', type: 'us' },
    ],
    midstream: [
      { code: '3017', name: '奇鋐',   role: '液冷 / 散熱模組', hot: true },
      { code: '6230', name: '超眾',   role: '均熱片 / 熱管',   hot: true },
      { code: '3324', name: '雙鴻',   role: '液冷板' },
      { code: '2308', name: '台達電', role: '冷卻系統整合' },
    ],
    downstream: [
      { code: '2382', name: '廣達',   role: 'AI 伺服器整合' },
      { code: '2356', name: '英業達', role: '伺服器散熱整合' },
      { code: '6669', name: '緯穎',   role: 'CSP 液冷機架' },
    ],
  },

  PCB: {
    title: 'PCB / IC 載板供應鏈',
    upstream: [
      { code: 'AJIN', name: '味之素',   role: 'ABF 膜材',  type: 'jp' },
      { code: 'SMUI', name: 'Sumitomo', role: 'CCL 原料',  type: 'jp' },
    ],
    midstream: [
      { code: '2383', name: '台光電', role: 'ABF 載板材',  hot: true },
      { code: '3037', name: '欣興',   role: 'ABF 載板',    hot: true },
      { code: '4958', name: '臻鼎',   role: 'HDI 軟板' },
      { code: '2312', name: '金寶',   role: 'PCB 組裝' },
    ],
    downstream: [
      { code: '3711', name: '日月光', role: '封裝測試',   hot: true },
      { code: '2330', name: '台積電', role: '先進製程客戶' },
      { code: '2303', name: '聯電',   role: 'IC 客戶' },
    ],
  },

  Robot: {
    title: '人形機器人供應鏈',
    upstream: [
      { code: 'TSLA', name: 'Tesla',     role: 'Optimus 主導', type: 'us' },
      { code: 'FIGR', name: 'Figure AI', role: '人形機器人',   type: 'us' },
      { code: 'BDNC', name: 'Boston Dyn',role: '機器人技術',   type: 'us' },
    ],
    midstream: [
      { code: '2049', name: '上銀',   role: '精密滾珠螺桿', hot: true },
      { code: '2454', name: '聯發科', role: 'AI 邊緣運算',  hot: true },
      { code: '1537', name: '廣隆',   role: '伺服馬達' },
      { code: '2059', name: '川湖',   role: '精密傳動件' },
      { code: '1590', name: '亞德客', role: '氣動元件' },
    ],
    downstream: [
      { code: '2382', name: '廣達',   role: '機器人整機組裝' },
      { code: '2317', name: '鴻海',   role: '機器人代工', hot: true },
      { code: '6213', name: '聯茂',   role: '關節 PCB' },
    ],
  },

  EV: {
    title: '電動車 / 車用電子供應鏈',
    upstream: [
      { code: 'TSLA', name: 'Tesla', role: 'EV 整車',   type: 'us' },
      { code: 'BYD',  name: 'BYD',   role: 'EV 整車',   type: 'cn' },
      { code: 'NIO',  name: 'NIO',   role: '智慧電動車', type: 'cn' },
    ],
    midstream: [
      { code: '2330', name: '台積電', role: '車用晶片代工', hot: true },
      { code: '2454', name: '聯發科', role: '車用 SoC' },
      { code: '6278', name: '台表科', role: '車用 MLCC' },
      { code: '2327', name: '國巨',   role: '車用被動元件' },
    ],
    downstream: [
      { code: '2308', name: '台達電', role: '車載電源 / OBC', hot: true },
      { code: '3044', name: '健鼎',   role: '車用 PCB' },
      { code: '2204', name: '中華汽車',role: '電動商用車' },
    ],
  },

  Solar: {
    title: '太陽能 / 儲能供應鏈',
    upstream: [
      { code: 'ENPH', name: 'Enphase',    role: '微型逆變器',  type: 'us' },
      { code: 'FSLR', name: 'First Solar', role: '薄膜電池',   type: 'us' },
    ],
    midstream: [
      { code: '3533', name: '嘉澤',    role: '太陽能端子',  hot: true },
      { code: '3452', name: '益通',    role: '太陽能電池' },
      { code: '3576', name: '聯合再生', role: '太陽能模組' },
      { code: '3703', name: '欣弘',    role: '接線盒' },
    ],
    downstream: [
      { code: '2308', name: '台達電', role: '儲能逆變器',  hot: true },
      { code: '1504', name: '東元',   role: '儲能系統' },
      { code: '6592', name: '和潤企業',role: '太陽能租賃' },
    ],
  },

  Satellite: {
    title: '低軌衛星 / 衛星通訊供應鏈',
    upstream: [
      { code: 'SPCX', name: 'SpaceX',    role: 'Starlink 主導', type: 'us' },
      { code: 'AST',  name: 'AST Space',  role: '手機直連衛星',  type: 'us' },
      { code: 'AMZN', name: 'Amazon',     role: 'Kuiper 計畫',   type: 'us' },
    ],
    midstream: [
      { code: '4966', name: '譜瑞',   role: '高速 SerDes IC',  hot: true },
      { code: '5388', name: '中磊',   role: '衛星 CPE 設備' },
      { code: '3484', name: '崇越電', role: '衛星天線元件' },
      { code: '2328', name: '廣輝',   role: 'RF 元件' },
    ],
    downstream: [
      { code: '3045', name: '台灣大', role: '地面站 / 頻寬', hot: true },
      { code: '3706', name: '神達',   role: '衛星定位裝置' },
      { code: '2409', name: '友達',   role: '終端顯示器' },
    ],
  },

  Apple: {
    title: '蘋果供應鏈',
    upstream: [
      { code: 'AAPL', name: 'Apple', role: '系統整合 / 設計', type: 'us' },
    ],
    midstream: [
      { code: '2330', name: '台積電', role: 'A18 Pro 代工',   hot: true },
      { code: '2317', name: '鴻海',   role: 'iPhone 組裝',    hot: true },
      { code: '2474', name: '可成',   role: '金屬機殼' },
      { code: '3008', name: '大立光', role: '鏡頭模組',       hot: true },
      { code: '3034', name: '聯詠',   role: '顯示驅動 IC' },
    ],
    downstream: [
      { code: '2454', name: '聯發科', role: '連接 / Modem IC' },
      { code: '3711', name: '日月光', role: '封裝測試' },
      { code: '2498', name: '宏達電', role: '零組件' },
    ],
  },

};

let currentChain = 'GPU_AI';

/* ─────────────────────────────────────────
   切換產業鏈
───────────────────────────────────────── */
function selectChain(key, el) {
  document.querySelectorAll('.chain-btn').forEach(b => {
    b.className = 'btn btn-ghost btn-sm chain-btn';
  });
  if (el) el.className = 'btn btn-primary btn-sm chain-btn active-chain';
  currentChain = key;
  loadChain(key);
}

function loadChain(key) {
  const chain = chains[key];
  if (!chain) return;
  renderChainSVG(chain);
}

/* ─────────────────────────────────────────
   SVG 輔助
───────────────────────────────────────── */
function _svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

/* ─────────────────────────────────────────
   上 / 中 / 下游 欄位式 SVG 渲染
───────────────────────────────────────── */
function renderChainSVG(chain) {
  const svg = document.getElementById('chain-svg');
  if (!svg) return;

  const W = Math.max(svg.clientWidth || 0, 600);
  const H = 420;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';

  /* --- Arrow  /* --- Arrow marker --- */
  const defs = _svgEl('defs');
  defs.innerHTML = `
    <marker id="arr" markerWidth="7" markerHeight="7"
      refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L7,3.5 z" fill="#484f58"/>
    </marker>`;
  svg.appendChild(defs);

  const LANE_META = [
    { label: '上游', key: 'upstream',   color: '#bc8cff' },
    { label: '中游', key: 'midstream',  color: '#58a6ff' },
    { label: '下游', key: 'downstream', color: '#3fb950' },
  ];
  const ARROW_W = 28;
  const laneW   = (W - ARROW_W * 2) / 3;
  const laneX   = [0, laneW + ARROW_W, laneW * 2 + ARROW_W * 2];

  const HEADER_H = 38;
  const NODE_H   = 40;
  const NODE_GAP = 7;
  const NODE_PAD = 8;

  LANE_META.forEach((lm, li) => {
    const lx    = laneX[li];
    const nodes = chain[lm.key] || [];
    const nodeW = laneW - NODE_PAD * 2;

    const bg = _svgEl('rect');
    bg.setAttribute('x', lx + 3); bg.setAttribute('y', 3);
    bg.setAttribute('width', laneW - 6); bg.setAttribute('height', H - 6);
    bg.setAttribute('rx', '8');
    bg.setAttribute('fill', lm.color + '0b');
    bg.setAttribute('stroke', lm.color + '35');
    bg.setAttribute('stroke-width', '1');
    svg.appendChild(bg);

    const hdr = _svgEl('text');
    hdr.setAttribute('x', lx + laneW / 2); hdr.setAttribute('y', 24);
    hdr.setAttribute('text-anchor', 'middle');
    hdr.setAttribute('fill', lm.color);
    hdr.setAttribute('font-size', '13'); hdr.setAttribute('font-weight', '700');
    hdr.textContent = lm.label;
    svg.appendChild(hdr);

    const totalNodesH = nodes.length * (NODE_H + NODE_GAP) - NODE_GAP;
    const startY = HEADER_H + Math.max(0, (H - HEADER_H - 10 - totalNodesH) / 2);

    nodes.forEach((node, ni) => {
      const nx  = lx + NODE_PAD;
      const ny  = startY + ni * (NODE_H + NODE_GAP);
      const hot = !!node.hot;

      const rect = _svgEl('rect');
      rect.setAttribute('x', nx); rect.setAttribute('y', ny);
      rect.setAttribute('width', nodeW); rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', hot ? lm.color + '28' : '#21262d');
      rect.setAttribute('stroke', hot ? lm.color : lm.color + '45');
      rect.setAttribute('stroke-width', hot ? '1.5' : '1');
      svg.appendChild(rect);

      const isOverseas = ['us','kr','jp','cn'].includes(node.type);
      const label = isOverseas ? node.name : `${node.code} ${node.name}`;
      const nameT = _svgEl('text');
      nameT.setAttribute('x', nx + nodeW / 2); nameT.setAttribute('y', ny + 15);
      nameT.setAttribute('text-anchor', 'middle');
      nameT.setAttribute('fill', hot ? lm.color : '#e6edf3');
      nameT.setAttribute('font-size', '11'); nameT.setAttribute('font-weight', '600');
      nameT.textContent = label;
      svg.appendChild(nameT);

      const roleT = _svgEl('text');
      roleT.setAttribute('x', nx + nodeW / 2); roleT.setAttribute('y', ny + 28);
      roleT.setAttribute('text-anchor', 'middle');
      roleT.setAttribute('fill', '#8b949e'); roleT.setAttribute('font-size', '10');
      roleT.textContent = node.role;
      svg.appendChild(roleT);

      if (hot) {
        const bx = nx + nodeW - 22, by = ny + 3;
        const br = _svgEl('rect');
        br.setAttribute('x', bx); br.setAttribute('y', by);
        br.setAttribute('width', '19'); br.setAttribute('height', '13');
        br.setAttribute('rx', '3'); br.setAttribute('fill', lm.color);
        svg.appendChild(br);
        const bt = _svgEl('text');
        bt.setAttribute('x', bx + 9.5); bt.setAttribute('y', by + 9.5);
        bt.setAttribute('text-anchor', 'middle');
        bt.setAttribute('fill', '#fff');
        bt.setAttribute('font-size', '8'); bt.setAttribute('font-weight', '700');
        bt.textContent = '熱';
        svg.appendChild(bt);
      }
    });
  });

  for (let i = 0; i < LANE_META.length - 1; i++) {
    const x1 = laneX[i] + laneW;
    const x2 = laneX[i + 1];
    const y  = H / 2;
    const line = _svgEl('line');
    line.setAttribute('x1', x1 + 2); line.setAttribute('y1', y);
    line.setAttribute('x2', x2 - 4); line.setAttribute('y2', y);
    line.setAttribute('stroke', '#484f58'); line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4,3');
    line.setAttribute('marker-end', 'url(#arr)');
    svg.appendChild(line);
    const lbl = _svgEl('text');
    lbl.setAttribute('x', (x1 + x2) / 2); lbl.setAttribute('y', y - 5);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', '#484f58'); lbl.setAttribute('font-size', '9');
    lbl.textContent = '供料';
    svg.appendChild(lbl);
  }

  const titleT = _svgEl('text');
  titleT.setAttribute('x', W / 2); titleT.setAttribute('y', H - 8);
  titleT.setAttribute('text-anchor', 'middle');
  titleT.setAttribute('fill', '#484f58'); titleT.setAttribute('font-size', '10');
  titleT.textContent = chain.title;
  svg.appendChild(titleT);
}

/* ─────────────────────────────────────────
   事前佈局訊號卡
───────────────────────────────────────── */
const signalData = [
  { code: '3711', name: '日月光',  reason: 'CoWoS 封裝需求激增，月增 +25%，外資連買', strength: 3, type: 'buy' },
  { code: '3017', name: '奇鋐',    reason: '液冷散熱新訂單確認，法人連買 5 日',        strength: 3, type: 'buy' },
  { code: '2049', name: '上銀',    reason: '人形機器人訂單能見度提升，機構調升目標',   strength: 2, type: 'buy' },
  { code: '6230', name: '超眾',    reason: 'AI 伺服器熱管需求旺季提前',               strength: 2, type: 'buy' },
  { code: '4966', name: '譜瑞',    reason: 'CPO / 衛星通訊兩頭受惠，近期量增',       strength: 2, type: 'buy' },
  { code: '2034', name: '新光電',  reason: 'CPO 認證延遲，短期觀望',                  strength: 1, type: 'watch' },
];

function renderSignals() {
  const el  = document.getElementById('preposition-signals');
  const cnt = document.getElementById('signal-count');
  if (!el) return;
  const buyCount = signalData.filter(s => s.type === 'buy').length;
  if (cnt) cnt.textContent = `${buyCount} 機會`;
  el.innerHTML = signalData.map(s => `
    <div class="signal-card ${s.type === 'watch' ? 'warn' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:600;">${s.code} ${s.name}</span>
        <span>${'★'.repeat(s.strength)}${'☆'.repeat(3 - s.strength)}</span>
      </div>
      <div style="color:var(--text2)">${s.reason}</div>
    </div>`).join('');
}

function initSupply() {
  loadChain('GPU_AI');
  renderSignals();
}
短期觀望',                 strength: 1, type: 'watch' },
];

function renderSignals() {
  const el  = document.getElementById('preposition-signals');
  const cnt = document.getElementById('signal-count');
  if (!el) return;
  const buyCount = signalData.filter(s => s.type === 'buy').length;
  if (cnt) cnt.textContent = `${buyCount} 機會`;
  el.innerHTML = signalData.map(s => `
    <div class="signal-card ${s.type === 'watch' ? 'warn' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:600;">${s.code} ${s.name}</span>
        <span>${'★'.repeat(s.strength)}${'☆'.repeat(3 - s.strength)}</span>
      </div>
      <div style="color:var(--text2)">${s.reason}</div>
    </div>`).join('');
}

function initSupply() {
  loadChain('GPU_AI');
  renderSignals();
}
