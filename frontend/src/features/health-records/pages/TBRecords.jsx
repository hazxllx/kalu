import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { X, Search, RefreshCw, Activity, User, MapPin, Stethoscope, Plus, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { tclApi, residentsApi } from "@/services/api";

// TB records are stored in the shared tcl_entries register. Every program value
// below satisfies isTbProgram() so the record is listed as a TB record, and the
// priority/status values match the tcl_entries CHECK constraints exactly
// (priority: Low/Medium/High; status: Active/Inactive/Completed/Transferred),
// so a create is never rejected by the database.
const TB_PROGRAMS = ["TB Patients", "TB Monitoring", "TB Prevention (TPT)"];
const TB_PRIORITIES = ["Low", "Medium", "High"];
const TB_STATUSES = ["Active", "Inactive", "Completed", "Transferred"];

/**
 * TB Records.
 *
 * TB patients are already tracked in the existing `tcl_entries` register as a
 * `program` value ("TB Patients") — there is no separate TB table, service, or
 * endpoint in the schema. This page therefore REUSES the existing operational
 * `tcl` resource (tclApi -> /operational/tcl -> tcl_entries) and simply narrows
 * it to TB programs. No new database structure or API is introduced, so there
 * is no duplicate resident health data and the same barangay/municipality scope
 * (barangay-scope middleware + service-level filter + RLS) already applies.
 *
 * Only fields that exist on `tcl_entries` are shown — program, assigned_bhw,
 * priority, status, last_visit, next_visit(+time), notes, created_at,
 * updated_at — plus the resident resolved from the live directory by id (the
 * `tcl` list select does not embed the resident, so the name/age/sex/barangay
 * are joined client-side exactly as the TCL page does).
 */

// A TCL program counts as a TB record when its label is the TB program.
// Matches "TB Patients", "TB Monitoring", "Tuberculosis ...", etc., without
// matching unrelated programs.
const isTbProgram = (program) => /\btb\b|tuberculos/i.test(String(program || ""));

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-brand-border dark:border-border"
  }`;
const labelCls = "text-sm font-medium text-brand-ink";
const errorCls = "mt-1 text-xs text-brand-danger";

const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDate(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const ageFromBirth = (birthDate) => {
  if (!birthDate) return "";
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : "";
};

/** Normalize a residents API row into the shape this page renders. */
const normalizeResident = (r) => {
  if (!r) return null;
  const name = r.name || [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ").trim();
  return {
    ...r,
    name: name || "Unknown resident",
    age: r.age ?? ageFromBirth(r.birthDate),
    gender: r.gender || r.sex || "",
    barangay: r.barangay || "",
  };
};

/** persisted tcl_entries row (snake_case) → view shape. */
const mapRecord = (row) => ({
  id: row.id,
  residentId: row.resident_id,
  program: row.program || "",
  bhw: row.assigned_bhw || "",
  priority: row.priority || "",
  status: row.status || "",
  lastVisit: row.last_visit || "",
  nextVisit: row.next_visit || "",
  nextVisitTime: row.next_visit_time || "",
  notes: row.notes || "",
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || "",
  // The `tcl` list select is `*` (no resident embed); kept only as a fallback.
  resident: row.resident || null,
});

export default function TBRecords() {
  const { user } = useAuth();
  const scope = getSupervisorScope(user);
  const scopedBarangays =
    scope && scope.level === HS_SCOPE.BARANGAY ? [scope.assignedBarangay] : null;

  const [records, setRecords] = useState([]);
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detail, setDetail] = useState(null);

  // Add TB Record modal state. Creating a TB record enrolls an existing resident
  // into a TB program via the same authorized tcl create endpoint the TCL page
  // uses (POST /operational/tcl). Health Supervisor / PHN / MHO are authorized
  // server-side and by RLS, so the action the button exposes always succeeds for
  // an authorized account and is refused for anyone else.
  const [showAdd, setShowAdd] = useState(false);
  const [residentQuery, setResidentQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({
    residentId: "",
    program: TB_PROGRAMS[0],
    bhw: "",
    priority: "Medium",
    status: "Active",
    lastVisit: todayIso(),
    nextVisit: "",
    nextVisitTime: "",
    notes: "",
  });
  const [formErrors, setFormErrors] = useState({});

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return Promise.all([tclApi.list(), residentsApi.list({ limit: 200 })])
      .then(([tclResult, residentResult]) => {
        const tclRows = (tclResult?.rows || []).map(mapRecord).filter((r) => isTbProgram(r.program));
        setRecords(tclRows);
        const residentRows = residentResult?.rows || residentResult || [];
        setResidents(residentRows.map(normalizeResident).filter(Boolean));
      })
      .catch((err) => {
        // A failed load must surface as an explicit error, never a silent
        // empty "no records" list.
        setLoadError(err?.message || "Unable to load TB records. Please try again.");
        setRecords([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const residentById = useMemo(() => {
    const map = new Map();
    residents.forEach((r) => map.set(r.id, r));
    return map;
  }, [residents]);

  // Resolve each record's resident from the live directory (source of truth for
  // name/age/sex/barangay); fall back to any embedded snapshot.
  const scopedRecords = useMemo(
    () =>
      records
        .map((r) => {
          const live = residentById.get(r.residentId);
          const resident = live || (r.resident ? normalizeResident({ ...r.resident, id: r.residentId }) : null);
          return { ...r, resident, barangay: resident?.barangay || "" };
        })
        .filter((r) => !scopedBarangays || (r.barangay && scopedBarangays.includes(r.barangay))),
    [records, residentById, scopedBarangays]
  );

  // Status filter options are DERIVED from the data so a filter is never shown
  // for a status that has no corresponding TB record.
  const statusOptions = useMemo(() => {
    const set = new Set();
    scopedRecords.forEach((r) => { if (r.status) set.add(r.status); });
    return ["All", ...Array.from(set).sort()];
  }, [scopedRecords]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedRecords.filter((r) => {
      if (statusFilter !== "All" && r.status !== statusFilter) return false;
      if (q) {
        const haystack = `${r.resident?.name || ""} ${r.residentId || ""} ${r.program}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [scopedRecords, search, statusFilter]);

  // Residents selectable in the Add form — restricted to the supervisor's
  // assigned barangay when barangay-scoped, matching the record scope above.
  const pickerResidents = useMemo(() => {
    const pool = scopedBarangays
      ? residents.filter((r) => r.barangay && scopedBarangays.includes(r.barangay))
      : residents;
    const q = residentQuery.trim().toLowerCase();
    return pool
      .filter(
        (r) =>
          !q ||
          (r.name || "").toLowerCase().includes(q) ||
          String(r.id ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .slice(0, 8);
  }, [residents, residentQuery, scopedBarangays]);

  const selectedResident = useMemo(
    () => residents.find((r) => r.id === form.residentId) || null,
    [residents, form.residentId]
  );

  const openAdd = () => {
    setForm({
      residentId: "",
      program: TB_PROGRAMS[0],
      bhw: "",
      priority: "Medium",
      status: "Active",
      lastVisit: todayIso(),
      nextVisit: "",
      nextVisitTime: "",
      notes: "",
    });
    setResidentQuery("");
    setFormErrors({});
    setSubmitError("");
    setShowAdd(true);
  };

  const saveRecord = async () => {
    const errs = {};
    if (!form.residentId) errs.resident = "Please select a resident.";
    if (!form.program) errs.program = "Please select a TB program.";
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    setSubmitError("");
    try {
      const result = await tclApi.create({
        residentId: form.residentId,
        program: form.program,
        assigned_bhw: form.bhw,
        priority: form.priority,
        status: form.status,
        last_visit: form.lastVisit || null,
        next_visit: form.nextVisit || null,
        next_visit_time: form.nextVisitTime || null,
        notes: form.notes,
      });
      // Reflect the new record immediately, then reconcile with the server on
      // the next load so the displayed resident/barangay stay authoritative.
      setRecords((current) => [mapRecord(result?.record || {}), ...current]);
      setShowAdd(false);
      showToast(`${selectedResident?.name || "Resident"} added to ${form.program}.`);
      load();
    } catch (err) {
      setSubmitError(err?.message || "The TB record could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Records", "TB Records"]}
        title="TB Records"
        subtitle={
          scope && scope.level === HS_SCOPE.BARANGAY
            ? `Residents of Barangay ${scope.assignedBarangay} enrolled in TB monitoring.`
            : "Residents enrolled in TB monitoring."
        }
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2.5 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              <Plus className="h-4 w-4" /> Add TB Record
            </button>
          </div>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <Card className="p-4 mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2 sm:max-w-md sm:flex-1">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search resident name or ID..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {statusOptions.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${
                  statusFilter === s ? "bg-brand-blue text-white" : "text-brand-gray hover:bg-brand-bg"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                {["Resident", "Program", "Assigned BHW", "Priority", "Status", "Last Visit", "Last Updated", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-brand-border hover:bg-brand-bg/50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-brand-ink">{r.resident?.name || "—"}</p>
                    <p className="text-xs text-brand-gray">{r.barangay || ""}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.program || "—"}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.bhw || "—"}</td>
                  <td className="px-4 py-3">{r.priority ? <StatusBadge value={r.priority} /> : "—"}</td>
                  <td className="px-4 py-3">{r.status ? <StatusBadge value={r.status} /> : "—"}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{formatDate(r.lastVisit)}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{formatDateTime(r.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setDetail(r)} className="text-sm font-medium text-brand-blue hover:underline">View</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-brand-gray">
                    {loading
                      ? "Loading TB records..."
                      : loadError
                        ? <span className="text-brand-danger">{loadError}</span>
                        : "No TB records found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-light text-brand-blue"><Activity className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-lg font-semibold text-brand-ink">{detail.resident?.name || "TB Record"}</h3>
                    <p className="mt-0.5 text-sm text-brand-gray">{detail.program}{detail.barangay ? ` · ${detail.barangay}` : ""}</p>
                  </div>
                </div>
                <button onClick={() => setDetail(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>

              <div className="space-y-5">
                {/* Resident information */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident Information</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { icon: User, label: "Resident ID", value: detail.residentId },
                      { icon: User, label: "Age", value: detail.resident?.age },
                      { icon: User, label: "Sex", value: detail.resident?.gender },
                      { icon: MapPin, label: "Barangay", value: detail.barangay },
                    ].map((f) => (
                      <div key={f.label}>
                        <p className="text-[11px] text-brand-gray uppercase tracking-wide">{f.label}</p>
                        <p className="mt-0.5 text-sm font-medium text-brand-ink">{f.value || "—"}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* TB monitoring information */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">TB Monitoring Information</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Program / Type</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink flex items-center gap-1.5"><Stethoscope className="h-3.5 w-3.5 text-brand-gray" /> {detail.program || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Treatment Status</p>
                      <div className="mt-1">{detail.status ? <StatusBadge value={detail.status} /> : "—"}</div>
                    </div>
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Priority</p>
                      <div className="mt-1">{detail.priority ? <StatusBadge value={detail.priority} /> : "—"}</div>
                    </div>
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Assigned BHW / Provider</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">{detail.bhw || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Last Visit</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">{formatDate(detail.lastVisit)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Next Follow-up</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">
                        {formatDate(detail.nextVisit)}{detail.nextVisitTime ? ` · ${detail.nextVisitTime}` : ""}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Date Recorded</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">{formatDateTime(detail.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Last Updated</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">{formatDateTime(detail.updatedAt)}</p>
                    </div>
                  </div>
                  {detail.notes && (
                    <div className="mt-4 rounded-btn bg-brand-bg px-3.5 py-3">
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">Notes / History</p>
                      <p className="mt-0.5 text-sm text-brand-ink">{detail.notes}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
                <button onClick={() => setDetail(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Close</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Add TB Record */}
      {showAdd && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Add TB Record</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">Enroll an existing resident into TB monitoring. This links a TB record to the resident; it does not create or modify a resident record.</p>
                </div>
                <button onClick={() => setShowAdd(false)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>

              <div className="space-y-4">
                {/* Resident selection */}
                <div>
                  <label className={labelCls}>Resident <span className="text-brand-danger">*</span></label>
                  {!selectedResident ? (
                    <>
                      <div className="mt-1.5 flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2.5 focus-within:border-brand-blue dark:bg-input dark:border-border">
                        <Search className="h-4 w-4 shrink-0 text-brand-gray" />
                        <input
                          value={residentQuery}
                          onChange={(e) => setResidentQuery(e.target.value)}
                          placeholder="Search resident by name or ID..."
                          className="w-full bg-transparent text-sm outline-none"
                        />
                      </div>
                      {formErrors.resident && <p className={errorCls}>{formErrors.resident}</p>}
                      <div className="mt-2 max-h-44 overflow-y-auto rounded-btn border border-brand-border divide-y divide-brand-border dark:border-border dark:divide-border">
                        {pickerResidents.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => { setForm((p) => ({ ...p, residentId: r.id })); if (formErrors.resident) setFormErrors((p) => ({ ...p, resident: "" })); }}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-brand-light dark:hover:bg-hover"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-brand-ink">{r.name}</span>
                              <span className="block text-xs text-brand-gray">
                                {[r.id, r.age !== "" ? `${r.age} yrs` : null, r.gender, r.barangay].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </button>
                        ))}
                        {pickerResidents.length === 0 && (
                          <p className="px-3 py-3 text-sm text-brand-gray">No residents found.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="mt-1.5 flex items-center justify-between gap-3 rounded-btn border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-brand-ink">{selectedResident.name}</p>
                        <p className="text-xs text-brand-gray">
                          {[selectedResident.id, selectedResident.age !== "" ? `${selectedResident.age} yrs` : null, selectedResident.gender, selectedResident.barangay].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <button onClick={() => setForm((p) => ({ ...p, residentId: "" }))} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">Change</button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>TB Program <span className="text-brand-danger">*</span></label>
                    <select value={form.program} onChange={(e) => setForm((p) => ({ ...p, program: e.target.value }))} className={`${inputCls(formErrors.program)} cursor-pointer`}>
                      {TB_PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    {formErrors.program && <p className={errorCls}>{formErrors.program}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Assigned BHW / Provider</label>
                    <input value={form.bhw} onChange={(e) => setForm((p) => ({ ...p, bhw: e.target.value }))} placeholder="e.g. BHW J. Santos" className={inputCls()} />
                  </div>
                  <div>
                    <label className={labelCls}>Priority</label>
                    <select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))} className={`${inputCls()} cursor-pointer`}>
                      {TB_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Treatment Status</label>
                    <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className={`${inputCls()} cursor-pointer`}>
                      {TB_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Last Visit</label>
                    <input type="date" value={form.lastVisit} onChange={(e) => setForm((p) => ({ ...p, lastVisit: e.target.value }))} className={inputCls()} />
                  </div>
                  <div>
                    <label className={labelCls}>Next Follow-up</label>
                    <input type="date" value={form.nextVisit} onChange={(e) => setForm((p) => ({ ...p, nextVisit: e.target.value }))} className={inputCls()} />
                  </div>
                  <div>
                    <label className={labelCls}>Next Follow-up Time</label>
                    <input type="time" value={form.nextVisitTime} onChange={(e) => setForm((p) => ({ ...p, nextVisitTime: e.target.value }))} className={inputCls()} />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Notes / History</label>
                  <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={`${inputCls()} resize-none`} />
                </div>

                {submitError && (
                  <div className="rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-3.5 py-2.5 text-sm text-brand-danger">{submitError}</div>
                )}

                <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
                  <button onClick={() => setShowAdd(false)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
                  <button
                    onClick={saveRecord}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" /> {saving ? "Saving…" : "Add TB Record"}
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
