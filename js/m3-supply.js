/**
 * m3-supply.js — 產業鏈地圖
 * BUG-001 修正：補齊全部 5 條產業鏈資料（原只有 GPU_AI）
 */

'use strict';

/* ─────────────────────────────────────────
   5 條產業鏈完整定義
───────────────────────────────────────── */
const chains = {
  GPU_AI: {
    title: 'GPU / AI Server 供應鏈',
    nodes: [
      { id: 'nvda',  label: 'NVIDIA',   x: 0.12, y: 0.50, type: 'us',   color: '#76b900' },
      { id: 'tsmc',  label: '台積電\n2330', x: 0.30, y: 0.30, type: 'tw', color: '#58a6ff' },
      { id: 'aoi',   label: '日月光\n3711', x: 0.50, y: 0.20, type: 'tw', color: '#58a6ff' },
      { id: 'delta', label: '台達電\n2308', x: 0.50, y: 0.50, type: 'tw', color: '#58a6ff' },
      { id: 'qbig',  label: '廣達\n2382',  x: 0.70, y: 0.35, type: 'tw', color: '#3fb950' },
      { id: 'wiwynn',label: '緯穎\n6669',  x: 0.70, y: 0.65, type: 'tw', color: '#3fb950' },
      { id: 'dc',    label: '資料中心',    x: 0.88, y: 0.50, type: 'end', color: '#e3b341' },
    ],
    edges: [
      ['nvda','tsmc'],['nvda','aoi'],['nvda','delta'],
      ['tsmc','aoi'],['aoi','qbig'],['delta','qbig'],
      ['delta','wiwynn'],['qbig','dc'],['wiwynn','dc'],
    ]
  },
  Memory: {
    title: 'Memory / HBM 供應鏈',
    nodes: [
      { id: 'sk',    label: 'SK Hynix',  x: 0.12, y: 0.35, type: 'us',  color: '#ee82ee' },
      { id: 'sam',   label: 'Samsung',   x: 0.12, y: 0.65, type: 'us',  color: '#1c9bf0' },
      { id: 'tsmc2', label: '台積電\n2330', x: 0.32, y: 0.50, type: 'tw', color: '#58a6ff' },
      { id: 'nanya', label: '南亞科\n2408', x: 0.52, y: 0.25, type: 'tw', color: '#3fb950' },
      { id: 'winb',  label: '華邦電\n2344', x: 0.52, y: 0.50, type: 'tw', color: '#3fb950' },
      { id: 'psmc',  label: '力積電\n6770', x: 0.52, y: 0.75, type: 'tw', color: '#3fb950' },
      { id: 'hbm',   label: 'HBM 模組',   x: 0.75, y: 0.50, type: 'end', color: '#e3b341' },
      { id: 'ai_g',  label: 'AI GPU',     x: 0.90, y: 0.50, type: 'end', color: '#f85149' },
    ],
    edges: [
      ['sk','tsmc2'],['sam','tsmc2'],
      ['tsmc2','nanya'],['tsmc2','winb'],['tsmc2','psmc'],
      ['nanya','hbm'],['winb','hbm'],['psmc','hbm'],['hbm','ai_g'],
    ]
  },
  CPO: {
    title: 'CPO 共封裝光學供應鏈',
    nodes: [
      { id: 'intel', label: 'Intel',     x: 0.12, y: 0.30, type: 'us',  color: '#0071c5' },
      { id: 'brd',   label: 'Broadcom',  x: 0.12, y: 0.70, type: 'us',  color: '#cc0000' },
      { id: 'tsmc3', label: '台積電\n2330', x: 0.30, y: 0.50, type: 'tw', color: '#58a6ff' },
      { id: 'liqtech',label:'亞光\n3019', x: 0.52, y: 0.30, type: 'tw', color: '#3fb950' },
      { id: 'ii6',   label: '新光電\n2034',x: 0.52, y: 0.60, type: 'tw', color: '#3fb950' },
      { id: 'yageo', label: '國巨\n2327', x: 0.72, y: 0.45, type: 'tw', color: '#3fb950' },
      { id: 'switch',label: '光交換器',   x: 0.88, y: 0.50, type: 'end', color: '#e3b341' },
    ],
    edges: [
      ['intel','tsmc3'],['brd','tsmc3'],
      ['tsmc3','liqtech'],['tsmc3','ii6'],
      ['liqtech','yageo'],['ii6','yageo'],['yageo','switch'],
    ]
  },
  Cooling: {
    title: '散熱 供應鏈',
    nodes: [
      { id: 'amd',   label: 'AMD',       x: 0.12, y: 0.40, type: 'us',  color: '#ed1c24' },
      { id: 'nvda2', label: 'NVIDIA',    x: 0.12, y: 0.65, type: 'us',  color: '#76b900' },
      { id: 'delta2',label: '台達電\n2308',x: 0.35, y: 0.30, type: 'tw', color: '#58a6ff' },
      { id: 'avc',   label: '奇鋐\n3017', x: 0.35, y: 0.60, type: 'tw', color: '#3fb950' },
      { id: 'cpc',   label: '超眾\n6230', x: 0.57, y: 0.30, type: 'tw', color: '#3fb950' },
      { id: 'fuji',  label: '雙鴻\n3324', x: 0.57, y: 0.60, type: 'tw', color: '#3fb950' },
      { id: 'immersion',label:'液冷模組',  x: 0.80, y: 0.50, type: 'end', color: '#e3b341' },
      { id: 'dc2',   label: '資料中心',   x: 0.93, y: 0.50, type: 'end', color: '#f85149' },
    ],
    edges: [
      ['amd','delta2'],['nvda2','delta2'],['nvda2','avc'],
      ['delta2','cpc'],['avc','cpc'],['avc','fuji'],
      ['cpc','immersion'],['fuji','immersion'],['immersion','dc2'],
    ]
  },
  PCB: {
    title: 'PCB 印刷電路板供應鏈',
    nodes: [
      { id: 'ttm',   label: 'TTM Tech',  x: 0.12, y: 0.35, type: 'us',  color: '#555' },
      { id: 'ibm',   label: 'IBM',       x: 0.12, y: 0.65, type: 'us',  color: '#1f70c1' },
      { id: 'ttai',  label: '台光電\n2383',x: 0.32, y: 0.25, type: 'tw', color: '#58a6ff' },
      { id: 'gold',  label: '金寶\n2312', x: 0.32, y: 0.55, type: 'tw', color: '#3fb950' },
      { id: 'unimicron',label:'欣興\n3037',x: 0.54, y: 0.35, type: 'tw', color: '#3fb950' },
      { id: 'zhen',  label: '臻鼎\n4958', x: 0.54, y: 0.65, type: 'tw', color: '#3fb950' },
      { id: 'ic_sub',label: 'IC 載板',   x: 0.75, y: 0.50, type: 'end', color: '#e3b341' },
      { id: 'pkg',   label: '封裝測試',   x: 0.90, y: 0.50, type: 'end', color: '#f85149' },
    ],
    edges: [
      ['ttm','ttai'],['ibm','ttai'],['ibm','gold'],
      ['ttai','unimicron'],['gold','unimicron'],['gold','zhen'],
      ['unimicron','ic_sub'],['zhen','ic_sub'],['ic_sub','pkg'],
    ]
  }
};

let currentChain = 'GPU_AI';

/* ─────────────────────────────────────────
   BUG-001 修正：selectChain 支援 5 個鍵值
───────────────────────────────────────── */
function selectChain(key, el) {
  document.querySelectorAll('.chain-btn').forEach(b => {
    b.className = 'btn btn-ghost btn-sm chain-btn';
  });
  el.className = 'btn btn-primary btn-sm chain-btn active-chain';
  currentChain = key;
  loadChain(key);
}

function loadChain(key) {
  const chain = chains[key];
  if (!chain) return;
  renderChainSVG(chain);
}

/* ─────────────────────────────────────────
   SVG 節點連線圖
───────────────────────────────────────── */
function renderChainSVG(chain) {
  const svg = document.getElementById('chain-svg');
  if (!svg) return;
  const W = svg.clientWidth || 800;
  const H = 420;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';

  // 建立 id → 像素座標 對照
  const pos = {};
  chain.nodes.forEach(n => { pos[n.id] = { x: n.x * W, y: n.y * H }; });

  // 繪製連線
  chain.edges.forEach(([a, b]) => {
    const pa = pos[a], pb = pos[b];
    if (!pa || !pb) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', pa.x); line.setAttribute('y1', pa.y);
    line.setAttribute('x2', pb.x); line.setAttribute('y2', pb.y);
    line.setAttribute('stroke', '#30363d');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('marker-end', 'url(#arrow)');
    svg.appendChild(line);
  });

  // 箭頭 marker
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `<marker id="arrow" markerWidth="6" markerHeight="6"
    refX="5" refY="3" orient="auto">
    <path d="M0,0 L0,6 L6,3 z" fill="#484f58"/>
  </marker>`;
  svg.insertBefore(defs, svg.firstChild);

  // 繪製節點
  const typeRadius = { us: 30, tw: 28, end: 32 };
  chain.nodes.forEach(n => {
    const { x, y } = pos[n.id];
    const r = typeRadius[n.type] || 28;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x); circle.setAttribute('cy', y);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', n.color + '22');
    circle.setAttribute('stroke', n.color);
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);

    // 多行文字
    const lines = n.label.split('\n');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x); text.setAttribute('y', y - (lines.length - 1) * 7);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#e6edf3');
    text.setAttribute('font-size', '10');
    text.setAttribute('font-weight', '600');
    lines.forEach((line, i) => {
      const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.setAttribute('x', x);
      tspan.setAttribute('dy', i === 0 ? 0 : 13);
      tspan.textContent = line;
      text.appendChild(tspan);
    });
    svg.appendChild(text);
  });

  // 標題
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  title.setAttribute('x', 12); title.setAttribute('y', 22);
  title.setAttribute('fill', '#8b949e'); title.setAttribute('font-size', '12');
  title.textContent = chain.title;
  svg.appendChild(title);
}

/* ─────────────────────────────────────────
   事前佈局訊號卡
───────────────────────────────────────── */
const signalData = [
  { code: '3711', name: '日月光', reason: 'CoWoS 封裝需求激增，月增 +25%', strength: 3, type: 'buy' },
  { code: '3017', name: '奇鋐',   reason: '液冷散熱新訂單確認，法人連買', strength: 2, type: 'buy' },
  { code: '6230', name: '超眾',   reason: 'AI 伺服器熱管需求旺季提前', strength: 2, type: 'buy' },
  { code: '2034', name: '新光電', reason: 'CPO 認證延遲，短期觀望', strength: 1, type: 'watch' },
];

function renderSignals() {
  const el = document.getElementById('preposition-signals');
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
