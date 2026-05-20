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

export async function updateLegend({ title, min, max, dataset }) {
  const { setValue } = await import('spektrum');
  setValue('legend.title', title);
  setValue('legend.min',   formatLegendValue(min, dataset));
  setValue('legend.max',   formatLegendValue(max, dataset));
  document.getElementById('legend').classList.add('legend-visible');
}

export function hideLegend() {
  document.getElementById('legend')?.classList.remove('legend-visible');
}
