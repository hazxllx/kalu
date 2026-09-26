import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { usersApi } from "@/services/api";
import {
  Search, X, CheckCircle2, Pencil, Ban, ShieldCheck, AlertTriangle,
} from "lucide-react";

/* --------------------------- Role / status vocab --------------------------- */
// The backend `profiles` table stores canonical role ids and status values.
// The UI shows human-readable labels; these maps translate both directions.

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

// Roles an administrator may assign (canonical id + label), matching the
// backend `ASSIGNABLE_ROLES` allow-list.
const ASSIGNABLE_ROLES = [
  ["admin", "System Administrator"],
  ["mho", "Municipal Health Officer"],
  ["phn", "Public Health Nurse"],
  ["health_supervisor", "Health Supervisor"],
  ["rhu_personnel", "RHU Personnel"],
  ["bhw", "Barangay Health Worker"],
  ["resident", "Resident"],
];

const STATUS_LABELS = {
  active: "Active",
  disabled: "Disabled",
  pending_verification: "Pending Verification",
};

const roleLabel = (id) => ROLE_LABELS[id] || id || "—";
const statusLabel = (id) => STATUS_LABELS[id] || id || "—";

/* ----------------------------- Shared UI bits ----------------------------- */

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;
const labelCls = "text-sm font-medium text-brand-ink";

function Field({ label, required, error, hint, children }) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="text-brand-danger">*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-brand-danger">{error}</p>
        : hint ? <p className="mt-1 text-xs text-brand-gray">{hint}</p> : null}
    </div>
  );
}

/** Generic confirmation dialog used by enable/disable actions. */
function ConfirmDialog({ title, message, confirmLabel, tone = "danger", busy, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="p-6">
          <div className="flex items-start gap-3.5">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone === "danger" ? "bg-brand-danger/10" : "bg-brand-blue/10"}`}>
              <ShieldCheck className={`h-5 w-5 ${tone === "danger" ? "text-brand-danger" : "text-brand-blue"}`} strokeWidth={1.8} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-brand-gray">{message}</p>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={onClose} disabled={busy} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg disabled:opacity-60 dark:hover:bg-hover">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className={`rounded-btn px-5 py-2 text-sm font-medium text-white disabled:opacity-60 ${tone === "danger" ? "bg-brand-danger hover:bg-brand-danger/90" : "bg-brand-blue hover:bg-brand-dark"}`}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- Edit form ------------------------------- */
// Editing role / status / display fields is the DB-backed admin workflow.
// Account creation, deletion and credential resets belong to the Supabase Auth
// lifecycle and are intentionally not performed from this screen.

function UserEditModal({ initial, busy, error, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    name: initial.name || "",
    contact: initial.contact || "",
    role: initial.roleId || "resident",
    status: initial.statusId || "active",
  }));
  const [errors, setErrors] = useState({});

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = "Full name is required.";
    if (!form.contact.trim()) next.contact = "Contact number is required.";
    if (!form.role) next.role = "Role is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Edit User</h3>
              <p className="mt-0.5 text-sm text-brand-gray">Update display information, role, and account status.</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-btn bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Full Name" required error={errors.name}>
                <input type="text" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Juan Dela Cruz" className={inputCls(errors.name)} />
              </Field>
            </div>
            <Field label="Email" hint="Managed by Supabase Auth (read-only here).">
              <input type="email" value={initial.email} disabled className={`${inputCls()} cursor-not-allowed opacity-70`} />
            </Field>
            <Field label="Contact Number" required error={errors.contact}>
              <input type="text" value={form.contact} onChange={(e) => set("contact")(e.target.value)} placeholder="e.g. 0917 123 4567" className={inputCls(errors.contact)} />
            </Field>
            <Field label="Role" required error={errors.role} hint="Existing project roles only.">
              <select value={form.role} onChange={(e) => set("role")(e.target.value)} className={`${inputCls(errors.role)} cursor-pointer`}>
                {ASSIGNABLE_ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </Field>
            <Field label="Account Status">
              <select value={form.status} onChange={(e) => set("status")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="pending_verification">Pending Verification</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Assigned Barangay" hint="Barangay assignment is managed separately and is shown here for reference.">
                <input type="text" value={initial.barangay || "None"} disabled className={`${inputCls()} cursor-not-allowed opacity-70`} />
              </Field>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} disabled={busy} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg disabled:opacity-60 dark:hover:bg-hover">Cancel</button>
            <button
              onClick={() => { if (validate()) onSave({ name: form.name.trim(), contact: form.contact.trim(), role: form.role, status: form.status }); }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------- Main page -------------------------------- */

/**
 * Admin User Management — backend-backed (real `profiles` data).
 *
 * The user list is read from `GET /api/users` (admin-only) and edits/status
 * changes persist through `PUT /api/users/:id`. There is no local store as a
 * source of truth: a refresh re-reads from the database. Account creation and
 * deletion are handled through the Supabase Auth lifecycle, not this screen.
 */
export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");

  const [editTarget, setEditTarget] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, target }
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await usersApi.list({ limit: 100 });
      const rows = (result?.rows || []).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        roleId: u.role,
        role: roleLabel(u.role),
        barangay: u.barangay || "",
        contact: u.contact || "",
        statusId: u.status,
        status: statusLabel(u.status),
      }));
      setUsers(rows);
    } catch (err) {
      setLoadError(err?.message || "Unable to load users. Please try again.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => roleFilter === "All" || u.roleId === roleFilter)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [users, query, roleFilter]);

  const handleSave = async (patch) => {
    if (!editTarget) return;
    setBusy(true);
    setActionError("");
    try {
      await usersApi.update(editTarget.id, patch);
      await load();
      setEditTarget(null);
      showToast("User updated successfully.");
    } catch (err) {
      setActionError(err?.message || "Could not save changes.");
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
      if (kind === "disable") {
        await usersApi.update(target.id, { status: "disabled" });
        await load();
        showToast("User disabled.");
      } else if (kind === "enable") {
        await usersApi.update(target.id, { status: "active" });
        await load();
        showToast("User enabled.");
      }
      setConfirm(null);
    } catch (err) {
      // Surface backend safeguards (e.g. last-admin protection) to the admin.
      setActionError(err?.message || "Action failed.");
      setConfirm(null);
      showToast(err?.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmContent = confirm
    ? {
        disable: { title: "Disable User", message: `Disable the account of ${confirm.target.name}? The account is kept and can be re-enabled later.`, confirmLabel: "Disable User", tone: "danger" },
        enable: { title: "Enable User", message: `Re-enable the account of ${confirm.target.name}?`, confirmLabel: "Enable User", tone: "primary" },
      }[confirm.kind]
    : null;

  const columns = [
    { key: "name", label: "User" },
    { key: "role", label: "Role" },
    { key: "barangay", label: "Barangay" },
    { key: "contact", label: "Contact" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];

  return (
    <>
      <PageHeader
        crumbs={["User Management"]}
        title="User Management"
        subtitle="Manage system users, roles, and access."
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 dark:border-border dark:bg-input sm:max-w-sm">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users or roles..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          </div>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Roles</option>
            {ASSIGNABLE_ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
      </Card>

      {loadError && (
        <div className="mb-4 flex items-start gap-2 rounded-btn bg-brand-danger/10 px-4 py-3 text-sm text-brand-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
          <button onClick={load} className="ml-2 font-medium underline">Retry</button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        renderCell={(key, row) => {
          if (key === "name")
            return (
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-brand-blue text-xs font-semibold">
                  {row.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-brand-ink">{row.name}</p>
                  <p className="truncate text-xs text-brand-gray">{row.email}</p>
                </div>
              </div>
            );
          if (key === "role") return <span className="text-brand-ink">{row.role}</span>;
          if (key === "barangay") return <span className="text-brand-gray">{row.barangay || "—"}</span>;
          if (key === "contact") return <span className="text-brand-gray">{row.contact || "—"}</span>;
          if (key === "status") return <StatusBadge value={row.status} />;
          if (key === "actions")
            return (
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={() => { setActionError(""); setEditTarget(row); }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                {row.statusId === "disabled" ? (
                  <button onClick={() => { setActionError(""); setConfirm({ kind: "enable", target: row }); }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-green hover:underline"><CheckCircle2 className="h-3.5 w-3.5" /> Enable</button>
                ) : (
                  <button onClick={() => { setActionError(""); setConfirm({ kind: "disable", target: row }); }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-danger hover:underline"><Ban className="h-3.5 w-3.5" /> Disable</button>
                )}
              </div>
            );
          return row[key];
        }}
      />
      {!loading && !loadError && rows.length === 0 && <p className="py-10 text-center text-sm text-brand-gray">No users match your search.</p>}
      {loading && <p className="py-10 text-center text-sm text-brand-gray">Loading users…</p>}

      {/* Edit modal */}
      {editTarget && (
        <UserEditModal
          initial={editTarget}
          busy={busy}
          error={actionError}
          onClose={() => { setEditTarget(null); setActionError(""); }}
          onSave={handleSave}
        />
      )}

      {/* Confirmation dialogs */}
      {confirmContent && (
        <ConfirmDialog {...confirmContent} busy={busy} onConfirm={handleConfirm} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}
