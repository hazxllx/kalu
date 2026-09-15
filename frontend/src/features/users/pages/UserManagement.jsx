import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import {
  useAdminUsers,
  adminUserStore,
  ASSIGNABLE_ROLES,
  BARANGAY_SCOPED_ROLES,
  validateAssignment,
} from "@/services/mock/adminUserStore";
import { useAuditEvents } from "@/services/mock/auditStore";
import { BARANGAYS } from "@/lib/barangays";
import { useAuth } from "@/context/AuthContext";
import {
  Search, UserPlus, X, CheckCircle2, Pencil, Ban, KeyRound, Trash2, ShieldCheck,
} from "lucide-react";

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

/** Generic confirmation dialog used by disable/reset/delete actions. */
function ConfirmDialog({ title, message, confirmLabel, tone = "danger", onConfirm, onClose }) {
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
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
            <button
              onClick={onConfirm}
              className={`rounded-btn px-5 py-2 text-sm font-medium text-white ${tone === "danger" ? "bg-brand-danger hover:bg-brand-danger/90" : "bg-brand-blue hover:bg-brand-dark"}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ Add / Edit form ---------------------------- */

const emptyForm = () => ({
  name: "", email: "", contact: "", role: "Resident", barangay: "", status: "Active",
});

function UserFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => (initial ? { ...initial } : emptyForm()));
  const [errors, setErrors] = useState({});

  // Barangay options reset when the selected role is not barangay-scoped.
  const barangayOptions = BARANGAY_SCOPED_ROLES.includes(form.role) ? BARANGAYS : [];

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key] || errors.assignment) setErrors((p) => ({ ...p, [key]: "", assignment: "" }));
  };

  // Validate required fields plus the role/barangay combination.
  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = "Full name is required.";
    if (!form.email.trim()) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (!form.contact.trim()) next.contact = "Contact number is required.";
    if (!form.role) next.role = "Role is required.";
    const assignmentError = validateAssignment(form.role, form.barangay);
    if (assignmentError) next.assignment = assignmentError;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{initial ? "Edit User" : "Add User"}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {initial ? "Update account information, role, and barangay assignment." : "Create a new user account."}
              </p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Full Name" required error={errors.name}>
                <input type="text" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Juan Dela Cruz" className={inputCls(errors.name)} />
              </Field>
            </div>
            <Field label="Email" required error={errors.email}>
              <input type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} placeholder="name@kalusagap.test" className={inputCls(errors.email)} />
            </Field>
            <Field label="Contact Number" required error={errors.contact}>
              <input type="text" value={form.contact} onChange={(e) => set("contact")(e.target.value)} placeholder="e.g. 0917 123 4567" className={inputCls(errors.contact)} />
            </Field>
            <Field label="Role" required error={errors.role} hint="Existing project roles only.">
              <select value={form.role} onChange={(e) => set("role")(e.target.value)} className={`${inputCls(errors.role)} cursor-pointer`}>
                {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field
              label="Assigned Barangay"
              error={errors.assignment}
              hint={barangayOptions.length ? "Required for barangay-scoped roles." : "Not applicable to this role."}
            >
              <select
                value={form.barangay}
                onChange={(e) => set("barangay")(e.target.value)}
                disabled={barangayOptions.length === 0}
                className={`${inputCls(errors.assignment)} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <option value="">None</option>
                {barangayOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            {initial && (
              <Field label="Account Status">
                <select value={form.status} onChange={(e) => set("status")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  <option value="Active">Active</option>
                  <option value="Disabled">Disabled</option>
                </select>
              </Field>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
            <button
              onClick={() => { if (validate()) onSave(form); }}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              <CheckCircle2 className="h-4 w-4" /> {initial ? "Save Changes" : "Add User"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------- Main page -------------------------------- */

/**
 * Admin User Management.
 *
 * Full frontend CRUD over the shared adminUserStore: add, edit (incl. role and
 * barangay assignment), disable/enable, frontend-only password reset, and
 * delete (disabled accounts only). Every action writes an audit event.
 */
export default function UserManagement() {
  const { user } = useAuth();
  const users = useAdminUsers();
  const audit = useAuditEvents(); // re-renders when audit events are added

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [formTarget, setFormTarget] = useState(null); // null | "new" | user
  const [confirm, setConfirm] = useState(null); // { kind, user }
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };
  const log = (action, description, status = "Success") =>
    auditStore.addEvent({ user: user?.name || "Admin", role: "Admin", action, description, status });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => roleFilter === "All" || u.role === roleFilter)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [users, query, roleFilter, audit]);

  // Save handler for both add and edit.
  const handleSave = (form) => {
    if (formTarget && formTarget !== "new") {
      adminUserStore.updateUser(formTarget.id, form);
      log("User updated", `Updated account of ${form.name}.`);
      if (formTarget.role !== form.role) log("Role changed", `Changed role of ${form.name} to ${form.role}.`, "Warning");
      if (formTarget.barangay !== form.barangay) log("Barangay assigned", `Assigned ${form.name} to ${form.barangay || "no barangay"}.`);
      showToast("User updated successfully.");
    } else {
      adminUserStore.addUser(form);
      log("User created", `Created user account (${form.name}).`);
      showToast("User created successfully.");
    }
    setFormTarget(null);
  };

  // Confirm-dialog dispatcher for disable/enable/reset/delete.
  const handleConfirm = () => {
    const { kind, target } = confirm;
    setConfirm(null);
    if (!target) return;
    switch (kind) {
      case "disable":
        adminUserStore.setUserStatus(target.id, "Disabled");
        log("User disabled", `Disabled account of ${target.name}.`, "Warning");
        showToast("User disabled.");
        break;
      case "enable":
        adminUserStore.setUserStatus(target.id, "Active");
        log("User enabled", `Re-enabled account of ${target.name}.`);
        showToast("User enabled.");
        break;
      case "reset":
        adminUserStore.resetPassword(target.id);
        log("Password reset", `Reset password for ${target.name}.`);
        showToast("Password reset (frontend only — no email is sent).");
        break;
      case "delete":
        adminUserStore.deleteUser(target.id);
        log("User deleted", `Deleted inactive account of ${target.name}.`, "Warning");
        showToast("User deleted.");
        break;
      default:
        break;
    }
  };

  const confirmContent = confirm
    ? {
        disable: { title: "Disable User", message: `Disable the account of ${confirm.target.name}? The account is kept and can be re-enabled later.`, confirmLabel: "Disable User", tone: "danger" },
        enable: { title: "Enable User", message: `Re-enable the account of ${confirm.target.name}?`, confirmLabel: "Enable User", tone: "primary" },
        reset: { title: "Reset Password", message: `Generate a password reset for ${confirm.target.name}? This is a frontend-only action — no email is sent.`, confirmLabel: "Reset Password", tone: "primary" },
        delete: { title: "Delete User", message: `Permanently remove the inactive account of ${confirm.target.name}? This cannot be undone.`, confirmLabel: "Delete User", tone: "danger" },
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
        action={
          <button
            onClick={() => setFormTarget("new")}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <UserPlus className="h-4 w-4" /> Add User
          </button>
        }
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
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </Card>

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
          if (key === "contact") return <span className="text-brand-gray">{row.contact}</span>;
          if (key === "status") return <StatusBadge value={row.status} />;
          if (key === "actions")
            return (
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={() => setFormTarget(row)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                <button onClick={() => setConfirm({ kind: "reset", target: row })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-gray hover:underline"><KeyRound className="h-3.5 w-3.5" /> Reset</button>
                {row.status === "Active" ? (
                  <button onClick={() => setConfirm({ kind: "disable", target: row })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-danger hover:underline"><Ban className="h-3.5 w-3.5" /> Disable</button>
                ) : (
                  <>
                    <button onClick={() => setConfirm({ kind: "enable", target: row })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-green hover:underline"><CheckCircle2 className="h-3.5 w-3.5" /> Enable</button>
                    <button onClick={() => setConfirm({ kind: "delete", target: row })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-danger hover:underline"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                  </>
                )}
              </div>
            );
          return row[key];
        }}
      />
      {rows.length === 0 && <p className="py-10 text-center text-sm text-brand-gray">No users match your search.</p>}

      {/* Add / Edit modal */}
      {formTarget && (
        <UserFormModal
          initial={formTarget === "new" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSave={handleSave}
        />
      )}

      {/* Confirmation dialogs */}
      {confirmContent && (
        <ConfirmDialog {...confirmContent} onConfirm={handleConfirm} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}
