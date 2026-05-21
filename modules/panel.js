function cat(data, label) {
  const entry = data?.categories?.find(c => c.label === label);
  return entry?.count != null ? entry.count.toLocaleString('nl-NL') : '—';
}

function pct(v)  { return v  != null ? `${v.toFixed(1)}%`          : '—'; }
function euro(v) { return v  != null ? `€${v.toLocaleString('nl-NL')}k` : '—'; }
function num(v)  { return v  != null ? v.toLocaleString('nl-NL')        : '—'; }
function sign(v) { return v  != null ? (v >= 0 ? `+${v.toLocaleString('nl-NL')}` : v.toLocaleString('nl-NL')) : '—'; }

export function formatPanelData(data) {
  return {
    population:          data?.population  != null ? data.population.toLocaleString('nl-NL')         : '—',
    density:             data?.density     != null ? `${data.density.toLocaleString('nl-NL')} /km²`  : '—',
    avgIncome:           data?.avgIncome   != null ? `€${data.avgIncome}k`                           : '—',
    crimeRate:           data?.crimeRate   != null ? `${data.crimeRate.toFixed(1)} /1k inw.`         : '—',
    totalCrimes:         num(data?.totalCrimes),
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
  };
}

async function setSlot(prefix, name, code, data) {
  const { setValue } = await import('spektrum');
  const fmt = formatPanelData(data);
  setValue(`${prefix}.name`,              name ?? '');
  setValue(`${prefix}.code`,              code ?? '');
  setValue(`${prefix}.population`,        fmt.population);
  setValue(`${prefix}.density`,           fmt.density);
  setValue(`${prefix}.avgIncome`,         fmt.avgIncome);
  setValue(`${prefix}.crimeRate`,         fmt.crimeRate);
  setValue(`${prefix}.totalCrimes`,       fmt.totalCrimes);
  setValue(`${prefix}.catVermogen`,       fmt.catVermogen);
  setValue(`${prefix}.catDiefstalInbraak`, fmt.catDiefstalInbraak);
  setValue(`${prefix}.catVernieling`,     fmt.catVernieling);
  setValue(`${prefix}.catGeweld`,         fmt.catGeweld);
  setValue(`${prefix}.catMishandeling`,   fmt.catMishandeling);
  setValue(`${prefix}.lowEdu`,            fmt.lowEdu);
  setValue(`${prefix}.medEdu`,            fmt.medEdu);
  setValue(`${prefix}.highEdu`,           fmt.highEdu);
  setValue(`${prefix}.wozValue`,          fmt.wozValue);
  setValue(`${prefix}.totalJobs`,         fmt.totalJobs);
  setValue(`${prefix}.pop65plus`,         fmt.pop65plus);
  setValue(`${prefix}.migrationBalance`,  fmt.migrationBalance);
  setValue(`${prefix}.nonWesternPct`,     fmt.nonWesternPct);
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
