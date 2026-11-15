// Herkomst (origin) helpers. Wijk/buurt level: the NL / Europa / buiten-Europa
// split from the kerncijfers (86165NED). Pure; no DOM.

const fmtPct = v => `${v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const escAttr = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The three CBS herkomst parts of an area, in stacking order. */
export const ORIGIN_PARTS = Object.freeze([
  Object.freeze({ key: 'originDutchPct',  label: 'Nederland',         short: 'NL',            color: '#8b5cf6' }),
  Object.freeze({ key: 'originEuropePct', label: 'Europa (excl. NL)', short: 'Europa',        color: '#c084fc' }),
  Object.freeze({ key: 'nonWesternPct',   label: 'Buiten Europa',     short: 'buiten Europa', color: '#f97316' }),
]);

/**
 * [{ key, label, short, color, value, pct }] for an area's values: `value` is the
 * CBS share of inhabitants, `pct` the share of the three parts' sum (so a stacked
 * bar is exactly 100 % although CBS rounds the counts to fives). Null when any
 * part is missing or all are zero.
 */
export function originSplit(values) {
  const vals = ORIGIN_PARTS.map(p => values?.[p.key]);
  if (vals.some(v => v == null || !Number.isFinite(v))) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return ORIGIN_PARTS.map((p, i) => ({ ...p, value: vals[i], pct: vals[i] / sum * 100 }));
}

/** HTML of the panel's mini stacked bar plus a one-line legend; '' without data. */
export function originBarHtml(values) {
  const parts = originSplit(values);
  if (!parts) return '';
  const label = parts.map(p => `${p.label} ${fmtPct(p.value)}`).join(', ');
  return `<div class="origin-bar" role="img" aria-label="Herkomst: ${escAttr(label)}">${parts.map(p =>
    `<span class="origin-seg" style="width:${p.pct.toFixed(2)}%;background:${p.color}" title="${escAttr(`${p.label}: ${fmtPct(p.value)}`)}"></span>`).join('')}</div>
<p class="origin-legend">${parts.map(p => `<span><i style="background:${p.color}"></i>${escAttr(p.short)} ${fmtPct(p.value)}</span>`).join('')}</p>`;
}
