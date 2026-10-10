import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { usersApi } from "@/services/api";
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
const inputCls = (error = false) =>
  `mt-1 w-full rounded-btn border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;
const selectCls =
  "h-10 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input";

function StatusPill({ statusId }) {
  const meta = statusMeta(statusId);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function Field({ label, htmlFor, required = false, hint, error, children }) {
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

function SummaryCards({ summary, loading, error, activeStatus, onPick }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {SUMMARY_CARDS.map((card) => {
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
              <span className="block truncate text-xs text-brand-gray">{card.label}</span>
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

function ActionsMenu({ items, buttonLabel = "Account actions" }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 6, left: rect.right });
  }, []);

  const toggle = () => {
    if (!open) reposition();
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (menuRef.current?.contains(event.target) || btnRef.current?.contains(event.target)) return;
      close();
    };
    const onKey = (event) => { if (event.key === "Escape") close(); };
    const onReflow = () => close();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, close]);

  const available = items.filter(Boolean);
  if (available.length === 0) return <span className="text-xs text-brand-gray">—</span>;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={buttonLabel}
        className="inline-flex h-9 items-center gap-1 rounded-btn border border-slate-200 bg-white px-2.5 text-sm font-medium text-brand-ink hover:bg-brand-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:border-border"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Actions</span>
        <ChevronDown className="hidden h-3.5 w-3.5 sm:inline" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={buttonLabel}
          style={{ position: "fixed", top: coords.top, left: coords.left, transform: "translateX(-100%)" }}
          className="z-[95] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-border dark:bg-card"
        >
          {available.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title || undefined}
              onClick={() => { if (item.disabled) return; close(); item.onClick(); }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                item.disabled
                  ? "cursor-not-allowed text-slate-400"
                  : item.danger
                    ? "text-brand-danger hover:bg-brand-danger/10"
                    : "text-brand-ink hover:bg-brand-bg"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
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

function DetailsModal({ target, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const coverage = target.barangay || target.facility || target.municipality
    || (target.roleId === "admin" ? "System-wide" : "Not assigned");

  return (
    <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto" role="dialog" aria-modal="true" aria-label="Account details">
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-brand-ink">{target.name}</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-brand-gray">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-all">{target.email}</span>
              </p>
            </div>
            <button onClick={onClose} className="rounded p-1 text-brand-gray hover:bg-brand-bg" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <dl className="rounded-xl border border-slate-200 px-4 py-1">
            <DetailRow label="Status" value={<StatusPill statusId={target.statusId} />} />
            <DetailRow label="Role" value={roleLabel(target.roleId)} />
            <DetailRow label="Coverage" value={coverage} />
            <DetailRow label="Municipality" value={target.municipality || "—"} />
            <DetailRow label="Barangay" value={target.barangay || "—"} />
            <DetailRow label="RHU facility" value={target.facility || "—"} />
            <DetailRow label="Contact number" value={target.contact || "Not provided"} />
            <DetailRow label="Position" value={target.position || "—"} />
            <DetailRow label="License number" value={target.licenseNo || "—"} />
          </dl>
          <div className="mt-5 flex justify-end">
            <button onClick={onClose} className="rounded-btn border border-slate-200 px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:border-border">
              Close
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Invite / edit account modal                                               */
/* ------------------------------------------------------------------------- */

function AccountModal({ initial, options, busy, error, canManageRoles, canDeactivate, canEdit, onClose, onSave }) {
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
    status: "active",
  }));
  const [errors, setErrors] = useState({});
  const role = form.role;
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

  const validate = () => {
    const next = {};
    if (!form.name.trim() || form.name.trim().length > 120) next.name = "Enter a name of 1–120 characters.";
    if (isNew && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (!role) next.role = "Select a role.";
    if (barangayScoped && !form.barangayId) next.barangayId = "Select a barangay.";
    if (facilityScoped && !form.facilityId) next.facilityId = "Select an RHU facility.";
    if (municipalityScoped && !form.municipalityId) next.municipalityId = "Select a municipality.";
    setErrors(next);
    if (Object.keys(next).length) return false;

    const details = {
      municipalityId: form.municipalityId || null,
      barangayId: form.barangayId || null,
      facilityId: form.facilityId || null,
    };
    if (isNew) {
      onSave({
        ...details,
        email: form.email.trim(),
        name: form.name.trim(),
        contact: form.contact.trim(),
        position: form.position.trim(),
        licenseNo: form.licenseNo.trim(),
        role: form.role,
        status: form.status,
      });
      return true;
    }

    const patch = {
      name: form.name.trim(),
      contact: form.contact.trim(),
      position: form.position.trim(),
      licenseNo: form.licenseNo.trim(),
    };
    if (form.role !== initial.roleId) patch.role = form.role;
    if (
      form.role !== initial.roleId
      || details.municipalityId !== (initial.municipalityId || null)
      || details.barangayId !== (initial.barangayId || null)
      || details.facilityId !== (initial.facilityId || null)
    ) Object.assign(patch, details);
    onSave(patch);
    return true;
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto" role="dialog" aria-modal="true" aria-label={isNew ? "Invite staff account" : "Edit account"}>
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-brand-ink">{isNew ? "Invite staff account" : "Edit account"}</h2>
              <p className="mt-1 text-sm text-brand-gray">
                {isNew ? "Supabase Auth will email a secure invitation link. No password is created or stored here." : "Update profile, role, and coverage assignment."}
              </p>
            </div>
            <button onClick={onClose} disabled={busy} className="rounded p-1 text-brand-gray hover:bg-brand-bg" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-btn bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="account-name" required error={errors.name}>
              <input id="account-name" value={form.name} onChange={(event) => change("name", event.target.value)} className={inputCls(errors.name)} autoComplete="name" />
            </Field>
            <Field label="Email" htmlFor="account-email" required={isNew} hint={isNew ? "The invitation is sent to this address." : "Managed by Supabase Auth; read-only here."} error={errors.email}>
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
            <Field label="Role" htmlFor="account-role" required error={errors.role} hint={initial?.roleId === "resident" ? "Resident identities are managed through registration." : undefined}>
              <select
                id="account-role"
                value={form.role}
                onChange={(event) => change("role", event.target.value)}
                disabled={!canManageRoles || initial?.roleId === "resident"}
                className={`${inputCls(errors.role)} disabled:cursor-not-allowed disabled:opacity-70`}
              >
                {options.roles.filter((item) => item.id !== "resident" && item.id !== "resident-limited").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                {initial?.roleId === "resident" && <option value="resident">Resident</option>}
              </select>
            </Field>
            {isNew && (
              <Field label="Initial status" htmlFor="account-status">
                <select id="account-status" value={form.status || "active"} onChange={(event) => change("status", event.target.value)} className={inputCls()}>
                  <option value="active">Active</option>
                  {canDeactivate && <option value="disabled">Deactivated</option>}
                </select>
              </Field>
            )}
            {(municipalityScoped || barangayScoped || facilityScoped) && (
              <Field label="Municipality" htmlFor="account-municipality" required={municipalityScoped} error={errors.municipalityId}>
                <select id="account-municipality" value={form.municipalityId} onChange={(event) => change("municipalityId", event.target.value)} className={inputCls(errors.municipalityId)}>
                  <option value="">Select municipality</option>
                  {options.municipalities.map((item) => <option key={item.id} value={item.id}>{item.name}{item.province ? `, ${item.province}` : ""}</option>)}
                </select>
              </Field>
            )}
            {barangayScoped && (
              <Field label="Assigned barangay" htmlFor="account-barangay" required error={errors.barangayId}>
                <select id="account-barangay" value={form.barangayId} onChange={(event) => change("barangayId", event.target.value)} className={inputCls(errors.barangayId)}>
                  <option value="">Select barangay</option>
                  {visibleBarangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
            )}
            {facilityScoped && (
              <Field label="Assigned RHU facility" htmlFor="account-facility" required error={errors.facilityId}>
                <select id="account-facility" value={form.facilityId} onChange={(event) => change("facilityId", event.target.value)} className={inputCls(errors.facilityId)}>
                  <option value="">Select RHU facility</option>
                  {visibleFacilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
            )}
            {role === "admin" && <p className="sm:col-span-2 text-xs text-brand-gray">Administrator accounts have system-wide scope.</p>}
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} disabled={busy} className="rounded-btn px-3 py-2 text-sm text-brand-gray hover:bg-brand-bg disabled:opacity-60">Cancel</button>
            <button onClick={validate} disabled={busy || !canEdit} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
              {isNew ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {busy ? "Saving…" : isNew ? "Send invitation" : "Save changes"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Account identity cell (shared desktop + mobile)                           */
/* ------------------------------------------------------------------------- */

function AccountIdentity({ row }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-sm font-semibold uppercase text-brand-blue">
        {(row.name || "?").trim().charAt(0)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-brand-ink" title={row.name}>{row.name}</p>
        <p className="truncate text-xs text-brand-gray" title={row.email}>{row.email}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Page                                                                      */
/* ------------------------------------------------------------------------- */

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { can } = usePermissions();
  const canCreate = can("accounts.create");
  const canEdit = can("accounts.edit");
  const canManageRoles = can("accounts.roles.manage");
  const canDeactivate = can("accounts.deactivate");
  const canResetAccess = can("accounts.access.reset");
  const canDelete = can("accounts.delete");

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [options, setOptions] = useState({ roles: [], municipalities: [], barangays: [], facilities: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [municipalityFilter, setMunicipalityFilter] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [modalTarget, setModalTarget] = useState(null);
  const [detailsTarget, setDetailsTarget] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const requestSequence = useRef(0);
  const pageSize = 50;

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const result = await usersApi.summary();
      setSummary(result);
      setSummaryError("");
    } catch (error) {
      setSummaryError(error?.message || "Unable to load account summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await usersApi.list({
        q: query.trim(),
        role: roleFilter,
        status: statusFilter,
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
      setTotal(result?.total || 0);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setLoadError(error?.message || "Unable to load accounts.");
      setUsers([]);
      setTotal(0);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [query, roleFilter, statusFilter, municipalityFilter, barangayFilter, page]);

  useEffect(() => {
    usersApi.options()
      .then((result) => setOptions(result))
      .catch((error) => setOptionsError(error?.message || "Unable to load account assignment options."));
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleBarangays = useMemo(
    () => options.barangays.filter((item) => !municipalityFilter || item.municipalityId === municipalityFilter),
    [options.barangays, municipalityFilter],
  );

  const hasActiveFilters = Boolean(query || roleFilter || statusFilter || municipalityFilter || barangayFilter);

  const resetFilters = () => {
    setQuery("");
    setRoleFilter("");
    setStatusFilter("");
    setMunicipalityFilter("");
    setBarangayFilter("");
    setPage(0);
  };

  const pickStatus = (status) => { setStatusFilter(status); setPage(0); };

  const saveAccount = async (data) => {
    setBusy(true);
    setActionError("");
    try {
      if (modalTarget?.isNew) await usersApi.create(data);
      else if (!modalTarget) return;
      else await usersApi.update(modalTarget.id, data);
      const wasNew = modalTarget?.isNew;
      setModalTarget(null);
      await Promise.all([load(), loadSummary()]);
      showToast(wasNew ? "Invitation sent." : "Account updated.");
    } catch (error) {
      setActionError(error?.message || "Could not save the account.");
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
    return [
      { key: "view", label: "View details", icon: Eye, onClick: () => setDetailsTarget(row) },
      canEdit && { key: "edit", label: "Edit account", icon: Pencil, onClick: () => { setActionError(""); setModalTarget(row); } },
      canResetAccess && { key: "reset", label: "Reset access", icon: KeyRound, onClick: () => setConfirm({ kind: "reset", target: row }) },
      canDeactivate && !isSelf && (
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

  return (
    <>
      <PageHeader
        crumbs={["User Management"]}
        title="User Management"
        subtitle="Manage staff and resident accounts, roles, coverage, and access."
        meta={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-medium text-brand-blue">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {summary ? `${summary.total.toLocaleString()} total accounts` : "Accounts"}
          </span>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg" role="status">
          <CheckCircle2 className="h-4 w-4 text-brand-green" /><span className="text-sm">{toast}</span>
        </div>
      )}

      <SummaryCards
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        activeStatus={statusFilter}
        onPick={pickStatus}
      />

      {/* Filter toolbar */}
      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-btn border border-slate-200 bg-brand-bg/60 px-3 py-2.5 dark:border-border dark:bg-input sm:max-w-sm">
              <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search name or email…" className="w-full bg-transparent text-sm outline-none" aria-label="Search user accounts" />
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
              className="inline-flex items-center gap-2 rounded-btn border border-slate-200 px-3 py-2.5 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:border-border md:hidden"
            >
              <Filter className="h-4 w-4" aria-hidden="true" /> Filters
              {hasActiveFilters && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-brand-blue" aria-hidden="true" />}
            </button>
            {canCreate && canManageRoles && (
              <button onClick={() => { setActionError(""); setModalTarget({ isNew: true }); }} disabled={Boolean(optionsError) || options.roles.length === 0} className="ml-auto inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3.5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
                <Plus className="h-4 w-4" aria-hidden="true" /> Invite Staff
              </button>
            )}
          </div>

          <div className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap md:items-end`}>
            <div className="md:w-44">
              <label htmlFor="filter-role" className="mb-1 block text-xs font-medium text-brand-gray">Role</label>
              <select id="filter-role" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(0); }} className={selectCls}>
                <option value="">All roles</option>
                {options.roles.filter((item) => item.id !== "resident-limited").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                <option value="resident">Resident</option>
              </select>
            </div>
            <div className="md:w-44">
              <label htmlFor="filter-status" className="mb-1 block text-xs font-medium text-brand-gray">Status</label>
              <select id="filter-status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }} className={selectCls}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="pending_verification">Pending verification</option>
                <option value="disabled">Deactivated</option>
              </select>
            </div>
            <div className="md:w-48">
              <label htmlFor="filter-municipality" className="mb-1 block text-xs font-medium text-brand-gray">Municipality</label>
              <select id="filter-municipality" value={municipalityFilter} onChange={(event) => { setMunicipalityFilter(event.target.value); setBarangayFilter(""); setPage(0); }} className={selectCls}>
                <option value="">All municipalities</option>
                {options.municipalities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <div className="md:w-48">
              <label htmlFor="filter-barangay" className="mb-1 block text-xs font-medium text-brand-gray">Barangay</label>
              <select id="filter-barangay" value={barangayFilter} onChange={(event) => { setBarangayFilter(event.target.value); setPage(0); }} disabled={!municipalityFilter} className={`${selectCls} disabled:cursor-not-allowed disabled:opacity-60`}>
                <option value="">{municipalityFilter ? "All barangays" : "Select municipality first"}</option>
                {visibleBarangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="inline-flex h-10 items-center gap-1.5 rounded-btn px-3 text-sm font-medium text-brand-blue hover:bg-brand-blue/10">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset filters
              </button>
            )}
          </div>
        </div>
      </Card>

      {(loadError || optionsError || actionError) && (
        <div className="mb-4 flex items-start gap-2 rounded-btn bg-brand-danger/10 px-4 py-3 text-sm text-brand-danger" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError || optionsError || actionError}</span>
          {loadError && <button onClick={load} className="ml-auto font-medium underline">Retry</button>}
          {optionsError && <button onClick={() => {
            setOptionsError("");
            usersApi.options().then(setOptions).catch((error) => setOptionsError(error?.message || "Unable to load account assignment options."));
          }} className="ml-auto font-medium underline">Retry</button>}
          {actionError && <button onClick={() => setActionError("")} className="ml-auto rounded p-0.5" aria-label="Dismiss error"><X className="h-4 w-4" /></button>}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card md:block">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[28%]" /><col className="w-[16%]" /><col className="w-[18%]" />
            <col className="w-[16%]" /><col className="w-[12%]" /><col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3 font-semibold">Account</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Coverage</th>
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
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
                <td className="px-4 py-3"><AccountIdentity row={row} /></td>
                <td className="px-4 py-3 text-brand-ink">{row.role}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 text-brand-gray">
                    <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate" title={coverageOf(row)}>{coverageOf(row)}</span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  {row.contact
                    ? <span className="flex items-center gap-1.5 text-brand-ink"><Phone className="h-3.5 w-3.5 shrink-0 text-brand-gray" aria-hidden="true" /><span className="truncate">{row.contact}</span></span>
                    : <span className="text-brand-gray">Not provided</span>}
                </td>
                <td className="px-4 py-3"><StatusPill statusId={row.statusId} /></td>
                <td className="px-4 py-3 text-right"><div className="flex justify-end"><ActionsMenu items={buildActions(row)} buttonLabel={`Actions for ${row.name}`} /></div></td>
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
      <div className="space-y-3 md:hidden">
        {loading && users.length === 0 && Array.from({ length: 4 }).map((_, index) => (
          <Card key={`msk-${index}`} className="p-4"><div className="h-16 w-full animate-pulse rounded bg-slate-100" /></Card>
        ))}
        {!loading && users.map((row) => (
          <Card key={row.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <AccountIdentity row={row} />
              <ActionsMenu items={buildActions(row)} buttonLabel={`Actions for ${row.name}`} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div><dt className="text-xs text-brand-gray">Role</dt><dd className="text-brand-ink">{row.role}</dd></div>
              <div><dt className="text-xs text-brand-gray">Status</dt><dd className="mt-0.5"><StatusPill statusId={row.statusId} /></dd></div>
              <div className="min-w-0"><dt className="text-xs text-brand-gray">Coverage</dt><dd className="truncate text-brand-ink" title={coverageOf(row)}>{coverageOf(row)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-brand-gray">Contact</dt><dd className="truncate text-brand-ink">{row.contact || "Not provided"}</dd></div>
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
          canManageRoles={canManageRoles && modalTarget.id !== currentUser?.id}
          canDeactivate={canDeactivate}
          canEdit={modalTarget.isNew ? canCreate : canEdit}
          onClose={() => { setModalTarget(null); setActionError(""); }}
          onSave={saveAccount}
        />
      )}
      {detailsTarget && <DetailsModal target={detailsTarget} onClose={() => setDetailsTarget(null)} />}
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
