import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import DocumentPreviewCard from "@/features/verification/components/DocumentPreviewCard";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { supabase } from "@/lib/supabase";
import { usersApi } from "@/services/api";
import {
  isPersonnelRole, PERSONNEL_STATE_META, personnelState, notificationMeta,
  personnelActions, personnelActionMessage, personnelOperation, personnelCreationOperation, clearPersonnelCreationOperation,
  stationAssignmentPatch, stationAssignmentError, coverageAssignmentPatch, lifecyclePayload, auditActorLabel,
} from "../personnelLifecycle";
import {
  AlertTriangle, Ban, Building2, CheckCircle2, ChevronDown, Clock, Eye, Filter, KeyRound,
  Loader2, Mail, MoreHorizontal, Pencil, Phone, Plus, RotateCcw, Search, ShieldCheck,
  Trash2, UserCheck, UserCog, Users, UserX, X,
} from "lucide-react";

const ROLE_LABELS = {
  admin: "System Administrator",
  mho: "Municipal Health Officer",
  phn: "Public Health Nurse",
  health_supervisor: "Health Supervisor",
  rhu_personnel: "RHU Personnel",
  bhw: "Barangay Health Worker",
  resident: "Resident",
  "resident-limited": "Resident (Pending Verification)",
};

// Human-readable status presentation. Raw enum values (e.g. `pending_verification`)
// are NEVER shown directly to administrators.
const STATUS_META = {
  active: { label: "Active", badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20", dot: "bg-emerald-500" },
  pending_verification: { label: "Pending Verification", badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20", dot: "bg-amber-500" },
  disabled: { label: "Deactivated", badge: "bg-rose-50 text-rose-700 ring-1 ring-rose-600/20", dot: "bg-rose-500" },
};

const roleLabel = (id) => ROLE_LABELS[id] || id || "—";
const statusMeta = (id) => STATUS_META[id] || { label: id || "—", badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-500/20", dot: "bg-slate-400" };
const inputCls = (error = /** @type {boolean | string} */ (false)) =>
  `mt-1 w-full rounded-btn border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;
const selectCls =
  "h-9 w-full min-w-0 rounded-btn border border-brand-border bg-white px-2.5 text-[13px] text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input";

const TONE_CLASSES = {
  green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
  rose: "bg-rose-50 text-rose-700 ring-1 ring-rose-600/20",
  slate: "bg-slate-100 text-slate-600 ring-1 ring-slate-500/20",
};

const formatTimestamp = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
};

const stationsLabel = (stations, options = []) => Array.isArray(stations) && stations.length
  ? stations.map((id) => options.find((station) => station.id === id)?.name || id.replace(/_/g, " ")).join(" + ") : "None assigned";

function StatusPill({ statusId }) {
  const meta = statusMeta(statusId);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function LifecyclePill({ account, compact = false }) {
  const state = personnelState(account);
  if (!state) return <StatusPill statusId={account.statusId} />;
  const meta = PERSONNEL_STATE_META[state];
  const subtleTone = { green: "border-emerald-200 text-emerald-700", amber: "border-amber-200 text-amber-700", rose: "border-rose-200 text-rose-700", slate: "border-slate-200 text-brand-gray" };
  return <span title={meta.description} className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${compact ? `border bg-white ${subtleTone[meta.tone] || subtleTone.slate}` : TONE_CLASSES[meta.tone]}`}>{meta.label}</span>;
}

function EmailState({ notification, detailed = false }) {
  const meta = notificationMeta(notification);
  return (
    <div title={meta.message} className="min-w-0">
      <span className={`inline-flex max-w-full items-center gap-1.5 text-xs ${meta.tone === "rose" ? "text-brand-danger" : "text-brand-gray"}`}>
        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className={detailed ? "" : "truncate"}>{meta.label}</span>
      </span>
      {detailed && <p className="mt-1 text-xs leading-relaxed text-brand-gray">{meta.message}</p>}
    </div>
  );
}

function AccountDialog({ title, description, busy = false, onClose, children, wide = false }) {
  const returnFocus = useRef(typeof document !== "undefined" ? document.activeElement : null);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-[85] max-h-[92dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-lg focus:outline-none dark:border-border dark:bg-card sm:p-6 ${wide ? "max-w-2xl" : "max-w-lg"}`}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus();
          }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="break-words text-lg font-semibold text-brand-ink">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 break-words text-sm text-brand-gray">{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" disabled={busy} className="shrink-0 rounded p-1 text-brand-gray hover:bg-brand-bg disabled:opacity-60" aria-label="Close dialog"><X className="h-5 w-5" /></button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, htmlFor, required = false, hint = "", error = "", children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium text-brand-ink">
        {label}{required && <span className="ml-1 text-brand-danger">*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-brand-danger">{error}</p>
        : hint ? <p className="mt-1 text-xs text-brand-gray">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Summary cards                                                             */
/* ------------------------------------------------------------------------- */

const SUMMARY_CARDS = [
  { key: "", label: "All accounts", metric: "total", icon: Users, tone: "text-brand-blue bg-brand-blue/10" },
  { key: "active", label: "Active", metric: "active", icon: UserCheck, tone: "text-emerald-700 bg-emerald-50" },
  { key: "pending_verification", label: "Pending verification", metric: "pending_verification", icon: Clock, tone: "text-amber-700 bg-amber-50" },
  { key: "disabled", label: "Deactivated", metric: "disabled", icon: UserX, tone: "text-rose-700 bg-rose-50" },
];

const PERSONNEL_SUMMARY_CARDS = [
  { key: "", label: "Total Personnel", metric: "total", icon: Users, tone: "text-brand-blue bg-brand-blue/10" },
  { key: "active", label: "Active", metric: "active", icon: UserCheck, tone: "text-emerald-700 bg-emerald-50" },
  { key: "pending", label: "Pending Approval", metric: "pendingApproval", icon: Clock, tone: "text-amber-700 bg-amber-50" },
  { key: "awaiting_setup", label: "Awaiting Setup", metric: "awaitingSetup", icon: KeyRound, tone: "text-amber-700 bg-amber-50" },
  { key: "approved_inactive", label: "Inactive", metric: "approvedInactive", icon: UserX, tone: "text-slate-600 bg-slate-100" },
  { key: "suspended", label: "Suspended", metric: "suspended", icon: Ban, tone: "text-rose-700 bg-rose-50" },
];

function SummaryCards({ summary, loading, error, activeStatus, onPick, personnelOnly }) {
  const cards = personnelOnly ? PERSONNEL_SUMMARY_CARDS : SUMMARY_CARDS;
  return (
    <div className={`mb-4 grid grid-cols-2 gap-3 ${personnelOnly ? "sm:grid-cols-3" : "lg:grid-cols-4"}`}>
      {cards.map((card) => {
        const selected = activeStatus === card.key;
        const Icon = card.icon;
        const value = summary ? summary[card.metric] ?? 0 : null;
        return (
          <button
            key={card.label}
            type="button"
            onClick={() => onPick(card.key)}
            aria-pressed={selected}
            className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left shadow-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 ${
              selected ? "border-brand-blue ring-1 ring-brand-blue/30" : "border-slate-200 hover:border-brand-blue/50"
            }`}
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.tone}`}>
              <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-semibold tabular-nums text-brand-ink">
                {error ? "—" : loading && value === null ? "…" : (value ?? 0).toLocaleString()}
              </span>
              <span className="block text-xs text-brand-gray">{card.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Actions dropdown menu                                                     */
/* ------------------------------------------------------------------------- */

function ActionsMenu({ items, buttonLabel = "Account actions", compact = false }) {
  const btnRef = useRef(null);
  const selected = useRef(false);
  const available = items.filter(Boolean);
  if (available.length === 0) return <span className="text-xs text-brand-gray">-</span>;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button
        ref={btnRef}
        type="button"
        aria-label={buttonLabel}
        className={`inline-flex h-9 items-center justify-center gap-1 rounded-btn border border-slate-200 bg-white text-sm font-medium text-brand-ink hover:bg-brand-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:border-border ${compact ? "w-9" : "px-2.5"}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        {!compact && <><span className="hidden sm:inline">Actions</span><ChevronDown className="hidden h-3.5 w-3.5 sm:inline" aria-hidden="true" /></>}
      </button></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={buttonLabel}
          onCloseAutoFocus={(event) => { if (selected.current) event.preventDefault(); selected.current = false; }}
          className="z-[95] w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-border dark:bg-card"
        >
          {available.map((item) => (
            <DropdownMenu.Item
              key={item.key}
              disabled={item.disabled}
              title={item.title || undefined}
              onSelect={() => { selected.current = true; btnRef.current?.focus(); item.onClick(); }}
              className={`flex w-full cursor-default items-center gap-2.5 px-3 py-2 text-left text-sm outline-none transition-colors ${
                item.disabled
                  ? "cursor-not-allowed text-slate-400"
                  : item.danger
                    ? "text-brand-danger data-[highlighted]:bg-brand-danger/10"
                    : "text-brand-ink data-[highlighted]:bg-brand-bg"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{item.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ------------------------------------------------------------------------- */
/* Confirm dialog (deactivate / reactivate / reset access)                   */
/* ------------------------------------------------------------------------- */

function ConfirmDialog({ title, message, confirmLabel, busy, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <Card className="w-full max-w-md" role="dialog" aria-modal="true" aria-label={title}>
        <div className="p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue" />
            <div>
              <h2 className="font-semibold text-brand-ink">{title}</h2>
              <p className="mt-1 text-sm text-brand-gray">{message}</p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-btn px-3 py-2 text-sm text-brand-gray hover:bg-brand-bg disabled:opacity-60">
              Cancel
            </button>
            <button onClick={onConfirm} disabled={busy} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Delete confirmation dialog (type-to-confirm)                              */
/* ------------------------------------------------------------------------- */

function DeleteDialog({ target, busy, error, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === String(target.email || "").trim().toLowerCase();

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <Card className="w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-danger/10 text-brand-danger">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="delete-account-title" className="text-lg font-semibold text-brand-ink">Delete account?</h2>
              <p className="mt-1 break-words text-sm text-brand-gray">
                You are about to permanently delete <span className="font-medium text-brand-ink">{target.name}</span>{" "}
                (<span className="break-all">{target.email}</span>).
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-btn bg-brand-danger/10 px-3 py-2.5 text-sm text-brand-danger">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                This permanently removes the sign-in account and cannot be undone. The person can no longer log in.
                Linked health records are preserved but will no longer be attributed to this account.
              </span>
            </p>
          </div>

          <div className="mt-4">
            <label htmlFor="delete-confirm-email" className="text-sm font-medium text-brand-ink">
              Type <span className="font-semibold">{target.email}</span> to confirm
            </label>
            <input
              id="delete-confirm-email"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={busy}
              autoComplete="off"
              className={inputCls(false)}
              placeholder={target.email}
              aria-describedby="delete-confirm-help"
            />
            <p id="delete-confirm-help" className="mt-1 text-xs text-brand-gray">
              Confirmation protects against deleting the wrong account.
            </p>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-btn bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-btn px-3 py-2 text-sm text-brand-gray hover:bg-brand-bg disabled:opacity-60">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy || !matches}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              {busy ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* View details modal                                                        */
/* ------------------------------------------------------------------------- */

function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-brand-gray">{label}</dt>
      <dd className="break-words text-sm text-brand-ink sm:max-w-[60%] sm:text-right">{value}</dd>
    </div>
  );
}

function DetailsModal({ target: initialTarget, options, onClose }) {
  const [target, setTarget] = useState(initialTarget);
  const personnel = Boolean(personnelState(target));
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(personnel);
  const sequence = useRef(0);
  const loadHistory = useCallback(async () => {
    const request = ++sequence.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const [result, profile] = await Promise.all([usersApi.history(target.id), usersApi.get(target.id)]);
      if (request === sequence.current) {
        setHistory(result);
        if (profile?.user) setTarget({ ...profile.user, roleId: profile.user.role, role: roleLabel(profile.user.role), statusId: profile.user.status });
      }
      return result;
    } catch (error) {
      if (request === sequence.current) setHistoryError(error?.message || "Account history could not be loaded.");
    } finally {
      if (request === sequence.current) setHistoryLoading(false);
    }
  }, [target.id]);

  useEffect(() => {
    if (personnel) void loadHistory();
    return () => { sequence.current += 1; };
  }, [personnel, loadHistory]);

  const legacyRequest = history?.request;
  const documents = Array.isArray(legacyRequest?.verificationDocuments) ? legacyRequest.verificationDocuments : [];
  const coverage = target.barangay || target.facility || target.municipality
    || (target.roleId === "admin" ? "System-wide" : "Not assigned");

  return (
    <AccountDialog title={target.name || "Account details"} description={target.email || "Account profile and history"} onClose={onClose} wide={personnel}>
      <dl className="rounded-xl border border-slate-200 px-4 py-1">
        <DetailRow label={personnel ? "Lifecycle" : "Status"} value={<LifecyclePill account={target} />} />
        {personnel && <DetailRow label="Sign-in access" value={target.statusId === "active" && personnelState(target) === "active" ? "Enabled" : "Not enabled"} />}
        <DetailRow label="Role" value={roleLabel(target.roleId)} />
        <DetailRow label="Coverage" value={coverage} />
        <DetailRow label="Municipality" value={target.municipality || "Not assigned"} />
        <DetailRow label="Barangay" value={target.barangay || "Not assigned"} />
        <DetailRow label="RHU facility" value={target.facility || "Not assigned"} />
        {isPersonnelRole(target.roleId) && <DetailRow label="RHU stations" value={stationsLabel(target.rhuStations, options.rhuStations)} />}
        <DetailRow label="Contact number" value={target.contact || "Not provided"} />
        <DetailRow label="Position" value={target.position || "Not provided"} />
        <DetailRow label="License number" value={target.licenseNo || "Not provided"} />
        {personnel && <>
          <DetailRow label="Approval" value={target.approvalStatus ? target.approvalStatus.replace(/_/g, " ") : "Not recorded"} />
          <DetailRow label="Activation requested" value={typeof target.activationRequested === "boolean" ? target.activationRequested ? "Yes" : "No; activation withheld" : "Not recorded"} />
          <DetailRow label="Password setup" value={target.setupRequired === true ? "Required" : target.setupRequired === false ? "No setup required" : "Not recorded"} />
          <DetailRow label="Setup completed" value={formatTimestamp(target.setupCompletedAt)} />
          {target.suspendedAt && <DetailRow label="Suspended at" value={formatTimestamp(target.suspendedAt)} />}
          {target.suspensionReason && <DetailRow label="Suspension reason" value={target.suspensionReason} />}
          {target.decisionReason && <DetailRow label="Decision reason" value={target.decisionReason} />}
          <DetailRow label="Latest email" value={<EmailState notification={target.notification} detailed />} />
        </>}
      </dl>

      {personnel && <section className="mt-5" aria-label="Account history">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-brand-ink">Account History</h3>
          <button type="button" onClick={loadHistory} disabled={historyLoading} className="rounded-btn px-2 py-1 text-xs font-medium text-brand-blue hover:bg-brand-blue/10 disabled:opacity-60">Refresh history</button>
        </div>
        {historyLoading && <p role="status" className="flex items-center gap-2 text-sm text-brand-gray"><Loader2 className="h-4 w-4 animate-spin" /> Loading audit and email history...</p>}
        {historyError && <p role="alert" className="rounded-btn bg-brand-danger/10 p-3 text-sm text-brand-danger">{historyError}</p>}
        {history && !historyLoading && !historyError && <>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Decisions and Changes</h4>
          {(history.audit || []).length === 0 ? <p className="mt-2 text-sm text-brand-gray">No audit events recorded.</p> : <ol className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
            {history.audit.map((entry) => <li key={entry.id} className="py-3 text-sm">
              <p className="font-medium text-brand-ink">{String(entry.action || "Account event").replace(/_/g, " ")}</p>
              <p className="mt-0.5 break-words text-xs text-brand-gray">{formatTimestamp(entry.createdAt)} | Actor: {auditActorLabel(entry)}</p>
              {entry.metadata?.reason && <p className="mt-1 break-words text-sm text-brand-ink">Reason: {entry.metadata.reason}</p>}
              {entry.metadata?.performed_by === "personnel_notification_worker" && <>
                <p className="mt-1 break-words text-xs text-brand-gray">Attempts: {entry.metadata.new?.attempts ?? "Not recorded"} | Requested by: {entry.metadata.requested_by || "Not recorded"}</p>
                {entry.metadata.new?.reason && <p className="mt-1 break-words text-xs text-brand-gray">Mail failure code: {entry.metadata.new.reason}</p>}
              </>}
            </li>)}
          </ol>}
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-gray">Email Attempts</h4>
          {(history.notifications || []).length === 0 ? <p className="mt-2 text-sm text-brand-gray">No email events recorded.</p> : <ol className="mt-2 space-y-2">
            {history.notifications.map((entry) => <li key={entry.id} className="rounded-xl border border-slate-200 p-3">
              <p className="mb-1 text-sm font-medium text-brand-ink">{String(entry.eventType || "Account notification").replace(/_/g, " ")}</p>
              <EmailState notification={entry} detailed />
              <p className="mt-2 text-xs text-brand-gray">Attempts: {entry.attempts ?? 0}{entry.sentAt ? ` | Accepted: ${formatTimestamp(entry.sentAt)}` : ""}</p>
              {entry.nextAttemptAt && <p className="mt-1 text-xs text-brand-gray">Next attempt: {formatTimestamp(entry.nextAttemptAt)}</p>}
              {entry.lastErrorCode && <p className="mt-1 break-words text-xs text-brand-gray">Failure code: {entry.lastErrorCode}</p>}
              {entry.providerMessageId && <p className="mt-1 break-all text-xs text-brand-gray">Mail-server reference: {entry.providerMessageId}</p>}
            </li>)}
          </ol>}
          {legacyRequest && <section className="mt-4" aria-label="Historical personnel request">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Historical Request</h4>
            <dl className="mt-2 rounded-xl border border-slate-200 px-3">
              <DetailRow label="Reference" value={legacyRequest.id} />
              <DetailRow label="Request status" value={String(legacyRequest.status || "Not recorded").replace(/_/g, " ")} />
              <DetailRow label="Submitted" value={formatTimestamp(legacyRequest.submittedAt)} />
              <DetailRow label="Reviewed" value={formatTimestamp(legacyRequest.decidedAt)} />
              {legacyRequest.rejectionReason && <DetailRow label="Recorded reason" value={legacyRequest.rejectionReason} />}
            </dl>
            {documents.length > 0 && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {documents.map((doc) => <DocumentPreviewCard
                key={doc.id}
                doc={{ id: doc.id, title: doc.documentType, filename: doc.originalFilename, mimeType: doc.mimeType, url: doc.url }}
                filenameWrap
                onEnlarge={(document) => { if (document.url) window.open(document.url, "_blank", "noopener,noreferrer"); }}
                onRefreshUrl={async (id) => {
                  const result = await loadHistory();
                  return result?.request?.verificationDocuments?.find((document) => document.id === id)?.url || null;
                }}
              />)}
            </div>}
          </section>}
        </>}
      </section>}
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-btn border border-slate-200 px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:border-border">Close</button>
      </div>
    </AccountDialog>
  );
}

const LIFECYCLE_ACTIONS = {
  approve: { title: "Approve staff account", label: "Approve", icon: ShieldCheck },
  reject: { title: "Reject staff account", label: "Reject", icon: UserX, danger: true },
  suspend: { title: "Suspend staff access", label: "Suspend", icon: Ban, danger: true },
  reactivate: { title: "Reactivate staff account", label: "Save activation choice", icon: UserCheck },
  invite: { title: "Request a new invitation", label: "Request new invitation", icon: Mail },
  retry_email: { title: "Retry failed email", label: "Retry failed email", icon: RotateCcw },
};

function LifecycleDialog({ target, action, busy, error, canActivate, onSave, onClose }) {
  const [reason, setReason] = useState("");
  const [activate, setActivate] = useState(canActivate);
  const [newInviteConfirmed, setNewInviteConfirmed] = useState(false);
  const [validationError, setValidationError] = useState("");
  const operation = useRef(null);
  const meta = LIFECYCLE_ACTIONS[action];
  const needsReason = action === "reject" || action === "suspend";
  const activationChoice = action === "approve" || action === "reactivate";
  const descriptions = {
    approve: "Record approval separately from password setup. Approval alone does not confirm that the account owner has set a password.",
    reject: "Record the rejection reason and keep this account and its history. Sign-in remains disabled.",
    suspend: "Deny protected access without deleting the account, its assignments, or historical records. A reason is required.",
    reactivate: "Clear any suspension and record the activation choice. Access still requires approval and completed password setup.",
    invite: "Request a NEW password-setup invitation, not a retry. A previous email may already have been accepted by the mail server.",
    retry_email: "Retry only a definitive email failure. This does not create another account or change its approval. An uncertain send must be reviewed manually instead.",
  };
  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    try {
      if (action === "invite" && !newInviteConfirmed) throw new Error("Confirm that you intend to request a new invitation.");
      const payload = lifecyclePayload(action, { reason, activate: canActivate && activate });
      operation.current = personnelOperation(operation.current, payload);
      setValidationError("");
      onSave({ ...payload, operationId: operation.current.id });
    } catch (failure) {
      setValidationError(failure.message);
    }
  };
  return (
    <AccountDialog title={action === "approve" && target.approvalStatus === "rejected" ? "Reconsider staff approval" : meta.title} description={`${target.name} (${target.email}). ${descriptions[action]}`} busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <LifecyclePill account={target} />
        {action === "approve" && target.approvalStatus === "rejected" && <p className="text-sm leading-relaxed text-brand-gray">Reconsider approval without creating a new identity or removing prior history.{target.decisionReason && ` Previous rejection reason: ${target.decisionReason}`}</p>}
        {(needsReason || activationChoice) && <Field label={needsReason ? "Reason" : "Remarks"} htmlFor="lifecycle-reason" required={needsReason}>
          <textarea id="lifecycle-reason" value={reason} onChange={(event) => { setReason(event.target.value); setValidationError(""); }} required={needsReason} maxLength={1000} rows={3} disabled={busy} className={inputCls()} />
        </Field>}
        {activationChoice && <div className="rounded-xl border border-slate-200 p-3">
          <label className="flex items-start gap-2 text-sm font-medium text-brand-ink">
            <input type="checkbox" checked={canActivate && activate} onChange={(event) => setActivate(event.target.checked)} disabled={busy || !canActivate} className="mt-1 accent-brand-blue" />
            <span>Allow activation after password setup</span>
          </label>
          <p className="mt-2 text-xs leading-relaxed text-brand-gray">{canActivate && activate ? target.setupRequired === true ? "The account stays disabled until its owner successfully completes password setup." : target.setupRequired === false ? "No new password setup is required for this existing account. Activation uses its current credentials." : "Password-setup requirements are not verified in this snapshot. Activation still depends on the server's verified account state." : "Keep the approved account inactive, even after password setup. An administrator must authorize activation later."}</p>
          {!canActivate && <p className="mt-1 text-xs text-brand-gray">You do not have activation permission. Approval will not authorize sign-in access.</p>}
        </div>}
        {action === "invite" && <label className="flex items-start gap-2 text-sm text-brand-ink">
          <input type="checkbox" checked={newInviteConfirmed} onChange={(event) => setNewInviteConfirmed(event.target.checked)} required disabled={busy} className="mt-1 accent-brand-blue" />
          <span>I intend to issue a new invitation, not retry a previously sent email.</span>
        </label>}
        {(error || validationError) && <p role="alert" className="rounded-btn bg-brand-danger/10 p-3 text-sm text-brand-danger">{validationError || error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-btn px-3 py-2 text-sm text-brand-gray hover:bg-brand-bg disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={busy} className={`inline-flex items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${meta.danger ? "bg-brand-danger hover:bg-brand-danger/90" : "bg-brand-blue hover:bg-brand-dark"}`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Saving..." : meta.label}
          </button>
        </div>
      </form>
    </AccountDialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Invite / edit account modal                                               */
/* ------------------------------------------------------------------------- */

function AccountModal({ initial, options, busy, error, actorId, canManageRoles, canApprove, canDeactivate, canEdit, personnelOnly, onClose, onSave }) {
  const isNew = !initial;
  const [form, setForm] = useState(() => ({
    name: initial?.name || "",
    email: initial?.email || "",
    contact: initial?.contact || "",
    position: initial?.position || "",
    licenseNo: initial?.licenseNo || "",
    role: initial?.roleId || "phn",
    municipalityId: initial?.municipalityId || "",
    barangayId: initial?.barangayId || "",
    facilityId: initial?.facilityId || "",
    rhuStations: Array.isArray(initial?.rhuStations) ? initial.rhuStations : [],
    approvalStatus: canApprove ? "approved" : "pending",
    activate: canDeactivate,
  }));
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [preparing, setPreparing] = useState(false);
  const [creationWarning, setCreationWarning] = useState("");
  const preparation = useRef(false);
  const operation = useRef(null);
  const role = form.role;
  const personnel = isPersonnelRole(role);
  const stationScoped = role === "rhu_personnel" || role === "health_supervisor";
  const residentRole = initial?.roleId === "resident" || initial?.roleId === "resident-limited";
  const barangayScoped = role === "health_supervisor" || role === "bhw";
  const facilityScoped = role === "rhu_personnel";
  const municipalityScoped = role === "mho" || role === "phn";
  const visibleBarangays = useMemo(
    () => options.barangays.filter((item) => !form.municipalityId || item.municipalityId === form.municipalityId),
    [options.barangays, form.municipalityId],
  );
  const visibleFacilities = useMemo(
    () => options.facilities.filter((item) => !form.municipalityId || item.municipalityId === form.municipalityId),
    [options.facilities, form.municipalityId],
  );

  const change = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "role") {
        if (value !== "rhu_personnel" && value !== "health_supervisor") next.rhuStations = [];
        if (value === "admin") {
          next.municipalityId = "";
          next.barangayId = "";
          next.facilityId = "";
        } else if (value === "rhu_personnel") {
          next.barangayId = "";
        } else if (value === "health_supervisor" || value === "bhw") {
          next.facilityId = "";
        } else {
          next.barangayId = "";
          next.facilityId = "";
        }
      }
      if (key === "municipalityId") {
        if (next.barangayId && !options.barangays.some((item) => item.id === next.barangayId && item.municipalityId === value)) next.barangayId = "";
        if (next.facilityId && !options.facilities.some((item) => item.id === next.facilityId && item.municipalityId === value)) next.facilityId = "";
      }
      return next;
    });
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const validate = async () => {
    if (busy || preparation.current || !canEdit) return false;
    const next = /** @type {Record<string, string>} */ ({});
    const details = {
      municipalityId: form.municipalityId || null,
      barangayId: form.barangayId || null,
      facilityId: form.facilityId || null,
    };
    const coveragePatch = coverageAssignmentPatch(role, details, initial);
    const assignmentChanged = isNew || role !== initial.roleId || Object.keys(coveragePatch).length > 0;
    if (!form.name.trim() || form.name.trim().length > 120) next.name = "Enter a name of 1–120 characters.";
    if (isNew && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (!role || ((isNew || role !== initial.roleId) && (!options.roles.some((item) => item.id === role) || (personnelOnly && !personnel)))) next.role = "Select an available account role.";
    if (!isNew && role !== initial.roleId && (!canManageRoles || residentRole)) next.role = "Role changes are not allowed for this account.";
    if (!isNew && Object.keys(coveragePatch).length > 0 && !canManageRoles) next.form = "Assignment changes are not allowed for this account.";
    if (isNew && form.approvalStatus === "approved" && !canApprove) next.approvalStatus = "Approval permission is required. Save this account pending instead.";
    if (assignmentChanged && barangayScoped && !form.barangayId) next.barangayId = "Select a barangay.";
    if (assignmentChanged && facilityScoped && !form.facilityId) next.facilityId = "Select an RHU facility.";
    if (assignmentChanged && municipalityScoped && !form.municipalityId) next.municipalityId = "Select a municipality.";
    const stationPatch = stationAssignmentPatch(role, form.rhuStations, initial);
    const stationError = stationAssignmentError(role, form.rhuStations, options.rhuStations, initial);
    if (stationError) next.rhuStations = stationError;
    if (!isNew && Object.hasOwn(stationPatch, "rhuStations") && !canManageRoles) next.rhuStations = "Station assignment changes are not allowed for this account.";
    setErrors(next);
    if (Object.keys(next).length) return false;

    if (isNew) {
      const payload = {
        ...details,
        ...stationPatch,
        email: form.email.trim(),
        name: form.name.trim(),
        contact: form.contact.trim(),
        position: form.position.trim(),
        licenseNo: form.licenseNo.trim(),
        role: form.role,
        approvalStatus: form.approvalStatus,
        activate: canDeactivate && form.activate,
      };
      preparation.current = true;
      setPreparing(true);
      try {
        operation.current = await personnelCreationOperation(operation.current, payload, actorId);
        setCreationWarning(operation.current.persistent ? "" : `The safe retry reference could not be saved in this browser. Keep this page open and retry with unchanged details. If you leave or reload after failure, administrative review may be required. Request reference: ${operation.current.id}`);
        await onSave({ ...payload, operationId: operation.current.id }, operation.current);
      } catch (failure) {
        setErrors({ form: failure.message });
        return false;
      } finally {
        preparation.current = false;
        setPreparing(false);
      }
      return true;
    }

    const patch = {
      name: form.name.trim(),
      contact: form.contact.trim(),
      position: form.position.trim(),
      licenseNo: form.licenseNo.trim(),
      ...stationPatch,
      ...coveragePatch,
    };
    if (form.role !== initial.roleId) patch.role = form.role;
    try {
      operation.current = personnelOperation(operation.current, patch);
      onSave({ ...patch, operationId: operation.current.id });
    } catch (failure) {
      setErrors({ form: failure.message });
      return false;
    }
    return true;
  };

  return (
    <AccountDialog
      title={isNew ? personnel ? "Create health personnel account" : "Create administrator account" : "Edit account"}
      description={isNew ? "Create and approve in one action, or save pending for later review. The account owner sets their own password through a secure invitation; no password is entered here." : "Update profile, role, and coverage assignment. Existing assignments remain unchanged unless you edit them."}
      busy={busy || preparing}
      onClose={onClose}
      wide
    >
        <form onSubmit={(event) => { event.preventDefault(); validate(); }}>
          {(error || errors.form) && (
            <div className="mb-4 flex items-start gap-2 rounded-btn bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{errors.form || error}</span>
            </div>
          )}
          {isNew && error && <p className="mb-3 text-xs leading-relaxed text-brand-gray">Retry with the same details and approval/activation choices to resume the saved creation request. Changing the details starts a different request; an existing email is never automatically adopted.</p>}
          {creationWarning && <p role="status" className="mb-4 break-words rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">{creationWarning}</p>}

          <fieldset disabled={busy || preparing} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="account-name" required error={errors.name}>
              <input id="account-name" value={form.name} onChange={(event) => change("name", event.target.value)} className={inputCls(errors.name)} autoComplete="name" />
            </Field>
            <Field label="Email" htmlFor="account-email" required={isNew} hint={isNew ? "Account notifications and password-setup invitations use this address." : "Managed by Supabase Auth; read-only here."} error={errors.email}>
              <input id="account-email" type="email" value={form.email} onChange={(event) => change("email", event.target.value)} disabled={!isNew} className={`${inputCls(errors.email)} disabled:cursor-not-allowed disabled:opacity-70`} autoComplete="email" />
            </Field>
            <Field label="Contact number" htmlFor="account-contact">
              <input id="account-contact" value={form.contact} onChange={(event) => change("contact", event.target.value)} className={inputCls()} autoComplete="tel" />
            </Field>
            <Field label="Position" htmlFor="account-position">
              <input id="account-position" value={form.position} onChange={(event) => change("position", event.target.value)} className={inputCls()} />
            </Field>
            <Field label="License number" htmlFor="account-license">
              <input id="account-license" value={form.licenseNo} onChange={(event) => change("licenseNo", event.target.value)} className={inputCls()} />
            </Field>
            <Field label="Role" htmlFor="account-role" required error={errors.role} hint={residentRole ? "Resident identities are managed through registration." : !canManageRoles && !isNew ? "Role changes are not allowed for this account." : undefined}>
              <select
                id="account-role"
                value={form.role}
                onChange={(event) => change("role", event.target.value)}
                disabled={!canManageRoles || residentRole}
                className={`${inputCls(errors.role)} disabled:cursor-not-allowed disabled:opacity-70`}
              >
                {options.roles.filter((item) => item.id !== "resident" && item.id !== "resident-limited" && (!personnelOnly || isPersonnelRole(item.id))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                {residentRole && <option value={initial.roleId}>{roleLabel(initial.roleId)}</option>}
              </select>
            </Field>
            {(municipalityScoped || barangayScoped || facilityScoped) && (
              <Field label="Municipality" htmlFor="account-municipality" required={municipalityScoped} error={errors.municipalityId}>
                <select id="account-municipality" value={form.municipalityId} onChange={(event) => change("municipalityId", event.target.value)} disabled={!canManageRoles} className={inputCls(errors.municipalityId)}>
                  <option value="">Select municipality</option>
                  {initial?.municipalityId === form.municipalityId && form.municipalityId && !options.municipalities.some((item) => item.id === form.municipalityId) && <option value={form.municipalityId}>{initial.municipality || "Current municipality"} (existing assignment)</option>}
                  {options.municipalities.map((item) => <option key={item.id} value={item.id}>{item.name}{item.province ? `, ${item.province}` : ""}</option>)}
                </select>
              </Field>
            )}
            {barangayScoped && (
              <Field label="Assigned barangay" htmlFor="account-barangay" required error={errors.barangayId}>
                <select id="account-barangay" value={form.barangayId} onChange={(event) => change("barangayId", event.target.value)} disabled={!canManageRoles} className={inputCls(errors.barangayId)}>
                  <option value="">Select barangay</option>
                  {initial?.barangayId === form.barangayId && form.barangayId && !visibleBarangays.some((item) => item.id === form.barangayId) && <option value={form.barangayId}>{initial.barangay || "Current barangay"} (existing assignment)</option>}
                  {visibleBarangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
            )}
            {facilityScoped && (
              <Field label="Assigned RHU facility" htmlFor="account-facility" required error={errors.facilityId}>
                <select id="account-facility" value={form.facilityId} onChange={(event) => change("facilityId", event.target.value)} disabled={!canManageRoles} className={inputCls(errors.facilityId)}>
                  <option value="">Select RHU facility</option>
                  {initial?.facilityId === form.facilityId && form.facilityId && !visibleFacilities.some((item) => item.id === form.facilityId) && <option value={form.facilityId}>{initial.facility || "Current RHU facility"} (existing assignment)</option>}
                  {visibleFacilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
            )}
            {stationScoped && <fieldset disabled={!canManageRoles} className="min-w-0 rounded-xl border border-slate-200 p-3 sm:col-span-2" aria-describedby={errors.rhuStations ? "account-stations-help account-stations-error" : "account-stations-help"} aria-invalid={Boolean(errors.rhuStations)}>
              <legend className="px-1 text-sm font-medium text-brand-ink">RHU stations{role === "rhu_personnel" ? " (required)" : " (optional)"}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                {options.rhuStations.map((station) => <label key={station.id} className="flex items-center gap-2 text-sm text-brand-ink">
                  <input type="checkbox" checked={form.rhuStations.includes(station.id)} onChange={(event) => change("rhuStations", event.target.checked ? [...form.rhuStations, station.id] : form.rhuStations.filter((id) => id !== station.id))} className="accent-brand-blue" />{station.name}
                </label>)}
                {form.rhuStations.filter((id) => !options.rhuStations.some((station) => station.id === id)).map((id) => <label key={id} className="flex items-center gap-2 text-sm text-brand-gray">
                  <input type="checkbox" checked onChange={() => change("rhuStations", form.rhuStations.filter((station) => station !== id))} className="accent-brand-blue" />{id} (existing assignment)
                </label>)}
              </div>
              <p id="account-stations-help" className="mt-2 text-xs text-brand-gray">{role === "rhu_personnel" ? "RHU personnel require at least one valid station. Station assignment controls their workspace access." : "Health Supervisors may hold RHU stations in addition to their barangay assignment."}</p>
              {options.rhuStations.length === 0 && <p className="mt-1 text-xs text-brand-gray">Station choices have not been supplied by the server.</p>}
              {errors.rhuStations && <p id="account-stations-error" role="alert" className="mt-1 text-xs text-brand-danger">{errors.rhuStations}</p>}
            </fieldset>}
            {isNew && <div className="space-y-3 rounded-xl border border-brand-blue/20 bg-brand-blue/5 p-4 sm:col-span-2">
              <Field label="Approval decision" htmlFor="account-approval" error={errors.approvalStatus}>
                <select id="account-approval" value={form.approvalStatus} onChange={(event) => change("approvalStatus", event.target.value)} className={inputCls()}>
                  <option value="approved" disabled={!canApprove}>Create and approve</option>
                  <option value="pending">Save pending for later review</option>
                </select>
              </Field>
              <label className="flex items-start gap-2 text-sm font-medium text-brand-ink">
                <input type="checkbox" checked={canDeactivate && form.activate} onChange={(event) => change("activate", event.target.checked)} disabled={!canDeactivate} className="mt-1 accent-brand-blue" />
                <span>Allow activation after approval and password setup</span>
              </label>
              <p className="text-xs leading-relaxed text-brand-gray">{form.approvalStatus === "pending" ? "No sign-in access or setup invitation is granted while approval is pending." : "New approved accounts stay disabled until the owner successfully sets a password through the invitation."}{(!canDeactivate || !form.activate) && " Activation will remain withheld even after setup; an administrator must activate the account later."}</p>
              {!canDeactivate && <p className="text-xs text-brand-gray">You do not have activation permission, so this account will be created inactive.</p>}
            </div>}
            {role === "admin" && <p className="sm:col-span-2 text-xs text-brand-gray">Administrator accounts have system-wide scope.</p>}
          </fieldset>

          <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-border">
            <button type="button" onClick={onClose} disabled={busy || preparing} className="rounded-btn px-3 py-2 text-sm text-brand-gray hover:bg-brand-bg disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={busy || preparing || !canEdit} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
              {isNew ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {busy ? "Saving..." : preparing ? "Preparing secure request..." : isNew ? form.approvalStatus === "approved" ? "Create and Approve" : "Save Pending" : "Save changes"}
            </button>
          </div>
        </form>
    </AccountDialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Account identity cell (shared desktop + mobile)                           */
/* ------------------------------------------------------------------------- */

function AccountIdentity({ row, compact = false }) {
  return (
    <div className={`flex min-w-0 items-start ${compact ? "gap-2" : "gap-3"}`}>
      <span className={`mt-0.5 flex shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-sm font-semibold uppercase text-brand-blue ${compact ? "h-8 w-8" : "h-9 w-9"}`}>
        {(row.name || "?").trim().charAt(0)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-brand-ink" title={row.name}>{row.name}</p>
        <p className="truncate text-xs text-brand-gray" title={row.email}>{row.email}</p>
        {personnelState(row) && <div className="mt-1"><EmailState notification={row.notification} /></div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Page                                                                      */
/* ------------------------------------------------------------------------- */

export default function UserManagement({ personnelOnly = false }) {
  const { user: currentUser } = useAuth();
  const { can } = usePermissions();
  const isAdmin = currentUser?.role === "admin";
  const canCreate = isAdmin && can("accounts.create");
  const canEdit = isAdmin && can("accounts.edit");
  const canManageRoles = isAdmin && can("accounts.roles.manage");
  const canApprove = isAdmin && can("accounts.personnel.approve");
  const canDeactivate = isAdmin && can("accounts.deactivate");
  const canResetAccess = isAdmin && can("accounts.access.reset");
  const canDelete = !personnelOnly && isAdmin && can("accounts.delete");

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [options, setOptions] = useState({ roles: [], municipalities: [], barangays: [], facilities: [], rhuStations: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [municipalityFilter, setMunicipalityFilter] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [modalTarget, setModalTarget] = useState(null);
  const [detailsTarget, setDetailsTarget] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [lifecycleTarget, setLifecycleTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const requestSequence = useRef(0);
  const toastTimer = useRef(null);
  const pageSize = 50;

  const showToast = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 10000);
  };

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const loadSummary = useCallback(async () => {
    if (!isAdmin) { setSummaryLoading(false); return; }
    setSummaryLoading(true);
    try {
      const result = await usersApi.summary(personnelOnly ? { personnelOnly: true } : undefined);
      setSummary(result);
      setSummaryError("");
    } catch (error) {
      setSummaryError(error?.message || "Unable to load account summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, [isAdmin, personnelOnly]);

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await usersApi.list({
        q: query.trim(),
        role: roleFilter,
        status: statusFilter,
        personnelOnly: personnelOnly || undefined,
        approvalStatus: approvalFilter,
        lifecycleState: lifecycleFilter,
        municipalityId: municipalityFilter,
        barangayId: barangayFilter,
        limit: pageSize,
        offset: page * pageSize,
      });
      if (sequence !== requestSequence.current) return;
      setUsers((result?.rows || []).map((account) => ({
        ...account,
        roleId: account.role,
        role: roleLabel(account.role),
        statusId: account.status,
      })));
      const count = result?.total || 0;
      setTotal(count);
      if (page > 0 && page * pageSize >= count) setPage(Math.max(0, Math.ceil(count / pageSize) - 1));
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setLoadError(error?.message || "Unable to load accounts.");
      setUsers([]);
      setTotal(0);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [isAdmin, personnelOnly, query, roleFilter, statusFilter, approvalFilter, lifecycleFilter, municipalityFilter, barangayFilter, page]);

  useEffect(() => {
    if (!isAdmin) return;
    usersApi.options()
      .then((result) => setOptions({ roles: [], municipalities: [], barangays: [], facilities: [], rhuStations: [], ...result }))
      .catch((error) => setOptionsError(error?.message || "Unable to load account assignment options."));
    void loadSummary();
  }, [isAdmin, loadSummary]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => { window.clearTimeout(timer); requestSequence.current += 1; };
  }, [load]);

  const visibleBarangays = useMemo(
    () => options.barangays.filter((item) => !municipalityFilter || item.municipalityId === municipalityFilter),
    [options.barangays, municipalityFilter],
  );

  const hasActiveFilters = Boolean(query || roleFilter || statusFilter || approvalFilter || lifecycleFilter || municipalityFilter || barangayFilter);

  const resetFilters = () => {
    setQuery("");
    setRoleFilter("");
    setStatusFilter("");
    setApprovalFilter("");
    setLifecycleFilter("");
    setMunicipalityFilter("");
    setBarangayFilter("");
    setPage(0);
  };

  const pickStatus = (status) => {
    if (personnelOnly) { setLifecycleFilter(status); setApprovalFilter(""); setStatusFilter(""); }
    else setStatusFilter(status);
    setPage(0);
  };

  const saveAccount = async (data, creationOperation) => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      let result;
      if (modalTarget?.isNew) {
        if (!supabase) throw new Error("Account creation requires a configured, verified Supabase session.");
        const { data: auth, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!auth?.session?.access_token || auth.session.user?.id !== creationOperation?.actorId) throw new Error("The administrator session changed. Sign in to the original account and retry this creation request.");
        result = await usersApi.create(data, { headers: { Authorization: `Bearer ${auth.session.access_token}` } });
      }
      else if (!modalTarget) return;
      else result = await usersApi.update(modalTarget.id, data);
      const wasNew = modalTarget?.isNew;
      if (wasNew) {
        if (!result?.user?.id) throw new Error("The server did not confirm account creation. Retry unchanged details with the saved request reference; do not create a duplicate identity.");
        clearPersonnelCreationOperation(creationOperation);
      }
      setModalTarget(null);
      await Promise.all([load(), loadSummary()]);
      showToast(wasNew ? personnelActionMessage("create", result?.user) : "Account updated.");
    } catch (error) {
      setActionError(error?.message || "Could not save the account.");
    } finally {
      setBusy(false);
    }
  };

  const saveLifecycle = async (payload) => {
    if (!lifecycleTarget || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await usersApi.lifecycle(lifecycleTarget.target.id, payload);
      setLifecycleTarget(null);
      await Promise.all([load(), loadSummary()]);
      showToast(personnelActionMessage(payload.action, result?.user));
    } catch (error) {
      setActionError(error?.message || "The personnel action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    const { kind, target } = confirm;
    setBusy(true);
    setActionError("");
    try {
      if (kind === "disable" || kind === "enable") {
        await usersApi.update(target.id, { status: kind === "disable" ? "disabled" : "active" });
        await Promise.all([load(), loadSummary()]);
        showToast(kind === "disable" ? "Account deactivated." : "Account reactivated.");
      } else if (kind === "reset") {
        await usersApi.resetAccess(target.id);
        showToast("Password recovery email requested.");
      }
      setConfirm(null);
    } catch (error) {
      setActionError(error?.message || "The requested action failed.");
      setConfirm(null);
      showToast(error?.message || "The requested action failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      await usersApi.remove(deleteTarget.id, deleteTarget.email);
      setDeleteTarget(null);
      await Promise.all([load(), loadSummary()]);
      showToast("Account permanently deleted.");
    } catch (error) {
      // Deletion failed server-side: keep the account visible and show why.
      setDeleteError(error?.message || "Could not delete the account.");
    } finally {
      setBusy(false);
    }
  };

  const confirmContent = confirm ? {
    disable: {
      title: "Deactivate account",
      message: `Deactivate ${confirm.target.name}? The account and its records will be retained, and protected access will be denied.`,
      confirmLabel: "Deactivate",
    },
    enable: {
      title: "Reactivate account",
      message: `Restore protected access for ${confirm.target.name}?`,
      confirmLabel: "Reactivate",
    },
    reset: {
      title: "Send password recovery",
      message: `Send a secure password recovery link to ${confirm.target.email}? No password will be changed by this action.`,
      confirmLabel: "Send email",
    },
  }[confirm.kind] : null;

  const buildActions = (row) => {
    const isSelf = row.id === currentUser?.id;
    const personnel = Boolean(personnelState(row));
    const lifecycle = personnelActions(row, { isAdmin, isSelf, canApprove, canDeactivate, canResetAccess }).map((action) => ({
      key: action,
      label: action === "approve" && row.approvalStatus === "rejected" ? "Reconsider approval" : action === "reactivate" ? "Reactivate / set activation" : LIFECYCLE_ACTIONS[action].label,
      icon: LIFECYCLE_ACTIONS[action].icon,
      danger: LIFECYCLE_ACTIONS[action].danger,
      onClick: () => { setActionError(""); setLifecycleTarget({ action, target: row }); },
    }));
    return [
      { key: "view", label: "View details", icon: Eye, onClick: () => setDetailsTarget(row) },
      canEdit && { key: "edit", label: "Edit account", icon: Pencil, onClick: () => { setActionError(""); setModalTarget(row); } },
      ...lifecycle,
      canResetAccess && (!personnel || row.setupRequired === false) && { key: "reset", label: "Reset access", icon: KeyRound, onClick: () => setConfirm({ kind: "reset", target: row }) },
      canDeactivate && !personnel && !isSelf && (
        row.statusId === "disabled"
          ? { key: "enable", label: "Reactivate account", icon: UserCheck, onClick: () => setConfirm({ kind: "enable", target: row }) }
          : { key: "disable", label: "Deactivate account", icon: Ban, onClick: () => setConfirm({ kind: "disable", target: row }) }
      ),
      canDelete && {
        key: "delete",
        label: "Delete account",
        icon: Trash2,
        danger: true,
        disabled: isSelf,
        title: isSelf ? "You cannot delete your own account." : undefined,
        onClick: () => { setDeleteError(""); setDeleteTarget(row); },
      },
    ].filter(Boolean);
  };

  const coverageOf = (row) =>
    row.barangay || row.facility || row.municipality || (row.roleId === "admin" ? "System-wide" : "—");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showEmpty = !loading && !loadError && users.length === 0;


  if (!isAdmin) return <Card className="p-5"><p className="text-sm text-brand-danger" role="alert">Account management is available only to system administrators.</p></Card>;

  return (
    <>
      <PageHeader
        crumbs={[personnelOnly ? "Health Personnel Management" : "User Management"]}
        title={personnelOnly ? "Health Personnel Management" : "User Management"}
        subtitle={personnelOnly ? "Manage staff accounts, assignments, and approvals." : "Manage staff and resident accounts, roles, coverage, and access."}
        meta={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white">
            {personnelOnly ? <UserCog className="h-3.5 w-3.5" aria-hidden="true" /> : <Users className="h-3.5 w-3.5" aria-hidden="true" />}
            {summary ? `${(summary.total ?? 0).toLocaleString()} ${personnelOnly ? "personnel accounts" : "total accounts"}` : "Accounts"}
          </span>
        }
      />

      {toast && (
        <div className="fixed bottom-4 left-4 right-4 z-[90] flex items-start gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg sm:left-auto sm:max-w-lg" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" /><span className="text-sm">{toast}</span>
          <button type="button" onClick={() => setToast("")} aria-label="Dismiss account update" className="shrink-0 rounded p-0.5 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}

      <SummaryCards
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        activeStatus={personnelOnly ? lifecycleFilter : statusFilter}
        onPick={pickStatus}
        personnelOnly={personnelOnly}
      />

      {personnelOnly && <p className="mb-3 text-xs leading-relaxed text-brand-gray">Approval and password setup are separate steps; accounts stay inactive until activation.</p>}

      {/* Filter toolbar */}
      <div className="mb-4 rounded-md border border-brand-border bg-white p-2.5 dark:border-border dark:bg-card sm:p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 min-w-[10rem] flex-1 items-center gap-2 rounded-btn border border-brand-border bg-white px-3 focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20 dark:border-border dark:bg-input">
              <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search name or email…" className="min-w-0 w-full bg-transparent text-sm outline-none" aria-label={personnelOnly ? "Search personnel" : "Search user accounts"} />
              {query && (
                <button onClick={() => { setQuery(""); setPage(0); }} className="rounded p-0.5 text-brand-gray hover:bg-brand-bg" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              aria-controls="account-filters"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-btn border border-brand-border px-3 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/20 dark:border-border"
            >
              <Filter className="h-4 w-4" aria-hidden="true" /> Filters
              {hasActiveFilters && <span className="h-1.5 w-1.5 rounded-full bg-brand-blue" aria-hidden="true" />}
            </button>
            {hasActiveFilters && (
              <button type="button" onClick={resetFilters} className="h-9 shrink-0 rounded-btn px-2 text-xs font-medium text-brand-blue hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/20">Clear filters</button>
            )}
            {canCreate && canManageRoles && (
              <button onClick={() => { setActionError(""); setModalTarget({ isNew: true }); }} disabled={Boolean(optionsError) || options.roles.length === 0} className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-btn bg-brand-blue px-3 text-sm font-medium text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 disabled:cursor-not-allowed disabled:opacity-60">
                <Plus className="h-4 w-4" aria-hidden="true" /> {personnelOnly ? "Create Personnel" : "Create Account"}
              </button>
            )}
          </div>

          <div id="account-filters" className={`${filtersOpen ? "grid" : "hidden"} grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-x-3 gap-y-2 border-t border-brand-border/70 pt-3 dark:border-border`}>
            <div className="min-w-0">
              <label htmlFor="filter-role" className="mb-1 block text-xs font-medium text-brand-gray">Role</label>
              <select id="filter-role" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(0); }} className={selectCls}>
                <option value="">All roles</option>
                {options.roles.filter((item) => item.id !== "resident-limited" && item.id !== "resident" && (!personnelOnly || isPersonnelRole(item.id))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                {!personnelOnly && <option value="resident">Resident</option>}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="filter-status" className="mb-1 block text-xs font-medium text-brand-gray">{personnelOnly ? "Sign-in status" : "Status"}</label>
              <select id="filter-status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }} className={selectCls}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="pending_verification">Pending verification</option>
                <option value="disabled">{personnelOnly ? "Inactive" : "Deactivated"}</option>
              </select>
            </div>
            {personnelOnly && <div className="min-w-0">
              <label htmlFor="filter-lifecycle" className="mb-1 block text-xs font-medium text-brand-gray">Lifecycle state</label>
              <select id="filter-lifecycle" value={lifecycleFilter} onChange={(event) => { setLifecycleFilter(event.target.value); setPage(0); }} className={selectCls}>
                <option value="">All lifecycle states</option>
                {Object.entries(PERSONNEL_STATE_META).filter(([id]) => id !== "unknown").map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}
              </select>
            </div>}
            {personnelOnly && <div className="min-w-0">
              <label htmlFor="filter-approval" className="mb-1 block text-xs font-medium text-brand-gray">Approval</label>
              <select id="filter-approval" value={approvalFilter} onChange={(event) => { setApprovalFilter(event.target.value); setPage(0); }} className={selectCls}>
                <option value="">All approval decisions</option>
                <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
              </select>
            </div>}
            <div className="min-w-0">
              <label htmlFor="filter-municipality" className="mb-1 block text-xs font-medium text-brand-gray">Municipality</label>
              <select id="filter-municipality" value={municipalityFilter} onChange={(event) => { setMunicipalityFilter(event.target.value); setBarangayFilter(""); setPage(0); }} className={selectCls}>
                <option value="">All municipalities</option>
                {options.municipalities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="filter-barangay" className="mb-1 block text-xs font-medium text-brand-gray">Barangay</label>
              <select id="filter-barangay" value={barangayFilter} onChange={(event) => { setBarangayFilter(event.target.value); setPage(0); }} disabled={!municipalityFilter} className={`${selectCls} disabled:cursor-not-allowed disabled:opacity-60`}>
                <option value="">{municipalityFilter ? "All barangays" : "Select municipality first"}</option>
                {visibleBarangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>

          </div>
        </div>
      </div>

      {(loadError || optionsError || summaryError || actionError) && (
        <div className="mb-4 flex items-start gap-2 rounded-btn bg-brand-danger/10 px-4 py-3 text-sm text-brand-danger" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError || optionsError || summaryError || actionError}</span>
          {loadError && <button onClick={load} className="ml-auto font-medium underline">Retry</button>}
          {optionsError && <button onClick={() => {
            setOptionsError("");
            usersApi.options().then((result) => setOptions({ roles: [], municipalities: [], barangays: [], facilities: [], rhuStations: [], ...result })).catch((error) => setOptionsError(error?.message || "Unable to load account assignment options."));
          }} className="ml-auto font-medium underline">Retry</button>}
          {summaryError && !loadError && !optionsError && <button type="button" onClick={loadSummary} className="ml-auto font-medium underline">Retry summary</button>}
          {actionError && <button onClick={() => setActionError("")} className="ml-auto rounded p-0.5" aria-label="Dismiss error"><X className="h-4 w-4" /></button>}
        </div>
      )}

      {/* Desktop table */}
      <div className={`hidden overflow-hidden border bg-white dark:bg-card ${personnelOnly ? "rounded-md border-brand-border xl:block dark:border-border" : "rounded-2xl border-slate-200 shadow-card md:block"}`}>
        <table className={`w-full table-fixed ${personnelOnly ? "text-[13px]" : "text-sm"}`}>
          <colgroup>
            <col className="w-[28%]" /><col className="w-[16%]" /><col className="w-[18%]" />
            <col className="w-[16%]" /><col className="w-[12%]" /><col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className={`border-b border-slate-200 text-left text-slate-500 ${personnelOnly ? "bg-brand-bg/50 text-[11px] tracking-wide" : "bg-slate-50 text-xs uppercase tracking-wider"}`}>
              <th className={`${personnelOnly ? "px-3 py-2.5" : "px-4 py-3"} font-semibold`}>Account</th>
              <th className={`${personnelOnly ? "px-3 py-2.5" : "px-4 py-3"} font-semibold`}>Role</th>
              <th className={`${personnelOnly ? "px-3 py-2.5" : "px-4 py-3"} font-semibold`}>Coverage</th>
              <th className={`${personnelOnly ? "px-3 py-2.5" : "px-4 py-3"} font-semibold`}>Contact</th>
              <th className={`${personnelOnly ? "px-3 py-2.5" : "px-4 py-3"} font-semibold`}>{personnelOnly ? "Lifecycle" : "Status"}</th>
              <th className={`${personnelOnly ? "px-3 py-2.5" : "px-4 py-3"} text-right font-semibold`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && users.length === 0 && Array.from({ length: 6 }).map((_, index) => (
              <tr key={`sk-${index}`}>
                <td className="px-4 py-4" colSpan={6}>
                  <div className="h-9 w-full animate-pulse rounded bg-slate-100" />
                </td>
              </tr>
            ))}
            {!loading && users.map((row) => (
              <tr key={row.id} className="align-middle transition-colors hover:bg-slate-50/70">
                <td className={personnelOnly ? "px-3 py-2" : "px-4 py-3"}><AccountIdentity row={row} compact={personnelOnly} /></td>
                <td className={`${personnelOnly ? "px-3 py-2" : "px-4 py-3"} text-brand-ink`}>{row.role}</td>
                <td className={personnelOnly ? "px-3 py-2" : "px-4 py-3"}>
                  <span className="flex items-center gap-1.5 text-brand-gray">
                    <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate" title={coverageOf(row)}>{coverageOf(row)}</span>
                  </span>
                  {row.rhuStations?.length > 0 && <p className="mt-1 text-xs text-brand-gray">{stationsLabel(row.rhuStations, options.rhuStations)}</p>}
                </td>
                <td className={personnelOnly ? "px-3 py-2" : "px-4 py-3"}>
                  {row.contact
                    ? <span className="flex items-center gap-1.5 text-brand-ink"><Phone className="h-3.5 w-3.5 shrink-0 text-brand-gray" aria-hidden="true" /><span className="truncate">{row.contact}</span></span>
                    : <span className="text-brand-gray">Not provided</span>}
                </td>
                <td className={personnelOnly ? "px-3 py-2" : "px-4 py-3"}><LifecyclePill account={row} compact={personnelOnly} /></td>
                <td className={`${personnelOnly ? "px-3 py-2" : "px-4 py-3"} text-right`}><div className="flex justify-end"><ActionsMenu items={buildActions(row)} buttonLabel={`Actions for ${row.name}`} compact={personnelOnly} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {showEmpty && (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <UserCog className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm font-medium text-brand-ink">No accounts found</p>
            <p className="text-sm text-brand-gray">{hasActiveFilters ? "No accounts match these filters." : "No accounts have been created yet."}</p>
            {hasActiveFilters && <button onClick={resetFilters} className="mt-1 text-sm font-medium text-brand-blue hover:underline">Reset filters</button>}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className={`space-y-3 ${personnelOnly ? "xl:hidden" : "md:hidden"}`}>
        {loading && users.length === 0 && Array.from({ length: 4 }).map((_, index) => (
          <Card key={`msk-${index}`} className="p-4"><div className="h-16 w-full animate-pulse rounded bg-slate-100" /></Card>
        ))}
        {!loading && users.map((row) => (
          <Card key={row.id} className={personnelOnly ? "p-3" : "p-4"}>
            <div className="flex items-start justify-between gap-2">
              <AccountIdentity row={row} compact={personnelOnly} />
              <ActionsMenu items={buildActions(row)} buttonLabel={`Actions for ${row.name}`} compact={personnelOnly} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div><dt className="text-xs text-brand-gray">Role</dt><dd className="text-brand-ink">{row.role}</dd></div>
              <div><dt className="text-xs text-brand-gray">{personnelOnly ? "Lifecycle" : "Status"}</dt><dd className="mt-0.5"><LifecyclePill account={row} compact={personnelOnly} /></dd></div>
              <div className="min-w-0"><dt className="text-xs text-brand-gray">Coverage</dt><dd className="truncate text-brand-ink" title={coverageOf(row)}>{coverageOf(row)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-brand-gray">Contact</dt><dd className="truncate text-brand-ink">{row.contact || "Not provided"}</dd></div>
              {row.rhuStations?.length > 0 && <div className="col-span-2"><dt className="text-xs text-brand-gray">RHU stations</dt><dd className="text-brand-ink">{stationsLabel(row.rhuStations, options.rhuStations)}</dd></div>}
            </dl>
          </Card>
        ))}
        {showEmpty && (
          <Card className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <UserCog className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm font-medium text-brand-ink">No accounts found</p>
            <p className="text-sm text-brand-gray">{hasActiveFilters ? "No accounts match these filters." : "No accounts have been created yet."}</p>
            {hasActiveFilters && <button onClick={resetFilters} className="mt-1 text-sm font-medium text-brand-blue hover:underline">Reset filters</button>}
          </Card>
        )}
      </div>

      {/* Pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-brand-gray">
        <span>
          {loading ? "Loading accounts…" : `${total.toLocaleString()} account${total === 1 ? "" : "s"} · page ${page + 1} of ${totalPages}`}
        </span>
        <div className="flex gap-2">
          <button onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || loading} className="rounded-btn border border-slate-200 px-3 py-1.5 disabled:opacity-50 dark:border-border">Previous</button>
          <button onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * pageSize >= total || loading} className="rounded-btn border border-slate-200 px-3 py-1.5 disabled:opacity-50 dark:border-border">Next</button>
        </div>
      </div>

      {modalTarget && (
        <AccountModal
          initial={modalTarget.isNew ? null : modalTarget}
          options={options}
          busy={busy}
          error={actionError}
          actorId={currentUser?.id}
          canManageRoles={canManageRoles && modalTarget.id !== currentUser?.id}
          canApprove={canApprove}
          canDeactivate={canDeactivate}
          canEdit={modalTarget.isNew ? canCreate : canEdit}
          personnelOnly={personnelOnly}
          onClose={() => { setModalTarget(null); setActionError(""); }}
          onSave={saveAccount}
        />
      )}
      {detailsTarget && <DetailsModal target={detailsTarget} options={options} onClose={() => setDetailsTarget(null)} />}
      {lifecycleTarget && <LifecycleDialog
        target={lifecycleTarget.target}
        action={lifecycleTarget.action}
        busy={busy}
        error={actionError}
        canActivate={canDeactivate}
        onSave={saveLifecycle}
        onClose={() => { if (!busy) { setLifecycleTarget(null); setActionError(""); } }}
      />}
      {confirmContent && <ConfirmDialog {...confirmContent} busy={busy} onConfirm={handleConfirm} onClose={() => setConfirm(null)} />}
      {deleteTarget && (
        <DeleteDialog
          target={deleteTarget}
          busy={busy}
          error={deleteError}
          onConfirm={handleDelete}
          onClose={() => { if (!busy) { setDeleteTarget(null); setDeleteError(""); } }}
        />
      )}
    </>
  );
}
