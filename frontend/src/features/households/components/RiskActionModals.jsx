import React, { useState } from "react";
import { Card } from "@/components/common/Card";
import { X, PhoneCall, UserPlus, ArrowUpRight } from "lucide-react";
import { RISK_WORKFLOW_STATUSES } from "@/lib/householdRisk";
import useHouseholdWorkers from "@/hooks/useHouseholdWorkers";

const workerRoles = { bhw: "Barangay Health Worker", phn: "Public Health Nurse", health_supervisor: "Health Supervisor" };

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;

function ModalShell({ title, subtitle, onClose, busy = false, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{title}</h3>
              {subtitle && <p className="text-sm text-brand-gray mt-0.5">{subtitle}</p>}
            </div>
            <button disabled={busy} onClick={onClose} className="text-brand-gray hover:text-brand-ink disabled:opacity-50" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
          {children}
        </div>
      </Card>
    </div>
  );
}

/** Create-follow-up modal shared by the risk overview + detail pages. */
export function FollowUpModal({ household, onClose, onSave }) {
  const [status, setStatus] = useState(RISK_WORKFLOW_STATUSES[1]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try { await onSave(status, notes.trim()); }
    catch (failure) { setError(failure?.message || 'Could not record the household follow-up.'); }
    finally { setSaving(false); }
  };
  return (
    <ModalShell title="Record Household Follow-up" subtitle={`${household.head} Household · ${household.barangay}`} busy={saving} onClose={onClose}>
      <div className="mt-4 space-y-4">
        <div>
          <label className="text-sm font-medium text-brand-ink">Follow-up Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls()} cursor-pointer`}>
            {RISK_WORKFLOW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Notes / Findings</label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assessment notes from the household visit..." className={`${inputCls()} resize-none`} />
        </div>
        {error && <p role="alert" className="text-sm text-brand-danger">{error}</p>}
        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-border pt-4">
          <button disabled={saving} onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
          <button disabled={saving} onClick={save} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            <PhoneCall className="h-4 w-4" /> {saving ? 'Saving...' : 'Save Follow-up'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** Assign-health-worker modal (permission-controlled). */
export function AssignWorkerModal({ household, onClose, onSave }) {
  const directory = useHouseholdWorkers({ householdId: household.id });
  const [worker, setWorker] = useState(household.assignedWorkerId || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedWorker = directory.rows.find((row) => row.id === worker);

  const save = async () => {
    if (saving || directory.loading) return;
    if (!selectedWorker) {
      setError("Please select an available worker from the authorized directory.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave(selectedWorker.id, selectedWorker.role);
    } catch (failure) {
      setError(failure?.message || "Could not save the worker assignment.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell title="Assign Health Worker" subtitle={`${household.head} Household · ${household.barangay}`} busy={saving} onClose={onClose}>
      <div className="mt-4 space-y-4">
        <div>
          <label className="text-sm font-medium text-brand-ink">Health Worker</label>
          <select value={worker} onChange={(e) => { setWorker(e.target.value); setError(""); }} disabled={directory.loading || saving || Boolean(directory.error)} className={`${inputCls(error)} cursor-pointer`}>
            <option value="">Select a worker...</option>
            {directory.rows.map((row) => <option key={row.id} value={row.id}>{row.name || "Name not recorded"} · {workerRoles[row.role] || row.role} · {row.id.slice(-8)}</option>)}
          </select>
          {directory.loading ? <p className="mt-1 text-xs text-brand-gray">Loading authorized workers...</p> : directory.error ? (
            <div role="alert" className="mt-1 text-xs text-brand-danger">{directory.error} <button type="button" onClick={directory.refresh} className="font-medium underline">Retry</button></div>
          ) : directory.rows.length === 0 ? <p className="mt-1 text-xs text-brand-gray">No active workers are available for this household.</p> : null}
          {household.assignedWorker && !household.assignedWorkerId && <p className="mt-1 text-xs text-brand-gray">Previously recorded assignment: {household.assignedWorker}. Select its current directory record to reassign.</p>}
          {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Role</label>
          <input readOnly value={selectedWorker ? workerRoles[selectedWorker.role] || selectedWorker.role : "Select a worker to view their role"} className={inputCls()} />
          <p className="mt-1 text-xs text-brand-gray">The worker's role and assignment scope are verified by the server.</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-border pt-4">
          <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
          <button
            onClick={save}
            disabled={saving || directory.loading || Boolean(directory.error) || !selectedWorker}
            className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> {saving ? "Saving..." : "Assign Worker"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** Escalate-case modal (permission-controlled). */
export function EscalateModal({ household, onClose, onSave }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (saving) return;
    if (!reason.trim()) { setError('Add the reason for escalating this household.'); return; }
    setSaving(true);
    setError('');
    try { await onSave(reason.trim()); }
    catch (failure) { setError(failure?.message || 'Could not save the household escalation.'); }
    finally { setSaving(false); }
  };
  return (
    <ModalShell title="Escalate Case" subtitle={`${household.head} Household`} busy={saving} onClose={onClose}>
      <div className="mt-4 space-y-4">
        <div className="rounded-btn border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-400">
          <span className="font-semibold">Reason:</span> {household.followUpCount} follow-up attempt(s) have not fully resolved the identified concerns.
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Current assignment</label>
          <p className="mt-1 text-sm text-brand-ink">{household.assignedWorker || "No worker assignment recorded"}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Recommended escalation</label>
          <p className="mt-1 text-sm text-brand-ink">Public Health Nurse</p>
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Reason for escalation</label>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why this case should be escalated..." className={`${inputCls()} resize-none`} />
        </div>
        {error && <p role="alert" className="text-sm text-brand-danger">{error}</p>}
        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-border pt-4">
          <button disabled={saving} onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
          <button disabled={saving} onClick={save} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-50">
            <ArrowUpRight className="h-4 w-4" /> {saving ? 'Saving...' : 'Escalate Case'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** Compact status chip reused by detail pages. */
export function RiskLevelBadge({ label, tone }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip}`}>
      <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {label}
    </span>
  );
}
