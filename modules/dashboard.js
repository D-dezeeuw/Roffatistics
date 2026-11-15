// Dashboard view: KPI row, composition donuts, one sorted SVG bar chart per
// dataset over all Rotterdam wijken, and an X/Y scatter. Plain SVG, no chart library.
// Clicking a wijk sets { area, view: 'map' } so the map zooms to it.
import { getState, setState, onStateChange } from './state.js';
import { openAreaModal } from './area-modal.js';
import { loadRotterdamAreas, DATASETS, DATASET_KEYS } from './areas.js';
import { datasetFor, crimeAreas } from './datasets.js';
import { crimeToggleHtml } from './crime-mode.js';
import { infoButton } from './explain.js';
import { buildScale, getScaleMethod, OUTLIER_COLOR, SCALE_EVENT } from './scale.js';
import { NO_DATA_COLOR } from './rotterdam.js';
import {
  sortByValue, cityValue, isCityTotal, cityKpis, formatValue, formatShort, formatTick,
  niceTicks, linearScale, barDomain, scatterPoints, formatNumber,
  educationMix, areaEducationMix, shareSplit, populationItems, cityWozKpi,
} from './dashboard-data.js';
import { donutSlices, arcPath } from './donut.js';
import { loadCityHerkomst } from './herkomst.js';
import { herkomstSectionHtml } from './dashboard-herkomst.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r1 = v => Math.round(v * 10) / 10;

let root = null, tip = null, areas = null, renderSeq = 0, lastWidth = 0, resizeFrame = 0;
let mode = 'rate';          // crime mode of the last render (state.crime)
const wijkView = () => crimeAreas(areas?.wijken ?? [], mode);   // wijken with crime values in the current mode
const meta = key => datasetFor(key, mode);
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
    if (changed.some(k => k === 'view' || k === 'scope' || k === 'dataset' || k === 'crime')) render();
    else if (changed.includes('area') && areas && root.querySelector('[data-donuts]')) { renderDonuts(); drawCharts(); markHerkomstSelection(state.area); }
  });

  document.addEventListener(SCALE_EVENT, () => { if (getState().view === 'dashboard') drawCharts(); });
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
  const el = e.target.closest?.('[data-code]');
  const code = el?.dataset.code;
  if (!code) return;
  hideTip();
  // A wijk or buurt opens the area modal; its "Toon op kaart" zooms the map.
  if (/^(WK|BU)/.test(code)) { openAreaModal(code, el); return; }
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
  mode = getState().crime;
  const wijken = wijkView();
  const active = getState().dataset;
  const order = [active, ...DATASET_KEYS.filter(k => k !== active)].filter(k => DATASETS[k]);

  // The 2026 city WOZ (85036NED) sits right after the 2025 WOZ, with its source and peildatum.
  const kpiList = cityKpis(wijken, areas.city, 2025, mode);
  const woz = cityWozKpi(areas.city?.woz);
  if (woz) kpiList.splice(kpiList.findIndex(k => k.key === 'wozValue') + 1, 0, { ...woz, newest: true });
  const kpis = kpiList.map(k => `
      <li class="dash-kpi${k.newest ? ' is-newest' : ''}"${k.note ? ` title="${esc(k.note)}"` : ''}><span class="dash-kpi-label">${esc(k.label)}</span><span class="dash-kpi-value">${esc(k.text)}</span>${k.newest ? `<span class="dash-kpi-note">${esc(k.note)}</span>` : ''}</li>`).join('');

  const barCard = key => {
    const ds = meta(key);
    const missing = wijken.filter(a => a.values?.[key] == null).length;
    const avg = cityValue(wijken, key, mode);
    const sub = isCityTotal(key, mode)
      ? `Totaal${key === 'population' ? '' : ' Rotterdam'}: ${formatValue(avg, key, mode)}`
      : `Ø Rotterdam: ${formatValue(avg, key, mode)}`;
    return `
      <article class="dash-card${key === active ? ' is-active' : ''}" aria-labelledby="dash-h-${key}">
        <header class="dash-card-head">
          <h3 id="dash-h-${key}">${esc(ds.title)}${infoButton(key, ds.title)}</h3>
          <button type="button" class="dash-btn dash-btn-small" data-action="show-dataset" data-dataset="${key}" aria-label="${esc(ds.title)} op de kaart">Op kaart</button>
        </header>
        <p class="dash-card-sub">${esc(sub)}${missing ? ` · ${missing} ${missing === 1 ? 'wijk' : 'wijken'} zonder data` : ''}</p>
        <div class="dash-chart" data-chart="bar" data-key="${key}"></div>
      </article>`;
  };
  const options = sel => DATASET_KEYS.map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(meta(k).title)}</option>`).join('');
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
      <div class="dash-head-row"><h2>Rotterdam in cijfers</h2><div class="dash-crime" title="Geldt voor alle criminaliteitslagen">${crimeToggleHtml(mode)}</div></div>
      <p>${wijken.length} wijken vergeleken · CBS kerncijfers ${esc(areas.dataYears ?? '2025')} · misdrijven politie 2025${mode === 'abs' ? ' (absoluut)' : ' per 1.000 inw.'}${areas.city?.woz ? ` · WOZ ${areas.city.woz.year}: CBS ${esc(areas.city.woz.table)}, peildatum ${esc(areas.city.woz.peildatum)}` : ''}${areas.dataOk ? '' : ' · <strong>CBS-cijfers niet beschikbaar</strong>'}</p>
    </header>
    <ul class="dash-kpis" aria-label="Rotterdam totaal en gemiddelden">${kpis}</ul>
    <section class="dash-donuts" data-donuts aria-label="Samenstelling van Rotterdam"></section>
    <section class="dash-herkomst" data-herkomst aria-labelledby="dash-h-herkomst"></section>
    <div class="dash-grid">
      ${barCard(order[0])}
      ${scatterCard}
      ${order.slice(1).map(barCard).join('')}
    </div>`;
  renderDonuts();
  drawCharts();
  renderHerkomst(seq);
}

// ── Herkomst ─────────────────────────────────────────────────────────────────

async function renderHerkomst(seq) {
  const box = root?.querySelector('[data-herkomst]');
  if (!box) return;
  const opts = () => ({ donutSvg, legendHtml, selected: getState().area });
  box.innerHTML = herkomstSectionHtml(null, wijkView(), opts());
  let summary = null, failed = false;
  try { summary = await loadCityHerkomst(); } catch { failed = true; }
  if (seq !== renderSeq || !box.isConnected) return;
  box.innerHTML = herkomstSectionHtml(summary, wijkView(), { ...opts(), failed });
}

function markHerkomstSelection(code) {
  root?.querySelectorAll('[data-herkomst] .hk-wijk').forEach(el => el.classList.toggle('is-selected', el.dataset.code === code));
}

// ── Donuts ───────────────────────────────────────────────────────────────────

const pctText = p => `${formatNumber(p, 1)}%`;

/**
 * One donut: slices from donutSlices(), each with a hover/focus tooltip
 * "label: value (pct)". Slices with a `code` are wijk buttons (click → map).
 */
function donutSvg(slices, { size = 136, center = null, label, fmt, selected } = {}) {
  const c = size / 2, rO = c - 2, rI = Math.round(rO * 0.6);
  const paths = slices.map(sl => {
    const text = `${sl.label}: ${fmt(sl)}${fmt.showPct === false ? '' : ` (${pctText(sl.pct)})`}`;
    const attrs = sl.code
      ? `class="dash-slice is-link${sl.code === selected ? ' is-selected' : ''}" data-code="${esc(sl.code)}" role="button" aria-label="${esc(text)}. Toon op kaart"`
      : `class="dash-slice" role="img" aria-label="${esc(text)}"`;
    return `<path ${attrs} d="${arcPath(c, c, rO, rI, sl.a0, sl.a1)}" fill="${sl.color}" fill-rule="evenodd" data-tip="${esc(text)}" tabindex="0"/>`;
  }).join('');
  const mid = center ? `
    <text class="dash-donut-value" x="${c}" y="${c + 2}" text-anchor="middle">${esc(center.value)}</text>
    <text class="dash-donut-label" x="${c}" y="${c + 16}" text-anchor="middle">${esc(center.label)}</text>` : '';
  return `<svg class="dash-svg dash-donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="group" aria-label="${esc(label)}">
    <title>${esc(label)}</title>${paths}${mid}</svg>`;
}

function legendHtml(slices, fmt, extra = null) {
  return `<ul class="dash-legend">${slices.map((sl, i) => {
    const text = `${sl.label}: ${fmt(sl)}${fmt.showPct === false ? '' : ` (${pctText(sl.pct)})`}`;
    const link = sl.code ? ` data-code="${esc(sl.code)}" tabindex="0" role="button" aria-label="${esc(text)}. Toon op kaart"` : '';
    return `<li class="dash-legend-item${sl.code ? ' is-link' : ''}"${link} data-tip="${esc(text)}">
      <span class="dash-swatch" style="background:${sl.color}" aria-hidden="true"></span>
      <span class="dash-legend-label">${esc(sl.short ?? sl.label)}</span>
      <span class="dash-legend-pct">${extra ? extra(sl, i) : pctText(sl.pct)}</span></li>`;
  }).join('')}</ul>`;
}

function donutCard({ id, title, sub, items, opts = {}, fmt, center }) {
  const body = items ? donutSlices(items, opts) : { slices: [] };
  const selected = getState().area;
  const chart = body.slices.length
    ? `<div class="dash-donut-wrap">${donutSvg(body.slices, { center: center?.(body), label: title, fmt, selected })}${legendHtml(body.slices, fmt)}</div>`
    : '<p class="dash-card-sub">geen data</p>';
  return `
      <article class="dash-card dash-donut-card" aria-labelledby="dash-h-${id}">
        <header class="dash-card-head"><h3 id="dash-h-${id}">${esc(title)}</h3></header>
        <p class="dash-card-sub">${esc(sub)}</p>
        ${chart}
      </article>`;
}

function compareCard(wijk, city) {
  const own = areaEducationMix(wijk);
  const title = `${wijk.name} vs Rotterdam`;
  const fmt = sl => pctText(sl.value);
  fmt.showPct = false;
  if (!own || !city) {
    return `
      <article class="dash-card dash-donut-card is-compare" aria-labelledby="dash-h-compare">
        <header class="dash-card-head"><h3 id="dash-h-compare">${esc(title)}</h3></header>
        <p class="dash-card-sub">Opleidingsniveau · geen data voor ${esc(wijk.name)}</p>
      </article>`;
  }
  const a = donutSlices(own).slices, b = donutSlices(city).slices;
  const top = sl => ({ value: pctText(sl.find(x => x.key === 'highEdu')?.pct ?? 0), label: 'hoog' });
  return `
      <article class="dash-card dash-donut-card is-compare" aria-labelledby="dash-h-compare">
        <header class="dash-card-head"><h3 id="dash-h-compare">${esc(title)}</h3></header>
        <p class="dash-card-sub">Opleidingsniveau, hoogst behaald · aandeel per niveau</p>
        <div class="dash-donut-wrap is-pair">
          <figure class="dash-donut-fig">${donutSvg(a, { size: 112, center: top(a), label: `Opleidingsniveau ${wijk.name}`, fmt })}<figcaption>${esc(wijk.name)}</figcaption></figure>
          <figure class="dash-donut-fig">${donutSvg(b, { size: 112, center: top(b), label: 'Opleidingsniveau Rotterdam', fmt })}<figcaption>Rotterdam</figcaption></figure>
          ${legendHtml(a, fmt, (sl, i) => `${pctText(sl.pct)} <span class="dash-legend-vs">· ${pctText(b[i]?.pct ?? 0)}</span>`)}
        </div>
      </article>`;
}

function renderDonuts() {
  const box = root?.querySelector('[data-donuts]');
  if (!box || !areas) return;
  const wijken = wijkView();
  const city = educationMix(wijken);
  const sel = getState().area;
  const wijk = sel ? wijken.find(a => a.code === sel) : null;
  const share = sl => pctText(sl.value);
  share.showPct = false;
  const inw = sl => formatValue(sl.value, 'population');
  const highOf = ({ slices }) => ({ value: pctText(slices.find(s => s.key === 'highEdu')?.pct ?? 0), label: 'hoog' });
  const firstOf = label => ({ slices }) => ({ value: pctText(slices[0]?.pct ?? 0), label });

  box.innerHTML = (wijk ? compareCard(wijk, city) : '')
    + donutCard({ id: 'edu', title: 'Opleidingsniveau', sub: 'Hoogst behaald, gewogen naar inwoners', items: city, fmt: share, center: highOf })
    + donutCard({ id: 'age', title: 'Leeftijd', sub: 'Aandeel 65-plussers', fmt: share, center: firstOf('65+'),
      items: shareSplit(wijken, 'pop65plus', '65 jaar en ouder', 'Jonger dan 65') })
    + donutCard({ id: 'origin', title: 'Herkomst', sub: 'Aandeel met herkomst buiten Europa', fmt: share, center: firstOf('buiten Eur.'),
      items: shareSplit(wijken, 'nonWesternPct', 'Buiten Europa', 'Nederland en rest van Europa') })
    + donutCard({ id: 'pop', title: 'Inwoners per wijk', sub: 'Top 8 wijken, de rest als overig · klik een wijk voor de kaart', fmt: inw,
      items: populationItems(wijken), opts: { top: 8, sort: true },
      center: ({ total }) => ({ value: formatNumber(total), label: 'inwoners' }) });
}

function drawCharts() {
  if (!root || !areas) return;
  lastWidth = root.clientWidth;
  const selected = getState().area;
  root.querySelectorAll('.dash-chart').forEach(el => {
    const w = Math.max(240, Math.floor(el.clientWidth));
    el.innerHTML = el.dataset.chart === 'bar'
      ? barChartSvg(wijkView(), el.dataset.key, w, selected)
      : scatterSvg(wijkView(), scatterAxes.x, scatterAxes.y, w, selected, root.querySelector('[data-scatter-note]'));
  });
}

// ── Bar chart ────────────────────────────────────────────────────────────────

function barChartSvg(wijken, key, W, selected) {
  const ds = meta(key);
  const rows = sortByValue(wijken, key);
  const vals = rows.map(a => a.values[key]).filter(v => v != null);
  const scale = buildScale(vals, { method: getScaleMethod() });   // same classes and outliers as the map
  const dom = barDomain(vals);
  const labelW = Math.round(Math.min(150, W * 0.34));
  const padR = 76, top = 18, rowH = 20, axisH = 20;
  const H = top + rows.length * rowH + axisH;
  const x = linearScale([dom.min, dom.max], [labelW, W - padR]);
  const maxChars = Math.max(6, Math.floor((labelW - 8) / 6.4));
  const avg = cityValue(wijken, key, mode);

  const grid = dom.ticks.map(t => `
    <line class="dash-grid-line" x1="${r1(x(t))}" x2="${r1(x(t))}" y1="${top - 4}" y2="${H - axisH}"/>
    <text class="dash-tick" x="${r1(x(t))}" y="${H - 6}" text-anchor="middle">${esc(formatTick(t, key, mode))}</text>`).join('');

  const bars = rows.map((a, i) => {
    const y = top + i * rowH, v = a.values[key];
    const name = a.name.length > maxChars ? a.name.slice(0, maxChars - 1) + '…' : a.name;
    const text = `${a.name}: ${formatValue(v, key, mode)}`;
    const cls = `dash-bar${v == null ? ' is-nodata' : ''}${a.code === selected ? ' is-selected' : ''}`;
    const body = v == null
      ? `<rect x="${labelW}" y="${y + 3}" width="${r1(W - padR - labelW)}" height="${rowH - 6}" rx="2" fill="${NO_DATA_COLOR}" opacity="0.35"/>
         <text class="dash-bar-nodata" x="${labelW + 6}" y="${y + rowH / 2 + 4}">geen data</text>`
      : `<rect x="${r1(Math.min(x(0), x(v)))}" y="${y + 3}" width="${r1(Math.max(1, Math.abs(x(v) - x(0))))}" height="${rowH - 6}" rx="2" fill="${scale.colorFor(v)}"${scale.isOutlier(v) ? ` stroke="${OUTLIER_COLOR}" stroke-width="1.5" class="dash-bar-outlier"` : ''}/>
         <text class="dash-bar-value" x="${r1(x(v) + 5)}" y="${y + rowH / 2 + 4}">${esc(formatShort(v, key, mode))}</text>`;
    return `
    <g class="${cls}" data-code="${esc(a.code)}" data-tip="${esc(text)}" tabindex="0" role="button" aria-label="${esc(text)}. Toon op kaart">
      <rect class="dash-hit" x="0" y="${y}" width="${W}" height="${rowH}"/>
      <text class="dash-bar-label" x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(name)}</text>
      ${body}
    </g>`;
  }).join('');

  const avgLine = avg == null || isCityTotal(key, mode) ? '' : `
    <line class="dash-avg" x1="${r1(x(avg))}" x2="${r1(x(avg))}" y1="${top - 6}" y2="${H - axisH}"/>
    <text class="dash-avg-label" x="${r1(x(avg))}" y="${top - 8}" text-anchor="middle">Ø Rotterdam ${esc(formatShort(avg, key, mode))}</text>`;

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
  const yScale = buildScale(ys, { method: getScaleMethod() });

  const grid = xd.ticks.map(t => `
    <line class="dash-grid-line" x1="${r1(x(t))}" x2="${r1(x(t))}" y1="${m.t}" y2="${H - m.b}"/>
    <text class="dash-tick" x="${r1(x(t))}" y="${H - m.b + 14}" text-anchor="middle">${esc(formatTick(t, xKey, mode))}</text>`).join('')
    + yd.ticks.map(t => `
    <line class="dash-grid-line" x1="${m.l}" x2="${W - m.r}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>
    <text class="dash-tick" x="${m.l - 6}" y="${r1(y(t)) + 4}" text-anchor="end">${esc(formatTick(t, yKey, mode))}</text>`).join('');

  const ax = cityValue(wijken, xKey, mode), ay = cityValue(wijken, yKey, mode);
  const avg = (ax == null || isCityTotal(xKey, mode) ? '' : `<line class="dash-avg" x1="${r1(x(ax))}" x2="${r1(x(ax))}" y1="${m.t}" y2="${H - m.b}"/>`)
    + (ay == null || isCityTotal(yKey, mode) ? '' : `<line class="dash-avg" x1="${m.l}" x2="${W - m.r}" y1="${r1(y(ay))}" y2="${r1(y(ay))}"/>`);

  const dots = [...points].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).map(p => {
    const r = 3.5 + 7 * Math.sqrt((p.population ?? 0) / maxPop);
    const text = `${p.name}\n${meta(xKey).title}: ${formatValue(p.x, xKey, mode)}\n${meta(yKey).title}: ${formatValue(p.y, yKey, mode)}`;
    return `
    <g class="dash-dot${p.code === selected ? ' is-selected' : ''}" data-code="${esc(p.code)}" data-tip="${esc(text)}" tabindex="0" role="button" aria-label="${esc(text.replace(/\n/g, ', '))}. Toon op kaart">
      <circle cx="${r1(x(p.x))}" cy="${r1(y(p.y))}" r="${r1(r)}" fill="${yScale.colorFor(p.y)}"${yScale.isOutlier(p.y) ? ' class="is-outlier"' : ''}/>
    </g>`;
  }).join('');

  const empty = points.length ? '' : `<text class="dash-bar-nodata" x="${W / 2}" y="${H / 2}" text-anchor="middle">geen wijken met beide waarden</text>`;
  return `<svg class="dash-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(`${meta(yKey).title} tegen ${meta(xKey).title} per wijk`)}">
    <title>${esc(`${meta(yKey).title} tegen ${meta(xKey).title}`)}</title>${grid}${avg}
    <text class="dash-axis-label" x="${W - m.r}" y="${H - 6}" text-anchor="end">${esc(meta(xKey).title)} →</text>
    <text class="dash-axis-label" x="${m.l}" y="12" text-anchor="start">↑ ${esc(meta(yKey).title)}</text>
    ${dots}${empty}
  </svg>`;
}

