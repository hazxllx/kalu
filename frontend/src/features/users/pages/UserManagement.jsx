import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { usersApi } from "@/services/api";
import {
  AlertTriangle, Ban, Building2, CheckCircle2, KeyRound, Pencil, Plus, Search, ShieldCheck, X,
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

const STATUS_LABELS = {
  active: "Active",
  disabled: "Disabled",
  pending_verification: "Pending Verification",
};

const roleLabel = (id) => ROLE_LABELS[id] || id || "—";
const statusLabel = (id) => STATUS_LABELS[id] || id || "—";
const inputCls = (error = false) =>
  `mt-1 w-full rounded-btn border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;

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

function ConfirmDialog({ title, message, confirmLabel, busy, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <Card className="w-full max-w-md">
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
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto">
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
                  {canDeactivate && <option value="disabled">Disabled</option>}
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

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { can } = usePermissions();
  const canCreate = can("accounts.create");
  const canEdit = can("accounts.edit");
  const canManageRoles = can("accounts.roles.manage");
  const canDeactivate = can("accounts.deactivate");
  const canResetAccess = can("accounts.access.reset");

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [options, setOptions] = useState({ roles: [], municipalities: [], barangays: [], facilities: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [municipalityFilter, setMunicipalityFilter] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [page, setPage] = useState(0);
  const [modalTarget, setModalTarget] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const requestSequence = useRef(0);
  const pageSize = 50;

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

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
        status: statusLabel(account.status),
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
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleBarangays = useMemo(
    () => options.barangays.filter((item) => !municipalityFilter || item.municipalityId === municipalityFilter),
    [options.barangays, municipalityFilter],
  );

  const saveAccount = async (data) => {
    setBusy(true);
    setActionError("");
    try {
      if (modalTarget?.isNew) await usersApi.create(data);
      else if (!modalTarget) return;
      else await usersApi.update(modalTarget.id, data);
      setModalTarget(null);
      await load();
      showToast(modalTarget?.isNew ? "Invitation sent." : "Account updated.");
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
        await load();
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

  const columns = [
    { key: "name", label: "Account" },
    { key: "role", label: "Role" },
    { key: "scope", label: "Coverage" },
    { key: "contact", label: "Contact" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];

  return (
    <>
      <PageHeader
        crumbs={["User Management"]}
        title="User Management"
        subtitle="Invite staff, assign roles and coverage, and control account access."
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg" role="status">
          <CheckCircle2 className="h-4 w-4 text-brand-green" /><span className="text-sm">{toast}</span>
        </div>
      )}

      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-btn border border-slate-200 bg-brand-bg/60 px-3 py-2.5 dark:border-border dark:bg-input sm:max-w-sm">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search name or email…" className="w-full bg-transparent text-sm outline-none" aria-label="Search user accounts" />
          </div>
          <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(0); }} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-border dark:bg-input" aria-label="Filter by role">
            <option value="">All roles</option>
            {options.roles.filter((item) => item.id !== "resident-limited").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value="resident">Resident</option>
          </select>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-border dark:bg-input" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="pending_verification">Pending verification</option>
          </select>
          <select value={municipalityFilter} onChange={(event) => { setMunicipalityFilter(event.target.value); setBarangayFilter(""); setPage(0); }} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-border dark:bg-input" aria-label="Filter by municipality">
            <option value="">All municipalities</option>
            {options.municipalities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={barangayFilter} onChange={(event) => { setBarangayFilter(event.target.value); setPage(0); }} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-border dark:bg-input" aria-label="Filter by barangay">
            <option value="">All barangays</option>
            {visibleBarangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {canCreate && canManageRoles && (
            <button onClick={() => { setActionError(""); setModalTarget({ isNew: true }); }} disabled={Boolean(optionsError) || options.roles.length === 0} className="ml-auto inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3.5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
              <Plus className="h-4 w-4" /> Invite staff
            </button>
          )}
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

      <DataTable
        columns={columns}
        rows={users}
        renderCell={(key, row) => {
          if (key === "name") return (
            <div className="min-w-[220px]">
              <p className="font-medium text-brand-ink">{row.name}</p>
              <p className="truncate text-xs text-brand-gray">{row.email}</p>
            </div>
          );
          if (key === "role") return <span className="text-sm text-brand-ink">{row.role}</span>;
          if (key === "scope") return (
            <div className="flex min-w-[140px] items-center gap-1.5 text-sm text-brand-gray">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span>{row.barangay || row.facility || row.municipality || (row.roleId === "admin" ? "System-wide" : "—")}</span>
            </div>
          );
          if (key === "contact") return <span className="text-sm text-brand-gray">{row.contact || "—"}</span>;
          if (key === "status") return <StatusBadge value={row.statusId} />;
          if (key === "actions") return (
            <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
              {canEdit && <button onClick={() => { setActionError(""); setModalTarget(row); }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
              {canResetAccess && <button onClick={() => setConfirm({ kind: "reset", target: row })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"><KeyRound className="h-3.5 w-3.5" /> Reset access</button>}
              {canDeactivate && row.id !== currentUser?.id && (
                row.statusId === "disabled"
                  ? <button onClick={() => setConfirm({ kind: "enable", target: row })} className="text-sm font-medium text-brand-green hover:underline">Reactivate</button>
                  : <button onClick={() => setConfirm({ kind: "disable", target: row })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-danger hover:underline"><Ban className="h-3.5 w-3.5" /> Deactivate</button>
              )}
            </div>
          );
          return row[key];
        }}
      />
      {!loading && !loadError && users.length === 0 && <p className="py-10 text-center text-sm text-brand-gray">No accounts match these filters.</p>}
      {loading && <p className="py-6 text-center text-sm text-brand-gray">Loading accounts…</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-brand-gray">
        <span>{total.toLocaleString()} account{total === 1 ? "" : "s"} · page {page + 1} of {Math.max(1, Math.ceil(total / pageSize))}</span>
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
      {confirmContent && <ConfirmDialog {...confirmContent} busy={busy} onConfirm={handleConfirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
