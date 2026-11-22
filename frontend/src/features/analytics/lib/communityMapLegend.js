const CONDITION_COLORS = {
  Tuberculosis: '#7C3AED', Dengue: '#BE185D', Malaria: '#A16207',
  Hypertension: '#DC2626', Diabetes: '#2563EB', Respiratory: '#0891B2',
  Maternal: '#C026D3', Anemia: '#B45309', Gastrointestinal: '#059669', Others: '#475569',
};

export const conditionColor = (name) => CONDITION_COLORS[name] || '#475569';

export function mapLegend(metric, markers, hasBoundaries) {
  const conditions = metric.startsWith('Common Conditions');
  const color = conditions ? '#0891B2' : /high-risk/i.test(metric) ? '#B3202C' : /pending follow-ups/i.test(metric) ? '#B78320' : '#2563A6';
  const label = conditions ? 'Recorded conditions' : /high-risk/i.test(metric) ? 'High-risk residents' : /pending follow-ups/i.test(metric) ? 'Pending follow-up' : 'Recorded cases';
  const entries = conditions
    ? [...new Set(markers.flatMap((row) => row.displayedConditions.filter((item) => item.value > 0).map((item) => item.name)))].sort().map((name) => ({ label: name, color: conditionColor(name) }))
    : markers.some((row) => row.displayedCaseCount > 0) ? [{ label, color }] : [];
  if (markers.some((row) => row.displayedCaseCount === 0)) entries.push({ label: `No ${label.toLowerCase()} recorded`, color: '#8294A8' });
  if (hasBoundaries) entries.push({ label: 'Selected barangay', color: '#2563A6', outline: true });
  return { color, entries };
}
