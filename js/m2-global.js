/**
 * m2-global.js — 全球情報站
 */

'use strict';

const eventData = [
  { date: '2026-06-18', title: 'Fed FOMC 利率決議', impact: 'high',   area: '美股' },
  { date: '2026-06-20', title: '台灣 5 月出口統計', impact: 'medium', area: '台股' },
  { date: '2026-06-25', title: 'NVIDIA GTC 2026',   impact: 'high',   area: 'AI族群' },
  { date: '2026-07-01', title: 'ISM 製造業 PMI',    impact: 'medium', area: '原物料' },
  { date: '2026-07-09', title: '台積電法說會',       impact: 'high',   area: '半導體' },
  { date: '2026-07-15', title: '美國 CPI',           impact: 'high',   area: '美股' },
];

const newsData = [
  { title: 'TSMC 5nm 訂單量 Q3 創新高，AI 推動需求',     time: '09:42', tag: '利多', src: '電子時報' },
  { title: 'Fed 官員：通膨持穩，年內降息路徑清晰',        time: '09:28', tag: '觀望', src: 'Bloomberg' },
  { title: '外資連買 8 日，加碼半導體 ETF',              time: '09:15', tag: '利多', src: '財訊' },
  { title: 'AMD MI400 量產延期影響 AI 族群情緒',         time: '08:55', tag: '利空', src: 'Reuters' },
  { title: 'CoWoS 封裝產能爭奪戰：日月光、矽品搶單',     time: '08:30', tag: '觀察', src: '工商時報' },
];

/* 日期格式：YYYY-MM-DD，renderLaunchTracker 自動排序 + 過濾 */
const launchData = [
  { event: 'Apple WWDC 2026',       date: '2026-06-10', product: 'iOS 20 / M5 晶片',    beneficiary: '台積電・大立光・可成',   sector: '蘋果供應鏈', impact: '高' },
  { event: 'NVIDIA GTC 2026',       date: '2026-06-25', product: 'Blackwell B300',       beneficiary: '台積電・日月光・台達電', sector: 'AI伺服器',   impact: '高' },
  { event: 'Fed FOMC 利率決議',     date: '2026-06-18', product: '—',                    beneficiary: '金融股・匯率相關',       sector: '總經',       impact: '高' },
  { event: '台灣 5月出口統計',      date: '2026-06-20', product: '半導體出口數據',       beneficiary: '台積電・聯發科・廣達',   sector: '半導體',     impact: '中' },
  { event: 'AMD Next Horizon 2026', date: '2026-07-01', product: 'MI400 / EPYC 5',      beneficiary: '台積電・世芯・創意',     sector: 'AI晶片',     impact: '中' },
  { event: '台積電法說會 Q2',       date: '2026-07-09', product: 'Q2財報 / 下半年展望', beneficiary: '半導體全族群',           sector: '半導體',     impact: '高' },
  { event: 'Samsung SDC 2026',      date: '2026-07-16', product: 'Galaxy AI 2.0',        beneficiary: '台積電・新光電',         sector: '折疊手機',   impact: '低' },
];

function renderEventCalendar() {
  const el = document.getElementById('event-calendar');
  if (!el) return;
  const impactMap = { high: ['badge-red','高'], medium: ['badge-yellow','中'], low: ['badge-blue','低'] };
  el.innerHTML = eventData.map(e => {
    const [cls, txt] = impactMap[e.impact] || ['', e.impact];
    return `<div class="event-item">
      <div class="event-date">${e.date} ─ ${e.area}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:13px;">${e.title}</div>
        <span class="badge ${cls}">影響 ${txt}</span>
      </div>
    </div>`;
  }).join('');
}

function renderNewsFeed() {
  const el = document.getElementById('news-feed');
  if (!el) return;
  const tagMap = { '利多': 'badge-green', '利空': 'badge-red', '觀望': 'badge-yellow', '觀察': 'badge-blue' };
  el.innerHTML = newsData.map(n => `
    <div class="news-item">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div class="news-title">${n.title}</div>
        <span class="badge ${tagMap[n.tag] || ''}" style="flex-shrink:0;">${n.tag}</span>
      </div>
      <div class="news-meta">${n.time} ─ ${n.src}</div>
    </div>`).join('');
}

/* 日期過濾：today-5天 ~ today+30天，結果升序排列 */
function renderLaunchTracker() {
  const el = document.getElementById('launch-tracker');
  if (!el) return;

  const now     = new Date(); now.setHours(0, 0, 0, 0);
  const minDate = new Date(now); minDate.setDate(now.getDate() - 5);
  const maxDate = new Date(now); maxDate.setDate(now.getDate() + 30);

  const WD  = ['日','一','二','三','四','五','六'];
  const fmt = d => {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return mm + '/' + dd + '（週' + WD[d.getDay()] + '）';
  };
  const isToday = d => d.toDateString() === now.toDateString();

  const rows = launchData
    .map(r => Object.assign({}, r, { _d: new Date(r.date) }))
    .filter(r => r._d >= minDate && r._d <= maxDate)
    .sort((a, b) => a._d - b._d);

  const impactColor = { '高': 'var(--up)', '中': 'var(--orange)', '低': 'var(--text2)' };

  el.innerHTML = '<table class="launch-table"><thead><tr>'
    + '<th>發表會 / 事件</th><th>日期</th><th>主要產品</th>'
    + '<th>台股受惠公司</th><th>受惠族群</th><th>影響</th>'
    + '</tr></thead><tbody>'
    + rows.map(r => {
        const today     = isToday(r._d);
        const dateTd    = fmt(r._d) + (today ? ' <span class="badge badge-green" style="font-size:9px;padding:1px 4px;">今日</span>' : '');
        const rowStyle  = today ? ' style="background:rgba(63,185,80,0.06);"' : '';
        const dateStyle = today ? 'color:var(--up);font-weight:700;' : 'color:var(--text2);';
        return '<tr' + rowStyle + '>'
          + '<td style="font-weight:600;">' + r.event + '</td>'
          + '<td style="' + dateStyle + '">' + dateTd + '</td>'
          + '<td>' + r.product + '</td>'
          + '<td style="color:var(--blue)">' + r.beneficiary + '</td>'
          + '<td><span class="badge">' + r.sector + '</span></td>'
          + '<td style="color:' + (impactColor[r.impact] || 'var(--text2)') + ';font-weight:600;">' + r.impact + '</td>'
          + '</tr>';
      }).join('')
    + '</tbody></table>';
}

function initGlobal() {
  renderEventCalendar();
  renderNewsFeed();
  renderLaunchTracker();
}
