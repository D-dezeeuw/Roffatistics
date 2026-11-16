// "Stapel samenstellen" (docs/plan-laagstapel.md §2): the dialog that builds
// Mijn stapel. Lists the stackable layers by their dropdown groups; a checked
// layer shows its direction toggle and weight 1–3. "Toon op kaart" writes
// state.stack and shows the `stapel` layer. Opened from the Layers dropdown
// entry, the legend ("+ Stapel" adds the shown layer, "Bewerken") and the
// area modal. The model (parse, status, texts) is modules/stapel.js.
import { getState, setState } from './state.js';
import { groupDatasets, datasetInScope } from './datasets.js';
import { STACK_KEY, STACK_DIRS, STACK_WEIGHTS, STACK_MAX, isStackable, defaultDirection, parseStack, serializeStack, stackDraftStatus } from './stapel.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let els = null;
let draft = [];            // [{ key, dir: 'h'|'l'|null, weight }] in the order the layers were ticked
let returnFocus = null;

/** Layers the builder offers in `scope`, per dropdown group; layers already in `draft` stay listed. */
export function builderGroups(scope, draftKeys = []) {
  return groupDatasets()
    .map(g => ({ key: g.key, label: g.label, datasets: g.datasets.filter(d => isStackable(d.key) && (datasetInScope(d.key, scope) || draftKeys.includes(d.key))) }))
    .filter(g => g.datasets.length);
}

/** Body HTML of the builder for `draft` in `scope` (pure; tests/stapel.test.js). */
export function builderBodyHtml(draftList, scope) {
  const byKey = new Map(draftList.map(d => [d.key, d]));
  return builderGroups(scope, [...byKey.keys()]).map(g => `
    <fieldset class="share-group stack-group"><legend>${esc(g.label)}</legend>${g.datasets.map(d => {
      const it = byKey.get(d.key);
      const dirBtn = dir => `<button type="button" class="seg-opt${it?.dir === dir ? ' active' : ''}" data-stack-dir="${dir}" aria-pressed="${it?.dir === dir}">${dir === 'h' ? '↑' : '↓'} ${STACK_DIRS[dir]}</button>`;
      const neutral = defaultDirection(d.key) == null;
      return `<div class="stack-row${it ? ' is-on' : ''}" data-stack-key="${esc(d.key)}">
        <label class="wiz-check stack-check"><input type="checkbox" data-stack-check${it ? ' checked' : ''}> <span>${esc(d.label)}</span></label>
        <div class="stack-controls"${it ? '' : ' hidden'}>
          <div class="seg stack-dir" role="group" aria-label="Richting voor ${esc(d.label)}">${dirBtn('h')}${dirBtn('l')}</div>
          <label class="stack-weight">Gewicht <select data-stack-weight aria-label="Gewicht voor ${esc(d.label)}">${STACK_WEIGHTS.map(w => `<option value="${w}"${(it?.weight ?? 1) === w ? ' selected' : ''}>${w}</option>`).join('')}</select></label>
          ${neutral ? '<span class="stack-neutral">Geen vaste richting: kies zelf</span>' : ''}
        </div>
      </div>`;
    }).join('')}</fieldset>`).join('');
}

/** The draft as the dialog opens: the current stack, plus `add` (with its default direction) when given. */
export function initialDraft(stack, add = null) {
  const list = (parseStack(stack) ?? []).map(i => ({ ...i }));
  if (add && isStackable(add) && !list.some(i => i.key === add) && list.length < STACK_MAX) list.push({ key: add, dir: defaultDirection(add), weight: 1 });
  return list;
}

function syncFooter() {
  const st = stackDraftStatus(draft);
  els.status.textContent = st.text;
  els.apply.disabled = !st.valid;
  els.modal.querySelectorAll('.stack-row:not(.is-on) [data-stack-check]').forEach(cb => { cb.disabled = draft.length >= STACK_MAX; });
}

function onBodyClick(e) {
  const row = e.target.closest('.stack-row');
  if (!row) return;
  const key = row.dataset.stackKey;
  const dirBtn = e.target.closest('[data-stack-dir]');
  if (dirBtn) {
    const it = draft.find(d => d.key === key);
    if (!it) return;
    it.dir = dirBtn.dataset.stackDir;
    row.querySelectorAll('[data-stack-dir]').forEach(b => { const on = b === dirBtn; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    syncFooter();
  }
}

function onBodyChange(e) {
  const row = e.target.closest('.stack-row');
  if (!row) return;
  const key = row.dataset.stackKey;
  if (e.target.matches('[data-stack-check]')) {
    if (e.target.checked) {
      if (!draft.some(d => d.key === key)) draft.push({ key, dir: defaultDirection(key), weight: Number(row.querySelector('[data-stack-weight]').value) || 1 });
      const dir = draft.find(d => d.key === key).dir;
      row.querySelectorAll('[data-stack-dir]').forEach(b => { const on = b.dataset.stackDir === dir; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    } else draft = draft.filter(d => d.key !== key);
    row.classList.toggle('is-on', e.target.checked);
    row.querySelector('.stack-controls').hidden = !e.target.checked;
    syncFooter();
  } else if (e.target.matches('[data-stack-weight]')) {
    const it = draft.find(d => d.key === key);
    if (it) it.weight = Number(e.target.value) || 1;
  }
}

function apply() {
  const stack = serializeStack(draft);
  if (!stack) return;
  closeStackBuilder();
  setState({ stack, dataset: STACK_KEY }, { source: 'stack' });
}

function clearStack() {
  closeStackBuilder();
  const patch = { stack: null };
  if (getState().dataset === STACK_KEY) patch.dataset = 'woonscore';
  setState(patch, { source: 'stack' });
}

function trapFocus(e) {
  const focusables = [...els.dialog.querySelectorAll('button, input, select')].filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function build() {
  const modal = document.createElement('div');
  modal.id = 'stack-modal';
  modal.className = 'search-modal share-modal stack-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="search-backdrop" data-stack-close></div>
    <div class="search-dialog share-dialog stack-dialog" role="dialog" aria-modal="true" aria-labelledby="stack-title" aria-describedby="stack-intro">
      <header class="explain-head">
        <h2 id="stack-title">Stapel samenstellen</h2>
        <button class="search-close" type="button" data-stack-close aria-label="Sluiten">Esc</button>
      </header>
      <div class="share-scroll">
        <p id="stack-intro" class="wiz-hint">Kies 2 tot 6 lagen. Per laag: is hoger of lager beter, en hoe zwaar telt hij (1–3)? Mijn stapel is het gewogen gemiddelde van hun scores, 0–100 binnen de gebieden op de kaart. Los van de Woonscore.</p>
        <div class="stack-body"></div>
      </div>
      <footer class="stack-foot">
        <span class="stack-status" aria-live="polite"></span>
        <button type="button" class="area-btn" data-stack-clear>Wis stapel</button>
        <button type="button" class="area-btn is-primary" data-stack-apply>Toon op kaart</button>
      </footer>
    </div>`;
  document.body.appendChild(modal);
  els = {
    modal,
    dialog: modal.querySelector('.stack-dialog'),
    body: modal.querySelector('.stack-body'),
    status: modal.querySelector('.stack-status'),
    apply: modal.querySelector('[data-stack-apply]'),
    clear: modal.querySelector('[data-stack-clear]'),
  };
  modal.addEventListener('click', e => { if (e.target.closest('[data-stack-close]')) closeStackBuilder(); });
  els.body.addEventListener('click', onBodyClick);
  els.body.addEventListener('change', onBodyChange);
  els.apply.addEventListener('click', apply);
  els.clear.addEventListener('click', clearStack);
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeStackBuilder(); }
    else if (e.key === 'Tab') trapFocus(e);
  });
}

export const isStackBuilderOpen = () => !!els && !els.modal.hidden;

/** Opens the builder on the current stack; `add` ticks that layer too (legend "+ Stapel"). */
export function openStackBuilder({ add = null, trigger = null } = {}) {
  if (typeof document === 'undefined') return;
  if (!els) build();
  const { stack, scope } = getState();
  draft = initialDraft(stack, add);
  returnFocus = trigger ?? document.activeElement;
  els.body.innerHTML = builderBodyHtml(draft, scope);
  els.clear.hidden = !stack;
  syncFooter();
  els.modal.hidden = false;
  (els.body.querySelector(add ? `[data-stack-key="${add}"] [data-stack-dir]` : '[data-stack-check]') ?? els.apply).focus();
}

export function closeStackBuilder() {
  if (!isStackBuilderOpen()) return;
  els.modal.hidden = true;
  if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) returnFocus.focus();
  returnFocus = null;
}

let bound = false;
/** Delegated: any [data-stack-open] opens the builder, [data-stack-add] opens it with that layer ticked. */
export function initStackBuilder() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', e => {
    const open = e.target.closest?.('[data-stack-open], [data-stack-add]');
    if (!open) return;
    e.preventDefault();
    openStackBuilder({ add: open.dataset.stackAdd ?? null, trigger: open });
  });
}
