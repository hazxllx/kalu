import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import {
  immunizations,
  immunizationSessions,
} from "@/services/local/dashboardData";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { BARANGAYS } from "@/lib/barangays";
import { useResidents, residentStore } from "@/services/local/residentStore";
import { X, Plus, CheckCircle2, Search, Syringe, UserPlus } from "lucide-react";

const formatDate = (iso) => {
  if (!iso || iso === "â€”") return "â€”";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const labelCls = "text-sm font-medium text-brand-ink";
const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

export default function Immunization() {
  const { user } = useAuth();
  const registryResidents = useResidents();
  const [records, setRecords] = useState(immunizations);

  const scope = getSupervisorScope(user);
  const scopedBarangays =
    scope && scope.level === HS_SCOPE.BARANGAY ? [scope.assignedBarangay] : [...BARANGAYS];
  const defaultBarangay = (scope && scope.level === HS_SCOPE.BARANGAY ? scope.assignedBarangay : "") || "";

  // Placeholder row used when a newly added child has no vaccination yet.
  // It makes the child appear in the Immunization list immediately without
  // fabricating an administered dose.
  const monitoringRow = (name) => ({
    child: name,
    vaccine: "Awaiting vaccination",
    status: "Due",
    nextDose: "",
    completed: 0,
  });

  // The immunization roster of children currently being monitored.
  const rosterNames = useMemo(
    () => [...new Set(records.map((r) => r.child))],
    [records]
  );

  // ----- Dynamic summary from the actual immunization records -----
  const summary = useMemo(() => {
    const children = [...new Set(records.map((r) => r.child))];
    const childDue = new Set();
    const childMissed = new Set();
    records.forEach((r) => {
      if (r.status === "Due") {
        childDue.add(r.child);
      } else if (r.status === "Missed") {
        childMissed.add(r.child);
      }
    });
    const childrenWithCompletion = new Set(
      records.filter((r) => r.status === "Completed").map((r) => r.child)
    );
    const coverage = children.length ? Math.round((childrenWithCompletion.size / children.length) * 100) : 0;
    return {
      dueCount: childDue.size,
      missedCount: childMissed.size,
      sessions: immunizationSessions.filter((s) => s.status === "Upcoming").length,
      coverage,
      childrenWithCompletion: childrenWithCompletion.size,
      childrenTotal: children.length,
    };
  }, [records]);

  // ----- View state: table filter / sessions / coverage -----
  const [filter, setFilter] = useState("all"); // "all" | "due" | "missed"
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [detailChild, setDetailChild] = useState(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Record-vaccination modal state.
  const [recordForm, setRecordForm] = useState({ childQuery: "", child: "", vaccine: "", date: todayIso() });
  const [recordErrors, setRecordErrors] = useState({});

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const recordChildOptions = useMemo(() => {
    const q = recordForm.childQuery.trim().toLowerCase();
    const children = rosterNames.slice().sort((a, b) => a.localeCompare(b));
    return children.filter((c) => !q || c.toLowerCase().includes(q));
  }, [rosterNames, recordForm.childQuery]);

  const recordSelectedChild = recordForm.child;
  const childVaccines = useMemo(
    () =>
      recordSelectedChild
        ? [...new Set(records.filter((r) => r.child === recordSelectedChild).map((r) => r.vaccine))]
        : [],
    [records, recordSelectedChild]
  );

  const openRecord = () => {
    setRecordForm({ childQuery: "", child: "", vaccine: "", date: todayIso() });
    setRecordErrors({});
    setRecordOpen(true);
  };

  const saveRecord = () => {
    const nextErrors = {};
    if (!recordForm.child) nextErrors.child = "Please select an existing child.";
    if (!recordForm.vaccine.trim()) nextErrors.vaccine = "Please enter the vaccine name.";
    if (!recordForm.date) nextErrors.date = "Please enter the vaccination date.";
    setRecordErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const vaccine = recordForm.vaccine.trim();
    setRecords((prev) => {
      const hasVaccineRow = prev.some(
        (r) => r.child === recordForm.child && r.vaccine.toLowerCase() === vaccine.toLowerCase()
      );
      const hasPlaceholder = prev.some(
        (r) => r.child === recordForm.child && r.vaccine === "Awaiting vaccination"
      );
      if (hasVaccineRow) {
        // Mark the scheduled dose as given for an existing child/vaccine row.
        return prev.map((r) =>
          r.child === recordForm.child && r.vaccine.toLowerCase() === vaccine.toLowerCase()
            ? { ...r, status: "Completed", nextDose: "â€”" }
            : r
        );
      }
      // Replace the "awaiting vaccination" monitoring row (or append) with the
      // completed vaccination the child just received.
      return prev
        .map((r) =>
          hasPlaceholder && r.child === recordForm.child && r.vaccine === "Awaiting vaccination"
            ? { child: r.child, vaccine, status: "Completed", nextDose: "â€”", completed: 1 }
            : r
        )
        .concat(
          hasPlaceholder
            ? []
            : [{ child: recordForm.child, vaccine, status: "Completed", nextDose: "â€”", completed: 1 }]
        );
    });
    setRecordOpen(false);
    showToast(`Vaccination recorded for ${recordForm.child}.`);
  };

  // ----- Add Child (register a child for immunization monitoring) -----
  const [addOpen, setAddOpen] = useState(false);
  const emptyAdd = { firstName: "", lastName: "", dob: "", sex: "Female", barangay: defaultBarangay, contact: "", notes: "" };
  const [addForm, setAddForm] = useState(emptyAdd);
  const [addErrors, setAddErrors] = useState({});

  const ageFromDob = (dob) => {
    if (!dob) return "";
    const b = new Date(dob);
    if (Number.isNaN(b.getTime())) return "";
    let age = new Date().getFullYear() - b.getFullYear();
    const m = new Date().getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && new Date().getDate() < b.getDate())) age -= 1;
    return age >= 0 ? String(age) : "";
  };

  const fullName = () => `${addForm.firstName.trim()} ${addForm.lastName.trim()}`.replace(/\s+/g, " ").trim();

  // Live duplicate detection against the resident registry: if the child is
  // already a resident, we must NOT create a second resident record.
  const existingResidentMatch = useMemo(() => {
    const name = fullName().toLowerCase();
    if (!name) return null;
    return registryResidents.find((r) => r.name.toLowerCase() === name) || null;
  }, [addForm.firstName, addForm.lastName, registryResidents]);

  const openAdd = () => {
    setAddForm({ ...emptyAdd, barangay: defaultBarangay });
    setAddErrors({});
    setAddOpen(true);
  };

  const saveAdd = () => {
    const nextErrors = {};
    if (!addForm.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!addForm.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!addForm.dob) nextErrors.dob = "Date of birth is required.";
    if (!addForm.barangay) nextErrors.barangay = "Barangay is required.";
    setAddErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const name = fullName();
    if (rosterNames.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setAddErrors({ form: `${name} is already on the immunization monitoring list.` });
      return;
    }

    // Reuse the resident registry: if the child already exists there, do not
    // create a duplicate resident â€” only add them to immunization monitoring.
    let resident = existingResidentMatch;
    let createdResident = false;
    if (!resident) {
      const created = residentStore.addResident({
        firstName: addForm.firstName.trim(),
        middleName: "",
        lastName: addForm.lastName.trim(),
        suffix: "",
        dob: addForm.dob,
        age: ageFromDob(addForm.dob),
        gender: addForm.sex,
        contact: addForm.contact.trim(),
        purok: "",
        street: "",
        houseNo: "",
        barangay: addForm.barangay,
        civilStatus: "",
        program: "Child Health",
        risk: "",
        status: "Active",
      });
      if (created && created.id) {
        resident = created;
        createdResident = true;
      }
    }

    const label = resident?.name || name;
    setRecords((prev) => [monitoringRow(label), ...prev]);
    setAddOpen(false);
    showToast(
      createdResident
        ? `${label} registered as a child and added to immunization monitoring.`
        : `${label} added to immunization monitoring (existing resident).`
    );
  };

  const visibleRows = useMemo(() => {
    if (filter === "due") return records.filter((r) => r.status === "Due");
    if (filter === "missed") return records.filter((r) => r.status === "Missed");
    return records;
  }, [records, filter]);

  const filterLabel =
    filter === "due"
      ? "Showing children due for vaccination"
      : filter === "missed"
        ? "Showing children with missed vaccinations"
        : "All immunization records";

  const showSessions = sessionsOpen;
  const showCoverage = coverageOpen;

  const childHistory = useMemo(
    () => records.filter((r) => r.child === detailChild),
    [records, detailChild]
  );

  const childColumns = [
    { key: "child", label: "Child" },
    { key: "vaccine", label: "Vaccine" },
    { key: "completed", label: "Completed Doses" },
    { key: "nextDose", label: "Next Dose" },
    { key: "status", label: "Status" },
    { key: "actions", label: "Action" },
  ];

  const stats = [
    {
      icon: "Syringe",
      label: "Children Due",
      value: summary.dueCount,
      tone: "accent",
      onClick: () => {
        setFilter((f) => (f === "due" ? "all" : "due"));
        setSessionsOpen(false);
        setCoverageOpen(false);
      },
    },
    {
      icon: "CalendarCheck",
      label: "Upcoming Sessions",
      value: summary.sessions,
      tone: "blue",
      onClick: () => {
        setSessionsOpen((v) => !v);
        setCoverageOpen(false);
      },
    },
    {
      icon: "AlertTriangle",
      label: "Missed Vaccinations",
      value: summary.missedCount,
      tone: "danger",
      onClick: () => {
        setFilter((f) => (f === "missed" ? "all" : "missed"));
        setSessionsOpen(false);
        setCoverageOpen(false);
      },
    },
    {
      icon: "Activity",
      label: "Coverage Rate",
      value: `${summary.coverage}%`,
      tone: "green",
      onClick: () => {
        setCoverageOpen((v) => !v);
        setSessionsOpen(false);
      },
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={["Immunization"]}
        title="Immunization"
        subtitle="Vaccination schedules, coverage, and resident history."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openAdd}
              className="flex items-center gap-2 border border-brand-blue bg-white text-brand-blue px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-light transition-colors"
            >
              <UserPlus className="w-4 h-4" /> Add Child
            </button>
            <button
              onClick={openRecord}
              className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <Syringe className="w-4 h-4" /> Record Vaccination
            </button>
          </div>
        }
      />

      {/* Summary cards (clickable) */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {stats.map((s, i) => (
          <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} tone={s.tone} index={i} onClick={s.onClick} />
        ))}
      </div>

      {/* Upcoming sessions panel */}
      {showSessions && (
        <Card className="p-5 mb-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-brand-ink">Upcoming Immunization Sessions</h3>
              <p className="text-xs text-brand-gray mt-0.5">Scheduled community vaccination sessions.</p>
            </div>
            <button onClick={() => setSessionsOpen(false)} className="flex items-center gap-1 text-xs font-medium text-brand-gray hover:text-brand-ink">
              <X className="w-3.5 h-3.5" /> Close
            </button>
          </div>
          <div className="overflow-x-auto rounded-btn border border-brand-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-bg text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Date</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Time</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Venue</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Vaccines</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {immunizationSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-medium text-brand-ink">{formatDate(s.date)}</td>
                    <td className="px-4 py-2.5 text-brand-gray">{s.time}</td>
                    <td className="px-4 py-2.5 text-brand-gray">{s.venue}</td>
                    <td className="px-4 py-2.5 text-brand-ink">{s.vaccines}</td>
                    <td className="px-4 py-2.5"><StatusBadge value={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Coverage panel */}
      {showCoverage && (
        <Card className="p-5 mb-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-brand-ink">Immunization Coverage</h3>
              <p className="text-xs text-brand-gray mt-0.5">
                Children who have completed at least one routine vaccination dose.
              </p>
            </div>
            <button onClick={() => setCoverageOpen(false)} className="flex items-center gap-1 text-xs font-medium text-brand-gray hover:text-brand-ink">
              <X className="w-3.5 h-3.5" /> Close
            </button>
          </div>
          <div className="rounded-btn border border-brand-border bg-brand-bg/50 p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-sm text-brand-gray">Coverage across {summary.childrenTotal} children</span>
              <span className="text-xl font-stat font-bold text-brand-green">{summary.coverage}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-green transition-all"
                style={{ width: `${summary.coverage}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-brand-gray">
              {summary.childrenWithCompletion} of {summary.childrenTotal} children have a completed vaccination
              record; the remaining children have due or missed doses scheduled for catch-up.
            </p>
          </div>
        </Card>
      )}

      {/* Records table */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-brand-gray">{filterLabel}</p>
        {filter !== "all" && (
          <button onClick={() => setFilter("all")} className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline">
            <X className="w-3.5 h-3.5" /> Clear filter
          </button>
        )}
      </div>
      <DataTable
        columns={childColumns}
        rows={visibleRows}
        renderCell={(key, row) => {
          if (key === "child") return <span className="text-brand-ink">{row.child}</span>;
          if (key === "vaccine") return <span className="text-brand-ink">{row.vaccine}</span>;
          if (key === "completed") return <span className="text-brand-gray">{row.completed}</span>;
          if (key === "nextDose") return <span className="text-brand-gray">{formatDate(row.nextDose)}</span>;
          if (key === "status") return <StatusBadge value={row.status} />;
          if (key === "actions")
            return (
              <button
                type="button"
                onClick={() => setDetailChild(row.child)}
                className="rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue hover:bg-brand-light transition-colors"
              >
                View History
              </button>
            );
          return row[key];
        }}
      />

      {/* Child vaccination history modal */}
      {detailChild && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{detailChild}</h3>
                  <p className="text-sm text-brand-gray mt-0.5">Vaccination history and schedule</p>
                </div>
                <button onClick={() => setDetailChild(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                {childHistory.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-brand-bg text-left">
                          <th className="px-3 py-2 text-xs font-semibold text-brand-gray uppercase tracking-wide">Vaccine</th>
                          <th className="px-3 py-2 text-xs font-semibold text-brand-gray uppercase tracking-wide">Completed Doses</th>
                          <th className="px-3 py-2 text-xs font-semibold text-brand-gray uppercase tracking-wide">Next Dose</th>
                          <th className="px-3 py-2 text-xs font-semibold text-brand-gray uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-border">
                        {childHistory.map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2.5 font-medium text-brand-ink">{r.vaccine}</td>
                            <td className="px-3 py-2.5 text-brand-gray">{r.completed}</td>
                            <td className="px-3 py-2.5 text-brand-gray">{formatDate(r.nextDose)}</td>
                            <td className="px-3 py-2.5"><StatusBadge value={r.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-brand-gray">No vaccination records for this child.</p>
                )}
              </div>

              <div className="mt-5 flex justify-end gap-3 border-t border-brand-border pt-4">
                <button onClick={() => setDetailChild(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                  Close
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Add Child modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Add Child</h3>
                  <p className="text-sm text-brand-gray mt-0.5">
                    Register a child for immunization monitoring. If the child is already in the
                    resident registry, no duplicate resident record is created.
                  </p>
                </div>
                <button onClick={() => setAddOpen(false)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>First Name <span className="text-brand-danger">*</span></label>
                    <input type="text" value={addForm.firstName} onChange={(e) => setAddForm({ ...addForm, firstName: e.target.value })} placeholder="e.g. Mateo" className={inputCls(addErrors.firstName)} />
                    {addErrors.firstName && <p className="mt-1 text-xs text-brand-danger">{addErrors.firstName}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Last Name <span className="text-brand-danger">*</span></label>
                    <input type="text" value={addForm.lastName} onChange={(e) => setAddForm({ ...addForm, lastName: e.target.value })} placeholder="e.g. Santos" className={inputCls(addErrors.lastName)} />
                    {addErrors.lastName && <p className="mt-1 text-xs text-brand-danger">{addErrors.lastName}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Date of Birth <span className="text-brand-danger">*</span></label>
                    <input type="date" value={addForm.dob} onChange={(e) => setAddForm({ ...addForm, dob: e.target.value })} className={inputCls(addErrors.dob)} />
                    {addErrors.dob && <p className="mt-1 text-xs text-brand-danger">{addErrors.dob}</p>}
                    {addForm.dob && <p className="mt-1 text-xs text-brand-gray">Age: {ageFromDob(addForm.dob) || "â€”"} years</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Sex <span className="text-brand-danger">*</span></label>
                    <select value={addForm.sex} onChange={(e) => setAddForm({ ...addForm, sex: e.target.value })} className={`${inputCls()} cursor-pointer`}>
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Barangay <span className="text-brand-danger">*</span></label>
                  <select value={addForm.barangay} onChange={(e) => setAddForm({ ...addForm, barangay: e.target.value })} className={`${inputCls(addErrors.barangay)} cursor-pointer`}>
                    {scopedBarangays.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  {addErrors.barangay && <p className="mt-1 text-xs text-brand-danger">{addErrors.barangay}</p>}
                </div>
                <div>
                  <label className={labelCls}>Guardian Contact Number</label>
                  <input type="text" value={addForm.contact} onChange={(e) => setAddForm({ ...addForm, contact: e.target.value })} placeholder="e.g. 0917 123 4567" className={inputCls()} />
                </div>

                {existingResidentMatch ? (
                  <div className="flex items-start gap-2 rounded-btn border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-sm text-emerald-800">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {existingResidentMatch.name} is already in the Resident Registry ({existingResidentMatch.id}). They
                      will be added to immunization monitoring without creating a duplicate resident record.
                    </span>
                  </div>
                ) : (
                  fullName().length > 0 && (
                    <div className="flex items-start gap-2 rounded-btn border border-brand-border bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray">
                      <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {fullName()} is not in the Resident Registry. A child resident record will be created, then they
                        will be added to immunization monitoring.
                      </span>
                    </div>
                  )
                )}

                {addErrors.form && (
                  <div className="rounded-btn border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{addErrors.form}</div>
                )}

                <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
                  <button onClick={() => setAddOpen(false)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                    Cancel
                  </button>
                  <button onClick={saveAdd} className="flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
                    <Plus className="w-4 h-4" /> Add Child
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Record Vaccination modal */}
      {recordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Record Vaccination</h3>
                  <p className="text-sm text-brand-gray mt-0.5">Record a dose given to an existing child.</p>
                </div>
                <button onClick={() => setRecordOpen(false)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                {/* Child selection (existing children only) */}
                <div>
                  <label className={labelCls}>Child <span className="text-brand-danger">*</span></label>
                  <div className="mt-1.5 flex items-center gap-2 bg-white border border-brand-border rounded-btn px-3 py-2.5 focus-within:border-brand-blue">
                    <Search className="w-4 h-4 shrink-0 text-brand-gray" />
                    <input
                      value={recordForm.childQuery}
                      onChange={(e) => setRecordForm({ ...recordForm, childQuery: e.target.value })}
                      placeholder="Search child..."
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>
                  {!recordSelectedChild ? (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-btn border border-brand-border divide-y divide-brand-border">
                      {recordChildOptions.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setRecordForm({ ...recordForm, child: c, childQuery: "" })}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-brand-light transition-colors"
                        >
                          <span className="text-sm font-medium text-brand-ink">{c}</span>
                        </button>
                      ))}
                      {recordChildOptions.length === 0 && (
                        <p className="px-3 py-3 text-sm text-brand-gray">No children found.</p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-btn border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
                      <p className="text-sm font-semibold text-brand-ink">{recordSelectedChild}</p>
                      <button onClick={() => setRecordForm((f) => ({ ...f, child: "", vaccine: "" }))} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline">
                        Change
                      </button>
                    </div>
                  )}
                  {recordErrors.child && <p className="mt-1 text-xs text-brand-danger">{recordErrors.child}</p>}
                </div>

                {/* Vaccine */}
                <div>
                  <label className={labelCls}>Vaccine <span className="text-brand-danger">*</span></label>
                  {childVaccines.length > 0 && !recordForm.vaccine && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {childVaccines.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setRecordForm({ ...recordForm, vaccine: v })}
                          className="rounded-full border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue transition-colors"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={recordForm.vaccine}
                    onChange={(e) => setRecordForm({ ...recordForm, vaccine: e.target.value })}
                    placeholder="e.g. Pentavalent (4th)"
                    className={inputCls(recordErrors.vaccine)}
                  />
                  {recordErrors.vaccine && <p className="mt-1 text-xs text-brand-danger">{recordErrors.vaccine}</p>}
                </div>

                {/* Date */}
                <div>
                  <label className={labelCls}>Vaccination Date <span className="text-brand-danger">*</span></label>
                  <input type="date" value={recordForm.date} onChange={(e) => setRecordForm({ ...recordForm, date: e.target.value })} className={inputCls(recordErrors.date)} />
                  {recordErrors.date && <p className="mt-1 text-xs text-brand-danger">{recordErrors.date}</p>}
                </div>

                <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
                  <button onClick={() => setRecordOpen(false)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                    Cancel
                  </button>
                  <button onClick={saveRecord} className="flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
                    <Syringe className="w-4 h-4" /> Save Vaccination
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink text-white px-4 py-3 shadow-lg animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}
