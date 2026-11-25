import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Search, X } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import TablePagination from '@/components/tables/TablePagination';
import { residentsApi } from '@/services/api/residentsApi';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/context/PermissionsContext';
import { formatShortDate } from '@/lib/dateUtils';

const pageSize = 25;
const filterClass = 'h-10 w-full min-w-0 rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input dark:text-foreground';
const labelClass = 'grid min-w-0 gap-1.5 text-xs font-medium text-brand-gray dark:text-muted-foreground';
const riskTone = {
  High: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  Moderate: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  Low: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  Incomplete: 'bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
  Unassessed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const prettyDate = (value) => value ? formatShortDate(value) || '—' : '—';
const readError = (error) => error?.payload?.error?.message || error?.message || 'Resident risk information could not be loaded.';
const clinicalDetailsError = (error) => {
  const code = error?.payload?.error?.code || error?.code;
  if (code === 'RISK_CLINICAL_DETAILS_SCHEMA_UNAVAILABLE') {
    return error?.payload?.error?.message
      || 'The clinical details database function or schema is unavailable. Contact a system administrator.';
  }
  if (code === 'RISK_CLINICAL_DETAILS_CONNECTION_ERROR' || error?.status === undefined
    || error?.status === 0 || error instanceof TypeError) {
    return 'Connection error. Check your internet connection and retry.';
  }
  if (code === 'RISK_CLINICAL_DETAILS_INVALID_RESPONSE') {
    return 'The clinical details response could not be verified. Contact a system administrator.';
  }
  return error?.status >= 500
    ? 'Clinical details could not be loaded. Please retry.'
    : readError(error);
};
const labelize = (value) => String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());
const isRecorded = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const measurementUnits = {
  bp: ' mmHg', bloodPressure: ' mmHg', systolic: ' mmHg', diastolic: ' mmHg', hr: ' bpm', heartRate: ' bpm',
  rr: ' breaths/min', respiratoryRate: ' breaths/min', o2sat: '%', oxygenSaturation: '%',
  temperature: ' °C', heightCm: ' cm', height: ' cm', weightKg: ' kg', weight: ' kg',
  bmi: ' kg/m²',
};
const measurementLabels = {
  bp: 'Blood pressure', hr: 'Heart rate', rr: 'Respiratory rate', o2sat: 'Oxygen saturation',
  heightCm: 'Height', weightKg: 'Weight', bmi: 'BMI',
};
const clinicalValue = (key, value) => {
  if (!isRecorded(value)) return 'Not assessed';
  if (typeof value === 'object') return JSON.stringify(value);
  const unit = measurementUnits[key] || '';
  return unit && !String(value).toLowerCase().includes(unit.trim().toLowerCase()) ? `${value}${unit}` : String(value);
};
const classificationKey = {
  bp: 'bloodPressure', hr: 'heartRate', rr: 'respiratoryRate', o2sat: 'oxygenSaturation',
  height: 'heightCm', weight: 'weightKg',
};
const fieldEntries = (value, prefix = '') => {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value);
    return entries.flatMap(([key, item]) => {
      if (/^(id|code|ruleId|reference|source|residentId|consultationId)$/i.test(key)) return [];
      return fieldEntries(item, prefix ? `${prefix}.${labelize(key)}` : labelize(key));
    });
  }
  return isRecorded(value) ? [[prefix, String(value)]] : [];
};

function RiskLabel({ value }) {
  const label = value || 'Unassessed';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${riskTone[label] || riskTone.Unassessed}`}>{label}</span>;
}

function ScreeningFlags({ row }) {
  const neutralTone = 'border-brand-border bg-white text-brand-ink dark:border-border dark:bg-card dark:text-foreground';
  const criticalTone = 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300';
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setDetails(null);
    setSelectedId('');
    setError('');
    setLoading(true);
    residentsApi.riskClinicalDetails(row.residentId)
      .then((response) => {
        if (response?.residentId !== row.residentId || response?.resident?.id !== row.residentId
          || !Array.isArray(response.assessments) || !Array.isArray(response.riskFactors)) {
          const invalidResponse = Object.assign(
            new Error('Clinical details returned for a different resident or in an invalid format.'),
            { code: 'RISK_CLINICAL_DETAILS_INVALID_RESPONSE' },
          );
          throw invalidResponse;
        }
        if (!active) return;
        setDetails(response);
        setSelectedId(response.assessments[0]?.id || '');
      })
      .catch((err) => { if (active) setError(clinicalDetailsError(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, retry, row.residentId]);

  const selectedAssessment = details?.assessments?.find((assessment) => assessment.id === selectedId) || null;
  const measurementEntries = Object.entries(selectedAssessment?.measurements || {});
  const screeningClasses = selectedAssessment?.clinicalScreening?.classifications || {};
  const screeningRows = new Map();
  for (const [key, value] of measurementEntries) {
    const normalizedKey = classificationKey[key] || key;
    if (!['bloodPressure', 'heartRate', 'respiratoryRate', 'bmi', 'oxygenSaturation', 'temperature', 'heightCm', 'weightKg'].includes(normalizedKey)) continue;
    screeningRows.set(normalizedKey, {
      key: normalizedKey,
      label: measurementLabels[key] || labelize(key),
      value,
      classification: screeningClasses[normalizedKey]?.classification,
      severity: screeningClasses[normalizedKey]?.severity,
    });
  }
  for (const [key, item] of Object.entries(screeningClasses)) {
    if (!['bloodPressure', 'heartRate', 'respiratoryRate', 'bmi', 'oxygenSaturation', 'temperature', 'heightCm', 'weightKg'].includes(key)) continue;
    if (!isRecorded(screeningRows.get(key)?.value)) screeningRows.set(key, {
      key,
      label: measurementLabels[key] || labelize(key),
      value: item?.value,
      classification: item?.classification,
      severity: item?.severity,
    });
  }
  const currentScreeningRows = [...screeningRows.values()].filter(({ value }) => isRecorded(value));
  const selectedDate = selectedAssessment?.assessmentAt || selectedAssessment?.createdAt;
  const dateTime = selectedDate
    ? `${prettyDate(selectedDate)}${Number.isFinite(new Date(selectedDate).getTime()) ? ` · ${new Date(selectedDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
    : 'Not recorded';
  const recordedDetails = fieldEntries(selectedAssessment?.assessmentDetails || {});

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-full border border-brand-border bg-white px-3 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-card dark:text-blue-300 dark:hover:bg-hover">
        <span>View details</span>
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[1px]" />
      <Dialog.Content className="fixed inset-3 z-[85] flex h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-brand-border bg-white shadow-2xl focus:outline-none dark:border-border dark:bg-card sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border bg-white px-4 py-3 dark:border-border dark:bg-card sm:px-5">
          <div className="min-w-0">
            <Dialog.Title className="text-base font-semibold leading-6 text-brand-ink dark:text-foreground sm:text-lg">Clinical details</Dialog.Title>
            <Dialog.Description className="mt-0.5 truncate text-sm text-brand-gray dark:text-muted-foreground">{row.name || 'Resident'} · {row.residentId}</Dialog.Description>
          </div>
          <Dialog.Close asChild><button type="button" aria-label="Close clinical details" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-brand-gray hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:text-muted-foreground dark:hover:bg-hover dark:hover:text-foreground"><X className="h-5 w-5" /></button></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <section aria-label="Resident information">
            <h3 className="text-sm font-semibold text-brand-blue dark:text-blue-300">Resident information</h3>
            {details?.resident ? <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {[
                ['Full name', details.resident.name],
                ['Resident ID', details.resident.id],
                ['Barangay', details.resident.barangay],
                ['Age', details.resident.age],
                ['Sex', details.resident.sex],
              ].map(([label, value]) => <div key={label} className="min-w-0">
                <dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 break-words font-medium text-brand-ink dark:text-foreground">
                  {isRecorded(value) ? (label === 'Age' ? `${value} years` : value) : 'Not recorded'}
                </dd>
              </div>)}
            </dl> : <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">
              {loading ? 'Loading resident information…' : 'Resident information is unavailable.'}
            </p>}
          </section>
          <section className="border-t border-brand-border pt-3 dark:border-border" aria-label="Clinical screening classifications">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-brand-blue dark:text-blue-300">Clinical screening</h3>
              {details?.assessments?.length > 0 && <label className="flex items-center gap-2 text-xs text-brand-gray dark:text-muted-foreground">
                Assessment
                <select aria-label="Select clinical assessment" className={`${filterClass} h-9 w-auto max-w-full min-w-[12rem]`}
                  value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  {details.assessments.map((assessment) => {
                    const at = assessment.assessmentAt || assessment.createdAt;
                    return <option key={assessment.id} value={assessment.id}>{prettyDate(at)}</option>;
                  })}
                </select>
              </label>}
            </div>
            {loading && <p className="flex items-center gap-2 py-2 text-sm text-brand-gray dark:text-muted-foreground" role="status">
              Loading clinical details…
            </p>}
            {error && <div className={`rounded-lg border p-3 text-sm ${neutralTone}`} role="alert">
              <p>{error}</p><button type="button" onClick={() => setRetry((count) => count + 1)} className="mt-2 font-semibold underline">Retry</button>
            </div>}
            {!loading && !error && !selectedAssessment && <p className="rounded-lg border border-dashed border-brand-border px-3 py-4 text-sm text-brand-gray dark:border-border dark:text-muted-foreground">No clinical screening record is available for this resident.</p>}
            {!loading && !error && selectedAssessment && <>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {currentScreeningRows.map(({ key, label, value, classification, severity }) => {
                  return <li key={key} className={`min-w-0 rounded-lg border px-3 py-2.5 ${['critical', 'emergency'].includes(severity) || (key === 'bloodPressure' && ['high', 'moderate'].includes(severity)) ? criticalTone : key === 'bloodPressure' && severity === 'low' ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300' : neutralTone}`}>
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <span className="shrink-0 text-sm font-semibold">{label}</span>
                      {key === 'bloodPressure' && isRecorded(classification) && !/^(classification not available|not classified|not assessed|unknown|unavailable|n\/a)$/i.test(String(classification).trim()) && <span className="min-w-0 break-words text-right text-sm font-medium">{classification}</span>}
                    </div>
                    <p className="mt-1 break-words text-xs font-semibold tabular-nums">
                      {clinicalValue(key, value)}
                    </p>
                  </li>;
                })}
              </ul>
              {!currentScreeningRows.length && <p className="rounded-lg border border-dashed border-brand-border px-3 py-4 text-sm text-brand-gray dark:border-border dark:text-muted-foreground">No assessment indicators are recorded in this visit.</p>}
            </>}
          </section>
          <section className="border-t border-brand-border pt-3 dark:border-border" aria-label="Overall risk summary">
            <h3 className="text-sm font-semibold text-brand-blue dark:text-blue-300">Overall risk summary</h3>
            {details && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${riskTone[details.riskLevel] || riskTone.Unassessed}`}>
                {details.riskLevel || 'Unassessed'}
              </span>
              <span className={`text-sm ${details.riskAssessmentStatus === 'assessed' ? 'text-emerald-700 dark:text-emerald-300' : 'text-brand-gray dark:text-muted-foreground'}`}>
                Status: {labelize(details.riskAssessmentStatus || 'unassessed')}
              </span>
              {details.riskAssessedAt && <span className="text-sm text-brand-gray dark:text-muted-foreground">
                Assessed {prettyDate(details.riskAssessedAt)}
              </span>}
            </div>}
            {details ? <RiskFactors details={details} /> : <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">
              {loading ? 'Loading risk factors…' : 'Risk factors are unavailable until clinical details load.'}
            </p>}
          </section>
          <section className="border-t border-brand-border pt-3 dark:border-border" aria-label="Assessment information">
            <h3 className="text-sm font-semibold text-brand-blue dark:text-blue-300">Assessment information</h3>
            {selectedAssessment ? <>
              <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-2.5 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">Assessment date and time</dt><dd className="mt-0.5 font-medium text-brand-ink dark:text-foreground">{dateTime}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">Assessment status</dt><dd className={`mt-0.5 font-medium ${['completed', 'complete', 'assessed'].includes(selectedAssessment.status) ? 'text-emerald-700 dark:text-emerald-300' : 'text-brand-ink dark:text-foreground'}`}>{labelize(selectedAssessment.status || 'not recorded')}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">Recorded by</dt><dd className="mt-0.5 break-words font-medium text-brand-ink dark:text-foreground">{selectedAssessment.recordedBy || 'Not recorded'}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">Personnel</dt><dd className="mt-0.5 break-words font-medium text-brand-ink dark:text-foreground">{selectedAssessment.performedBy || 'Not recorded'}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">Assessment type / category</dt><dd className="mt-0.5 break-words font-medium text-brand-ink dark:text-foreground">{[selectedAssessment.assessmentType, selectedAssessment.assessmentCategory].filter(Boolean).join(' · ') || 'Not recorded'}</dd></div>
              </dl>
            </> : <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">
              {loading ? 'Loading assessment information…' : error ? 'Assessment information is unavailable.' : 'No assessment information is recorded for this resident.'}
            </p>}
          </section>
          <section className="border-t border-brand-border pt-3 dark:border-border" aria-label="Findings and PHN assessment">
            <h3 className="text-sm font-semibold text-brand-blue dark:text-blue-300">Findings and PHN assessment</h3>
            {selectedAssessment ? (() => {
              const assessmentDetails = selectedAssessment.assessmentDetails || {};
              const findings = assessmentDetails.findings;
              const phnAssessment = assessmentDetails.phnAssessment;
              const normalizeNarrative = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
              const duplicateNarrative = isRecorded(findings) && isRecorded(phnAssessment)
                && normalizeNarrative(findings) === normalizeNarrative(phnAssessment);
              const otherDetails = fieldEntries({
                ...assessmentDetails,
                findings: undefined,
                phnAssessment: undefined,
              }).filter(([, value]) => ![findings, phnAssessment].filter(isRecorded)
                .some((narrative) => normalizeNarrative(narrative) === normalizeNarrative(value)));
              const paragraphs = (value) => String(value || '').split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
              return <>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-medium text-brand-gray dark:text-muted-foreground">Findings</h4>
                    {isRecorded(findings)
                      ? <div className="mt-1 max-w-prose space-y-2 break-words text-sm leading-6 text-brand-ink dark:text-foreground">
                        {paragraphs(findings).map((paragraph, index) => <p className="whitespace-pre-wrap" key={index}>{paragraph}</p>)}
                      </div>
                      : <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Not recorded</p>}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-medium text-brand-gray dark:text-muted-foreground">PHN assessment</h4>
                    {duplicateNarrative
                      ? <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Same as findings.</p>
                      : isRecorded(phnAssessment)
                        ? <div className="mt-1 max-w-prose space-y-2 break-words text-sm leading-6 text-brand-ink dark:text-foreground">
                          {paragraphs(phnAssessment).map((paragraph, index) => <p className="whitespace-pre-wrap" key={index}>{paragraph}</p>)}
                        </div>
                        : <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Not recorded</p>}
                  </div>
                </div>
                {otherDetails.length > 0 && <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-brand-border/70 pt-3 text-sm sm:grid-cols-2 dark:border-border">
                  {otherDetails.map(([label, value], index) => <div key={`${label}-${index}`} className="min-w-0">
                    <dt className="text-xs font-medium text-brand-gray dark:text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 break-words font-medium text-brand-ink dark:text-foreground">{value}</dd>
                  </div>)}
                </dl>}
              </>;
            })() : <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">
              {loading ? 'Loading assessment information…' : error ? 'Assessment information is unavailable.' : 'No assessment information is recorded for this resident.'}
            </p>}
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function RiskFactors({ details }) {
  const factors = details.riskFactors;
  const entries = Array.isArray(factors) ? factors : factors && typeof factors === 'object'
    ? Object.entries(factors).filter(([, value]) => value !== null && value !== undefined && value !== false)
    : [];
  if (!entries.length) return <p className="mt-1 text-xs text-brand-gray dark:text-muted-foreground">No recorded risk factors.</p>;
  const normalized = entries.map((entry) => Array.isArray(entry) ? { code: entry[0], ...((entry[1] && typeof entry[1] === 'object') ? entry[1] : { measured: entry[1] }) }
    : (entry && typeof entry === 'object' ? entry : { code: entry }));
  const uniqueFactors = [...new Map(normalized.map((factor) => [
    `${factor.code || factor.ruleId || factor.name || factor.field || ''}:${factor.field || ''}:${factor.measured ?? ''}`,
    factor,
  ])).values()];
  return <ul className="mt-2 grid grid-cols-1 gap-x-5 sm:grid-cols-2">
    {uniqueFactors.map((factor, index) => {
      const code = String(factor.code || factor.ruleId || '').toLowerCase();
      const name = factor.name || factor.label || (code === 'bp_severe' ? 'Blood Pressure – Severe' : labelize(code || factor.field));
      return <li key={`${factor.code || factor.name || factor.field}-${index}`} className="min-w-0 border-t border-brand-border py-2 first:border-0 dark:border-border">
        <p className="break-words text-sm font-semibold text-brand-ink dark:text-foreground">{name}</p>
        {factor.description && <p className="mt-1 break-words text-xs text-brand-gray dark:text-muted-foreground">{factor.description}</p>}

      </li>;
    })}
  </ul>;
}

export default function ResidentRiskSummary() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const location = useLocation();
  const role = location.pathname.split('/').filter(Boolean)[1] || user?.role || 'phn';
  const barangayLocked = role === 'health_supervisor';
  const canViewFollowUps = can('followups.view');
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
  const totalResidents = summary.totalResidents ?? 0;
  const assessedResidents = summary.assessed ?? 0;
  const assessmentCoverage = totalResidents ? Math.round((assessedResidents / totalResidents) * 100) : 0;
  const pendingFollowUps = Number.isFinite(summary.pendingFollowUps) ? summary.pendingFollowUps : null;
  const distribution = [
    ['Low Risk', summary.low ?? 0, 'bg-emerald-500'],
    ['Moderate Risk', summary.moderate ?? 0, 'bg-amber-500'],
    ['High Risk', summary.high ?? 0, 'bg-rose-500'],
    ['Incomplete', summary.incomplete ?? 0, 'bg-violet-500'],
    ['Unassessed', summary.unassessed ?? 0, 'bg-slate-400'],
  ];

  return <div className="space-y-5">
    <PageHeader eyebrow="Community Risk" title="Resident Risk Summary" subtitle="Review current resident risk classifications and clinical screening flags within your authorized area." />

    <section aria-label="Resident operational metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div className="flex min-h-28 min-w-0 flex-col rounded-card border border-brand-border bg-white p-4 dark:border-border dark:bg-card">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Residents in Scope</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-blue dark:text-blue-300">{totalResidents}</p>
      </div>
      <div className="flex min-h-28 min-w-0 flex-col rounded-card border border-brand-border bg-white p-4 dark:border-border dark:bg-card">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Assessment Coverage</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-blue dark:text-blue-300">{assessmentCoverage}%</p>
        <p className="mt-0.5 text-xs text-brand-gray dark:text-muted-foreground">{assessedResidents} of {totalResidents} assessed</p>
      </div>
      <div className="flex min-h-28 min-w-0 flex-col rounded-card border border-brand-border bg-white p-4 dark:border-border dark:bg-card">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Pending Follow-ups</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">{pendingFollowUps ?? '—'}</p>
        <p className="mt-0.5 text-xs text-brand-gray dark:text-muted-foreground">
          {pendingFollowUps !== null ? 'Residents with pending follow-up actions' : canViewFollowUps ? 'Follow-up count unavailable' : 'Follow-up access required'}
        </p>
      </div>
    </section>

    <section className="rounded-card border border-brand-border bg-white p-4 dark:border-border dark:bg-card" aria-label="Risk distribution">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-brand-ink dark:text-foreground">Risk Distribution</h2>
        <p className="text-xs text-brand-gray dark:text-muted-foreground">For the currently filtered resident set</p>
      </div>
      <div className="space-y-3">
        {distribution.map(([label, rawValue, tone]) => {
          const value = Number(rawValue);
          const percent = totalResidents ? Math.min(100, (value / totalResidents) * 100) : 0;
          return <div key={label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3rem]">
            <span className="break-words text-brand-gray dark:text-muted-foreground">{label}</span>
            {value > 0
              ? <div className="h-2.5 min-w-0 overflow-hidden rounded-full bg-brand-bg dark:bg-card-nested" role="img" aria-label={`${label}: ${value} of ${totalResidents} residents`}>
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
              </div>
              : <span className="text-xs text-brand-gray dark:text-muted-foreground">No residents</span>}
            <span className="text-right font-semibold tabular-nums text-brand-ink dark:text-foreground">{value}</span>
          </div>;
        })}
      </div>
    </section>

    <section className="rounded-card border border-brand-border bg-white p-4 dark:border-border dark:bg-card" aria-label="Filter resident risk summary">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
              <th className="px-4 py-3">Resident</th><th className="px-4 py-3">Barangay</th><th className="px-4 py-3">Health record no.</th><th className="px-4 py-3">Risk</th><th className="px-4 py-3">Assessment</th><th className="px-4 py-3">Clinical flags</th>
            </tr></thead>
            <tbody className="divide-y divide-brand-border dark:divide-border">{rows.map((row) => <tr key={row.residentId} className="align-top transition-colors hover:bg-brand-bg/60 dark:hover:bg-hover/50">
              <td className="px-4 py-3.5"><p className="font-semibold leading-5 text-brand-ink dark:text-foreground">{row.name || 'Resident'}</p><p className="mt-1 text-xs leading-4 text-brand-gray dark:text-muted-foreground">{row.age ?? 'Age unavailable'} <span aria-hidden="true">·</span> {row.sex || 'Sex not recorded'}</p></td>
              <td className="px-4 py-3.5 text-sm leading-5 text-brand-ink dark:text-foreground">{row.barangay || '—'}{row.zone ? <span className="block text-xs text-brand-gray dark:text-muted-foreground">Zone {row.zone}</span> : null}</td>
              <td className="whitespace-nowrap px-4 py-3.5 text-sm font-medium tabular-nums text-brand-ink dark:text-foreground">{row.residentId}</td>
              <td className="px-4 py-3.5"><RiskLabel value={row.riskLevel || (row.riskAssessmentStatus === 'incomplete' ? 'Incomplete' : 'Unassessed')} /></td>
              <td className="px-4 py-3.5"><span className="block whitespace-nowrap text-sm tabular-nums text-brand-ink dark:text-foreground">{prettyDate(row.assessmentAt)}</span><span className="mt-1 block text-xs capitalize text-brand-gray dark:text-muted-foreground">{row.riskAssessmentStatus || 'unassessed'}</span></td>
              <td className="px-4 py-3.5"><ScreeningFlags row={row} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:hidden">{rows.map((row) => <article className="min-w-0 rounded-card border border-brand-border bg-white p-3.5 dark:border-border dark:bg-card" key={row.residentId}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-base font-semibold leading-5 text-brand-ink dark:text-foreground">{row.name || 'Resident'}</h2><p className="mt-1 text-xs leading-4 text-brand-gray dark:text-muted-foreground">{row.residentId} <span aria-hidden="true">·</span> {row.age ?? 'Age unavailable'} <span aria-hidden="true">·</span> {row.sex || 'Sex not recorded'}</p></div><RiskLabel value={row.riskLevel || (row.riskAssessmentStatus === 'incomplete' ? 'Incomplete' : 'Unassessed')} /></div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-brand-border pt-3 text-sm dark:border-border"><div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Barangay</dt><dd className="mt-0.5 break-words font-medium leading-5 text-brand-ink dark:text-foreground">{row.barangay || '—'}{row.zone ? ` · Zone ${row.zone}` : ''}</dd></div><div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-brand-gray dark:text-muted-foreground">Assessment</dt><dd className="mt-0.5 font-medium leading-5 text-brand-ink dark:text-foreground">{prettyDate(row.assessmentAt)}</dd></div></dl>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-brand-border pt-3 dark:border-border"><ScreeningFlags row={row} /></div>
        </article>)}</div>
        {!rows.length && <p className="p-8 text-center text-sm text-brand-gray dark:text-muted-foreground">No resident records match these filters.</p>}
        <TablePagination total={payload.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} showPageSize={false} itemLabel="residents" className="m-3" />
      </>}
    </section>}
  </div>;
}
