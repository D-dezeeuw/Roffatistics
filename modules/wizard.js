// "Vind jouw ideale woonplek": the wizard dialog (steps + result) and the
// Standaard / Gelijk / Jouw score switcher in the legend. Answers, presets and
// the hash form live in wizard-model.js (pure); this file is DOM only.
//
// Applying answers = setState({ score, dataset: 'woonscore' }): the Woonscore
// itself is rescored with the personal weights. app.js reacts to the `score`
// change (setPersonalPreset + rescoring every area) before this module renders
// the result, because app.js subscribed first. The legend's Reset clears `score`.


import { getState, setState, onStateChange, resetScore } from './state.js';
import { openShareDialog } from './share-dialog.js';
import { loadRotterdamAreas, peekRotterdamAreas, getAreaIndex } from './areas.js';
import { getRotterdamLevel } from './rotterdam.js';
import { scoreResult, getPersonalPreset, THEME_LABELS } from './presets.js';
import { explain } from './score.js';
import { openAreaModal } from './area-modal.js';
import { infoButton } from './explain.js';
import {
  STEPS, LEVENSTYPEN, LEVENSTYPE_HINT, BOUW_OPTIONS, VERVOER, CRIMES, INCOME_FACTOR, TOO_EXPENSIVE_SHARE,
  EMPTY_ANSWERS, normalizeAnswers, encodeAnswers, decodeAnswers, budgetCeiling, scoreKind,
  loadAnswers, saveAnswers, topAreas, describeAnswers, parseEuroK, scoreLabel,
  GEMEENSCHAP_DEFAULT_PCT, GEMEENSCHAP_LEVEL_PCT, gemeenschapLevel, DETAIL_GROUPS, gemeenschapOptgroups,
  SITUATIE_EDU, SITUATIE_INCOME, IMPORTANCE, IMPORTANCE_DEFAULT, themeImportance, DICHTBIJ, DICHTBIJ_LEVELS,
} from './wizard-model.js';
import { loadGemeenteGroup, missingDetailGroups } from './herkomst-gemeente.js';
import { loadPc4Herkomst, presetUsesPc4 } from './herkomst-pc4.js';
import { loadBouwjaar, presetUsesBouw } from './bouwjaar-pc4.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (v, d = 0) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

const STEP_TITLES = { levensfase: 'Levenstype', budget: 'Budget', vervoer: 'Vervoer', sfeer: 'Sfeer', dichtbij: 'Wat wil je dichtbij?', veiligheid: 'Veiligheid', situatie: 'Jouw situatie (optioneel)', gemeenschap: 'Gemeenschap (optioneel)' };

let els = null;
let step = 0;                 // 0..STEPS.length-1, or 'result'
let answers = normalizeAnswers(EMPTY_ANSWERS);
let returnFocus = null;
let nationalRows = () => ({ level: 'provincie', rows: [] });

const isOpen = () => !!els && !els.modal.hidden;

// ── step markup ───────────────────────────────────────────────────────────────

const optBtn = (set, value, label, on) =>
  `<button type="button" class="wiz-opt${on ? ' active' : ''}" data-set="${set}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
/**
 * Shared slider markup (W23): name and current value on one line, the range
 * full width under it, the two end labels under its left and right end.
 * `input` is the <input type="range"> HTML; it must carry aria-labelledby=id
 * and aria-valuetext. Any slider built with this (or with the same classes)
 * gets the layout from style.css `.wiz-slider`.
 */
export const sliderHtml = ({ cls = '', id, label, input, value, ends }) => `
    <label class="wiz-slider${cls ? ` ${cls}` : ''}"><span class="wiz-slider-name" id="${id}">${esc(label)}</span><output>${esc(value)}</output>
      ${input}
      <span class="wiz-range-ends"><span>${esc(ends[0])}</span><span>${esc(ends[1])}</span></span></label>`;
/** 5-step importance slider (Niet belangrijk … Heel belangrijk); `attr` names what it sets. */
const impSlider = (attr, level, label, min = 0) => {
  const id = `wiz-imp-${attr.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
  return sliderHtml({
    cls: 'wiz-imp', id, label, value: IMPORTANCE[level].label, ends: [IMPORTANCE[min].label, IMPORTANCE.at(-1).label],
    input: `<input type="range" min="${min}" max="${IMPORTANCE.length - 1}" step="1" value="${level}" ${attr} aria-labelledby="${id}" aria-valuetext="${esc(IMPORTANCE[level].label)}">`,
  });
};
const chip = (set, value, label, on) =>
  `<button type="button" class="wiz-chip${on ? ' active' : ''}" data-toggle="${set}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;

/** Slider position of a "Jouw situatie" choice: 0 = Niet invullen, 1… = the options in order. */
const situatiePos = (opts, key) => (key ? Object.keys(opts).indexOf(key) + 1 : 0);
const situatieText = (opts, pos) => (pos > 0 ? Object.values(opts)[pos - 1]?.label ?? '' : 'Niet invullen');
/** "Jouw situatie" slider: position 0 = Niet invullen, then the options; the label updates on input. */
const sitSlider = (field, id, label, opts, pos) => sliderHtml({
  cls: 'wiz-sit', id, label, value: situatieText(opts, pos), ends: ['Niet invullen', Object.values(opts).at(-1).label],
  input: `<input type="range" min="0" max="${Object.keys(opts).length}" step="1" value="${pos}" data-field="${field}" aria-labelledby="${id}" aria-valuetext="${esc(situatieText(opts, pos))}">`,
});
/** The value <output> of a slider: inside its .wiz-slider, or (older markup) right after the input. */
const outputOf = t => t.closest('.wiz-slider')?.querySelector('output') ?? t.nextElementSibling;

/** "Wat wil je dichtbij?" slider: 0 = Maakt niet uit … 4 = Heel belangrijk, same markup as the other wizard sliders. */
const dichtSlider = (item, d, level) => sliderHtml({
  cls: 'wiz-imp wiz-dicht', id: `wiz-d-${item}`, label: d.label, value: DICHTBIJ_LEVELS[level], ends: [DICHTBIJ_LEVELS[0], DICHTBIJ_LEVELS.at(-1)],
  input: `<input type="range" min="0" max="${DICHTBIJ_LEVELS.length - 1}" step="1" value="${level}" data-dichtbij="${item}" aria-labelledby="wiz-d-${item}" aria-valuetext="${esc(DICHTBIJ_LEVELS[level])}" title="${esc(d.hint)}">`,
});

function stepBody(key) {
  const a = answers;
  if (key === 'levensfase') return `
    <p class="wiz-q" id="wiz-q">Welk levenstype past het best bij jou?</p>
    <div class="wiz-opts" role="group" aria-labelledby="wiz-q">${Object.entries(LEVENSTYPEN).map(([k, l]) => optBtn('levensfase', k, l, a.levensfase === k)).join('')}</div>
    <p class="wiz-hint">${esc(LEVENSTYPE_HINT)}</p>
    <p class="wiz-q" id="wiz-q2">Wat voor huizen zoek je: een oudere buurt met karakter of juist moderne woningen?</p>
    <div class="wiz-opts" role="group" aria-labelledby="wiz-q2">${Object.entries(BOUW_OPTIONS).map(([k, l]) => optBtn('bouw', k, l, a.bouw === k)).join('')}${optBtn('bouw', '', 'Maakt niet uit', !a.bouw)}</div>
    <p class="wiz-hint">Oudere bouw: meer woningen van vóór 1945. Moderne woningen: meer woningen van 2005 of later. Per wijk en buurt, geschat via de postcode.</p>`;
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
  if (key === 'dichtbij') return `
    <p class="wiz-q" id="wiz-q">Wat wil je dichtbij? Zet per onderdeel hoe belangrijk het is.</p>
    <div class="wiz-sliders" role="group" aria-labelledby="wiz-q">${Object.entries(DICHTBIJ).map(([k, d]) => dichtSlider(k, d, a.dichtbij?.[k] ?? 0)).join('')}</div>
    <p class="wiz-hint">Alles staat standaard op “Maakt niet uit” en telt dan niet mee. Hoe belangrijker, hoe zwaarder een korte afstand telt (gemiddelde afstand over de weg, CBS). ${Object.values(DICHTBIJ).map(d => `${esc(d.label)}: ${esc(d.hint)}`).join('. ')}. Dit komt bovenop Sfeer: daar kies je drukte of rust, hier wat je om de hoek wilt hebben. Groen en natuur zijn CBS-cijfers uit 2017, de nieuwste die er zijn.</p>`;
  if (key === 'gemeenschap') {
    const g = a.gemeenschap;
    const level = gemeenschapLevel(g?.pct ?? GEMEENSCHAP_DEFAULT_PCT);
    return `
    <p class="wiz-hint">Optioneel en standaard uit. Wil je graag dichter bij mensen met dezelfde herkomst wonen, dan kun je hier een groep kiezen. Herkomst volgt de CBS-definitie: je eigen geboorteland, of als je in Nederland bent geboren dat van je moeder (of anders je vader). Het zijn totalen per gebied, geen gegevens over personen.</p>
    <label class="wiz-field" id="wiz-q">Herkomstgroep
      <select data-field="gemDetail">
        <option value="">Geen specifieke groep</option>
        ${gemeenschapOptgroups(DETAIL_GROUPS).map(([title, list]) => `<optgroup label="${esc(title)}">${list.map(([k, d]) => `<option value="${esc(k)}"${g?.detail === k ? ' selected' : ''}>${esc(d.long ?? d.label)}${d.direct ? ' · gemeente, wijk en buurt' : d.wijk ? ' · ook per wijk/buurt (geschat)' : ' · alleen per gemeente'}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
    <p class="wiz-hint wiz-note"><strong>Waar telt het?</strong> Nederland: CBS-kerncijfers per gemeente, wijk en buurt. Groepen met “ook per wijk/buurt (geschat)”: per gemeente CBS-cijfers, per wijk en buurt geschat via de postcode. De andere groepen tellen alleen per gemeente (Nederland-kaart); op wijk- en buurtniveau valt de factor dan weg en tellen de andere thema’s naar verhouding zwaarder.</p>
    ${g ? impSlider('data-field="gemLevel"', level, 'Hoe belangrijk', 1) : ''}
    <p class="wiz-hint">Alleen een plus: een groter aandeel van de gekozen groep telt mee als “nabijheid gemeenschap”. Een gebied krijgt nooit minpunten voor wie er (niet) woont. Je score wordt in je browser berekend; er wordt niets verstuurd. Je keuze blijft op dit apparaat; in een link staat ze alleen als je dat bij “Deellink maken” aanvinkt.</p>`;
  }
  if (key === 'situatie') {
    const st = a.situatie;
    const eduPos = situatiePos(SITUATIE_EDU, st?.edu), incPos = situatiePos(SITUATIE_INCOME, st?.income);
    return `
    <p class="wiz-hint">Optioneel. Dit zoekt alleen naar gebieden waar meer mensen in een vergelijkbare situatie wonen: vaak vind je daar sneller aansluiting. Beide schuiven staan standaard op “Niet invullen” en tellen dan niet mee. Je antwoorden blijven in je browser; er wordt niets verstuurd.</p>
    ${sitSlider('sitIncome', 'wiz-q', 'Huishoudinkomen per maand (netto, ongeveer)', SITUATIE_INCOME, incPos)}
    <p class="wiz-hint">Gebieden waar het gemiddelde inkomen in de buurt van het jouwe ligt tellen als plus, in plaats van het Standaard-cijfer “meer inkomen = beter”. Bij de laagste standen telt ook een groter aandeel mensen met bijstand als plus, waar dat cijfer er is.</p>
    ${sitSlider('sitEdu', 'wiz-q2', 'Hoogst behaalde opleiding', SITUATIE_EDU, eduPos)}
    <p class="wiz-hint">Een groter aandeel inwoners met hetzelfde opleidingsniveau telt als plus, in plaats van het Standaard-thema Opleiding (meer hbo/wo = beter).</p>
    <p class="wiz-hint">Alleen een plus: een gebied krijgt nooit minpunten voor wie er woont. Hoe zwaar dit telt stel je in bij het resultaat (“Hoe belangrijk”). Je keuze blijft op dit apparaat; in een link staat ze alleen als je dat bij “Deellink maken” aanvinkt.</p>`;
  }
  return `
    <p class="wiz-q" id="wiz-q">Welke misdrijven wegen voor jou het zwaarst?</p>
    <div class="wiz-chips" role="group" aria-labelledby="wiz-q">${Object.entries(CRIMES).map(([k, c]) => chip('veiligheid', k, c.label, a.veiligheid.includes(k))).join('')}</div>
    <p class="wiz-hint">Gekozen misdrijven tellen drie keer zwaarder binnen Veiligheid. “Criminaliteit in de omgeving” telt ook de misdrijven in de aangrenzende buurten mee, ook als dat een haven-, bedrijven- of stationsgebied is waar niemand woont. Per soort misdrijf is er alleen data voor Rotterdamse wijken en buurten.</p>`;
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

/** Switcher markup (legend and result): which preset the Woonscore uses. */
export function switcherHtml(state = getState()) {
  const active = state.dataset === 'woonscore' ? scoreKind(state.score) : null;
  const opt = (k, label, title) => `<button type="button" class="seg-opt${active === k ? ' active' : ''}" data-score-preset="${k}" aria-pressed="${active === k}" title="${esc(title)}">${label}</button>`;
  return `<div class="seg score-switch" role="group" aria-label="Score">
    ${opt('standaard', 'Standaard', 'Woonscore: gemiddeld prettige omstandigheden')}${opt('gelijk', 'Gelijk', 'Alle cijfers met een richting even zwaar')}${opt('custom', 'Jouw score', 'Met jouw antwoorden uit de wizard')}</div>`;
}

/** Legend Reset (only while the Woonscore is personalised or Gelijk): back to the Standaard weights. */
export function resetButtonHtml(state = getState()) {
  if (state.dataset !== 'woonscore' || scoreKind(state.score) === 'standaard') return '';
  return `<button type="button" class="legend-reset" data-score-reset aria-label="Reset: terug naar de standaard Woonscore" title="Terug naar de standaard Woonscore (je antwoorden blijven bewaard)">Reset</button>`;
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

/** One 5-step importance slider per theme; Gemeenschap's levels map to its % of the total. */
function themeSliders() {
  const preset = getPersonalPreset();
  const imp = themeImportance(answers);
  const g = answers.gemeenschap;
  const gem = g ? impSlider('data-field="gemLevel"', gemeenschapLevel(g.pct), THEME_LABELS.gemeenschap) : '';
  return (preset.themes ?? []).filter(t => t.key !== 'gemeenschap')
    .map(t => impSlider(`data-theme="${esc(t.key)}"`, imp[t.key] ?? IMPORTANCE_DEFAULT, THEME_LABELS[t.key] ?? t.label)).join('') + gem;
}

/**
 * "Deellink maken": opens the shared "Deel deze weergave" dialog (share-dialog.js,
 * v0.31.0), focused on Jouw wensen; the sensitive parts are opt-in checkboxes there.
 */
function shareHtml() {
  return `<section class="wiz-share" aria-labelledby="wiz-share-title">
      <h3 id="wiz-share-title">Deellink maken</h3>
      <p class="wiz-hint">Kies wat er in de link staat. Herkomst/gemeenschap, opleiding en inkomen staan er standaard niet in. Op dit apparaat blijven al je antwoorden bewaard.</p>
      <div class="wiz-share-row">
        <button type="button" class="area-btn" data-wiz="share" aria-haspopup="dialog" aria-controls="share-modal">Deellink maken…</button>
      </div>
    </section>`;
}

async function resultHtml() {
  const state = getState();
  const kind = scoreKind(state.score);
  // A detailed Gemeenschap group is fetched on demand; app.js rescores when it lands (same promise, earlier handler).
  await Promise.all(missingDetailGroups(getPersonalPreset()).map(g => loadGemeenteGroup(g).catch(() => null)));
  // Wijk/buurt shares of a detailed group (postcode estimate): app.js adds them and rescores before this resolves.
  if (presetUsesPc4(getPersonalPreset())) await loadPc4Herkomst().catch(() => null);
  // Bouwstijl shares per wijk/buurt (postcode estimate): same pattern, app.js rescores on load.
  if (presetUsesBouw(getPersonalPreset())) await loadBouwjaar().catch(() => null);
  const { level, items } = await resultItems();
  const withScores = items.map(i => {
    const r = scoreResult('woonscore', i.code);
    return { ...i, score: r?.score ?? null, filtered: !!r?.filtered, std: scoreResult('standaard', i.code)?.score ?? null };
  });
  const top = topAreas(withScores, 10);
  const stdRank = new Map(topAreas(withScores.map(i => ({ ...i, score: i.std, filtered: false })), Infinity).map(i => [i.code, i.rank]));
  const hidden = withScores.filter(i => i.filtered).length;
  const levelLabel = { wijken: 'wijken', buurten: 'buurten', gemeenten: 'gemeenten', provincies: 'provincies' }[level];
  const summary = kind === 'gelijk' ? 'Gelijk gewogen: alle cijfers met een richting tellen even zwaar.'
    : kind === 'standaard' ? 'Standaard: de Woonscore zonder jouw wensen.'
    : describeAnswers(answers) || 'Alleen eigen gewichten.';
  const list = top.length ? `<ol class="wiz-top">${top.map(i => {
    const why = explain(scoreResult('woonscore', i.code), { top: 3 });
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
      <div class="wiz-result-head">${switcherHtml(state)}${infoButton('woonscore', 'Woonscore')}</div>
      <p class="wiz-summary">${esc(summary)}</p>
      ${hidden ? `<p class="wiz-hint">${hidden} ${esc(levelLabel)} boven je budget zijn verborgen (grijs op de kaart).</p>` : ''}
      ${list}
      <p class="wiz-hint">Match = ${esc(scoreLabel(state.score))}, 0–100 t.o.v. de andere ${esc(levelLabel)} op de kaart. Std = de Woonscore (Standaard) ter vergelijking.</p>
      ${kind === 'custom' || kind === 'standaard' ? `<details class="wiz-tune"${kind === 'custom' ? ' open' : ''}><summary>Hoe belangrijk is elk thema?</summary><div class="wiz-sliders">${themeSliders()}</div></details>` : ''}
      ${shareHtml()}
    </div>
    <footer class="wiz-foot">
      <button type="button" class="area-btn" data-wiz="restart">Antwoorden aanpassen</button>
      <div class="wiz-foot-right">
        <button type="button" class="area-btn" data-wiz="compare">${kind === 'standaard' ? 'Terug naar jouw wensen' : 'Vergelijk met Standaard'}</button>
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

/** Applies the answers: the Woonscore is rescored with them; empty answers = Standaard. */
function applyAnswers() {
  const s = encodeAnswers(answers);
  saveAnswers(storage(), answers);
  // A finished wizard opens the dashboard on "Jouw dashboard" (W19).
  setState({ score: s || null, dataset: 'woonscore', ...(s ? { dtab: 'jouw' } : {}) }, { source: 'wizard' });
}

function clearStep(key) {
  if (key === 'levensfase') answers = { ...answers, levensfase: null, oud: null };
  else if (key === 'budget') answers = { ...answers, budget: null };
  else if (key === 'vervoer') answers = { ...answers, vervoer: [] };
  else if (key === 'sfeer') answers = { ...answers, sfeer: null };
  else if (key === 'veiligheid') answers = { ...answers, veiligheid: [] };
  else if (key === 'dichtbij') answers = { ...answers, dichtbij: null };
  else if (key === 'gemeenschap') answers = { ...answers, gemeenschap: null };
  else if (key === 'situatie') answers = { ...answers, situatie: null };
}

function go(next) {
  if (next === 'result' || next >= STEPS.length) { step = 'result'; applyAnswers(); }
  else step = Math.max(0, next);
  render();
}

/** Picks a switcher option (legend or result). */
export function choosePreset(kind) {
  if (kind === 'standaard') { setState({ score: null, dataset: 'woonscore' }, { source: 'wizard' }); return; }
  if (kind === 'gelijk') { setState({ score: 'gelijk', dataset: 'woonscore' }, { source: 'wizard' }); return; }
  const cur = getState().score;
  const custom = scoreKind(cur) === 'custom' ? cur : encodeAnswers(loadAnswers(storage()) ?? answers);
  if (custom) setState({ score: custom, dataset: 'woonscore' }, { source: 'wizard' });
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
  else if (act === 'share') openShareDialog({ trigger: t.closest('[data-wiz]'), focus: 'answers' });
  else if (act === 'compare') { choosePreset(scoreKind(getState().score) === 'standaard' ? 'custom' : 'standaard'); }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.field === 'sfeer') {
    answers = { ...answers, sfeer: +t.value };
    t.setAttribute('aria-valuetext', sfeerText(+t.value));
    const now = els.dialog.querySelector('.wiz-sfeer-now');
    if (now) now.textContent = sfeerText(+t.value);
  } else if (t.dataset.field === 'sitEdu' || t.dataset.field === 'sitIncome') {
    const label = situatieText(t.dataset.field === 'sitEdu' ? SITUATIE_EDU : SITUATIE_INCOME, +t.value);
    const out = outputOf(t);
    if (out) out.textContent = label;
    t.setAttribute('aria-valuetext', label);
  } else if (t.dataset.dichtbij) {
    const label = DICHTBIJ_LEVELS[+t.value] ?? '';
    t.nextElementSibling.textContent = label;
    t.setAttribute('aria-valuetext', label);
  } else if (t.dataset.field === 'gemLevel' || t.dataset.theme) {
    const label = IMPORTANCE[+t.value]?.label ?? '';
    const out = outputOf(t);
    if (out) out.textContent = label;
    t.setAttribute('aria-valuetext', label);
  }
}

function onChange(e) {
  const t = e.target;
  const f = t.dataset.field;
  if (f === 'income' || f === 'maxPrice') {
    answers = normalizeAnswers({ ...answers, budget: { ...answers.budget, [f]: parseEuroK(t.value) } });
    render({ focus: `[data-field="${f}"]` });
  } else if (f === 'gemDetail') {
    const detail = t.value || null;
    answers = normalizeAnswers({ ...answers, gemeenschap: { ...(answers.gemeenschap ?? {}), detail } });
    if (detail) loadGemeenteGroup(detail).catch(() => { /* CBS down: the factor is skipped, as at wijk/buurt */ });
    render({ focus: '[data-field="gemDetail"]' });
  } else if (f === 'gemLevel') {
    if (!answers.gemeenschap) return;
    // Level 0 ("Niet belangrijk", result only) switches Gemeenschap off.
    const pct = GEMEENSCHAP_LEVEL_PCT[+t.value];
    answers = normalizeAnswers({ ...answers, gemeenschap: !pct ? null : { ...answers.gemeenschap, pct } });
    if (step === 'result') { applyAnswers(); render({ focus: `[data-field="${f}"]` }); }
  } else if (f === 'sitEdu' || f === 'sitIncome') {
    const opts = f === 'sitEdu' ? SITUATIE_EDU : SITUATIE_INCOME;
    const pick = +t.value > 0 ? Object.keys(opts)[+t.value - 1] ?? null : null;
    answers = normalizeAnswers({ ...answers, situatie: { ...(answers.situatie ?? {}), [f === 'sitEdu' ? 'edu' : 'income']: pick } });
    render({ focus: `[data-field="${f}"]` });
  } else if (f === 'hide') {
    answers = normalizeAnswers({ ...answers, budget: { ...answers.budget, hide: t.checked } });
  } else if (t.dataset.dichtbij) {
    answers = normalizeAnswers({ ...answers, dichtbij: { ...(answers.dichtbij ?? {}), [t.dataset.dichtbij]: +t.value } });
  } else if (t.dataset.theme) {
    const k = t.dataset.theme;
    const { [k]: _old, ...weights } = answers.weights;   // the 5-step level replaces an old absolute weight
    answers = normalizeAnswers({ ...answers, weights, importance: { ...answers.importance, [k]: +t.value } });
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
  if (slot) slot.innerHTML = `<div class="legend-score-row">${switcherHtml()}${resetButtonHtml()}</div>`;
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
    if (e.target.closest('[data-score-reset]')) { resetScore(); document.querySelector('[data-score-preset="standaard"]')?.focus(); return; }
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
