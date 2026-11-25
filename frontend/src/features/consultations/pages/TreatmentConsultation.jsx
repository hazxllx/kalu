import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import * as Dialog from "@radix-ui/react-dialog";
import StatCard from "@/components/common/StatCard";
import DataTable from "@/components/tables/DataTable";
import TablePagination from "@/components/tables/TablePagination";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import RiskBadge from "@/components/common/RiskBadge";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import {
  Search, FileText, Save, X, Plus, CheckCircle2, ChevronLeft, Eye, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { api, consultationsApi, residentsApi, healthServicesApi } from "@/services/api";
import ConsultationClinicalFields from "@/features/consultations/components/ConsultationClinicalFields";
import ConsultationHealthServiceField from "@/features/consultations/components/ConsultationHealthServiceField";
import DateRangePicker from "@/features/consultations/components/DateRangePicker";
import { formatLongDate } from "@/lib/dateUtils";
import { classifyBloodPressure as classifyBp, formatBloodPressureInput } from "@/features/consultations/utils/bpClassification";
import {
  saveConsultationOffline,
  submitConsultationDraft,
  listConsultationDrafts,
  restoreConsultationDraft,
  deleteConsultationDraft,
  listConsultationsOffline,
  listConsultationResidentsOffline,
} from "@/services/offline/consultationOfflineService";
import { isNavigatorOnline } from "@/services/offline/connectivity";
import { listWithOfflineFallback } from "@/services/offline/clinicalOfflineService";
import { captureOwnerGuard } from "@/services/offline/db";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import LabResultsPanel from "@/features/health-records/components/LabResultsPanel";
import ResidentHealthHistory from "@/features/consultations/components/ResidentHealthHistory";
import SearchableSelect from "@/components/common/SearchableSelect";
import { loadServerRows } from "@/lib/serverRows";
import { consultationRiskLevel, consultationAssessment, consultationServiceName, consultationTemperatureWarningVisible, consultationRiskReasons, consultationFollowUp, consultationBloodPressureClassification } from "@/features/consultations/lib/consultationRisk";
import { hasMaternalDetails, hasMaternalInformation, isMaternalHealthService } from "@/features/consultations/lib/consultationForm";
import ButtonSelectGroup from "@/components/system/ButtonSelectGroup";
import { ActionMenu, ActionMenuContent, ActionMenuItem, ActionMenuTrigger } from "@/components/ui/action-menu";
import {
  getManilaDateTime, calculateConsultationBmi, validateConsultationVitals,
  validateConsultationDateTime, normalizeConsultationClinicalText,
  clinicalTextIndicatesPregnancy,
  validateConsultationMedications,
} from "../../../../../shared/consultationClinical.js";

const inputCls = (error) =>
  `w-full rounded-btn border bg-white px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue dark:bg-card dark:text-foreground dark:border-border ${
    error ? "border-brand-danger bg-red-50/40 dark:border-brand-danger dark:bg-red-950/20" : "border-brand-border"
  }`;

/**
 * Map a failed save to a clear, status-appropriate message. The backend's
 * specific message (e.g. a 422 validation reason) is preferred when present;
 * otherwise a friendly per-status fallback is used. Credentials/tokens are
 * never surfaced here.
 */
const submitErrorMessage = (err) => {
  const status = err?.status;
  const code = String(err?.code || "").toLowerCase();
  const backendMsg = err?.message && !/^Request failed with status/i.test(err.message) ? err.message : "";
  if (status === 0 || code === "network" || err?.name === "AbortError") {
    return "The server is temporarily unavailable. Your consultation remains queued and will retry automatically.";
  }
  switch (status) {
    case 400:
    case 422:
      return backendMsg || "Some consultation details are invalid. Please review the form.";
    case 401:
      return "Your session has expired. Please sign in again and retry.";
    case 403:
      return backendMsg || "You are not allowed to save a consultation for this resident.";
    case 404:
      return "The selected resident could not be found in your assigned area.";
    case 409:
      return backendMsg || "This consultation conflicts with an existing record.";
    case 500:
    default:
      if (status >= 500) return "The server could not save the consultation. Please try again.";
      return backendMsg || "Unable to save consultation. Please try again.";
  }
};

const emptyForm = (now = new Date()) => ({
  consultationDate: getManilaDateTime(now).date,
  consultationTime: getManilaDateTime(now).time,
  chiefComplaint: "",
  bloodPressure: "",
  temperature: "",
  pulseRate: "",
  respiratoryRate: "",
  height: "",
  weight: "",
  oxygenSaturation: "",
  findings: "",
  treatmentGiven: "",
  medicationPrescribed: "",
  medications: [],
  adviceGiven: "",
  serviceId: "",
  serviceName: "",
  serviceCategory: "",
  followUpId: "",
  followUpRequired: "No",
  nextVisitDate: "",
  referralRequired: "No",
  remarks: "",
  clinicalIndicators: {},
  clinicalContext: { existingConditions: [] },
  maternal: { careType: "prenatal", pregnancyId: null, lmpDate: "", eddDate: "", gestationalAgeWeeks: "" },
});

/** @typedef {Record<string, string>} FormErrors */

const conditionValue = (condition) => typeof condition === "string"
  ? { name: condition, status: "stable", significant: false }
  : { ...condition, name: condition.name || condition.condition || condition.diagnosis || "", status: condition.status || "stable", significant: condition.significant === true };

const toResidentOption = (r) => ({
  id: r.id,
  name: r.name || [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
  healthRecordNo: r.healthRecordNo || r.health_record_no || "",
  age: r.age || (r.birthDate ? Math.max(0, new Date().getFullYear() - new Date(r.birthDate).getFullYear()) : "—"),
  sex: r.gender || r.sex || "—",
  barangay: r.barangay || "",
  program: r.program || "General",
  bloodType: r.bloodType || "—",
  // The /residents list maps the DB `cellphone_no` column to `cellphoneNo`
  // (there is no `contact` field on a resident-list row), so read that; keep
  // `contact` as a fallback for any already-normalized source. Only show the
  // placeholder when a contact number is genuinely absent.
  contact: r.contact || r.cellphoneNo || "—",
  birthDate: r.birthDate || "",
});

/** Keep the record list readable: strip time for the table. */
const formatDate = (iso) => {
  return formatLongDate(iso) || "—";
};

const formatVitalLabel = (key) => ({
  bp: "Blood Pressure",
  bloodPressure: "Blood Pressure",
  temperature: "Temperature",
  hr: "Pulse Rate",
  pulseRate: "Pulse Rate",
  rr: "Respiratory Rate",
  respiratoryRate: "Respiratory Rate",
  heightCm: "Height",
  height: "Height",
  weightKg: "Weight",
  weight: "Weight",
  bmi: "BMI",
  bmiCategory: "BMI Category",
  bloodPressureCategory: "Blood Pressure Category",
  o2sat: "Oxygen Saturation",
  oxygenSaturation: "Oxygen Saturation",
}[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase()));

const parseVitals = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const consultationRisk = (record) => {
  const level = consultationRiskLevel(record);
  return level === "Moderate" ? "Medium" : level || "Unassessed";
};

const consultationDateIsPast = (record) => {
  const date = String(record?.consultationDate || "").slice(0, 10);
  return Boolean(date && date < getManilaDateTime().date);
};

/** Two-letter initials for the resident avatar (local — no external store). */
const initialsOf = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "—";

export default function TreatmentConsultation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermissions();
  const canConductConsultation = can("consultation.conduct");
  const canEditConsultation = can("consultation.records.update");
  const isHealthSupervisor = user?.role === "health_supervisor";
  const canViewConsultations = can("consultation.requests.view");
  const canViewHistory = can("consultation.history.view");
  const focusedId = isHealthSupervisor ? searchParams.get("consultation") : null;
  const [allResidents, setAllResidents] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Owner-scoped write-ahead queue. Background reconnect sync uses the same
  // immutable operation as the first online attempt.
  const ownerId = user?.id || null;
  const historyScopeKey = JSON.stringify([user?.role, user?.municipalityId || user?.municipality_id,
    user?.barangayId || user?.barangay_id]);
  const [savedHistory, setSavedHistory] = useState(null);
  const [offlineDrafts, setOfflineDrafts] = useState([]);
  const [draftBusyId, setDraftBusyId] = useState(null);
  const [reviewLocalId, setReviewLocalId] = useState(null);
  const syncStatus = useSyncStatus();

  // Records list view by default. Clicking "+ Add Treatment Consultation"
  // opens the consultation entry form below; saving persists the record to the
  // authorized API/outbox and returns to the records list.
  const [mode, setMode] = useState("list"); // "list" | "form"
  const [editingId, setEditingId] = useState(null);
  const [detailRecord, setDetailRecord] = useState(null);
  const [editingMedications, setEditingMedications] = useState([]);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const recordRequest = useRef(0);

  const scope = getSupervisorScope(user);
  const assignedBarangay = scope?.assignedBarangay;
  const allowedBarangays =
    isHealthSupervisor ? scope?.level === HS_SCOPE.BARANGAY ? [assignedBarangay] : [] : null;
  const loadFocusedRecord = useCallback(async ({ ownerId }) => {
    if (!focusedId) return null;
    if (!canViewConsultations || !assignedBarangay) throw new Error("A permitted consultation record and verified barangay assignment are required.");
    const response = await consultationsApi.get(focusedId, { ownerId });
    const record = response?.consultation;
    if (record?.id !== focusedId || record.resident?.barangay !== assignedBarangay) {
      throw new Error("The selected consultation is unavailable in your assigned barangay.");
    }
    return record;
  }, [focusedId, canViewConsultations, assignedBarangay]);
  const focusedRecord = useAuthorizedData(loadFocusedRecord);

  const residentOptions = useMemo(() => {
    const pool = allowedBarangays
      ? allResidents.filter((r) => r.barangay && allowedBarangays.includes(r.barangay))
      : allResidents;
    return pool
      .map(toResidentOption)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allResidents, allowedBarangays]);

  const [selectedResident, setSelectedResident] = useState(null);
  const renderHistory = (resident, revision, consultationId = "") => canViewHistory && ownerId && resident?.id && (
    <ResidentHealthHistory residentId={resident.id} residentName={resident.name} bloodType={resident.bloodType} ownerId={ownerId}
      scopeKey={historyScopeKey} revision={revision} consultationId={consultationId} onViewConsultation={openRecord} />
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordDateFrom, setRecordDateFrom] = useState("");
  const [recordDateTo, setRecordDateTo] = useState("");
  const [recordRisk, setRecordRisk] = useState("All");
  const [recordFollowUp, setRecordFollowUp] = useState("All");
  const [recordSort, setRecordSort] = useState("newest");
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(8);
  const [formData, setFormData] = useState(emptyForm);
  const [maternalInfoCompleted, setMaternalInfoCompleted] = useState(false);
  const [maternalInfoTouched, setMaternalInfoTouched] = useState(false);
  const [maternalInfoProtected, setMaternalInfoProtected] = useState(false);
  const [errors, setErrors] = useState(/** @type {FormErrors} */ ({}));
  const [toast, setToast] = useState(null);
  // Active Health Services catalog records for the service selector. An
  // existing inactive association is shown separately as a disabled option.
  const [healthServices, setHealthServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState("");
  const [clinicalContext, setClinicalContext] = useState(null);
  const [contextError, setContextError] = useState("");
  const [contextRetry, setContextRetry] = useState(0);
  const clinicalInputResident = useRef(null);

  useEffect(() => {
    const start = location.state?.followUpStart;
    if (!start?.residentId || !start?.id || !residentOptions.length) return;
    const resident = residentOptions.find((item) => item.id === start.residentId);
    if (!resident) return;
    setSelectedResident(resident);
    setFormData({ ...emptyForm(), chiefComplaint: start.purpose || "Follow-up consultation", followUpId: start.id });
    setMaternalInfoCompleted(false);
    setMaternalInfoTouched(false);
    setMaternalInfoProtected(false);
    setErrors({});
    setMode("form");
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, residentOptions, navigate]);

  // Read-only BMI, recomputed immediately whenever height or weight changes.
  const bmi = calculateConsultationBmi(formData.height, formData.weight);
  const bmiDisplay = bmi === null ? "" : bmi.toFixed(1);
  const bloodPressureCategory = useMemo(() => {
    return classifyBp(formData.bloodPressure, {
      chiefComplaint: formData.chiefComplaint,
      findings: formData.findings,
      indicators: formData.clinicalIndicators,
    });
  }, [formData.bloodPressure, formData.chiefComplaint, formData.findings, formData.clinicalIndicators]);

  const selectedService = healthServices.find((service) => service.id === formData.serviceId);
  const maternalService = isMaternalHealthService(selectedService || {
    name: formData.serviceName,
    category: formData.serviceCategory,
  });
  const confirmedPregnancy = clinicalContext?.pregnancy;

  useEffect(() => {
    if (mode !== "form" || !selectedResident?.id || !ownerId || reviewLocalId
      || validateConsultationDateTime({ consultationDate: formData.consultationDate }, { required: false }).consultationDate) return;
    let active = true;
    const guard = captureOwnerGuard(ownerId);
    const controller = new AbortController();
    const residentId = selectedResident.id;
    setContextError("");
    consultationsApi.clinicalContext({ residentId, consultationDate: formData.consultationDate }, { ownerId, signal: controller.signal })
      .then((context) => {
        if (!active || !guard()) return;
        if (!context || typeof context !== "object") throw new Error("The resident clinical context was not returned.");
        setClinicalContext(context);
        if (clinicalInputResident.current !== residentId) {
          clinicalInputResident.current = residentId;
          setFormData((current) => ({
            ...current,
            clinicalContext: {
              existingConditions: (context.existingConditions || []).map(conditionValue),
            },
            maternal: {
              ...current.maternal,
              careType: context.pregnancy?.isPostpartum ? "postpartum" : "prenatal",
              pregnancyId: context.pregnancy?.id || null,
              lmpDate: context.pregnancy?.lmpDate || "",
              eddDate: context.pregnancy?.eddDate || "",
              gestationalAgeWeeks: context.pregnancy?.gestationalAgeWeeks ?? "",
            },
          }));
        }
      })
      .catch((error) => {
        if (active && guard()) setContextError(error?.message || "Could not confirm resident clinical context.");
      });
    return () => { active = false; controller.abort(); };
  }, [mode, selectedResident?.id, formData.consultationDate, ownerId, reviewLocalId, contextRetry]);

  const load = useCallback(() => {
    if (!ownerId) return Promise.resolve();
    const guard = captureOwnerGuard(ownerId);
    setLoading(true);
    setLoadError(null);
    if (isHealthSupervisor && !assignedBarangay) {
      setAllResidents([]); setConsultations([]); setLoading(false);
      setLoadError("A verified barangay assignment is required to view consultations.");
      return Promise.resolve();
    }
    // Verified residents only: the selector must offer residents who are
    // individually approved OR verified via their household (the backend's
    // verified directory). Pending/rejected/unverified residents are excluded
    // server-side; the submission endpoint re-checks eligibility as well.
    return Promise.all([
      listConsultationResidentsOffline({ ownerId, fetchList: () => loadServerRows((params) => residentsApi.list({ ...params, verified: true })) }),
      listConsultationsOffline({ ownerId, fetchList: () => loadServerRows((params) => consultationsApi.list(params)) }),
    ]).then(([residentRows, consultationRows]) => {
        if (!guard()) return;
        if (!Array.isArray(residentRows) || !Array.isArray(consultationRows)) {
          throw new Error("The server returned an invalid consultation or resident list.");
        }
        setAllResidents(residentRows.filter((row) => row && typeof row === "object"));
        setConsultations(consultationRows.filter((row) => row && typeof row === "object" && !row.offline));
      })
      .catch((err) => {
        if (!guard()) return;
        // A failed load must surface as an explicit error state — never a
        // silent empty "no consultations" list.
        setLoadError(err?.message || "Could not load consultation records.");
        setConsultations([]);
      })
      .finally(() => { if (guard()) setLoading(false); });
  }, [ownerId, isHealthSupervisor, assignedBarangay]);

  useEffect(() => {
    recordRequest.current += 1;
    setDetailRecord(null);
    setAllResidents([]);
    setConsultations([]);
    setOfflineDrafts([]);
    setReviewLocalId(null);
    setMode("list");
    setEditingId(null);
    setSelectedResident(null);
    clinicalInputResident.current = null;
    setClinicalContext(null);
    setEditingMedications([]);
    setSavedHistory(null);
    setFormData(emptyForm());
    setMaternalInfoCompleted(false);
    setMaternalInfoTouched(false);
    setMaternalInfoProtected(false);
    setSearchQuery("");
    setErrors({});
    setBusy(false);
    setDraftBusyId(null);
    setToast(null);
    load();
    return () => { recordRequest.current += 1; };
  }, [load]);

  const closeActionMenu = useCallback(() => setOpenActionMenu(null), []);

  // Also refresh queue states after automatic synchronization or a rejection.
  const refreshDrafts = useCallback(() => {
    if (!ownerId) {
      setOfflineDrafts([]);
      return Promise.resolve();
    }
    const guard = captureOwnerGuard(ownerId);
    return listConsultationDrafts(ownerId)
      .then((rows) => { if (guard()) setOfflineDrafts(rows); })
      .catch(() => { if (guard()) setLoadError("Could not load queued consultations. Clinical information remains on this device."); });
  }, [ownerId]);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts, syncStatus.counts.pending, syncStatus.counts.failed, syncStatus.counts.conflict, syncStatus.syncing]);

  useEffect(() => {
    if (syncStatus.ownerId === ownerId && syncStatus.lastSyncedAt) load();
  }, [load, ownerId, syncStatus.ownerId, syncStatus.lastSyncedAt]);

  // Load the real health services catalog for the consultation form selector.
  // Never mocked/hardcoded: options come from /api/health-services (the caller's
  // server-enforced scope).
  useEffect(() => {
    let active = true;
    setHealthServices([]);
    setServicesLoading(true);
    setServicesError("");
    listWithOfflineFallback({
      ownerId,
      entity: "consultationHealthService",
      fetchFn: (params) => healthServicesApi.list(params, { ownerId, dedupeKey: ownerId }),
    })
      .then(({ rows }) => {
        if (!active) return;
        setHealthServices(rows.filter((service) => service.active !== false));
      })
      .catch((err) => {
        if (active) {
          setHealthServices([]);
          setServicesError(err?.message || "Could not load active health services.");
        }
      })
      .finally(() => {
        if (active) setServicesLoading(false);
      });
    return () => { active = false; };
  }, [ownerId]);

  const filteredResidents = residentOptions.filter(
    (r) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return true;
      return [
        r.id,
        r.name,
        r.barangay,
        r.contact,
        r.program,
        r.healthRecordNo,
        r.health_record_no,
      ].filter(Boolean).join(" ").toLowerCase().includes(query);
    }
  );

  const showToast = (message, kind = "success") => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3000);
  };

  const startNewConsultation = () => {
    if (!canConductConsultation) return;
    recordRequest.current += 1;
    setEditingId(null);
    setEditingMedications([]);
    clinicalInputResident.current = null;
    setClinicalContext(null);
    setReviewLocalId(null);
    setSelectedResident(null);
    setFormData(emptyForm());
    setMaternalInfoCompleted(false);
    setMaternalInfoTouched(false);
    setMaternalInfoProtected(false);
    setErrors({});
    setSearchQuery("");
    setMode("form");
  };

  const openRecord = async (row, edit = false) => {
    closeActionMenu();
    if (!ownerId || (edit && !canEditConsultation)) return;
    if (edit && consultationDateIsPast(row)) {
      showToast("Past consultations are view-only. Consultations dated today can still be edited.", "error");
      return;
    }
    const request = ++recordRequest.current;
    const guard = captureOwnerGuard(ownerId);
    setDetailRecord(null);
    let record;
    try {
      record = !edit && !isNavigatorOnline()
        ? row
        : (await consultationsApi.get(row.id, { ownerId }))?.consultation;
      if (!guard() || request !== recordRequest.current) return;
      if (record?.id !== row.id || !row.resident?.id || record.resident?.id !== row.resident.id) {
        throw new Error("The server did not return the selected consultation.");
      }
    } catch (error) {
      if (guard() && request === recordRequest.current) showToast(error?.message || "Could not load the consultation.", "error");
      return;
    }
    if (edit && consultationDateIsPast(record)) {
      showToast("Past consultations are view-only. Consultations dated today can still be edited.", "error");
      return;
    }
    if (!edit) {
      setDetailRecord(record);
      return;
    }
    setEditingId(record.id);
    setEditingMedications(record.medications || []);
    setReviewLocalId(null);
    setSelectedResident(record.resident || null);
    clinicalInputResident.current = record.resident?.id || null;
    setClinicalContext(null);
    // Vitals are returned nested under record.vitals (bp/temperature/hr/rr/
    // heightCm/weightKg/o2sat); map them back to the flat form fields so an
    // edited consultation shows its saved vitals instead of blanks.
    const v = record.vitals || {};
    // Preserve the stored shape. Injecting a default false here makes a
    // historical record look clinically changed on every edit.
    const savedClinicalIndicators = record.clinicalIndicators || record.consultationDetails?.clinicalIndicators || {};
    const savedMaternal = record.maternal || record.consultationDetails?.maternal || null;
    setMaternalInfoCompleted(hasMaternalInformation(savedMaternal));
    setMaternalInfoTouched(false);
    setMaternalInfoProtected(hasMaternalInformation(savedMaternal));
    setFormData({
      ...emptyForm(),
      consultationDate: record.consultationDate || "",
      consultationTime: record.consultationTime || "",
      chiefComplaint: record.chiefComplaint || "",
      bloodPressure: v.bp ?? record.bloodPressure ?? "",
      temperature: v.temperature ?? record.temperature ?? "",
      pulseRate: v.hr ?? record.pulseRate ?? "",
      respiratoryRate: v.rr ?? record.respiratoryRate ?? "",
      height: v.heightCm ?? record.height ?? "",
      weight: v.weightKg ?? record.weight ?? "",
      oxygenSaturation: v.o2sat ?? record.oxygenSaturation ?? "",
      findings: record.findings || "",
      treatmentGiven: record.treatmentGiven || "",
      medicationPrescribed: record.medicationPrescribed || "",
      medications: Array.isArray(record.medications) ? record.medications : [],
      adviceGiven: record.adviceGiven || "",
      serviceId: record.serviceId || "",
      serviceName: consultationServiceName(record),
      serviceCategory: record.serviceCategory || record.consultationDetails?.healthServiceCategory || "",
      followUpRequired: record.followUpRequired || "No",
      nextVisitDate: record.nextVisitDate || "",
      referralRequired: record.referralRequired || "No",
      remarks: record.remarks || "",
      clinicalIndicators: savedClinicalIndicators,
      clinicalContext: { ...emptyForm().clinicalContext, ...(record.clinicalContext || record.consultationDetails?.clinicalContext || {}) },
      maternal: { ...emptyForm().maternal, ...(savedMaternal || {}) },
    });
    setErrors({});
    setSearchQuery("");
    setMode("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelForm = () => {
    recordRequest.current += 1;
    setMode("list");
    setEditingId(null);
    setEditingMedications([]);
    clinicalInputResident.current = null;
    setClinicalContext(null);
    setReviewLocalId(null);
    setSelectedResident(null);
    setFormData(emptyForm());
    setMaternalInfoCompleted(false);
    setMaternalInfoTouched(false);
    setMaternalInfoProtected(false);
    setErrors({});
  };

  const updateVital = (field, value) => {
    const updated = { ...formData, [field]: value };
    const validation = validateConsultationVitals(updated);
    setFormData(updated);
    setErrors((previous) => {
      const next = { ...previous };
      if (String(value ?? "").trim() || previous[field]) next[field] = validation[field] || "";
      if (["height", "weight"].includes(field) || previous.bmi) {
        if ((String(updated.height ?? "").trim() && String(updated.weight ?? "").trim()) || previous.bmi) {
          next.bmi = validation.bmi || "";
        }
      }
      return next;
    });
  };

  const validateMaternalInformation = (data = formData, serviceIsMaternal = maternalService) => {
    const next = {};
    if (!serviceIsMaternal) return next;
    if (data.maternal.careType === "prenatal" && !confirmedPregnancy?.isPregnant
      && !clinicalTextIndicatesPregnancy(`${data.chiefComplaint}\n${data.findings}`)) {
      next["maternal.careType"] = "Record pregnancy-related terms in the Chief Complaint or Clinical Findings, or use a confirmed same-resident pregnancy episode for prenatal care.";
    }
    for (const field of ["lmpDate", "eddDate"]) {
      const value = data.maternal[field];
      if (value && validateConsultationDateTime({ consultationDate: value }, { required: false }).consultationDate) {
        next[`maternal.${field}`] = "Enter a valid calendar date.";
      }
    }
    if (data.maternal.lmpDate && data.maternal.eddDate && data.maternal.eddDate <= data.maternal.lmpDate) {
      next["maternal.eddDate"] = "Estimated delivery must be after the last menstrual period.";
    }
    const weeks = data.maternal.gestationalAgeWeeks;
    if (weeks !== "" && weeks != null && (!/^\d+(?:\.\d+)?$/.test(String(weeks)) || Number(weeks) > 45)) {
      next["maternal.gestationalAgeWeeks"] = "Enter a gestational age between 0 and 45 weeks.";
    }
    return next;
  };

  const completeMaternalInformation = () => {
    const maternalErrors = validateMaternalInformation();
    setErrors((previous) => ({
      ...Object.fromEntries(Object.entries(previous).filter(([field]) => !field.startsWith("maternal."))),
      ...maternalErrors,
    }));
    if (Object.keys(maternalErrors).length) return;
    setMaternalInfoCompleted(true);
  };

  const validate = () => {
    /** @type {Record<string, string>} */
    const next = { ...validateConsultationDateTime(formData), ...validateConsultationVitals(formData, { required: !editingId }),
      ...validateConsultationMedications(formData.medications, { previous: editingMedications }) };
    if (!selectedResident) next.resident = "Please select a resident.";
    if (!maternalService && ((maternalInfoTouched && hasMaternalDetails(formData.maternal))
      || (maternalInfoProtected && hasMaternalInformation(formData.maternal)))) {
      next.serviceId = "Select a Prenatal / Maternal health service to save the entered maternal information.";
    }
    if (!editingId && !formData.chiefComplaint.trim()) next.chiefComplaint = "Chief complaint is required.";
    if (!editingId && !formData.findings.trim()) next.findings = "Record the clinical findings from this consultation.";
    if (formData.treatmentGiven.length > 10000) next.treatmentGiven = "Use 10,000 characters or fewer for treatment provided.";
    if (formData.adviceGiven.length > 10000) next.adviceGiven = "Use 10,000 characters or fewer for recommendations.";
    if (formData.followUpRequired === "Yes" && !formData.nextVisitDate) next.nextVisitDate = "Select the follow-up date.";
    if (formData.nextVisitDate && formData.nextVisitDate < formData.consultationDate) next.nextVisitDate = "Follow-up cannot be earlier than the consultation.";
    Object.assign(next, validateMaternalInformation());
    if (formData.riskReview && (!formData.riskReview.reason?.trim() || !formData.riskReview.reassessmentConfirmed)) next.riskReview = "A clinical reason and confirmed reassessment are required to review the classification.";
    for (const [index, condition] of (formData.clinicalContext.existingConditions || []).entries()) {
      if (!String(condition.name || "").trim()) next[`clinicalContext.existingConditions[${index}].name`] = "Enter the recorded condition or remove the empty row.";
    }
    return next;
  };

  const handleSave = () => {
    if (busy || reviewLocalId) return;
    if (editingId ? !canEditConsultation : !canConductConsultation) return;
    const guard = captureOwnerGuard(ownerId);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const payload = {
      ...formData,
      riskReview: formData.riskReview || undefined,
      // Existing encounter context is server-owned on edits; resubmitting the
      // display/merged version can look like a clinical change and block an
      // otherwise valid historical update. The API retains its saved context.
      clinicalContext: editingId ? undefined : { existingConditions: formData.clinicalContext.existingConditions || [] },
      maternal: maternalService ? { ...formData.maternal, pregnancyId: formData.maternal.pregnancyId || confirmedPregnancy?.id || null } : undefined,
      residentId: selectedResident.id,
      followUpId: formData.followUpId || undefined,
    };
    setBusy(true);

    // Shared, status-appropriate error presentation (never fail silently).
    const showSaveError = (err) => {
      if (!guard()) return;
      // Keep an attempted queue read-only: submitting an edited copy with a new
      // UUID after response loss could duplicate a visit already on the server.
      if (err?.localId) {
        setReviewLocalId(err.localId);
        refreshDrafts();
      }
      const serverErrors = err?.payload?.error?.errors;
      if (serverErrors && typeof serverErrors === "object" && !Array.isArray(serverErrors)) {
        const fieldErrors = { ...serverErrors };
        if (fieldErrors.residentId) {
          fieldErrors.resident = fieldErrors.residentId;
          delete fieldErrors.residentId;
        }
        setErrors((prev) => ({ ...prev, ...fieldErrors, submit: "" }));
      } else {
        const details = err?.payload?.error?.details;
        const detailMessage = Array.isArray(details) ? details.join(" ") : "";
        setErrors((prev) => ({ ...prev, submit: detailMessage || submitErrorMessage(err) }));
      }
    };

    const openReferral = (saved) => {
      const referralDraft = {
        residentId: selectedResident.id,
        resident: selectedResident.name,
        reason: formData.findings || formData.chiefComplaint || "",
        riskLevel: consultationRisk(saved),
        findings: formData.findings || "",
        chiefComplaints: formData.chiefComplaint || "",
        clinicalHistory: "",
        vitals: {
          bp: formData.bloodPressure,
          temperature: formData.temperature,
          hr: formData.pulseRate,
          rr: formData.respiratoryRate,
          heightCm: formData.height,
          weightKg: formData.weight,
          o2sat: formData.oxygenSaturation,
        },
        impression: formData.findings || "",
        recommendations: formData.adviceGiven || "",
        clinicalNotes: saved?.remarks || "",
        treatmentVisitId: saved?.id || "",
      };
      cancelForm();
      const referralPath = user?.role === "phn" ? "/app/phn/referrals" : "/app/health_supervisor/referrals";
      navigate(referralPath, { state: { referralDraft } });
    };

    if (editingId) {
      // Updates require an authoritative server round-trip (online only).
      consultationsApi.update(editingId, payload, { ownerId }).then((result) => {
        if (!guard()) return;
        const saved = result?.consultation;
        if (!saved || saved.id !== editingId || saved.resident?.id !== selectedResident.id) {
          throw new Error("The server did not confirm the consultation update. Your entered details were retained.");
        }
        setConsultations((current) => current.map((item) => (item.id === editingId ? saved : item)));
        void load();
        if (focusedId === editingId) void focusedRecord.refresh();
        showToast(consultationAssessment(saved)?.referralEvaluationRequired
          ? "Consultation updated. High risk: referral evaluation is required."
          : "Consultation updated successfully.");
        if ((formData.referralRequired === "Yes" || consultationAssessment(saved)?.referralEvaluationRequired === true)
          && !saved.referrals?.length) {
          openReferral(saved);
          return;
        }
        setSavedHistory({ resident: selectedResident, ownerId, scopeKey: historyScopeKey, revision: Date.now() });
        cancelForm();
      }).catch(showSaveError).finally(() => { if (guard()) setBusy(false); });
      return;
    }

    // The operation is persisted before HTTP. A lost response uses this same
    // UUID through the automatic reconnect handler, never a second create.
    saveConsultationOffline({
      ownerId,
      payload,
      create: (data, options) => api.post("/consultations", data, options),
    }).then((res) => {
      if (!guard()) return;
      if (res.source === "server") {
        const saved = res.record;
        setConsultations((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
        showToast(consultationAssessment(saved)?.referralEvaluationRequired
          ? "Consultation saved. High risk: referral evaluation is required."
          : "Consultation saved successfully.");
        if (formData.referralRequired === "Yes" || consultationAssessment(saved)?.referralEvaluationRequired === true) {
          openReferral(saved);
          return;
        }
        setSavedHistory({ resident: selectedResident, ownerId, scopeKey: historyScopeKey, revision: Date.now() });
        cancelForm();
        return;
      }
      showToast("Saved on this device. Awaiting server confirmation; reconnect retries automatically.", "pending");
      refreshDrafts();
      cancelForm();
    }).catch(showSaveError).finally(() => { if (guard()) setBusy(false); });
  };

  // Optional immediate retry uses the queued operation, not a new submission.
  const handleSubmitDraft = (localId) => {
    if (!canConductConsultation) return;
    if (draftBusyId) return;
    const guard = captureOwnerGuard(ownerId);
    if (!isNavigatorOnline()) {
      showToast("You're offline. This consultation will sync automatically when you reconnect.", "pending");
      return;
    }
    setDraftBusyId(localId);
    submitConsultationDraft({
      ownerId,
      localId,
      create: (data, options) => api.post("/consultations", data, options),
    }).then((out) => {
      if (!guard()) return;
      if (out.source === "server") {
        setConsultations((current) => [out.record, ...current.filter((row) => row.id !== out.record.id)]);
        const resident = out.record.resident;
        if (resident?.id) setSavedHistory({ resident, ownerId, scopeKey: historyScopeKey, revision: Date.now() });
        showToast("Consultation saved successfully.");
      } else {
        showToast("Awaiting server confirmation. Clinical information remains queued for automatic retry.", "pending");
      }
      refreshDrafts();
    }).catch((err) => {
      if (!guard()) return;
      showToast(submitErrorMessage(err), "error");
      refreshDrafts();
    }).finally(() => { if (guard()) setDraftBusyId(null); });
  };

  // Review the original clinical data without copying it into a second create.
  const handleEditDraft = (localId) => {
    if (!canConductConsultation) return;
    const guard = captureOwnerGuard(ownerId);
    restoreConsultationDraft({ ownerId, localId }).then((restored) => {
      if (!guard()) return;
      if (!restored) {
        refreshDrafts();
        return;
      }
      const data = restored.data || {};
      const draftData = { ...data };
      delete draftData.diagnosis;
      delete draftData.clinicalFindingsDiagnosis;
      const resident =
        residentOptions.find((r) => r.id === data.residentId) ||
        (data.residentId ? { id: data.residentId, name: data.residentId, barangay: "" } : null);
      const clinical = normalizeConsultationClinicalText(data);
      setEditingId(null);
      setMaternalInfoCompleted(false);
      setMaternalInfoTouched(false);
      setMaternalInfoProtected(hasMaternalInformation(data.maternal));
      setReviewLocalId(localId);
      setSelectedResident(resident);
      clinicalInputResident.current = resident?.id || null;
      setFormData({ 
        ...emptyForm(),
        ...draftData,
        findings: clinical.findings,
        clinicalIndicators: data.clinicalIndicators || {},
        clinicalContext: { ...emptyForm().clinicalContext, ...(data.clinicalContext || {}) },
        maternal: { ...emptyForm().maternal, ...(data.maternal || {}) },
      });
      setErrors(restored.lastError ? { submit: restored.lastError.message } : {});
      setSearchQuery("");
      setMode("form");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }).catch((err) => { if (guard()) showToast(submitErrorMessage(err), "error"); });
  };

  const handleDiscardDraft = (localId) => {
    if (!canConductConsultation) return;
    deleteConsultationDraft({ ownerId, localId }).then(() => refreshDrafts())
      .catch((err) => showToast(submitErrorMessage(err), "error"));
  };

  const recordRows = useMemo(
    () => consultations.filter((record) => !isHealthSupervisor || (assignedBarangay && record.resident?.barangay === assignedBarangay)).map((record) => ({ ...record })),
    [consultations, isHealthSupervisor, assignedBarangay]
  );
  const filteredRecordRows = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    const filtered = recordRows.filter((record) => {
      const date = String(record.consultationDate || "").slice(0, 10);
      const risk = consultationRisk(record);
      const searchMatches = !query || [
        record.resident?.name,
        record.resident?.id,
        record.resident?.healthRecordNo,
        record.resident?.health_record_no,
        record.healthRecordNo,
        record.health_record_no,
        record.id,
        record.consultationId,
        consultationServiceName(record),
        record.consultationDate,
        record.chiefComplaint,
        record.diagnosis,
      ].filter(Boolean).join(" ").toLowerCase().includes(query);
      const dateMatches = (!recordDateFrom || date >= recordDateFrom) && (!recordDateTo || date <= recordDateTo);
      const riskMatches = recordRisk === "All" || risk === recordRisk;
      const hasFollowUp = consultationFollowUp(record).has;
      const followUpMatches = recordFollowUp === "All"
        || recordFollowUp === "With Follow-up" && hasFollowUp
        || recordFollowUp === "Without Follow-up" && !hasFollowUp;
      return searchMatches && dateMatches && riskMatches && followUpMatches;
    });
    return filtered.sort((left, right) => {
      if (recordSort === "residentAsc" || recordSort === "residentDesc") {
        const comparison = (left.resident?.name || "").localeCompare(right.resident?.name || "", undefined, { sensitivity: "base" });
        return recordSort === "residentAsc" ? comparison : -comparison;
      }
      const comparison = `${left.consultationDate || ""}T${left.consultationTime || ""}`.localeCompare(`${right.consultationDate || ""}T${right.consultationTime || ""}`)
        || String(left.id).localeCompare(String(right.id));
      return recordSort === "oldest" ? comparison : -comparison;
    });
  }, [recordRows, recordSearch, recordDateFrom, recordDateTo, recordRisk, recordFollowUp, recordSort]);
  const hasRecordFilters = Boolean(recordSearch || recordDateFrom || recordDateTo || recordRisk !== "All" || recordFollowUp !== "All" || recordSort !== "newest");
  const clearRecordFilters = () => {
    setRecordSearch("");
    setRecordDateFrom("");
    setRecordDateTo("");
    setRecordRisk("All");
    setRecordFollowUp("All");
    setRecordSort("newest");
  };
  const displayedRecords = focusedId
    ? focusedRecord.data ? [focusedRecord.data] : []
    : filteredRecordRows.slice((recordPage - 1) * recordPageSize, recordPage * recordPageSize);
  useEffect(() => { setRecordPage(1); }, [recordSearch, recordDateFrom, recordDateTo, recordRisk, recordFollowUp, recordSort]);
  useEffect(() => {
    setRecordPage((page) => Math.min(page, Math.max(1, Math.ceil(filteredRecordRows.length / recordPageSize))));
  }, [filteredRecordRows.length, recordPageSize]);

  const columns = [
    { key: "resident", label: "Resident" },
    { key: "date", label: "Consultation Date" },
    { key: "service", label: "Health Service" },
    { key: "risk", label: "Risk Level" },
    { key: "followUp", label: "Follow-up" },
    { key: "actions", label: "Actions", align: "center", className: "consultation-records-actions-cell" },
  ];
  const serviceLabelFor = (row) =>
    consultationServiceName(row) || healthServices.find((service) => service.id === row.serviceId)?.name || "";
  const renderRecordActions = (row, presentation) => {
    const menuId = `${presentation}:${row.id}`;
    return (
      <div className="flex items-center justify-center">
        <ActionMenu
          open={openActionMenu === menuId}
          onOpenChange={(open) => setOpenActionMenu(open ? menuId : null)}
        >
          <ActionMenuTrigger label={`Actions for ${row.resident?.name || "consultation"}`} />
          <ActionMenuContent aria-label={`Actions for ${row.resident?.name || "consultation"}`}>
            <ActionMenuItem icon={Eye} onSelect={() => openRecord(row)}>View Details</ActionMenuItem>
            {canEditConsultation && !consultationDateIsPast(row) && (
              <ActionMenuItem icon={FileText} onSelect={() => openRecord(row, true)}>Edit Consultation</ActionMenuItem>
            )}
          </ActionMenuContent>
        </ActionMenu>
      </div>
    );
  };

  /* ------------------------- Entry form (unchanged style) ------------------------- */
  const renderForm = () => (
    <div className="grid gap-3 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)]">
      {/* Left Panel - Resident Search */}
      <Card className="h-fit p-3 lg:col-span-1">
        <h3 className="mb-3 font-semibold text-brand-ink">Resident Search</h3>
        <div className="mb-3 flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2">
          <Search className="w-4 h-4 text-brand-gray" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Name, barangay, ID or contact"
            aria-label="Search residents"
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {filteredResidents.map((resident) => {
            const active = selectedResident?.id === resident.id;
            const initials = resident.name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
            const selectResident = () => {
              if (busy || reviewLocalId || editingId) return;
              if (selectedResident?.id !== resident.id) {
                clinicalInputResident.current = null;
                setClinicalContext(null);
                setFormData((current) => ({ ...current, clinicalContext: emptyForm().clinicalContext, maternal: emptyForm().maternal, clinicalIndicators: {} }));
                setMaternalInfoCompleted(false);
                setMaternalInfoTouched(false);
                setMaternalInfoProtected(false);
              }
              setSelectedResident(resident);
              if (errors.resident) setErrors((prev) => ({ ...prev, resident: "" }));
            };
            return (
              <div
                key={resident.id}
                className={`rounded-btn border p-2.5 transition-colors ${
                  active ? "border-brand-blue bg-brand-light" : "border-brand-border bg-white dark:border-border dark:bg-card"
                }`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-semibold text-white">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-brand-ink" title={resident.name}>{resident.name}</p>
                    <p className="mt-0.5 text-xs text-brand-gray">{resident.age} yrs · {resident.sex} · {resident.barangay}</p>
                    {resident.healthRecordNo && <p className="mt-0.5 truncate text-xs text-brand-gray">Record: {resident.healthRecordNo}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || Boolean(reviewLocalId) || Boolean(editingId)}
                  onClick={selectResident}
                  className={`mt-2 min-h-8 w-full rounded-btn border px-3 py-1 text-sm font-medium transition-colors ${
                    active
                      ? "border-brand-blue bg-brand-blue text-white"
                      : "border-brand-border bg-white text-brand-blue hover:border-brand-blue hover:bg-brand-light dark:border-border dark:bg-card"
                  }`}
                >
                  {active ? "Selected" : "Select Resident"}
                </button>
              </div>
            );
          })}
          {filteredResidents.length === 0 && (
            <p className="text-sm text-brand-gray py-6 text-center">No residents found.</p>
          )}
        </div>
        {errors.resident && <p className="mt-3 text-xs text-brand-danger">{errors.resident}</p>}
      </Card>

      {/* Right Panel - Consultation Form */}
      <Card className="min-w-0 p-3 lg:col-span-1 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-brand-ink">
            {reviewLocalId ? "Review Queued Consultation" : editingId ? "Edit Treatment Consultation" : "Treatment Consultation Form"}
          </h3>
          {!editingId && !reviewLocalId && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand-blue">
              <Plus className="w-3.5 h-3.5" /> New Consultation
            </span>
          )}
        </div>

        {reviewLocalId && (
          <p className="mb-4 rounded-btn border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Original clinical information is retained read-only. Retries use the same operation UUID; reviewing this record does not create another consultation.
          </p>
        )}

        <fieldset disabled={Boolean(reviewLocalId)}>

        {/* Resident summary */}
        <div className="mb-5">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">Resident Information</h4>
          {selectedResident ? (
            <div className="grid min-w-0 gap-x-3 gap-y-1.5 rounded-btn border border-brand-border bg-brand-bg/40 p-2.5 sm:grid-cols-2 lg:grid-cols-3 dark:border-border dark:bg-card/40">
              <div className="min-w-0">
                <p className="mb-0.5 text-xs text-brand-gray">Full Name</p>
                <p className="truncate text-sm font-semibold text-brand-ink" title={selectedResident.name}>{selectedResident.name}</p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-brand-gray">Age / Sex</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.age} / {selectedResident.sex}</p>
              </div>
              <div className="min-w-0">
                <p className="mb-0.5 text-xs text-brand-gray">Barangay</p>
                <p className="break-words text-sm font-medium text-brand-ink">{selectedResident.barangay}</p>
              </div>
              {selectedResident.contact && selectedResident.contact !== "—" && (
                <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                  <p className="mb-0.5 text-xs text-brand-gray">Contact Number</p>
                  <p className="break-words text-sm font-medium text-brand-ink">{selectedResident.contact}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-btn border border-dashed border-brand-border bg-brand-bg/50 px-4 py-4 text-center text-sm text-brand-gray">
              Choose a resident from the search panel.
            </div>
          )}
        </div>

        {canViewHistory && ownerId && selectedResident?.id && <details className="mb-3 rounded-btn border border-brand-border px-3 dark:border-border">
          <summary className="cursor-pointer py-2 text-xs font-medium text-brand-blue">Resident health history</summary>
          {renderHistory(selectedResident,
          selectedResident?.id && savedHistory?.resident?.id === selectedResident.id ? savedHistory.revision
            : syncStatus.ownerId === ownerId ? syncStatus.lastSyncedAt : null,
          editingId)}
        </details>}

        {/* Consultation Information */}
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-blue">Consultation Information</h4>
          {contextError && <p role="alert" className="mb-3 text-xs text-brand-danger">{contextError} <button type="button" onClick={() => setContextRetry((value) => value + 1)} className="font-medium text-brand-blue hover:underline">Retry</button></p>}
          {clinicalContext?.previousAssessment && (
            <section className="mb-3 rounded-btn border border-brand-border bg-brand-bg/50 p-3 dark:bg-card-nested" aria-label="Earlier clinical assessment">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-sm font-semibold text-brand-ink dark:text-foreground">Earlier risk assessment</h5>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-brand-ink dark:bg-card dark:text-foreground">
                  {clinicalContext.previousAssessment.level || clinicalContext.previousAssessment.status || "Assessment recorded"}
                </span>
              </div>
              <p className="mt-1 text-xs text-brand-gray dark:text-muted-foreground">
                {clinicalContext.previousAssessment.consultationDate
                  ? `From consultation on ${formatDate(clinicalContext.previousAssessment.consultationDate)}`
                  : "From an earlier consultation"}
              </p>
              {consultationRiskReasons({ consultationRiskAssessment: clinicalContext.previousAssessment }) && (
                <p className="mt-1 break-words text-xs leading-5 text-brand-gray dark:text-muted-foreground">
                  {consultationRiskReasons({ consultationRiskAssessment: clinicalContext.previousAssessment })}
                </p>
              )}
            </section>
          )}
          <div className="mb-3 grid gap-x-3 gap-y-2 sm:grid-cols-2">
            <div>
              <label htmlFor="consultation-date" className="block text-xs text-brand-gray mb-1">Consultation Date <span className="text-brand-danger">*</span></label>
              <input
                id="consultation-date"
                type="date"
                required
                value={formData.consultationDate}
                onChange={(e) => setFormData({ ...formData, consultationDate: e.target.value })}
                className={inputCls(errors.consultationDate)}
                aria-invalid={Boolean(errors.consultationDate)}
              />
              {errors.consultationDate && <p className="mt-1 text-xs text-brand-danger">{errors.consultationDate}</p>}
            </div>
            <div>
              <label htmlFor="consultation-time" className="block text-xs text-brand-gray mb-1">Consultation Time <span className="text-brand-danger">*</span></label>
              <input
                id="consultation-time"
                type="time"
                required
                value={formData.consultationTime}
                onChange={(e) => setFormData({ ...formData, consultationTime: e.target.value })}
                className={inputCls(errors.consultationTime)}
                aria-invalid={Boolean(errors.consultationTime)}
              />
              {errors.consultationTime && <p className="mt-1 text-xs text-brand-danger">{errors.consultationTime}</p>}
            </div>
            <div className="sm:col-span-2">
              <ConsultationHealthServiceField
                value={formData.serviceId}
                services={healthServices}
                loading={servicesLoading}
                fieldError={errors.serviceId || ""}
                serviceError={servicesError}
                disabled={Boolean(reviewLocalId)}
                recordedName={formData.serviceName}
                recordedCategory={formData.serviceCategory}
                onChange={(selectedId) => {
                  const service = healthServices.find((item) => item.id === selectedId);
                  const nextFormData = {
                    ...formData,
                    serviceId: selectedId,
                    serviceName: service?.name || "",
                    serviceCategory: service?.category || "",
                  };
                  const nextIsMaternal = isMaternalHealthService(service || {
                    name: nextFormData.serviceName,
                    category: nextFormData.serviceCategory,
                  });
                  setFormData(nextFormData);
                  setErrors((previous) => {
                    const next = { ...previous, serviceId: "" };
                    for (const field of Object.keys(next)) if (field.startsWith("maternal.")) delete next[field];
                    if (!nextIsMaternal && ((maternalInfoTouched && hasMaternalDetails(nextFormData.maternal))
                      || (maternalInfoProtected && hasMaternalInformation(nextFormData.maternal)))) {
                      next.serviceId = "Select a Prenatal / Maternal health service to save the entered maternal information.";
                    } else if (nextIsMaternal) {
                      Object.assign(next, validateMaternalInformation(nextFormData, true));
                    }
                    return next;
                  });
                }}
              />
            </div>
            {maternalService && <section aria-label="Maternal Information" className="rounded-btn border border-brand-border bg-brand-bg/40 p-3 dark:border-border dark:bg-card/40 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-xs font-semibold text-brand-ink dark:text-foreground">Maternal Information</h5>
                {maternalInfoCompleted && <div className="flex items-center gap-2">
                  <StatusBadge value="Completed" className="whitespace-nowrap px-2 py-0.5 text-[10px]" />
                  <button type="button" aria-controls="maternal-information-fields" aria-expanded="false"
                    disabled={Boolean(reviewLocalId)} onClick={() => setMaternalInfoCompleted(false)}
                    className="rounded-btn px-2 py-1 text-xs font-medium text-brand-blue hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60">
                    Edit Maternal Information
                  </button>
                </div>}
              </div>
              {maternalInfoCompleted && <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                {[
                  ["Maternal care", formData.maternal.careType === "prenatal" ? "Prenatal consultation"
                    : formData.maternal.careType === "postpartum" ? "Postpartum consultation" : formData.maternal.careType],
                  ["Gestational age", formData.maternal.gestationalAgeWeeks !== "" && formData.maternal.gestationalAgeWeeks != null
                    ? `${formData.maternal.gestationalAgeWeeks} weeks` : ""],
                  ["LMP", formData.maternal.lmpDate ? formatDate(formData.maternal.lmpDate) : ""],
                  ["EDD", formData.maternal.eddDate ? formatDate(formData.maternal.eddDate) : ""],
                ].filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0">
                  <dt className="text-brand-gray">{label}</dt>
                  <dd className="break-words font-medium text-brand-ink dark:text-foreground" style={{ overflowWrap: "anywhere" }}>{value}</dd>
                </div>)}
              </dl>}
              <div id="maternal-information-fields" aria-hidden={maternalInfoCompleted}
                className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${maternalInfoCompleted ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
                <div className="min-h-0 overflow-hidden">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SearchableSelect label="Maternal Care Recorded" ariaLabel="Maternal care type" compact portalDropdown
                      value={formData.maternal.careType} disabled={Boolean(reviewLocalId) || maternalInfoCompleted}
                      options={[{ value: "prenatal", label: "Prenatal consultation" }, { value: "postpartum", label: "Postpartum consultation" }]}
                      onChange={(careType) => {
                        setMaternalInfoTouched(true);
                        setFormData((current) => ({ ...current, maternal: { ...current.maternal, careType } }));
                      }} />
                    <label className="text-xs text-brand-gray">Gestational Age (weeks)
                      <input aria-label="Gestational age in weeks" inputMode="decimal" disabled={Boolean(reviewLocalId) || maternalInfoCompleted}
                        value={formData.maternal.gestationalAgeWeeks ?? ""}
                        onChange={(event) => {
                          setMaternalInfoTouched(true);
                          setFormData((current) => ({ ...current, maternal: { ...current.maternal, gestationalAgeWeeks: event.target.value } }));
                        }}
                        className={`${inputCls(errors["maternal.gestationalAgeWeeks"])} mt-1.5`} placeholder="Confirmed age, if available" />
                    </label>
                    <label className="text-xs text-brand-gray">Last Menstrual Period
                      <input aria-label="Last menstrual period" type="date" disabled={Boolean(reviewLocalId) || maternalInfoCompleted}
                        value={formData.maternal.lmpDate || ""}
                        onChange={(event) => {
                          setMaternalInfoTouched(true);
                          setFormData((current) => ({ ...current, maternal: { ...current.maternal, lmpDate: event.target.value } }));
                        }}
                        className={`${inputCls(errors["maternal.lmpDate"])} mt-1.5`} />
                    </label>
                    <label className="text-xs text-brand-gray">Estimated Delivery Date
                      <input aria-label="Estimated delivery date" type="date" disabled={Boolean(reviewLocalId) || maternalInfoCompleted}
                        value={formData.maternal.eddDate || ""}
                        onChange={(event) => {
                          setMaternalInfoTouched(true);
                          setFormData((current) => ({ ...current, maternal: { ...current.maternal, eddDate: event.target.value } }));
                        }}
                        className={`${inputCls(errors["maternal.eddDate"])} mt-1.5`} />
                    </label>
                  </div>
                  {Object.entries(errors).filter(([field]) => field.startsWith("maternal.")).map(([field, message]) => <p key={field} role="alert" className="mt-1 text-xs text-brand-danger">{message}</p>)}
                  <div className="mt-3 flex justify-end">
                    <button type="button" aria-controls="maternal-information-fields" aria-expanded="true"
                      disabled={Boolean(reviewLocalId) || maternalInfoCompleted} onClick={completeMaternalInformation}
                      className="min-h-9 rounded-btn bg-brand-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
                      Complete Maternal Information
                    </button>
                  </div>
                </div>
              </div>
            </section>}
          </div>
          <div className="mb-3">
            <p className="text-xs text-brand-gray mb-1">Chief Complaint <span className="text-brand-danger">*</span></p>
            <input
              type="text"
              value={formData.chiefComplaint}
              onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
              placeholder="e.g. Fever, headache, prenatal check-up"
              className={inputCls(errors.chiefComplaint)}
            />
            {errors.chiefComplaint && <p className="mt-1 text-xs text-brand-danger">{errors.chiefComplaint}</p>}
          </div>
        </div>

        {/* Vital Signs */}
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-blue">Vital Signs</h4>
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <label htmlFor="vital-blood-pressure" className="mb-1 block text-xs text-brand-gray">Blood Pressure (mmHg) <span className="text-brand-danger">*</span></label>
              <div className={`flex w-full min-w-0 items-center rounded-btn border bg-white px-3 py-2 focus-within:border-brand-blue dark:bg-card ${errors.bloodPressure ? "border-brand-danger dark:border-brand-danger" : "border-brand-border dark:border-border"}`}>
                <input
                  id="vital-blood-pressure"
                  aria-label="Blood Pressure (mmHg)"
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder="120/80"
                  value={formData.bloodPressure}
                  onChange={(e) => {
                    const input = e.currentTarget;
                    if (/[^\d\s/]/.test(input.value)) {
                      const bloodPressure = input.value;
                      setFormData((prev) => ({ ...prev, bloodPressure }));
                      setErrors((prev) => ({ ...prev, bloodPressure: validateConsultationVitals({ ...formData, bloodPressure }).bloodPressure }));
                      return;
                    }
                    const formatted = formatBloodPressureInput(input.value, input.selectionStart, input.selectionEnd, e.nativeEvent.inputType);
                    if (formatted) {
                      input.value = formatted.value;
                      input.setSelectionRange(formatted.caret, formatted.caret);
                    }
                    const bloodPressure = input.value;
                    updateVital("bloodPressure", bloodPressure);
                  }}
                  aria-invalid={Boolean(errors.bloodPressure)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
              {bloodPressureCategory && (
                <div className="mt-1 min-w-0">
                  <span
                    className={`inline-flex max-w-full shrink-0 whitespace-normal rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ${bloodPressureCategory.badgeClassName}`}
                    aria-label={`Blood pressure category: ${bloodPressureCategory.category}`}
                  >
                    {bloodPressureCategory.category}
                  </span>
                    <p className={`mt-1 max-w-full min-w-0 break-words leading-4 ${bloodPressureCategory.referralEvaluationRequired ? "text-xs font-semibold text-brand-danger" : "text-[11px] text-brand-gray"}`} role={bloodPressureCategory.referralEvaluationRequired ? "alert" : "status"} aria-live={bloodPressureCategory.referralEvaluationRequired ? "assertive" : "polite"}>
                      {bloodPressureCategory.message}
                    </p>
                  {confirmedPregnancy?.isPregnant && <p className="mt-1 text-[11px] leading-4 text-brand-blue">Adult BP screening does not replace maternal assessment. Pregnancy with high BP requires prompt professional assessment.</p>}
                </div>
              )}
              {errors.bloodPressure && <p className="mt-1 text-xs text-brand-danger">{errors.bloodPressure}</p>}
            </div>
            <div>
              <label htmlFor="vital-temperature" className="block text-xs text-brand-gray mb-1">Temperature (°C) <span className="text-brand-danger">*</span></label>
              <input id="vital-temperature" type="text" inputMode="decimal" required aria-invalid={Boolean(errors.temperature)} placeholder="e.g. 36.7" value={formData.temperature} onChange={(e) => updateVital("temperature", e.target.value)} className={inputCls(errors.temperature)} />
              {errors.temperature && <p className="mt-1 text-xs text-brand-danger">{errors.temperature}</p>}
              {consultationTemperatureWarningVisible(formData.temperature) && <p className="mt-1 text-xs font-semibold text-brand-danger" role="alert">Abnormal body temperature requires clinical review.</p>}
            </div>
            <div>
              <label htmlFor="vital-pulse" className="block text-xs text-brand-gray mb-1">Pulse Rate (bpm) <span className="text-brand-danger">*</span></label>
              <input id="vital-pulse" type="text" inputMode="numeric" required aria-invalid={Boolean(errors.pulseRate)} placeholder="e.g. 74" value={formData.pulseRate} onChange={(e) => updateVital("pulseRate", e.target.value)} className={inputCls(errors.pulseRate)} />
              {errors.pulseRate && <p className="mt-1 text-xs text-brand-danger">{errors.pulseRate}</p>}
            </div>
            <div>
              <label htmlFor="vital-respiratory" className="block text-xs text-brand-gray mb-1">Respiratory Rate (breaths/min) <span className="text-brand-danger">*</span></label>
              <input id="vital-respiratory" type="text" inputMode="numeric" required aria-invalid={Boolean(errors.respiratoryRate)} placeholder="e.g. 18" value={formData.respiratoryRate} onChange={(e) => updateVital("respiratoryRate", e.target.value)} className={inputCls(errors.respiratoryRate)} />
              {errors.respiratoryRate && <p className="mt-1 text-xs text-brand-danger">{errors.respiratoryRate}</p>}
            </div>
            <div>
              <label htmlFor="vital-height" className="block text-xs text-brand-gray mb-1">Height (cm) <span className="text-brand-danger">*</span></label>
              <input id="vital-height" type="text" inputMode="decimal" required aria-invalid={Boolean(errors.height)} placeholder="e.g. 158" value={formData.height} onChange={(e) => updateVital("height", e.target.value)} className={inputCls(errors.height)} />
              {errors.height && <p className="mt-1 text-xs text-brand-danger">{errors.height}</p>}
            </div>
            <div>
              <label htmlFor="vital-weight" className="block text-xs text-brand-gray mb-1">Weight (kg) <span className="text-brand-danger">*</span></label>
              <input id="vital-weight" type="text" inputMode="decimal" required aria-invalid={Boolean(errors.weight)} placeholder="e.g. 62" value={formData.weight} onChange={(e) => updateVital("weight", e.target.value)} className={inputCls(errors.weight)} />
              {errors.weight && <p className="mt-1 text-xs text-brand-danger">{errors.weight}</p>}
            </div>
            <div>
              <label htmlFor="vital-bmi" className="block text-xs text-brand-gray mb-1">BMI (auto) <span className="text-brand-danger">*</span></label>
              <input
                id="vital-bmi"
                type="text"
                readOnly
                aria-readonly="true"
                aria-label="Body Mass Index, calculated automatically from height and weight"
                title="Calculated automatically from height and weight"
                tabIndex={-1}
                value={bmiDisplay}
                placeholder="—"
                className={`${inputCls(errors.bmi)} bg-brand-bg text-brand-blue font-medium cursor-default`}
              />
              {errors.bmi && <p className="mt-1 text-xs text-brand-danger">{errors.bmi}</p>}
            </div>
            <div>
              <label htmlFor="vital-oxygen" className="block text-xs text-brand-gray mb-1">Oxygen Saturation (%) <span className="text-brand-danger">*</span></label>
              <input id="vital-oxygen" type="text" inputMode="decimal" required aria-invalid={Boolean(errors.oxygenSaturation)} placeholder="e.g. 98" value={formData.oxygenSaturation} onChange={(e) => updateVital("oxygenSaturation", e.target.value)} className={inputCls(errors.oxygenSaturation)} />
              {errors.oxygenSaturation && <p className="mt-1 text-xs text-brand-danger">{errors.oxygenSaturation}</p>}
            </div>
          </div>
        </div>

        <ConsultationClinicalFields
          showDiagnosis={false}
          findings={formData.findings}
          onFindingsChange={(findings) => setFormData((current) => ({ ...current, findings }))}
          medications={formData.medications}
          onMedicationsChange={(medications) => setFormData((current) => ({ ...current, medications }))}
          recommendations={formData.adviceGiven}
          onRecommendationsChange={(adviceGiven) => {
            setFormData((current) => ({ ...current, adviceGiven }));
            if (adviceGiven.length <= 10000) setErrors((previous) => ({ ...previous, adviceGiven: "" }));
          }}
          errors={errors}
          disabled={Boolean(reviewLocalId)}
        />

        <div className="mb-4">
          <section className="mt-3" aria-label="Follow-up and referral">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-blue">Follow-up and Referral</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-brand-gray">Follow-up Required</p>
                <ButtonSelectGroup ariaLabel="Follow-up Required" disabled={Boolean(reviewLocalId)} value={formData.followUpRequired}
                  options={["Yes", "No"]}
                  onChange={(followUpRequired) => setFormData((current) => ({ ...current, followUpRequired, nextVisitDate: followUpRequired === "No" ? "" : current.nextVisitDate }))} />
              </div>
              {formData.followUpRequired === "Yes" && <label className="text-xs text-brand-gray">Follow-up Date <span className="text-brand-danger">*</span>
                <input type="date" aria-label="Follow-up date" required min={formData.consultationDate} value={formData.nextVisitDate} onChange={(event) => setFormData((current) => ({ ...current, nextVisitDate: event.target.value }))} className={`${inputCls(errors.nextVisitDate)} mt-1.5`} />
                {errors.nextVisitDate && <p role="alert" className="mt-1 text-xs text-brand-danger">{errors.nextVisitDate}</p>}
              </label>}
              <div>
                <p className="text-xs text-brand-gray">Referral Requested</p>
                <ButtonSelectGroup ariaLabel="Referral Requested" disabled={Boolean(reviewLocalId)} value={formData.referralRequired}
                  options={["Yes", "No"]}
                  onChange={(referralRequired) => setFormData((current) => ({ ...current, referralRequired }))} />
              </div>
              {(formData.followUpRequired === "Yes" || formData.referralRequired === "Yes") && <label className="text-xs text-brand-gray sm:col-span-2">Clinical History / Remarks
                <textarea rows={2} aria-label="Clinical history or remarks" value={formData.remarks} onChange={(event) => setFormData((current) => ({ ...current, remarks: event.target.value }))} className={`${inputCls(errors.remarks)} mt-1.5 resize-y`} />
              </label>}
            </div>
          </section>
        </div>

        </fieldset>

        {/* Buttons */}
        <div className="mt-6 pb-2">
          {errors.submit && (
            <div className="mb-3 rounded-btn border border-brand-danger/30 bg-red-50/60 px-3 py-2" role="alert" aria-live="assertive">
              <p className="text-sm text-brand-danger">{errors.submit}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={cancelForm}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
            {!reviewLocalId && <button
              onClick={handleSave}
              disabled={busy}
              aria-busy={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {busy
                ? (editingId ? "Updating Consultation..." : "Saving Consultation...")
                : (editingId ? "Update Consultation" : "Save Consultation")}
            </button>}
          </div>
        </div>
      </Card>
    </div>
  );

  /* ----------------------------- Records list ---------------------------- */
  const renderRecords = () => (
    <>
      {focusedId && <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-section font-semibold text-brand-ink">Selected Consultation</h3><p className="mt-0.5 break-all text-caption text-brand-gray">Record {focusedId}</p></div>
          <button type="button" className="supervisor-button" onClick={() => { const next = new URLSearchParams(searchParams); next.delete("consultation"); setSearchParams(next, { replace: true }); }}>Show All Records</button>
        </div>
        {focusedRecord.loading ? <p role="status" className="py-4 text-ui text-brand-gray">Loading the selected consultation...</p> : focusedRecord.error ? <ErrorState compact title="Selected consultation unavailable" message={focusedRecord.error} onRetry={focusedRecord.refresh} /> : focusedRecord.data && <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-brand-border pt-3"><p className="text-ui font-medium text-brand-ink">{focusedRecord.data.resident?.name || "Resident name unavailable"}</p><StatusBadge className="capitalize" value={String(focusedRecord.data.status || "Not recorded").replace(/_/g, " ")} /></div>
          <dl className="mt-3 grid gap-x-5 gap-y-3 text-ui sm:grid-cols-2">{[
            ["Consultation Date", formatDate(focusedRecord.data.consultationDate)],
            ["Health Service", consultationServiceName(focusedRecord.data)],
            ["Blood Pressure Classification", consultationBloodPressureClassification(focusedRecord.data)?.category
              || consultationBloodPressureClassification(focusedRecord.data)?.label],
            ["Chief Complaint", focusedRecord.data.chiefComplaint],
            ["Clinical Findings", focusedRecord.data.findings],
            ["Diagnosis", focusedRecord.data.diagnosis],
            ["Risk Level", consultationRisk(focusedRecord.data)],
            ["Risk Reasons", consultationRiskReasons(focusedRecord.data)],
            ["Treatment Given", focusedRecord.data.treatmentGiven],
            ["Advice", focusedRecord.data.adviceGiven],
            ["Remarks", focusedRecord.data.remarks],
          ].map(([label, value]) => <div key={label}><dt className="text-caption text-brand-gray">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-brand-ink">{value || "Not recorded"}</dd></div>)}</dl>
        </>}
      </Card>}
      {/* Summary strip */}
      <div className="supervisor-metric-grid mb-5">
        <StatCard
          variant="ledger"
          label="TOTAL CONSULTATIONS"
          value={recordRows.length}
          description="All recorded consultations"
          tone="blue"
        />
        <StatCard
          variant="ledger"
          label="THIS MONTH"
          value={recordRows.filter((c) => (c.consultationDate || "").startsWith(getManilaDateTime().date.slice(0, 7))).length}
          description="Current month count"
          tone="blue"
        />
        <StatCard
          variant="ledger"
          label="WITH FOLLOW-UP"
          value={recordRows.filter((c) => consultationFollowUp(c).has).length}
          description="Records with follow-up"
          tone="danger"
        />
      </div>

      <Card className="p-4 sm:p-5">
        {/* Filter Controls */}
        <div className="mb-5">
          {/* Unified Filter Row: Search + Date Range + Risk + Follow-up + Sort */}
          <div className="mb-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {/* Search - 30% */}
            <div style={{ minWidth: 0 }}>
              <label htmlFor="filter-search" className="block text-xs text-brand-gray mb-1.5 font-medium">Search</label>
              <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 h-9" style={{ minWidth: 0 }}>
                <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
                <input
                  id="filter-search"
                  type="search"
                  value={recordSearch}
                  onChange={(event) => setRecordSearch(event.target.value)}
                  placeholder="Resident, health record..."
                  aria-label="Search consultation records"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray"
                  style={{ minWidth: 0 }}
                />
              </div>
            </div>
            
            {/* Date Range - 24% */}
            <div style={{ minWidth: 0 }}>
              <label className="block text-xs text-brand-gray mb-1.5 font-medium">Date Range</label>
              <div style={{ minWidth: 0 }}>
                <DateRangePicker
                  startDate={recordDateFrom}
                  endDate={recordDateTo}
                  onApply={(start, end) => {
                    setRecordDateFrom(start);
                    setRecordDateTo(end);
                  }}
                  placeholder="Select date range"
                />
              </div>
            </div>

            {/* Risk Level - 15% */}
            <div style={{ minWidth: 0 }}>
              <label htmlFor="filter-risk" className="block text-xs text-brand-gray mb-1.5 font-medium">Risk</label>
              <select
                id="filter-risk"
                value={recordRisk}
                onChange={(event) => setRecordRisk(event.target.value)}
                aria-label="Risk level filter"
                className="w-full rounded-btn border border-brand-border bg-white px-3 py-2 h-9 text-sm text-brand-ink outline-none focus:border-brand-blue"
                style={{ minWidth: 0 }}
              >
                <option value="All">All</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
                <option value="Unassessed">Unassessed</option>
              </select>
            </div>

            {/* Follow-up Status - 15% */}
            <div style={{ minWidth: 0 }}>
              <label htmlFor="filter-followup" className="block text-xs text-brand-gray mb-1.5 font-medium">Follow-up</label>
              <select
                id="filter-followup"
                value={recordFollowUp}
                onChange={(event) => setRecordFollowUp(event.target.value)}
                aria-label="Follow-up filter"
                className="w-full rounded-btn border border-brand-border bg-white px-3 py-2 h-9 text-sm text-brand-ink outline-none focus:border-brand-blue"
                style={{ minWidth: 0 }}
              >
                <option value="All">All</option>
                <option value="With Follow-up">With Follow-up</option>
                <option value="Without Follow-up">Without Follow-up</option>
              </select>
            </div>

            {/* Sorting - 16% */}
            <div style={{ minWidth: 0 }}>
              <label htmlFor="filter-sort" className="block text-xs text-brand-gray mb-1.5 font-medium">Sort</label>
              <select
                id="filter-sort"
                value={recordSort}
                onChange={(event) => setRecordSort(event.target.value)}
                aria-label="Sort consultation records"
                className="w-full rounded-btn border border-brand-border bg-white px-3 py-2 h-9 text-sm text-brand-ink outline-none focus:border-brand-blue"
                style={{ minWidth: 0 }}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="residentAsc">Name (A-Z)</option>
                <option value="residentDesc">Name (Z-A)</option>
              </select>
            </div>
          </div>

          {/* Clear Filters Button */}
          {hasRecordFilters && (
            <button
              type="button"
              onClick={clearRecordFilters}
              className="text-sm font-medium text-brand-blue hover:text-brand-dark transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>

        {/* Results Count */}
        <div className="mb-3 text-sm text-brand-gray">
          {filteredRecordRows.length} {filteredRecordRows.length === 1 ? 'consultation' : 'consultations'} found
        </div>
        {offlineDrafts.length > 0 && (
          <div className="mb-5 rounded-btn border border-amber-300 bg-amber-50/70 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-sm font-semibold text-amber-800">
                Awaiting server confirmation ({offlineDrafts.length})
              </p>
            </div>
            <p className="text-xs text-amber-700 mb-3">
              Clinical information is retained on this device. Pending consultations sync automatically on reconnect using their original operation UUID.
              Failed or conflicting records remain available for review; a lost response may already have reached the server.
            </p>
            <ul className="space-y-2">
              {offlineDrafts.map((draft) => (
                <li
                  key={draft.localId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-amber-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-ink truncate">
                      {draft.chiefComplaint || "Consultation"}
                      {draft.clinicalFindingsDiagnosis ? ` — ${draft.clinicalFindingsDiagnosis.split("\n")[0]}` : draft.diagnosis ? ` — ${draft.diagnosis}` : ""}
                    </p>
                    <p className="text-xs text-brand-gray">
                      {formatDate(draft.consultationDate)} · Resident {draft.residentId || "—"} · {draft.syncStatus}
                    </p>
                    {draft.lastError && <p className="mt-1 text-xs text-brand-danger" role="alert">{draft.lastError.message}</p>}
                    {draft.referralRequired === "Yes" && <p className="mt-1 text-xs text-amber-800">Referral creation remains a separate online action after consultation confirmation.</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => handleEditDraft(draft.localId)}
                      className="text-brand-blue text-sm font-medium hover:underline"
                    >
                      Review
                    </button>
                    {canConductConsultation && draft.queueStatus !== "conflict" && <button
                      onClick={() => handleSubmitDraft(draft.localId)}
                      disabled={draftBusyId === draft.localId || draft.queueStatus === "syncing"}
                      className="inline-flex items-center gap-1 rounded-btn bg-brand-blue text-white px-3 py-1.5 text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      {draftBusyId === draft.localId ? "Retrying..." : "Retry Sync"}
                    </button>}
                    {canConductConsultation && draft.canDiscard && <button
                      onClick={() => handleDiscardDraft(draft.localId)}
                      className="text-brand-danger text-sm font-medium hover:underline"
                    >
                      Discard
                    </button>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loadError ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-brand-danger">{loadError}</p>
            <button
              onClick={load}
              className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <DataTable
              className={`consultation-records-table ${isHealthSupervisor ? "hidden xl:block" : ""}`}
              tableClassName="consultation-records-grid"
              fitContainer
              compact={isHealthSupervisor}
              mobileBreakpoint={isHealthSupervisor ? "xl" : "md"}
              mobileCards={!isHealthSupervisor}
              columns={columns}
              rows={displayedRecords}
              dense={isHealthSupervisor}
              renderCell={(key, row, presentation) => {
                if (key === "resident")
                  return (
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold shrink-0">
                        {initialsOf(row.resident?.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="break-words font-medium text-brand-ink" title={row.resident?.name}>{row.resident?.name || "Name not recorded"}</p>
                        <p className="text-xs text-brand-gray">{row.resident?.barangay || ""}</p>
                      </div>
                    </div>
                  );
                if (key === "date") return <span className="whitespace-nowrap text-xs tabular-nums text-brand-ink">{formatDate(row.consultationDate)}</span>;
                if (key === "service") {
                  const label = serviceLabelFor(row);
                  return label ? (
                    <span className="inline-flex max-w-[180px] items-center truncate rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand-blue" title={label}>
                      {label}
                    </span>
                  ) : (
                    <span className="text-xs text-brand-gray">{row.serviceId || row.healthServiceId ? "Registered service unavailable" : "No service recorded"}</span>
                  );
                }
                if (key === "risk") {
                  return <div title={consultationRiskReasons(row)}>
                    <RiskBadge level={consultationRisk(row)} mediumLabel="Medium" />
                  </div>;
                }
                if (key === "followUp") {
                  const followUp = consultationFollowUp(row);
                  return <StatusBadge value={followUp.status} className="whitespace-nowrap px-2 py-0.5 text-[11px]" />;
                }
                if (key === "actions") {
                  return renderRecordActions(row, presentation);
                }
                return row[key];
              }}
            />
            {isHealthSupervisor && (
              <div className="space-y-3 xl:hidden">
                {displayedRecords.map((row) => {
                  const service = serviceLabelFor(row);
                  const followUp = consultationFollowUp(row);
                  return (
                    <article key={row.id} className="rounded-xl border border-brand-border bg-white p-3.5 shadow-sm">
                      <header className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-semibold text-brand-blue" aria-hidden="true">
                          {initialsOf(row.resident?.name)}
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <p className="break-words text-sm font-semibold leading-5 text-brand-ink">
                            {row.resident?.name || "Name not recorded"}
                          </p>
                          <p className="mt-0.5 break-words text-xs leading-4 text-brand-gray">
                            {row.resident?.barangay || "Barangay not recorded"}
                          </p>
                        </div>
                        <div className="shrink-0">{renderRecordActions(row, "card")}</div>
                      </header>
                      <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-3 border-t border-brand-border/70 pt-3">
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">Consultation Date</dt>
                          <dd className="mt-1 break-words text-xs leading-4 text-brand-ink">{formatDate(row.consultationDate)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">Risk Level</dt>
                          <dd className="mt-1"><RiskBadge level={consultationRisk(row)} mediumLabel="Medium" /></dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">Health Service</dt>
                          <dd className="mt-1 break-words text-xs leading-4 text-brand-ink">
                            {service || (row.serviceId || row.healthServiceId ? "Registered service unavailable" : "No service recorded")}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">Follow-up Status</dt>
                          <dd className="mt-1">
                            <StatusBadge value={followUp.status} className="whitespace-normal px-2 py-0.5 text-[11px]" />
                          </dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </div>
            )}
            {!focusedId && filteredRecordRows.length > 0 && <TablePagination total={filteredRecordRows.length} page={recordPage} pageSize={recordPageSize} onPageChange={setRecordPage} onPageSizeChange={(size) => { setRecordPageSize(size); setRecordPage(1); }} className="mt-3" />}
            {focusedId ? null : loading ? (
              <p className="py-10 text-center text-sm text-brand-gray">Loading consultations...</p>
            ) : filteredRecordRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-brand-gray">No consultations yet. Click "+ Add Treatment Consultation" to record the first one.</p>
            ) : null}
          </>
        )}
      </Card>
      <Dialog.Root open={Boolean(detailRecord)} onOpenChange={(open) => { if (!open) setDetailRecord(null); }}>
        {detailRecord && (
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[55] flex max-h-[88dvh] w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-brand-border bg-white shadow-2xl focus:outline-none dark:border-border dark:bg-card sm:w-[min(94vw,1000px)]">
              <header className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border px-4 py-3 dark:border-border sm:px-6">
                <div className="min-w-0">
                   <Dialog.Title className="break-words text-lg font-semibold text-brand-ink dark:text-foreground">Consultation Details</Dialog.Title>
                   <p className="mt-0.5 break-words text-sm text-brand-gray dark:text-muted-foreground">{detailRecord.resident?.name || "Resident"} · {formatDate(detailRecord.consultationDate)}</p>
                   <Dialog.Description className="sr-only">Consultation information for {detailRecord.resident?.name || "Resident"}</Dialog.Description>
                </div>
                <Dialog.Close asChild>
                   <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-brand-gray hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:hover:bg-hover" aria-label="Close consultation details"><X className="h-5 w-5" /></button>
                </Dialog.Close>
              </header>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 pb-6 sm:space-y-5 sm:px-6">
                {[
                   ["Consultation Information", [
                     ["Resident Name", detailRecord.resident?.name],
                     ["Consultation Date", formatDate(detailRecord.consultationDate)],
                     ["Consultation Time", detailRecord.consultationTime ? `${detailRecord.consultationTime} (Asia/Manila)` : "Not recorded"],
                     ["Health Service", consultationServiceName(detailRecord)],
                     ["Chief Complaint", detailRecord.chiefComplaint],
                   ]],
                   ["Clinical Information", [
                     ["Clinical Findings", detailRecord.findings],
                     ["Diagnosis", detailRecord.diagnosis],
                     ["Risk Level", consultationRisk(detailRecord)],
                     ["Risk Reasons", consultationRiskReasons(detailRecord)],
                     ["Risk Review", consultationAssessment(detailRecord)?.review?.reason],
                   ]],
                   ["Vital Signs", [["Vital Signs", parseVitals(detailRecord.vitals)]]],
                   ["Treatment and Care", [
                     ["Treatment", detailRecord.treatmentGiven],
                     ["Medicines", (detailRecord.medications || []).length ? detailRecord.medications.map((medicine) => typeof medicine === "string" ? medicine : [medicine.genericName || medicine.name, medicine.strength, medicine.dose || medicine.dosage, medicine.frequency, medicine.route, medicine.duration, medicine.quantity != null && medicine.quantity !== "" ? `Quantity: ${medicine.quantity}` : "", medicine.instructions].filter(Boolean).join(" / ")).join("\n") : detailRecord.medicationPrescribed],
                     ["Recommendations", [detailRecord.adviceGiven, ...(detailRecord.referrals || []).map((referral) => ["Referral:", referral.destination_facility || referral.receiving_facility, referral.reason, referral.status, referral.resolution_notes].filter(Boolean).join(" "))].filter(Boolean).join("\n")],
                     ["Follow-up", [consultationFollowUp(detailRecord).status, ...(detailRecord.followUps || []).map((followUp) => [followUp.scheduled_date || followUp.scheduledDate, followUp.status, followUp.outcome, followUp.notes].filter(Boolean).join(" / "))].join("\n")],
                   ]],
                   ["Recording Information", [
                     ["Recording Personnel", [detailRecord.recordedByName || detailRecord.personnelName, detailRecord.consultingPersonnel && `Attending: ${detailRecord.consultingPersonnel}`].filter(Boolean).join("\n")],
                   ]],
                ].map(([section, fields]) => (
                   <section key={section} aria-label={section}>
                     <h4 className="border-b border-brand-border pb-2 text-xs font-semibold uppercase tracking-wide text-brand-blue dark:border-border">{section}</h4>
                     <div className="mt-3 grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
                       {fields.map(([label, value]) => {
                         const entries = label === "Vital Signs" && value && typeof value === "object"
                           ? Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== "")
                           : [];
                         const fullWidth = ["Chief Complaint", "Clinical Findings", "Risk Reasons", "Risk Review", "Treatment", "Medicines", "Recommendations", "Follow-up", "Recording Personnel"].includes(label);
                         return (
                           <div key={label} className={`min-w-0 rounded-lg border border-brand-border bg-brand-bg/30 p-3 dark:border-border dark:bg-background ${fullWidth ? "sm:col-span-2" : ""}`}>
                             <p className="text-xs font-medium text-brand-gray dark:text-muted-foreground">{label}</p>
                             {label === "Vital Signs" ? (
                               entries.length ? <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">{entries.map(([key, item]) => <div key={key} className="flex min-w-0 flex-wrap justify-between gap-x-3 text-sm"><dt className="text-brand-gray dark:text-muted-foreground">{formatVitalLabel(key)}</dt><dd className="font-medium text-brand-ink dark:text-foreground">{String(item)}{["temperature"].includes(key) ? " °C" : ["heightCm", "height"].includes(key) ? " cm" : ["weightKg", "weight"].includes(key) ? " kg" : ["o2sat", "oxygenSaturation"].includes(key) ? "%" : ""}</dd></div>)}</dl> : <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Not recorded</p>
                             ) : <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-brand-ink dark:text-foreground">{value || "Not recorded"}</p>}
                           </div>
                         );
                       })}
                     </div>
                   </section>
                ))}
                <section aria-label="Laboratory Results">
                   <h4 className="border-b border-brand-border pb-2 text-xs font-semibold uppercase tracking-wide text-brand-blue dark:border-border">Laboratory Results</h4>
                   <LabResultsPanel residentId={detailRecord.resident?.id || detailRecord.residentId} consultationId={detailRecord.offline ? undefined : detailRecord.id} compact hideHeading />
                </section>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </Dialog.Root>
    </>
  );

  return (
    <>
      <PageHeader
        crumbs={["Consultations"]}
        title="Treatment Consultation"
        subtitle="Record consultation findings, treatment, and recommendations for residents."
        dense
        action={
          mode === "list" ? (
            canConductConsultation ? (
              <button
                onClick={startNewConsultation}
                className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Treatment Consultation
              </button>
            ) : null
          ) : (
            <button
              onClick={cancelForm}
              className="flex items-center gap-2 border border-brand-border bg-white text-brand-gray px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Back to Records
            </button>
          )
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          {toast.kind === "success" ? <CheckCircle2 className="w-4 h-4 text-brand-green" /> : <AlertTriangle className={`w-4 h-4 ${toast.kind === "error" ? "text-red-300" : "text-amber-300"}`} />}
          <span className="text-sm" role={toast.kind === "error" ? "alert" : "status"}>{toast.message}</span>
        </div>
      )}

      {mode === "list" ? renderRecords() : renderForm()}
    </>
  );
}
