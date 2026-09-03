import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import TimePicker from "@/components/common/TimePicker";
import { Search, Plus, Calendar, MapPin, User, X, CheckCircle2 } from "lucide-react";
import { residents, systemUsers } from "@/services/mock/mockData";
import { ROLES } from "@/lib/brand";
import { useAuth } from "@/context/AuthContext";

const FOLLOW_UP_TYPES = [
  "General Check-up",
  "Maternal Follow-up",
  "Child Health Follow-up",
  "Chronic Disease Follow-up",
  "Medication Follow-up",
  "Post-Consultation Follow-up",
  "Other",
];

const FOLLOW_UP_LOCATIONS = ["Barangay Health Station", "RHU", "Home Visit", "Other"];

const PERSONNEL_OPTIONS = systemUsers
  .filter((u) => u.status === "Active" && ["Midwife", "Health Supervisor", "BHW"].includes(u.role))
  .map((u) => u.name);

const emptyScheduleForm = (personnel) => ({
  date: new Date().toISOString().slice(0, 10),
  time: "09:00",
  type: "General Check-up",
  reason: "",
  location: "Barangay Health Station",
  priority: "Medium",
  notes: "",
  personnel: personnel || "",
});

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
    error ? "border-red-400 bg-red-50/40" : "border-brand-border"
  }`;

const formatDate = (isoDate) => {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const formatDateLong = (isoDate) => {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};

const isPastDate = (isoDate) => {
  if (!isoDate) return false;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const formatTime = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":");
  if (!h || m === undefined) return "";
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return "";
  const ampm = hour >= 12 ? "PM" : "AM";
  const hr12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hr12}:${m} ${ampm}`;
};

/**
 * New follow-ups are saved as Scheduled — never Completed. They surface
 * under "Today" or "Upcoming" depending on the scheduled date.
 */
const deriveStatus = (isoDate) => {
  if (!isoDate) return "Scheduled";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Scheduled";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() > today.getTime()) return "Upcoming";
  return "Scheduled";
};

const FOLLOW_UPS = [
  {
    id: 1,
    resident: "Ana Villanueva",
    age: 32,
    sex: "Female",
    barangay: "San Jose",
    contact: "0917 123 4567",
    purpose: "Prenatal Check-up",
    assignedMidwife: "Maria Dela Cruz",
    scheduledDate: "July 12, 2026",
    scheduledTime: "9:00 AM",
    location: "Barangay Health Station",
    priority: "High",
    status: "Scheduled",
    remarks: "",
  },
  {
    id: 2,
    resident: "Maria Santos",
    age: 28,
    sex: "Female",
    barangay: "San Jose",
    contact: "0918 234 5678",
    purpose: "Postnatal Check-up",
    assignedMidwife: "Maria Dela Cruz",
    scheduledDate: "July 13, 2026",
    scheduledTime: "10:00 AM",
    location: "Home Visit",
    priority: "High",
    status: "Today",
    remarks: "",
  },
  {
    id: 3,
    resident: "Elena Garcia",
    age: 25,
    sex: "Female",
    barangay: "San Jose",
    contact: "0919 345 6789",
    purpose: "Immunization Follow-up",
    assignedMidwife: "Maria Dela Cruz",
    scheduledDate: "July 8, 2026",
    scheduledTime: "2:00 PM",
    location: "Barangay Health Station",
    priority: "Medium",
    status: "Completed",
    remarks: "Blood pressure improving. Medication completed.",
  },
  {
    id: 4,
    resident: "Carmen Reyes",
    age: 30,
    sex: "Female",
    barangay: "San Jose",
    contact: "0920 456 7890",
    purpose: "High-Risk Pregnancy Monitoring",
    assignedMidwife: "Grace Aquino",
    scheduledDate: "July 15, 2026",
    scheduledTime: "11:00 AM",
    location: "Barangay Health Station",
    priority: "High",
    status: "Upcoming",
    remarks: "",
  },
  {
    id: 5,
    resident: "Lourdes Mendoza",
    age: 35,
    sex: "Female",
    barangay: "San Jose",
    contact: "0921 567 8901",
    purpose: "Tetanus Toxoid Booster",
    assignedMidwife: "Grace Aquino",
    scheduledDate: "July 10, 2026",
    scheduledTime: "3:00 PM",
    location: "Barangay Health Station",
    priority: "Low",
    status: "Missed",
    remarks: "Resident unavailable during visit.",
  },
];

const STATUS_COLORS = {
  Scheduled: "bg-brand-blue/10 text-brand-blue",
  Today: "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-brand-green/10 text-brand-green",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Upcoming: "bg-brand-gray/10 text-brand-gray",
  Ongoing: "bg-brand-purple/10 text-brand-purple",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
};

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

export default function MidwifeFollowUp() {
  const { user } = useAuth();
  const [followUps, setFollowUps] = useState(FOLLOW_UPS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showRecordVisitModal, setShowRecordVisitModal] = useState(false);
  const [showUpdateStatusModal, setShowUpdateStatusModal] = useState(false);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [selectedResident, setSelectedResident] = useState(null);
  const [scheduleForm, setScheduleForm] = useState(() => emptyScheduleForm(""));
  const [touched, setTouched] = useState({});
  const [toast, setToast] = useState(null);

  // Auto-assign the logged-in user where possible — the dashboard shell
  // displays the role's display name, so prefer that for consistency.
  const currentUserName =
    (user?.role && ROLES[user.role] && ROLES[user.role].name) || user?.name || "";
  const personnelOptions =
    currentUserName && !PERSONNEL_OPTIONS.includes(currentUserName)
      ? [currentUserName, ...PERSONNEL_OPTIONS]
      : PERSONNEL_OPTIONS;
  const defaultPersonnel = currentUserName || PERSONNEL_OPTIONS[0] || "";

  // Escape closes the modal; lock background scrolling while it is open.
  useEffect(() => {
    if (!showScheduleModal) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setShowScheduleModal(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [showScheduleModal]);

  const stats = {
    total: followUps.length,
    today: followUps.filter((f) => f.status === "Today").length,
    upcoming: followUps.filter((f) => f.status === "Upcoming").length,
    completed: followUps.filter((f) => f.status === "Completed").length,
  };

  const filteredFollowUps = followUps.filter((f) => {
    const matchesSearch = searchQuery === "" || f.resident.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || f.status === statusFilter;
    const matchesPriority = priorityFilter === "All" || f.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const handleView = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowDetailPanel(true);
  };

  const handleRecordVisit = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowRecordVisitModal(true);
  };

  const handleUpdateStatus = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowUpdateStatusModal(true);
  };

  const handleAddRemarks = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowRemarksModal(true);
  };

  const handleCompleteFollowUp = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowCompleteConfirm(true);
  };

  const confirmComplete = () => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, status: "Completed" } : f))
    );
    setShowCompleteConfirm(false);
    setSelectedFollowUp(null);
    alert("Follow-up marked as completed!");
  };

  const handleStatusUpdate = (newStatus) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, status: newStatus } : f))
    );
    setShowUpdateStatusModal(false);
    setSelectedFollowUp(null);
    alert(`Status updated to ${newStatus}`);
  };

  const handleSaveRemarks = (remarks) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, remarks: remarks } : f))
    );
    setShowRemarksModal(false);
    setSelectedFollowUp(null);
    alert("Remarks saved successfully!");
  };

  const handleSaveVisit = (visitData) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, ...visitData, status: "Completed" } : f))
    );
    setShowRecordVisitModal(false);
    setSelectedFollowUp(null);
    alert("Visit recorded successfully!");
  };

  const openScheduleModal = () => {
    setSelectedResident(null);
    setTouched({});
    setScheduleForm(emptyScheduleForm(defaultPersonnel));
    setShowScheduleModal(true);
  };

  // Inline validation — fields are flagged once touched, not on every keystroke.
  const scheduleErrors = {
    resident: touched.resident && !selectedResident ? "Please select a resident." : "",
    date: !scheduleForm.date
      ? touched.date
        ? "Please select a follow-up date."
        : ""
      : isPastDate(scheduleForm.date)
        ? "Please select today or a future date."
        : "",
    time: touched.time && !scheduleForm.time ? "Please select a follow-up time." : "",
    reason: touched.reason && !scheduleForm.reason.trim() ? "Please enter the reason for the follow-up." : "",
  };

  const canSchedule =
    Boolean(selectedResident) &&
    Boolean(scheduleForm.date) &&
    !isPastDate(scheduleForm.date) &&
    Boolean(scheduleForm.time) &&
    Boolean(scheduleForm.reason.trim());

  const handleSchedule = () => {
    // Backstop — the primary button is disabled until the form is complete.
    if (!canSchedule) {
      setTouched({ resident: true, date: true, time: true, reason: true });
      return;
    }

    const newFollowUp = {
      id: followUps.reduce((acc, f) => Math.max(acc, f.id || 0), 0) + 1,
      resident: selectedResident.name,
      residentId: selectedResident.id,
      age: selectedResident.age,
      sex: selectedResident.gender,
      barangay: selectedResident.barangay,
      contact: "",
      purpose: scheduleForm.reason.trim(),
      type: scheduleForm.type,
      assignedMidwife: scheduleForm.personnel || defaultPersonnel,
      scheduledDate: formatDate(scheduleForm.date),
      scheduledTime: formatTime(scheduleForm.time),
      location: scheduleForm.location,
      priority: scheduleForm.priority,
      status: deriveStatus(scheduleForm.date),
      remarks: scheduleForm.notes.trim(),
    };
    setFollowUps([newFollowUp, ...followUps]);
    setShowScheduleModal(false);
    setToast(`Follow-up scheduled successfully for ${newFollowUp.resident} on ${newFollowUp.scheduledDate}.`);
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Follow-ups"]}
        title="Follow-up Management"
        subtitle="Manage scheduled follow-up visits and monitor resident outcomes."
        action={
          <button
            onClick={openScheduleModal}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Schedule Follow-up
          </button>
        }
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Follow-ups", value: stats.total, subtitle: "Active follow-up records" },
          { label: "Today's Follow-ups", value: stats.today, subtitle: "Scheduled for today" },
          { label: "Upcoming", value: stats.upcoming, subtitle: "Next within 7 days" },
          { label: "Completed", value: stats.completed, subtitle: "Finished this week" },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="text-sm text-brand-gray">{stat.label}</p>
            <p className="text-2xl font-semibold text-brand-blue mt-1">{stat.value}</p>
            <p className="text-xs text-brand-gray mt-1">{stat.subtitle}</p>
          </Card>
        ))}
      </div>

      {/* Search & Filters */}
      <Card className="p-4 mb-5">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1 max-w-md">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resident..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              {["All", "Today", "Upcoming", "Completed", "Missed"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-btn text-sm font-medium transition-colors ${
                    statusFilter === status
                      ? "bg-brand-blue text-white"
                      : "text-brand-gray hover:bg-brand-bg"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Priorities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Follow-up Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Resident Name</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Purpose</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Assigned Midwife</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Scheduled Date</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Location</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Priority</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFollowUps.map((f) => (
                <tr key={f.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-semibold">
                        {f.resident.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-brand-ink">{f.resident}</p>
                        <p className="text-xs text-brand-gray">{f.barangay}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{f.purpose}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{f.assignedMidwife}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-brand-ink">{f.scheduledDate}</div>
                    <div className="text-xs text-brand-gray">{f.scheduledTime}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-brand-gray" />
                    {f.location}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[f.priority]}`}>
                      {f.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[f.status]}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleView(f)}
                        className="text-sm font-medium text-brand-blue hover:underline"
                      >
                        View
                      </button>
                      {f.status !== "Completed" && (
                        <>
                          <button
                            onClick={() => handleRecordVisit(f)}
                            className="text-sm font-medium text-brand-blue hover:underline"
                          >
                            Record Visit
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(f)}
                            className="text-sm font-medium text-brand-blue hover:underline"
                          >
                            Update Status
                          </button>
                          <button
                            onClick={() => handleAddRemarks(f)}
                            className="text-sm font-medium text-brand-blue hover:underline"
                          >
                            Add Remarks
                          </button>
                          <button
                            onClick={() => handleCompleteFollowUp(f)}
                            className="text-sm font-medium text-brand-green hover:underline"
                          >
                            Complete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Schedule Follow-up Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Schedule Follow-up"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden"
          >
            {/* Fixed header */}
            <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light">
                  <Calendar className="h-5 w-5 text-brand-blue" strokeWidth={1.8} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Schedule Follow-up</h3>
                  <p className="text-xs text-brand-gray">Book the next follow-up visit for a resident</p>
                </div>
              </div>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable form body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-5">
                {/* RESIDENT */}
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Resident</p>
                  <div onBlur={() => setTouched((t) => ({ ...t, resident: true }))}>
                    <ResidentSearchSelect
                      residents={residents}
                      value={selectedResident}
                      onChange={setSelectedResident}
                    />
                  </div>
                  {scheduleErrors.resident && (
                    <p className="mt-1.5 text-xs text-red-600">{scheduleErrors.resident}</p>
                  )}
                  {selectedResident && (
                    <div className="mt-3 flex items-center gap-3 rounded-btn border border-brand-border bg-brand-bg px-3.5 py-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue text-xs font-semibold text-white">
                        {selectedResident.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-brand-ink">{selectedResident.name}</p>
                        <p className="text-xs text-brand-gray">
                          {selectedResident.id} · {selectedResident.age} yrs · {selectedResident.gender} ·{" "}
                          {selectedResident.barangay}
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                {/* FOLLOW-UP DETAILS */}
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Follow-up Details</p>
                  <div className="space-y-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                          Follow-up Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          min={todayISO()}
                          value={scheduleForm.date}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                          onBlur={() => setTouched((t) => ({ ...t, date: true }))}
                          className={inputCls(scheduleErrors.date)}
                        />
                        {scheduleErrors.date ? (
                          <p className="mt-1 text-xs text-red-600">{scheduleErrors.date}</p>
                        ) : (
                          scheduleForm.date && (
                            <p className="mt-1 text-xs text-brand-gray">{formatDateLong(scheduleForm.date)}</p>
                          )
                        )}
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                          Follow-up Time <span className="text-red-500">*</span>
                        </label>
                        <TimePicker
                          value={scheduleForm.time}
                          onChange={(time) => setScheduleForm({ ...scheduleForm, time })}
                          error={Boolean(scheduleErrors.time)}
                        />
                        {scheduleErrors.time && (
                          <p className="mt-1 text-xs text-red-600">{scheduleErrors.time}</p>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-brand-ink">Follow-up Type</label>
                        <select
                          value={scheduleForm.type}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                          className={`${inputCls()} cursor-pointer`}
                        >
                          {FOLLOW_UP_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-brand-ink">Priority</label>
                        <select
                          value={scheduleForm.priority}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, priority: e.target.value })}
                          className={`${inputCls()} cursor-pointer`}
                        >
                          <option>High</option>
                          <option>Medium</option>
                          <option>Low</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                        Reason / Purpose <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Routine BP monitoring, post-consultation follow-up..."
                        value={scheduleForm.reason}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, reason: e.target.value })}
                        onBlur={() => setTouched((t) => ({ ...t, reason: true }))}
                        className={inputCls(scheduleErrors.reason)}
                      />
                      {scheduleErrors.reason && (
                        <p className="mt-1 text-xs text-red-600">{scheduleErrors.reason}</p>
                      )}
                    </div>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-brand-ink">Location</label>
                        <select
                          value={scheduleForm.location}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, location: e.target.value })}
                          className={`${inputCls()} cursor-pointer`}
                        >
                          {FOLLOW_UP_LOCATIONS.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-brand-ink">Assigned Personnel</label>
                        <select
                          value={scheduleForm.personnel}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, personnel: e.target.value })}
                          className={`${inputCls()} cursor-pointer`}
                        >
                          {personnelOptions.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-brand-gray">Auto-assigned to you — change if needed.</p>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-brand-ink">Notes / Instructions</label>
                      <textarea
                        rows={3}
                        placeholder="Add any instructions or additional information..."
                        value={scheduleForm.notes}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })}
                        className={`${inputCls()} resize-none`}
                      />
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* Status hint strip */}
            <div className="shrink-0 border-t border-brand-border bg-brand-bg/60 px-6 py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-xs text-brand-gray">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    STATUS_COLORS[deriveStatus(scheduleForm.date)]
                  }`}
                >
                  {deriveStatus(scheduleForm.date)}
                </span>
                <span>
                  Follow-ups are saved as Scheduled — appearing under Today or Upcoming based on the date.
                </span>
              </p>
            </div>

            {/* Fixed footer */}
            <div className="flex shrink-0 justify-end gap-3 bg-white px-6 py-4">
              <button
                onClick={() => setShowScheduleModal(false)}
                className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={!canSchedule}
                className={`px-4 py-2 rounded-btn text-sm font-medium transition-colors ${
                  canSchedule
                    ? "bg-brand-blue text-white hover:bg-brand-dark"
                    : "cursor-not-allowed bg-brand-blue/50 text-white"
                }`}
              >
                Schedule Follow-up
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Detail Panel */}
      {showDetailPanel && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-brand-ink">Follow-up Details</h3>
                <button
                  onClick={() => setShowDetailPanel(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-semibold">
                    {selectedFollowUp.resident.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-ink">{selectedFollowUp.resident}</p>
                    <p className="text-xs text-brand-gray">{selectedFollowUp.sex} • {selectedFollowUp.age} years old</p>
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <p className="text-brand-gray">Barangay {selectedFollowUp.barangay}</p>
                  <p className="text-brand-gray">{selectedFollowUp.contact}</p>
                </div>
              </div>

              <div className="mb-4 space-y-3">
                {selectedFollowUp.type && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Follow-up Type</p>
                    <p className="text-sm font-medium text-brand-ink">{selectedFollowUp.type}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-brand-gray mb-1">Purpose</p>
                  <p className="text-sm font-medium text-brand-ink">{selectedFollowUp.purpose}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-brand-gray" />
                  <p className="text-sm text-brand-ink">{selectedFollowUp.scheduledDate} • {selectedFollowUp.scheduledTime}</p>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-brand-gray" />
                  <p className="text-sm text-brand-ink">{selectedFollowUp.location}</p>
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-brand-gray" />
                  <p className="text-sm text-brand-ink">{selectedFollowUp.assignedMidwife}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[selectedFollowUp.priority]}`}>
                    {selectedFollowUp.priority}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selectedFollowUp.status]}`}>
                    {selectedFollowUp.status}
                  </span>
                </div>
              </div>

              {selectedFollowUp.remarks && (
                <div className="mb-5">
                  <p className="text-xs text-brand-gray mb-1">Remarks</p>
                  <p className="text-sm text-brand-ink">{selectedFollowUp.remarks}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Record Visit Modal */}
      {showRecordVisitModal && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Record Visit</h3>
                <button
                  onClick={() => setShowRecordVisitModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Visit Date</label>
                    <input
                      type="date"
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Visit Time</label>
                    <input
                      type="time"
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident Condition</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    <option>Stable</option>
                    <option>Improving</option>
                    <option>Worsening</option>
                    <option>Critical</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Findings</label>
                  <textarea
                    rows={3}
                    placeholder="Enter findings..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Treatment Provided</label>
                  <textarea
                    rows={2}
                    placeholder="Enter treatment..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Advice Given</label>
                  <textarea
                    rows={2}
                    placeholder="Enter advice..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Next Visit Date</label>
                  <input
                    type="date"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowRecordVisitModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveVisit({})}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save Visit
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Update Status Modal */}
      {showUpdateStatusModal && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Update Status</h3>
                <button
                  onClick={() => setShowUpdateStatusModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-brand-gray mb-4">Select new status for {selectedFollowUp.resident}'s follow-up:</p>
              <div className="space-y-2">
                {["Scheduled", "Ongoing", "Completed", "Missed", "Cancelled"].map((status) => (
                  <button
                    key={status}
                    onClick={() => handleStatusUpdate(status)}
                    className="w-full flex items-center gap-3 border border-brand-border rounded-btn px-4 py-3 text-sm font-medium text-brand-ink hover:border-brand-blue hover:bg-brand-light transition-colors"
                  >
                    <span className={`w-3 h-3 rounded-full ${STATUS_COLORS[status].split(" ")[0]}`} />
                    {status}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Remarks Modal */}
      {showRemarksModal && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Add Remarks</h3>
                <button
                  onClick={() => setShowRemarksModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mb-4">
                <label className="text-sm font-medium text-brand-ink block mb-1.5">Remarks</label>
                <textarea
                  rows={4}
                  placeholder="Enter remarks..."
                  defaultValue={selectedFollowUp.remarks}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowRemarksModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveRemarks("Updated remarks")}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Complete Confirmation Modal */}
      {showCompleteConfirm && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-brand-ink mb-4">Complete Follow-up</h3>
              <p className="text-sm text-brand-gray mb-6">
                Are you sure you want to mark <span className="font-medium text-brand-ink">{selectedFollowUp.resident}</span>'s follow-up as completed? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCompleteConfirm(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmComplete}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Complete
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
