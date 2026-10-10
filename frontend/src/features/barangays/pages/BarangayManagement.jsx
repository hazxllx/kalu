import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useToast } from "@/components/ui/use-toast";
import { usePermissions } from "@/context/PermissionsContext";
import { useBarangays } from "@/context/BarangaysContext";
import { barangaysApi } from "@/services/api";
import {
  AlertTriangle, Ban, Building2, CheckCircle2, Filter, Loader2, MapPin, Pencil,
  Plus, RotateCcw, Search, Trash2, X,
} from "lucide-react";

/* ------------------------------------------------------------------------- */
/* Styling helpers (match the Admin User Management conventions)             */
/* ------------------------------------------------------------------------- */

const inputCls = (error = false) =>
  `mt-1 w-full rounded-btn border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;
const selectCls =
  "h-10 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input";

const STATUS_META = {
  Active: { label: "Active", badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20", dot: "bg-emerald-500" },
  Inactive: { label: "Inactive", badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-500/20", dot: "bg-slate-400" },
};

const statusMeta = (id) => STATUS_META[id] || STATUS_META.Inactive;

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

function StatusPill({ status }) {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function Field({ label, htmlFor, required = false, hint = null, error = null, children }) {
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
/* Add / Edit modal                                                          */
/* ------------------------------------------------------------------------- */

const emptyForm = {
  name: "",
  status: "Active",
  captain: "",
  contact: "",
  healthStationName: "",
};

/**
 * KALUSAGAP operates solely within Pili, Camarines Sur, so the admin never
 * selects a municipality. The backend still requires a valid municipality_id,
 * so we resolve the Pili record from the loaded options (falling back to the
 * only configured municipality) and assign it automatically. In edit mode the
 * barangay's existing municipality is preserved so a saved record never loses
 * or changes its municipality.
 */
const resolvePiliMunicipalityId = (municipalities) => {
  const pili = municipalities.find(
    (m) =>
      (m.name || "").trim().toLowerCase() === "pili" &&
      (m.province || "").toLowerCase().includes("camarines sur"),
  );
  return (pili || municipalities[0])?.id || "";
};

function BarangayModal({ mode, record, municipalities, onClose, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "edit" && record) {
      setForm({
        name: record.name || "",
        status: record.status || "Active",
        captain: record.captain || "",
        contact: record.contact || "",
        healthStationName: record.healthStationName || "",
      });
    } else {
      setForm({ ...emptyForm });
    }
    setErrors({});
  }, [mode, record, municipalities]);

  // Lock background scrolling while the modal is open and close on Escape.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = /** @type {Record<string,string>} */ ({});
    if (!form.name.trim()) next.name = "Barangay name is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate() || saving) return;

    // The municipality is assigned internally (Pili, Camarines Sur). Preserve
    // the existing municipality when editing; otherwise resolve the Pili record.
    const municipalityId =
      (mode === "edit" && record?.municipalityId) || resolvePiliMunicipalityId(municipalities);
    if (!municipalityId) {
      toast({
        variant: "destructive",
        title: "Municipality unavailable",
        description: "The Pili, Camarines Sur municipality could not be resolved. Please reload and try again.",
      });
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      municipalityId,
      status: form.status,
      captain: form.captain.trim(),
      contact: form.contact.trim(),
      healthStationName: form.healthStationName.trim(),
    };
    try {
      if (mode === "edit" && record) {
        await barangaysApi.update(record.id, payload);
        toast({ title: "Barangay updated", description: `"${payload.name}" has been saved.` });
      } else {
        await barangaysApi.create(payload);
        toast({ title: "Barangay added", description: `"${payload.name}" is now available across the app.` });
      }
      onSaved();
    } catch (err) {
      // Surface backend field errors when present.
      const fieldErrors = err?.payload?.error?.errors;
      if (fieldErrors && typeof fieldErrors === "object") {
        setErrors((p) => ({ ...p, ...fieldErrors }));
      }
      toast({
        variant: "destructive",
        title: mode === "edit" ? "Could not update barangay" : "Could not add barangay",
        description: err?.message || "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 sm:p-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "Edit barangay" : "Add barangay"}
        className="flex max-h-[90vh] w-full max-w-[760px] flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex min-h-0 flex-1 flex-col">
          {/* Header (fixed) */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
            <h3 className="text-lg font-semibold text-brand-ink">
              {mode === "edit" ? "Edit Barangay" : "Add New Barangay"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-btn p-1.5 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body (scrolls) */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-4">
              {/* Row 1 — full width */}
              <Field label="Barangay Name" htmlFor="brgy-name" required error={errors.name}>
                <input
                  id="brgy-name"
                  type="text"
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Enter barangay name"
                  className={inputCls(Boolean(errors.name))}
                  autoFocus
                />
              </Field>

              {/* Row 2 — two columns */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Status" htmlFor="brgy-status" hint="Inactive barangays stay in records but are hidden from new selections.">
                  <select id="brgy-status" value={form.status} onChange={set("status")} className={selectCls}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </Field>

                <Field label="Barangay Captain" htmlFor="brgy-captain">
                  <input id="brgy-captain" type="text" value={form.captain} onChange={set("captain")} placeholder="Optional" className={inputCls()} />
                </Field>
              </div>

              {/* Row 3 — two columns */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Contact Number" htmlFor="brgy-contact">
                  <input id="brgy-contact" type="text" value={form.contact} onChange={set("contact")} placeholder="Optional" className={inputCls()} />
                </Field>

                <Field label="Health Station Name" htmlFor="brgy-station">
                  <input id="brgy-station" type="text" value={form.healthStationName} onChange={set("healthStationName")} placeholder="Optional" className={inputCls()} />
                </Field>
              </div>
            </div>
          </div>

          {/* Footer (fixed) */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "edit" ? "Save Changes" : "Save Barangay"}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Delete confirmation dialog                                                */
/* ------------------------------------------------------------------------- */

function DeleteDialog({ record, onClose, onDeleted, onDeactivated }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(/** @type {null | { message: string, canDeactivate: boolean }} */ (null));

  // Lock background scrolling while the dialog is open and close on Escape.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, busy]);

  const doDelete = async () => {
    if (busy) return;
    setBusy(true);
    setBlocked(null);
    try {
      await barangaysApi.remove(record.id);
      toast({ title: "Barangay deleted", description: `"${record.name}" has been removed.` });
      onDeleted();
    } catch (err) {
      if (err?.status === 409) {
        setBlocked({
          message: err?.message || "This barangay is still referenced by existing records.",
          canDeactivate: record.status === "Active",
        });
      } else {
        toast({ variant: "destructive", title: "Could not delete barangay", description: err?.message || "Please try again." });
      }
    } finally {
      setBusy(false);
    }
  };

  const doDeactivate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await barangaysApi.update(record.id, { status: "Inactive" });
      toast({ title: "Barangay deactivated", description: `"${record.name}" is now Inactive and hidden from new selections.` });
      onDeactivated();
    } catch (err) {
      toast({ variant: "destructive", title: "Could not deactivate barangay", description: err?.message || "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={onClose}>
      <Card role="dialog" aria-modal="true" aria-label="Delete barangay" className="w-full max-w-md" onMouseDown={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${blocked ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}`}>
              {blocked ? <AlertTriangle className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-brand-ink">
                {blocked ? "Cannot delete this barangay" : "Delete barangay"}
              </h3>
              {blocked ? (
                <p className="mt-1 text-sm text-brand-gray">{blocked.message}</p>
              ) : (
                <p className="mt-1 text-sm text-brand-gray">
                  Are you sure you want to permanently delete <span className="font-medium text-brand-ink">Brgy. {record.name}</span>?
                  This cannot be undone. Barangays with existing residents, households, personnel or records cannot be deleted.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
            >
              {blocked ? "Close" : "Cancel"}
            </button>
            {blocked ? (
              blocked.canDeactivate && (
                <button
                  type="button"
                  onClick={doDeactivate}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-btn bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                  Deactivate instead
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={doDelete}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Main page                                                                 */
/* ------------------------------------------------------------------------- */

export default function BarangayManagement() {
  const { can } = usePermissions();
  const { refresh: refreshBarangayRegistry } = useBarangays();

  const canManage = can ? can("system.settings.manage") : true;

  const [rows, setRows] = useState(/** @type {any[]} */ ([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  const [options, setOptions] = useState({ municipalities: [], statuses: ["Active", "Inactive"] });

  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [municipalityFilter, setMunicipalityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [modal, setModal] = useState(/** @type {null | { mode: "add"|"edit", record?: any }} */ (null));
  const [deleteTarget, setDeleteTarget] = useState(/** @type {any} */ (null));

  const requestSeq = useRef(0);

  const loadOptions = useCallback(async () => {
    try {
      const data = await barangaysApi.options();
      setOptions({
        municipalities: data?.municipalities || [],
        statuses: data?.statuses || ["Active", "Inactive"],
      });
    } catch {
      /* non-fatal: the editor can still work with an empty municipality list */
    }
  }, []);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await barangaysApi.list({
        q: q.trim() || undefined,
        municipalityId: municipalityFilter || undefined,
        status: statusFilter || undefined,
      });
      if (seq !== requestSeq.current) return;
      setRows(data?.barangays || []);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err?.message || "Unable to load barangays.");
      setRows([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [q, municipalityFilter, statusFilter]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  // Debounce the (search-driven) list query.
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  // After any mutation: reload the admin list AND refresh the app-wide active
  // barangay registry so every dropdown picks the change up immediately.
  const afterMutation = useCallback(() => {
    setModal(null);
    setDeleteTarget(null);
    load();
    refreshBarangayRegistry();
  }, [load, refreshBarangayRegistry]);

  const resetFilters = () => {
    setQ("");
    setMunicipalityFilter("");
    setStatusFilter("");
  };

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.status === "Active").length;
    return { total: rows.length, active, inactive: rows.length - active };
  }, [rows]);

  const hasActiveFilters = Boolean(q.trim() || municipalityFilter || statusFilter);
  const showEmpty = !loading && !error && rows.length === 0;

  return (
    <>
      <PageHeader
        crumbs={["Admin", "Barangay Management"]}
        title="Barangay Management"
        subtitle="Create, edit, and manage the barangays used across KALUSAGAP. Changes apply everywhere a barangay is selected."
        action={
          canManage ? (
            <button
              type="button"
              onClick={() => setModal({ mode: "add" })}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              <Plus className="h-4 w-4" /> Add Barangay
            </button>
          ) : undefined
        }
      />

      {/* Summary */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue"><MapPin className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="block text-xl font-semibold tabular-nums text-brand-ink">{loading ? "…" : counts.total}</span>
            <span className="block truncate text-xs text-brand-gray">Total barangays</span>
          </span>
        </Card>
        <Card className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="block text-xl font-semibold tabular-nums text-brand-ink">{loading ? "…" : counts.active}</span>
            <span className="block truncate text-xs text-brand-gray">Active</span>
          </span>
        </Card>
        <Card className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Ban className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="block text-xl font-semibold tabular-nums text-brand-ink">{loading ? "…" : counts.inactive}</span>
            <span className="block truncate text-xs text-brand-gray">Inactive</span>
          </span>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-gray" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search barangays by name…"
              className="h-10 w-full rounded-btn border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input"
              aria-label="Search barangays by name"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            className={`inline-flex items-center gap-2 rounded-btn border px-3 py-2 text-sm font-medium transition-colors ${
              showFilters || municipalityFilter || statusFilter
                ? "border-brand-blue text-brand-blue"
                : "border-slate-200 text-brand-gray hover:border-brand-blue/50"
            }`}
          >
            <Filter className="h-4 w-4" /> Filters
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm font-medium text-brand-gray hover:text-brand-ink"
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-brand-gray">Municipality</label>
              <select value={municipalityFilter} onChange={(e) => setMunicipalityFilter(e.target.value)} className={selectCls}>
                <option value="">All municipalities</option>
                {options.municipalities.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-brand-gray">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
                <option value="">All statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
        )}
      </Card>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-btn bg-brand-danger/10 px-4 py-3 text-sm text-brand-danger" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</span>
          <button type="button" onClick={load} className="font-medium underline">Retry</button>
        </div>
      )}

      {/* Table (desktop) */}
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-brand-bg/50 text-left text-xs uppercase tracking-wide text-brand-gray">
              <th className="px-5 py-3 font-medium">Barangay</th>
              <th className="px-5 py-3 font-medium">Municipality</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-5 py-4" colSpan={5}>
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  </td>
                </tr>
              ))
            ) : showEmpty ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-bg">
                    <MapPin className="h-6 w-6 text-brand-gray" />
                  </div>
                  <p className="mt-3 font-medium text-brand-ink">No barangays found</p>
                  <p className="mt-1 text-sm text-brand-gray">
                    {hasActiveFilters ? "Try adjusting your search or filters." : "Add the first barangay to get started."}
                  </p>
                  {hasActiveFilters && (
                    <button type="button" onClick={resetFilters} className="mt-3 text-sm font-medium text-brand-blue hover:underline">
                      Clear filters
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-brand-bg/40">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light text-brand-blue"><MapPin className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <p className="font-medium text-brand-ink">Brgy. {b.name}</p>
                        {b.healthStationName ? <p className="truncate text-xs text-brand-gray">{b.healthStationName}</p> : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-brand-ink">
                    <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-brand-gray" /> {b.municipality || "—"}</span>
                  </td>
                  <td className="px-5 py-4"><StatusPill status={b.status} /></td>
                  <td className="px-5 py-4 text-brand-gray">{formatDate(b.createdAt)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setModal({ mode: "edit", record: b })}
                        className="inline-flex items-center gap-1.5 rounded-btn border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(b)}
                        className="inline-flex items-center gap-1.5 rounded-btn border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-brand-danger transition-colors hover:border-brand-danger hover:bg-brand-danger/5"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {/* Cards (mobile) */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4"><div className="h-16 w-full animate-pulse rounded bg-slate-100" /></Card>
          ))
        ) : showEmpty ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-bg"><MapPin className="h-6 w-6 text-brand-gray" /></div>
            <p className="mt-3 font-medium text-brand-ink">No barangays found</p>
            <p className="mt-1 text-sm text-brand-gray">
              {hasActiveFilters ? "Try adjusting your search or filters." : "Add the first barangay to get started."}
            </p>
          </Card>
        ) : (
          rows.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light text-brand-blue"><MapPin className="h-4 w-4" /></span>
                  <div>
                    <p className="font-medium text-brand-ink">Brgy. {b.name}</p>
                    <p className="text-xs text-brand-gray">{b.municipality || "—"} · {formatDate(b.createdAt)}</p>
                  </div>
                </div>
                <StatusPill status={b.status} />
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setModal({ mode: "edit", record: b })} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-btn border border-slate-200 px-2.5 py-2 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button type="button" onClick={() => setDeleteTarget(b)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-btn border border-slate-200 px-2.5 py-2 text-xs font-medium text-brand-danger hover:border-brand-danger hover:bg-brand-danger/5">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </Card>
          ))
        )}
      </div>

      {modal && (
        <BarangayModal
          mode={modal.mode}
          record={modal.record}
          municipalities={options.municipalities}
          onClose={() => setModal(null)}
          onSaved={afterMutation}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          record={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={afterMutation}
          onDeactivated={afterMutation}
        />
      )}
    </>
  );
}
