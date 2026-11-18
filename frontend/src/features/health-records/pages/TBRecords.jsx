import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import TablePagination from "@/components/tables/TablePagination";
import { X, Search, Activity, User, MapPin, Stethoscope, Plus, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import OfflineCacheNotice from "@/features/offline/components/OfflineCacheNotice";
import { listTclOffline } from "@/services/offline/clinicalOfflineService";
import { listResidentsOffline } from "@/services/offline/residentOfflineService";
import { classifySyncError, SYNC_ERROR } from "@/services/offline/errors";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import useHouseholdWorkers from "@/hooks/useHouseholdWorkers";
import { tclApi } from "@/services/api";
import { formatClinicalDate, formatClinicalDateTime } from "@/lib/dateUtils";
import {
  normalizeResident,
  loadResidentDirectory,
  workersForResident,
  TB_PROGRAMS,
  TB_PRIORITIES,
  TB_STATUSES,
  mapTbRecord,
  validateTbRecordForm,
  buildTbRecordPayload,
} from "../lib/tclData";

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
  return formatClinicalDate(iso);
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-brand-border dark:border-border"
  }`;
const labelCls = "text-sm font-medium text-brand-ink";
const errorCls = "mt-1 text-xs text-brand-danger";

const formatDateTime = (iso) => {
  const formatted = formatClinicalDateTime(iso);
  return formatted.date === "—" ? "—" : `${formatted.date}${formatted.time === "—" ? "" : ` · ${formatted.time}`}`;
};

const mapRecord = mapTbRecord;

export default function TBRecords() {
  const { user } = useAuth();
  const scope = getSupervisorScope(user);
  const scopedBarangays =
    scope && scope.level === HS_SCOPE.BARANGAY ? [scope.assignedBarangay] : null;

  const { online, lastSyncedAt } = useSyncStatus();
  const [records, setRecords] = useState([]);
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [cacheInfo, setCacheInfo] = useState({ source: null, cachedAt: null, stale: false });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [detail, setDetail] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const workerDirectory = useHouseholdWorkers();

  // Add / Edit TB Record modal state. Creating a TB record enrolls an existing resident
  // into a TB program via the same authorized tcl create endpoint the TCL page
  // uses (POST /operational/tcl). Health Supervisor / PHN / MHO are authorized
  // server-side and by RLS, so the action the button exposes always succeeds for
  // an authorized account and is refused for anyone else.
  const [showAdd, setShowAdd] = useState(false);
  const [residentQuery, setResidentQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(/** @type {Record<string, any>} */ ({
    residentId: "",
    program: TB_PROGRAMS[0],
    bhw: "",
    priority: "Medium",
    status: "Active",
    lastVisit: todayIso(),
    nextVisit: "",
    nextVisitTime: "",
    notes: "",
  }));
  const [formErrors, setFormErrors] = useState(/** @type {Record<string, any>} */ ({}));

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(() => {
    if (!user?.id) { setRecords([]); setResidents([]); setLoading(false); return Promise.resolve(); }
    setLoading(true);
    setLoadError(null);
    setCacheInfo({ source: null, cachedAt: null, stale: false });
    const loadResidents = async () => {
      if (online) {
        try {
          return await loadResidentDirectory((params) =>
            listResidentsOffline({ ownerId: user.id, params }),
          );
        } catch (err) {
          if (classifySyncError(err).code !== SYNC_ERROR.NETWORK) throw err;
        }
      }
      const cachedResidents = await listResidentsOffline({ ownerId: user.id });
      return (cachedResidents?.rows || []).map(normalizeResident).filter(Boolean);
    };
    return Promise.all([
      listTclOffline({ ownerId: user.id, fetchFn: () => tclApi.list(), online: () => online }),
      loadResidents(),
    ])
      .then(([tclResult, residentResult]) => {
        const tclRows = (tclResult?.rows || []).map(mapRecord).filter((r) => isTbProgram(r.program));
        setRecords(tclRows);
        setCacheInfo({
          source: tclResult?.source || "server",
          cachedAt: tclResult?.cachedAt ?? null,
          stale: Boolean(tclResult?.stale),
        });
        const residentRows = Array.isArray(residentResult) ? residentResult : (residentResult?.rows || []).map(normalizeResident).filter(Boolean);
        setResidents(residentRows);
      })
      .catch((err) => {
        // A failed load must surface as an explicit error, never a silent
        // empty "no records" list.
        setLoadError(err?.message || "Unable to load TB records. Please try again.");
        setRecords([]);
      })
      .finally(() => setLoading(false));
  }, [user?.id, online]);

  useEffect(() => { load(); }, [load]);

  // Lock background scroll and close the open modal on Escape.
  const anyModalOpen = showAdd || Boolean(detail);
  useEffect(() => {
    if (!anyModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (showAdd) setShowAdd(false);
      else if (detail) setDetail(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen, showAdd, detail]);

  const residentById = useMemo(() => {
    const map = new Map();
    residents.forEach((r) => map.set(r.id, r));
    return map;
  }, [residents]);

  const workerById = useMemo(() => {
    const map = new Map();
    (workerDirectory.rows || []).forEach((w) => map.set(w.id, w));
    return map;
  }, [workerDirectory.rows]);

  // Resolve each record's resident and BHW name from the live directories.
  const scopedRecords = useMemo(
    () =>
      records
        .map((r) => {
          const live = residentById.get(r.residentId);
          const resident = live || (r.resident ? normalizeResident({ ...r.resident, id: r.residentId }) : null);
          const assignedWorker = r.bhwId ? workerById.get(r.bhwId) : null;
          const bhw = assignedWorker ? (assignedWorker.fullName || assignedWorker.name || r.bhw) : r.bhw;
          return { ...r, resident, barangay: resident?.barangay || "", bhw };
        })
        .filter((r) => !scopedBarangays || (r.barangay && scopedBarangays.includes(r.barangay))),
    [records, residentById, workerById, scopedBarangays]
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
  const pageRecords = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(filtered.length / pageSize))));
  }, [filtered.length, pageSize]);

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
    () => residents.find((r) => r.id === form.residentId) || editingRecord?.resident || null,
    [residents, form.residentId, editingRecord]
  );
  const assignableBhws = useMemo(
    () => workersForResident(workerDirectory.rows || [], selectedResident),
    [workerDirectory.rows, selectedResident]
  );

  const openAdd = () => {
    setEditingRecord(null);
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

  const openEdit = (record) => {
    setEditingRecord(record);
    setForm({
      residentId: record.residentId || "",
      program: record.program || TB_PROGRAMS[0],
      bhw: record.bhwId || "",
      priority: record.priority || "Medium",
      status: record.status || "Active",
      lastVisit: record.lastVisit || "",
      nextVisit: record.nextVisit || "",
      nextVisitTime: record.nextVisitTime || "",
      notes: record.notes || "",
    });
    setResidentQuery("");
    setFormErrors({});
    setSubmitError("");
    setDetail(null);
    setShowAdd(true);
  };

  const updateStatus = async (recordId, status) => {
    if (saving || !recordId) return;
    setSaving(true);
    setSubmitError("");
    try {
      const result = await tclApi.update(recordId, { status }, { ownerId: user?.id });
      const updated = mapRecord(result?.record || { id: recordId, status });
      setRecords((current) => current.map((row) => (row.id === recordId ? { ...row, ...updated } : row)));
      setDetail((current) => (current && current.id === recordId ? { ...current, ...updated } : current));
      showToast(`Status updated to ${updated.status}.`);
      await load();
    } catch (err) {
      showToast(err?.message || "Could not update TB status.");
    } finally {
      setSaving(false);
    }
  };

  const saveRecord = async () => {
    const errs = validateTbRecordForm({ form, assignableBhws, records, editingRecord });
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    setSubmitError("");
    try {
      const payload = buildTbRecordPayload(form, editingRecord);
      if (editingRecord) {
        const result = await tclApi.update(editingRecord.id, payload, { ownerId: user?.id });
        const updated = mapRecord(result?.record || { ...editingRecord, ...payload });
        setRecords((current) => current.map((row) => (row.id === editingRecord.id ? { ...row, ...updated } : row)));
        showToast(`${selectedResident?.name || "TB"} record updated.`);
      } else {
        const result = await tclApi.create(payload, { ownerId: user?.id });
        setRecords((current) => [mapRecord(result?.record || {}), ...current]);
        showToast(`${selectedResident?.name || "Resident"} added to ${form.program}.`);
      }
      setShowAdd(false);
      setEditingRecord(null);
      await load();
    } catch (err) {
      setSubmitError(err?.message || "The TB record could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Clinical Care", "TB Records"]}
        title="TB Records"
        subtitle={
          scope && scope.level === HS_SCOPE.BARANGAY
            ? `Residents of Barangay ${scope.assignedBarangay} enrolled in TB monitoring.`
            : "Residents enrolled in TB monitoring."
        }
        action={
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> Add TB Record
          </button>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <OfflineCacheNotice
        source={cacheInfo.source}
        cachedAt={cacheInfo.cachedAt}
        lastSyncedAt={lastSyncedAt}
        stale={cacheInfo.stale}
        empty={records.length === 0}
        onRetry={load}
      />

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
              {pageRecords.map((r) => (
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
                    <div className="flex items-center gap-3">
                      <button onClick={() => setDetail(r)} className="text-sm font-medium text-brand-blue hover:underline">View</button>
                      <button onClick={() => openEdit(r)} className="text-sm font-medium text-brand-gray hover:text-brand-ink">Edit</button>
                    </div>
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
                        : cacheInfo.source === "cache" && records.length === 0
                          ? "No saved records available offline."
                          : "No TB records found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} className="m-3" />
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

              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Update Status</p>
                <div className="flex flex-wrap gap-2">
                  {TB_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={saving || detail.status === s}
                      onClick={() => updateStatus(detail.id, s)}
                      className={`rounded-btn border px-3 py-1.5 text-xs font-medium transition-colors ${
                        detail.status === s
                          ? "border-brand-blue bg-brand-blue text-white"
                          : "border-brand-border bg-white text-brand-ink hover:bg-brand-bg disabled:opacity-50"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
                <button onClick={() => openEdit(detail)} className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg">Edit Record</button>
                <button onClick={() => setDetail(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Close</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Add TB Record */}
      {showAdd && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden">
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-brand-ink">{editingRecord ? "Edit TB Record" : "Add TB Record"}</h3>
                <p className="mt-0.5 text-sm text-brand-gray">{editingRecord ? "Update TB monitoring details, assigned BHW, or visit schedule." : "Enroll an existing resident into TB monitoring. This links a TB record to the resident; it does not create or modify a resident record."}</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-6">
                {/* Resident Information */}
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Resident Information</p>
                  <div className="mt-3">
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
                        {residentQuery.trim() && (
                          <div className="mt-2 max-h-44 overflow-y-auto rounded-btn border border-brand-border divide-y divide-brand-border dark:border-border dark:divide-border">
                            {pickerResidents.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => { setForm((p) => ({ ...p, residentId: r.id, bhw: "" })); setResidentQuery(""); if (formErrors.resident) setFormErrors((p) => ({ ...p, resident: "" })); }}
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
                        )}
                      </>
                    ) : (
                      <div className="mt-1.5 rounded-btn border border-emerald-200 bg-emerald-50/70 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                        <div className="flex items-start justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-brand-ink">{selectedResident.name}</p>
                          {!editingRecord && <button onClick={() => { setForm((p) => ({ ...p, residentId: "", bhw: "" })); setResidentQuery(""); }} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">Change</button>}
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {[
                            ["Resident ID", selectedResident.id],
                            ["Age", selectedResident.age !== "" && selectedResident.age != null ? `${selectedResident.age} yrs` : "—"],
                            ["Sex", selectedResident.gender || "—"],
                            ["Barangay", selectedResident.barangay || "—"],
                          ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                              <p className="mt-0.5 truncate text-sm font-medium text-brand-ink">{value || "—"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* TB Record Details */}
                <section className="border-t border-brand-border pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">TB Record Details</p>
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>TB Program <span className="text-brand-danger">*</span></label>
                      <select value={form.program} onChange={(e) => { setForm((p) => ({ ...p, program: e.target.value })); if (formErrors.program) setFormErrors((p) => ({ ...p, program: "" })); }} className={`${inputCls(formErrors.program)} cursor-pointer`}>
                        {TB_PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      {formErrors.program && <p className={errorCls}>{formErrors.program}</p>}
                    </div>
                    <div>
                      <label className={labelCls}>Assigned BHW / Provider</label>
                      <select
                        value={form.bhw}
                        onChange={(e) => {
                          setForm((p) => ({ ...p, bhw: e.target.value }));
                          if (formErrors.bhw) setFormErrors((p) => ({ ...p, bhw: "" }));
                        }}
                        disabled={!selectedResident || workerDirectory.loading}
                        className={`${inputCls(formErrors.bhw)} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <option value="">
                          {!selectedResident
                            ? "Select a resident first"
                            : assignableBhws.length
                              ? "Unassigned (optional)"
                              : "No BHW registered in resident's barangay"}
                        </option>
                        {assignableBhws.map((worker) => (
                          <option key={worker.id} value={worker.id}>
                            {worker.fullName || worker.name || worker.email}
                          </option>
                        ))}
                      </select>
                      {formErrors.bhw && <p className={errorCls}>{formErrors.bhw}</p>}
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
                    {formErrors.dates && <p className={`sm:col-span-2 ${errorCls}`}>{formErrors.dates}</p>}
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Notes / History</label>
                      <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={`${inputCls()} resize-none`} />
                    </div>
                  </div>
                </section>

                {submitError && (
                  <div className="rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-3.5 py-2.5 text-sm text-brand-danger">{submitError}</div>
                )}
              </div>
            </div>

            {/* Fixed footer */}
            <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
              <button
                onClick={saveRecord}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> {saving ? "Saving…" : editingRecord ? "Save Changes" : "Add TB Record"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
