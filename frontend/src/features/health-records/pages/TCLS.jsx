import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { Plus, X, Search, CheckCircle2, Calendar, User, MapPin, Stethoscope } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { useResidents } from "@/services/mock/residentStore";
import {
  useTcls,
  tclStore,
  TCL_PROGRAMS,
  TCL_STATUSES,
  TCL_PRIORITIES,
  ACTIVE_BHWS,
} from "@/services/mock/tclStore";

const categories = ["All", ...TCL_PROGRAMS];

const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

const labelCls = "text-sm font-medium text-brand-ink";
const errorCls = "mt-1 text-xs text-brand-danger";

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function ModalShell({ title, subtitle, onClose, children }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{title}</h3>
              {subtitle && <p className="mt-0.5 text-sm text-brand-gray">{subtitle}</p>}
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

export default function TCLS() {
  const { user } = useAuth();
  const allTcls = useTcls();
  const allResidents = useResidents();

  const scope = getSupervisorScope(user);
  const scopedBarangays =
    scope && scope.level === HS_SCOPE.BARANGAY ? [scope.assignedBarangay] : null;

  const residentOptions = useMemo(() => {
    const pool = scopedBarangays
      ? allResidents.filter((r) => r.barangay && scopedBarangays.includes(r.barangay))
      : allResidents;
    return pool
      .map((r) => ({ ...r }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allResidents, scopedBarangays]);

  const residentById = useMemo(() => {
    const map = new Map();
    residentOptions.forEach((r) => map.set(r.id, r));
    return map;
  }, [residentOptions]);

  // Only records whose resident lives in the supervisor's assigned barangay.
  // The resident's barangay is resolved from the live registry when possible.
  const scopedTcls = useMemo(
    () =>
      allTcls.filter((t) => {
        const live = residentById.get(t.residentId);
        const brgy = live?.barangay || t.resident?.barangay || "";
        return !scopedBarangays || scopedBarangays.includes(brgy);
      }),
    [allTcls, scopedBarangays, residentById]
  );

  const [cat, setCat] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [showView, setShowView] = useState(null); // TCL id
  const [showSchedule, setShowSchedule] = useState(null); // TCL id
  const [toast, setToast] = useState(null);

  // Add form state.
  const [residentQuery, setResidentQuery] = useState("");
  const [form, setForm] = useState({
    residentId: "",
    program: "",
    bhw: "",
    priority: "Medium",
    status: "Active",
    lastVisit: todayIso(),
    nextVisit: "",
    nextVisitTime: "",
    notes: "",
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");

  // Schedule form state.
  const [scheduleForm, setScheduleForm] = useState({ nextVisit: "", nextVisitTime: "", lastVisit: "", notes: "" });
  const [scheduleErrors, setScheduleErrors] = useState({});

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const rows = useMemo(() => {
    const filtered = scopedTcls.filter((t) => cat === "All" || t.program === cat);
    // TCL rows are enrollment records linked to an EXISTING resident. Resolve
    // the resident from the live registry by residentId so the displayed name,
    // age, sex, and barangay always come from the resident record (the stored
    // snapshot is only a fallback if a resident was removed from the registry).
    return filtered.map((t) => {
      const live = residentOptions.find((r) => r.id === t.residentId);
      return { ...t, resident: live ? { ...live } : { ...t.resident } };
    });
  }, [scopedTcls, cat, residentOptions]);

  const openAdd = () => {
    setForm({
      residentId: "",
      program: "",
      bhw: ACTIVE_BHWS[0] || "",
      priority: "Medium",
      status: "Active",
      lastVisit: todayIso(),
      nextVisit: "",
      nextVisitTime: "",
      notes: "",
    });
    setResidentQuery("");
    setErrors({});
    setSubmitError("");
    setShowAdd(true);
  };

  const closeAdd = () => setShowAdd(false);

  const filteredResidents = residentOptions.filter(
    (r) =>
      r.name.toLowerCase().includes(residentQuery.toLowerCase()) ||
      r.id.toLowerCase().includes(residentQuery.toLowerCase())
  );

  const selectedResident = residentOptions.find((r) => r.id === form.residentId) || null;

  const saveTcl = () => {
    const nextErrors = {};
    if (!form.residentId) nextErrors.resident = "Please select a resident.";
    if (!form.program) nextErrors.program = "Please select a health program.";
    if (!form.bhw) nextErrors.bhw = "Please assign a BHW.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = tclStore.addTcl({
      resident: selectedResident,
      program: form.program,
      bhw: form.bhw,
      priority: form.priority,
      status: form.status,
      lastVisit: form.lastVisit || "",
      nextVisit: form.nextVisit || "",
      nextVisitTime: form.nextVisitTime || "",
      notes: form.notes,
    });
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    setShowAdd(false);
    showToast(`${selectedResident.name} added to ${form.program}.`);
  };

  const saveSchedule = () => {
    const nextErrors = {};
    if (!scheduleForm.nextVisit) nextErrors.nextVisit = "Please set the next visit date.";
    setScheduleErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    tclStore.scheduleVisit(showSchedule, {
      nextVisit: scheduleForm.nextVisit,
      nextVisitTime: scheduleForm.nextVisitTime,
      lastVisit: scheduleForm.lastVisit,
      notes: scheduleForm.notes,
    });
    showToast("Visit schedule saved.");
    setShowSchedule(null);
  };

  const changeStatus = (status) => {
    if (!showView) return;
    tclStore.updateStatus(showView, status);
    showToast(`Status updated to ${status}.`);
  };

  const openSchedule = (tcl) => {
    setScheduleForm({
      nextVisit: tcl.nextVisit || "",
      nextVisitTime: tcl.nextVisitTime || "",
      lastVisit: tcl.lastVisit || "",
      notes: tcl.notes || "",
    });
    setScheduleErrors({});
    setShowSchedule(tcl.id);
  };

  const viewRecord = rows.find((r) => r.id === showView) || null;
  const scheduleRecord = rows.find((r) => r.id === showSchedule) || null;

  const columns = [
    { key: "resident", label: "Resident" },
    { key: "program", label: "Program" },
    { key: "bhw", label: "Assigned BHW" },
    { key: "lastVisit", label: "Last Visit" },
    { key: "nextVisit", label: "Next Visit" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];

  return (
    <>
      <PageHeader
        crumbs={["TCL"]}
        title="Target Client List"
        subtitle={
          scope && scope.level === HS_SCOPE.BARANGAY
            ? `Residents of Barangay ${scope.assignedBarangay} enrolled in community health programs.`
            : "Residents enrolled in community health programs."
        }
        action={
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add TCL
          </button>
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Program filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              cat === c ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-brand-gray border-brand-border hover:border-brand-blue"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        renderCell={(key, row) => {
          if (key === "resident")
            return (
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold shrink-0">
                  {row.resident?.name?.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-brand-ink truncate">{row.resident?.name || "—"}</p>
                  <p className="text-xs text-brand-gray">{row.resident?.barangay || ""}</p>
                </div>
              </div>
            );
          if (key === "program") return <span className="text-brand-ink">{row.program}</span>;
          if (key === "bhw") return <span className="text-brand-gray">{row.bhw || "—"}</span>;
          if (key === "lastVisit") return <span className="text-brand-gray">{formatDate(row.lastVisit)}</span>;
          if (key === "nextVisit")
            return row.nextVisit ? (
              <div>
                <p className="text-brand-ink">{formatDate(row.nextVisit)}</p>
                {row.nextVisitTime && <p className="text-xs text-brand-gray">{row.nextVisitTime}</p>}
              </div>
            ) : (
              <span className="text-brand-gray">—</span>
            );
          if (key === "priority") return <StatusBadge value={row.priority} />;
          if (key === "status") return <StatusBadge value={row.status} />;
          if (key === "actions")
            return (
              <div className="flex gap-3">
                <button onClick={() => setShowView(row.id)} className="text-brand-blue text-sm font-medium hover:underline">View</button>
                <button onClick={() => openSchedule(row)} className="text-brand-green text-sm font-medium hover:underline">Schedule</button>
              </div>
            );
          return row[key];
        }}
      />
      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-brand-gray">
          No target clients found in this program.
        </p>
      )}

      {/* Add TCL */}
      {showAdd && (
        <ModalShell title="Add Target Client" subtitle="Enroll an existing resident into a community health program." onClose={closeAdd}>
          <div className="space-y-4">
            {/* Resident selection */}
            <div>
              <label className={labelCls}>Resident <span className="text-brand-danger">*</span></label>
              <div className="mt-1.5 flex items-center gap-2 bg-white border border-brand-border rounded-btn px-3 py-2.5 focus-within:border-brand-blue">
                <Search className="w-4 h-4 shrink-0 text-brand-gray" />
                <input
                  value={residentQuery}
                  onChange={(e) => setResidentQuery(e.target.value)}
                  placeholder="Search resident by name or ID..."
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
              <p className="mt-1 text-xs text-brand-gray">
                Search the resident directory and select an existing resident. Enrolling them in a
                program does not create or modify a resident record.
              </p>
              {errors.resident && <p className={errorCls}>{errors.resident}</p>}
              {!selectedResident ? (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-btn border border-brand-border divide-y divide-brand-border">
                  {filteredResidents.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setForm({ ...form, residentId: r.id });
                        if (errors.resident) setErrors((p) => ({ ...p, resident: "" }));
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-brand-light transition-colors"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-light text-brand-blue text-xs font-semibold shrink-0">
                        {r.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-brand-ink">{r.name}</span>
                        <span className="block text-xs text-brand-gray">{r.age} yrs · {r.gender} · {r.barangay}</span>
                      </span>
                    </button>
                  ))}
                  {filteredResidents.length === 0 && (
                    <p className="px-3 py-3 text-sm text-brand-gray">No residents found.</p>
                  )}
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-btn border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold shrink-0">
                      {selectedResident.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-brand-ink">{selectedResident.name}</p>
                      <p className="text-xs text-brand-gray">{selectedResident.age} yrs · {selectedResident.gender} · {selectedResident.barangay}</p>
                    </div>
                  </div>
                  <button onClick={() => setForm({ ...form, residentId: "" })} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline">
                    Change
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Health Program <span className="text-brand-danger">*</span></label>
                <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className={`${inputCls(errors.program)} cursor-pointer`}>
                  <option value="">Select program...</option>
                  {TCL_PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {errors.program && <p className={errorCls}>{errors.program}</p>}
              </div>
              <div>
                <label className={labelCls}>Assigned BHW <span className="text-brand-danger">*</span></label>
                <select value={form.bhw} onChange={(e) => setForm({ ...form, bhw: e.target.value })} className={`${inputCls(errors.bhw)} cursor-pointer`}>
                  <option value="">Select BHW...</option>
                  {ACTIVE_BHWS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                {errors.bhw && <p className={errorCls}>{errors.bhw}</p>}
              </div>
              <div>
                <label className={labelCls}>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={`${inputCls()} cursor-pointer`}>
                  {TCL_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={`${inputCls()} cursor-pointer`}>
                  {TCL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Last Visit</label>
                <input type="date" value={form.lastVisit} onChange={(e) => setForm({ ...form, lastVisit: e.target.value })} className={inputCls()} />
              </div>
              <div>
                <label className={labelCls}>Next Visit</label>
                <input type="date" value={form.nextVisit} onChange={(e) => setForm({ ...form, nextVisit: e.target.value })} className={inputCls()} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Notes / Remarks</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls()} resize-none`} />
            </div>

            {submitError && (
              <div className="rounded-btn border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{submitError}</div>
            )}

            <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
              <button onClick={closeAdd} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Cancel</button>
              <button onClick={saveTcl} className="flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
                <Plus className="w-4 h-4" /> Save Target Client
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* View TCL */}
      {showView && viewRecord && (
        <ModalShell
          title={`TCL · ${viewRecord.program}`}
          subtitle={viewRecord.resident?.barangay ? `Barangay ${viewRecord.resident.barangay}` : "Target client details"}
          onClose={() => setShowView(null)}
        >
          <div className="space-y-5">
            {/* Resident information */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident Information</p>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-sm font-semibold">
                  {viewRecord.resident?.name?.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div>
                  <p className="text-base font-semibold text-brand-ink">{viewRecord.resident?.name}</p>
                  <p className="text-xs text-brand-gray">ID: {viewRecord.residentId}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { icon: User, label: "Age", value: viewRecord.resident?.age },
                  { icon: User, label: "Sex", value: viewRecord.resident?.gender || viewRecord.resident?.sex },
                  { icon: MapPin, label: "Barangay", value: viewRecord.resident?.barangay },
                  { icon: Stethoscope, label: "Program", value: viewRecord.program },
                ].map((f) => (
                  <div key={f.label}>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">{f.label}</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">{f.value || "—"}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Program / monitoring info */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">TCL / Monitoring Information</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">Assigned BHW</p>
                  <p className="mt-0.5 text-sm font-medium text-brand-ink">{viewRecord.bhw || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">Priority</p>
                  <div className="mt-1"><StatusBadge value={viewRecord.priority} /></div>
                </div>
                <div>
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">Status</p>
                  <div className="mt-1"><StatusBadge value={viewRecord.status} /></div>
                </div>
                <div>
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">Last Visit</p>
                  <p className="mt-0.5 text-sm font-medium text-brand-ink">{formatDate(viewRecord.lastVisit)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">Next Visit</p>
                  <p className="mt-0.5 text-sm font-medium text-brand-ink">{formatDate(viewRecord.nextVisit)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">Next Visit Time</p>
                  <p className="mt-0.5 text-sm font-medium text-brand-ink">{viewRecord.nextVisitTime || "—"}</p>
                </div>
              </div>
              {viewRecord.notes && (
                <div className="mt-4 rounded-btn bg-brand-bg px-3.5 py-3">
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">Notes / Remarks</p>
                  <p className="mt-0.5 text-sm text-brand-ink">{viewRecord.notes}</p>
                </div>
              )}
            </div>

            {/* Status change */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Change Status</p>
              <div className="flex flex-wrap gap-2">
                {TCL_STATUSES.map((s) => {
                  const active = viewRecord.status === s;
                  return (
                    <button
                      key={s}
                      onClick={() => changeStatus(s)}
                      className={`rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
                        active ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-brand-gray border-brand-border hover:border-brand-blue"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
              <button onClick={() => setShowView(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Close</button>
              <button onClick={() => { setShowView(null); openSchedule(viewRecord); }} className="flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
                <Calendar className="w-4 h-4" /> Schedule Visit
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Schedule next visit */}
      {showSchedule && scheduleRecord && (
        <ModalShell
          title={`Schedule Next Visit · ${scheduleRecord.resident?.name || scheduleRecord.residentId}`}
          subtitle={`${scheduleRecord.program} · Assigned BHW: ${scheduleRecord.bhw || "—"}`}
          onClose={() => setShowSchedule(null)}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Next Visit Date <span className="text-brand-danger">*</span></label>
                <input type="date" value={scheduleForm.nextVisit} onChange={(e) => setScheduleForm({ ...scheduleForm, nextVisit: e.target.value })} className={inputCls(scheduleErrors.nextVisit)} />
                {scheduleErrors.nextVisit && <p className={errorCls}>{scheduleErrors.nextVisit}</p>}
              </div>
              <div>
                <label className={labelCls}>Visit Time</label>
                <input type="time" value={scheduleForm.nextVisitTime} onChange={(e) => setScheduleForm({ ...scheduleForm, nextVisitTime: e.target.value })} className={inputCls()} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Last Visit (update if needed)</label>
              <input type="date" value={scheduleForm.lastVisit} onChange={(e) => setScheduleForm({ ...scheduleForm, lastVisit: e.target.value })} className={inputCls()} />
            </div>
            <div>
              <label className={labelCls}>Visit Notes</label>
              <textarea rows={3} value={scheduleForm.notes} onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })} className={`${inputCls()} resize-none`} />
            </div>
            <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
              <button onClick={() => setShowSchedule(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Cancel</button>
              <button onClick={saveSchedule} className="flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
                <Calendar className="w-4 h-4" /> Save Schedule
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
