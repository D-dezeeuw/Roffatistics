// Area detail modal: a wijk or buurt in full. Opened from a Ranglijst row, a
// dashboard bar/slice, the panel's "Details" button, or any [data-area-modal]
// element (buurten list, parent wijk link). The figures come from
// area-detail.js (pure); this file builds the markup and runs the dialog.

import { getState, setState, onStateChange, serializeHash } from './state.js';
import { loadRotterdamAreas, areaPanelData } from './areas.js';
import { buildAreaDetail } from './area-detail.js';
import { formatValue } from './dashboard-data.js';
import { originBarHtml } from './herkomst.js';
import { donutSlices, arcPath } from './donut.js';
import { crimeToggleHtml } from './crime-mode.js';
import { infoButton } from './explain.js';
import { outlierLabel } from './scale.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (v, d = 0) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const LEVEL_LABEL = { wijk: 'Wijk', buurt: 'Buurt' };

/** Event the app handles for "Vergelijk": detail { code }. */
export const COMPARE_EVENT = 'area-compare';

/** Shareable link to the area: the current URL with &area=<code>. */
export function areaLink(code, state = getState(), loc = globalThis.location) {
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}${serializeHash({ ...state, scope: 'rotterdam', area: code })}`;
}

function trendText(v) {
  if (v == null) return null;
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nl(Math.abs(v), 1)}%`;
}

function eduDonutHtml(items) {
  if (!items) return '';
  const { slices } = donutSlices(items);
  const paths = slices.map(s => `<path d="${arcPath(40, 40, 38, 24, s.a0, s.a1)}" fill="${s.color}" fill-rule="evenodd"><title>${esc(`${s.label}: ${nl(s.value, 1)}%`)}</title></path>`).join('');
  const label = slices.map(s => `${s.short} ${nl(s.value, 1)}%`).join(', ');
  return `<div class="area-edu"><svg viewBox="0 0 80 80" width="80" height="80" role="img" aria-label="Opleiding: ${esc(label)}">${paths}</svg>
    <ul class="area-edu-legend">${slices.map(s => `<li><i style="background:${s.color}"></i>${esc(s.short)} ${nl(s.value, 1)}%</li>`).join('')}</ul></div>`;
}

/** Full dialog body for a buildAreaDetail() result. */
export function areaModalHtml(d, { dataYears = '' } = {}) {
  if (!d) return '<p class="area-empty">Geen gegevens voor dit gebied.</p>';
  const lvl = d.level === 'wijk' ? 'wijken' : 'buurten';
  const facts = [
    d.population != null ? `${nl(d.population)} inwoners` : null,
    d.density != null ? `${nl(d.density)} inw. per km²` : null,
    d.areaKm2 != null ? `≈ ${nl(d.areaKm2, d.areaKm2 < 10 ? 2 : 1)} km² land` : null,
  ].filter(Boolean).join(' · ');
  const parent = d.parent
    ? ` · in wijk <button type="button" class="area-link" data-area-modal="${esc(d.parent.code)}">${esc(d.parent.name)}</button>` : '';

  const overall = d.overall
    ? `<div class="area-score"><span class="area-score-num">${Math.round(d.overall.score)}</span>
        <span>Totaalscore · <strong>#${d.overall.rank}</strong> van ${d.overall.of} ${lvl}<small>gemiddeld percentiel over ${d.overall.used} van ${d.overall.possible} cijfers met een richting</small></span>
        ${infoButton('score', 'Totaalscore')}</div>` : '';

  const ws = d.woonscore;
  const woonscore = ws
    ? `<div class="area-score area-woonscore"><span class="area-score-num">${Math.round(ws.score)}</span>
        <span>Woonscore${ws.rank ? ` · <strong>#${ws.rank}</strong> van ${ws.of} ${lvl}` : ''}${ws.shrunk ? ' <span class="area-badge" title="Minder dan 300 inwoners: criminaliteit en bijstand zijn naar de wijk toe getrokken">weinig inwoners</span>' : ''}<small>0–100 t.o.v. andere ${lvl}; veiligheid, welvaart, voorzieningen, opleiding en koopwoningen</small></span>
        ${infoButton('woonscore', 'Woonscore')}</div>
      ${ws.plus.length || ws.minus.length ? `<div class="area-ws-why">${ws.plus.length ? `<p class="area-ws-plus"><span>Sterk:</span> ${ws.plus.map(f => esc(f.label)).join(' · ')}</p>` : ''}${ws.minus.length ? `<p class="area-ws-minus"><span>Zwak:</span> ${ws.minus.map(f => esc(f.label)).join(' · ')}</p>` : ''}</div>` : ''}` : '';

  const chips = d.notable.length
    ? `<section class="area-sec"><h3>Opvallend</h3><ul class="area-chips">${d.notable.map(e =>
        `<li class="area-chip is-${e.higherIsBetter == null ? 'neutral' : (e.side === 'high') === e.higherIsBetter ? 'good' : 'bad'}" title="${esc(`${e.title}: ${formatValue(e.value, e.key, d.mode)}`)}">${esc(e.text)}</li>`).join('')}</ul></section>` : '';

  const extras = [];
  if (d.crimeTrend != null) extras.push(`<div class="area-extra"><span class="area-extra-label">Misdrijven 2025 t.o.v. 2024</span><strong class="${d.crimeTrend > 0 ? 'is-bad' : d.crimeTrend < 0 ? 'is-good' : ''}">${trendText(d.crimeTrend)}</strong></div>`);
  const origin = originBarHtml(Object.fromEntries((d.origin ?? []).map(p => [p.key, p.value])));
  if (origin) extras.push(`<div class="area-extra area-extra-wide"><span class="area-extra-label">Herkomst</span>${origin}</div>`);
  if (d.education) extras.push(`<div class="area-extra"><span class="area-extra-label">Opleiding</span>${eduDonutHtml(d.education)}</div>`);
  if (d.outliers.length) extras.push(`<div class="area-extra area-extra-wide"><span class="area-extra-label">Uitschieter</span><p>${d.outliers.map(e => `${esc(e.label)}: ${outlierLabel(e.outlier)}`).join(' · ')}</p></div>`);
  if (dataYears) extras.push(`<div class="area-extra"><span class="area-extra-label">Peiljaar</span><p>${esc(dataYears)} · misdrijven 2025</p></div>`);

  const hasCrime = d.entries.some(e => e.unit === 'misdrijven' || e.key.startsWith('crime'));
  const rows = d.entries.map(e => `<tr${e.extreme ? ' class="is-extreme"' : ''}>
      <th scope="row">${esc(e.label)}${infoButton(e.key, e.label)}</th>
      <td>${esc(formatValue(e.value, e.key, d.mode))}</td>
      <td title="${esc(e.text)}">#${e.rank} <small>/ ${e.of}</small></td>
      <td class="area-pbar-cell"><span class="area-pbar" title="${e.higherIsBetter == null ? 'percentiel (hoog = hoge waarde)' : 'percentielscore (hoog = beter)'}: ${Math.round(e.bar)}"><i style="width:${Math.max(3, Math.round(e.bar))}%"></i></span></td>
      <td>${e.diff ? esc(e.diff.text) : '—'}</td>
    </tr>`).join('');
  const table = d.entries.length ? `<section class="area-sec">
      <div class="area-sec-head"><h3>Alle cijfers</h3>${hasCrime ? crimeToggleHtml(d.mode) : ''}</div>
      <div class="area-table-wrap"><table class="area-table">
        <thead><tr><th scope="col">Cijfer</th><th scope="col">Waarde</th><th scope="col" title="1 = beste; bij beschrijvende cijfers 1 = hoogste">Rang</th><th scope="col">Percentiel</th><th scope="col" title="Verschil met de mediaan van alle ${lvl} in Rotterdam (procentpunten bij percentages)">t.o.v. mediaan</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="area-note">Rang onder ${d.entries[0].of === d.peers ? `alle ${d.peers}` : 'de'} Rotterdamse ${lvl} met een waarde; gebieden zonder cijfer tellen niet mee. Criminaliteit: #1 = minste misdrijven.</p>
    </section>` : '';

  const children = d.children.length
    ? `<section class="area-sec"><h3>Buurten in ${esc(d.name)} (${d.children.length})</h3><ul class="area-children">${d.children.map(b =>
        `<li><button type="button" class="area-link" data-area-modal="${esc(b.code)}">${esc(b.name)}</button></li>`).join('')}</ul></section>` : '';

  return `<header class="area-head">
      <div class="area-head-text">
        <p class="area-kicker">${LEVEL_LABEL[d.level] ?? ''}${parent}</p>
        <h2 id="area-modal-title">${esc(d.name)}</h2>
        ${facts ? `<p class="area-facts">${facts}</p>` : ''}
      </div>
      <button type="button" class="area-close" data-area-close aria-label="Sluiten">&#x2715;</button>
    </header>
    <div class="area-body">
      <div class="area-actions">
        <button type="button" class="area-btn" data-area-action="map">Toon op kaart</button>
        <button type="button" class="area-btn" data-area-action="compare">Vergelijk</button>
        <button type="button" class="area-btn" data-area-action="copy">Kopieer link</button>
      </div>
      ${woonscore}${overall}${chips}
      ${extras.length ? `<section class="area-sec"><div class="area-extras">${extras.join('')}</div></section>` : ''}
      ${table}${children}
    </div>`;
}

// ── Dialog ────────────────────────────────────────────────────────────────────

let els = null;
let current = null;       // code shown
let returnFocus = null;

const isOpen = () => !!els && !els.modal.hidden;

async function render(code) {
  const areas = await loadRotterdamAreas();
  const area = areas.wijken.find(a => a.code === code) ?? areas.buurten.find(a => a.code === code);
  const detail = buildAreaDetail(area, areas, { mode: getState().crime });
  els.dialog.innerHTML = areaModalHtml(detail, { dataYears: area ? areaPanelData(area).dataYears : '' });
  els.dialog.scrollTop = 0;
  els.dialog.querySelector('.area-body')?.scrollTo?.(0, 0);
  return !!area;
}

/** Opens the modal for a wijk (WK…) or buurt (BU…) code; `trigger` gets focus back on close. */
export async function openAreaModal(code, trigger = null) {
  if (!/^(WK|BU)/.test(String(code ?? ''))) return false;
  initAreaModal();
  if (!isOpen()) returnFocus = trigger ?? document.activeElement;
  current = code;
  els.modal.hidden = false;
  document.body.classList.add('area-modal-open');
  const ok = await render(code);
  if (current === code) els.dialog.querySelector('.area-close')?.focus();
  return ok;
}

export function closeAreaModal() {
  if (!isOpen()) return;
  els.modal.hidden = true;
  current = null;
  document.body.classList.remove('area-modal-open');
  if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) returnFocus.focus();
  returnFocus = null;
}

function trapFocus(e) {
  const focusables = [...els.dialog.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && (document.activeElement === first || !els.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

async function copyLink(btn) {
  const url = areaLink(current);
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch { /* no clipboard: show the link instead */ }
  if (!ok) { globalThis.prompt?.('Link naar dit gebied', url); return; }
  const old = btn.textContent;
  btn.textContent = 'Gekopieerd';
  setTimeout(() => { btn.textContent = old; }, 1600);
}

function onAction(action, btn) {
  const code = current;
  if (!code) return;
  if (action === 'copy') { copyLink(btn); return; }
  returnFocus = null;            // focus goes to the map, not back to a hidden view
  closeAreaModal();
  if (action === 'map') {
    if (getState().area === code) setState({ area: null }, { source: 'modal' });
    setState({ area: code, view: 'map', scope: 'rotterdam' }, { source: 'modal' });
  } else if (action === 'compare') {
    document.dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail: { code } }));
  }
}

/** Builds the dialog once and wires every [data-area-modal] trigger. */
export function initAreaModal() {
  if (els || typeof document === 'undefined') return;
  const modal = document.createElement('div');
  modal.id = 'area-modal';
  modal.className = 'search-modal area-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="search-backdrop" data-area-close></div>
    <div class="search-dialog area-dialog" role="dialog" aria-modal="true" aria-labelledby="area-modal-title"></div>`;
  document.body.appendChild(modal);
  els = { modal, dialog: modal.querySelector('.area-dialog') };
  modal.addEventListener('click', e => {
    if (e.target.closest('[data-area-close]')) { closeAreaModal(); return; }
    const act = e.target.closest('[data-area-action]');
    if (act) onAction(act.dataset.areaAction, act);
  });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAreaModal(); return; }
    if (e.key === 'Tab') trapFocus(e);
  });
  document.addEventListener('click', e => {
    const t = e.target.closest?.('[data-area-modal]');
    if (!t) return;
    e.preventDefault();
    openAreaModal(t.dataset.areaModal, modal.contains(t) ? returnFocus : t);
  });
  onStateChange(({ changed }) => {
    if (changed.includes('crime') && isOpen() && current) render(current);
    if (changed.includes('scope') && isOpen()) closeAreaModal();
  });
}
