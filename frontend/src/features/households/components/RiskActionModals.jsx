import React, { useState } from "react";
import { Card } from "@/components/common/Card";
import { X, PhoneCall, UserPlus, ArrowUpRight } from "lucide-react";
import { RISK_WORKFLOW_STATUSES } from "@/lib/householdRisk";
import { ACTIVE_BHWS } from "@/services/local/tclStore";

const BHW_OPTIONS = Array.from(new Set([...ACTIVE_BHWS, "Maria Cruz", "Lourdes Ramos", "Grace Aquino", "Maria Dela Cruz", "Ana Villanueva"]));

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{title}</h3>
              {subtitle && <p className="text-sm text-brand-gray mt-0.5">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
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
  return (
    <ModalShell title="Create Follow-up" subtitle={`${household.head} Household · ${household.barangay}`} onClose={onClose}>
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
        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-border pt-4">
          <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
          <button onClick={() => onSave(status, notes.trim())} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            <PhoneCall className="h-4 w-4" /> Save Follow-up
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** Assign-health-worker modal (permission-controlled). */
export function AssignWorkerModal({ household, onClose, onSave }) {
  const [worker, setWorker] = useState(household.assignedWorker || "");
  const [role, setRole] = useState(household.assignedWorkerRole || "Barangay Health Worker");
  const [error, setError] = useState("");
  return (
    <ModalShell title="Assign Health Worker" subtitle={`${household.head} Household · ${household.barangay}`} onClose={onClose}>
      <div className="mt-4 space-y-4">
        <div>
          <label className="text-sm font-medium text-brand-ink">Health Worker</label>
          <select value={worker} onChange={(e) => setWorker(e.target.value)} className={`${inputCls()} cursor-pointer`}>
            <option value="">Select a worker...</option>
            {BHW_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls()} cursor-pointer`}>
            <option>Barangay Health Worker</option>
            <option>Public Health Nurse</option>
            <option>Health Supervisor</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-border pt-4">
          <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
          <button
            onClick={() => {
              if (!worker) {
                setError("Please select a health worker.");
                return;
              }
              onSave(worker, role);
            }}
            className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            <UserPlus className="h-4 w-4" /> Assign Worker
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** Escalate-case modal (permission-controlled). */
export function EscalateModal({ household, onClose, onSave }) {
  const [reason, setReason] = useState("");
  return (
    <ModalShell title="Escalate Case" subtitle={`${household.head} Household`} onClose={onClose}>
      <div className="mt-4 space-y-4">
        <div className="rounded-btn border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-400">
          <span className="font-semibold">Reason:</span> {household.followUpCount} follow-up attempt(s) have not fully resolved the identified concerns.
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Current assignment</label>
          <p className="mt-1 text-sm text-brand-ink">{household.assignedWorker || "Barangay Health Worker"}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Recommended escalation</label>
          <p className="mt-1 text-sm text-brand-ink">Public Health Nurse</p>
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink">Reason for escalation</label>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why this case should be escalated..." className={`${inputCls()} resize-none`} />
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-border pt-4">
          <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
          <button onClick={() => onSave(reason.trim())} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90">
            <ArrowUpRight className="h-4 w-4" /> Escalate Case
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
