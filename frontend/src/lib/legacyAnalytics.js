export const metricValue = (value) => Number.isFinite(value) ? value.toLocaleString() : 'Unavailable';
const activityMetrics = {
  followUpCompletion: { monthly: true, numerator: ['followUps', 'completed'], denominator: ['followUps', 'scheduled'] },
  referralCompletion: { numerator: ['referrals', 'completed'], denominator: ['referrals', 'created'] },
  maternalTrend: { monthly: true, value: ['maternal', 'residents'] },
  seniorTrend: { monthly: true, value: ['consultations', 'senior', 'residents'] },
  vaccinationCoverage: { value: ['immunizations', 'records'] },
  childHealthCoverage: { value: ['consultations', 'minor', 'residents'] },
  programParticipation: { value: ['tcl', 'participatingResidents'] },
  programCompliance: { value: ['tcl', 'enrolledResidents'] },
};
const numericAt = (row, path) => {
  const value = path.reduce((item, key) => item?.[key], row);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Adapt recorded SQL activity to the retained charts without inventing rates. */
export const optionalSeries = (data, name, months = 12, knownBarangays = []) => {
  const metric = activityMetrics[name];
  const activity = data?.activity;
  if (!metric || !activity) return Array.isArray(data?.[name]) ? data[name].slice(-months) : null;
  if (activity.schemaVersion !== 1 || !activity.scopeComplete || !Array.isArray(activity.rows) || !Array.isArray(activity.months)) return null;
  if (activity.rows.some((row) => !row || typeof row.barangay !== 'string' || !/^\d{4}-\d{2}$/.test(row.month))) return null;
  const periods = activity.months.filter((month) => /^\d{4}-\d{2}$/.test(month)).slice(-months);
  if (!periods.length) return [];
  const names = [...new Set([
    ...knownBarangays,
    ...(data.scope?.barangay ? [data.scope.barangay] : []),
    ...activity.rows.map((row) => row.barangay),
  ].filter((value) => typeof value === 'string' && value))];
  const byKey = new Map(activity.rows.map((row) => [`${row.month}\0${row.barangay}`, row]));
  if (byKey.size !== activity.rows.length) return null;
  const measure = (barangay, selectedPeriods) => {
    let value = 0;
    let numerator = 0;
    let denominator = 0;
    for (const period of selectedPeriods) {
      const row = byKey.get(`${period}\0${barangay}`);
      // The SQL contract explicitly defines absent rows as recorded zeroes
      // only when scopeComplete is true. Malformed present rows stay unknown.
      if (!row) continue;
      if (metric.value) {
        const count = numericAt(row, metric.value);
        if (count === null) return { value: null, numerator: null, denominator: null };
        value += count;
      } else {
        const completed = numericAt(row, metric.numerator);
        const total = numericAt(row, metric.denominator);
        if (completed === null || total === null || completed > total) return { value: null, numerator: null, denominator: null };
        numerator += completed;
        denominator += total;
      }
    }
    return { value: metric.value ? value : denominator > 0 ? Math.round(numerator / denominator * 10000) / 100 : null,
      numerator: metric.value ? null : numerator, denominator: metric.value ? null : denominator };
  };
  if (!metric.monthly) {
    // Counts are unique within one reported month, not unique across months.
    const selected = metric.value ? periods.slice(-1) : periods;
    return names.map((barangay) => ({ name: barangay, month: selected.at(-1), ...measure(barangay, selected) }));
  }
  return periods.map((period) => {
    const values = names.map((barangay) => [barangay, measure(barangay, [period])]);
    const unavailable = values.some(([, entry]) => entry.numerator === null && entry.value === null);
    const numerator = values.reduce((sum, [, entry]) => sum + (entry.numerator || 0), 0);
    const denominator = values.reduce((sum, [, entry]) => sum + (entry.denominator || 0), 0);
    const count = values.reduce((sum, [, entry]) => sum + (entry.value || 0), 0);
    return { month: period, count: metric.value ? (unavailable ? null : count) : numerator,
      value: unavailable ? null : metric.value ? count : denominator ? Math.round(numerator / denominator * 10000) / 100 : null,
      numerator: metric.value ? null : numerator, denominator: metric.value ? null : denominator,
      ...Object.fromEntries(values.map(([barangay, entry]) => [barangay, entry.value])) };
  });
};

export const lastActivityPeriod = (months = 12, now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(({ type, value }) => [type, value]));
  const from = new Date(Date.UTC(Number(parts.year), Number(parts.month) - months, 1)).toISOString().slice(0, 10);
  return { from, to: `${parts.year}-${parts.month}-${parts.day}` };
};

export const healthTrendScope = (data, months = 12) => {
  if (!data?.summary || !Array.isArray(data.consultationTrends)) return null;
  const consultationTrends = data.consultationTrends.slice(-months);
  const last = consultationTrends.at(-1)?.consultations;
  const previous = consultationTrends.at(-2)?.consultations;
  const changeAvailable = Number.isFinite(last) && Number.isFinite(previous) && previous > 0;
  const change = changeAvailable ? `${((last - previous) / previous * 100).toFixed(1)}% vs previous month` : 'No comparable prior month';
  return {
    summary: {
      consultationsThisMonth: { value: metricValue(data.summary.consultationsThisMonth), change, up: changeAvailable ? last >= previous : null },
      referralsThisMonth: { value: metricValue(data.summary.referralsThisMonth), change: 'Recorded referrals this month', up: null },
      topCondition: { name: data.summary.topCondition || 'No recorded condition', cases: `${metricValue(data.summary.topConditionCases)} recorded cases` },
      highRiskResidents: { value: metricValue(data.summary.highRiskResidents), change: 'Recorded risk assessments', up: null },
    },
    consultationTrends,
    riskDistribution: data.riskDistribution,
    barangayOverview: {
      name: data.scope?.barangay || data.barangayOverview?.name || 'Authorized scope',
      residents: `${metricValue(data.summary.residents)} registered residents`,
      consultations: `${metricValue(data.summary.consultationsThisMonth)} consultations this month`,
      status: typeof data.barangayOverview?.status === 'string' ? data.barangayOverview.status : data.barangayOverview?.status?.label || 'Recorded assessments',
      tone: 'bg-brand-blue/10 text-brand-blue',
    },
    followUpCompletion: optionalSeries(data, 'followUpCompletion', months),
    vaccinationCoverage: optionalSeries(data, 'vaccinationCoverage'),
    diseaseDistribution: data.diseaseDistribution,
    maternalTrend: optionalSeries(data, 'maternalTrend', months),
    seniorTrend: optionalSeries(data, 'seniorTrend', months),
    programCompliance: optionalSeries(data, 'programCompliance'),
  };
};
