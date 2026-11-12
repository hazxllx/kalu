// @ts-nocheck
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import TablePagination from "@/components/tables/TablePagination";
import StatusBadge from "@/components/common/StatusBadge";
import PriorityBadge from "@/features/follow-ups/components/PriorityBadge";
import FollowUpStatusBadge from "@/features/follow-ups/components/FollowUpStatusBadge";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import TimePicker from "@/components/common/TimePicker";
import { Search, Plus, Calendar, MapPin, User, X, CheckCircle2, MoreVertical, AlertTriangle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { isHealthSupervisor, getSupervisorScope } from "@/lib/supervisorScope";
import { healthServicesApi } from "@/services/api";
import {
  createFollowUpOffline,
  listFollowUpsOffline,
  listFollowUpResidentsOffline,
  updateFollowUpOffline,
} from "@/services/offline/followUpOfflineService";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import {
  filterFollowUps,
  followUpManagementStatus,
  isPastSameDaySchedule,
  manilaDateKey,
  summarizeFollowUps,
} from "../lib/scheduleDates";
import { followUpActionAvailability } from "../lib/followUpActions";

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

const emptyScheduleForm = (personnel) => ({
  date: manilaDateKey(),
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

const formatDate = (isoDate, compact = false) => {
  if (!isoDate) return "";
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: compact ? "short" : "long", day: "numeric" });
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
  return isoDate < todayISO();
};

const todayISO = () => manilaDateKey();

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
  if (Number.isNaN(new Date(`${isoDate}T00:00:00`).getTime())) return "Scheduled";
  const today = todayISO();
  if (isoDate === today) return "Today";
  if (isoDate > today) return "Upcoming";
  return "Scheduled";
};

const ageFromBirthDate = (birthDate) => {
  const birth = String(birthDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return "";
  const today = manilaDateKey();
  const age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0);
  return age >= 0 && age <= 120 ? age : "";
};

/** Map a persisted follow_ups row (snake_case) to the table's view shape. */
const mapFollowUpRow = (row) => ({
  ...row,
  id: row.id,
  residentId: row.resident_id || row.residentId,
  resident: typeof row.resident === "string" ? row.resident : [row.resident?.first_name, row.resident?.middle_name, row.resident?.last_name].filter(Boolean).join(" ") || row.residentName || "Resident name unavailable",
  barangay: row.resident?.barangay || row.barangay || "",
  sex: row.resident?.sex || "",
  contact: row.resident?.cellphone_no || "",
  age: ageFromBirthDate(row.resident?.birth_date),
  purpose: row.purpose,
  type: row.purpose,
  consultation: row.consultation || null,
  scheduledDateRaw: row.scheduled_date || row.date,
  scheduledTimeRaw: row.scheduled_time || row.time,
  scheduledDate: formatDate(row.scheduled_date || row.date),
  scheduledTime: formatTime(row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : row.time),
  location: typeof row.location === "string" ? row.location.trim() : "",
  priority: row.priority,
  status: followUpManagementStatus(
    row.status,
    row.scheduled_date || row.date,
    new Date(),
    row.resident_decision,
  ),
  assignedMidwife: row.assigned_provider || row.provider,
  remarks: row.notes || row.instructions,
  offline: row.offline || false,
  syncStatus: row.syncStatus || null,
});

const mergeFollowUpRecord = (current, record) => {
  const resident = record.resident && typeof record.resident === "object" ? record.resident : null;
  const mapped = mapFollowUpRow({
    ...current,
    ...record,
    resident,
    residentName: record.residentName || current.resident,
    barangay: resident?.barangay || record.barangay || current.barangay,
    purpose: record.purpose ?? current.purpose,
    scheduled_date: record.scheduled_date ?? current.scheduledDateRaw,
    scheduled_time: record.scheduled_time ?? current.scheduledTimeRaw,
    location: record.location ?? current.location,
    priority: record.priority ?? current.priority,
    status: record.status ?? current.status,
    assigned_provider: record.assigned_provider ?? current.assignedMidwife,
    notes: record.notes ?? current.remarks,
    resident_decision: record.resident_decision ?? current.resident_decision,
    requires_resident_response: record.requires_resident_response ?? current.requires_resident_response,
  });
  return {
    ...mapped,
    resident: resident ? mapped.resident || current.resident : current.resident,
    barangay: resident?.barangay || record.barangay || current.barangay,
    sex: resident?.sex || current.sex,
    contact: resident?.cellphone_no || current.contact,
    age: resident?.birth_date ? mapped.age : current.age,
    consultation: record.consultation ?? current.consultation,
  };
};

const CLOSED_FOLLOW_UP_STATUSES = new Set(["Completed", "Cancelled", "Rejected"]);
const TERMINAL_FOLLOW_UP_STATUSES = new Set(["Completed", "Missed", "Cancelled", "Rejected"]);
const isOverdue = (row) => {
  const date = String(row.scheduledDateRaw || "").slice(0, 10);
  return !TERMINAL_FOLLOW_UP_STATUSES.has(row.status) && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00+08:00`)) && date < manilaDateKey();
};
const FOLLOW_UP_STATUS_FILTERS = [
  "All",
  "Today",
  "Upcoming",
  "Scheduled",
  "Ongoing",
  "Completed",
  "Missed",
  "Cancelled",
  "Rejected",
];

export default function MidwifeFollowUp() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can, canAny, matrixLoadState } = usePermissions();
  const supervisor = isHealthSupervisor(user);
  const supervisorScope = supervisor ? getSupervisorScope(user) : null;
  const assignedBarangay = supervisorScope?.level === "barangay" ? supervisorScope.assignedBarangay : null;
  const scopeReady = !supervisor || Boolean(assignedBarangay);
  const canViewFollowUps = can("followups.view");
  const canScheduleFollowUp = can("followups.create") && scopeReady;
  const canEditFollowUp = can("followups.edit") && scopeReady;
  const canCompleteFollowUp = can("followups.complete") && scopeReady;
  const canRecordVisit = canAny(["followups.edit", "followups.complete"]) && scopeReady;
  const canUpdateFollowUpStatus = canEditFollowUp || canCompleteFollowUp;
  // Health Supervisor scope: only their single assigned barangay. Rows,
  // statistics, resident options and personnel options are all limited to it.
  const inScope = (f) => !supervisor || Boolean(assignedBarangay) &&
    String(f.barangay || "").trim().toLowerCase() === assignedBarangay.toLowerCase();
  const followUpParam = supervisor ? searchParams.get("followup") || "" : "";
  const statusParam = supervisor && ["Overdue", "Pending", ...FOLLOW_UP_STATUS_FILTERS].includes(searchParams.get("status")) ? searchParams.get("status") : "All";

  // A FOLLOW-UP happens within the Health Supervisor's own assigned barangay
  // context, so its venue is their assigned Barangay Health Station (or a Home
  // Visit inside that barangay) — never an arbitrary facility/barangay. This is
  // distinct from a REFERRAL, which routes a resident to another facility and
  // therefore keeps its own destination-facility selection. The follow-up
  // record's barangay is already force-derived from the resident server-side
  // (sync_operational_scope trigger); this only fixes the human venue label so a
  // barangay-scoped supervisor cannot mislabel a follow-up at an unrelated site.
  const assignedBHS = assignedBarangay ? `${assignedBarangay} Barangay Health Station` : null;
  const followUpLocationOptions = assignedBarangay ? [assignedBHS, "Home Visit"] : FOLLOW_UP_LOCATIONS;
  const defaultFollowUpLocation = assignedBHS || FOLLOW_UP_LOCATIONS[0];

  const [followUps, setFollowUps] = useState([]);
  const [residentsFromApi, setResidentsFromApi] = useState([]);
  const [personnelFromApi, setPersonnelFromApi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadedOwner, setLoadedOwner] = useState(null);
  const [followUpSource, setFollowUpSource] = useState(null);
  const [deepLinkError, setDeepLinkError] = useState("");
  const openedDeepLink = useRef("");
  const [directoryLoadError, setDirectoryLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const loadRequest = useRef(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(statusParam);
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [followUpPage, setFollowUpPage] = useState(1);
  const [followUpPageSize, setFollowUpPageSize] = useState(8);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showRecordVisitModal, setShowRecordVisitModal] = useState(false);
  const [showUpdateStatusModal, setShowUpdateStatusModal] = useState(false);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [statusConfirmation, setStatusConfirmation] = useState(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const [selectedResident, setSelectedResident] = useState(null);
  const [scheduleForm, setScheduleForm] = useState(() => emptyScheduleForm(""));
  const [visitForm, setVisitForm] = useState({
    visitDate: todayISO(),
    visitTime: "09:00",
    condition: "Stable",
    findings: "",
    treatment: "",
    advice: "",
    nextVisitDate: "",
  });
  const statusSubmitting = useRef(false);
  const scheduleSubmitting = useRef(false);
  const [remarksDraft, setRemarksDraft] = useState("");
  const [touched, setTouched] = useState({});
  const [toast, setToast] = useState(null);
  const { lastSyncedAt } = useSyncStatus();

  const load = React.useCallback(() => {
    const requestId = ++loadRequest.current;
    setLoading(true);
    setLoadError(null);
    setDirectoryLoadError(null);
    setFollowUpSource(null);
    if (supervisor && (!assignedBarangay || !canViewFollowUps)) {
      setFollowUps([]);
      setResidentsFromApi([]);
      setPersonnelFromApi([]);
      setLoading(matrixLoadState.status === "loading");
      if (matrixLoadState.status !== "loading") setLoadError(!assignedBarangay ? "A valid barangay assignment is required to access follow-ups." : "Your account is not permitted to view follow-ups.");
      return Promise.resolve();
    }
    return Promise.allSettled([
      listFollowUpsOffline({ ownerId: user?.id, onSource: (source) => { if (requestId === loadRequest.current) setFollowUpSource(source); } }),
      listFollowUpResidentsOffline({ ownerId: user?.id, params: { limit: 200 } }),
      healthServicesApi.personnel(),
    ])
      .then(([followUpResult, residentResult, personnelResult]) => {
        if (requestId !== loadRequest.current) return;
        const directoryErrors = [];
        if (followUpResult.status === "fulfilled") {
          const followUpRows = Array.isArray(followUpResult.value)
            ? followUpResult.value
            : followUpResult.value?.rows || [];
          const residentRows = residentResult.status === "fulfilled"
            ? residentResult.value?.rows || residentResult.value || []
            : [];
          setFollowUps(followUpRows.map((row) => {
            const resident = residentRows.find((item) => item.id === (row.resident_id || row.residentId));
            const residentName = resident
              ? [resident.firstName, resident.middleName, resident.lastName].filter(Boolean).join(" ")
              : row.residentName;
            return mapFollowUpRow({
              ...row,
              residentName: row.residentName || residentName,
              barangay: row.barangay || resident?.barangay || "",
            });
          }).filter(inScope));
          setLoadedOwner(user?.id);
        } else {
          setFollowUps([]);
          setLoadError(followUpResult.reason?.message || "Unable to load follow-ups. Please try again.");
        }

        if (residentResult.status === "fulfilled") {
          setResidentsFromApi(residentResult.value?.rows || residentResult.value || []);
        } else {
          setResidentsFromApi([]);
          directoryErrors.push(residentResult.reason?.message || "Unable to load the resident directory.");
        }
        if (personnelResult.status === "fulfilled") {
          setPersonnelFromApi(personnelResult.value?.rows || []);
        } else {
          setPersonnelFromApi([]);
          directoryErrors.push(personnelResult.reason?.message || "Unable to load health personnel.");
        }
        setDirectoryLoadError(directoryErrors.length ? directoryErrors.join(" ") : null);
      })
      .catch((error) => {
        if (requestId !== loadRequest.current) return;
        setFollowUps([]);
        setLoadError(error?.message || "The follow-up response was incomplete.");
      })
      .finally(() => requestId === loadRequest.current && setLoading(false));
  }, [user?.id, assignedBarangay, supervisor, canViewFollowUps, matrixLoadState.status]);

  useEffect(() => {
    load();
    return () => {
      loadRequest.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (lastSyncedAt) load();
  }, [lastSyncedAt, load]);

  useEffect(() => {
    if (supervisor) setStatusFilter(statusParam);
  }, [supervisor, statusParam]);
  useEffect(() => {
    setSelectedFollowUp(null);
    setShowDetailPanel(false);
    setShowScheduleModal(false);
    setShowRecordVisitModal(false);
    setShowUpdateStatusModal(false);
    setShowRemarksModal(false);
    setStatusConfirmation(null);
    setOpenActionMenu(null);
  }, [user?.id, assignedBarangay]);
  useEffect(() => {
    if (!followUpParam) {
      openedDeepLink.current = "";
      setDeepLinkError("");
      return;
    }
    const key = `${user?.id}:${assignedBarangay}:${followUpParam}`;
    if (loading || loadError || loadedOwner !== user?.id || openedDeepLink.current === key) return;
    if (!canViewFollowUps || !assignedBarangay) {
      setDeepLinkError("This follow-up is not available for your account's permission and barangay scope.");
      return;
    }
    const record = followUps.find((row) => String(row.id) === followUpParam && String(row.barangay || "").trim().toLowerCase() === assignedBarangay.toLowerCase());
    if (!record) {
      setDeepLinkError(followUpSource?.source === "cache" ? "This follow-up is not in your account's saved records. Reconnect and retry to load the authorized schedule." : "This follow-up was not found in your authorized barangay records.");
      return;
    }
    openedDeepLink.current = key;
    setDeepLinkError("");
    setSelectedFollowUp(record);
    setShowDetailPanel(true);
  }, [followUpParam, user?.id, assignedBarangay, loading, loadError, loadedOwner, followUps, canViewFollowUps, followUpSource]);

  const showToast = (message, ms = 3000, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), ms);
  };

  const persistFollowUp = async (id, patch, successMessage) => {
    setSaving(true);
    try {
      const result = await updateFollowUpOffline({ ownerId: user?.id, followUpId: id, record: patch });
      const record = result?.record || result;
      const updated = mapFollowUpRow(record);
      setFollowUps((prev) => prev.map((f) => (
        f.id === id ? mergeFollowUpRecord(f, record) : f
      )));
      load();
      if (successMessage) {
        showToast(result?.queued
          ? `${successMessage} Saved on this device; it will sync when a connection is available.`
          : successMessage, 3000, "success");
      }
      return updated;
    } catch (err) {
      showToast(err?.message || "Could not save changes.", 4000);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  // Auto-assign the logged-in user where possible — the dashboard shell
  // displays the role's display name, so prefer that for consistency.
  const currentUserName = user?.name || user?.email || "";
  const isRhuLocation = scheduleForm.location === "RHU";
  const isBarangayStation = scheduleForm.location.includes("Barangay Health Station");
  const assignableRoles = isRhuLocation ? ["rhu_personnel", "phn"] : ["health_supervisor", "phn"];
  const targetBarangayId = selectedResident?.barangayId || selectedResident?.barangay_id || user?.barangayId;
  const eligiblePersonnel = personnelFromApi.filter((person) =>
    assignableRoles.includes(person.role) &&
    (!isBarangayStation || person.role !== "health_supervisor" || !targetBarangayId || person.barangayId === targetBarangayId) &&
    (!assignedBarangay || !person.barangayId || person.barangayId === user?.barangayId),
  );
  const currentUserCanBeAssigned = assignableRoles.includes(user?.role);
  const currentUserOption = currentUserCanBeAssigned && currentUserName
    ? [{ id: user.id, name: currentUserName, role: user.role }]
    : [];
  const personnelOptions = [
    ...currentUserOption,
    ...eligiblePersonnel.filter((person) => person.id !== user?.id),
  ];
  const defaultPersonnel = personnelOptions.find((person) => person.id === user?.id)?.name || personnelOptions[0]?.name || "";
  const residentOptions = useMemo(() => residentsFromApi.map((r) => ({
    ...r,
    name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
    age: ageFromBirthDate(r.birthDate),
    gender: r.sex || "",
  })).filter((r) => !supervisor || assignedBarangay && r.barangay === assignedBarangay), [residentsFromApi, assignedBarangay, supervisor]);

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

  const authorizedFollowUps = loadedOwner === user?.id && scopeReady && (!supervisor || canViewFollowUps) ? followUps.filter(inScope) : [];
  const stats = summarizeFollowUps(authorizedFollowUps);
  const overdueCount = authorizedFollowUps.filter(isOverdue).length;

  const filteredFollowUps = filterFollowUps(authorizedFollowUps, {
    search: searchQuery,
    status: supervisor && statusFilter === "Overdue" ? "All" : statusFilter,
    priority: priorityFilter,
  }).filter((row) => !supervisor || statusFilter !== "Overdue" || isOverdue(row));
  const pageFollowUps = filteredFollowUps.slice((followUpPage - 1) * followUpPageSize, followUpPage * followUpPageSize);
  useEffect(() => { setFollowUpPage(1); }, [searchQuery, statusFilter, priorityFilter]);
  useEffect(() => {
    setFollowUpPage((page) => Math.min(page, Math.max(1, Math.ceil(filteredFollowUps.length / followUpPageSize))));
  }, [filteredFollowUps.length, followUpPageSize]);
  const filtersActive = Boolean(
    searchQuery || statusFilter !== "All" || priorityFilter !== "All",
  );
  const loadErrorMessage = [
    loadError ? `Follow-up records: ${loadError}` : null,
    directoryLoadError ? `Scheduling directory: ${directoryLoadError}` : null,
  ].filter(Boolean).join(" ");

  const handleView = (followUp) => {
    if (supervisor && (!canViewFollowUps || !inScope(followUp))) return;
    setSelectedFollowUp(followUp);
    setShowDetailPanel(true);
  };
  const closeDetail = () => {
    setShowDetailPanel(false);
    if (followUpParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("followup");
      setSearchParams(next, { replace: true });
    }
  };

  const handleRecordVisit = (followUp) => {
    if (!canRecordVisit) {
      showToast("You do not have permission to record follow-up visits.");
      return;
    }
    if (
      followUp.status === "Pending" ||
      (followUp.requires_resident_response && followUp.resident_decision !== "approved") ||
      String(followUp.scheduledDateRaw || "").slice(0, 10) > todayISO()
    ) {
      showToast("This follow-up cannot be recorded as a completed visit yet.");
      return;
    }
    setSelectedFollowUp(followUp);
    setVisitForm({
      visitDate: todayISO(),
      visitTime: "09:00",
      condition: "Stable",
      findings: "",
      treatment: "",
      advice: "",
      nextVisitDate: "",
    });
    setShowRecordVisitModal(true);
  };

  const handleUpdateStatus = (followUp) => {
    if (!canUpdateFollowUpStatus) {
      showToast("You do not have permission to update follow-up status.");
      return;
    }
    setSelectedFollowUp(followUp);
    setShowUpdateStatusModal(true);
  };

  const handleAddRemarks = (followUp) => {
    if (!canEditFollowUp) {
      showToast("You do not have permission to edit follow-up notes.");
      return;
    }
    setSelectedFollowUp(followUp);
    setRemarksDraft(followUp.remarks || "");
    setShowRemarksModal(true);
  };

  const handleEditFollowUp = (followUp) => {
    if (!canEditFollowUp || CLOSED_FOLLOW_UP_STATUSES.has(followUp.status)) {
      showToast("You do not have permission to edit this follow-up.");
      return;
    }
    const resident = residentOptions.find((item) => item.id === followUp.residentId) || {
      id: followUp.residentId,
      name: followUp.resident,
      age: followUp.age,
      gender: followUp.sex,
      barangay: followUp.barangay,
    };
    setSelectedFollowUp(followUp);
    setSelectedResident(resident);
    setTouched({});
    setScheduleForm({
      date: String(followUp.scheduledDateRaw || "").slice(0, 10),
      time: String(followUp.scheduledTimeRaw || "").slice(0, 5) || "09:00",
      type: followUp.type || "General Check-up",
      reason: followUp.purpose || "",
      location: followUp.location || defaultFollowUpLocation,
      priority: followUp.priority || "Medium",
      notes: followUp.remarks || "",
      personnel: followUp.assignedMidwife || defaultPersonnel,
    });
    setShowScheduleModal(true);
  };

  const handleCompleteFollowUp = (followUp) => {
    if (!followUpActionAvailability(followUp, { canComplete: canCompleteFollowUp }).complete) {
      showToast("This follow-up is not eligible to be completed yet, or you do not have permission.");
      return;
    }
    setSelectedFollowUp(followUp);
    setStatusConfirmation("Completed");
  };

  const handleConfirmableStatus = (followUp, nextStatus) => {
    const actions = followUpActionAvailability(followUp, {
      canEdit: canEditFollowUp,
      canComplete: canCompleteFollowUp,
    });
    const permitted = nextStatus === "Cancelled" ? actions.cancel : actions.missed;
    if (!permitted) {
      showToast(`You do not have permission to mark this follow-up ${nextStatus.toLowerCase()}.`);
      return;
    }
    setSelectedFollowUp(followUp);
    setStatusConfirmation(nextStatus);
  };

  const handleActionClick = (action, followUp) => {
    setOpenActionMenu(null);
    switch (action) {
      case 'view':
        handleView(followUp);
        break;
      case 'edit':
        handleEditFollowUp(followUp);
        break;
      case 'recordVisit':
        handleRecordVisit(followUp);
        break;
      case 'updateStatus':
        handleUpdateStatus(followUp);
        break;
      case 'addRemarks':
        handleAddRemarks(followUp);
        break;
      case 'complete':
        handleCompleteFollowUp(followUp);
        break;
      case 'missed':
        handleConfirmableStatus(followUp, "Missed");
        break;
      case 'cancel':
        handleConfirmableStatus(followUp, "Cancelled");
        break;
      default:
        break;
    }
  };

  const ActionsDropdown = ({ followUp }) => {
    const isOpen = openActionMenu === followUp.id;
    const actions = followUpActionAvailability(followUp, {
      canEdit: canEditFollowUp,
      canComplete: canCompleteFollowUp,
      canRecordVisit,
    });
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const [menuPosition, setMenuPosition] = useState(null);

    useLayoutEffect(() => {
      if (!isOpen) {
        setMenuPosition(null);
        return undefined;
      }

      const updatePosition = () => {
        const trigger = triggerRef.current;
        const menu = menuRef.current;
        if (!trigger || !menu) return;

        const triggerRect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(
          margin,
          Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - margin),
        );
        const spaceBelow = window.innerHeight - triggerRect.bottom - margin;
        const spaceAbove = triggerRect.top - margin;
        const preferredTop = spaceBelow >= menuRect.height || spaceBelow >= spaceAbove
          ? triggerRect.bottom + 4
          : triggerRect.top - menuRect.height - 4;
        const top = Math.max(
          margin,
          Math.min(preferredTop, window.innerHeight - menuRect.height - margin),
        );
        setMenuPosition({ left, top });
      };

      updatePosition();
      window.addEventListener("resize", updatePosition);
      document.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        document.removeEventListener("scroll", updatePosition, true);
      };
    }, [isOpen]);

    useEffect(() => {
      if (!isOpen) return undefined;
      const onPointerDown = (event) => {
        if (
          !triggerRef.current?.contains(event.target) &&
          !menuRef.current?.contains(event.target)
        ) {
          setOpenActionMenu(null);
        }
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          setOpenActionMenu(null);
          triggerRef.current?.focus();
        }
      };
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      return () => {
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };
    }, [isOpen]);

    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpenActionMenu(isOpen ? null : followUp.id)}
          className="rounded-md border border-transparent p-1.5 text-brand-gray transition-colors hover:border-brand-border hover:bg-brand-bg hover:text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          aria-label={`Actions for ${followUp.resident}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {isOpen && typeof document !== "undefined" && createPortal(
          <div
            ref={menuRef}
            role="menu"
            className={`fixed z-[60] max-h-[calc(100vh-1rem)] w-48 overflow-y-auto rounded-lg border border-brand-border bg-white py-1 shadow-lg ${supervisor ? "supervisor-menu" : ""}`}
            style={{
              left: menuPosition?.left ?? 0,
              top: menuPosition?.top ?? 0,
              visibility: menuPosition ? "visible" : "hidden",
            }}
          >
              <button
                type="button"
                role="menuitem"
                onClick={() => handleActionClick('view', followUp)}
                className="w-full px-3 py-2 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg"
              >
                View Details
              </button>
              {actions.edit && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick('edit', followUp)}
                  className="w-full px-3 py-2 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg"
                >
                  Edit / Reschedule
                </button>
              )}
              {actions.complete && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick('complete', followUp)}
                  className="w-full px-3 py-2 text-left text-sm text-brand-green transition-colors hover:bg-brand-bg"
                >
                  Mark as Completed
                </button>
              )}
              {actions.missed && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick('missed', followUp)}
                  className="w-full px-3 py-2 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg"
                >
                  Mark Missed
                </button>
              )}
              {actions.updateStatus && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick('updateStatus', followUp)}
                  className="w-full px-3 py-2 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg"
                >
                  Update Status
                </button>
              )}
              {actions.addRemarks && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick('addRemarks', followUp)}
                  className="w-full px-3 py-2 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg"
                >
                  Add Remarks
                </button>
              )}
              {actions.recordVisit && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick('recordVisit', followUp)}
                  className="w-full px-3 py-2 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg"
                >
                  Record Visit
                </button>
              )}
              {actions.cancel && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleActionClick('cancel', followUp)}
                  className="w-full px-3 py-2 text-left text-sm text-brand-danger transition-colors hover:bg-brand-danger/5"
                >
                  Cancel Follow-up
                </button>
              )}
          </div>,
          document.body,
        )}
      </>
    );
  };

  const confirmStatusAction = async () => {
    const target = selectedFollowUp;
    const nextStatus = statusConfirmation;
    if (!target || !nextStatus || statusSubmitting.current || saving) return;
    if (CLOSED_FOLLOW_UP_STATUSES.has(target.status)) {
      showToast("This follow-up is already closed.");
      setStatusConfirmation(null);
      return;
    }
    const actions = followUpActionAvailability(target, {
      canEdit: canEditFollowUp,
      canComplete: canCompleteFollowUp,
    });
    const eligible = nextStatus === "Cancelled"
      ? actions.cancel
      : nextStatus === "Missed"
        ? actions.missed
        : actions.complete;
    if (!eligible) {
      showToast("This follow-up is not eligible for that action, or you do not have permission.");
      return;
    }
    statusSubmitting.current = true;
    try {
      const successMessage = nextStatus === "Completed"
        ? "Follow-up marked as completed."
        : nextStatus === "Missed"
          ? "Follow-up marked as missed."
          : "Follow-up cancelled.";
      await persistFollowUp(target.id, { status: nextStatus }, successMessage);
      setStatusConfirmation(null);
      setSelectedFollowUp(null);
    } catch {
      /* toast already shown */
    } finally {
      statusSubmitting.current = false;
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    const canUpdateStatus = newStatus === "Missed" ? canCompleteFollowUp : canEditFollowUp;
    if (!canUpdateStatus) {
      showToast("You do not have permission to update this follow-up status.");
      return;
    }
    const target = selectedFollowUp;
    if (!target) return;
    try {
      await persistFollowUp(target.id, { status: newStatus }, `Status updated to ${newStatus}.`);
      setShowUpdateStatusModal(false);
      setSelectedFollowUp(null);
    } catch {
      /* toast already shown */
    }
  };

  const handleSaveRemarks = async (remarks) => {
    if (!canEditFollowUp) {
      showToast("You do not have permission to edit follow-up notes.");
      return;
    }
    const target = selectedFollowUp;
    if (!target) return;
    try {
      await persistFollowUp(target.id, { notes: remarks }, "Remarks saved successfully.");
      setShowRemarksModal(false);
      setSelectedFollowUp(null);
    } catch {
      /* toast already shown */
    }
  };

  const handleSaveVisit = async (visitData) => {
    const canSaveVisit = visitData?.nextVisitDate ? canEditFollowUp : canCompleteFollowUp;
    if (!canSaveVisit) {
      showToast(visitData?.nextVisitDate
        ? "You do not have permission to reschedule follow-ups."
        : "You do not have permission to complete follow-ups.");
      return;
    }
    const target = selectedFollowUp;
    if (!target) return;
    if (!visitData?.visitDate || visitData.visitDate > todayISO()) {
      showToast("Enter a valid visit date that is not in the future.");
      return;
    }
    if (!visitData?.visitTime || !visitData?.findings?.trim()) {
      showToast("Enter the visit time and findings before saving the visit.");
      return;
    }
    if (visitData.nextVisitDate && isPastDate(visitData.nextVisitDate)) {
      showToast("The next visit date must be today or a future date.");
      return;
    }
    const patch = { status: "Completed" };
    const visitNotes = [
      `Visit recorded: ${formatDate(visitData.visitDate)} at ${formatTime(visitData.visitTime)}`,
      `Resident condition: ${visitData.condition}`,
      `Findings: ${visitData.findings.trim()}`,
      visitData.treatment?.trim() && `Treatment: ${visitData.treatment.trim()}`,
      visitData.advice?.trim() && `Advice: ${visitData.advice.trim()}`,
    ].filter(Boolean).join("\n");
    patch.notes = [target.remarks?.trim(), visitNotes].filter(Boolean).join("\n\n");
    if (visitData?.nextVisitDate) {
      patch.scheduled_date = visitData.nextVisitDate;
      patch.status = "Scheduled";
      patch.completed_at = null;
    }
    try {
      await persistFollowUp(target.id, patch, "Visit recorded successfully.");
      setShowRecordVisitModal(false);
      setSelectedFollowUp(null);
    } catch {
      /* toast already shown */
    }
  };

  const openScheduleModal = () => {
    if (!canScheduleFollowUp) {
      showToast("You do not have permission to schedule follow-ups.");
      return;
    }
    setSelectedResident(null);
    setSelectedFollowUp(null);
    setTouched({});
    setScheduleForm({ ...emptyScheduleForm(defaultPersonnel), location: defaultFollowUpLocation });
    setShowScheduleModal(true);
  };

  // "Schedule Follow-up" from a completed PHN check-up arrives through router
  // state and pre-fills the patient and the encounter details, so nothing from
  // the check-up is re-typed.
  useEffect(() => {
    const draft = location.state?.followUpDraft;
    if (!draft || !canScheduleFollowUp) return;
    const notes = [
      draft.consultationLocation ? `Consultation Location: ${draft.consultationLocation}` : "",
      draft.reason ? `Reason for visit: ${draft.reason}` : "",
      draft.findings ? `PHN findings: ${draft.findings}` : "",
      draft.recommendations ? `Recommendations: ${draft.recommendations}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Match the draft's resident against the real directory (by id, then name).
    const matched =
      residentsFromApi.find((r) => r.id === draft.residentId) ||
      (!supervisor && residentsFromApi.find(
        (r) =>
          [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ").toLowerCase() ===
          String(draft.resident || "").toLowerCase(),
      )) ||
      null;

    setScheduleForm({
      ...emptyScheduleForm(defaultPersonnel),
      location: defaultFollowUpLocation,
      reason: draft.reason || draft.findings || "",
      priority: ["Low", "Medium", "High"].includes(draft.riskLevel) ? draft.riskLevel : "Medium",
      notes,
    });
    setSelectedResident(
      matched
        ? {
            ...matched,
            name: [matched.firstName, matched.middleName, matched.lastName].filter(Boolean).join(" "),
            gender: matched.sex || "",
          }
        : null,
    );
    setTouched({});
    setShowScheduleModal(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, residentsFromApi, defaultPersonnel, supervisor, canScheduleFollowUp]);

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
    time: touched.time && !scheduleForm.time
      ? "Please select a follow-up time."
      : isPastSameDaySchedule(scheduleForm.date, scheduleForm.time)
        ? "That time has already passed today. Choose a later time or another date."
        : "",
    reason: touched.reason && !scheduleForm.reason.trim() ? "Please enter the reason for the follow-up." : "",
  };

  const canSchedule =
    Boolean(selectedResident) &&
    Boolean(scheduleForm.date) &&
    !isPastDate(scheduleForm.date) &&
    Boolean(scheduleForm.time) &&
    !isPastSameDaySchedule(scheduleForm.date, scheduleForm.time) &&
    Boolean(scheduleForm.reason.trim());

  const canSaveSchedule = selectedFollowUp ? canEditFollowUp : canScheduleFollowUp;

  const handleSchedule = async () => {
    if (saving || scheduleSubmitting.current) return;
    if (!canSaveSchedule) {
      showToast(selectedFollowUp
        ? "You do not have permission to edit follow-ups."
        : "You do not have permission to schedule follow-ups.");
      return;
    }
    // Backstop — the primary button is disabled until the form is complete.
    if (!canSchedule) {
      setTouched({ resident: true, date: true, time: true, reason: true });
      return;
    }

    scheduleSubmitting.current = true;
    setSaving(true);
    try {
      if (selectedFollowUp) {
        await persistFollowUp(selectedFollowUp.id, {
          purpose: scheduleForm.reason.trim(),
          scheduled_date: scheduleForm.date,
          scheduled_time: scheduleForm.time,
          location: scheduleForm.location,
          priority: scheduleForm.priority,
          status: deriveStatus(scheduleForm.date),
          assigned_provider: scheduleForm.personnel || defaultPersonnel,
          notes: scheduleForm.notes.trim(),
        }, "Follow-up schedule updated successfully.");
        setShowScheduleModal(false);
        setSelectedFollowUp(null);
        setSelectedResident(null);
        return;
      }

      const result = await createFollowUpOffline({ ownerId: user?.id, record: {
        residentId: selectedResident.id,
        _offlineBarangay: selectedResident.barangay,
        _offlineResidentName: selectedResident.name,
        purpose: scheduleForm.reason.trim(),
        scheduled_date: scheduleForm.date,
        scheduled_time: scheduleForm.time,
        location: scheduleForm.location,
        priority: scheduleForm.priority,
        status: deriveStatus(scheduleForm.date),
        assigned_provider: scheduleForm.personnel || defaultPersonnel,
        notes: scheduleForm.notes.trim(),
      }});
      const record = result?.record || result;
      const newFollowUp = {
        ...mapFollowUpRow(record),
        resident: record.resident ? mapFollowUpRow(record).resident : selectedResident.name,
        barangay: record.resident?.barangay || selectedResident.barangay,
        age: selectedResident.age,
        sex: selectedResident.gender,
      };
      setFollowUps((current) => [newFollowUp, ...current]);
      setShowScheduleModal(false);
      setToast({ type: "success", message: result?.queued
        ? `Follow-up saved on this device for ${newFollowUp.resident} on ${newFollowUp.scheduledDate}. It will sync when a connection is available and may not yet be visible to the resident or other staff.`
        : `Follow-up scheduled successfully for ${newFollowUp.resident} on ${newFollowUp.scheduledDate}.` });
    } catch (err) {
      setToast({ type: "error", message: err?.message || "Could not schedule follow-up." });
    } finally {
      scheduleSubmitting.current = false;
      setSaving(false);
    }
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className={supervisor ? "supervisor-module" : "contents"}>
      <PageHeader
        crumbs={supervisor ? ["Health Operations", "Follow-ups"] : ["Care Coordination", "Follow-ups"]}
        title={supervisor ? "Follow-up Monitoring" : "Follow-up Management"}
        subtitle={
          assignedBarangay
            ? `Manage scheduled follow-up visits and monitor resident outcomes in Brgy. ${assignedBarangay}.`
            : supervisor ? "No valid barangay assignment. Follow-up records are unavailable."
            : "Manage scheduled follow-up visits and monitor resident outcomes."
        }
        action={supervisor ? <div className="flex flex-wrap gap-2">
          {canViewFollowUps && <Link to="/app/health_supervisor/followup-calendar" className="supervisor-button"><Calendar className="h-4 w-4" aria-hidden="true" /> View Schedule</Link>}
          {canScheduleFollowUp && <button type="button" onClick={openScheduleModal} className="supervisor-button is-primary"><Plus className="h-4 w-4" aria-hidden="true" /> Schedule Follow-up</button>}
        </div> : canScheduleFollowUp ? (
          <button
            onClick={openScheduleModal}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Schedule Follow-up
          </button>
        ) : null}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          {toast.type === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-green" aria-hidden="true" />}
          <span role={toast.type === "error" ? "alert" : "status"} className="text-sm text-white">{toast.message}</span>
        </div>
      )}

      {supervisor && followUpSource?.source === "cache" && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-ui text-amber-900">
          <p>{followUpSource.error || "The live follow-up service is unavailable."} {authorizedFollowUps.length ? "Showing this account's saved records and queued changes; monitoring counts reflect only those records." : "No saved follow-ups are available. Reconnect to confirm the live schedule."}</p>
          <button type="button" disabled={loading} onClick={load} className="supervisor-button is-quiet">Retry live data</button>
        </div>
      )}
      {supervisor && followUpParam && (loading || deepLinkError) && (
        <div role={deepLinkError ? "alert" : "status"} className="supervisor-panel mb-4 flex flex-wrap items-center justify-between gap-3 p-3 text-ui">
          <p className={deepLinkError ? "text-brand-danger" : "text-brand-gray"}>{loading ? "Opening the requested follow-up from your authorized records..." : deepLinkError}</p>
          {deepLinkError && <button type="button" onClick={load} className="supervisor-button">Retry</button>}
        </div>
      )}

      {loadErrorMessage && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-4 py-3 text-sm">
          <span className="text-brand-danger">{loadErrorMessage}</span>
          <button
            type="button"
            onClick={() => { void load(); }}
            disabled={loading}
            className="rounded-btn border border-brand-danger/40 px-3 py-1.5 font-medium text-brand-danger hover:bg-brand-danger/10 disabled:opacity-60"
          >
            {loading ? "Retrying..." : "Retry"}
          </button>
        </div>
      )}

       {/* Summary Cards */}
       {supervisor ? (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard variant="ledger" label="LOADED FOLLOW-UPS" value={loading || loadError ? "Unavailable" : stats.total} description={followUpSource?.source === "cache" ? "Saved records on this device" : "Authorized follow-up records"} tone="blue" />
          <StatCard variant="ledger" label="DUE TODAY" value={loading || loadError ? "Unavailable" : stats.today} description="Scheduled today, Manila time" tone="blue" />
          <StatCard variant="ledger" label="OVERDUE" value={loading || loadError ? "Unavailable" : overdueCount} description="Past due; closed visits excluded" tone="red" onClick={() => setStatusFilter(statusFilter === "Overdue" ? "All" : "Overdue")} active={statusFilter === "Overdue"} />
          <StatCard variant="ledger" label="COMPLETED" value={loading || loadError ? "Unavailable" : stats.completed} description="Persisted completed visits" tone="green" />
        </div>
       ) : null}

       {/* Search & Filters */}
      {supervisor ? <Card className="supervisor-toolbar mb-4 flex flex-wrap items-end gap-3">
        <label htmlFor="followup-search" className="min-w-[12rem] flex-1 text-caption font-medium text-brand-gray">
          Search Follow-ups
          <div className="supervisor-input mt-1 flex items-center gap-2"><Search className="h-4 w-4 shrink-0" aria-hidden="true" /><input id="followup-search" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Resident, purpose, personnel or location" className="w-full min-w-0 bg-transparent outline-none" /></div>
        </label>
        <label htmlFor="followup-status" className="text-caption font-medium text-brand-gray">Status<select id="followup-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="supervisor-input mt-1 block w-full sm:w-36">{["All", "Overdue", "Pending", ...FOLLOW_UP_STATUS_FILTERS.filter((status) => status !== "All")].map((status) => <option key={status} value={status}>{status === "All" ? "All Status" : status}</option>)}</select></label>
        <label htmlFor="followup-priority" className="text-caption font-medium text-brand-gray">Priority<select id="followup-priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="supervisor-input mt-1 block w-full sm:w-36">{["All", "High", "Medium", "Low"].map((priority) => <option key={priority} value={priority}>{priority === "All" ? "All priorities" : priority}</option>)}</select></label>
        {filtersActive && <button type="button" className="supervisor-button is-quiet" onClick={() => { setSearchQuery(""); setStatusFilter("All"); setPriorityFilter("All"); }}>Clear filters</button>}
      </Card> : <Card className="p-4 mb-5">
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
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
            >
              {FOLLOW_UP_STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
            >
              <option value="All">All Priorities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>
      </Card>}

       {/* Follow-up Table */}
       <Card className="overflow-hidden" aria-busy={loading}>
         {supervisor && <div className="supervisor-section-heading border-b border-brand-border px-3 py-2"><h2 className="text-section font-semibold text-brand-ink">Follow-up Register</h2></div>}
         <div className="w-full overflow-x-auto">
           <table className={`w-full follow-up-monitoring-grid ${supervisor ? "ui-table" : ""}`}>
             <thead className="bg-brand-bg border-b border-brand-border">
               <tr>
                 <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Resident</th>
                 <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Purpose</th>
                 <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Assigned</th>
                 <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Scheduled</th>
                 <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Location</th>
                 <th className="text-center text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Priority</th>
                 <th className="text-center text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Status</th>
                 <th className="text-right text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">Actions</th>
               </tr>
             </thead>
            <tbody>
              {pageFollowUps.map((f) => (
                <tr key={f.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td data-label="Resident" className="px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-ink break-words">{f.resident}</p>
                      <p className="text-xs text-brand-gray break-words">{f.barangay}</p>
                    </div>
                  </td>
                  <td data-label="Purpose" className="px-3 py-2.5 text-sm text-brand-ink max-w-[150px]">
                    <p className="truncate" title={f.purpose}>{f.purpose}</p>
                    {f.consultation && (
                      <p className="mt-0.5 text-[10px] text-brand-gray truncate">
                        Consultation {f.consultation.id}
                        {f.consultation.visit_date ? ` · ${formatDate(f.consultation.visit_date)}` : ""}
                      </p>
                    )}
                  </td>
                  <td data-label="Assigned" className="px-3 py-2.5 text-sm text-brand-ink break-words" title={f.assignedMidwife}>{f.assignedMidwife || "Not assigned"}</td>
                  <td data-label="Scheduled" className="px-3 py-2.5">
                    <div className="text-sm text-brand-ink">{supervisor ? formatDate(f.scheduledDateRaw, true) : f.scheduledDate}</div>
                    <div className="text-xs text-brand-gray">{f.scheduledTime}</div>
                  </td>
                   <td data-label="Location" className="px-3 py-2.5 text-sm text-brand-ink">
                     <div className="flex items-start gap-1.5">
                       <MapPin className="w-3 h-3 mt-0.5 text-brand-gray shrink-0" />
                       <span className="min-w-0 whitespace-normal break-words leading-snug">
                         {f.location || "Not specified"}
                       </span>
                     </div>
                   </td>
                   <td data-label="Priority" className="px-3 py-2.5 text-center">
                     <PriorityBadge value={f.priority || "Medium"} />
                   </td>
                   <td data-label="Status" className="px-3 py-2.5 text-center">
                     <div>
                       <FollowUpStatusBadge value={isOverdue(f) ? "Overdue" : f.status} />
                       {supervisor && f.syncStatus && <p className="mt-1 text-caption text-amber-800">{f.syncStatus}</p>}
                     </div>
                   </td>
                  <td data-label="Actions" className="px-3 py-2.5 text-right">
                    <ActionsDropdown followUp={f} />
                  </td>
                </tr>
              ))}
              {filteredFollowUps.length === 0 && !loadError && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-brand-gray" role={loading ? "status" : undefined}>
                    {loading
                      ? "Loading follow-ups..."
                      : supervisor && followUpSource?.source === "cache" ? "No matching saved records. Reconnect and retry to confirm the live schedule."
                      : filtersActive
                        ? "No follow-ups match the selected search and filters."
                        : "No follow-ups yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination total={filteredFollowUps.length} page={followUpPage} pageSize={followUpPageSize} onPageChange={setFollowUpPage} onPageSizeChange={(size) => { setFollowUpPageSize(size); setFollowUpPage(1); }} className="m-3" />
      </Card>

      {/* Schedule Follow-up Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-label={selectedFollowUp ? "Edit Follow-up Schedule" : "Schedule Follow-up"}
            className={`flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden ${supervisor ? "supervisor-modal supervisor-form" : ""}`}
          >
            {/* Fixed header */}
            <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light">
                  <Calendar className="h-5 w-5 text-brand-blue" strokeWidth={1.8} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">
                    {selectedFollowUp ? "Edit / Reschedule Follow-up" : "Schedule Follow-up"}
                  </h3>
                  <p className="text-xs text-brand-gray">
                    {selectedFollowUp ? "Update the scheduled visit details." : "Book the next follow-up visit for a resident"}
                  </p>
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
                {!selectedFollowUp && <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Resident</p>
                  <div onBlur={() => setTouched((t) => ({ ...t, resident: true }))}>
                    <ResidentSearchSelect
                      residents={residentOptions}
                      value={selectedResident}
                        onChange={(resident) => {
                          setSelectedResident(resident);
                          setScheduleForm((current) => ({ ...current, personnel: currentUserName }));
                        }}
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
                </section>}
                {selectedFollowUp && selectedResident && (
                  <div className="flex items-center gap-3 rounded-btn border border-brand-border bg-brand-bg px-3.5 py-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue text-xs font-semibold text-white">
                      {selectedResident.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-brand-ink">{selectedResident.name}</p>
                      <p className="text-xs text-brand-gray">
                        {selectedResident.id} · {selectedResident.barangay || selectedFollowUp.barangay}
                      </p>
                    </div>
                  </div>
                )}

                {/* FOLLOW-UP DETAILS */}
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Follow-up Details</p>
                  <div className="space-y-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="followup-schedule-date" className="mb-1.5 block text-sm font-medium text-brand-ink">
                          Follow-up Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          id="followup-schedule-date"
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
                        <label htmlFor={supervisor ? "followup-schedule-time" : undefined} className="mb-1.5 block text-sm font-medium text-brand-ink">
                          Follow-up Time <span className="text-red-500">*</span>
                        </label>
                        {supervisor ? <input id="followup-schedule-time" type="time" value={scheduleForm.time} onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })} className={inputCls(scheduleErrors.time)} /> : <TimePicker
                          value={scheduleForm.time}
                          onChange={(time) => setScheduleForm({ ...scheduleForm, time })}
                          error={Boolean(scheduleErrors.time)}
                        />}
                        {scheduleErrors.time && (
                          <p className="mt-1 text-xs text-red-600">{scheduleErrors.time}</p>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      {!supervisor && <div>
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
                      </div>}
                      <div>
                        <label htmlFor="followup-schedule-priority" className="mb-1.5 block text-sm font-medium text-brand-ink">Priority</label>
                        <select
                          id="followup-schedule-priority"
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
                      <label htmlFor="followup-purpose" className="mb-1.5 block text-sm font-medium text-brand-ink">
                        Reason / Purpose <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="followup-purpose"
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
                        <label htmlFor="followup-location" className="mb-1.5 block text-sm font-medium text-brand-ink">Location</label>
                        <select
                          id="followup-location"
                          value={scheduleForm.location}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, location: e.target.value, personnel: defaultPersonnel })}
                          className={`${inputCls()} cursor-pointer`}
                        >
                          {followUpLocationOptions.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                        {assignedBarangay && (
                          <p className="mt-1 text-xs text-brand-gray">
                            Follow-ups use your assigned Barangay Health Station in {assignedBarangay}. Use a referral to send a resident to another facility.
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="followup-personnel" className="mb-1.5 block text-sm font-medium text-brand-ink">Assigned Personnel</label>
                        <select
                          id="followup-personnel"
                          value={scheduleForm.personnel}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, personnel: e.target.value })}
                          className={`${inputCls()} cursor-pointer`}
                        >
                          {personnelOptions.map((person) => (
                            <option key={person.id} value={person.name}>
                              {person.name} ({person.role === "rhu_personnel" ? "RHU Personnel" : person.role === "health_supervisor" ? "Health Supervisor" : "PHN"})
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-brand-gray">Auto-assigned to you — change if needed.</p>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="followup-notes" className="mb-1.5 block text-sm font-medium text-brand-ink">Notes / Instructions</label>
                      <textarea
                        id="followup-notes"
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
                  {selectedFollowUp
                    ? "Rescheduling restores this follow-up to the scheduled workflow."
                    : "Follow-ups are saved as Scheduled — appearing under Today or Upcoming based on the date."}
                </span>
              </p>
            </div>

            {/* Fixed footer */}
            <div className="flex shrink-0 justify-end gap-3 bg-white px-6 py-4">
              <button
                onClick={() => {
                  setShowScheduleModal(false);
                  setSelectedFollowUp(null);
                  setSelectedResident(null);
                }}
                disabled={saving}
                className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={!canSchedule || saving}
                className={`px-4 py-2 rounded-btn text-sm font-medium transition-colors ${
                  canSchedule && !saving
                    ? "bg-brand-blue text-white hover:bg-brand-dark"
                    : "cursor-not-allowed bg-brand-blue/50 text-white"
                }`}
              >
                {saving ? "Saving..." : selectedFollowUp ? "Save Changes" : "Schedule Follow-up"}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Detail Panel */}
      {showDetailPanel && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Follow-up Details" className={`w-full max-w-md max-h-[90vh] overflow-y-auto ${supervisor ? "supervisor-modal" : ""}`}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-brand-ink">Follow-up Details</h3>
                <button
                  onClick={closeDetail}
                  aria-label="Close follow-up details"
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
                    <p className="text-xs text-brand-gray">{[selectedFollowUp.sex, selectedFollowUp.age !== "" && `${selectedFollowUp.age} years old`].filter(Boolean).join(" · ") || "Demographics not recorded"}</p>
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <p className="text-brand-gray">Barangay {selectedFollowUp.barangay}</p>
                  <p className="text-brand-gray">{selectedFollowUp.contact}</p>
                </div>
              </div>

              <div className="mb-4 space-y-3">
                {!supervisor && selectedFollowUp.type && (
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
                  <p className="text-sm text-brand-ink">{selectedFollowUp.location || "Not recorded"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-brand-gray" />
                  <p className="text-sm text-brand-ink">{selectedFollowUp.assignedMidwife || "Not assigned"}</p>
                </div>
                {!supervisor && <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[selectedFollowUp.priority]}`}>
                    {selectedFollowUp.priority}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selectedFollowUp.status]}`}>
                    {selectedFollowUp.status}
                  </span>
                </div>}
              </div>

              {supervisor && <div className="mb-4 flex flex-wrap gap-2"><StatusBadge value={selectedFollowUp.priority || "Not specified"} /><StatusBadge value={isOverdue(selectedFollowUp) ? "Overdue" : selectedFollowUp.status} /><span className="text-caption text-brand-gray">Follow-up ID: {selectedFollowUp.id}</span>{selectedFollowUp.syncStatus && <span className="text-caption text-amber-800">{selectedFollowUp.syncStatus}</span>}</div>}

              {selectedFollowUp.remarks && (
                <div className="mb-5">
                  <p className="text-xs text-brand-gray mb-1">Remarks</p>
                  <p className="whitespace-pre-wrap text-sm text-brand-ink">{selectedFollowUp.remarks}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Record Visit Modal */}
      {showRecordVisitModal && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Record Follow-up Visit" className={`w-full max-w-lg max-h-[90vh] overflow-y-auto ${supervisor ? "supervisor-modal supervisor-form" : ""}`}>
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
                      value={visitForm.visitDate}
                      max={todayISO()}
                      onChange={(e) => setVisitForm((v) => ({ ...v, visitDate: e.target.value }))}
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Visit Time</label>
                    <input
                      type="time"
                      value={visitForm.visitTime}
                      onChange={(e) => setVisitForm((v) => ({ ...v, visitTime: e.target.value }))}
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident Condition</label>
                  <select
                    value={visitForm.condition}
                    onChange={(e) => setVisitForm((v) => ({ ...v, condition: e.target.value }))}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
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
                    value={visitForm.findings}
                    onChange={(e) => setVisitForm((v) => ({ ...v, findings: e.target.value }))}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Treatment Provided</label>
                  <textarea
                    rows={2}
                    placeholder="Enter treatment..."
                    value={visitForm.treatment}
                    onChange={(e) => setVisitForm((v) => ({ ...v, treatment: e.target.value }))}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Advice Given</label>
                  <textarea
                    rows={2}
                    placeholder="Enter advice..."
                    value={visitForm.advice}
                    onChange={(e) => setVisitForm((v) => ({ ...v, advice: e.target.value }))}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Next Visit Date (optional — reschedules the follow-up)</label>
                  <input
                    type="date"
                    value={visitForm.nextVisitDate}
                    onChange={(e) => setVisitForm((v) => ({ ...v, nextVisitDate: e.target.value }))}
                    disabled={!canEditFollowUp}
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
                  disabled={saving || (visitForm.nextVisitDate ? !canEditFollowUp : !canCompleteFollowUp)}
                  onClick={() => {
                    handleSaveVisit(visitForm);
                  }}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save Visit"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Update Status Modal */}
      {showUpdateStatusModal && selectedFollowUp && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Update Follow-up Status" className={`w-full max-w-md ${supervisor ? "supervisor-modal" : ""}`}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Update Status</h3>
                <button
                  onClick={() => setShowUpdateStatusModal(false)}
                  aria-label="Close dialog"
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-brand-gray mb-4">Select new status for {selectedFollowUp.resident}'s follow-up:</p>
              <div className="space-y-2">
                {["Scheduled", "Ongoing"]
                  .filter((status) =>
                    canEditFollowUp &&
                    (selectedFollowUp.status !== "Missed" || status === "Scheduled"),
                  )
                  .map((status) => (
                  <button
                    key={status}
                    onClick={() => handleStatusUpdate(status)}
                    disabled={saving}
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Add Follow-up Remarks" className={`w-full max-w-md ${supervisor ? "supervisor-modal supervisor-form" : ""}`}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Add Remarks</h3>
                <button
                  onClick={() => setShowRemarksModal(false)}
                  aria-label="Close dialog"
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
                  value={remarksDraft}
                  onChange={(e) => setRemarksDraft(e.target.value)}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowRemarksModal(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={saving}
                  onClick={() => handleSaveRemarks(remarksDraft)}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {statusConfirmation && selectedFollowUp && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="follow-up-status-confirmation-title"
            className={`w-full max-w-md overflow-hidden ${supervisor ? "supervisor-modal" : ""}`}
          >
            <div className="border-b border-brand-border px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 id="follow-up-status-confirmation-title" className="text-lg font-semibold text-brand-ink">
                    {statusConfirmation === "Completed"
                      ? "Complete Follow-up"
                      : statusConfirmation === "Missed"
                        ? "Mark Follow-up as Missed"
                        : "Cancel Follow-up"}
                  </h3>
                  <p className="mt-1 text-sm text-brand-gray">{selectedFollowUp.resident}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (saving) return;
                    setStatusConfirmation(null);
                    setSelectedFollowUp(null);
                  }}
                  disabled={saving}
                  aria-label="Close dialog"
                  className="rounded-md p-1 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-btn border border-brand-border bg-brand-bg/60 p-3">
                <p className="text-sm font-medium text-brand-ink">{selectedFollowUp.purpose || "Follow-up visit"}</p>
                <p className="mt-1 text-sm text-brand-gray">
                  {selectedFollowUp.scheduledDate || "Date not set"}
                  {selectedFollowUp.scheduledTime ? ` · ${selectedFollowUp.scheduledTime}` : ""}
                </p>
                <p className="mt-1 text-xs text-brand-gray">
                  Current status: {selectedFollowUp.status}
                  {selectedFollowUp.location ? ` · ${selectedFollowUp.location}` : ""}
                </p>
              </div>
              <p className="text-sm leading-6 text-brand-gray">
                {statusConfirmation === "Completed"
                  ? "Confirm that this visit took place. Follow-ups awaiting resident confirmation or scheduled for a future date cannot be completed."
                  : statusConfirmation === "Missed"
                    ? "Confirm that this visit was missed. A future or resident-pending follow-up cannot be marked as missed."
                    : "Are you sure you want to cancel this follow-up? The cancellation will be saved to the follow-up record."}
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-brand-border px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  if (saving) return;
                  setStatusConfirmation(null);
                  setSelectedFollowUp(null);
                }}
                disabled={saving}
                className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg disabled:opacity-50"
              >
                Keep Follow-up
              </button>
              <button
                type="button"
                onClick={confirmStatusAction}
                disabled={saving}
                className={`rounded-btn px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  statusConfirmation === "Cancelled"
                    ? "bg-brand-danger hover:bg-brand-danger/90"
                    : "bg-brand-blue hover:bg-brand-dark"
                }`}
              >
                {saving
                  ? "Saving..."
                  : statusConfirmation === "Completed"
                    ? "Mark as Completed"
                    : statusConfirmation === "Missed"
                      ? "Mark as Missed"
                      : "Cancel Follow-up"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
