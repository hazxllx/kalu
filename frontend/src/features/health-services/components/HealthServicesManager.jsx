// frontend/src/features/health-services/components/HealthServicesManager.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import FormModal from "@/components/common/FormModal";
import { Card } from "@/components/common/Card";
import KpiHorizontal from "@/components/common/KpiHorizontal";
import {
  ActionMenu as SharedActionMenu,
  ActionMenuContent,
  ActionMenuItem,
  ActionMenuTrigger,
} from "@/components/ui/action-menu";
import StatusBadge from "@/components/common/StatusBadge";
import ErrorState from "@/components/common/ErrorState";
import EmptyState from "@/components/common/EmptyState";
import DateRangeFilter from "@/components/common/DateRangeFilter";
import UniversalDetailsModal from "@/components/common/UniversalDetailsModal";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { healthServicesApi } from "@/services/api";
import FacilityField from "./FacilityField";
import TimePicker from "./TimePicker";
import DateField from "./DateField";
import DocumentUploadField from "./DocumentUploadField";
import { filterHealthServices } from "../lib/filterHealthServices";
import {
  Plus, X, CheckCircle2, Search, Users, MapPin, Building2, Activity, UserPlus, UserMinus,
  UserCheck, UserX, CalendarDays, Pencil, Trash2, Power, AlertTriangle,
  FileText, RefreshCw,
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
 * and status filters, and a responsive grid of compact cards with
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

const serviceOverlapsDateRange = (service, from, to) => {
  if (!from && !to) return true;
  const start = String(service?.schedule?.startDate || "").slice(0, 10);
  const end = String(service?.schedule?.endDate || start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  return (!to || start <= to) && (!from || end >= from);
};

const STATUS_BADGE = {
  [STATUS.ACTIVE]: "bg-brand-green/10 text-brand-green",
  [STATUS.UPCOMING]: "bg-brand-blue/10 text-brand-blue",
  [STATUS.COMPLETED]: "bg-brand-gray/10 text-brand-gray",
  [STATUS.INACTIVE]: "bg-brand-gold/15 text-brand-amber",
};

const CATEGORY_FILTERS = [
  ["All", "All Categories"],
  ["Maternal", "Maternal Services"],
  ["TCLS", "TCLS"],
  ["Immunization", "Immunization"],
  ["Family Planning", "Family Planning"],
];
const STATUS_FILTERS = [
  ["All", "All Status"],
  [STATUS.ACTIVE, STATUS.ACTIVE],
  [STATUS.UPCOMING, STATUS.UPCOMING],
  [STATUS.COMPLETED, STATUS.COMPLETED],
  [STATUS.INACTIVE, STATUS.INACTIVE],
];
const SERVICE_PAGE_SIZE = 8;
const PUBMAT_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 72 100%22%3E%3Crect fill=%22%23E4DED2%22 width=%2272%22 height=%22100%22/%3E%3Ctext x=%2236%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2212%22 fill=%22%239CA3AF%22%3EHealth%3C/text%3E%3C/svg%3E";

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-brand-border dark:border-border"
  }`;

// Comparable "YYYY-MM-DDTHH:MM" key for lexical date-time ordering.
const atKey = (date, time) => `${date}T${time}`;

const currentManilaDateTimeKey = () => {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
};

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
  } else if (deadlineDate && deadlineTime) {
    const deadline = atKey(deadlineDate, deadlineTime);
    if (deadline <= currentManilaDateTimeKey()) {
      errors.registrationDeadline = "The registration deadline must be a future date and time.";
    } else if (form.startDate && form.startTime && deadline > atKey(form.startDate, form.startTime)) {
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

// Renders or manages HealthServicesManager logic.
export default function HealthServicesManager({ subtitle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePermissions();
  const isSupervisor = user?.role === "health_supervisor";
  const scopeReady = !isSupervisor || getSupervisorScope(user)?.level === HS_SCOPE.BARANGAY;
  const canCreate = can("services.create") && scopeReady;
  const canEdit = can("services.edit") && scopeReady;
  const canDelete = can("services.delete") && scopeReady;
  const canManage = canCreate || canEdit || canDelete;

  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState(isSupervisor ? [] : CATEGORY_ORDER);
  const [barangays, setBarangays] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [assignedBarangay, setAssignedBarangay] = useState(null);
  const [personnel, setPersonnel] = useState([]);
  const [referenceState, setReferenceState] = useState({ loading: false, errors: [] });
  const serviceRequest = useRef(0);
  const pubmatUrlRequest = useRef(0);
  const [pubmatUrls, setPubmatUrls] = useState({});
  const referenceRequest = useRef(0);
  const registrationRequest = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [scopeFilter, setScopeFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null => create, else edit
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [scheduleErrors, setScheduleErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [typingErrors, setTypingErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [form, setForm] = useState(null);
  const [manageTarget, setManageTarget] = useState(null);
  const [busyAssign, setBusyAssign] = useState("");
  const [personnelQuery, setPersonnelQuery] = useState("");

  // Per-card action menu + delete confirmation.
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [statusBusyId, setStatusBusyId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detailsServiceId, setDetailsServiceId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  // Resident registrations (visit plans) + attendance roster for one service.
  const [regTarget, setRegTarget] = useState(null); // the service whose roster is open
  const [regState, setRegState] = useState({ loading: false, error: "", registrations: [], counts: null });
  const [attBusy, setAttBusy] = useState(""); // residentId being updated
  const [followUpStartRequest, setFollowUpStartRequest] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadServices = useCallback(() => {
    const requestId = ++serviceRequest.current;
    setLoading(true);
    setError("");
    return healthServicesApi
      .list()
      .then((res) => {
        if (requestId !== serviceRequest.current) return;
        const rows = res?.rows || res?.records;
        if (!Array.isArray(rows)) throw new Error("The health service catalog response was incomplete.");
        setServices(rows);
      })
      .catch((err) => {
        if (requestId !== serviceRequest.current) return;
        setServices([]);
        setError(err?.message || "Unable to load health services. Please try again.");
      })
      .finally(() => { if (requestId === serviceRequest.current) setLoading(false); });
  }, [user?.id]);

  const loadReference = useCallback(async () => {
    const requestId = ++referenceRequest.current;
    setReferenceState({ loading: true, errors: [] });
    const [meta, reference, people] = await Promise.allSettled([
      healthServicesApi.meta(), healthServicesApi.reference(), healthServicesApi.personnel(),
    ]);
    if (requestId !== referenceRequest.current) return;
    const errors = [];
    if (meta.status === "fulfilled" && Array.isArray(meta.value?.categories)) {
      setCategories(meta.value.categories);
    } else {
      if (isSupervisor) setCategories([]);
      errors.push(`Service categories: ${(meta.status === "rejected" && meta.reason?.message) || "The category source is unavailable."}`);
    }
    if (reference.status === "fulfilled" && Array.isArray(reference.value?.barangays) && Array.isArray(reference.value?.facilities)) {
      setBarangays(reference.value.barangays);
      setFacilities(reference.value.facilities);
      setAssignedBarangay(reference.value.assignedBarangay || null);
    } else {
      setBarangays([]);
      setFacilities([]);
      setAssignedBarangay(null);
      errors.push(`Facility reference: ${(reference.status === "rejected" && reference.reason?.message) || "The facility source is unavailable."}`);
    }
    if (people.status === "fulfilled" && Array.isArray(people.value?.rows)) {
      setPersonnel(people.value.rows);
    } else {
      setPersonnel([]);
      errors.push(`Personnel directory: ${(people.status === "rejected" && people.reason?.message) || "The personnel source is unavailable."}`);
    }
    setReferenceState({ loading: false, errors });
  }, [user?.id, isSupervisor]);

  useEffect(() => {
    loadServices();
    if (canManage) loadReference();
    return () => { serviceRequest.current += 1; referenceRequest.current += 1; registrationRequest.current += 1; };
  }, [canManage, loadServices, loadReference]);
  useEffect(() => {
    setServices([]);
    setPersonnel([]);
    setShowForm(false);
    setManageTarget(null);
    setRegTarget(null);
    setDeleteTarget(null);
    setMenuOpenId(null);
  }, [user?.id]);

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

  const filtered = useMemo(() => {
    const matches = filterHealthServices(
      services,
      { search, category: categoryFilter, status: statusFilter },
      deriveStatus,
      CATEGORY_LABELS,
    );
    return matches.filter((service) => {
      const isBarangay = Boolean(service.barangayId || service.barangay);
      const matchesScope = scopeFilter === "Municipality-wide" ? !isBarangay
        : scopeFilter === "Barangay-level" ? isBarangay
        : true;
      return matchesScope && serviceOverlapsDateRange(service, dateFrom, dateTo);
    });
  }, [services, search, categoryFilter, statusFilter, scopeFilter, dateFrom, dateTo]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / SERVICE_PAGE_SIZE));
  const pageServices = filtered.slice((page - 1) * SERVICE_PAGE_SIZE, page * SERVICE_PAGE_SIZE);
  useEffect(() => {
    const requestId = ++pubmatUrlRequest.current;
    const servicesWithPubmats = pageServices.filter((service) => service.attachments?.pubmat?.storagePath);
    if (!servicesWithPubmats.length) {
      setPubmatUrls({});
      return () => { if (pubmatUrlRequest.current === requestId) pubmatUrlRequest.current += 1; };
    }

    setPubmatUrls({});
    Promise.all(servicesWithPubmats.map(async (service) => {
      try {
        const response = await healthServicesApi.getAttachmentSignedUrl(service.id, "pubmat");
        return [service.id, response?.url || null];
      } catch (err) {
        console.warn("Could not load health service pubmat thumbnail.", service.id, err);
        return [service.id, null];
      }
    })).then((entries) => {
      if (requestId === pubmatUrlRequest.current) setPubmatUrls(Object.fromEntries(entries));
    });

    return () => {
      if (pubmatUrlRequest.current === requestId) pubmatUrlRequest.current += 1;
    };
  }, [services, page, search, categoryFilter, statusFilter, scopeFilter]);
  useEffect(() => setPage(1), [search, categoryFilter, statusFilter, scopeFilter, dateFrom, dateTo]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

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

  // Barangay supervisors only create services at a BHS in their own barangay.
  // RHU and municipality-wide services are created by PHN/MHO accounts.
  const facilityOptions = useMemo(() => {
    if (!isSupervisor) return facilities;
    const bId = assignedBarangay?.id || null;
    return facilities.filter((f) => f.type === "barangay_health_station" && (!f.barangayId || f.barangayId === bId));
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
    return isSupervisor
      ? `Choose a facility in your assigned barangay${assignedBarangay?.name ? ` (${assignedBarangay.name})` : ""}.`
      : "No specific facility — the service will cover the whole municipality.";
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
    registrationCapacity: "",
    personnelIds: [],
    active: true,
    memoFile: null,
    memoFilename: "",
    memoError: "",
    pubmatFile: null,
    pubmatFilename: "",
    pubmatPreview: null,
    pubmatError: "",
    uploadingMemo: false,
    uploadingPubmat: false,
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
      facilityName: service.customLocation || "",
      // No facility and no barangay => a municipality-wide service.
      municipalityWide: !service.facilityId && !service.customLocation && !service.barangayId,
      description: service.description || "",
      startDate: sched.startDate ? String(sched.startDate).slice(0, 10) : "",
      startTime: sched.startTime || "",
      endDate: sched.endDate && sched.endDate !== sched.startDate ? String(sched.endDate).slice(0, 10) : "",
      endTime: sched.endTime || "",
      registrationDeadlineDate: deadline ? deadline.slice(0, 10) : "",
      registrationDeadlineTime: deadline ? deadline.slice(11, 16) : "",
      registrationCapacity: service.schedule?.registrationCapacity == null ? "" : String(service.schedule.registrationCapacity),
      personnelIds: (service.assignedPersonnel || []).map((p) => p.id),
      active: service.active !== false,
      memoFilename: service.attachments?.memo?.filename || "",
      memoError: "",
      pubmatFilename: service.attachments?.pubmat?.filename || "",
      pubmatError: "",
      uploadingMemo: false,
      uploadingPubmat: false,
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
    if (form.registrationCapacity !== "") {
      const capacity = Number(form.registrationCapacity);
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000000) {
        setFormError("Maximum resident registrations must be a whole number from 1 to 1,000,000.");
        return;
      }
    }
    if (isSupervisor && (form.municipalityWide || (!form.facilityId && !form.facilityName.trim()))) {
      setFormError("Select or enter a facility in your assigned barangay. RHU and municipality-wide services are managed by PHN.");
      return;
    }
    if (Object.keys(typingErrors).length > 0) {
      setFormError("Please correct the highlighted schedule fields.");
      return;
    }
    const schedErrors = validateSchedule(form);
    setScheduleErrors({ ...schedErrors });
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
      registrationCapacity: form.registrationCapacity === "" ? null : Number(form.registrationCapacity),
      personnelIds: form.personnelIds,
    };
    try {
      let serviceId = editingId;
      if (isEdit) {
        await healthServicesApi.update(editingId, { ...payload, active: form.active });
      } else {
        const created = await healthServicesApi.create(payload);
        serviceId = created?.record?.id;
        if (!serviceId) throw new Error("Service creation succeeded but no ID was returned.");
        // If an optional attachment fails, keep this saved service as the edit
        // target so retrying the form does not create a duplicate service.
        setEditingId(serviceId);
      }

      // Upload attachments
      if (form.memoFile && serviceId) {
        try {
          setForm((f) => ({ ...f, uploadingMemo: true }));
          await healthServicesApi.uploadAttachment(serviceId, 'memo', form.memoFile);
        } catch (err) {
          setForm((f) => ({ ...f, uploadingMemo: false, memoError: err?.message || "Failed to upload memo." }));
          throw new Error(`Memo upload failed: ${err?.message}`);
        }
        setForm((f) => ({ ...f, uploadingMemo: false }));
      }

      if (form.pubmatFile && serviceId) {
        try {
          setForm((f) => ({ ...f, uploadingPubmat: true }));
          await healthServicesApi.uploadAttachment(serviceId, 'pubmat', form.pubmatFile);
        } catch (err) {
          setForm((f) => ({ ...f, uploadingPubmat: false, pubmatError: err?.message || "Failed to upload pubmat." }));
          throw new Error(`Publication material upload failed: ${err?.message}`);
        }
        setForm((f) => ({ ...f, uploadingPubmat: false }));
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
      showToast(err?.message || "The service status could not be changed.", "error");
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
      showToast(err?.message || "The assignment could not be updated.", "error");
    } finally {
      setBusyAssign("");
    }
  };

  const facilityLabel = (s) => {
    if (s.facility) return `${s.facility}${s.facilityType === "rhu" ? " (RHU)" : ""}`;
    return s.barangayId ? "Barangay Health Station" : "RHU / Municipality-wide";
  };

  const loadRegistrations = useCallback((serviceId) => {
    const requestId = ++registrationRequest.current;
    setRegState({ loading: true, error: "", registrations: [], counts: null });
    return healthServicesApi
      .registrations(serviceId)
      .then((res) => {
        if (requestId !== registrationRequest.current) return;
        if (!Array.isArray(res?.registrations)) throw new Error("The registration roster response was incomplete.");
        setRegState({
          loading: false,
          error: "",
          registrations: res?.registrations || [],
          counts: res?.counts || null,
        });
      })
      .catch((err) => {
        if (requestId !== registrationRequest.current) return;
        setRegState({
          loading: false,
          error: err?.message || "Unable to load registrations. Please try again.",
          registrations: [],
          counts: null,
        });
      });
  }, [user?.id]);

  const openRegistrations = (service) => {
    setRegTarget(service);
    loadRegistrations(service.id);
  };

  useEffect(() => {
    const start = location.state?.followUpStart;
    if (!start?.id || !services.length || loading) return;
    const purpose = String(start.purpose || "").trim().toLowerCase();
    const service = services.find((item) => String(item.name || "").trim().toLowerCase() === purpose)
      || services.find((item) => purpose && (String(item.name || "").toLowerCase().includes(purpose) || purpose.includes(String(item.name || "").toLowerCase())));
    navigate(location.pathname, { replace: true, state: null });
    if (!service) {
      showToast("No matching health service was found. Open the correct service from the catalog to record this follow-up.", "error");
      return;
    }
    setFollowUpStartRequest(start);
    setRegTarget(service);
    loadRegistrations(service.id);
  }, [location.key, location.pathname, location.state, loading, services, navigate, loadRegistrations]);

  // Record attendance (attended / absent) against a registration. Reuses the
  // existing health-service attendance endpoints; a new record is created on
  // the first mark, and updated on subsequent changes.
  const markAttendance = async (reg, status, correctionReason = "") => {
    if (!canEdit || !regTarget) return;
    setAttBusy(reg.residentId);
    try {
      if (reg.attendance?.id) {
        await healthServicesApi.updateAttendance(reg.attendance.id, { status, ...(correctionReason ? { correction_reason: correctionReason } : {}) });
      } else {
        await healthServicesApi.createAttendance({
          service_id: regTarget.id,
          resident_id: reg.residentId,
          scheduled_date: reg.plannedDate,
          status,
          ...(correctionReason ? { correction_reason: correctionReason } : {}),
        });
      }
      await loadRegistrations(regTarget.id);
      showToast(status === "attended" ? "Marked as attended." : "Marked as missed.");
      return true;
    } catch (err) {
      showToast(err?.message || "The attendance could not be recorded.", "error");
      return false;
    } finally {
      setAttBusy("");
    }
  };

  const saveServiceDelivery = async (reg, values) => {
    if (!canEdit || !regTarget) return;
    setAttBusy(reg.residentId);
    try {
      if (reg.attendance?.id) {
        await healthServicesApi.updateAttendance(reg.attendance.id, { ...values, status: "attended", service_completed: true, follow_up_id: reg.followUpId || undefined });
      } else {
        await healthServicesApi.createAttendance({
          service_id: regTarget.id,
          resident_id: reg.residentId,
          scheduled_date: reg.plannedDate,
          status: "attended",
          service_completed: true,
          follow_up_id: reg.followUpId || undefined,
          ...values,
        });
      }
      await loadRegistrations(regTarget.id);
      showToast("Service delivery saved to the resident’s record.");
      if (reg.followUpId) setFollowUpStartRequest(null);
      return true;
    } catch (err) {
      showToast(err?.message || "The service record could not be saved.", "error");
      return false;
    } finally {
      setAttBusy("");
    }
  };

  const hasFiltersActive = Boolean(search.trim() || categoryFilter !== "All" || statusFilter !== "All" || scopeFilter !== "All" || dateFrom || dateTo);
  const clearFilters = () => { setSearch(""); setCategoryFilter("All"); setStatusFilter("All"); setScopeFilter("All"); setDateFrom(""); setDateTo(""); setPage(1); };
  const categoryOptions = isSupervisor
    ? [["All", "All Categories"], ...[...new Set([...categories, ...services.map((service) => service.category).filter(Boolean)])].map((category) => [category, CATEGORY_LABELS[category] || category])]
    : CATEGORY_FILTERS;
  const referencesUnavailable = referenceState.loading || referenceState.errors.length > 0;
  const detailsService = detailsServiceId
    ? services.find((service) => service.id === detailsServiceId) || null
    : null;
  const detailsCreator = detailsService?.createdBy === user?.id
    ? user?.name || user?.email
    : personnel.find((person) => person.id === detailsService?.createdBy)?.name;
  const parsedDetailsCreatedDate = detailsService?.createdAt ? new Date(detailsService.createdAt) : null;
  const detailsCreatedDate = parsedDetailsCreatedDate && !Number.isNaN(parsedDetailsCreatedDate.getTime())
    ? parsedDetailsCreatedDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
  const detailsBarangayLevel = Boolean(detailsService?.barangayId || detailsService?.barangay);
  const detailsPersonnel = (detailsService?.assignedPersonnel || [])
    .map((person) => person.name)
    .filter(Boolean)
    .join(", ");
  const detailInformation = detailsService ? [
    { label: "Facility", value: detailsService.facilityMeta?.label || facilityLabel(detailsService) },
    { label: "Coverage / Barangay", value: detailsBarangayLevel ? detailsService.barangay : "Municipality-wide" },
    { label: "Schedule / Date and Time", value: scheduleSummary(detailsService.schedule) },
    { label: "Assigned Personnel", value: detailsPersonnel },
    { label: "Registration Deadline", value: deadlineSummary(detailsService.schedule) },
    { label: "Date Created", value: detailsCreatedDate },
    { label: "Created By", value: detailsCreator },
  ] : [];
  const detailSections = detailsService ? [
    { title: "Requirements", content: detailsService.requirements },
    { title: "Eligibility", content: detailsService.eligibility },
    { title: "Additional Instructions", content: detailsService.additionalInstructions || detailsService.instructions },
  ] : [];

  return (
    <div className={isSupervisor ? "supervisor-module" : "contents"}>
      <PageHeader
        crumbs={isSupervisor ? ["Health Operations", "Health Programs"] : ["Clinical Care", "Health Services"]}
        title={isSupervisor ? "Health Programs" : "Health Services"}
        subtitle={subtitle || (isSupervisor ? "Programs and services available to your barangay." : "Catalog of health services and their assigned personnel.")}
        dense={isSupervisor}
        action={canCreate ? (
          <button
            onClick={openCreate}
            className={isSupervisor ? "supervisor-button is-primary" : "flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"}
          >
            <Plus className="h-4 w-4" /> Add Health Service
          </button>
        ) : null}
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          {toast.type === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-green" aria-hidden="true" />}
          <span role={toast.type === "error" ? "alert" : "status"} className="text-sm">{toast.message}</span>
        </div>
      )}

      {/* Summary counts — derived from the real catalog + status rules. */}
      <div className="mb-4 phn-kpi-white">
        <KpiHorizontal count={3}>
          <KpiHorizontal.Item
            label="CATALOG SERVICES"
            value={loading || error ? "—" : summary.total}
            tone="blue"
            description="Authorized visible catalog"
          />
          <KpiHorizontal.Item
            label="ACTIVE"
            value={loading || error ? "—" : summary.active}
            tone="green"
            description="Active within the stored schedule"
          />
          <KpiHorizontal.Item
            label="UPCOMING"
            value={loading || error ? "—" : summary.upcoming}
            tone="blue"
            description="Active services with a future start"
          />
        </KpiHorizontal>
      </div>

      {isSupervisor && referenceState.errors.length > 0 && <Card className="mb-4"><ErrorState compact title="Service form references unavailable" message={referenceState.errors.join(" ")} onRetry={loadReference} /></Card>}

      {/* Search, filters */}
      <Card className={`mb-4 p-3 ${isSupervisor ? "supervisor-toolbar" : ""}`}>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,4fr)_minmax(12rem,3fr)_repeat(3,minmax(8rem,2fr))] xl:items-end">
          {isSupervisor ? <label htmlFor="health-service-search" className="min-w-0 text-caption font-medium text-brand-gray">
            Search Services
            <div className="supervisor-input mt-1 flex items-center gap-2">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <input id="health-service-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, description, or category" className="w-full min-w-0 bg-transparent outline-none" />
            </div>
          </label> : <div className="flex h-10 min-w-0 items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 dark:border-border dark:bg-input">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              type="search"
              aria-label="Search health services"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, description, or category..."
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-brand-gray/70"
            />
          </div>}

          <label htmlFor="health-service-scope" className="min-w-0 text-xs font-medium text-brand-gray">
            Implementation Scope
            <select
              id="health-service-scope"
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className={isSupervisor ? "supervisor-input mt-1 block w-full" : "mt-1 block h-10 w-full rounded-btn border border-brand-border bg-white px-3 text-sm font-normal text-brand-ink outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 dark:border-border dark:bg-input dark:text-foreground"}
            >
              <option value="All">All Scopes</option>
              <option value="Municipality-wide">Municipality-wide</option>
              <option value="Barangay-level">Barangay-level</option>
            </select>
          </label>
          <label htmlFor="health-service-category" className="min-w-0 text-xs font-medium text-brand-gray">
            Category
            <select
              id="health-service-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={isSupervisor ? "supervisor-input mt-1 block w-full" : "mt-1 block h-10 w-full rounded-btn border border-brand-border bg-white px-3 text-sm font-normal text-brand-ink outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 dark:border-border dark:bg-input dark:text-foreground"}
            >
              {categoryOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label htmlFor="health-service-status" className="min-w-0 text-xs font-medium text-brand-gray">
            Status
            <select
              id="health-service-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={isSupervisor ? "supervisor-input mt-1 block w-full" : "mt-1 block h-10 w-full rounded-btn border border-brand-border bg-white px-3 text-sm font-normal text-brand-ink outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 dark:border-border dark:bg-input dark:text-foreground"}
            >
              {STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        </div>

        <div className="mt-2 flex w-full items-center justify-between gap-3 border-t border-brand-border pt-2 dark:border-border">
          <p className="text-xs text-brand-gray" aria-live="polite" aria-atomic="true">
             {loading ? "Loading the authorized catalog..." : error ? "Catalog unavailable" : `Showing ${filtered.length} of ${services.length} authorized service${services.length === 1 ? "" : "s"}`}
          </p>
          {hasFiltersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="shrink-0 text-xs font-medium text-brand-blue underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {error ? (
        isSupervisor ? <Card><ErrorState compact title="Health services unavailable" message={error} onRetry={loadServices} /></Card> : <Card className="p-10 text-center">
          <p className="text-sm font-medium text-brand-danger">{error}</p>
          <button onClick={loadServices} className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </Card>
      ) : loading ? (
        <Card aria-busy="true" className={isSupervisor ? "p-5 text-center" : "p-12 text-center"}><p role="status" className="text-sm text-brand-gray">Loading health services...</p></Card>
      ) : services.length === 0 ? (
        isSupervisor ? <Card><EmptyState compact icon={Activity} title="No health services available" description="No catalog services are currently visible to this account. Services created or assigned by authorized personnel will appear here." /></Card> : <Card className="p-12 text-center">
          <Activity className="mx-auto mb-3 h-10 w-10 text-brand-gray/50" />
          <p className="text-sm text-brand-gray">No health services available.</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className={isSupervisor ? "p-5 text-center" : "p-12 text-center"}>
          <p className="text-sm text-brand-gray">No services match your filters.</p>
          {hasFiltersActive && (
            <button onClick={clearFilters} className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
              Clear filters
            </button>
          )}
        </Card>
       ) : (
         <>
            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-6">
             {pageServices.map((s) => {
               const status = deriveStatus(s);
               const personnelList = s.assignedPersonnel || [];
               const creator = s.createdBy === user?.id
                 ? user?.name || user?.email
                 : personnel.find((person) => person.id === s.createdBy)?.name;
               const createdDate = s.createdAt ? new Date(s.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
                const barangayLevel = Boolean(s.barangayId || s.barangay);
                const deadline = deadlineSummary(s.schedule);
                const metadata = [
                  ["Facility", s.facilityMeta?.label || s.facility || "—"],
                  ["Coverage", barangayLevel ? s.barangay || "—" : "Municipality-wide"],
                  ["Schedule", scheduleSummary(s.schedule) || "—"],
                  ["Personnel", personnelList.map((person) => person.name).filter(Boolean).join(", ") || "—"],
                  ...(deadline ? [["Register By", deadline]] : []),
                  ["Date Created", createdDate],
                  ...(creator ? [["Created By", creator]] : []),
                ];
                return (
                  <article key={s.id} className="health-service-card flex h-full min-w-0 flex-col rounded border border-[#E4DED2] bg-white dark:border-border dark:bg-card">
                    <div className="health-service-card-header flex flex-col gap-3 border-b border-[#E4DED2] p-4 dark:border-border xl:flex-row xl:gap-5 xl:p-6">
                      <img
                        src={pubmatUrls[s.id] || PUBMAT_PLACEHOLDER}
                        alt={pubmatUrls[s.id] ? s.name : ""}
                        className="h-24 w-full shrink-0 rounded border border-brand-border bg-brand-bg object-contain dark:border-border xl:h-[100px] xl:w-[72px] xl:object-cover"
                        onError={() => {
                          if (pubmatUrls[s.id]) setPubmatUrls((current) => ({ ...current, [s.id]: null }));
                        }}
                      />
                      <div className="min-w-0 flex-1 break-words">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{CATEGORY_LABELS[s.category] || s.category}</p>
                            {isSupervisor ? <StatusBadge value={status} /> : <span className={`inline-block rounded border px-2 py-1 text-xs font-medium uppercase ${STATUS_BADGE[status]}`}>{status}</span>}
                          </div>
                          {(canEdit || canDelete) && (
                           <ActionMenu
                            service={s}
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
                        <h3 className="mt-1 line-clamp-2 min-h-[3.1rem] font-display text-xl font-medium leading-tight text-brand-ink dark:text-foreground xl:text-2xl">{s.name}</h3>
                        <span className="mt-2 inline-block rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-medium text-brand-blue dark:bg-brand-blue/20 dark:text-blue-300">
                          {barangayLevel ? `Barangay-level${s.barangay ? ` · ${s.barangay}` : ""}` : "Municipality-wide"}
                        </span>
                        <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600 dark:text-slate-300">{s.description}</p>
                        <button
                          type="button"
                          onClick={() => setDetailsServiceId(s.id)}
                          className="mt-2 w-fit text-sm font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:text-blue-300"
                        >
                          View Details
                        </button>
                      </div>
                    </div>

                    <dl className="grid flex-1 content-start gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2 xl:px-6">
                      {metadata.map(([label, value]) => (
                        <div key={label} className="min-w-0 break-words">
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
                          <dd className={`mt-0.5 text-sm font-medium ${label === "Register By" ? "text-brand-danger" : "text-brand-ink dark:text-foreground"}`}>{value}</dd>
                        </div>
                      ))}
                    </dl>

                    {/* Footer — Separate section */}
                     <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-[#E4DED2] px-4 py-3 dark:border-border xl:px-6">
                      <button
                        onClick={() => openRegistrations(s)}
                        className="text-xs font-medium uppercase tracking-wide text-brand-blue transition-colors hover:underline dark:text-blue-300"
                        style={{ letterSpacing: '0.8px' }}
                      >
                        Registrations {s.registrationCount !== undefined && `(${s.registrationCount})`}
                      </button>
                      {canEdit && <button
                        onClick={() => setManageTarget(s)}
                        className="text-xs font-medium uppercase tracking-wide text-brand-green transition-colors hover:underline dark:text-emerald-300"
                        style={{ letterSpacing: '0.8px' }}
                      >
                         Assign
                       </button>}
                     </div>
                  </article>
               );
             })}
           </div>
           {pageCount > 1 && (
             <div className="mb-6 flex flex-col gap-3 rounded-btn border border-brand-border bg-white px-4 py-3 text-sm dark:border-border dark:bg-card sm:flex-row sm:items-center sm:justify-between">
               <p className="text-xs text-brand-gray" aria-live="polite">Showing {(page - 1) * SERVICE_PAGE_SIZE + 1}–{Math.min(page * SERVICE_PAGE_SIZE, filtered.length)} of {filtered.length} services</p>
               <div className="flex items-center justify-end gap-2">
                 <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="rounded-btn border border-brand-border px-3 py-1.5 text-sm text-brand-ink transition-colors hover:border-brand-blue disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:text-foreground">Previous</button>
                 <span className="min-w-16 text-center text-xs text-brand-gray">Page {page} of {pageCount}</span>
                 <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} className="rounded-btn border border-brand-border px-3 py-1.5 text-sm text-brand-ink transition-colors hover:border-brand-blue disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:text-foreground">Next</button>
               </div>
             </div>
           )}
         </>
       )}

      {/* Create / Edit service — ONE shared form */}
      {showForm && form && (
        <FormModal
          title={editingId ? "Edit Health Service" : "Add Health Service"}
          description={editingId
            ? "Update this service's details, schedule, coverage and assigned personnel."
            : "Create a health service and configure its facility, coverage, and assigned personnel."}
          onClose={() => { setShowForm(false); setEditingId(null); }}
          size="large"
          dialogClassName={isSupervisor ? "supervisor-modal supervisor-form" : ""}
          bodyClassName="px-4 py-4 sm:px-6 sm:py-5"
          footer={
            <>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} disabled={saving} className="min-h-10 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg disabled:opacity-60 dark:border-border dark:bg-input dark:hover:bg-hover">
                Cancel
              </button>
              <button type="button" onClick={saveService} disabled={saving || (isSupervisor && referencesUnavailable)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60">
                {editingId
                  ? <><CheckCircle2 className="h-4 w-4" /> {saving ? "Saving..." : "Save Changes"}</>
                  : <><Plus className="h-4 w-4" /> {saving ? "Creating..." : "Create Health Service"}</>}
              </button>
            </>
          }
        >
              <div className="space-y-5">
                {isSupervisor && referencesUnavailable && <div role={referenceState.errors.length ? "alert" : "status"} className="rounded border border-amber-300 bg-amber-50 p-3 text-ui text-amber-900"><p>{referenceState.loading ? "Loading saved category, facility and personnel references..." : referenceState.errors.join(" ")}</p>{!referenceState.loading && <button type="button" onClick={loadReference} className="supervisor-button mt-2">Retry references</button>}</div>}
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
                      allowMunicipalityWide={!isSupervisor}
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
                    <div className="sm:col-span-2">
                      <label htmlFor="registration-capacity" className="text-sm font-medium text-brand-ink">Maximum resident registrations <span className="text-brand-gray">(optional)</span></label>
                      <input
                        id="registration-capacity"
                        type="number"
                        min="1"
                        max="1000000"
                        step="1"
                        inputMode="numeric"
                        value={form.registrationCapacity}
                        onChange={(event) => setForm((f) => ({ ...f, registrationCapacity: event.target.value }))}
                        className={`${inputCls(false)} mt-1 h-11 w-full`}
                        placeholder="Leave blank for no limit"
                      />
                      <p className="mt-1 text-xs text-brand-gray">When the limit is reached, new resident registrations are closed. Cancelled registrations do not count.</p>
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
                      {isSupervisor && referencesUnavailable ? <p className="px-2 py-3 text-ui text-brand-gray">{referenceState.loading ? "Loading personnel references..." : "Personnel choices are unavailable until the reference sources can be reloaded."}</p> : eligiblePersonnel.length === 0 ? (
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

                 {/* Documents and publication materials */}
                 <section className="space-y-3 border-t border-brand-border pt-5 dark:border-border">
                   <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Documents and publication materials</h4>
                   <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                     <DocumentUploadField
                       type="memo"
                       label="Official Memorandum"
                       filename={form.memoFilename}
                       uploading={form.uploadingMemo}
                       error={form.memoError}
                       onSelect={(file) => {
                         setForm((f) => ({
                           ...f,
                           memoFile: file,
                           memoFilename: file.name,
                           memoError: "",
                         }));
                       }}
                       onRemove={() => {
                         setForm((f) => ({
                           ...f,
                           memoFile: null,
                           memoFilename: "",
                           memoError: "",
                         }));
                       }}
                     />
                     <DocumentUploadField
                       type="pubmat"
                       label="Publication Material"
                       filename={form.pubmatFilename}
                       uploading={form.uploadingPubmat}
                       error={form.pubmatError}
                       preview={form.pubmatPreview}
                       onSelect={(file) => {
                         const reader = new FileReader();
                         reader.onload = (e) => {
                           setForm((f) => ({
                             ...f,
                             pubmatFile: file,
                             pubmatFilename: file.name,
                             pubmatPreview: e.target?.result,
                             pubmatError: "",
                           }));
                         };
                        reader.onerror = () => setForm((f) => ({
                          ...f,
                          pubmatError: "The selected image could not be previewed. Please choose the file again.",
                        }));
                         reader.readAsDataURL(file);
                       }}
                       onRemove={() => {
                         setForm((f) => ({
                           ...f,
                           pubmatFile: null,
                           pubmatFilename: "",
                           pubmatPreview: null,
                           pubmatError: "",
                         }));
                       }}
                     />
                   </div>
                   <p className="text-xs text-brand-gray">Both fields are optional. The publication material will be used as the service card thumbnail.</p>
                 </section>

                 {formError && (
                  <div className="rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-3.5 py-2.5 text-sm text-brand-danger">{formError}</div>
                )}
              </div>
        </FormModal>
      )}

      {/* Manage assignments */}
      {manageTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Service Personnel Assignments" className={`max-h-[92vh] w-full max-w-md overflow-y-auto ${isSupervisor ? "supervisor-modal" : ""}`}>
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{manageTarget.name}</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">Assign or remove personnel for this service.</p>
                </div>
                <button onClick={() => setManageTarget(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-1">
                {isSupervisor && referencesUnavailable ? <div role="status" className="py-3 text-ui text-brand-gray">{referenceState.loading ? "Loading personnel..." : referenceState.errors.join(" ")}{!referenceState.loading && <button type="button" onClick={loadReference} className="supervisor-button mt-2">Retry references</button>}</div> : eligiblePersonnel.length === 0 && <p className="py-4 text-center text-sm text-brand-gray">No assignable personnel found.</p>}
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
                        disabled={busyAssign === p.id || (isSupervisor && referencesUnavailable)}
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
          <Card className={`w-full max-w-md overflow-hidden ${isSupervisor ? "supervisor-modal" : ""}`}>
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

              {deleteError && (
                <div role="alert" className="mb-3 rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-3.5 py-2.5 text-sm text-brand-danger">{deleteError}</div>
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
          supervisor={isSupervisor}
          state={regState}
          canEdit={canEdit}
          attBusy={attBusy}
          onReload={() => loadRegistrations(regTarget.id)}
          onMark={markAttendance}
          onSaveDelivery={saveServiceDelivery}
          onClose={() => { setRegTarget(null); setFollowUpStartRequest(null); }}
          followUpStart={followUpStartRequest}
        />
      )}

      <UniversalDetailsModal
        open={Boolean(detailsService)}
        onClose={() => setDetailsServiceId(null)}
        record={detailsService ? {
          title: detailsService.name,
          category: CATEGORY_LABELS[detailsService.category] || detailsService.category,
          status: deriveStatus(detailsService),
          image: pubmatUrls[detailsService.id] || "",
          description: detailsService.description,
          information: detailInformation,
          sections: detailSections,
        } : null}
      />
    </div>
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

/**
 * Compact three-dot action menu for a service card: Edit, Activate/Deactivate,
 * Delete. Closes on outside click or Escape.
 */
function ActionMenu({ service, open, onToggle, onClose, canEdit, canDelete, active, busy, onEdit, onToggleActive, onDelete }) {
  const [downloading, setDownloading] = useState(false);

  const downloadMemo = async () => {
    if (!service?.attachments?.memo) return;
    setDownloading(true);
    try {
      const response = await healthServicesApi.getAttachmentSignedUrl(service.id, 'memo');
      const url = response?.url;
      if (!url) throw new Error('Could not generate download link');
      
      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = service.attachments.memo.filename || 'memo.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to download memo:', err);
    } finally {
      setDownloading(false);
      onClose();
    }
  };

  return (
    <SharedActionMenu open={open} onOpenChange={(nextOpen) => (nextOpen ? onToggle() : onClose())}>
      <ActionMenuTrigger
        label="Service actions"
        disabled={busy || downloading}
        className="xl:h-8 xl:w-8"
      />
      <ActionMenuContent aria-label="Service actions">
        {service?.attachments?.memo && (
          <ActionMenuItem icon={FileText} onSelect={downloadMemo} disabled={downloading}>
            {downloading ? "Downloading..." : "Memo"}
          </ActionMenuItem>
        )}
        {canEdit && <ActionMenuItem icon={Pencil} onSelect={onEdit}>Edit</ActionMenuItem>}
        {canEdit && <ActionMenuItem icon={Power} onSelect={onToggleActive}>{active ? "Deactivate" : "Reactivate"}</ActionMenuItem>}
        {canDelete && <ActionMenuItem icon={Trash2} danger onSelect={onDelete}>Delete</ActionMenuItem>}
      </ActionMenuContent>
    </SharedActionMenu>
  );
}

const REG_STATUS_BADGE = {
  Registered: "bg-brand-blue/10 text-brand-blue",
  Attended: "bg-brand-green/10 text-brand-green",
  "Service Completed": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
  Rescheduled: "bg-brand-yellow/15 text-[#9A6B00] dark:text-amber-300",
};

// Resident-facing status derived from the plan + attendance, for the staff list.
const registrationLabel = (reg) => {
  if (reg.status === "Cancelled") return "Cancelled";
  const att = reg.attendance?.status;
  if (att === "missed" || att === "absent") return "Missed";
  if (att === "rescheduled") return "Rescheduled";
  if (reg.attendance?.serviceCompleted) return "Service Completed";
  if (att === "attended" || att === "walk_in") return "Attended";
  return "Registered";
};

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const manilaTimeNow = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const serviceScheduleOf = (service) => service?.schedule || service || {};
const missedWindowHasPassedUi = (service, scheduledDate) => {
  if (!scheduledDate) return false;
  const today = manilaToday();
  if (scheduledDate < today) return true;
  if (scheduledDate > today) return false;
  const schedule = serviceScheduleOf(service);
  const endTime = String(schedule.endTime || schedule.end_time || "23:59").slice(0, 5);
  return manilaTimeNow() >= endTime;
};
const serviceDateNeedsCorrectionReason = (service, registration, actualDate) => {
  const attendance = registration?.attendance || {};
  if (attendance.serviceCompleted || ["missed", "absent"].includes(attendance.status)) return true;
  if (!registration?.plannedDate || registration.plannedDate < manilaToday() || actualDate !== registration.plannedDate) return true;
  return missedWindowHasPassedUi(service, registration.plannedDate);
};
const serviceDeliveryMaxDate = (service) => {
  const schedule = serviceScheduleOf(service);
  return schedule.endDate && schedule.endDate < manilaToday() ? schedule.endDate : manilaToday();
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
 * their registration status and timestamp, with attendance marking. Cancelled
 * registrations remain visible but cannot receive attendance or service actions.
 */
function RegistrationsModal({ service, state, canEdit, attBusy, onReload, onMark, onSaveDelivery, onClose, supervisor = false, followUpStart = null }) {
  const { loading, error, registrations, counts } = state;
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deliveryTarget, setDeliveryTarget] = useState(null);
  const [missedTarget, setMissedTarget] = useState(null);
  const [attendanceTarget, setAttendanceTarget] = useState(null);
  const [attendanceDetailId, setAttendanceDetailId] = useState(null);
  const attendanceDetail = attendanceDetailId
    ? registrations.find((registration) => registration.id === attendanceDetailId) || null
    : null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (missedTarget) setMissedTarget(null);
      else if (attendanceTarget) setAttendanceTarget(null);
      else if (deliveryTarget) setDeliveryTarget(null);
      else onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deliveryTarget, missedTarget, attendanceTarget, onClose]);

  useEffect(() => {
    if (!followUpStart?.id || !followUpStart?.residentId || !service) return;
    setDeliveryTarget({
      id: `follow-up-${followUpStart.id}`,
      residentId: followUpStart.residentId,
      residentName: followUpStart.residentName || "Selected resident",
      plannedDate: followUpStart.scheduledDate || new Date().toISOString().slice(0, 10),
      attendance: null,
      followUpId: followUpStart.id,
    });
  }, [followUpStart?.id, followUpStart?.residentId, followUpStart?.residentName, followUpStart?.scheduledDate, service?.id]);

  const hasCancelled = registrations.some((reg) => reg.status === "Cancelled")
    || (Number.isFinite(counts?.cancelled) && counts.cancelled > 0);
  const filtered = registrations.filter((reg) => {
    const query = searchQuery.trim().toLowerCase();
    const label = registrationLabel(reg);
    const matchesSearch = !query
      || String(reg.residentName || "").toLowerCase().includes(query)
      || String(reg.barangay || "").toLowerCase().includes(query);
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "attended" && label === "Attended")
      || (statusFilter === "completed" && label === "Service Completed")
      || (statusFilter === "pending" && label === "Registered")
      || (statusFilter === "absent" && label === "Missed")
      || (statusFilter === "rescheduled" && label === "Rescheduled")
      || (statusFilter === "cancelled" && label === "Cancelled");
    return matchesSearch && matchesStatus;
  });
  const statusOptions = [
    ["all", "All"],
    ["attended", "Attended"],
    ["completed", "Service Completed"],
    ["pending", "Pending"],
    ["absent", "Missed / Not Attended"],
    ...(registrations.some((reg) => registrationLabel(reg) === "Rescheduled") ? [["rescheduled", "Rescheduled"]] : []),
    ...(hasCancelled ? [["cancelled", "Cancelled"]] : []),
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Registrations for ${service.name}`}>
      <Card className={`flex h-dvh max-h-dvh w-full max-w-3xl flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-lg ${supervisor ? "supervisor-modal" : ""}`}>
        <div className="shrink-0 p-4 pb-3 sm:p-5 sm:pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-brand-ink">{service.name}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">{followUpStart?.id ? "Record service for the selected follow-up resident." : "Registered residents and attendance."}</p>
              {scheduleSummary(service.schedule) && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-brand-ink">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-brand-blue" /> {scheduleSummary(service.schedule)}
                </p>
              )}
              {service.schedule?.registrationDeadline && (
                <p className="mt-0.5 text-xs text-brand-gray">
                  Registration closes {scheduleDateFmt(service.schedule.registrationDeadline.slice(0, 10))}, {formatTime(service.schedule.registrationDeadline.slice(11, 16))}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-brand-gray hover:bg-brand-bg hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          {counts && !loading && !error && (
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-y border-brand-border/70 py-2.5 dark:border-border">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs text-brand-gray">Total Registered</dt>
                <dd className="font-stat text-sm font-semibold text-brand-ink">{counts.registered}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs text-brand-gray">Attended</dt>
                <dd className="font-stat text-sm font-semibold text-brand-green">{counts.attended}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs text-brand-gray">Service Completed</dt>
                <dd className="font-stat text-sm font-semibold text-emerald-700 dark:text-emerald-300">{counts.serviceCompleted || 0}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs text-brand-gray">Pending</dt>
                <dd className="font-stat text-sm font-semibold text-brand-ink">{counts.pendingAttendance}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs text-brand-gray">Missed / Not Attended</dt>
                <dd className="font-stat text-sm font-semibold text-brand-danger">{counts.absent}</dd>
              </div>
              {hasCancelled && (
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-xs text-brand-gray">Cancelled</dt>
                  <dd className="font-stat text-sm font-semibold text-brand-gray">{counts.cancelled}</dd>
                </div>
              )}
            </dl>
          )}

          {!loading && !error && registrations.length > 0 && (
            <div className="mt-3 space-y-2">
              <label className="flex min-h-10 items-center gap-2 rounded-btn border border-brand-border bg-white px-3 dark:border-border dark:bg-input">
                <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search by resident name or barangay"
                  placeholder="Search residents or barangays"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-brand-gray/70"
                />
              </label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter registrations by attendance status">
                {statusOptions.map(([status, label]) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={statusFilter === status}
                    onClick={() => setStatusFilter(status)}
                    className={`min-h-8 rounded-btn px-2.5 text-xs font-medium transition-colors ${
                      statusFilter === status
                        ? "bg-brand-blue text-white"
                        : "border border-brand-border text-brand-ink hover:border-brand-blue hover:text-brand-blue dark:border-border"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5">
          {error ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-brand-danger">{error}</p>
              <button onClick={onReload} className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </div>
          ) : loading ? (
            <p className="py-10 text-center text-sm text-brand-gray">Loading registrations…</p>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-brand-gray/40" />
              <p className="text-sm text-brand-gray">
                {registrations.length === 0
                  ? "No residents have registered for this service yet."
                  : searchQuery
                    ? "No residents match your search and selected status."
                    : "No registrations match the selected status."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-brand-border/70 border-y border-brand-border/70 dark:divide-border dark:border-border">
              {filtered.map((reg) => {
                const label = registrationLabel(reg);
                return (
                  <div key={reg.id} className="py-3 first:pt-3 last:pb-3">
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-brand-ink">{reg.residentName}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REG_STATUS_BADGE[label] || "bg-brand-gray/10 text-brand-gray"}`}>{label}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-gray">
                          {reg.barangay && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{reg.barangay}</span>}
                          {reg.plannedDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" aria-hidden="true" />Scheduled {formatDate(reg.plannedDate)}</span>}
                          {reg.registeredAt && <span>Registered {formatDateTime(reg.registeredAt)}</span>}
                        </div>
                        {reg.note && <p className="mt-1 text-xs text-brand-gray">Registration note: {reg.note}</p>}
                      </div>
                    </div>
                    {reg.attendance?.serviceCompleted && reg.attendance.serviceProvided && (
                      <button
                        type="button"
                        onClick={() => setAttendanceDetailId(reg.id)}
                        className="mt-2 text-xs font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                      >
                        View Record
                      </button>
                    )}
                    {canEdit && reg.status !== "Cancelled" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(label === "Registered" || label === "Missed") && (
                          <button
                            type="button"
                            onClick={() => (label === "Missed" || missedWindowHasPassedUi(service, reg.plannedDate))
                              ? setAttendanceTarget(reg)
                              : void onMark(reg, "attended")}
                            disabled={attBusy === reg.residentId || reg.plannedDate > manilaToday()}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-btn border border-brand-green/40 px-3 text-xs font-medium text-brand-green transition-colors hover:bg-brand-green/5 disabled:opacity-60"
                          >
                            <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> {label === "Missed" ? "Correct attendance" : "Mark Attended"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeliveryTarget(reg)}
                          disabled={attBusy === reg.residentId}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-btn bg-brand-blue px-3 text-xs font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                        >
                          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> {reg.attendance?.serviceCompleted ? "Edit service record" : "Record Service"}
                        </button>
                        {label !== "Missed" && label !== "Attended" && label !== "Service Completed" && (
                          <button
                            type="button"
                            onClick={() => setMissedTarget(reg)}
                            disabled={attBusy === reg.residentId || !missedWindowHasPassedUi(service, reg.plannedDate)}
                            title={!missedWindowHasPassedUi(service, reg.plannedDate) ? "The scheduled attendance window has not ended yet." : undefined}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-btn border border-brand-danger/40 px-3 text-xs font-medium text-brand-danger transition-colors hover:bg-brand-danger/5 disabled:opacity-60"
                          >
                            <UserX className="h-3.5 w-3.5" aria-hidden="true" /> Mark as Missed
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
          )}
        </div>
      </Card>
      {missedTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="missed-confirm-title" aria-describedby="missed-confirm-description">
          <div className="w-full max-w-sm rounded-lg border border-brand-border bg-white p-5 shadow-lg dark:border-border dark:bg-card">
            <h4 id="missed-confirm-title" className="text-base font-semibold text-brand-ink">Mark registration as missed?</h4>
            <p id="missed-confirm-description" className="mt-2 text-sm text-brand-gray">
              Record {missedTarget.residentName} as not attended for this service?
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setMissedTarget(null)} className="min-h-9 rounded-btn border border-brand-border px-3 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:border-border dark:hover:bg-hover">Cancel</button>
              <button
                type="button"
                onClick={() => { const target = missedTarget; setMissedTarget(null); void onMark(target, "missed"); }}
                disabled={attBusy === missedTarget.residentId || !missedWindowHasPassedUi(service, missedTarget.plannedDate)}
                className="min-h-9 rounded-btn bg-brand-danger px-3 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-60"
              >
                Confirm missed
              </button>
            </div>
          </div>
        </div>
      )}
      {attendanceTarget && (
        <AttendanceCorrectionModal
          registration={attendanceTarget}
          wasMissed={registrationLabel(attendanceTarget) === "Missed"}
          busy={attBusy === attendanceTarget.residentId}
          onClose={() => setAttendanceTarget(null)}
          onSave={async (reason) => {
            const saved = await onMark(attendanceTarget, "attended", reason);
            if (saved) setAttendanceTarget(null);
          }}
        />
      )}
      {deliveryTarget && (
        <ServiceDeliveryModal
          service={service}
          registration={deliveryTarget}
          busy={attBusy === deliveryTarget.residentId}
          onClose={() => setDeliveryTarget(null)}
          onSave={async (values) => {
            const saved = await onSaveDelivery(deliveryTarget, values);
            if (saved) setDeliveryTarget(null);
          }}
        />
      )}
      <UniversalDetailsModal
        open={Boolean(attendanceDetail)}
        onClose={() => setAttendanceDetailId(null)}
        record={attendanceDetail ? {
          title: `${attendanceDetail.residentName} — ${service.name}`,
          category: "Service Delivery Record",
          status: registrationLabel(attendanceDetail),
          description: attendanceDetail.attendance?.serviceProvided,
          information: [
            { label: "Assessment", value: attendanceDetail.attendance?.assessment },
            { label: "Recommendations", value: attendanceDetail.attendance?.recommendations },
            {
              label: "Immunization",
              value: attendanceDetail.attendance?.immunization
                ? [
                  attendanceDetail.attendance.immunization.vaccine,
                  attendanceDetail.attendance.immunization.dose,
                  attendanceDetail.attendance.immunization.status,
                  attendanceDetail.attendance.immunization.administeredDate
                    ? formatDate(attendanceDetail.attendance.immunization.administeredDate)
                    : "",
                ].filter(Boolean).join(" · ")
                : "",
            },
            {
              label: "Follow-up",
              value: attendanceDetail.attendance?.followUpRequired
                ? attendanceDetail.attendance.followUpDate || "Required"
                : "",
            },
            { label: "Recorded By", value: attendanceDetail.attendance?.providedByName },
          ],
          sections: attendanceDetail.attendance?.notes
            ? [{ title: "Notes", content: attendanceDetail.attendance.notes }]
            : [],
        } : null}
      />
    </div>
  );
}

// Renders or manages ServiceDeliveryModal logic.
function ServiceDeliveryModal({ service, registration, busy, onClose, onSave }) {
  const previous = registration.attendance || {};
  const previousImmunization = previous.immunization || {};
  const isImmunization = String(service.category || '').toLowerCase() === 'immunization';
  const [form, setForm] = useState(() => ({
    service_provided: previous.serviceProvided || "",
    service_provided_date: previous.serviceProvidedDate || registration.plannedDate || manilaToday(),
    correction_reason: "",
    assessment: previous.assessment || "",
    recommendations: previous.recommendations || "",
    follow_up_required: Boolean(previous.followUpRequired),
    follow_up_date: previous.followUpDate || "",
    notes: previous.notes || "",
    vaccine: previousImmunization.vaccine || "BCG",
    dose: previousImmunization.dose || "",
    administered_date: previousImmunization.administeredDate || registration.plannedDate || manilaToday(),
    next_dose: previousImmunization.nextDose || "",
    immunization_status: previousImmunization.status || "Completed",
  }));
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  const fieldClass = "w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input";
  const submit = (event) => {
    event.preventDefault();
    if (isImmunization) {
      if (!form.vaccine.trim()) { setError("Select the vaccine."); return; }
      if (!form.service_provided_date) { setError("Enter the actual service date."); return; }
    } else {
      if (!form.service_provided.trim()) { setError("Describe the service or care provided."); return; }
      if (!form.service_provided_date) { setError("Enter the actual service date."); return; }
      if (form.follow_up_required && !form.follow_up_date) { setError("Choose a follow-up date."); return; }
    }
    if (serviceDateNeedsCorrectionReason(service, registration, form.service_provided_date) && !form.correction_reason.trim()) {
      setError("Add a reason for this late entry or correction.");
      return;
    }
    setError("");
    onSave(isImmunization ? {
      ...form,
      service_completed: true,
      service_provided_date: form.service_provided_date,
      administered_date: form.service_provided_date,
      immunization_status: "Completed",
      service_provided: `Immunization: ${form.vaccine}${form.dose ? ` (${form.dose})` : ''}`,
      follow_up_required: false,
      follow_up_date: null,
    } : { ...form, service_completed: true, follow_up_date: form.follow_up_required ? form.follow_up_date : null });
  };
  return (
    <FormModal
      title={registration.attendance?.serviceCompleted || registration.attendance?.serviceProvided ? "Update service record" : "Record delivered service"}
      description={`${service.name} · ${registration.residentName} · ${registration.plannedDate ? formatDate(registration.plannedDate) : "Scheduled visit"}`}
      onClose={onClose}
      dialogClassName="sm:max-w-2xl"
      footer={<>
        <button type="button" form="service-delivery-form" onClick={onClose} className="rounded-btn border border-brand-border px-4 py-2 text-sm text-brand-ink hover:bg-brand-bg">Cancel</button>
        <button type="submit" form="service-delivery-form" disabled={busy} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-60">{busy ? "Saving…" : "Save service record"}</button>
      </>}
    >
      <p className="mb-4 rounded-btn bg-brand-bg p-3 text-xs text-brand-gray">{isImmunization ? "This uses the existing Immunization record workflow. The vaccine record will also appear in Immunization and M1; the provider is taken from your signed-in account." : "Saving records the completed service in the resident's Health Records. The logged-in staff account is recorded automatically."}</p>
      <form id="service-delivery-form" onSubmit={submit} className="space-y-4">
          {isImmunization ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <DeliveryField label="Vaccine" required><select value={form.vaccine} onChange={set("vaccine")} className={fieldClass}>{["BCG", "Hepatitis B", "Pentavalent (DPT-HepB-Hib)", "OPV", "IPV", "PCV", "MMR", "Measles", "Tetanus Toxoid", "COVID-19", "Influenza", "Other"].map((vaccine) => <option key={vaccine}>{vaccine}</option>)}</select></DeliveryField>
              <DeliveryField label="Dose"><select value={form.dose} onChange={set("dose")} className={fieldClass}><option value="">Select dose…</option>{["1st dose", "2nd dose", "3rd dose", "Booster", "Annual", "Single dose", "Other"].map((dose) => <option key={dose}>{dose}</option>)}</select></DeliveryField>
              <DeliveryField label="Date administered" required><input type="date" min={serviceScheduleOf(service).startDate || undefined} max={serviceDeliveryMaxDate(service)} value={form.service_provided_date} onChange={(event) => setForm((current) => ({ ...current, service_provided_date: event.target.value, administered_date: event.target.value }))} className={fieldClass} /></DeliveryField>
              <DeliveryField label="Next dose"><input type="date" value={form.next_dose} onChange={set("next_dose")} className={fieldClass} /></DeliveryField>
              <p className="self-end text-xs text-brand-gray">Provider will be recorded from your signed-in account.</p>
            </div>
          ) : (
            <>
              <DeliveryField label="Date service was provided" required><input type="date" min={serviceScheduleOf(service).startDate || undefined} max={serviceDeliveryMaxDate(service)} value={form.service_provided_date} onChange={set("service_provided_date")} className={fieldClass} /></DeliveryField>
              <DeliveryField label="Service or care provided" required><textarea rows={3} maxLength={5000} value={form.service_provided} onChange={set("service_provided")} className={fieldClass} placeholder="Describe the program service, care, or procedure delivered." /></DeliveryField>
              <DeliveryField label="Assessment / observations"><textarea rows={3} maxLength={5000} value={form.assessment} onChange={set("assessment")} className={fieldClass} placeholder="Record assessment findings or relevant observations." /></DeliveryField>
              <DeliveryField label="Recommendations"><textarea rows={3} maxLength={5000} value={form.recommendations} onChange={set("recommendations")} className={fieldClass} placeholder="Add advice, instructions, or recommendations." /></DeliveryField>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm font-medium text-brand-ink"><input type="checkbox" checked={form.follow_up_required} onChange={set("follow_up_required")} className="h-4 w-4 accent-brand-blue" /> Follow-up required</label>
                {form.follow_up_required && <DeliveryField label="Follow-up date" required><input type="date" value={form.follow_up_date} onChange={set("follow_up_date")} className={fieldClass} /></DeliveryField>}
              </div>
            </>
          )}
          {serviceDateNeedsCorrectionReason(service, registration, form.service_provided_date) && (
            <DeliveryField label="Reason for late entry or correction" required><textarea rows={2} maxLength={1000} value={form.correction_reason} onChange={set("correction_reason")} className={fieldClass} placeholder="Explain why this service is being entered late or corrected." /></DeliveryField>
          )}
          <DeliveryField label="Additional notes"><textarea rows={2} maxLength={2000} value={form.notes} onChange={set("notes")} className={fieldClass} placeholder="Optional notes" /></DeliveryField>
          {error && <p role="alert" className="text-sm text-brand-danger">{error}</p>}
      </form>
    </FormModal>
  );
}

// Renders or manages AttendanceCorrectionModal logic.
function AttendanceCorrectionModal({ registration, wasMissed, busy, onClose, onSave }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="attendance-correction-title">
      <Card className="w-full max-w-md p-5 sm:p-6">
        <h4 id="attendance-correction-title" className="text-base font-semibold text-brand-ink">{wasMissed ? "Correct missed attendance" : "Record late attendance"}</h4>
        <p className="mt-2 text-sm text-brand-gray">{wasMissed
          ? "Confirm that " + registration.residentName + " attended this service, and explain why the missed status is being corrected."
          : "Confirm that " + registration.residentName + " attended this service, and explain why the attendance is being recorded after its scheduled window."}</p>
        <label className="mt-4 block space-y-1.5 text-sm font-medium text-brand-ink">Correction reason <span className="text-brand-danger">*</span>
          <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input" placeholder="Reason for correcting the missed status" />
        </label>
        {error && <p role="alert" className="mt-2 text-sm text-brand-danger">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="min-h-10 rounded-btn border border-brand-border px-4 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:border-border dark:hover:bg-hover">Cancel</button>
          <button type="button" disabled={busy} onClick={() => { if (!reason.trim()) { setError("Enter a correction reason."); return; } void onSave(reason.trim()); }} className="min-h-10 rounded-btn bg-brand-blue px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Saving…" : "Confirm attendance"}</button>
        </div>
      </Card>
    </div>
  );
}

// Renders or manages DeliveryField logic.
function DeliveryField({ label, required = false, children }) {
  return <label className="block space-y-1.5 text-sm font-medium text-brand-ink">{label}{required && <span className="ml-1 text-brand-danger">*</span>}{children}</label>;
}
