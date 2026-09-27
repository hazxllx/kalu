import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { X, Search, RefreshCw, Activity, User, MapPin, Stethoscope } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { tclApi, residentsApi } from "@/services/api";

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
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2.5 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
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
    </>
  );
}
