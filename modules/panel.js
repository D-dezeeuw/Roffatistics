function cat(data, label) {
  const entry = data?.categories?.find(c => c.label === label);
  return entry?.count != null ? entry.count.toLocaleString('nl-NL') : '—';
}

function pct(v) { return v != null ? `${v.toFixed(1)}%` : '—'; }

export function formatPanelData(data) {
  return {
    population:    data?.population  != null ? data.population.toLocaleString('nl-NL')           : '—',
    density:       data?.density     != null ? `${data.density.toLocaleString('nl-NL')} /km²`    : '—',
    avgIncome:     data?.avgIncome   != null ? `€${data.avgIncome}k`                              : '—',
    crimeRate:     data?.crimeRate   != null ? `${data.crimeRate.toFixed(1)} /1k inw.`            : '—',
    totalCrimes:   data?.totalCrimes != null ? data.totalCrimes.toLocaleString('nl-NL')           : '—',
    catVermogen:   cat(data, 'Vermogen'),
    catVernieling: cat(data, 'Vernieling'),
    catGeweld:     cat(data, 'Geweld'),
    lowEdu:        pct(data?.lowEdu),
    medEdu:        pct(data?.medEdu),
    highEdu:       pct(data?.highEdu),
  };
}

export async function showPanel({ name, code, data }) {
  const { setValue } = await import('spektrum');
  const fmt = formatPanelData(data);
  setValue('panel.name',         name ?? '');
  setValue('panel.code',         code ?? '');
  setValue('panel.population',   fmt.population);
  setValue('panel.density',      fmt.density);
  setValue('panel.avgIncome',    fmt.avgIncome);
  setValue('panel.crimeRate',    fmt.crimeRate);
  setValue('panel.totalCrimes',  fmt.totalCrimes);
  setValue('panel.catVermogen',  fmt.catVermogen);
  setValue('panel.catVernieling', fmt.catVernieling);
  setValue('panel.catGeweld',    fmt.catGeweld);
  setValue('panel.lowEdu',       fmt.lowEdu);
  setValue('panel.medEdu',       fmt.medEdu);
  setValue('panel.highEdu',      fmt.highEdu);
  setValue('panel.visible',      true);
  const el = document.getElementById('panel');
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('has-region');
}

export async function hidePanel() {
  const { setValue } = await import('spektrum');
  setValue('panel.visible', false);
  const el = document.getElementById('panel');
  el.setAttribute('aria-hidden', 'true');
  el.classList.remove('has-region');
}
