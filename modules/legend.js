// Map legend: the stepped classes of the current scale (scale.js) with their
// value breaks, the median, the outlier count and the "Schaal" toggle.
// legendScaleHtml and scaleToggleHtml are pure (unit-tested); the rest is DOM.
import { formatTick, formatValue } from './dashboard-data.js';
import { getScaleMethod, setScaleMethod, SCALE_METHODS, SCALE_METHOD_LABELS, SCALE_EVENT } from './scale.js';

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function formatLegendValue(value, dataset) {
  if (value == null) return '—';
  if (dataset === 'avgIncome') return `€${value}k`;
  return formatNumber(value);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Inner HTML of the legend scale for `scale` (buildScale result) of dataset `key`
 * in crime mode `mode`. Quantile: one row per class "from–to" (short nl-NL
 * numbers), the median's class marked. Linear: the gradient strip with min/max
 * and a median tick. Both: "mediaan <value with unit>" and the outlier line.
 */
export function legendScaleHtml(scale, key, mode = 'rate') {
  if (!scale?.count) return '<div class="legend-empty">geen data in deze weergave</div>';
  const t = v => esc(formatTick(v, key, mode));
  const medianClass = scale.classOf(scale.median);
  let body;
  if (scale.method === 'linear') {
    const pos = scale.max === scale.min ? 50 : Math.round((scale.median - scale.min) / (scale.max - scale.min) * 1000) / 10;
    body = `<div class="legend-strip"><span class="legend-median-tick" style="left:${pos}%" title="mediaan"></span></div>
      <div class="legend-labels"><span>${t(scale.min)}</span><span>${t(scale.max)}</span></div>`;
  } else {
    body = `<ul class="legend-classes">${scale.classes.map((c, i) => `
      <li class="legend-class${i === medianClass ? ' is-median' : ''}"><span class="legend-chip" style="background:${c.color}" aria-hidden="true"></span><span class="legend-range">${c.from === c.to ? t(c.from) : `${t(c.from)}–${t(c.to)}`}</span>${i === medianClass ? '<span class="legend-median">◂ mediaan</span>' : ''}</li>`).join('')}
    </ul>`;
  }
  const { high, low } = scale.outliers;
  const parts = [];
  if (high) parts.push(`${high} ${high === 1 ? 'uitschieter' : 'uitschieters'} &gt; ${t(scale.hi)}`);
  if (low)  parts.push(`${low} ${low === 1 ? 'uitschieter' : 'uitschieters'} &lt; ${t(scale.lo)}`);
  const outliers = parts.length
    ? `<div class="legend-outlier"><span class="legend-chip is-outlier" aria-hidden="true"></span>${parts.join(', ')}</div>` : '';
  return `${body}<div class="legend-meta">mediaan ${esc(formatValue(scale.median, key, mode))}</div>${outliers}`;
}

/** Markup of the "Schaal: Kwantiel | Lineair" toggle with `method` pressed. */
export function scaleToggleHtml(method = 'quantile') {
  const opt = m => `<button type="button" class="seg-opt${m === method ? ' active' : ''}" data-scale-method="${m}" aria-pressed="${m === method}">${SCALE_METHOD_LABELS[m]}</button>`;
  return `<div class="seg scale-toggle" role="group" aria-label="Kleurschaal"><span class="seg-label" aria-hidden="true">Schaal:</span>${SCALE_METHODS.map(opt).join('')}</div>`;
}

export async function updateLegend({ title, scale, dataset, mode = 'rate', showNoData = false }) {
  const { setValue } = await import('spektrum');
  setValue('legend.title', title);
  const el = document.getElementById('legend');
  const box = el.querySelector('.legend-scale');
  if (box) box.innerHTML = legendScaleHtml(scale, dataset, mode);
  const slot = el.querySelector('[data-scale-slot]');
  if (slot) slot.innerHTML = scaleToggleHtml(scale?.method ?? getScaleMethod());
  el.classList.add('legend-visible');
  el.classList.toggle('legend-has-nodata', showNoData);
}

export function hideLegend() {
  document.getElementById('legend')?.classList.remove('legend-visible');
}

let bound = false;

/** Handles clicks on the Schaal toggle (delegated); the change reaches the views through SCALE_EVENT. */
export function initScaleToggle() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('[data-scale-method]');
    if (btn && btn.dataset.scaleMethod !== getScaleMethod()) setScaleMethod(btn.dataset.scaleMethod);
  });
}

export const LEGEND_COLLAPSED_KEY = 'roffatistics.legendCollapsed';

/** Reflect the collapsed state on the legend and its button (label, aria). */
export function applyLegendCollapsed(el, collapsed) {
  el.classList.toggle('legend-collapsed', collapsed);
  const btn = el.querySelector('.legend-collapse');
  if (!btn) return;
  const label = collapsed ? 'Legenda uitklappen' : 'Legenda minimaliseren';
  btn.textContent = collapsed ? '+' : '–';
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

/** The legend's minimise button; the choice is remembered per browser. */
export function initLegendCollapse(el = globalThis.document?.getElementById('legend'), storage = null) {
  if (!el) return;
  try { storage ??= globalThis.localStorage; } catch { storage = null; }
  let collapsed = false;
  try { collapsed = storage?.getItem(LEGEND_COLLAPSED_KEY) === '1'; } catch { /* storage blocked */ }
  applyLegendCollapsed(el, collapsed);
  el.querySelector('.legend-collapse')?.addEventListener('click', () => {
    collapsed = !collapsed;
    applyLegendCollapsed(el, collapsed);
    try { storage?.setItem(LEGEND_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  });
}

export { SCALE_EVENT };
