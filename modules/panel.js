import { getState, onStateChange } from './state.js';

function cat(data, label) {
  const entry = data?.categories?.find(c => c.label === label);
  return entry?.count != null ? entry.count.toLocaleString('nl-NL') : '—';
}

function pct(v)  { return v  != null ? `${v.toFixed(1)}%`          : '—'; }
function euro(v) { return v  != null ? `€${v.toLocaleString('nl-NL')}k` : '—'; }
function num(v)  { return v  != null ? v.toLocaleString('nl-NL')        : '—'; }
function sign(v) { return v  != null ? (v >= 0 ? `+${v.toLocaleString('nl-NL')}` : v.toLocaleString('nl-NL')) : '—'; }
function rate(v) { return v  != null ? `${v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} /1k inw.` : '—'; }
function km(v)   { return v  != null ? `${v.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km` : '—'; }
function trend(v) {
  if (v == null) return '—';
  const t = Math.abs(v).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${t}% t.o.v. 2024`;
}

function count(v) { return v != null ? `${v.toLocaleString('nl-NL')} misdrijven` : '—'; }

/**
 * Display strings for every panel field. `mode` is the crime mode (state.crime):
 * in 'abs' the first crime row shows the registered offences ("Aantal 2025")
 * and the second the rate, and the sub-layers show counts instead of rates.
 */
export function formatPanelData(data, mode = 'rate') {
  const abs = mode === 'abs';
  return {
    population:          data?.population  != null ? data.population.toLocaleString('nl-NL')         : '—',
    density:             data?.density     != null ? `${data.density.toLocaleString('nl-NL')} /km²`  : '—',
    avgIncome:           data?.avgIncome   != null ? `€${data.avgIncome}k`                           : '—',
    crimeLabel1:         abs ? 'Aantal 2025' : 'Per 1.000 inw.',
    crimeRate:           abs ? count(data?.totalCrimes) : (data?.crimeRate != null ? `${data.crimeRate.toFixed(1)} /1k inw.` : '—'),
    crimeLabel2:         abs ? 'Per 1.000 inw.' : 'Totaal',
    totalCrimes:         abs ? (data?.crimeRate != null ? `${data.crimeRate.toFixed(1)} /1k inw.` : '—') : num(data?.totalCrimes),
    catVermogen:         cat(data, 'Vermogen'),
    catDiefstalInbraak:  cat(data, 'Diefstal/inbraak'),
    catVernieling:       cat(data, 'Vernieling'),
    catGeweld:           cat(data, 'Geweld'),
    catMishandeling:     cat(data, 'Mishandeling'),
    lowEdu:              pct(data?.lowEdu),
    medEdu:              pct(data?.medEdu),
    highEdu:             pct(data?.highEdu),
    wozValue:            euro(data?.wozValue),
    totalJobs:           num(data?.totalJobs),
    pop65plus:           pct(data?.pop65plus),
    migrationBalance:    sign(data?.migrationBalance),
    nonWesternPct:       pct(data?.nonWesternPct),
    // Rotterdam wijk/buurt only (86165NED, police 47018NED)
    dataYears:           data?.dataYears || '—',
    ownerOccupiedPct:    pct(data?.ownerOccupiedPct),
    rentalPct:           pct(data?.rentalPct),
    welfarePer1000:      rate(data?.welfarePer1000),
    crimeTrend:          trend(data?.crimeTrend),
    crimeBurglary:       abs ? count(data?.crimeBurglaryCount)   : rate(data?.crimeBurglary),
    crimeBike:           abs ? count(data?.crimeBikeCount)       : rate(data?.crimeBike),
    crimePickpocket:     abs ? count(data?.crimePickpocketCount) : rate(data?.crimePickpocket),
    crimeViolence:       abs ? count(data?.crimeViolenceCount)   : rate(data?.crimeViolence),
    distGP:              km(data?.distGP),
    distSupermarket:     km(data?.distSupermarket),
  };
}

/** Every panel field key (the spektrum bindings are `panel.<key>` and `panel2.<key>`). */
export const PANEL_FIELDS = Object.freeze(Object.keys(formatPanelData(null)));

// Last content per slot, so a crime-mode switch can re-format an open panel.
const lastSlot = { panel: null, panel2: null };
onStateChange(({ changed }) => {
  if (!changed.includes('crime')) return;
  for (const [prefix, slot] of Object.entries(lastSlot)) if (slot?.data) setSlot(prefix, slot.name, slot.code, slot.data);
});

async function setSlot(prefix, name, code, data) {
  lastSlot[prefix] = { name, code, data };
  const { setValue } = await import('spektrum');
  const fmt = formatPanelData(data, getState().crime);
  setValue(`${prefix}.name`,              name ?? '');
  setValue(`${prefix}.code`,              code ?? '');
  for (const [key, text] of Object.entries(fmt)) setValue(`${prefix}.${key}`, text);
}

export async function showPanel({ name, code, data }) {
  await setSlot('panel', name, code, data);
  const { setValue } = await import('spektrum');
  setValue('panel.visible', true);
  const el = document.getElementById('panel');
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('panel-open', 'has-region');
  document.dispatchEvent(new CustomEvent('panel-toggle', { detail: { open: true } }));
}

export async function pinPanel() {
  const { setValue } = await import('spektrum');
  setValue('panel.pinned', true);
  document.getElementById('panel').classList.add('comparing');
  document.dispatchEvent(new CustomEvent('panel-pin', { detail: { pinned: true } }));
}

export async function showCompareSlot({ name, code, data }) {
  await setSlot('panel2', name, code, data);
  const el = document.getElementById('panel');
  el.classList.add('has-compare');
}

export async function clearCompare() {
  const { setValue } = await import('spektrum');
  await setSlot('panel2', '', '', null);
  setValue('panel.pinned', false);
  const el = document.getElementById('panel');
  el.classList.remove('comparing', 'has-compare');
  document.dispatchEvent(new CustomEvent('panel-pin', { detail: { pinned: false } }));
}

export async function hidePanel() {
  const { setValue } = await import('spektrum');
  setValue('panel.visible', false);
  setValue('panel.pinned',  false);
  await setSlot('panel2', '', '', null);
  const el = document.getElementById('panel');
  el.setAttribute('aria-hidden', 'true');
  el.classList.remove('panel-open', 'has-region', 'comparing', 'has-compare');
  document.dispatchEvent(new CustomEvent('panel-toggle', { detail: { open: false } }));
}
