// "Deel deze weergave" (v0.31.0): the dialog behind the topnav "Delen" button
// and the wizard's "Deellink maken". DOM only; what goes into the link is
// share-link.js (pure). The sensitive ticks stay the page's share choice
// (state.js setShareOptions), so the address bar keeps following them as before.
import { getState, getShareOptions, setShareOptions } from './state.js';
import { getMap, getActiveBasemap } from './map.js';
import { getListOptions } from './list.js';
import { isAreaModalOpen } from './area-modal.js';
import { SHARE_GROUPS, SENSITIVE_KEYS, availableParts, defaultShareOptions, buildShareUrl, partSummary } from './share-link.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let els = null;
let snap = null;          // the screen as it was when the dialog opened
let returnFocus = null;

/** The current screen: app state plus the map, Ranglijst, modal, basemap and theme. */
export function currentSnapshot() {
  const map = getMap();
  let pos = null;
  try { const c = map?.getCenter(); if (c) pos = { lat: c.lat, lng: c.lng, zoom: map.getZoom() }; } catch { /* map not ready */ }
  return {
    state: getState(),
    map: pos,
    modal: isAreaModalOpen(),
    list: getListOptions(),
    basemap: getActiveBasemap() ?? null,
    theme: document.documentElement.dataset.theme || null,
  };
}

function bodyHtml() {
  const av = availableParts(snap), def = defaultShareOptions(snap), shared = getShareOptions();
  return SHARE_GROUPS.map(g => {
    const boxes = g.parts.map(p => {
      const on = g.sensitive ? av[p.key] && av.answers && shared[p.key] : def[p.key];
      const disabled = !av[p.key] || (g.sensitive && !av.answers);
      const sum = partSummary(snap, p.key);
      return `<label class="wiz-check share-check${disabled ? ' is-disabled' : ''}"><input type="checkbox" data-part="${p.key}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}${g.sensitive ? ' data-sensitive="1"' : ''}> <span>${esc(p.label)}${sum ? ` <span class="share-val">· ${esc(sum)}</span>` : ''}</span></label>`;
    }).join('');
    const hint = g.sensitive
      ? '<p class="wiz-hint">Standaard uit. Vink alleen aan wat je echt wilt delen; ook de adresbalk volgt deze keuze. Op dit apparaat blijven al je antwoorden bewaard.</p>'
      : g.id === 'wensen' ? '<p class="wiz-hint">Wie de link opent, ziet de Woonscore met jouw wensen.</p>' : '';
    return `<fieldset class="share-group${g.sensitive ? ' share-sensitive' : ''}"><legend>${esc(g.label)}</legend>${hint}${boxes}</fieldset>`;
  }).join('');
}

function options() {
  const o = {};
  for (const box of els.body.querySelectorAll('input[data-part]')) o[box.dataset.part] = box.checked && !box.disabled;
  return o;
}

function syncSensitive() {
  const answersOn = els.body.querySelector('input[data-part="answers"]')?.checked;
  const av = availableParts(snap);
  for (const box of els.body.querySelectorAll('input[data-sensitive]')) {
    box.disabled = !answersOn || !av[box.dataset.part];
    box.closest('label')?.classList.toggle('is-disabled', box.disabled);
  }
}

/** A changed tick makes the shown link stale: hide it until it is made again. */
function invalidate() {
  if (els.url.hidden) return;
  els.url.hidden = true;
  els.url.value = '';
  els.status.textContent = 'Je keuze is gewijzigd: maak de link opnieuw.';
}

function makeUrl() {
  const o = options();
  setShareOptions(Object.fromEntries(SENSITIVE_KEYS.map(k => [k, o[k] === true])));
  return buildShareUrl(snap, o);
}

async function copyLink() {
  const url = makeUrl();
  els.url.value = url;
  els.url.hidden = false;
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch { /* no Clipboard API or no permission */ }
  if (!ok) { try { els.url.focus(); els.url.select(); ok = document.execCommand('copy'); } catch { ok = false; } }
  if (!ok) els.url.select();
  els.status.textContent = ok ? 'Link gekopieerd.' : 'Kopiëren lukte niet: de link is geselecteerd, kopieer hem zelf (Ctrl/Cmd+C).';
}

async function nativeShare() {
  const url = makeUrl();
  els.url.value = url;
  els.url.hidden = false;
  try { await navigator.share({ title: 'Roffatistics', url }); els.status.textContent = 'Gedeeld.'; }
  catch (err) { if (err?.name !== 'AbortError') els.status.textContent = 'Delen lukte niet; kopieer de link hierboven.'; }
}

function trapFocus(e) {
  const focusables = [...els.dialog.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && (document.activeElement === first || !els.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function build() {
  const modal = document.createElement('div');
  modal.id = 'share-modal';
  modal.className = 'search-modal share-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="search-backdrop" data-share-close></div>
    <div class="search-dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" aria-describedby="share-intro">
      <header class="explain-head">
        <h2 id="share-title">Deel deze weergave</h2>
        <button class="search-close" type="button" data-share-close aria-label="Sluiten">Esc</button>
      </header>
      <div class="share-scroll">
        <p id="share-intro" class="wiz-hint">De link bevat alleen wat hieronder is aangevinkt; de rest opent zoals standaard.</p>
        <div class="share-body"></div>
        <div class="share-actions">
          <button type="button" class="area-btn is-primary" data-share-act="copy">Link maken en kopiëren</button>
          <button type="button" class="area-btn" data-share-act="native" hidden>Delen via…</button>
        </div>
        <input type="text" class="wiz-share-url share-url" readonly aria-label="Deellink" hidden>
        <p class="wiz-hint share-status" aria-live="polite"></p>
      </div>
    </div>`;
  document.body.appendChild(modal);
  els = {
    modal,
    dialog: modal.querySelector('.share-dialog'),
    body: modal.querySelector('.share-body'),
    url: modal.querySelector('.share-url'),
    status: modal.querySelector('.share-status'),
    native: modal.querySelector('[data-share-act="native"]'),
  };
  els.native.hidden = typeof navigator.share !== 'function';
  modal.addEventListener('click', e => {
    if (e.target.closest('[data-share-close]')) return closeShareDialog();
    const act = e.target.closest('[data-share-act]')?.dataset.shareAct;
    if (act === 'copy') copyLink();
    else if (act === 'native') nativeShare();
  });
  modal.addEventListener('change', e => {
    if (!e.target.dataset?.part) return;
    if (e.target.dataset.part === 'answers') syncSensitive();
    invalidate();
  });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeShareDialog(); return; }
    if (e.key === 'Tab') trapFocus(e);
  });
}

/** Opens the dialog for the current screen; `focus` = a part key to focus first (e.g. 'answers'). */
export function openShareDialog({ trigger = null, focus = null } = {}) {
  if (typeof document === 'undefined') return;
  if (!els) build();
  snap = currentSnapshot();
  returnFocus = trigger ?? document.activeElement;
  els.body.innerHTML = bodyHtml();
  syncSensitive();
  els.url.hidden = true;
  els.url.value = '';
  els.status.textContent = '';
  els.modal.hidden = false;
  const target = (focus && els.body.querySelector(`input[data-part="${focus}"]:not(:disabled)`))
    ?? els.body.querySelector('input:not(:disabled)') ?? els.dialog.querySelector('[data-share-act="copy"]');
  target?.focus();
}

export function closeShareDialog() {
  if (!els || els.modal.hidden) return;
  els.modal.hidden = true;
  if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) returnFocus.focus();
  returnFocus = null;
}

/** Wires the topnav "Delen" button. */
export function initShare() {
  document.querySelector('.share-btn')?.addEventListener('click', e => openShareDialog({ trigger: e.currentTarget }));
}
