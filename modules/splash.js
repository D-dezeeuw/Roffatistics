// Intro splash shown before the map. The map initialises behind it.

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

function getStorage() {
  try { return window.localStorage; } catch { return null; }
}

let splashEl, startBtn, hideBox, lastFocus = null;

export function openSplash() {
  if (!splashEl) return;
  lastFocus = document.activeElement;
  hideBox.checked = !shouldShowSplash(getStorage());
  splashEl.hidden = false;
  splashEl.classList.remove('splash-leaving');
  document.addEventListener('keydown', onKey);
  startBtn.focus();
}

export function closeSplash() {
  if (!splashEl || splashEl.hidden) return;
  rememberSplashChoice(getStorage(), hideBox.checked);
  document.removeEventListener('keydown', onKey);

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    splashEl.hidden = true;
    splashEl.classList.remove('splash-leaving');
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

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSplash(); return; }
  if (e.key === 'Enter' && !e.target.closest?.('a')) { e.preventDefault(); closeSplash(); return; }
  if (e.key === 'Tab') {
    // Keep focus inside the dialog.
    const items = [...splashEl.querySelectorAll('a[href], button, input')];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

export function initSplash() {
  splashEl = document.getElementById('splash');
  if (!splashEl) return;
  startBtn = splashEl.querySelector('.splash-start');
  hideBox  = splashEl.querySelector('.splash-hide');

  startBtn.addEventListener('click', closeSplash);
  document.querySelector('.about-btn')?.addEventListener('click', openSplash);

  if (shouldShowSplash(getStorage())) openSplash();
}
