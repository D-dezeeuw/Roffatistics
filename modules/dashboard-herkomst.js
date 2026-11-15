// Dashboard section "Herkomst": city donut by origin group, top 15 countries,
// growth 2022–2026 per group (small multiples) and a 100 % bar per wijk.
// HTML builders only; dashboard.js loads the data and passes its donut helpers.
import { formatNumber } from './dashboard-data.js';
import { donutSlices } from './donut.js';
import { infoButton } from './explain.js';
import { wijkOriginRows, ORIGIN_PARTS, HERKOMST_TABLE } from './herkomst.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pctText = p => `${formatNumber(p, 1)}%`;
const signed = p => (p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : '±'}${formatNumber(Math.abs(p), 1)}%`);

export const DONUT_TOP = 10;      // groups shown by name in the donut; the rest is "Overige groepen"
export const TREND_GROUPS = 12;   // small multiples: the largest groups in the latest year

function donutCardHtml(s, { donutSvg, legendHtml }) {
  const items = s.groups.map(g => ({ key: g.key, label: g.label, value: g.value, color: g.color }));
  const { slices } = donutSlices(items, { top: DONUT_TOP, sort: true, otherLabel: 'Overige groepen' });
  const fmt = sl => formatNumber(sl.value);
  const center = { value: formatNumber(s.total), label: `inwoners ${s.year}` };
  return `
      <article class="dash-card hk-card hk-donut" aria-labelledby="dash-h-hk-donut">
        <header class="dash-card-head"><h3 id="dash-h-hk-donut">Rotterdam naar herkomst, ${s.year}</h3></header>
        <p class="dash-card-sub">${s.groups.length} groepen, de ${DONUT_TOP} grootste apart · aantal en aandeel van alle inwoners</p>
        <div class="dash-donut-wrap">${donutSvg(slices, { size: 200, center, label: `Rotterdam naar herkomst ${s.year}`, fmt })}${legendHtml(slices, fmt, sl => `${formatNumber(sl.value)} <span class="dash-legend-vs">· ${pctText(sl.pct)}</span>`)}</div>
        <ul class="hk-regions" aria-label="Per werelddeel">${s.regions.filter(r => r.value).map(r =>
          `<li title="${esc(`${r.label}: ${formatNumber(r.value)} inwoners`)}"><span>${esc(r.label)}</span> <strong>${pctText(r.pct)}</strong></li>`).join('')}</ul>
      </article>`;
}

function countriesCardHtml(s) {
  const max = s.countries[0]?.value || 1;
  return `
      <article class="dash-card hk-card" aria-labelledby="dash-h-hk-countries">
        <header class="dash-card-head"><h3 id="dash-h-hk-countries">Top ${s.countries.length} herkomstlanden</h3></header>
        <p class="dash-card-sub">Zonder Nederland · alleen landen die CBS apart publiceert</p>
        <ol class="hk-bars">${s.countries.map(c => {
          const text = `${c.label}: ${formatNumber(c.value)} (${pctText(c.pct)})`;
          return `<li class="hk-bar" data-tip="${esc(text)}" tabindex="0" aria-label="${esc(text)}">
            <span class="hk-bar-label">${esc(c.label)}</span>
            <span class="hk-bar-track"><span class="hk-bar-fill" style="width:${(c.value / max * 100).toFixed(1)}%"></span></span>
            <span class="hk-bar-val">${formatNumber(c.value)}</span></li>`;
        }).join('')}</ol>
      </article>`;
}

/** Points of a sparkline in a 100 × 32 box, each series on its own scale. */
export function sparkPoints(series, w = 100, h = 32, pad = 3) {
  const vals = series.filter(v => v != null);
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const step = (w - 2 * pad) / (series.length - 1);
  return series.map((v, i) => v == null ? null : `${(pad + i * step).toFixed(1)},${(h - pad - (v - lo) / span * (h - 2 * pad)).toFixed(1)}`)
    .filter(Boolean).join(' ');
}

function trendCardHtml(s) {
  const groups = [...s.groups].filter(g => g.value != null).sort((a, b) => b.value - a.value).slice(0, TREND_GROUPS);
  const y0 = s.years[0], y1 = s.years[s.years.length - 1];
  return `
      <article class="dash-card hk-card hk-trend" aria-labelledby="dash-h-hk-trend">
        <header class="dash-card-head"><h3 id="dash-h-hk-trend">Groei ${y0}–${y1} per groep</h3></header>
        <p class="dash-card-sub">De ${groups.length} grootste groepen · elke lijn op een eigen schaal; het percentage is de groei sinds ${y0} · Rotterdam totaal ${signed(s.totalFirst ? (s.total - s.totalFirst) / s.totalFirst * 100 : null)}</p>
        <ul class="hk-multiples">${groups.map(g => {
          const text = `${g.label}: ${s.years.map((y, i) => `${y} ${formatNumber(g.series[i])}`).join(', ')}`;
          const dir = g.change > 0 ? 'is-up' : g.change < 0 ? 'is-down' : '';
          return `<li class="hk-sm" data-tip="${esc(text)}" tabindex="0" aria-label="${esc(text)}">
            <span class="hk-sm-head"><span class="hk-sm-label"><i style="background:${g.color}"></i>${esc(g.label)}</span><span class="hk-sm-change ${dir}">${signed(g.change)}</span></span>
            <svg class="hk-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPoints(g.series)}" stroke="${g.color}"/></svg>
            <span class="hk-sm-foot">${formatNumber(g.series[0])} → ${formatNumber(g.value)}</span></li>`;
        }).join('')}</ul>
      </article>`;
}

function wijkCardHtml(wijken, selected) {
  const rows = wijkOriginRows(wijken);
  const legend = ORIGIN_PARTS.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)}</span>`).join('');
  return `
      <article class="dash-card hk-card hk-wijken" aria-labelledby="dash-h-hk-wijken">
        <header class="dash-card-head"><h3 id="dash-h-hk-wijken">Herkomst per wijk${infoButton('nonWesternPct', 'Herkomst per wijk')}</h3>
          <button type="button" class="dash-btn dash-btn-small" data-action="show-dataset" data-dataset="nonWesternPct" aria-label="Herkomst buiten Europa op de kaart">Op kaart</button></header>
        <p class="dash-card-sub">CBS kerncijfers wijken en buurten · gesorteerd op aandeel buiten Europa · klik een wijk voor de kaart</p>
        <p class="origin-legend">${legend}</p>
        <ol class="hk-wijk-list">${rows.map(r => {
          const text = r.parts ? `${r.name}: ${r.parts.map(p => `${p.label} ${pctText(p.value)}`).join(', ')}` : `${r.name}: geen data`;
          const bar = r.parts
            ? `<span class="origin-bar">${r.parts.map(p => `<span class="origin-seg" style="width:${p.pct.toFixed(2)}%;background:${p.color}"></span>`).join('')}</span>`
            : '<span class="origin-bar is-empty"></span>';
          return `<li class="hk-wijk is-link${r.code === selected ? ' is-selected' : ''}" data-code="${esc(r.code)}" role="button" tabindex="0" data-tip="${esc(text)}" aria-label="${esc(text)}. Toon op kaart">
            <span class="hk-wijk-name">${esc(r.name)}</span>${bar}<span class="hk-wijk-val">${r.parts ? pctText(r.parts[2].value) : '—'}</span></li>`;
        }).join('')}</ol>
      </article>`;
}

/**
 * The whole section. `summary` = herkomstSummary() of Rotterdam (null while
 * loading or after an error: `failed`), `wijken` = Rotterdam wijk areas,
 * `helpers` = { donutSvg, legendHtml } from dashboard.js.
 */
export function herkomstSectionHtml(summary, wijken, { donutSvg, legendHtml, selected = null, failed = false } = {}) {
  const head = summary
    ? `Rotterdam op 1 januari ${summary.year}: ${formatNumber(summary.total)} inwoners${summary.bornAbroadPct != null ? `, waarvan ${pctText(summary.bornAbroadPct)} in het buitenland geboren` : ''} · CBS ${HERKOMST_TABLE}`
    : failed ? `De landencijfers (CBS ${HERKOMST_TABLE}) konden niet worden geladen; de wijkcijfers staan hieronder.` : `Landencijfers laden (CBS ${HERKOMST_TABLE})…`;
  const city = summary
    ? donutCardHtml(summary, { donutSvg, legendHtml }) + countriesCardHtml(summary) + trendCardHtml(summary)
    : '';
  return `
    <header class="dash-section-head">
      <h2 id="dash-h-herkomst">Herkomst${infoButton('herkomst-groepen', 'Herkomst: landengroepen')}</h2>
      <p>${esc(head)}</p>
      <p>Herkomst volgens CBS: het eigen geboorteland, of bij wie in Nederland is geboren dat van de moeder, anders dat van de vader. Landengroepen bestaan alleen voor heel Rotterdam, per wijk alleen Nederland / Europa / buiten Europa.</p>
    </header>
    <div class="hk-grid">${city}${wijkCardHtml(wijken, selected)}</div>`;
}
