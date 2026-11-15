// Dashboard view (docs/plan-dashboard.md): 6 categories × 3 panels in a grid.
// This module loads the data for the scope and paints; the panels themselves
// are pure (dashboard-panels.js). Rotterdam compares wijken, Nederland compares
// gemeenten (aggregated from the national wijk file). A selected area is
// compared with the Rotterdam / Nederland figure.
import { getState, setState, onStateChange } from './state.js';
import { openAreaModal } from './area-modal.js';
import { loadRotterdamAreas } from './areas.js';
import { loadNlLevel, findNlArea } from './nl-areas.js';
import { loadGemeenteRegio } from './herkomst-regio.js';
import { loadBouwjaar, isBouwLoaded } from './bouwjaar-pc4.js';
import { buildContext, dashboardLayout, boardHtml, aggregateGemeenten, gemeenteCodeOf } from './dashboard-panels.js';
import { sumRegioEntries } from './dashboard-herkomst.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ROTTERDAM_GM = 'GM0599';

let root = null, tip = null, renderSeq = 0;
let rd = null;            // loadRotterdamAreas() result
let nlWijken = null;      // all NL wijken (scored)
let nlCache = null;       // { key, gemeenten }
let regio = null;         // Map(GM → herkomst-regio entry) once loaded
let regioAll = null;      // the summed NL entry

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
    if (changed.includes('score')) nlCache = null;   // Woonscore rescored in place
    if (changed.some(k => k === 'view' || k === 'scope' || k === 'score')) render();
    else if (changed.includes('area')) paint();
  });

  root.addEventListener('click', onActivate);
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-code],[data-action]')) { e.preventDefault(); onActivate(e); }
  });
  root.addEventListener('pointermove', e => {
    const el = e.target.closest?.('[data-tip]');
    el ? showTip(el.dataset.tip, e.clientX, e.clientY) : hideTip();
  });
  root.addEventListener('pointerleave', hideTip);
  if (getState().view === 'dashboard') render();
}

function onActivate(e) {
  const action = e.target.closest?.('[data-action]');
  if (action?.dataset.action === 'clear-area') { setState({ area: null }, { source: 'dashboard' }); return; }
  const el = e.target.closest?.('[data-code]');
  const code = el?.dataset.code;
  if (!code) return;
  hideTip();
  if (/^(WK|BU)/.test(code)) { openAreaModal(code, el); return; }
  if (getState().area === code) setState({ area: null }, { source: 'dashboard' });
  setState({ area: code, view: 'map' }, { source: 'dashboard' });
}

function showTip(text, x, y) {
  tip.textContent = text;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8);
  const top = y - h - 12 < 8 ? y + 16 : y - h - 12;
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
function hideTip() { if (tip) tip.hidden = true; }

// ── Loading ──────────────────────────────────────────────────────────────────

async function render() {
  const seq = ++renderSeq;
  hideTip();
  const scope = getState().scope;
  try {
    if (scope === 'nederland' && !nlWijken) {
      root.innerHTML = '<p class="dash-loading">Wijken van Nederland laden…</p>';
      nlWijken = await loadNlLevel('wijk');
    } else if (scope !== 'nederland' && !rd) {
      root.innerHTML = '<p class="dash-loading">Wijkcijfers laden…</p>';
      rd = await loadRotterdamAreas();
    }
  } catch {
    if (seq === renderSeq) root.innerHTML = '<div class="placeholder-card dash-message"><h2>Dashboard</h2><p>De gegevens konden niet worden geladen.</p></div>';
    return;
  }
  if (seq !== renderSeq) return;
  paint();
  // Region mix (gemeente names, herkomst) and bouwjaren arrive later: repaint once.
  const extra = [];
  if (!regio) extra.push(loadGemeenteRegio().then(m => { regio = m; regioAll = sumRegioEntries([...m.values()]); nlCache = null; }));
  if (!isBouwLoaded()) extra.push(loadBouwjaar().then(() => { nlCache = null; }));   // app.js adds the shares to the loaded areas
  if (!extra.length) return;
  await Promise.allSettled(extra);
  if (seq === renderSeq && getState().view === 'dashboard') paint();
}

function nlGemeenten() {
  const key = `${!!regio}:${isBouwLoaded()}`;
  if (nlCache?.key !== key) nlCache = { key, gemeenten: aggregateGemeenten(nlWijken, gm => regio?.get(gm)?.name ?? null) };
  return nlCache.gemeenten;
}

function contextFor(state) {
  const code = state.area;
  if (state.scope === 'nederland') {
    if (!nlWijken) return null;
    const gemeenten = nlGemeenten();
    const selected = !code ? null : /^GM/.test(code) ? gemeenten.find(g => g.code === code) ?? null : findNlArea(code);
    const gm = gemeenteCodeOf(selected?.code);
    const area = gm ? regio?.get(gm) ?? null : null;
    return buildContext({
      scope: 'nederland', units: gemeenten, scored: nlWijken, selected, bouwLoaded: isBouwLoaded(),
      regio: { area, ref: regioAll, areaName: area?.name ?? gm, refName: 'Nederland' },
    });
  }
  if (!rd) return null;
  const selected = code && code !== ROTTERDAM_GM ? rd.wijken.find(a => a.code === code) ?? rd.buurten.find(a => a.code === code) ?? null : null;
  return buildContext({
    scope: 'rotterdam', units: rd.wijken, scored: rd.wijken, selected, bouwLoaded: isBouwLoaded(),
    regio: { area: regio?.get(ROTTERDAM_GM) ?? null, ref: regioAll, areaName: 'Rotterdam', refName: 'Nederland' },
  });
}

function paint() {
  if (!root) return;
  const state = getState();
  const ctx = contextFor(state);
  if (!ctx) return;
  const title = state.scope === 'nederland' ? 'Nederland in cijfers' : 'Rotterdam in cijfers';
  const sub = ctx.selected
    ? `<p>${esc(ctx.selected.name)} vergeleken met ${esc(ctx.refName)} · <button type="button" class="dash-btn dash-btn-small" data-action="clear-area">Toon heel ${esc(ctx.refName)}</button></p>`
    : `<p>${ctx.units.length} ${ctx.unitWord} · kies een gebied op de kaart of in een lijst om het met ${esc(ctx.refName)} te vergelijken</p>`;
  root.innerHTML = `<header class="dash-head"><h2>${title}</h2>${sub}</header>${boardHtml(dashboardLayout(ctx))}`;
}
