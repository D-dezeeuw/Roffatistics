// Intro splash shown before the map. The map initialises behind it.
// Three cards: "Jouw buurt" (search → Ranglijst + area modal), "Jouw ideale
// woonplek" (wizard) and "Cijfers & dashboard" (dashboard, Uitleg).
import { getState, setState } from './state.js';
import { createResultBox, ensureIndex, ROTTERDAM_GM } from './search.js';

export const SPLASH_STORAGE_KEY = 'roffatistics.splash.hidden';

/** True unless the visitor ticked "Niet meer tonen". Storage errors show the splash. */
export function shouldShowSplash(storage) {
  try {
    return storage?.getItem(SPLASH_STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Stores or clears the "Niet meer tonen" choice; ignores storage errors. */
export function rememberSplashChoice(storage, hide) {
  try {
    if (hide) storage?.setItem(SPLASH_STORAGE_KEY, '1');
    else      storage?.removeItem(SPLASH_STORAGE_KEY);
  } catch { /* private mode / blocked storage */ }
}

const AREA_CODE = /^(PV\d{2}|GM\d{4}|WK\d{4}[0-9A-Z]{2}|BU\d{4}[0-9A-Z]{4})$/;   // as state.js AREA_RE (Amsterdam: WK0363AA)

/**
 * A search item → where the splash sends it: { view: 'list', scope, level,
 * area, highlight, modal }. `level` is the Ranglijst level that lists it,
 * `highlight` the row to flash, `modal` the wijk/buurt whose detail modal opens.
 * Rotterdam wijken/buurten → Rotterdam scope. Other NL wijken/buurten (postcode
 * hits) have no Ranglijst level: their gemeente row is highlighted and the
 * modal shows the wijk/buurt itself. GM0599 is the whole city: Rotterdam wijken.
 * Null for an unknown code.
 */
export function splashTarget(item) {
  const code = String(item?.code ?? '').toUpperCase();
  if (!AREA_CODE.test(code)) return null;
  const base = { view: 'list', area: null, highlight: null, modal: null };
  if (code === ROTTERDAM_GM) return { ...base, scope: 'rotterdam', level: 'wijken' };
  if (/^(WK|BU)/.test(code)) {
    const level = code.startsWith('BU') ? 'buurten' : 'wijken';
    if (code.slice(2, 6) === '0599') return { ...base, scope: 'rotterdam', level, area: code, highlight: code, modal: code };
    const gm = `GM${code.slice(2, 6)}`;
    return { ...base, scope: 'nederland', level: 'gemeenten', area: gm, highlight: gm, modal: code };
  }
  const level = code.startsWith('GM') ? 'gemeenten' : 'provincies';
  return { ...base, scope: 'nederland', level, area: code, highlight: code };
}

/** The state patches that show `target`: an `area: null` first when re-picking the current area (so it still changes). */
export function splashPatches(target, state) {
  if (!target) return [];
  const patch = { scope: target.scope, view: target.view, area: target.area };
  const repick = target.area && state.area === target.area && state.scope === target.scope;
  return repick ? [{ area: null }, patch] : [patch];
}

function getStorage() {
  try { return window.localStorage; } catch { return null; }
}

let splashEl, hideBox, primaryBtn, buurtInput, buurtResults, buurtBox, lastFocus = null;
const SCOPE_SWITCH_MS = 400;   // like search.js: a scope switch re-renders the list first

export function openSplash() {
  if (!splashEl) return;
  lastFocus = document.activeElement;
  hideBox.checked = !shouldShowSplash(getStorage());
  splashEl.hidden = false;
  splashEl.classList.remove('splash-leaving');
  buurtInput.value = '';
  showResults(false);
  document.addEventListener('keydown', onKey);
  primaryBtn.focus();
}

/** Closes the splash; `restoreFocus: false` when the caller moves focus itself (wizard, list, Uitleg). */
export function closeSplash({ restoreFocus = true } = {}) {
  if (!splashEl || splashEl.hidden) return;
  rememberSplashChoice(getStorage(), hideBox.checked);
  document.removeEventListener('keydown', onKey);
  showResults(false);

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    splashEl.hidden = true;
    splashEl.classList.remove('splash-leaving');
    if (!restoreFocus) return;
    if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body) lastFocus.focus();
    else document.getElementById('map')?.focus();
  };
  if (reduced) return finish();

  splashEl.classList.add('splash-leaving');
  let done = false;
  const once = () => { if (!done) { done = true; finish(); } };
  splashEl.addEventListener('transitionend', once, { once: true });
  setTimeout(once, 450); // fallback when transitionend does not fire
}

function showResults(on) {
  if (!buurtResults) return;
  buurtResults.hidden = !on;
  buurtInput.setAttribute('aria-expanded', on && buurtResults.querySelector('[role="option"]') ? 'true' : 'false');
}

/** "Jouw buurt": close the splash, open the Ranglijst on the area's level, highlight its row, open its modal. */
async function goToArea(item) {
  const target = splashTarget(item);
  if (!target) return;
  closeSplash({ restoreFocus: false });
  const before = getState();
  for (const patch of splashPatches(target, before)) setState(patch, { source: 'splash' });
  if (before.scope !== target.scope) await new Promise(r => setTimeout(r, SCOPE_SWITCH_MS));
  const [list, modal] = await Promise.all([import('./list.js'), import('./area-modal.js')]);
  if (target.highlight) await list.highlightArea(target.highlight);
  const row = document.querySelector('#view-list tr.is-selected');
  if (target.modal) modal.openAreaModal(target.modal, row);
  else row?.focus?.();
}

function onBuurtCta() {
  if (buurtBox.chooseActive()) return;
  if (!buurtInput.value.trim()) { buurtInput.focus(); return; }
  // Typed but nothing matched: the Ranglijst is the next best place to look.
  closeSplash({ restoreFocus: false });
  setState({ view: 'list' }, { source: 'splash' });
  document.getElementById('view-list')?.querySelector('button, [tabindex]')?.focus();
}

async function openWizardFromSplash() {
  closeSplash({ restoreFocus: false });
  const { openWizard } = await import('./wizard.js');
  openWizard({ trigger: document.querySelector('.wizard-btn') });
}

function openDashboardFromSplash() {
  closeSplash({ restoreFocus: false });
  setState({ view: 'dashboard' }, { source: 'splash' });
  document.querySelector('.view-opt[data-view="dashboard"]')?.focus();
}

async function openExplainFromSplash() {
  closeSplash({ restoreFocus: false });
  document.querySelector('.explain-btn')?.focus();   // where the Uitleg returns focus on close
  const { openExplain } = await import('./explain.js');
  openExplain();
}

function onKey(e) {
  if (e.target === buurtInput) {
    if (e.key === 'Escape' && !buurtResults.hidden) { e.preventDefault(); showResults(false); return; }
    if (e.key === 'Enter' && !buurtInput.value.trim()) { e.preventDefault(); return; }
    if (buurtBox.onKey(e)) return;
  }
  if (e.key === 'Escape') { e.preventDefault(); closeSplash(); return; }
  if (e.key === 'Tab') {
    // Keep focus inside the dialog.
    const items = [...splashEl.querySelectorAll('a[href], button, input')].filter(el => !el.disabled && el.offsetParent !== null);
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

export function initSplash() {
  splashEl = document.getElementById('splash');
  if (!splashEl) return;
  hideBox      = splashEl.querySelector('.splash-hide');
  primaryBtn   = splashEl.querySelector('[data-splash="wizard"]');
  buurtInput   = splashEl.querySelector('#splash-search');
  buurtResults = splashEl.querySelector('#splash-results');

  buurtBox = createResultBox({
    input: buurtInput,
    list: buurtResults,
    hint: splashEl.querySelector('.splash-search-hint'),
    idPrefix: 'splash-opt',
    isLive: () => !splashEl.hidden,
    onChoose: goToArea,
    onRender: n => showResults(n > 0 && document.activeElement === buurtInput),
  });
  buurtInput.addEventListener('focus', () => { ensureIndex(); buurtBox.render(); });
  buurtInput.addEventListener('blur', () => showResults(false));

  splashEl.querySelector('[data-splash="buurt"]').addEventListener('click', onBuurtCta);
  primaryBtn.addEventListener('click', openWizardFromSplash);
  splashEl.querySelector('[data-splash="dashboard"]').addEventListener('click', openDashboardFromSplash);
  splashEl.querySelector('[data-splash="explain"]').addEventListener('click', openExplainFromSplash);
  splashEl.querySelector('.splash-start').addEventListener('click', () => closeSplash());
  document.querySelector('.about-btn')?.addEventListener('click', openSplash);
  document.querySelector('.nav-title')?.addEventListener('click', openSplash);   // logo = home: the title screen

  if (shouldShowSplash(getStorage())) openSplash();
}
