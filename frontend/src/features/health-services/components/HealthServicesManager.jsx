import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { healthServicesApi } from "@/services/api";
import FacilityField from "./FacilityField";
import TimePicker from "./TimePicker";
import DateField from "./DateField";
import {
  Plus, X, CheckCircle2, RefreshCw, Search, Users, MapPin, Building2, Activity, UserPlus, UserMinus,
  ClipboardList, UserCheck, UserX, CalendarDays, MoreVertical, Pencil, Trash2, Power, AlertTriangle,
  ListChecks, CalendarClock, Layers,
} from "lucide-react";

/**
 * Health Services manager — the database-backed catalog + personnel assignment
 * UI shared by the PHN and Health Supervisor "Health Programs" pages.
 *
 * Source of truth is the backend (/api/health-services -> Supabase
 * public.health_services + public.health_service_assignments). No localStorage.
 * Municipality/barangay scope, RHU-vs-barangay modeling and assignment
 * visibility are enforced server-side and by RLS; this UI reads/writes through
 * the API and revalidates after every mutation.
 *
 * REDESIGN: a compact management dashboard — summary counts, search, category
 * and status filters, and a responsive 3/2/1-column grid of compact cards with
 * a per-card action menu (Edit / Activate-Deactivate / Delete). Create and Edit
 * reuse ONE shared form. Delete is dependency-aware: the backend refuses to
 * destroy a service that has registrations/attendance and the UI offers the
 * safe deactivation (archive) alternative instead.
 */

const CATEGORY_LABELS = {
  Maternal: "Maternal Services",
  TCLS: "TCLS",
  Immunization: "Immunization",
  "Family Planning": "Family Planning",
  Consultation: "Consultation",
  Other: "Other Health Services",
};
const CATEGORY_ORDER = ["Maternal", "TCLS", "Immunization", "Family Planning", "Consultation", "Other"];

const ROLE_LABELS = {
  phn: "PHN",
  mho: "MHO",
  health_supervisor: "Health Supervisor",
  rhu_personnel: "RHU Personnel",
  bhw: "BHW",
};

// Derived lifecycle status for a service, from its real `active` flag + stored
// schedule window (never hardcoded). Mirrors the backend data: an inactive
// service is "Inactive" regardless of dates; an active one is "Upcoming" before
// its start, "Completed" after its end, otherwise "Active" (a legacy service
// with no schedule is treated as Active/ongoing).
const STATUS = { ACTIVE: "Active", UPCOMING: "Upcoming", COMPLETED: "Completed", INACTIVE: "Inactive" };

const toDateTime = (date, time) => {
  if (!date) return null;
  const t = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "00:00";
  const d = new Date(`${String(date).slice(0, 10)}T${t}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const deriveStatus = (service, now = new Date()) => {
  if (!service?.active) return STATUS.INACTIVE;
  const sched = service.schedule || {};
  if (!sched.startDate) return STATUS.ACTIVE; // legacy / unscheduled active service
  const start = toDateTime(sched.startDate, sched.startTime);
  const end = toDateTime(sched.endDate || sched.startDate, sched.endTime || "23:59");
  if (start && now < start) return STATUS.UPCOMING;
  if (end && now > end) return STATUS.COMPLETED;
  return STATUS.ACTIVE;
};

const STATUS_BADGE = {
  [STATUS.ACTIVE]: "bg-brand-green/10 text-brand-green",
  [STATUS.UPCOMING]: "bg-brand-blue/10 text-brand-blue",
  [STATUS.COMPLETED]: "bg-brand-gray/10 text-brand-gray",
  [STATUS.INACTIVE]: "bg-brand-gold/15 text-brand-amber",
};

const STATUS_FILTERS = ["All", STATUS.ACTIVE, STATUS.UPCOMING, STATUS.COMPLETED, STATUS.INACTIVE];

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-brand-border dark:border-border"
  }`;

// Comparable "YYYY-MM-DDTHH:MM" key for lexical date-time ordering.
const atKey = (date, time) => `${date}T${time}`;

/**
 * Client-side schedule validation mirroring the backend rule set (the server
 * re-validates authoritatively). Returns a map of fieldName -> message; an
 * empty map means the schedule is valid. A one-day service (no end date) is
 * treated as ending on its start date.
 */
const validateSchedule = (form) => {
  const errors = {};
  if (!form.startDate) errors.startDate = "A start date is required.";
  if (!form.startTime) errors.startTime = "A start time is required.";
  if (!form.endTime) errors.endTime = "An end time is required.";

  const endDate = form.endDate || form.startDate;
  if (form.startDate && form.startTime && form.endTime && endDate) {
    if (atKey(endDate, form.endTime) < atKey(form.startDate, form.startTime)) {
      errors.endTime = "The end date and time cannot be earlier than the start.";
    }
  }
  // Registration deadline is optional, but a date and time must be given together.
  const deadlineDate = form.registrationDeadlineDate;
  const deadlineTime = form.registrationDeadlineTime;
  if ((deadlineDate && !deadlineTime) || (!deadlineDate && deadlineTime)) {
    errors.registrationDeadline = "Enter both a date and time for the registration deadline.";
  } else if (deadlineDate && deadlineTime && form.startDate && form.startTime) {
    if (atKey(deadlineDate, deadlineTime) > atKey(form.startDate, form.startTime)) {
      errors.registrationDeadline = "The registration deadline cannot be after the service start.";
    }
  }
  return errors;
};

/** Format a stored "HH:MM" time as a readable local time (e.g. 9:00 AM). */
const formatTime = (t) => {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h)) return "";
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

const scheduleDateFmt = (iso) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/** One-line human summary of a service's concrete schedule, or "" when unset. */
const scheduleSummary = (schedule) => {
  if (!schedule || !schedule.startDate) return "";
  const start = `${scheduleDateFmt(schedule.startDate)}${schedule.startTime ? `, ${formatTime(schedule.startTime)}` : ""}`;
  const endDate = schedule.endDate || schedule.startDate;
  if (endDate && endDate !== schedule.startDate) {
    return `${start} – ${scheduleDateFmt(endDate)}${schedule.endTime ? `, ${formatTime(schedule.endTime)}` : ""}`;
  }
  // Same-day service: show the time range on one date.
  if (schedule.startTime && schedule.endTime) return `${scheduleDateFmt(schedule.startDate)}, ${formatTime(schedule.startTime)}–${formatTime(schedule.endTime)}`;
  return start;
};

const deadlineSummary = (schedule) => {
  if (!schedule?.registrationDeadline) return "";
  const iso = String(schedule.registrationDeadline);
  const time = iso.slice(11, 16);
  const datePart = scheduleDateFmt(iso.slice(0, 10));
  // A midnight / date-only deadline is inclusive of the whole day — show date only.
  return time && time !== "00:00" ? `${datePart}, ${formatTime(time)}` : datePart;
};

export default function HealthServicesManager({ subtitle }) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCreate = can("services.create");
  const canEdit = can("services.edit");
  const canDelete = can("services.delete");
  const canManage = canCreate || canEdit || canDelete;
  const isSupervisor = user?.role === "health_supervisor";

  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState(CATEGORY_ORDER);
  const [barangays, setBarangays] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [assignedBarangay, setAssignedBarangay] = useState(null);
  const [personnel, setPersonnel] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [toast, setToast] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null => create, else edit
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [scheduleErrors, setScheduleErrors] = useState({});
  const [typingErrors, setTypingErrors] = useState({});
  const [form, setForm] = useState(null);
  const [manageTarget, setManageTarget] = useState(null);
  const [busyAssign, setBusyAssign] = useState("");
  const [personnelQuery, setPersonnelQuery] = useState("");

  // Per-card action menu + delete confirmation.
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [statusBusyId, setStatusBusyId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  // Resident registrations (visit plans) + attendance roster for one service.
  const [regTarget, setRegTarget] = useState(null); // the service whose roster is open
  const [regState, setRegState] = useState({ loading: false, error: "", registrations: [], counts: null });
  const [attBusy, setAttBusy] = useState(""); // residentId being updated

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadServices = useCallback(() => {
    setLoading(true);
    setError("");
    return healthServicesApi
      .list()
      .then((res) => setServices(res?.rows || res?.records || []))
      .catch((err) => setError(err?.message || "Unable to load health services. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  const loadReference = useCallback(() => {
    // Reference + personnel are for the create/edit/assign forms; a failure
    // here must not blank the catalog, so they are best-effort.
    healthServicesApi.meta().then((m) => m?.categories && setCategories(m.categories)).catch(() => {});
    healthServicesApi.reference().then((r) => {
      setBarangays(r?.barangays || []);
      setFacilities(r?.facilities || []);
      setAssignedBarangay(r?.assignedBarangay || null);
    }).catch(() => {});
    healthServicesApi.personnel().then((r) => setPersonnel(r?.rows || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadServices();
    if (canManage) loadReference();
  }, [canManage, loadServices, loadReference]);

  // Summary counts come from ALL real services (not the filtered view), using
  // the derived status rules above.
  const summary = useMemo(() => {
    let total = 0;
    let active = 0;
    let upcoming = 0;
    for (const s of services) {
      total += 1;
      const st = deriveStatus(s);
      if (st === STATUS.ACTIVE) active += 1;
      else if (st === STATUS.UPCOMING) upcoming += 1;
    }
    return { total, active, upcoming };
  }, [services]);

  // Categories that actually occur in the data, for compact category chips.
  const availableCategories = useMemo(() => {
    const present = new Set(services.map((s) => s.category || "Other"));
    const ordered = [...new Set([...CATEGORY_ORDER, ...categories])].filter((c) => present.has(c));
    return ordered;
  }, [services, categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (q && !(s.name.toLowerCase().includes(q) || (s.category || "").toLowerCase().includes(q)
        || (CATEGORY_LABELS[s.category] || "").toLowerCase().includes(q))) return false;
      if (categoryFilter !== "All" && (s.category || "Other") !== categoryFilter) return false;
      if (statusFilter !== "All" && deriveStatus(s) !== statusFilter) return false;
      return true;
    });
  }, [services, search, categoryFilter, statusFilter]);

  // Defensive dedupe by stable account id (the backend already excludes QA/test
  // accounts and returns one row per profile; this guarantees the picker never
  // renders the same account twice even if an upstream response repeats it).
  const eligiblePersonnel = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of personnel) {
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }, [personnel]);

  const visiblePersonnel = useMemo(() => {
    const q = personnelQuery.trim().toLowerCase();
    if (!q) return eligiblePersonnel;
    return eligiblePersonnel.filter((p) => {
      const roleLabel = (ROLE_LABELS[p.role] || p.role || "").toLowerCase();
      return (p.name || "").toLowerCase().includes(q) || roleLabel.includes(q);
    });
  }, [eligiblePersonnel, personnelQuery]);

  // Barangay id -> name, for the facility coverage helper text.
  const barangayNameById = useMemo(() => {
    const map = new Map();
    for (const b of barangays) map.set(b.id, b.name);
    if (assignedBarangay?.id) map.set(assignedBarangay.id, assignedBarangay.name);
    return map;
  }, [barangays, assignedBarangay]);

  // A barangay-scoped Health Supervisor only picks the municipality RHU or a
  // facility in their own barangay (coverage is auto-applied, never selected).
  const facilityOptions = useMemo(() => {
    if (!isSupervisor) return facilities;
    const bId = assignedBarangay?.id || null;
    return facilities.filter((f) => f.type === "rhu" || !f.barangayId || f.barangayId === bId);
  }, [facilities, isSupervisor, assignedBarangay]);

  // Short, contextual explanation of the coverage the chosen facility implies.
  const facilityHelper = useMemo(() => {
    if (!form) return "";
    if (form.municipalityWide) return "Covers the whole municipality (RHU-wide). No specific barangay.";
    if (form.facilityId) {
      const f = facilities.find((x) => String(x.id) === String(form.facilityId));
      if (f?.type === "rhu") return "RHU facility — municipality/RHU-wide coverage. No specific barangay.";
      if (f?.type === "barangay_health_station") {
        const bName = (f.barangayId && barangayNameById.get(f.barangayId)) || assignedBarangay?.name || "its barangay";
        return `Barangay Health Center — covers ${bName}.`;
      }
      return "The service will be associated with the selected facility.";
    }
    if (form.facilityName.trim()) {
      return isSupervisor
        ? `New Barangay Health Center will be added under your barangay${assignedBarangay?.name ? ` (${assignedBarangay.name})` : ""}.`
        : `New facility “${form.facilityName.trim()}” will be created (municipality-wide coverage).`;
    }
    return "No specific facility — the service will cover the whole municipality.";
  }, [form, facilities, barangayNameById, assignedBarangay, isSupervisor]);

  const emptyForm = () => ({
    name: "",
    category: "Maternal",
    facilityId: "",
    facilityName: "",
    municipalityWide: false,
    description: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    registrationDeadlineDate: "",
    registrationDeadlineTime: "",
    personnelIds: [],
    active: true,
  });

  const openCreate = () => {
    if (!canCreate) return;
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setScheduleErrors({});
    setTypingErrors({});
    setPersonnelQuery("");
    setShowForm(true);
  };

  // Prepopulate the shared form from a saved service for editing in place.
  const openEdit = (service) => {
    if (!canEdit) return;
    setMenuOpenId(null);
    const sched = service.schedule || {};
    const deadline = sched.registrationDeadline ? String(sched.registrationDeadline) : "";
    setEditingId(service.id);
    setForm({
      name: service.name || "",
      category: service.category || "Other",
      facilityId: service.facilityId || "",
      facilityName: "",
      // No facility and no barangay => a municipality-wide service.
      municipalityWide: !service.facilityId && !service.barangayId,
      description: service.description || "",
      startDate: sched.startDate ? String(sched.startDate).slice(0, 10) : "",
      startTime: sched.startTime || "",
      endDate: sched.endDate && sched.endDate !== sched.startDate ? String(sched.endDate).slice(0, 10) : "",
      endTime: sched.endTime || "",
      registrationDeadlineDate: deadline ? deadline.slice(0, 10) : "",
      registrationDeadlineTime: deadline ? deadline.slice(11, 16) : "",
      personnelIds: (service.assignedPersonnel || []).map((p) => p.id),
      active: service.active !== false,
    });
    setFormError("");
    setScheduleErrors({});
    setTypingErrors({});
    setPersonnelQuery("");
    setShowForm(true);
  };

  const togglePersonnel = (id) =>
    setForm((f) => ({
      ...f,
      personnelIds: f.personnelIds.includes(id) ? f.personnelIds.filter((p) => p !== id) : [...f.personnelIds, id],
    }));

  // Record (or clear) a per-field "what you typed can't be parsed" message from
  // a DateField/TimePicker so the submit can block and the message can render.
  const setTypingError = (name) => (message) =>
    setTypingErrors((prev) => {
      if ((prev[name] || "") === (message || "")) return prev;
      const next = { ...prev };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });

  const saveService = async () => {
    const isEdit = Boolean(editingId);
    if (isEdit ? !canEdit : !canCreate) return;
    if (!form.name.trim()) { setFormError("A service name is required."); return; }
    if (Object.keys(typingErrors).length > 0) {
      setFormError("Please correct the highlighted schedule fields.");
      return;
    }
    const schedErrors = validateSchedule(form);
    setScheduleErrors(schedErrors);
    if (Object.keys(schedErrors).length > 0) {
      setFormError("Please correct the highlighted schedule fields.");
      return;
    }
    if (saving) return; // guard against a duplicate submit
    setSaving(true);
    setFormError("");
    const payload = {
      name: form.name.trim(),
      category: form.category,
      facilityId: form.municipalityWide ? null : (form.facilityId || null),
      facilityName: form.municipalityWide || form.facilityId ? null : (form.facilityName.trim() || null),
      municipalityWide: form.municipalityWide,
      description: form.description.trim(),
      startDate: form.startDate,
      startTime: form.startTime,
      endDate: form.endDate || form.startDate,
      endTime: form.endTime,
      registrationDeadline: form.registrationDeadlineDate && form.registrationDeadlineTime
        ? `${form.registrationDeadlineDate}T${form.registrationDeadlineTime}`
        : null,
      personnelIds: form.personnelIds,
    };
    try {
      if (isEdit) {
        await healthServicesApi.update(editingId, { ...payload, active: form.active });
      } else {
        await healthServicesApi.create(payload);
      }
      setShowForm(false);
      setEditingId(null);
      showToast(isEdit ? "Health service updated." : "Health service created.");
      await loadServices();
    } catch (err) {
      setFormError(err?.message || "The health service could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  // Activate / deactivate (soft status). Reversible archive used when a service
  // cannot be hard-deleted because it has dependent records.
  const setActive = async (service, active) => {
    if (!canEdit) return;
    setMenuOpenId(null);
    setStatusBusyId(service.id);
    try {
      await healthServicesApi.update(service.id, { active });
      await loadServices();
      showToast(active ? "Service reactivated." : "Service deactivated (archived).");
    } catch (err) {
      showToast(err?.message || "The service status could not be changed.");
    } finally {
      setStatusBusyId("");
    }
  };

  const openDelete = (service) => {
    if (!canDelete) return;
    setMenuOpenId(null);
    setDeleteTarget(service);
    setDeleteError("");
    setDeleteBlocked(false);
  };

  const confirmDelete = async () => {
    if (!canDelete || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await healthServicesApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      showToast("Health service deleted.");
      await loadServices();
    } catch (err) {
      // 409 => has registrations/attendance; offer deactivation instead.
      if (err?.status === 409) {
        setDeleteBlocked(true);
        setDeleteError(err?.message || "This service has dependent records and cannot be deleted.");
      } else {
        setDeleteError(err?.message || "The service could not be deleted.");
      }
    } finally {
      setDeleting(false);
    }
  };

  const deactivateFromDelete = async () => {
    if (!canEdit || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await healthServicesApi.update(deleteTarget.id, { active: false });
      setDeleteTarget(null);
      showToast("Service deactivated (archived).");
      await loadServices();
    } catch (err) {
      setDeleteError(err?.message || "The service could not be deactivated.");
    } finally {
      setDeleting(false);
    }
  };

  const isAssigned = (service, personnelId) => (service.assignedPersonnel || []).some((p) => p.id === personnelId);

  const toggleAssign = async (service, person) => {
    if (!canEdit) return;
    setBusyAssign(person.id);
    try {
      const updated = isAssigned(service, person.id)
        ? await healthServicesApi.unassign(service.id, person.id)
        : await healthServicesApi.assign(service.id, person.id);
      const record = updated?.record || null;
      if (record) {
        setServices((prev) => prev.map((s) => (s.id === record.id ? record : s)));
        setManageTarget(record);
      }
      showToast(isAssigned(service, person.id) ? "Personnel removed from service." : "Personnel assigned to service.");
    } catch (err) {
      showToast(err?.message || "The assignment could not be updated.");
    } finally {
      setBusyAssign("");
    }
  };

  const facilityLabel = (s) => {
    if (s.facility) return `${s.facility}${s.facilityType === "rhu" ? " (RHU)" : ""}`;
    return s.barangayId ? "Barangay Health Station" : "RHU / Municipality-wide";
  };

  const loadRegistrations = useCallback((serviceId) => {
    setRegState((prev) => ({ ...prev, loading: true, error: "" }));
    return healthServicesApi
      .registrations(serviceId)
      .then((res) =>
        setRegState({
          loading: false,
          error: "",
          registrations: res?.registrations || [],
          counts: res?.counts || null,
        }),
      )
      .catch((err) =>
        setRegState({
          loading: false,
          error: err?.message || "Unable to load registrations. Please try again.",
          registrations: [],
          counts: null,
        }),
      );
  }, []);

  const openRegistrations = (service) => {
    setRegTarget(service);
    loadRegistrations(service.id);
  };

  // Record attendance (attended / absent) against a registration. Reuses the
  // existing health-service attendance endpoints; a new record is created on
  // the first mark, and updated on subsequent changes.
  const markAttendance = async (reg, status) => {
    if (!canEdit || !regTarget) return;
    setAttBusy(reg.residentId);
    try {
      if (reg.attendance?.id) {
        await healthServicesApi.updateAttendance(reg.attendance.id, { status });
      } else {
        await healthServicesApi.createAttendance({
          service_id: regTarget.id,
          resident_id: reg.residentId,
          scheduled_date: reg.plannedDate,
          status,
        });
      }
      await loadRegistrations(regTarget.id);
      showToast(status === "attended" ? "Marked as attended." : "Marked as missed.");
    } catch (err) {
      showToast(err?.message || "The attendance could not be recorded.");
    } finally {
      setAttBusy("");
    }
  };

  const hasFiltersActive = search.trim() || categoryFilter !== "All" || statusFilter !== "All";
  const clearFilters = () => { setSearch(""); setCategoryFilter("All"); setStatusFilter("All"); };

  return (
    <>
      <PageHeader
        crumbs={["Health Services"]}
        title="Health Services"
        subtitle={subtitle || "Catalog of health services and their assigned personnel."}
        action={canCreate ? (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> Add Health Service
          </button>
        ) : null}
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Summary counts — derived from the real catalog + status rules. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard icon={Layers} label="Total services" value={summary.total} tone="text-brand-ink" loading={loading} />
        <SummaryCard icon={ListChecks} label="Active services" value={summary.active} tone="text-brand-green" loading={loading} />
        <SummaryCard icon={CalendarClock} label="Upcoming services" value={summary.upcoming} tone="text-brand-blue" loading={loading} />
      </div>

      {/* Search + Refresh */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2 dark:border-border dark:bg-input sm:max-w-md sm:flex-1">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search service or category..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70"
            />
          </div>
          <button
            onClick={loadServices}
            className="inline-flex items-center justify-center gap-2 rounded-btn border border-brand-border px-3 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {/* Category + status filter chips */}
        <div className="mt-3 flex flex-col gap-2.5 border-t border-brand-border pt-3 dark:border-border">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">Category</span>
            <FilterChip active={categoryFilter === "All"} onClick={() => setCategoryFilter("All")}>All</FilterChip>
            {availableCategories.map((c) => (
              <FilterChip key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)}>
                {CATEGORY_LABELS[c] || c}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">Status</span>
            {STATUS_FILTERS.map((s) => (
              <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{s}</FilterChip>
            ))}
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium text-brand-danger">{error}</p>
          <button onClick={loadServices} className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </Card>
      ) : loading ? (
        <Card className="p-12 text-center"><p className="text-sm text-brand-gray">Loading health services...</p></Card>
      ) : services.length === 0 ? (
        <Card className="p-12 text-center">
          <Activity className="mx-auto mb-3 h-10 w-10 text-brand-gray/50" />
          <p className="text-sm text-brand-gray">No health services available.</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-brand-gray">No services match your filters.</p>
          {hasFiltersActive && (
            <button onClick={clearFilters} className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
              Clear filters
            </button>
          )}
        </Card>
      ) : (
        <>
          <p className="mb-3 text-xs text-brand-gray">
            Showing {filtered.length} of {services.length} service{services.length === 1 ? "" : "s"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => {
              const status = deriveStatus(s);
              const personnelList = s.assignedPersonnel || [];
              return (
                <Card key={s.id} className="flex h-full flex-col p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate font-semibold leading-snug text-brand-ink" title={s.name}>{s.name}</h4>
                      <p className="mt-0.5 text-xs font-medium text-brand-gray">{CATEGORY_LABELS[s.category] || s.category}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status]}`}>{status}</span>
                      {(canEdit || canDelete) && (
                        <ActionMenu
                          open={menuOpenId === s.id}
                          onToggle={() => setMenuOpenId((cur) => (cur === s.id ? null : s.id))}
                          onClose={() => setMenuOpenId(null)}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          active={s.active !== false}
                          busy={statusBusyId === s.id}
                          onEdit={() => openEdit(s)}
                          onToggleActive={() => setActive(s, s.active === false)}
                          onDelete={() => openDelete(s)}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex-1 space-y-1.5 text-sm text-brand-gray">
                    <p className="flex items-start gap-1.5"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">{facilityLabel(s)}</span></p>
                    <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">{s.barangay || "Municipality-wide"}</span></p>
                    {scheduleSummary(s.schedule) && (
                      <p className="flex items-start gap-1.5"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">{scheduleSummary(s.schedule)}</span></p>
                    )}
                    {deadlineSummary(s.schedule) && (
                      <p className="flex items-start gap-1.5"><CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">Register by {deadlineSummary(s.schedule)}</span></p>
                    )}
                    <p className="flex items-start gap-1.5">
                      <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0">
                        {personnelList.length === 0
                          ? "No personnel assigned"
                          : personnelList.map((p) => `${p.name}${p.role ? ` (${ROLE_LABELS[p.role] || p.role})` : ""}`).join(", ")}
                      </span>
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-brand-border pt-2.5 dark:border-border">
                    <button
                      onClick={() => openRegistrations(s)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:text-brand-blue hover:underline"
                    >
                      <ClipboardList className="h-3.5 w-3.5" /> Registrations
                    </button>
                    {canEdit && <button
                      onClick={() => setManageTarget(s)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Assign
                    </button>}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Create / Edit service — ONE shared form */}
      {showForm && form && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={editingId ? "Edit Health Service" : "Add Health Service"}>
          <Card className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden">
            {/* Header — stays visible while the body scrolls */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border px-6 py-4 dark:border-border">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-brand-ink">{editingId ? "Edit Health Service" : "Add Health Service"}</h3>
                <p className="mt-0.5 text-sm text-brand-gray">
                  {editingId
                    ? "Update this service's details, schedule, coverage and assigned personnel."
                    : "Create a health service and configure its facility, coverage, and assigned personnel."}
                </p>
              </div>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="shrink-0 rounded-btn p-1 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink dark:hover:bg-hover"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Single primary scroll area for the form content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-5">
                {/* Service details */}
                <section className="space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Service details</h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-brand-ink">Category</label>
                      <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={`${inputCls()} h-11 cursor-pointer`}>
                        {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-brand-ink">Service Name <span className="text-brand-danger">*</span></label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Prenatal"
                        aria-invalid={Boolean(formError && !form.name.trim())}
                        className={`${inputCls(formError && !form.name.trim())} h-11`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Description</label>
                    <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={`${inputCls()} resize-none`} />
                  </div>
                </section>

                {/* Facility and coverage */}
                <section className="space-y-3 border-t border-brand-border pt-5 dark:border-border">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Facility and coverage</h4>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Facility</label>
                    <FacilityField
                      facilities={facilityOptions}
                      value={{ facilityId: form.facilityId, facilityName: form.facilityName, municipalityWide: form.municipalityWide }}
                      onChange={(next) => setForm((f) => ({ ...f, ...next }))}
                    />
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-brand-gray">
                      <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" />
                      <span>{facilityHelper}</span>
                    </p>
                  </div>
                </section>

                {/* Schedule */}
                <section className="space-y-4 border-t border-brand-border pt-5 dark:border-border">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Schedule</h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-brand-ink">Start Date <span className="text-brand-danger">*</span></label>
                      <DateField
                        ariaLabel="Start date"
                        value={form.startDate}
                        onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
                        onParseError={setTypingError("startDate")}
                        error={Boolean(typingErrors.startDate || scheduleErrors.startDate)}
                        className={`${inputCls(typingErrors.startDate || scheduleErrors.startDate)} h-11`}
                      />
                      {(typingErrors.startDate || scheduleErrors.startDate)
                        ? <p className="mt-1 text-xs text-brand-danger">{typingErrors.startDate || scheduleErrors.startDate}</p>
                        : <p className="mt-1 text-xs text-brand-gray">Type DD/MM/YYYY or use the calendar.</p>}
                    </div>
                    <div>
                      <label className="text-sm font-medium text-brand-ink">Start Time <span className="text-brand-danger">*</span></label>
                      <TimePicker
                        ariaLabel="Start time"
                        value={form.startTime}
                        onChange={(t) => setForm((f) => ({ ...f, startTime: t }))}
                        onParseError={setTypingError("startTime")}
                        error={Boolean(typingErrors.startTime || scheduleErrors.startTime)}
                        className={`${inputCls(typingErrors.startTime || scheduleErrors.startTime)} h-11`}
                      />
                      {(typingErrors.startTime || scheduleErrors.startTime)
                        ? <p className="mt-1 text-xs text-brand-danger">{typingErrors.startTime || scheduleErrors.startTime}</p>
                        : <p className="mt-1 text-xs text-brand-gray">Type e.g. 8:30 AM or use the clock.</p>}
                    </div>
                    <div>
                      <label className="text-sm font-medium text-brand-ink">End Date <span className="text-brand-gray">(optional)</span></label>
                      <DateField
                        ariaLabel="End date"
                        value={form.endDate}
                        min={form.startDate || undefined}
                        onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
                        onParseError={setTypingError("endDate")}
                        error={Boolean(typingErrors.endDate || scheduleErrors.endDate)}
                        className={`${inputCls(typingErrors.endDate || scheduleErrors.endDate)} h-11`}
                      />
                      {(typingErrors.endDate || scheduleErrors.endDate)
                        ? <p className="mt-1 text-xs text-brand-danger">{typingErrors.endDate || scheduleErrors.endDate}</p>
                        : <p className="mt-1 text-xs text-brand-gray">Leave blank for a one-day service.</p>}
                    </div>
                    <div>
                      <label className="text-sm font-medium text-brand-ink">End Time <span className="text-brand-danger">*</span></label>
                      <TimePicker
                        ariaLabel="End time"
                        value={form.endTime}
                        onChange={(t) => setForm((f) => ({ ...f, endTime: t }))}
                        onParseError={setTypingError("endTime")}
                        error={Boolean(typingErrors.endTime || scheduleErrors.endTime)}
                        className={`${inputCls(typingErrors.endTime || scheduleErrors.endTime)} h-11`}
                      />
                      {(typingErrors.endTime || scheduleErrors.endTime)
                        ? <p className="mt-1 text-xs text-brand-danger">{typingErrors.endTime || scheduleErrors.endTime}</p>
                        : <p className="mt-1 text-xs text-brand-gray">Type e.g. 12:00 PM or use the clock.</p>}
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium text-brand-ink">Registration Deadline <span className="text-brand-gray">(optional)</span></label>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <DateField
                          ariaLabel="Registration deadline date"
                          value={form.registrationDeadlineDate}
                          max={form.startDate || undefined}
                          onChange={(v) => setForm((f) => ({ ...f, registrationDeadlineDate: v }))}
                          onParseError={setTypingError("registrationDeadlineDate")}
                          error={Boolean(typingErrors.registrationDeadlineDate || scheduleErrors.registrationDeadline)}
                          className={`${inputCls(typingErrors.registrationDeadlineDate || scheduleErrors.registrationDeadline)} h-11`}
                        />
                        <TimePicker
                          ariaLabel="Registration deadline time"
                          value={form.registrationDeadlineTime}
                          onChange={(t) => setForm((f) => ({ ...f, registrationDeadlineTime: t }))}
                          onParseError={setTypingError("registrationDeadlineTime")}
                          error={Boolean(typingErrors.registrationDeadlineTime || scheduleErrors.registrationDeadline)}
                          className={`${inputCls(typingErrors.registrationDeadlineTime || scheduleErrors.registrationDeadline)} h-11`}
                        />
                      </div>
                      {(typingErrors.registrationDeadlineDate || typingErrors.registrationDeadlineTime || scheduleErrors.registrationDeadline)
                        ? <p className="mt-1 text-xs text-brand-danger">{typingErrors.registrationDeadlineDate || typingErrors.registrationDeadlineTime || scheduleErrors.registrationDeadline}</p>
                        : <p className="mt-1 text-xs text-brand-gray">Last date and time residents may register. Must not be after the start.</p>}
                    </div>
                  </div>
                </section>

                {/* Personnel assignment */}
                <section className="space-y-3 border-t border-brand-border pt-5 dark:border-border">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Personnel assignment</h4>
                    {form.personnelIds.length > 0 && (
                      <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-xs font-medium text-brand-blue">{form.personnelIds.length} selected</span>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Assign Personnel</label>
                    {eligiblePersonnel.length > 6 && (
                      <div className="mt-1.5 flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 dark:border-border dark:bg-input">
                        <Search className="h-4 w-4 text-brand-gray" />
                        <input
                          value={personnelQuery}
                          onChange={(e) => setPersonnelQuery(e.target.value)}
                          placeholder="Search personnel by name or role..."
                          className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70"
                        />
                      </div>
                    )}
                    <div className="mt-1.5 max-h-52 space-y-1 overflow-y-auto rounded-btn border border-brand-border p-2 dark:border-border">
                      {eligiblePersonnel.length === 0 ? (
                        <p className="px-2 py-6 text-center text-sm text-brand-gray">No assignable personnel found.</p>
                      ) : visiblePersonnel.length === 0 ? (
                        <p className="px-2 py-6 text-center text-sm text-brand-gray">No personnel match “{personnelQuery.trim()}”.</p>
                      ) : (
                        visiblePersonnel.map((p) => (
                          <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-btn px-2 py-1.5 hover:bg-brand-bg dark:hover:bg-hover">
                            <input type="checkbox" checked={form.personnelIds.includes(p.id)} onChange={() => togglePersonnel(p.id)} className="h-4 w-4 accent-brand-blue" />
                            <span className="text-sm text-brand-ink">{p.name} <span className="text-brand-gray">({ROLE_LABELS[p.role] || p.role})</span></span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </section>

                {formError && (
                  <div className="rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-3.5 py-2.5 text-sm text-brand-danger">{formError}</div>
                )}
              </div>
            </div>

            {/* Footer — stays visible at the bottom of the modal */}
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-brand-border px-6 py-4 dark:border-border sm:flex-row sm:justify-end sm:gap-3">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                disabled={saving}
                className="rounded-btn px-4 py-2.5 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg disabled:opacity-60 dark:hover:bg-hover"
              >
                Cancel
              </button>
              <button
                onClick={saveService}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                {editingId
                  ? <><CheckCircle2 className="h-4 w-4" /> {saving ? "Saving..." : "Save Changes"}</>
                  : <><Plus className="h-4 w-4" /> {saving ? "Creating..." : "Create Health Service"}</>}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Manage assignments */}
      {manageTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-md overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{manageTarget.name}</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">Assign or remove personnel for this service.</p>
                </div>
                <button onClick={() => setManageTarget(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-1">
                {eligiblePersonnel.length === 0 && <p className="py-4 text-center text-sm text-brand-gray">No assignable personnel found.</p>}
                {eligiblePersonnel.map((p) => {
                  const assigned = isAssigned(manageTarget, p.id);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-btn border border-brand-border px-3 py-2.5 dark:border-border">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-brand-ink">{p.name}</span>
                        <span className="text-xs text-brand-gray">{ROLE_LABELS[p.role] || p.role}</span>
                      </span>
                      {canEdit && <button
                        onClick={() => toggleAssign(manageTarget, p)}
                        disabled={busyAssign === p.id}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                          assigned ? "border border-brand-danger/30 text-brand-danger hover:bg-brand-danger/5" : "bg-brand-blue text-white hover:bg-brand-dark"
                        }`}
                      >
                        {assigned ? <><UserMinus className="h-3.5 w-3.5" /> Remove</> : <><UserPlus className="h-3.5 w-3.5" /> Assign</>}
                      </button>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex justify-end border-t border-brand-border pt-4 dark:border-border">
                <button onClick={() => setManageTarget(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Close</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Delete ${deleteTarget.name}`}>
          <Card className="w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="mb-3 flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${deleteBlocked ? "bg-brand-gold/15 text-brand-amber" : "bg-brand-danger/10 text-brand-danger"}`}>
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-brand-ink">
                    {deleteBlocked ? "Cannot delete this service" : "Delete health service?"}
                  </h3>
                  <p className="mt-1 text-sm text-brand-gray">
                    {deleteBlocked ? (
                      <>“{deleteTarget.name}” has resident registrations, booked appointments or attendance records, so it cannot be deleted. You can deactivate (archive) it instead — this hides it from the active catalog while keeping all records intact.</>
                    ) : (
                      <>This permanently removes “<span className="font-medium text-brand-ink">{deleteTarget.name}</span>”. This cannot be undone. Services with resident registrations, appointments or attendance cannot be deleted and must be deactivated instead.</>
                    )}
                  </p>
                </div>
              </div>

              {deleteError && !deleteBlocked && (
                <div className="mb-3 rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-3.5 py-2.5 text-sm text-brand-danger">{deleteError}</div>
              )}

              <div className="mt-4 flex flex-col-reverse gap-2 border-t border-brand-border pt-4 dark:border-border sm:flex-row sm:justify-end sm:gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="rounded-btn px-4 py-2.5 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg disabled:opacity-60 dark:hover:bg-hover"
                >
                  {deleteBlocked ? "Close" : "Cancel"}
                </button>
                {deleteBlocked ? (
                  canEdit && (
                    <button
                      onClick={deactivateFromDelete}
                      disabled={deleting}
                      className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                    >
                      <Power className="h-4 w-4" /> {deleting ? "Deactivating..." : "Deactivate instead"}
                    </button>
                  )
                ) : (
                  <button
                    onClick={confirmDelete}
                    disabled={deleting}
                    className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-danger px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-danger/90 disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" /> {deleting ? "Deleting..." : "Delete service"}
                  </button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Resident registrations + attendance roster */}
      {regTarget && (
        <RegistrationsModal
          service={regTarget}
          state={regState}
          canEdit={canEdit}
          attBusy={attBusy}
          onReload={() => loadRegistrations(regTarget.id)}
          onMark={markAttendance}
          onClose={() => setRegTarget(null)}
        />
      )}
    </>
  );
}

/** Compact KPI tile for the summary row. */
function SummaryCard({ icon: Icon, label, value, tone, loading }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-brand-light text-brand-blue">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-gray">{label}</p>
        <p className={`text-2xl font-semibold leading-tight ${tone}`}>{loading ? "—" : value}</p>
      </div>
    </Card>
  );
}

/** Compact filter chip (category / status). */
function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-brand-blue text-white"
          : "border border-brand-border bg-white text-brand-gray hover:border-brand-blue hover:text-brand-blue dark:bg-input dark:border-border"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Compact three-dot action menu for a service card: Edit, Activate/Deactivate,
 * Delete. Closes on outside click or Escape.
 */
function ActionMenu({ open, onToggle, onClose, canEdit, canDelete, active, busy, onEdit, onToggleActive, onDelete }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Service actions"
        className="rounded-btn p-1 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink disabled:opacity-60 dark:hover:bg-hover"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-btn border border-brand-border bg-white py-1 shadow-lg dark:border-border dark:bg-card">
          {canEdit && (
            <button role="menuitem" onClick={onEdit} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-ink hover:bg-brand-bg dark:hover:bg-hover">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          {canEdit && (
            <button role="menuitem" onClick={onToggleActive} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-ink hover:bg-brand-bg dark:hover:bg-hover">
              <Power className="h-3.5 w-3.5" /> {active ? "Deactivate" : "Reactivate"}
            </button>
          )}
          {canDelete && (
            <button role="menuitem" onClick={onDelete} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-danger hover:bg-brand-danger/5">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const REG_STATUS_BADGE = {
  Registered: "bg-brand-blue/10 text-brand-blue",
  Attended: "bg-brand-green/10 text-brand-green",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
};

// Resident-facing status derived from the plan + attendance, for the staff list.
const registrationLabel = (reg) => {
  if (reg.status === "Cancelled") return "Cancelled";
  const att = reg.attendance?.status;
  if (att === "attended" || att === "walk_in") return "Attended";
  if (att === "absent") return "Missed";
  return "Registered";
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
const formatDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/**
 * Staff roster for one service: the residents who registered (visit plans),
 * their registration status and timestamp, with attendance marking. Only active
 * (non-cancelled) registrations can be marked attended/missed.
 */
function RegistrationsModal({ service, state, canEdit, attBusy, onReload, onMark, onClose }) {
  const { loading, error, registrations, counts } = state;
  const active = registrations.filter((r) => r.status !== "Cancelled");
  const cancelled = registrations.filter((r) => r.status === "Cancelled");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Registrations for ${service.name}`}>
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold text-brand-ink">{service.name}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">Registered residents and attendance.</p>
              {scheduleSummary(service.schedule) && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-brand-ink">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-brand-blue" /> {scheduleSummary(service.schedule)}
                </p>
              )}
              {service.schedule?.registrationDeadline && (
                <p className="mt-0.5 text-xs text-brand-gray">
                  Registration closes {scheduleDateFmt(service.schedule.registrationDeadline.slice(0, 10))}, {formatTime(service.schedule.registrationDeadline.slice(11, 16))}
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          {counts && (
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-brand-blue/10 px-2.5 py-1 font-medium text-brand-blue">{counts.registered} registered</span>
              <span className="rounded-full bg-brand-green/10 px-2.5 py-1 font-medium text-brand-green">{counts.attended} attended</span>
              <span className="rounded-full bg-brand-danger/10 px-2.5 py-1 font-medium text-brand-danger">{counts.absent} missed</span>
              {counts.pendingAttendance > 0 && (
                <span className="rounded-full bg-brand-gray/10 px-2.5 py-1 font-medium text-brand-gray">{counts.pendingAttendance} not yet recorded</span>
              )}
            </div>
          )}

          <div className="mb-3 flex justify-end">
            <button onClick={onReload} className="inline-flex items-center gap-2 rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          {error ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-brand-danger">{error}</p>
              <button onClick={onReload} className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </div>
          ) : loading ? (
            <p className="py-10 text-center text-sm text-brand-gray">Loading registrations…</p>
          ) : active.length === 0 ? (
            <div className="py-10 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-brand-gray/40" />
              <p className="text-sm text-brand-gray">No residents have registered for this service yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {active.map((reg) => {
                const label = registrationLabel(reg);
                return (
                  <div key={reg.id} className="rounded-btn border border-brand-border p-3 dark:border-border">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-brand-ink">{reg.residentName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-gray">
                          {reg.barangay && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {reg.barangay}</span>}
                          {reg.plannedDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Plans to visit {formatDate(reg.plannedDate)}</span>}
                          {reg.registeredAt && <span>Registered {formatDateTime(reg.registeredAt)}</span>}
                        </div>
                        {reg.note && <p className="mt-1 text-xs italic text-brand-gray">“{reg.note}”</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${REG_STATUS_BADGE[label] || "bg-brand-gray/10 text-brand-gray"}`}>{label}</span>
                    </div>
                    {canEdit && (
                      <div className="mt-3 flex items-center gap-2 border-t border-brand-border pt-2.5 dark:border-border">
                        <button
                          onClick={() => onMark(reg, "attended")}
                          disabled={attBusy === reg.residentId}
                          className={`inline-flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                            label === "Attended" ? "bg-brand-green text-white" : "border border-brand-green/40 text-brand-green hover:bg-brand-green/5"
                          }`}
                        >
                          <UserCheck className="h-3.5 w-3.5" /> Attended
                        </button>
                        <button
                          onClick={() => onMark(reg, "absent")}
                          disabled={attBusy === reg.residentId}
                          className={`inline-flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                            label === "Missed" ? "bg-brand-danger text-white" : "border border-brand-danger/40 text-brand-danger hover:bg-brand-danger/5"
                          }`}
                        >
                          <UserX className="h-3.5 w-3.5" /> Missed
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {cancelled.length > 0 && (
                <details className="mt-3 rounded-btn border border-brand-border p-2 dark:border-border">
                  <summary className="cursor-pointer text-xs font-medium text-brand-gray">{cancelled.length} cancelled registration{cancelled.length > 1 ? "s" : ""}</summary>
                  <div className="mt-2 space-y-1">
                    {cancelled.map((reg) => (
                      <div key={reg.id} className="flex items-center justify-between gap-2 px-1 py-1 text-xs text-brand-gray">
                        <span className="truncate">{reg.residentName}{reg.barangay ? ` — ${reg.barangay}` : ""}</span>
                        <span className="rounded-full bg-brand-gray/10 px-2 py-0.5">Cancelled</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="mt-5 flex justify-end border-t border-brand-border pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Close</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
