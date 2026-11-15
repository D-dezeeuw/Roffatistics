// "Vind jouw ideale woonplek": the wizard dialog (steps 1–5 + result) and the
// Standaard / Gelijk / Jouw score switcher in the legend. Answers, presets and
// the hash form live in wizard-model.js (pure); this file is DOM only.
//
// Applying answers = setState({ score, dataset: 'jouwscore' }). app.js reacts
// to the `score` change (setPersonalPreset + rescoring every area) before this
// module renders the result, because app.js subscribed first.

import { getState, setState, onStateChange } from './state.js';
import { loadRotterdamAreas, peekRotterdamAreas, getAreaIndex } from './areas.js';
import { getRotterdamLevel } from './rotterdam.js';
import { scoreResult, getPersonalPreset, THEME_LABELS } from './presets.js';
import { explain } from './score.js';
import { openAreaModal } from './area-modal.js';
import { infoButton } from './explain.js';
import {
  STEPS, LEVENSFASEN, OUD_OPTIONS, VERVOER, CRIMES, INCOME_FACTOR, TOO_EXPENSIVE_SHARE,
  EMPTY_ANSWERS, normalizeAnswers, encodeAnswers, decodeAnswers, budgetCeiling, scoreKind,
  loadAnswers, saveAnswers, topAreas, describeAnswers, parseEuroK,
} from './wizard-model.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (v, d = 0) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

const STEP_TITLES = { levensfase: 'Levensfase', budget: 'Budget', vervoer: 'Vervoer', sfeer: 'Sfeer', veiligheid: 'Veiligheid' };

let els = null;
let step = 0;                 // 0..4, or 'result'
let answers = normalizeAnswers(EMPTY_ANSWERS);
let returnFocus = null;
let nationalRows = () => ({ level: 'provincie', rows: [] });

const isOpen = () => !!els && !els.modal.hidden;

// ── step markup ───────────────────────────────────────────────────────────────

const optBtn = (set, value, label, on) =>
  `<button type="button" class="wiz-opt${on ? ' active' : ''}" data-set="${set}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
const chip = (set, value, label, on) =>
  `<button type="button" class="wiz-chip${on ? ' active' : ''}" data-toggle="${set}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;

function stepBody(key) {
  const a = answers;
  if (key === 'levensfase') return `
    <p class="wiz-q" id="wiz-q">In welke fase van je leven zit je?</p>
    <div class="wiz-opts" role="group" aria-labelledby="wiz-q">${Object.entries(LEVENSFASEN).map(([k, l]) => optBtn('levensfase', k, l, a.levensfase === k)).join('')}</div>
    <p class="wiz-q" id="wiz-q2">Liever geen ‘oude’ buurt? Bedoel je dan de bewoners of de gebouwen?</p>
    <div class="wiz-opts" role="group" aria-labelledby="wiz-q2">${Object.entries(OUD_OPTIONS).map(([k, l]) => optBtn('oud', k, l, a.oud === k)).join('')}${optBtn('oud', '', 'Maakt niet uit', !a.oud)}</div>
    <p class="wiz-hint">Jonge bewoners: minder 65-plussers. Nieuwe woningen: meer woningen jonger dan 10 jaar (alleen Rotterdam).</p>`;
  if (key === 'budget') {
    const b = a.budget ?? { mode: null };
    const ceiling = budgetCeiling(b);
    return `
    <p class="wiz-q" id="wiz-q">Ga je huren of kopen?</p>
    <div class="wiz-opts" role="group" aria-labelledby="wiz-q">${optBtn('mode', 'huur', 'Huren', b.mode === 'huur')}${optBtn('mode', 'koop', 'Kopen', b.mode === 'koop')}</div>
    ${b.mode === 'huur' ? '<p class="wiz-hint">Buurten met meer huurwoningen tellen zwaarder (in plaats van koopwoningen).</p>' : ''}
    ${b.mode === 'koop' ? `
    <div class="wiz-fields">
      <label class="wiz-field">Bruto huishoudinkomen per jaar
        <input type="text" inputmode="numeric" autocomplete="off" data-field="income" value="${b.income != null ? esc(nl(b.income * 1000)) : ''}" placeholder="bijv. 60.000"></label>
      <label class="wiz-field">of: maximale koopprijs
        <input type="text" inputmode="numeric" autocomplete="off" data-field="maxPrice" value="${b.maxPrice != null ? esc(nl(b.maxPrice * 1000)) : ''}" placeholder="bijv. 350.000"></label>
    </div>
    <p class="wiz-hint" aria-live="polite">${ceiling != null ? `Budget ≈ <strong>€ ${nl(Math.round(ceiling) * 1000)}</strong>. ` : ''}Ruwe vuistregel: je leent ongeveer ${nl(INCOME_FACTOR, 1)} × je bruto jaarinkomen. We vergelijken met de gemiddelde WOZ-waarde; echte vraagprijzen liggen vaak hoger.</p>
    <label class="wiz-check"><input type="checkbox" data-field="hide"${b.hide ? ' checked' : ''}${ceiling == null ? ' disabled' : ''}> Verberg duidelijk te duur (WOZ boven ${nl(TOO_EXPENSIVE_SHARE, 1)} × je budget wordt grijs)</label>` : ''}`;
  }
  if (key === 'vervoer') return `
    <p class="wiz-q" id="wiz-q">Hoe kom je meestal ergens? Kies er meer als je wilt.</p>
    <div class="wiz-chips" role="group" aria-labelledby="wiz-q">${Object.entries(VERVOER).map(([k, l]) => chip('vervoer', k, l, a.vervoer.includes(k))).join('')}</div>
    <p class="wiz-hint">Fiets: fietsendiefstal telt drie keer zwaarder. OV: afstand tot een treinstation. Auto: diefstal uit auto’s en liever minder dichtbebouwd. Lopen: huisarts en supermarkt dichtbij.</p>`;
  if (key === 'sfeer') {
    const v = a.sfeer ?? 50;
    return `
    <p class="wiz-q" id="wiz-q">Hoe wil je wonen?</p>
    <div class="wiz-range">
      <input type="range" min="0" max="100" step="5" value="${v}" data-field="sfeer" aria-labelledby="wiz-q" aria-valuetext="${esc(sfeerText(v))}">
      <div class="wiz-range-ends"><span>Midden in de drukte</span><span>Rustig wonen</span></div>
    </div>
    <p class="wiz-hint"><span class="wiz-sfeer-now" aria-live="polite">${a.sfeer == null ? 'Schuif om te kiezen; nog niet gekozen' : esc(sfeerText(v))}</span>. Drukte = bevolkingsdichtheid en afstand tot Rotterdam Centraal, aan de drukke kant ook horeca dichtbij. Relatief: “rustig” is rustig voor deze lijst.</p>`;
  }
  return `
    <p class="wiz-q" id="wiz-q">Welke misdrijven wegen voor jou het zwaarst?</p>
    <div class="wiz-chips" role="group" aria-labelledby="wiz-q">${Object.entries(CRIMES).map(([k, c]) => chip('veiligheid', k, c.label, a.veiligheid.includes(k))).join('')}</div>
    <p class="wiz-hint">Gekozen misdrijven tellen drie keer zwaarder binnen Veiligheid. Per soort misdrijf is er alleen data voor Rotterdamse wijken en buurten.</p>`;
}

function sfeerText(v) {
  return v <= 15 ? 'Midden in de drukte' : v < 40 ? 'Levendig' : v <= 60 ? 'Tussen druk en rustig' : v < 85 ? 'Rustig' : 'Heel rustig';
}

function stepHtml(i) {
  const key = STEPS[i];
  const last = i === STEPS.length - 1;
  return `<header class="wiz-head">
      <div><p class="wiz-kicker">Vind jouw ideale woonplek · stap ${i + 1} van ${STEPS.length}</p><h2 id="wizard-title">${STEP_TITLES[key]}</h2></div>
      <button type="button" class="area-close" data-wiz="close" aria-label="Sluiten">&#x2715;</button>
    </header>
    <div class="wiz-progress" aria-hidden="true"><i style="width:${(100 * (i + 1)) / STEPS.length}%"></i></div>
    <div class="wiz-body" data-step="${key}">${stepBody(key)}</div>
    <footer class="wiz-foot">
      ${i > 0 ? '<button type="button" class="area-btn" data-wiz="back">Terug</button>' : '<span></span>'}
      <div class="wiz-foot-right">
        <button type="button" class="area-btn" data-wiz="skip" title="Deze vraag telt niet mee: de Standaard-gewichten blijven">Overslaan</button>
        <button type="button" class="area-btn is-primary" data-wiz="next">${last ? 'Bekijk resultaat' : 'Volgende'}</button>
      </div>
    </footer>`;
}

// ── result markup ─────────────────────────────────────────────────────────────

/** Switcher markup (legend and result): which score the map shows. */
export function switcherHtml(state = getState()) {
  const active = state.dataset === 'woonscore' ? 'standaard' : state.dataset === 'jouwscore' ? (scoreKind(state.score) === 'gelijk' ? 'gelijk' : 'custom') : null;
  const opt = (k, label, title) => `<button type="button" class="seg-opt${active === k ? ' active' : ''}" data-score-preset="${k}" aria-pressed="${active === k}" title="${esc(title)}">${label}</button>`;
  return `<div class="seg score-switch" role="group" aria-label="Score">
    ${opt('standaard', 'Standaard', 'Woonscore: gemiddeld prettige omstandigheden')}${opt('gelijk', 'Gelijk', 'Alle cijfers met een richting even zwaar')}${opt('custom', 'Jouw score', 'Met jouw antwoorden uit de wizard')}</div>`;
}

async function resultItems() {
  if (getState().scope === 'rotterdam') {
    const areas = peekRotterdamAreas() ?? await loadRotterdamAreas();
    const level = getRotterdamLevel() === 'buurt' ? 'buurten' : 'wijken';
    return { level, items: areas[level].map(a => ({ code: a.code, name: a.name })) };
  }
  const { level, rows } = nationalRows();
  const index = await getAreaIndex().catch(() => []);
  const names = new Map(index.map(e => [e.code, e.name]));
  return { level: level === 'gemeente' ? 'gemeenten' : 'provincies', items: rows.map(r => ({ code: r.regionCode, name: names.get(r.regionCode) ?? r.regionCode })) };
}

function themeSliders() {
  const preset = getPersonalPreset();
  return (preset.themes ?? []).map(t => `
    <label class="wiz-slider"><span>${esc(THEME_LABELS[t.key] ?? t.label)}</span>
      <input type="range" min="0" max="100" step="5" value="${t.weight}" data-theme="${t.key}" aria-valuetext="gewicht ${t.weight}">
      <output>${t.weight}</output></label>`).join('');
}

async function resultHtml() {
  const state = getState();
  const kind = scoreKind(state.score);
  const { level, items } = await resultItems();
  const withScores = items.map(i => {
    const r = scoreResult('jouwscore', i.code);
    return { ...i, score: r?.score ?? null, filtered: !!r?.filtered, std: scoreResult('woonscore', i.code)?.score ?? null };
  });
  const top = topAreas(withScores, 10);
  const stdRank = new Map(topAreas(withScores.map(i => ({ ...i, score: i.std, filtered: false })), Infinity).map(i => [i.code, i.rank]));
  const hidden = withScores.filter(i => i.filtered).length;
  const levelLabel = { wijken: 'wijken', buurten: 'buurten', gemeenten: 'gemeenten', provincies: 'provincies' }[level];
  const summary = kind === 'gelijk' ? 'Gelijk gewogen: alle cijfers met een richting tellen even zwaar.'
    : kind === 'standaard' ? 'Geen antwoorden: Jouw score is gelijk aan de Woonscore (Standaard).'
    : describeAnswers(answers) || 'Alleen eigen gewichten.';
  const list = top.length ? `<ol class="wiz-top">${top.map(i => {
    const why = explain(scoreResult('jouwscore', i.code), { top: 3 });
    const sr = stdRank.get(i.code);
    return `<li>
      <span class="wiz-top-rank">${i.rank}</span>
      <div class="wiz-top-main">
        <button type="button" class="area-link wiz-top-name" data-wiz-area="${esc(i.code)}">${esc(i.name)}</button>
        ${why.plus.length ? `<p class="area-ws-plus"><span>+</span> ${why.plus.map(f => esc(f.label)).join(' · ')}</p>` : ''}
        ${why.minus.length ? `<p class="area-ws-minus"><span>−</span> ${why.minus.map(f => esc(f.label)).join(' · ')}</p>` : ''}
      </div>
      <div class="wiz-top-score"><strong>${Math.round(i.score)}%</strong><small title="Woonscore (Standaard) en rang daarop">Std ${i.std != null ? `${Math.round(i.std)}${sr ? ` · #${sr}` : ''}` : '—'}</small></div>
    </li>`;
  }).join('')}</ol>` : '<p class="wiz-hint">Nog geen scores: de cijfers worden geladen of er is te weinig data op dit niveau.</p>';
  return `<header class="wiz-head">
      <div><p class="wiz-kicker">Vind jouw ideale woonplek · resultaat</p><h2 id="wizard-title">Top 10 ${esc(levelLabel)}</h2></div>
      <button type="button" class="area-close" data-wiz="close" aria-label="Sluiten">&#x2715;</button>
    </header>
    <div class="wiz-body wiz-result">
      <div class="wiz-result-head">${switcherHtml(state)}${infoButton('jouwscore', 'Jouw score')}</div>
      <p class="wiz-summary">${esc(summary)}</p>
      ${hidden ? `<p class="wiz-hint">${hidden} ${esc(levelLabel)} boven je budget zijn verborgen (grijs op de kaart).</p>` : ''}
      ${list}
      <p class="wiz-hint">Match = Jouw score, 0–100 t.o.v. de andere ${esc(levelLabel)} op de kaart. Std = de Woonscore (Standaard) ter vergelijking.</p>
      ${kind === 'custom' || kind === 'standaard' ? `<details class="wiz-tune"${kind === 'custom' ? ' open' : ''}><summary>Gewichten per thema bijstellen</summary><div class="wiz-sliders">${themeSliders()}</div></details>` : ''}
    </div>
    <footer class="wiz-foot">
      <button type="button" class="area-btn" data-wiz="restart">Antwoorden aanpassen</button>
      <div class="wiz-foot-right">
        <button type="button" class="area-btn" data-wiz="compare">${state.dataset === 'woonscore' ? 'Terug naar Jouw score' : 'Vergelijk met Standaard'}</button>
        <button type="button" class="area-btn is-primary" data-wiz="map">Bekijk op kaart</button>
      </div>
    </footer>`;
}

// ── rendering and actions ─────────────────────────────────────────────────────

let renderSeq = 0;
async function render({ focus = null } = {}) {
  const seq = ++renderSeq;
  const html = step === 'result' ? await resultHtml() : stepHtml(step);
  if (seq !== renderSeq || !els) return;
  els.dialog.innerHTML = html;
  const target = (focus && els.dialog.querySelector(focus)) ?? els.dialog.querySelector('.wiz-body .active, .wiz-body button, .wiz-body input') ?? els.dialog.querySelector('[data-wiz="close"]');
  target?.focus();
}

/** Applies the answers: the map switches to Jouw score with them; empty answers = Standaard. */
function applyAnswers() {
  const s = encodeAnswers(answers);
  saveAnswers(storage(), answers);
  setState({ score: s || null, dataset: 'jouwscore' }, { source: 'wizard' });
}

function clearStep(key) {
  if (key === 'levensfase') answers = { ...answers, levensfase: null, oud: null };
  else if (key === 'budget') answers = { ...answers, budget: null };
  else if (key === 'vervoer') answers = { ...answers, vervoer: [] };
  else if (key === 'sfeer') answers = { ...answers, sfeer: null };
  else if (key === 'veiligheid') answers = { ...answers, veiligheid: [] };
}

function go(next) {
  if (next === 'result' || next >= STEPS.length) { step = 'result'; applyAnswers(); }
  else step = Math.max(0, next);
  render();
}

/** Picks a switcher option (legend or result). */
export function choosePreset(kind) {
  if (kind === 'standaard') { setState({ dataset: 'woonscore' }, { source: 'wizard' }); return; }
  if (kind === 'gelijk') { setState({ score: 'gelijk', dataset: 'jouwscore' }, { source: 'wizard' }); return; }
  const cur = getState().score;
  const custom = scoreKind(cur) === 'custom' ? cur : encodeAnswers(loadAnswers(storage()) ?? answers);
  if (custom) setState({ score: custom, dataset: 'jouwscore' }, { source: 'wizard' });
  else openWizard();   // no answers yet: ask them
}

function onClick(e) {
  const t = e.target;
  if (t.closest('[data-wiz-backdrop]')) { closeWizard(); return; }
  const preset = t.closest('[data-score-preset]');
  if (preset) { choosePreset(preset.dataset.scorePreset); return; }
  const areaBtn = t.closest('[data-wiz-area]');
  if (areaBtn) { openArea(areaBtn.dataset.wizArea); return; }
  const set = t.closest('[data-set]');
  if (set) {
    const { set: k, value } = set.dataset;
    if (k === 'mode') answers = { ...answers, budget: { ...(answers.budget ?? {}), mode: value } };
    else answers = { ...answers, [k]: answers[k] === value || value === '' ? null : value };
    answers = normalizeAnswers(answers);
    render({ focus: `[data-set="${k}"][data-value="${CSS.escape(value)}"]` });
    return;
  }
  const tog = t.closest('[data-toggle]');
  if (tog) {
    const { toggle: k, value } = tog.dataset;
    const list = answers[k].includes(value) ? answers[k].filter(v => v !== value) : [...answers[k], value];
    answers = normalizeAnswers({ ...answers, [k]: list });
    render({ focus: `[data-toggle="${k}"][data-value="${CSS.escape(value)}"]` });
    return;
  }
  const act = t.closest('[data-wiz]')?.dataset.wiz;
  if (!act) return;
  if (act === 'close') closeWizard();
  else if (act === 'back') go(step - 1);
  else if (act === 'skip') { clearStep(STEPS[step]); go(step + 1); }
  else if (act === 'next') go(step + 1);
  else if (act === 'restart') { step = 0; render(); }
  else if (act === 'map') { returnFocus = null; closeWizard(); setState({ view: 'map' }, { source: 'wizard' }); }
  else if (act === 'compare') { choosePreset(getState().dataset === 'woonscore' ? 'custom' : 'standaard'); }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.field === 'sfeer') {
    answers = { ...answers, sfeer: +t.value };
    t.setAttribute('aria-valuetext', sfeerText(+t.value));
    const now = els.dialog.querySelector('.wiz-sfeer-now');
    if (now) now.textContent = sfeerText(+t.value);
  } else if (t.dataset.theme) {
    t.nextElementSibling.textContent = t.value;
    t.setAttribute('aria-valuetext', `gewicht ${t.value}`);
  }
}

function onChange(e) {
  const t = e.target;
  const f = t.dataset.field;
  if (f === 'income' || f === 'maxPrice') {
    answers = normalizeAnswers({ ...answers, budget: { ...answers.budget, [f]: parseEuroK(t.value) } });
    render({ focus: `[data-field="${f}"]` });
  } else if (f === 'hide') {
    answers = normalizeAnswers({ ...answers, budget: { ...answers.budget, hide: t.checked } });
  } else if (t.dataset.theme) {
    answers = normalizeAnswers({ ...answers, weights: { ...answers.weights, [t.dataset.theme]: +t.value } });
    applyAnswers();
    render({ focus: `[data-theme="${t.dataset.theme}"]` });
  }
}

function openArea(code) {
  if (/^(WK|BU)/.test(code)) { openAreaModal(code, els.dialog.querySelector(`[data-wiz-area="${code}"]`)); return; }
  returnFocus = null;
  closeWizard();
  setState({ area: code, view: 'map' }, { source: 'wizard' });
}

function trapFocus(e) {
  const focusables = [...els.dialog.querySelectorAll('button, a[href], input, select, summary, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && (document.activeElement === first || !els.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Opens the wizard: on the result when a custom score is active, else on step 1 with the saved answers. */
export function openWizard({ trigger = null, at = null } = {}) {
  initWizard();
  if (!isOpen()) returnFocus = trigger ?? document.activeElement;
  const cur = getState().score;
  if (scoreKind(cur) === 'custom') answers = decodeAnswers(cur);
  else answers = loadAnswers(storage()) ?? normalizeAnswers(EMPTY_ANSWERS);
  step = at ?? (scoreKind(cur) === 'custom' ? 'result' : 0);
  els.modal.hidden = false;
  document.body.classList.add('area-modal-open');
  return render();
}

export function closeWizard() {
  if (!isOpen()) return;
  els.modal.hidden = true;
  document.body.classList.remove('area-modal-open');
  if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) returnFocus.focus();
  returnFocus = null;
}

function renderLegendSwitch() {
  const slot = document.querySelector('[data-score-slot]');
  if (slot) slot.innerHTML = switcherHtml();
}

/**
 * Builds the dialog once, wires the top-bar button and the legend switcher.
 * `rows` () → { level: 'provincie'|'gemeente', rows } gives the national CBS
 * rows (held by app.js) for the Nederland top 10.
 */
export function initWizard({ rows } = {}) {
  if (rows) nationalRows = rows;
  if (els || typeof document === 'undefined') return;
  const modal = document.createElement('div');
  modal.id = 'wizard-modal';
  modal.className = 'search-modal area-modal wizard-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="search-backdrop" data-wiz-backdrop></div>
    <div class="search-dialog area-dialog wizard-dialog" role="dialog" aria-modal="true" aria-labelledby="wizard-title"></div>`;
  document.body.appendChild(modal);
  els = { modal, dialog: modal.querySelector('.wizard-dialog') };
  modal.addEventListener('click', onClick);
  modal.addEventListener('input', onInput);
  modal.addEventListener('change', onChange);
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('area-modal')?.hidden === false) return;   // the area modal on top closes first
      e.preventDefault(); e.stopPropagation(); closeWizard(); return;
    }
    if (e.key === 'Tab') trapFocus(e);
  });
  document.querySelector('.wizard-btn')?.addEventListener('click', e => openWizard({ trigger: e.currentTarget }));
  document.querySelector('[data-score-slot]')?.addEventListener('click', e => {
    const b = e.target.closest('[data-score-preset]');
    if (b) choosePreset(b.dataset.scorePreset);
  });
  renderLegendSwitch();
  onStateChange(({ changed }) => {
    if (changed.includes('dataset') || changed.includes('score')) {
      renderLegendSwitch();
      if (isOpen() && step === 'result') {
        if (changed.includes('score') && scoreKind(getState().score) === 'custom') answers = decodeAnswers(getState().score);
        const focusSel = document.activeElement?.dataset?.theme ? `[data-theme="${document.activeElement.dataset.theme}"]` : document.activeElement?.dataset?.scorePreset ? `[data-score-preset="${document.activeElement.dataset.scorePreset}"]` : null;
        render({ focus: focusSel });
      }
    }
    if (changed.includes('scope') && isOpen() && step === 'result') render();
  });
}
