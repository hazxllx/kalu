import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Activity, AlertTriangle, Eye, Search, X } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import TablePagination from '@/components/tables/TablePagination';
import { residentsApi } from '@/services/api/residentsApi';
import { useAuth } from '@/context/AuthContext';
import { formatShortDate } from '@/lib/dateUtils';

const pageSize = 25;
const filterClass = 'h-10 w-full min-w-0 rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input dark:text-foreground';
const labelClass = 'grid min-w-0 gap-1.5 text-xs font-medium text-brand-gray dark:text-muted-foreground';
const riskTone = {
  High: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  Moderate: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  Low: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  Incomplete: 'bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
  Unassessed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const prettyDate = (value) => value ? formatShortDate(value) || '—' : '—';
const readError = (error) => error?.payload?.error?.message || error?.message || 'Resident risk information could not be loaded.';

function RiskLabel({ value }) {
  const label = value || 'Unassessed';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${riskTone[label] || riskTone.Unassessed}`}>{label}</span>;
}

function ScreeningFlags({ row }) {
  const classifications = row.clinicalScreening?.classifications || {};
  const labels = { bloodPressure: 'BP', bmi: 'BMI', oxygenSaturation: 'SpO₂', respiratoryRate: 'RR', temperature: 'Temp', heartRate: 'HR' };
  const flagTone = {
    critical: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
    high: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300',
    moderate: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
    low: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300',
    review: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-border dark:bg-card-nested dark:text-muted-foreground',
    unknown: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-border dark:bg-card-nested dark:text-muted-foreground',
    none: 'border-brand-border bg-white text-brand-ink dark:border-border dark:bg-card dark:text-foreground',
  };
  const entries = Object.entries(classifications);
  if (!entries.length) return <span className="text-xs text-brand-gray dark:text-muted-foreground">No results</span>;
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-full border border-brand-border bg-white px-3 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-card dark:text-blue-300 dark:hover:bg-hover">
        <Activity className="h-4 w-4" aria-hidden="true" />
        <span>View details</span>
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[1px]" />
      <Dialog.Content className="fixed inset-0 z-[85] flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl focus:outline-none dark:bg-card sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[85dvh] sm:w-[calc(100%-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:border-brand-border sm:dark:border-border">
        <header className="flex items-start justify-between gap-4 border-b border-brand-border px-5 py-4 dark:border-border sm:px-6">
          <div className="min-w-0">
            <Dialog.Title className="text-lg font-semibold leading-6 text-brand-ink dark:text-foreground">Clinical details</Dialog.Title>
            <Dialog.Description className="mt-1 truncate text-sm text-brand-gray dark:text-muted-foreground">{row.name || 'Resident'} · {row.residentId}</Dialog.Description>
          </div>
          <Dialog.Close asChild><button type="button" aria-label="Close clinical details" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-brand-gray hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:text-muted-foreground dark:hover:bg-hover dark:hover:text-foreground"><X className="h-5 w-5" /></button></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
          <section aria-label="Clinical screening classifications">
            <h3 className="mb-3 text-sm font-semibold text-brand-ink dark:text-foreground">Clinical screening</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {entries.map(([key, item]) => <li key={key} className={`min-w-0 rounded-lg border px-3 py-2.5 ${flagTone[item.severity] || flagTone.unknown}`}>
                <div className="flex min-w-0 items-start justify-between gap-2"><span className="shrink-0 text-sm font-semibold">{labels[key] || key}</span>
                  <span className="min-w-0 break-words text-right text-sm font-medium">{item.classification}</span></div>
                {item.value != null && <p className="mt-1 text-xs tabular-nums opacity-80">{item.value}</p>}
              </li>)}
            </ul>
          </section>
          <section className="border-t border-brand-border pt-4 dark:border-border">
            <h3 className="text-sm font-semibold text-brand-ink dark:text-foreground">Overall risk factors</h3>
            <RiskFactors row={row} />
          </section>
          <dl className="grid grid-cols-1 gap-3 border-t border-brand-border pt-4 text-sm sm:grid-cols-2 dark:border-border">
            <div><dt className="text-xs font-medium uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Assessment date</dt><dd className="mt-1 font-medium text-brand-ink dark:text-foreground">{prettyDate(row.assessmentAt)}</dd></div>
            <div><dt className="text-xs font-medium uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Recorded by</dt><dd className="mt-1 font-medium text-brand-ink dark:text-foreground">{row.responsiblePersonnel || '—'}</dd></div>
          </dl>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function RiskFactors({ row }) {
  const factors = row.riskFactors;
  const entries = Array.isArray(factors) ? factors : factors && typeof factors === 'object'
    ? Object.entries(factors).filter(([, value]) => value !== null && value !== false && value !== 0)
    : [];
  if (!entries.length) return <span className="text-xs text-brand-gray dark:text-muted-foreground">No recorded factors</span>;
  return <ul className="mt-1 flex flex-wrap gap-1.5 text-xs text-brand-gray dark:text-muted-foreground">
    {entries.slice(0, 4).map((factor, index) => <li key={index} className="max-w-full break-words rounded-md bg-brand-bg px-2 py-1 dark:bg-card-nested">{Array.isArray(factor) ? `${factor[0]}: ${String(factor[1])}` : typeof factor === 'object' ? (factor.label || factor.name || factor.code || 'Recorded factor') : String(factor)}</li>)}
  </ul>;
}

export default function ResidentRiskSummary() {
  const { user } = useAuth();
  const location = useLocation();
  const role = location.pathname.split('/').filter(Boolean)[1] || user?.role || 'phn';
  const barangayLocked = role === 'health_supervisor';
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ barangayId: '', zone: '', riskLevel: '', assessmentStatus: '', indicator: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setPhase('loading');
      setError('');
      try {
        const response = await residentsApi.riskSummary({
          ...filters,
          search: search.trim(),
          limit: pageSize,
          offset: (page - 1) * pageSize,
        });
        if (active) { setPayload(response); setPhase('ready'); }
      } catch (err) {
        if (active) { setError(readError(err)); setPhase('error'); }
      }
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filters, page, retryKey, search, user?.id]);

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const clearFilters = () => {
    setSearch('');
    setFilters({ barangayId: '', zone: '', riskLevel: '', assessmentStatus: '', indicator: '', from: '', to: '' });
    setPage(1);
  };
  const summary = payload?.summary || {};
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const metrics = useMemo(() => [
    ['Residents in scope', summary.totalResidents ?? 0, 'blue'],
    ['Assessed', summary.assessed ?? 0, 'teal'],
    ['High risk', summary.high ?? 0, 'red'],
    ['Moderate risk', summary.moderate ?? 0, 'amber'],
    ['Low risk', summary.low ?? 0, 'green'],
    ['Incomplete', summary.incomplete ?? 0, 'amber'],
    ['Unassessed', summary.unassessed ?? 0, 'slate'],
  ], [summary]);
  const distribution = Array.isArray(summary.distribution) ? summary.distribution : [];
  const distributionTone = {
    Low: 'bg-emerald-500', Moderate: 'bg-amber-500', High: 'bg-rose-500',
    Incomplete: 'bg-orange-500', Unassessed: 'bg-slate-400',
  };

  return <div className="space-y-5">
    <PageHeader eyebrow="Community Risk" title="Resident Risk Summary" subtitle="Review current resident risk classifications and clinical screening flags within your authorized area." />
    <div className="rounded-card border border-brand-border bg-white p-4 text-sm text-brand-gray dark:border-border dark:bg-card dark:text-muted-foreground" role="note">
      Screening flags support clinical review and do not diagnose a condition or replace professional assessment.
    </div>

    <section aria-label="Resident risk metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      {metrics.map(([label, value, tone]) => <div key={label} className="min-w-0 rounded-card border border-brand-border bg-white p-3 dark:border-border dark:bg-card">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray dark:text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'red' ? 'text-rose-600 dark:text-rose-400' : tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'amber' ? 'text-amber-700 dark:text-amber-400' : 'text-brand-ink dark:text-foreground'}`}>{value}</p>
      </div>)}
    </section>

    <section className="rounded-card border border-brand-border bg-white p-4 dark:border-border dark:bg-card" aria-label="Risk distribution">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold text-brand-ink dark:text-foreground">Risk distribution</h2><p className="text-xs text-brand-gray dark:text-muted-foreground">For the filtered resident set</p></div>
      {distribution.length ? <div className="space-y-3">
        {distribution.map((item) => {
          const value = Number(item.value) || 0;
          const total = Number(summary.totalResidents) || 0;
          const percent = total ? Math.min(100, (value / total) * 100) : 0;
          return <div key={item.name} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
            <span className="text-brand-gray dark:text-muted-foreground">{item.name}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-brand-bg dark:bg-card-nested" role="img" aria-label={`${item.name}: ${value} of ${total} residents`}>
              <div className={`h-full rounded-full ${distributionTone[item.name] || 'bg-brand-blue'}`} style={{ width: `${percent}%` }} />
            </div>
            <span className="text-right font-semibold tabular-nums text-brand-ink dark:text-foreground">{value}</span>
          </div>;
        })}
      </div> : <p className="text-sm text-brand-gray dark:text-muted-foreground">Risk distribution is not available.</p>}
    </section>

    <section className="rounded-card border border-brand-border bg-white p-4 dark:border-border dark:bg-card" aria-label="Filter resident risk summary">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className={labelClass}>Search residents
          <span className="relative"><Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-gray" />
            <input className={`${filterClass} pl-9`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or resident ID" />
          </span>
        </label>
        {!barangayLocked && <label className={labelClass}>Barangay
          <select className={filterClass} value={filters.barangayId} onChange={(event) => updateFilter('barangayId', event.target.value)}>
            <option value="">All barangays</option>{(payload?.barangays || []).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>}
        <label className={labelClass}>Zone
          <select className={filterClass} value={filters.zone} onChange={(event) => updateFilter('zone', event.target.value)}>
            <option value="">All zones</option>{(payload?.zones || []).map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label className={labelClass}>Overall risk
          <select className={filterClass} value={filters.riskLevel} onChange={(event) => updateFilter('riskLevel', event.target.value)}>
            <option value="">All risk levels</option><option>High</option><option>Moderate</option><option>Low</option><option>Unassigned</option>
          </select>
        </label>
        <label className={labelClass}>Assessment status
          <select className={filterClass} value={filters.assessmentStatus} onChange={(event) => updateFilter('assessmentStatus', event.target.value)}>
            <option value="">All statuses</option><option value="assessed">Assessed</option><option value="incomplete">Incomplete</option><option value="unassessed">Never assessed</option>
          </select>
        </label>
        <label className={labelClass}>Clinical indicator
          <select className={filterClass} value={filters.indicator} onChange={(event) => updateFilter('indicator', event.target.value)}>
            <option value="">All indicators</option><option value="bloodPressure">Blood pressure</option><option value="bmi">BMI</option><option value="oxygenSaturation">Oxygen saturation</option><option value="respiratoryRate">Respiratory rate</option><option value="temperature">Temperature</option><option value="heartRate">Heart rate</option>
          </select>
        </label>
        <label className={labelClass}>Assessment from<input className={filterClass} type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /></label>
        <label className={labelClass}>Assessment to<input className={filterClass} type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-brand-gray dark:text-muted-foreground">Counts and resident records reflect the selected filters.</p>
        <button type="button" onClick={clearFilters} className="min-h-9 rounded-btn border border-brand-border px-3 text-sm font-medium text-brand-blue hover:bg-brand-bg dark:border-border dark:text-blue-300 dark:hover:bg-hover">Clear filters</button>
      </div>
    </section>

    {phase === 'error' ? <section className="rounded-card border border-rose-200 bg-white p-8 text-center dark:border-rose-900 dark:bg-card" role="alert">
      <AlertTriangle className="mx-auto h-8 w-8 text-rose-600" /><h2 className="mt-3 font-semibold text-brand-ink dark:text-foreground">Unable to load resident risk summary</h2><p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">{error}</p>
      <button type="button" onClick={() => setRetryKey((key) => key + 1)} className="mt-4 min-h-10 rounded-btn bg-brand-blue px-4 text-sm font-semibold text-white">Try again</button>
    </section> : <section className="overflow-hidden rounded-card border border-brand-border bg-white dark:border-border dark:bg-card" aria-label="Resident risk records">
      {phase === 'loading' && <p className="p-4 text-sm text-brand-gray dark:text-muted-foreground" role="status">Loading resident risk records…</p>}
      {phase === 'ready' && <>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-gray dark:bg-card-nested dark:text-muted-foreground"><tr>
              <th className="px-4 py-3">Resident</th><th className="px-4 py-3">Barangay</th><th className="px-4 py-3">Health record no.</th><th className="px-4 py-3">Risk</th><th className="px-4 py-3">Assessment</th><th className="px-4 py-3">Clinical flags</th><th className="px-4 py-3 text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-brand-border dark:divide-border">{rows.map((row) => <tr key={row.residentId} className="align-top transition-colors hover:bg-brand-bg/60 dark:hover:bg-hover/50">
              <td className="px-4 py-3.5"><p className="font-semibold leading-5 text-brand-ink dark:text-foreground">{row.name || 'Resident'}</p><p className="mt-1 text-xs leading-4 text-brand-gray dark:text-muted-foreground">{row.age ?? 'Age unavailable'} <span aria-hidden="true">·</span> {row.sex || 'Sex not recorded'}</p></td>
              <td className="px-4 py-3.5 text-sm leading-5 text-brand-ink dark:text-foreground">{row.barangay || '—'}{row.zone ? <span className="block text-xs text-brand-gray dark:text-muted-foreground">Zone {row.zone}</span> : null}</td>
              <td className="whitespace-nowrap px-4 py-3.5 text-sm font-medium tabular-nums text-brand-ink dark:text-foreground">{row.residentId}</td>
              <td className="px-4 py-3.5"><RiskLabel value={row.riskLevel || (row.riskAssessmentStatus === 'incomplete' ? 'Incomplete' : 'Unassessed')} /></td>
              <td className="px-4 py-3.5"><span className="block whitespace-nowrap text-sm tabular-nums text-brand-ink dark:text-foreground">{prettyDate(row.assessmentAt)}</span><span className="mt-1 block text-xs capitalize text-brand-gray dark:text-muted-foreground">{row.riskAssessmentStatus || 'unassessed'}</span></td>
              <td className="px-4 py-3.5"><ScreeningFlags row={row} /></td>
              <td className="px-4 py-3.5 text-right"><Link to={`/app/${role}/residents?residentId=${encodeURIComponent(row.residentId)}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-btn border border-brand-border px-3 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-bg dark:border-border dark:text-blue-300 dark:hover:bg-hover"><Eye className="h-4 w-4" />View</Link></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:hidden">{rows.map((row) => <article className="min-w-0 rounded-card border border-brand-border bg-white p-3.5 dark:border-border dark:bg-card" key={row.residentId}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-base font-semibold leading-5 text-brand-ink dark:text-foreground">{row.name || 'Resident'}</h2><p className="mt-1 text-xs leading-4 text-brand-gray dark:text-muted-foreground">{row.residentId} <span aria-hidden="true">·</span> {row.age ?? 'Age unavailable'} <span aria-hidden="true">·</span> {row.sex || 'Sex not recorded'}</p></div><RiskLabel value={row.riskLevel || (row.riskAssessmentStatus === 'incomplete' ? 'Incomplete' : 'Unassessed')} /></div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-brand-border pt-3 text-sm dark:border-border"><div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Barangay</dt><dd className="mt-0.5 break-words font-medium leading-5 text-brand-ink dark:text-foreground">{row.barangay || '—'}{row.zone ? ` · Zone ${row.zone}` : ''}</dd></div><div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Assessment</dt><dd className="mt-0.5 font-medium leading-5 text-brand-ink dark:text-foreground">{prettyDate(row.assessmentAt)}</dd></div></dl>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-brand-border pt-3 dark:border-border"><ScreeningFlags row={row} /><Link to={`/app/${role}/residents?residentId=${encodeURIComponent(row.residentId)}`} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-btn border border-brand-border px-3 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-bg dark:border-border dark:text-blue-300 dark:hover:bg-hover"><Eye className="h-4 w-4" />View</Link></div>
        </article>)}</div>
        {!rows.length && <p className="p-8 text-center text-sm text-brand-gray dark:text-muted-foreground">No resident records match these filters.</p>}
        <TablePagination total={payload.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} showPageSize={false} itemLabel="residents" className="m-3" />
      </>}
    </section>}
  </div>;
}
