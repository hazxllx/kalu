// frontend/src/features/follow-ups/components/ScheduleRequestsPanel.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, RefreshCw, XCircle } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { residentFollowUpsApi } from '@/services/api';

const nameOf = (resident = {}) => [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(' ') || 'Resident';
const when = (value) => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';

export default function ScheduleRequestsPanel({ title = 'Resident schedule requests' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const [reason, setReason] = useState({});
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await residentFollowUpsApi.listScheduleRequests(); setRows(result?.rows || []); }
    catch (err) { setError(err?.message || 'Could not load schedule requests.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const process = async (row, decision) => {
    const note = (reason[row.id] || '').trim();
    if (decision === 'Rejected' && !note) { setError('A reason is required when rejecting a request.'); return; }
    setWorking(row.id); setError('');
    try { await residentFollowUpsApi.decideScheduleRequest(row.id, decision, note); await load(); }
    catch (err) { setError(err?.message || 'Could not process the request.'); }
    finally { setWorking(''); }
  };

  const pending = rows.filter((row) => row.status === 'Pending Approval');
  const attendanceConfirmed = rows.filter((row) => row.request_type === 'attendance').slice(0, 10);
  return <Card className="overflow-hidden">
    <div className="flex items-center justify-between gap-3 border-b border-brand-border px-4 py-3"><div><h2 className="text-sm font-semibold text-brand-ink">{title}</h2><p className="mt-0.5 text-xs text-brand-gray">{pending.length} awaiting review · Schedule updates apply only after approval.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border px-3 py-2 text-xs text-brand-ink"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
    {error && <p role="alert" className="mx-4 mt-3 rounded-btn bg-brand-danger/10 px-3 py-2 text-xs text-brand-danger">{error}</p>}
    {loading ? <div className="p-6 text-center text-sm text-brand-gray">Loading schedule requests…</div> : <>
    {pending.length === 0 && attendanceConfirmed.length === 0 && <div className="flex items-center justify-center gap-2 p-6 text-sm text-brand-gray"><CheckCircle2 className="h-4 w-4" />No pending requests or attendance confirmations.</div>}
    {pending.length > 0 && <div className="divide-y divide-brand-border/70">{pending.map((row) => {
      const isReschedule = row.request_type === 'reschedule';
      const isCancellation = row.request_type === 'cancellation';
      return <article key={row.id} className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><p className="text-sm font-semibold text-brand-ink">{nameOf(row.resident)} · {row.targetType === 'referral' ? 'Referral' : 'Follow-up'}</p>
            <p className="mt-1 text-xs text-brand-gray">{row.facility?.name || 'Registered facility'} · {row.target?.reason || row.target?.purpose || 'Scheduled care'}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-gray"><Clock3 className="h-3.5 w-3.5" />Original: {when(row.original_scheduled_at)}</p>
            {isReschedule && <p className="mt-1 text-xs font-medium text-brand-blue">Proposed: {when(row.proposed_scheduled_at)}</p>}
            {row.reason && <p className="mt-2 whitespace-pre-wrap text-sm text-brand-ink">Reason: {row.reason}</p>}
          </div><span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{row.request_type === 'reschedule' ? 'Reschedule requested' : 'Cancellation requested'}</span>
        </div>
        {isCancellation && <p className="mt-2 text-xs text-brand-gray">Approving this request cancels the service. Rejecting it keeps the original appointment in place.</p>}
        <label className="mt-3 block text-xs font-medium text-brand-gray">Decision note{!isCancellation && <span className="font-normal"> (required to reject)</span>}<textarea rows={2} value={reason[row.id] || ''} onChange={(event) => setReason((prior) => ({ ...prior, [row.id]: event.target.value }))} className="mt-1 w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink dark:bg-input" /></label>
        <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" disabled={working === row.id} onClick={() => void process(row, 'Rejected')} className="inline-flex items-center gap-1 rounded-btn border border-brand-border px-3 py-2 text-xs text-brand-ink disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />Reject</button><button type="button" disabled={working === row.id} onClick={() => void process(row, 'Approved')} className="inline-flex items-center gap-1 rounded-btn bg-brand-blue px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" />Approve</button></div>
      </article>;
    })}</div>}
    {attendanceConfirmed.length > 0 && <section className="border-t border-brand-border px-4 py-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Recent attendance confirmations</h3><div className="mt-2 divide-y divide-brand-border/60">{attendanceConfirmed.map((row) => <div key={row.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-medium text-brand-ink">{nameOf(row.resident)} · {row.targetType === 'referral' ? 'Referral' : 'Follow-up'}</p><p className="text-xs text-brand-gray">{row.facility?.name || 'Registered facility'} · {when(row.original_scheduled_at)} · Attendance confirmed</p></div>)}</div></section>}
    </>}
  </Card>;
}
