// Dashboard view: KPI row, one sorted SVG bar chart per dataset over all
// Rotterdam wijken, and an X/Y scatter. Plain SVG, no chart library.
// Clicking a wijk sets { area, view: 'map' } so the map zooms to it.
import { getState, setState, onStateChange } from './state.js';
import { loadRotterdamAreas, DATASETS, DATASET_KEYS } from './areas.js';
import { interpolateColor } from './overlays.js';
import { NO_DATA_COLOR } from './rotterdam.js';
import {
  sortByValue, cityValue, cityKpis, formatValue, formatShort, formatTick,
  niceTicks, linearScale, barDomain, scatterPoints,
} from './dashboard-data.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r1 = v => Math.round(v * 10) / 10;

let root = null, tip = null, areas = null, renderSeq = 0, lastWidth = 0, resizeFrame = 0;
const scatterAxes = { x: 'avgIncome', y: 'wozValue' };

export function initDashboard() {
  root = document.getElementById('dashboard-root');
  if (!root) return;
  tip = document.createElement('div');
  tip.className = 'dash-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);

  onStateChange(({ state, changed }) => {
    if (state.view !== 'dashboard') { hideTip(); return; }
    if (changed.some(k => k === 'view' || k === 'scope' || k === 'dataset')) render();
  });

  root.addEventListener('click', onActivate);
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-code]')) { e.preventDefault(); onActivate(e); }
  });
  root.addEventListener('change', e => {
    const axis = e.target.dataset?.axis;
    if (!axis) return;
    scatterAxes[axis] = e.target.value;
    drawCharts();
  });
  root.addEventListener('pointermove', e => {
    const el = e.target.closest?.('[data-tip]');
    el ? showTip(el.dataset.tip, e.clientX, e.clientY) : hideTip();
  });
  root.addEventListener('pointerleave', hideTip);
  root.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) return;
    const b = el.getBoundingClientRect();
    showTip(el.dataset.tip, b.left + b.width / 2, b.top);
  });
  root.addEventListener('focusout', hideTip);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (getState().view !== 'dashboard' || !areas) return;
      const w = root.clientWidth;
      if (Math.abs(w - lastWidth) < 8) return;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(drawCharts);
    }).observe(root);
  }
  if (getState().view === 'dashboard') render();
}

function onActivate(e) {
  const action = e.target.closest?.('[data-action]');
  if (action?.dataset.action === 'to-rotterdam') { setState({ scope: 'rotterdam' }, { source: 'dashboard' }); return; }
  if (action?.dataset.action === 'show-dataset') { setState({ dataset: action.dataset.dataset, view: 'map' }, { source: 'dashboard' }); return; }
  const code = e.target.closest?.('[data-code]')?.dataset.code;
  if (!code) return;
  hideTip();
  // Re-clicking the selected wijk must still zoom: clear it so `area` changes.
  if (getState().area === code) setState({ area: null }, { source: 'dashboard' });
  setState({ area: code, view: 'map' }, { source: 'dashboard' });
}

function showTip(text, x, y) {
  tip.textContent = text;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8);
  const top  = y - h - 12 < 8 ? y + 16 : y - h - 12;
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
function hideTip() { if (tip) tip.hidden = true; }

// ── Page ─────────────────────────────────────────────────────────────────────

async function render() {
  const seq = ++renderSeq;
  hideTip();
  if (getState().scope !== 'rotterdam') {
    root.innerHTML = `
      <div class="placeholder-card dash-message">
        <h2>Dashboard</h2>
        <p>Het dashboard vergelijkt de 21 wijken van Rotterdam. In de Nederland-weergave is het (nog) niet beschikbaar.</p>
        <button type="button" class="dash-btn" data-action="to-rotterdam">Naar Rotterdam</button>
      </div>`;
    return;
  }
  if (!areas) {
    root.innerHTML = '<p class="dash-loading">Wijkcijfers laden…</p>';
    try {
      areas = await loadRotterdamAreas();
    } catch {
      if (seq === renderSeq) root.innerHTML = '<div class="placeholder-card dash-message"><h2>Dashboard</h2><p>De wijkgegevens konden niet worden geladen.</p></div>';
      return;
    }
    if (seq !== renderSeq) return;
  }
  const wijken = areas.wijken;
  const active = getState().dataset;
  const order = [active, ...DATASET_KEYS.filter(k => k !== active)].filter(k => DATASETS[k]);

  const kpis = cityKpis(wijken).map(k => `
      <li class="dash-kpi"><span class="dash-kpi-label">${esc(k.label)}</span><span class="dash-kpi-value">${esc(k.text)}</span></li>`).join('');

  const barCard = key => {
    const ds = DATASETS[key];
    const missing = wijken.filter(a => a.values?.[key] == null).length;
    const avg = cityValue(wijken, key);
    const sub = key === 'population'
      ? `Totaal: ${formatValue(avg, key)}`
      : `Ø Rotterdam: ${formatValue(avg, key)}`;
    return `
      <article class="dash-card${key === active ? ' is-active' : ''}" aria-labelledby="dash-h-${key}">
        <header class="dash-card-head">
          <h3 id="dash-h-${key}">${esc(ds.title)}</h3>
          <button type="button" class="dash-btn dash-btn-small" data-action="show-dataset" data-dataset="${key}" aria-label="${esc(ds.title)} op de kaart">Op kaart</button>
        </header>
        <p class="dash-card-sub">${esc(sub)}${missing ? ` · ${missing} ${missing === 1 ? 'wijk' : 'wijken'} zonder data` : ''}</p>
        <div class="dash-chart" data-chart="bar" data-key="${key}"></div>
      </article>`;
  };
  const options = sel => DATASET_KEYS.map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(DATASETS[k].title)}</option>`).join('');
  const scatterCard = `
      <article class="dash-card dash-card-scatter" aria-labelledby="dash-h-scatter">
        <header class="dash-card-head">
          <h3 id="dash-h-scatter">Verband tussen twee lagen</h3>
        </header>
        <div class="dash-axes">
          <label>X <select data-axis="x">${options(scatterAxes.x)}</select></label>
          <label>Y <select data-axis="y">${options(scatterAxes.y)}</select></label>
        </div>
        <p class="dash-card-sub" data-scatter-note></p>
        <div class="dash-chart" data-chart="scatter"></div>
      </article>`;

  root.innerHTML = `
    <header class="dash-head">
      <h2>Rotterdam in cijfers</h2>
      <p>${wijken.length} wijken vergeleken · CBS kerncijfers 2024, misdrijven politie 2025${areas.dataOk ? '' : ' · <strong>CBS-cijfers niet beschikbaar</strong>'}</p>
    </header>
    <ul class="dash-kpis" aria-label="Rotterdam totaal en gemiddelden">${kpis}</ul>
    <div class="dash-grid">
      ${barCard(order[0])}
      ${scatterCard}
      ${order.slice(1).map(barCard).join('')}
    </div>`;
  drawCharts();
}

function drawCharts() {
  if (!root || !areas) return;
  lastWidth = root.clientWidth;
  const selected = getState().area;
  root.querySelectorAll('.dash-chart').forEach(el => {
    const w = Math.max(240, Math.floor(el.clientWidth));
    el.innerHTML = el.dataset.chart === 'bar'
      ? barChartSvg(areas.wijken, el.dataset.key, w, selected)
      : scatterSvg(areas.wijken, scatterAxes.x, scatterAxes.y, w, selected, root.querySelector('[data-scatter-note]'));
  });
}

// ── Bar chart ────────────────────────────────────────────────────────────────

function barChartSvg(wijken, key, W, selected) {
  const ds = DATASETS[key];
  const rows = sortByValue(wijken, key);
  const vals = rows.map(a => a.values[key]).filter(v => v != null);
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const dom = barDomain(vals);
  const labelW = Math.round(Math.min(150, W * 0.34));
  const padR = 76, top = 18, rowH = 20, axisH = 20;
  const H = top + rows.length * rowH + axisH;
  const x = linearScale([dom.min, dom.max], [labelW, W - padR]);
  const maxChars = Math.max(6, Math.floor((labelW - 8) / 6.4));
  const avg = cityValue(wijken, key);

  const grid = dom.ticks.map(t => `
    <line class="dash-grid-line" x1="${r1(x(t))}" x2="${r1(x(t))}" y1="${top - 4}" y2="${H - axisH}"/>
    <text class="dash-tick" x="${r1(x(t))}" y="${H - 6}" text-anchor="middle">${esc(formatTick(t, key))}</text>`).join('');

  const bars = rows.map((a, i) => {
    const y = top + i * rowH, v = a.values[key];
    const name = a.name.length > maxChars ? a.name.slice(0, maxChars - 1) + '…' : a.name;
    const text = `${a.name}: ${formatValue(v, key)}`;
    const cls = `dash-bar${v == null ? ' is-nodata' : ''}${a.code === selected ? ' is-selected' : ''}`;
    const body = v == null
      ? `<rect x="${labelW}" y="${y + 3}" width="${r1(W - padR - labelW)}" height="${rowH - 6}" rx="2" fill="${NO_DATA_COLOR}" opacity="0.35"/>
         <text class="dash-bar-nodata" x="${labelW + 6}" y="${y + rowH / 2 + 4}">geen data</text>`
      : `<rect x="${r1(Math.min(x(0), x(v)))}" y="${y + 3}" width="${r1(Math.max(1, Math.abs(x(v) - x(0))))}" height="${rowH - 6}" rx="2" fill="${interpolateColor(v, lo, hi)}"/>
         <text class="dash-bar-value" x="${r1(x(v) + 5)}" y="${y + rowH / 2 + 4}">${esc(formatShort(v, key))}</text>`;
    return `
    <g class="${cls}" data-code="${esc(a.code)}" data-tip="${esc(text)}" tabindex="0" role="button" aria-label="${esc(text)}. Toon op kaart">
      <rect class="dash-hit" x="0" y="${y}" width="${W}" height="${rowH}"/>
      <text class="dash-bar-label" x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(name)}</text>
      ${body}
    </g>`;
  }).join('');

  const avgLine = avg == null || key === 'population' ? '' : `
    <line class="dash-avg" x1="${r1(x(avg))}" x2="${r1(x(avg))}" y1="${top - 6}" y2="${H - axisH}"/>
    <text class="dash-avg-label" x="${r1(x(avg))}" y="${top - 8}" text-anchor="middle">Ø Rotterdam ${esc(formatShort(avg, key))}</text>`;

  return `<svg class="dash-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(ds.title)} per wijk, hoog naar laag">
    <title>${esc(ds.title)} per wijk</title>${grid}${bars}${avgLine}
  </svg>`;
}

// ── Scatter ──────────────────────────────────────────────────────────────────

function scatterSvg(wijken, xKey, yKey, W, selected, noteEl) {
  const { points, missing } = scatterPoints(wijken, xKey, yKey);
  if (noteEl) {
    noteEl.textContent = `${points.length} wijken` + (missing ? ` · ${missing} zonder data (niet getoond)` : '') + ' · stipgrootte = inwoners';
  }
  const H = Math.round(Math.min(380, Math.max(240, W * 0.7)));
  const m = { l: 54, r: 14, t: 22, b: 40 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xd = niceTicks(xs.length ? Math.min(...xs) : 0, xs.length ? Math.max(...xs) : 1, Math.max(3, Math.floor(W / 90)));
  const yd = niceTicks(ys.length ? Math.min(...ys) : 0, ys.length ? Math.max(...ys) : 1, 5);
  const x = linearScale([xd.min, xd.max], [m.l, W - m.r]);
  const y = linearScale([yd.min, yd.max], [H - m.b, m.t]);
  const maxPop = Math.max(1, ...points.map(p => p.population ?? 0));
  const yLo = ys.length ? Math.min(...ys) : 0, yHi = ys.length ? Math.max(...ys) : 1;

  const grid = xd.ticks.map(t => `
    <line class="dash-grid-line" x1="${r1(x(t))}" x2="${r1(x(t))}" y1="${m.t}" y2="${H - m.b}"/>
    <text class="dash-tick" x="${r1(x(t))}" y="${H - m.b + 14}" text-anchor="middle">${esc(formatTick(t, xKey))}</text>`).join('')
    + yd.ticks.map(t => `
    <line class="dash-grid-line" x1="${m.l}" x2="${W - m.r}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>
    <text class="dash-tick" x="${m.l - 6}" y="${r1(y(t)) + 4}" text-anchor="end">${esc(formatTick(t, yKey))}</text>`).join('');

  const ax = cityValue(wijken, xKey), ay = cityValue(wijken, yKey);
  const avg = (ax == null || xKey === 'population' ? '' : `<line class="dash-avg" x1="${r1(x(ax))}" x2="${r1(x(ax))}" y1="${m.t}" y2="${H - m.b}"/>`)
    + (ay == null || yKey === 'population' ? '' : `<line class="dash-avg" x1="${m.l}" x2="${W - m.r}" y1="${r1(y(ay))}" y2="${r1(y(ay))}"/>`);

  const dots = [...points].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).map(p => {
    const r = 3.5 + 7 * Math.sqrt((p.population ?? 0) / maxPop);
    const text = `${p.name}\n${DATASETS[xKey].title}: ${formatValue(p.x, xKey)}\n${DATASETS[yKey].title}: ${formatValue(p.y, yKey)}`;
    return `
    <g class="dash-dot${p.code === selected ? ' is-selected' : ''}" data-code="${esc(p.code)}" data-tip="${esc(text)}" tabindex="0" role="button" aria-label="${esc(text.replace(/\n/g, ', '))}. Toon op kaart">
      <circle cx="${r1(x(p.x))}" cy="${r1(y(p.y))}" r="${r1(r)}" fill="${interpolateColor(p.y, yLo, yHi)}"/>
    </g>`;
  }).join('');

  const empty = points.length ? '' : `<text class="dash-bar-nodata" x="${W / 2}" y="${H / 2}" text-anchor="middle">geen wijken met beide waarden</text>`;
  return `<svg class="dash-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(`${DATASETS[yKey].title} tegen ${DATASETS[xKey].title} per wijk`)}">
    <title>${esc(`${DATASETS[yKey].title} tegen ${DATASETS[xKey].title}`)}</title>${grid}${avg}
    <text class="dash-axis-label" x="${W - m.r}" y="${H - 6}" text-anchor="end">${esc(DATASETS[xKey].title)} →</text>
    <text class="dash-axis-label" x="${m.l}" y="12" text-anchor="start">↑ ${esc(DATASETS[yKey].title)}</text>
    ${dots}${empty}
  </svg>`;
}

