/**
 * m3-supply.js — 產業鏈地圖
 * 42 條產業鏈，資料來自 /industry_map.json
 * 電腦版：D3 force-directed 心智圖
 * 手機版：摺疊卡片（< 768px）
 */

'use strict';

/* ─── State ─── */
let _m3Data   = null;
let _m3Chain  = null;
let _m3Cat    = '全部';
let _m3Sim    = null;

/* ─── Colors ─── */
const _M3C = {
  root:       '#e6edf3',
  upstream:   '#f59e0b',
  midstream:  '#60a5fa',
  downstream: '#94a3b8',
};

/* ═══════════════════════════════════════
   Init
═══════════════════════════════════════ */
async function initSupply() {
  const base = typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '';
  try {
    const res = await fetch(base + '/api/industry-map');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _m3Data = await res.json();
  } catch (e) {
    console.error('[M3] fetch failed:', e);
    const el = document.getElementById('m3-chain-list');
    if (el) el.innerHTML = '<div style="color:var(--red);padding:8px;font-size:12px;">資料載入失敗</div>';
    return;
  }
  _m3RenderCatTabs();
  _m3FilterList('全部');
  if (_m3Data.industries.length > 0) _m3SelectChain(_m3Data.industries[0]);

  // 非同步檢查草稿（不阻塞主流程）
  _m3CheckDraft(base);
}

/* ═══════════════════════════════════════
   草稿審核
═══════════════════════════════════════ */
async function _m3CheckDraft(base) {
  try {
    const res = await fetch(base + '/api/industry-map/draft');
    if (!res.ok) return;
    const status = await res.json();
    if (status.has_draft) _m3ShowDraftBanner(status, base);
  } catch (_) { /* 靜默 */ }
}

function _m3ShowDraftBanner(status, base) {
  const pageEl = document.getElementById('page-supply');
  if (!pageEl) return;

  const banner = document.createElement('div');
  banner.className = 'm3-draft-banner';
  banner.id = 'm3-draft-banner';
  banner.innerHTML = `
    <div>
      <div class="db-info">📋 有新草稿待審核</div>
      <div class="db-meta">Grok 產生於 ${status.generated_at}・共 ${status.total_industries} 條產業鏈・${status.note || ''}</div>
    </div>
    <div class="db-actions">
      <button class="btn btn-sm" style="background:rgba(227,179,65,.2);color:var(--orange);border-color:var(--orange);"
        onclick="_m3ShowDraftDiff('${base}')">查看差異</button>
      <button class="btn btn-primary btn-sm" onclick="_m3ApproveDraft('${base}')">✓ 套用草稿</button>
      <button class="btn btn-ghost btn-sm" onclick="_m3RejectDraft('${base}')">✕ 捨棄</button>
    </div>`;

  // 插入在 section-title 後面
  const title = pageEl.querySelector('.section-title');
  if (title) title.after(banner);
  else pageEl.prepend(banner);
}

async function _m3ShowDraftDiff(base) {
  try {
    const res = await fetch(base + '/api/industry-map/draft/data');
    if (!res.ok) return;
    const draft = await res.json();

    const liveIds  = new Set((_m3Data?.industries || []).map(i => i.id));
    const draftIds = new Set((draft.industries || []).map(i => i.id));
    const added    = [...draftIds].filter(id => !liveIds.has(id));
    const same     = [...draftIds].filter(id => liveIds.has(id));

    const panel = document.createElement('div');
    panel.className = 'm3-draft-panel';
    panel.id = 'm3-draft-panel';
    panel.innerHTML = `
      <h4>草稿內容預覽</h4>
      <div class="m3-diff-grid">
        <div>
          <h5>✅ 既有（${same.length} 條，已更新公司清單）</h5>
          ${same.map(id => {
            const d = draft.industries.find(i => i.id === id);
            return `<div class="m3-diff-item same">${d?.emoji || ''} ${d?.name || id}</div>`;
          }).join('')}
        </div>
        <div>
          <h5>🆕 新增（${added.length} 條）</h5>
          ${added.length ? added.map(id => {
            const d = draft.industries.find(i => i.id === id);
            return `<div class="m3-diff-item added">${d?.emoji || ''} ${d?.name || id}</div>`;
          }).join('') : '<div style="color:var(--text3);font-size:11px;">無新增產業鏈</div>'}
        </div>
      </div>
      <div style="margin-top:10px;text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('m3-draft-panel').remove()">關閉預覽</button>
      </div>`;

    const banner = document.getElementById('m3-draft-banner');
    if (banner) {
      const existing = document.getElementById('m3-draft-panel');
      if (existing) existing.remove();
      banner.after(panel);
    }
  } catch (e) {
    console.error('[M3] 草稿讀取失敗', e);
  }
}

async function _m3ApproveDraft(base) {
  if (!confirm('確定要套用草稿？正式資料將被替換。')) return;
  try {
    const res = await fetch(base + '/api/industry-map/draft/approve', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      alert('草稿已套用！頁面即將重新載入。');
      location.reload();
    } else {
      alert('套用失敗：' + (data.message || '未知錯誤'));
    }
  } catch (e) {
    alert('網路錯誤：' + e.message);
  }
}

async function _m3RejectDraft(base) {
  if (!confirm('確定要捨棄這份草稿？')) return;
  try {
    await fetch(base + '/api/industry-map/draft/reject', { method: 'POST' });
    document.getElementById('m3-draft-banner')?.remove();
    document.getElementById('m3-draft-panel')?.remove();
  } catch (_) { }
}

/* ═══════════════════════════════════════
   Category Tabs
═══════════════════════════════════════ */
const _M3_CAT_SHORT = {
  '全部': '全部',
  'AI / 算力': 'AI/算力',
  '半導體基礎': '半導體',
  '被動元件 / 零組件': '被動元件',
  '散熱 / 熱管理': '散熱',
  '電池 / 儲能': '電池/儲能',
  '電源供應': '電源',
  '系統整機': '系統整機',
  '機器人 / 自動化': '機器人',
  '電動車 / 能源': '電動車/能源',
  '通訊': '通訊',
  '消費電子': '消費電子',
  '其他': '其他',
};

function _m3RenderCatTabs() {
  const el = document.getElementById('m3-cat-tabs');
  if (!el) return;

  const counts = { '全部': _m3Data.industries.length };
  _m3Data.industries.forEach(i => {
    counts[i.category] = (counts[i.category] || 0) + 1;
  });

  const tabs = ['全部', ..._m3Data.meta.categories];
  el.innerHTML = tabs.map(c => {
    const short = _M3_CAT_SHORT[c] || c;
    const cnt   = counts[c] || 0;
    return `<button class="m3-cat-tab${c === '全部' ? ' active' : ''}" onclick="_m3ClickCat('${_m3EscAttr(c)}',this)">${short} ${cnt}</button>`;
  }).join('');
}

function _m3ClickCat(cat, el) {
  document.querySelectorAll('.m3-cat-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _m3Cat = cat;
  _m3FilterList(cat);
}

/* ═══════════════════════════════════════
   Left Sidebar List
═══════════════════════════════════════ */
function _m3FilterList(cat) {
  const list = cat === '全部'
    ? _m3Data.industries
    : _m3Data.industries.filter(i => i.category === cat);

  const el = document.getElementById('m3-chain-list');
  if (!el) return;
  el.innerHTML = list.map(ind =>
    `<div class="m3-chain-item${_m3Chain?.id === ind.id ? ' active' : ''}" onclick="_m3ClickChain('${ind.id}',this)">${ind.emoji} ${ind.name}</div>`
  ).join('');

  if (list.length > 0 && !list.find(i => i.id === _m3Chain?.id)) {
    _m3SelectChain(list[0]);
  }
}

function _m3ClickChain(id, el) {
  document.querySelectorAll('.m3-chain-item').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const chain = _m3Data.industries.find(i => i.id === id);
  if (chain) _m3SelectChain(chain);
}

/* ═══════════════════════════════════════
   Select Chain
═══════════════════════════════════════ */
function _m3SelectChain(chain) {
  _m3Chain = chain;
  _m3RenderChainInfo(chain);
  _m3HideNodeDetail();
  if (window.innerWidth < 768) {
    document.getElementById('m3-mindmap-wrap').innerHTML = '';
    _m3RenderMobileCards(chain);
  } else {
    document.getElementById('m3-mobile-cards').innerHTML = '';
    _m3RenderMindMap(chain);
  }
}

/* ═══════════════════════════════════════
   Chain Info Card
═══════════════════════════════════════ */
function _m3RenderChainInfo(chain) {
  const el = document.getElementById('m3-chain-info');
  if (!el) return;
  el.innerHTML = `
    <div class="ci-name">${chain.emoji} ${chain.name}</div>
    <div class="ci-row">
      <span><span class="ci-label">市場規模：</span>${chain.market_size}</span>
      <span><span class="ci-label">成長率：</span><span style="color:var(--green)">${chain.growth_rate}</span></span>
    </div>
    <div style="margin-bottom:4px;line-height:1.5;"><span class="ci-label">主題：</span>${chain.key_theme}</div>
    <div style="line-height:1.5;"><span style="color:var(--orange);">⚠️ 風險：</span><span style="color:var(--text2)">${chain.key_risk}</span></div>`;
}

/* ═══════════════════════════════════════
   D3 Mind Map（電腦版）
═══════════════════════════════════════ */
function _m3RenderMindMap(chain) {
  if (typeof d3 === 'undefined') {
    document.getElementById('m3-mindmap-wrap').innerHTML =
      '<div style="padding:30px;color:var(--text2);text-align:center;">D3.js 載入中，請稍後重試</div>';
    return;
  }
  if (_m3Sim) { _m3Sim.stop(); _m3Sim = null; }

  const wrap = document.getElementById('m3-mindmap-wrap');
  wrap.innerHTML = '';
  const W = Math.max(wrap.clientWidth || 0, 500);
  const H = 460;

  const svg = d3.select('#m3-mindmap-wrap').append('svg')
    .attr('width', W).attr('height', H)
    .style('background', 'var(--bg3)')
    .style('border-radius', '8px');

  /* arrow marker for relationship links */
  svg.append('defs').append('marker')
    .attr('id', 'm3-arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 24).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#6b7280');

  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.25, 3]).on('zoom', e => g.attr('transform', e.transform)));

  /* ── Legend（固定右上角，不隨縮放移動）── */
  const legendItems = [
    { label: '上游', color: _M3C.upstream },
    { label: '中游', color: _M3C.midstream },
    { label: '下游', color: _M3C.downstream },
  ];
  const lg = svg.append('g').attr('transform', `translate(${W - 10}, 10)`);
  legendItems.forEach((item, i) => {
    const row = lg.append('g').attr('transform', `translate(0, ${i * 18})`);
    row.append('circle').attr('r', 5).attr('cx', -62).attr('cy', 5).attr('fill', item.color);
    row.append('text').attr('x', -54).attr('y', 9)
      .attr('fill', '#94a3b8').attr('font-size', 11)
      .text(item.label);
  });

  /* ── Build nodes ── */
  const nodes = [
    { id: '__root__', name: chain.name, ticker: null, role: '', group: 'root' }
  ];
  const pushGroup = (arr, group) =>
    (arr || []).forEach((item, i) => nodes.push({
      id: `${group}_${i}`,
      name: item.name,
      ticker: item.ticker,
      role: item.role || '',
      group,
    }));
  pushGroup(chain.upstream,   'upstream');
  pushGroup(chain.midstream,  'midstream');
  pushGroup(chain.downstream, 'downstream');

  /* ── Build links ── */
  const links = nodes.slice(1).map(n => ({ source: '__root__', target: n.id }));

  /* relationship links (dashed + arrow) */
  (chain.relationships || []).forEach(r => {
    const relType = r.type || r.role || '';
    const fromKey = (r.from || '').split(' ')[0];
    const toKey   = (r.to   || '').split(' ')[0];
    const src = nodes.find(n => n.group !== 'root' && n.name.includes(fromKey));
    const tgt = nodes.find(n => n.group !== 'root' && n.name.includes(toKey));
    if (src && tgt && src.id !== tgt.id) {
      links.push({ source: src.id, target: tgt.id, rel: relType, isRel: true });
    }
  });

  /* ── Initial positions ── */
  const cx = W / 2, cy = H / 2;
  const groupX = { root: cx, upstream: W * 0.17, midstream: W * 0.5, downstream: W * 0.83 };
  nodes.forEach(n => {
    n.x = groupX[n.group] + (Math.random() - 0.5) * 30;
    n.y = cy + (Math.random() - 0.5) * 80;
  });
  /* fix root at center */
  nodes[0].fx = cx;
  nodes[0].fy = cy;

  /* ── Force simulation ── */
  _m3Sim = d3.forceSimulation(nodes)
    .force('link',    d3.forceLink(links).id(d => d.id).distance(d => d.isRel ? 90 : 105).strength(0.55))
    .force('charge',  d3.forceManyBody().strength(-240))
    .force('x',       d3.forceX(d => groupX[d.group] || cx).strength(0.42))
    .force('y',       d3.forceY(cy).strength(0.08))
    .force('collide', d3.forceCollide(40));

  /* ── Draw links ── */
  const linkSel = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', d => d.isRel ? '#4b5563' : '#2d333b')
    .attr('stroke-width', d => d.isRel ? 1.5 : 1)
    .attr('stroke-dasharray', d => d.isRel ? '5,3' : '3,2')
    .attr('marker-end', d => d.isRel ? 'url(#m3-arrow)' : null);

  const relLabelSel = g.append('g')
    .selectAll('text')
    .data(links.filter(d => d.isRel))
    .join('text')
    .attr('fill', '#6b7280')
    .attr('font-size', 9)
    .attr('text-anchor', 'middle')
    .text(d => d.rel || '');

  /* ── Draw nodes ── */
  const color  = d => _M3C[d.group] || '#fff';
  const radius = d => d.group === 'root' ? 34 : 22;

  const nodeSel = g.append('g').selectAll('g').data(nodes).join('g')
    .attr('cursor', d => d.ticker ? 'pointer' : 'default')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) _m3Sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) _m3Sim.alphaTarget(0); if (d.group !== 'root') { d.fx = null; d.fy = null; } })
    )
    .on('click', (e, d) => { if (d.ticker) _m3ShowNodeDetail(d); });

  /* circle */
  nodeSel.append('circle')
    .attr('r', radius)
    .attr('fill', d => {
      if (d.group === 'root') return 'rgba(255,255,255,0.08)';
      return d.ticker ? color(d) + '22' : 'transparent';
    })
    .attr('stroke', color)
    .attr('stroke-width', d => d.group === 'root' ? 2 : 1.5)
    .attr('stroke-dasharray', d => (!d.ticker && d.group !== 'root') ? '4,2' : null);

  /* root node: emoji + short name (two tspans) */
  nodeSel.filter(d => d.group === 'root').append('text')
    .attr('text-anchor', 'middle')
    .attr('fill', '#e6edf3')
    .attr('font-size', 10)
    .attr('font-weight', 700)
    .selectAll('tspan')
    .data(d => {
      const parts = d.name.split(' / ');
      const line1 = parts[0].length > 8 ? parts[0].slice(0, 8) : parts[0];
      const line2 = parts.length > 1 ? (parts.slice(1).join('/').length > 8 ? parts.slice(1).join('/').slice(0, 8) : parts.slice(1).join('/')) : null;
      return line2 ? [line1, line2] : [line1];
    })
    .join('tspan')
    .attr('x', 0)
    .attr('dy', (_, i) => i === 0 ? '-0.35em' : '1.3em')
    .text(d => d);

  /* taiwan stock: ticker inside circle */
  nodeSel.filter(d => d.group !== 'root' && d.ticker).append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', color)
    .attr('font-size', 9.5)
    .attr('font-weight', 700)
    .text(d => d.ticker);

  /* foreign company: short name inside circle */
  nodeSel.filter(d => d.group !== 'root' && !d.ticker).append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', '#94a3b8')
    .attr('font-size', 8)
    .attr('font-weight', 600)
    .text(d => { const n = d.name; return n.length > 6 ? n.slice(0, 6) + '…' : n; });

  /* company name below circle (taiwan only) */
  nodeSel.filter(d => d.group !== 'root' && d.ticker).append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '36')
    .attr('fill', color)
    .attr('font-size', 8.5)
    .text(d => { const n = d.name; return n.length > 5 ? n.slice(0, 5) : n; });

  /* role text below (all non-root) */
  nodeSel.filter(d => d.group !== 'root').append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.ticker ? '47' : '36')
    .attr('fill', '#484f58')
    .attr('font-size', 7.5)
    .text(d => { const r = d.role; return r.length > 10 ? r.slice(0, 10) + '…' : r; });

  /* hover tooltip via title */
  nodeSel.append('title').text(d =>
    d.group === 'root' ? d.name : `${d.ticker ? d.ticker + ' ' : ''}${d.name}\n${d.role}`
  );

  /* ── Tick ── */
  _m3Sim.on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    relLabelSel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 4);
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

/* ═══════════════════════════════════════
   Mobile Folding Cards（< 768px）
═══════════════════════════════════════ */
function _m3RenderMobileCards(chain) {
  const el = document.getElementById('m3-mobile-cards');
  if (!el) return;

  const LANES = [
    { label: '上游', key: 'upstream',   color: '#f59e0b' },
    { label: '中游', key: 'midstream',  color: '#60a5fa' },
    { label: '下游', key: 'downstream', color: '#94a3b8' },
  ];

  el.innerHTML = LANES.map(lane => {
    const companies = chain[lane.key] || [];
    const rows = companies.map((c, i) =>
      `<div class="m3-company-item" onclick="_m3ClickCompanyMobile('${lane.key}',${i})">
        <span style="font-weight:600;color:${c.ticker ? lane.color : 'var(--text2)'}">
          ${c.ticker ? c.ticker + ' ' : ''}${c.name}
        </span>
        <span style="color:var(--text3);font-size:10px;margin-left:6px">${c.role.length > 22 ? c.role.slice(0, 22) + '…' : c.role}</span>
      </div>`
    ).join('');
    return `
      <div class="m3-mobile-card">
        <div class="m3-lane-header" onclick="_m3ToggleLane(this)" style="color:${lane.color}">
          <span>▶ ${lane.label}（${companies.length}家）</span>
        </div>
        <div class="m3-lane-body" data-lane="${lane.key}">${rows}</div>
      </div>`;
  }).join('');
}

function _m3ToggleLane(headerEl) {
  const body = headerEl.nextElementSibling;
  const isOpen = body.classList.toggle('open');
  const sp = headerEl.querySelector('span');
  sp.textContent = sp.textContent.replace(isOpen ? '▶' : '▼', isOpen ? '▼' : '▶');
}

function _m3ClickCompanyMobile(laneKey, idx) {
  if (!_m3Chain) return;
  const c = _m3Chain[laneKey]?.[idx];
  if (!c || !c.ticker) return;
  _m3ShowNodeDetail({ ticker: c.ticker, name: c.name, role: c.role, group: laneKey });
}

/* ═══════════════════════════════════════
   Node Detail Panel
═══════════════════════════════════════ */
function _m3ShowNodeDetail(d) {
  const el = document.getElementById('m3-node-detail');
  if (!el) return;
  const groupLabel = { upstream: '上游', midstream: '中游', downstream: '下游' }[d.group] || '';
  el.style.display = 'block';
  el.innerHTML = `
    <div class="nd-name">${d.ticker} ${d.name} <span style="font-size:11px;font-weight:400;color:var(--text2)">${groupLabel}</span></div>
    <div class="nd-row"><span>角色</span><span style="color:var(--text2);text-align:right;max-width:65%">${d.role}</span></div>
    <div class="nd-row"><span>現價</span><span id="m3-nd-price" style="color:var(--text2)">—</span></div>
    <div class="nd-row"><span>今日漲跌</span><span id="m3-nd-change">—</span></div>
    <div class="nd-row" style="border-bottom:none"><span>外資買賣超</span><span id="m3-nd-foreign" style="color:var(--text2)">—</span></div>
    <div style="margin-top:10px;text-align:right">
      <button class="btn btn-ghost btn-sm" onclick="_m3HideNodeDetail()">✕ 關閉</button>
    </div>`;

  API.getStockQuote(d.ticker).then(q => {
    if (!q) return;
    const priceEl  = document.getElementById('m3-nd-price');
    const changeEl = document.getElementById('m3-nd-change');
    if (priceEl && q.price && q.price > 0) {
      priceEl.textContent = Number(q.price).toFixed(2);
    }
    if (changeEl && q.change != null) {
      const sign = Number(q.change) >= 0 ? '+' : '';
      const pct  = q.change_pct != null ? ` (${sign}${Number(q.change_pct).toFixed(2)}%)` : '';
      changeEl.textContent = `${sign}${Number(q.change).toFixed(2)}${pct}`;
      changeEl.style.color = Number(q.change) >= 0 ? 'var(--red)' : 'var(--green)';
    }
  }).catch(() => {});
}

function _m3HideNodeDetail() {
  const el = document.getElementById('m3-node-detail');
  if (el) el.style.display = 'none';
}

/* ─── Util ─── */
function _m3EscAttr(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
