export function formatPanelData(data) {
  return {
    population: data?.population != null
      ? data.population.toLocaleString('nl-NL')
      : '—',
    density: data?.density != null
      ? `${data.density.toLocaleString('nl-NL')} /km²`
      : '—',
    avgIncome: data?.avgIncome != null
      ? `€${data.avgIncome}k`
      : '—',
  };
}

export async function showPanel({ name, code, data }) {
  const { setValue } = await import('spektrum');
  const fmt = formatPanelData(data);
  setValue('panel.name',       name ?? '');
  setValue('panel.code',       code ?? '');
  setValue('panel.population', fmt.population);
  setValue('panel.density',    fmt.density);
  setValue('panel.avgIncome',  fmt.avgIncome);
  setValue('panel.visible',    true);
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
