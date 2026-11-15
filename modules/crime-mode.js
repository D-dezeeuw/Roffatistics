// Crime normalisation switch "Per 1000 inwoners | Absoluut". One state field
// (state.crime: 'rate' | 'abs', mirrored to &crime=abs and localStorage by
// state.js); every toggle on the page is the same markup and stays in sync.
// Shown in the map legend (crime layers only), the Ranglijst and the Dashboard.
import { getState, setState, onStateChange } from './state.js';

export const CRIME_MODE_LABELS = Object.freeze({ rate: 'Per 1000 inwoners', abs: 'Absoluut' });

/** Markup of one segmented toggle with `mode` pressed. */
export function crimeToggleHtml(mode = 'rate') {
  const opt = m => `<button type="button" class="seg-opt${m === mode ? ' active' : ''}" data-crime-mode="${m}" aria-pressed="${m === mode}">${CRIME_MODE_LABELS[m]}</button>`;
  return `<div class="seg crime-toggle" role="group" aria-label="Criminaliteit tonen als" title="Geldt voor alle criminaliteitslagen">${opt('rate')}${opt('abs')}</div>`;
}

/** Marks the pressed option in every toggle under `root`. */
export function syncCrimeToggles(mode, root = globalThis.document) {
  root?.querySelectorAll?.('[data-crime-mode]').forEach(b => {
    const on = b.dataset.crimeMode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

let bound = false;

/** Fills every [data-crime-slot], handles clicks on any toggle (delegated) and keeps them in sync. */
export function initCrimeToggles() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.querySelectorAll('[data-crime-slot]').forEach(el => { el.innerHTML = crimeToggleHtml(getState().crime); });
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('[data-crime-mode]');
    if (btn) setState({ crime: btn.dataset.crimeMode }, { source: 'crime-toggle' });
  });
  onStateChange(({ state, changed }) => { if (changed.includes('crime')) syncCrimeToggles(state.crime); });
}
