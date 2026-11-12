import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import DataTable from "@/components/tables/DataTable";
import TablePagination from "@/components/tables/TablePagination";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import RiskBadge from "@/components/common/RiskBadge";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import {
  Search, FileText, Save, X, Plus, CheckCircle2, ChevronLeft, MoreVertical, Eye, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { api, consultationsApi, residentsApi, healthServicesApi } from "@/services/api";
import MedicineSelector from "@/features/consultations/components/MedicineSelector";
import DateRangePicker from "@/features/consultations/components/DateRangePicker";
import { classifyBloodPressure as classifyBp } from "@/features/consultations/utils/bpClassification";
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
import { captureOwnerGuard } from "@/services/offline/db";
import { useSyncStatus } from "@/hooks/useSyncStatus";

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue ${
    error ? "border-brand-danger bg-red-50/40" : "border-brand-border"
  }`;

/**
 * Inline Yes/No segmented control used for the boolean-style consultation
 * fields (Follow-up Required, Referral Required). It replaces the old native
 * <select> while keeping the exact "Yes"/"No" string values the form state,
 * validation and API already expect. The control behaves as an accessible
 * radio group: it exposes an accessible group label, uses roving tabindex so
 * the selected option is reachable by Tab, supports arrow-key navigation, and
 * highlights the active option with the subtle blue KALUSAGAP accent.
 */
function YesNoToggle({ label, value, onChange, required = false }) {
  const options = ["Yes", "No"];
  const handleKeyDown = (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const current = options.indexOf(value);
    const base = current === -1 ? 0 : current;
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const nextIdx = forward
      ? (base + 1) % options.length
      : (base - 1 + options.length) % options.length;
    onChange(options[nextIdx]);
  };
  return (
    <div>
      <p className="text-xs text-brand-gray mb-1">
        {label}
        {required && <span className="text-brand-danger"> *</span>}
      </p>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center gap-0.5 rounded-btn border border-brand-border bg-white p-0.5"
      >
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${label}: ${opt}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(opt)}
              className={`min-w-[3.25rem] rounded-[0.45rem] px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 ${
                active
                  ? "border border-brand-blue bg-brand-light text-brand-blue"
                  : "border border-transparent text-brand-gray hover:text-brand-ink"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A value is a valid, positive measurement, or empty (the field is optional). */
const isPositiveOrEmpty = (value) => {
  if (value === "" || value == null) return true;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0;
};

/**
 * UI-only BMI = weight(kg) / heightMeters². Returns a 2-decimal string, or ""
 * when either input is missing or invalid. Guards against NaN/Infinity/division
 * by zero and negative values so "NaN"/"Infinity" never reach the field. BMI is
 * never persisted from this form — the server owns any stored BMI value.
 */
const computeBmiDisplay = (heightCm, weightKg) => {
  const h = Number.parseFloat(heightCm);
  const w = Number.parseFloat(weightKg);
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return "";
  const heightM = h / 100;
  const bmi = w / (heightM * heightM);
  if (!Number.isFinite(bmi)) return "";
  return bmi.toFixed(2);
};

/**
 * Map a failed save to a clear, status-appropriate message. The backend's
 * specific message (e.g. a 422 validation reason) is preferred when present;
 * otherwise a friendly per-status fallback is used. Credentials/tokens are
 * never surfaced here.
 */
const submitErrorMessage = (err) => {
  const status = err?.status;
  const backendMsg = err?.message && !/^Request failed with status/i.test(err.message) ? err.message : "";
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
  consultationDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
  consultationTime: "",
  chiefComplaint: "",
  bloodPressure: "",
  temperature: "",
  pulseRate: "",
  respiratoryRate: "",
  height: "",
  weight: "",
  oxygenSaturation: "",
  clinicalFindingsDiagnosis: "",
  treatmentGiven: "",
  medicationPrescribed: "",
  medications: [],
  adviceGiven: "",
  followUpRequired: "No",
  nextVisitDate: "",
  referralRequired: "No",
  serviceId: "",
  serviceName: "",
  remarks: "",
});

/**
 * @typedef {Object} FormErrors
 * @property {string} [resident]
 * @property {string} [consultationDate]
 * @property {string} [chiefComplaint]
 * @property {string} [bloodPressure]
 * @property {string} [temperature]
 * @property {string} [pulseRate]
 * @property {string} [respiratoryRate]
 * @property {string} [height]
 * @property {string} [weight]
 * @property {string} [oxygenSaturation]
 * @property {string} [clinicalFindingsDiagnosis]
 * @property {string} [treatmentGiven]
 * @property {string} [nextVisitDate]
 * @property {string} [submit]
 */

const toResidentOption = (r) => ({
  id: r.id,
  name: r.name || [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
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
});

/** Keep the record list readable: strip time for the table. */
const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermissions();
  const canConductConsultation = can("consultation.conduct");
  const canEditConsultation = can("consultation.records.update");
  const isHealthSupervisor = user?.role === "health_supervisor";
  const canViewConsultations = can("consultation.requests.view");
  const focusedId = isHealthSupervisor ? searchParams.get("consultation") : null;
  const [allResidents, setAllResidents] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Owner-scoped write-ahead queue. Background reconnect sync uses the same
  // immutable operation as the first online attempt.
  const ownerId = user?.id || null;
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
  const [openActionMenu, setOpenActionMenu] = useState(null);

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
  const [searchQuery, setSearchQuery] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordDateFrom, setRecordDateFrom] = useState("");
  const [recordDateTo, setRecordDateTo] = useState("");
  const [recordRisk, setRecordRisk] = useState("All");
  const [recordFollowUp, setRecordFollowUp] = useState("All");
  const [recordSort, setRecordSort] = useState("newest");
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(8);
  const [formData, setFormData] = useState(emptyForm());
  const [errors, setErrors] = useState(/** @type {FormErrors} */ ({}));
  const [toast, setToast] = useState(null);
  // Active Health Services catalog records for the service selector. An
  // existing inactive association is shown separately as a disabled option.
  const [healthServices, setHealthServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState("");

  // Read-only BMI, recomputed immediately whenever height or weight changes.
  const bmiDisplay = useMemo(
    () => computeBmiDisplay(formData.height, formData.weight),
    [formData.height, formData.weight],
  );
  const bloodPressureCategory = useMemo(
    () => classifyBp(formData.bloodPressure),
    [formData.bloodPressure],
  );

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
      listConsultationResidentsOffline({ ownerId, fetchList: () => residentsApi.list({ limit: 200, verified: true }) }),
      listConsultationsOffline({ ownerId, fetchList: () => consultationsApi.list() }),
    ]).then(([residentRows, consultationRows]) => {
        if (!guard()) return;
        setAllResidents(residentRows);
        setConsultations(consultationRows.filter((row) => !row.offline));
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
    setAllResidents([]);
    setConsultations([]);
    setOfflineDrafts([]);
    setReviewLocalId(null);
    setMode("list");
    setEditingId(null);
    setSelectedResident(null);
    setFormData(emptyForm());
    setSearchQuery("");
    setErrors({});
    setBusy(false);
    setDraftBusyId(null);
    setToast(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!openActionMenu) return undefined;
    const close = (event) => {
      if (!event.target.closest("[data-consultation-actions]")) setOpenActionMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openActionMenu]);

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
    setServicesLoading(true);
    setServicesError("");
    healthServicesApi
      .list()
      .then((res) => {
        if (!active) return;
        const rows = Array.isArray(res) ? res : res?.rows || res?.records || [];
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
  }, []);

  const filteredResidents = residentOptions.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.barangay.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const showToast = (message, kind = "success") => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3000);
  };

  const startNewConsultation = () => {
    if (!canConductConsultation) return;
    setEditingId(null);
    setReviewLocalId(null);
    setSelectedResident(null);
    setFormData(emptyForm());
    setErrors({});
    setSearchQuery("");
    setMode("form");
  };

  const openForEdit = (record) => {
    if (!canEditConsultation) return;
    setEditingId(record.id);
    setReviewLocalId(null);
    setSelectedResident(record.resident || null);
    // Vitals are returned nested under record.vitals (bp/temperature/hr/rr/
    // heightCm/weightKg/o2sat); map them back to the flat form fields so an
    // edited consultation shows its saved vitals instead of blanks.
    const v = record.vitals || {};
    // Merge findings and diagnosis for the combined field
    const mergedClinicalData = [
      record.findings || "",
      record.diagnosis || ""
    ].filter(Boolean).join("\n");
    setFormData({
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
      clinicalFindingsDiagnosis: mergedClinicalData,
      treatmentGiven: record.treatmentGiven || "",
      medicationPrescribed: record.medicationPrescribed || "",
      medications: Array.isArray(record.medications) ? record.medications : [],
      adviceGiven: record.adviceGiven || "",
      followUpRequired: record.followUpRequired || "No",
      nextVisitDate: record.nextVisitDate || "",
      referralRequired: record.referralRequired || "No",
      serviceId: record.serviceId || "",
      serviceName: record.serviceName || "",
      remarks: record.remarks || "",
    });
    setErrors({});
    setSearchQuery("");
    setMode("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelForm = () => {
    setMode("list");
    setEditingId(null);
    setReviewLocalId(null);
    setSelectedResident(null);
    setFormData(emptyForm());
    setErrors({});
  };

  const validate = () => {
    const next = {};
    if (!selectedResident) next.resident = "Please select a resident.";
    if (!formData.consultationDate) next.consultationDate = "Consultation date is required.";
    if (!formData.chiefComplaint.trim()) next.chiefComplaint = "Chief complaint is required.";
    if (!formData.clinicalFindingsDiagnosis.trim()) next.clinicalFindingsDiagnosis = "Clinical findings and diagnosis are required.";
    if (!formData.treatmentGiven.trim()) next.treatmentGiven = "Treatment provided is required.";
    if (!isPositiveOrEmpty(formData.height)) next.height = "Height must be a number greater than 0.";
    if (!isPositiveOrEmpty(formData.weight)) next.weight = "Weight must be a number greater than 0.";
    if (formData.followUpRequired === "Yes" && !formData.nextVisitDate) {
      next.nextVisitDate = "Next visit date is required when a follow-up is needed.";
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
      residentId: selectedResident.id,
    };
    setBusy(true);
    const needsReferral = !editingId && formData.referralRequired === "Yes";

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
        reason: formData.clinicalFindingsDiagnosis || formData.chiefComplaint || "",
        riskLevel: "High",
        findings: formData.clinicalFindingsDiagnosis || "",
        chiefComplaints: formData.chiefComplaint || "",
        clinicalHistory: "",
        physicalExamFindings: formData.clinicalFindingsDiagnosis || "",
        impression: formData.clinicalFindingsDiagnosis || "",
        recommendations: formData.adviceGiven || "",
        clinicalNotes: formData.remarks || "",
        referringFacility: selectedResident.barangay ? `${selectedResident.barangay} Health Station` : "",
        treatmentVisitId: saved?.id || "",
      };
      cancelForm();
      navigate("/app/health_supervisor/referrals", { state: { referralDraft } });
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
        if (focusedId === editingId) void focusedRecord.refresh();
        showToast("Consultation updated successfully.");
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
        setConsultations((current) => [saved, ...current]);
        showToast("Consultation saved successfully.");
        if (needsReferral) {
          openReferral(saved);
          return;
        }
        cancelForm();
        return;
      }
      // Saved locally — referral creation needs a server-confirmed visit, so it
      // is deferred until this draft is submitted online.
      showToast(needsReferral
        ? "Saved on this device. It will sync automatically on reconnect. Create the referral separately after server confirmation."
        : "Saved on this device. Awaiting server confirmation; reconnect retries automatically.", "pending");
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
      const resident =
        residentOptions.find((r) => r.id === data.residentId) ||
        (data.residentId ? { id: data.residentId, name: data.residentId, barangay: "" } : null);
      // Merge findings and diagnosis for the combined field
      const mergedClinicalData = [
        data.findings || data.clinicalFindingsDiagnosis || "",
        data.diagnosis || ""
      ].filter(Boolean).join("\n");
      setEditingId(null);
      setReviewLocalId(localId);
      setSelectedResident(resident);
      setFormData({ 
        ...emptyForm(),
        ...data,
        clinicalFindingsDiagnosis: mergedClinicalData,
        // Clear old separate fields if they exist
        findings: undefined,
        diagnosis: undefined,
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
      const risk = record.resident?.riskLevel || record.resident?.risk_level || record.riskLevel || "Not assessed";
      const searchMatches = !query || [
        record.resident?.name,
        record.resident?.id,
        record.resident?.healthRecordNo,
        record.resident?.health_record_no,
        record.healthRecordNo,
        record.health_record_no,
        record.id,
        record.consultationId,
        record.serviceName,
        record.consultationDate,
        record.chiefComplaint,
        record.diagnosis,
      ].filter(Boolean).join(" ").toLowerCase().includes(query);
      const dateMatches = (!recordDateFrom || date >= recordDateFrom) && (!recordDateTo || date <= recordDateTo);
      const riskMatches = recordRisk === "All" || risk.toLowerCase() === recordRisk.toLowerCase();
      const followUpMatches = recordFollowUp === "All"
        || recordFollowUp === "With Follow-up" && record.followUpRequired === "Yes"
        || recordFollowUp === "Without Follow-up" && record.followUpRequired !== "Yes";
      return searchMatches && dateMatches && riskMatches && followUpMatches;
    });
    return filtered.sort((left, right) => {
      if (recordSort === "residentAsc" || recordSort === "residentDesc") {
        const comparison = (left.resident?.name || "").localeCompare(right.resident?.name || "", undefined, { sensitivity: "base" });
        return recordSort === "residentAsc" ? comparison : -comparison;
      }
      const comparison = String(left.consultationDate || "").localeCompare(String(right.consultationDate || ""));
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
    { key: "actions", label: "Actions" },
  ];

  /* ------------------------- Entry form (unchanged style) ------------------------- */
  const renderForm = () => (
    <div className="grid lg:grid-cols-3 gap-5">
      {/* Left Panel - Resident Search */}
      <Card className="p-5 lg:col-span-1 h-fit">
        <h3 className="font-semibold text-brand-ink mb-4">Resident Search</h3>
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2.5 mb-5">
          <Search className="w-4 h-4 text-brand-gray" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search resident..."
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {filteredResidents.map((resident) => {
            const active = selectedResident?.id === resident.id;
            return (
              <div
                key={resident.id}
                onClick={() => {
                  if (reviewLocalId || editingId) return;
                  setSelectedResident(resident);
                  if (errors.resident) setErrors((prev) => ({ ...prev, resident: "" }));
                }}
                className={`rounded-2xl p-4 cursor-pointer transition-colors ${
                  active ? "bg-brand-light border-2 border-brand-blue" : "bg-brand-light border-2 border-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold">
                    {resident.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-semibold text-brand-ink">{resident.name}</p>
                    <p className="text-xs text-brand-gray">{resident.age} yrs · {resident.program}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-1.5 text-sm text-brand-gray">
                  <p>Barangay: <span className="text-brand-ink">{resident.barangay}</span></p>
                  <p>Sex: <span className="text-brand-ink">{resident.sex}</span></p>
                  <p>Contact: <span className="text-brand-ink">{resident.contact}</span></p>
                </div>
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
      <Card className="p-5 lg:col-span-2">
        <div className="flex items-center justify-between gap-3 mb-5">
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

        {/* Resident Information */}
        <div className="mb-5">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-2">Resident Information</h4>
          {selectedResident ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <div>
                <p className="text-xs text-brand-gray mb-1">Full Name</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.name}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Age</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.age}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Sex</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.sex}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Barangay</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.barangay}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Program</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.program}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Contact Number</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.contact}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-btn border border-dashed border-brand-border bg-brand-bg/50 px-4 py-6 text-center text-sm text-brand-gray">
              Choose a resident from the search panel on the left.
            </div>
          )}
        </div>

        {/* Consultation Information */}
        <div className="mb-5">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-2">Consultation Information</h4>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 mb-3">
            <div>
              <p className="text-xs text-brand-gray mb-1">Consultation Date <span className="text-brand-danger">*</span></p>
              <input
                type="date"
                value={formData.consultationDate}
                onChange={(e) => setFormData({ ...formData, consultationDate: e.target.value })}
                className={inputCls(errors.consultationDate)}
              />
              {errors.consultationDate && <p className="mt-1 text-xs text-brand-danger">{errors.consultationDate}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Consultation Time</p>
              <input
                type="time"
                value={formData.consultationTime}
                onChange={(e) => setFormData({ ...formData, consultationTime: e.target.value })}
                className={inputCls()}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="consult-service" className="text-xs text-brand-gray mb-1 block">Health Service Provided</label>
              <select
                id="consult-service"
                value={formData.serviceId}
                onChange={(e) => {
                  setFormData({ ...formData, serviceId: e.target.value });
                  if (errors.serviceId) setErrors((prev) => ({ ...prev, serviceId: "" }));
                }}
                className={inputCls(errors.serviceId)}
                disabled={servicesLoading}
              >
                <option value="">General consultation (no specific service)</option>
                  {formData.serviceId && !healthServices.some((s) => s.id === formData.serviceId) && (
                    <option value={formData.serviceId} disabled>
                      {formData.serviceName || "Previously selected health service"} (inactive or unavailable)
                  </option>
                  )}
                  {healthServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.category ? ` — ${s.category}` : ""}
                    </option>
                  ))}
                </select>
                {servicesLoading ? (
                  <p className="mt-1 text-xs text-brand-gray">Loading health services…</p>
                ) : servicesError ? (
                  <p className="mt-1 text-xs text-brand-danger" role="alert">{servicesError}</p>
                ) : errors.serviceId ? (
                  <p className="mt-1 text-xs text-brand-danger">{errors.serviceId}</p>
                ) : healthServices.length === 0 ? (
                  <p className="mt-1 text-xs text-brand-gray">No active health services are available. General consultations can be saved without a service.</p>
                ) : (
                <p className="mt-1 text-xs text-brand-gray">Select the registered health service this consultation belongs to.</p>
              )}
            </div>
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
        <div className="mb-5">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-2">Vital Signs</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
            <div className="min-w-0">
              <label htmlFor="vital-blood-pressure" className="mb-1.5 block text-xs font-medium text-slate-600">Blood Pressure (mmHg)</label>
              <div className="flex w-full min-w-0 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
                <input
                  id="vital-blood-pressure"
                  type="text"
                  inputMode="numeric"
                  placeholder="120/80"
                  value={formData.bloodPressure}
                  onChange={(e) => setFormData({ ...formData, bloodPressure: e.target.value })}
                  aria-invalid={Boolean(errors.bloodPressure)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
              {bloodPressureCategory && (
                <div className="mt-1 flex min-w-0 items-start">
                  <span
                    className={`inline-flex max-w-full shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ${bloodPressureCategory.badgeClassName}`}
                    aria-label={`Blood pressure category: ${bloodPressureCategory.category}`}
                  >
                    {bloodPressureCategory.category}
                  </span>
                  {bloodPressureCategory.code === "crisis" && (
                    <p className="ml-2 min-w-0 flex-1 text-[11px] leading-4 text-red-800" role="alert" aria-live="assertive">
                      {bloodPressureCategory.message}
                    </p>
                  )}
                </div>
              )}
              {errors.bloodPressure && <p className="mt-1 text-xs text-brand-danger">{errors.bloodPressure}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Temperature (°C)</p>
              <input type="text" placeholder="e.g. 36.7" value={formData.temperature} onChange={(e) => setFormData({ ...formData, temperature: e.target.value })} className={inputCls(errors.temperature)} />
              {errors.temperature && <p className="mt-1 text-xs text-brand-danger">{errors.temperature}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Pulse Rate (bpm)</p>
              <input type="text" placeholder="e.g. 74" value={formData.pulseRate} onChange={(e) => setFormData({ ...formData, pulseRate: e.target.value })} className={inputCls(errors.pulseRate)} />
              {errors.pulseRate && <p className="mt-1 text-xs text-brand-danger">{errors.pulseRate}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Respiratory Rate (breaths/min)</p>
              <input type="text" placeholder="e.g. 18" value={formData.respiratoryRate} onChange={(e) => setFormData({ ...formData, respiratoryRate: e.target.value })} className={inputCls(errors.respiratoryRate)} />
              {errors.respiratoryRate && <p className="mt-1 text-xs text-brand-danger">{errors.respiratoryRate}</p>}
            </div>
            <div>
              <label htmlFor="vital-height" className="block text-xs text-brand-gray mb-1">Height (cm)</label>
              <input id="vital-height" type="text" placeholder="e.g. 158" value={formData.height} onChange={(e) => setFormData({ ...formData, height: e.target.value })} className={inputCls(errors.height)} />
              {errors.height && <p className="mt-1 text-xs text-brand-danger">{errors.height}</p>}
            </div>
            <div>
              <label htmlFor="vital-weight" className="block text-xs text-brand-gray mb-1">Weight (kg)</label>
              <input id="vital-weight" type="text" placeholder="e.g. 62" value={formData.weight} onChange={(e) => setFormData({ ...formData, weight: e.target.value })} className={inputCls(errors.weight)} />
              {errors.weight && <p className="mt-1 text-xs text-brand-danger">{errors.weight}</p>}
            </div>
            <div>
              <label htmlFor="vital-bmi" className="block text-xs text-brand-gray mb-1">BMI (auto)</label>
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
                className={`${inputCls()} bg-brand-bg text-brand-blue font-medium cursor-default`}
              />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Oxygen Saturation (%)</p>
              <input type="text" placeholder="e.g. 98" value={formData.oxygenSaturation} onChange={(e) => setFormData({ ...formData, oxygenSaturation: e.target.value })} className={inputCls(errors.oxygenSaturation)} />
              {errors.oxygenSaturation && <p className="mt-1 text-xs text-brand-danger">{errors.oxygenSaturation}</p>}
            </div>
          </div>
        </div>

        {/* Clinical Assessment */}
        <div className="mb-5">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-2">Clinical Assessment</h4>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-brand-gray mb-1">Clinical Findings & Diagnosis <span className="text-brand-danger">*</span></p>
              <textarea
                rows={4}
                value={formData.clinicalFindingsDiagnosis}
                onChange={(e) => setFormData({ ...formData, clinicalFindingsDiagnosis: e.target.value })}
                placeholder="Enter clinical findings, symptoms, examination results, and diagnosis or assessment..."
                className={`${inputCls(errors.clinicalFindingsDiagnosis)} resize-none w-full`}
              />
              {errors.clinicalFindingsDiagnosis && <p className="mt-1 text-xs text-brand-danger">{errors.clinicalFindingsDiagnosis}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Treatment Provided <span className="text-brand-danger">*</span></p>
              <textarea
                rows={2}
                value={formData.treatmentGiven}
                onChange={(e) => setFormData({ ...formData, treatmentGiven: e.target.value })}
                className={`${inputCls(errors.treatmentGiven)} resize-none`}
              />
              {errors.treatmentGiven && <p className="mt-1 text-xs text-brand-danger">{errors.treatmentGiven}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Medications / Prescriptions</p>
              <MedicineSelector
                value={formData.medications}
                onChange={(medications) => setFormData((prev) => ({ ...prev, medications }))}
              />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Recommendations / Instructions</p>
              <textarea
                rows={2}
                value={formData.adviceGiven}
                onChange={(e) => setFormData({ ...formData, adviceGiven: e.target.value })}
                className={`${inputCls()} resize-none`}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
              <YesNoToggle
                label="Follow-up Required"
                value={formData.followUpRequired}
                onChange={(val) => setFormData({ ...formData, followUpRequired: val })}
              />
              <YesNoToggle
                label="Referral Required"
                value={formData.referralRequired}
                onChange={(val) => setFormData({ ...formData, referralRequired: val })}
              />
              {formData.followUpRequired === "Yes" && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-brand-gray mb-1">Next Visit Date <span className="text-brand-danger">*</span></p>
                  <input
                    type="date"
                    value={formData.nextVisitDate}
                    onChange={(e) => setFormData({ ...formData, nextVisitDate: e.target.value })}
                    className={inputCls(errors.nextVisitDate)}
                  />
                  {errors.nextVisitDate && <p className="mt-1 text-xs text-brand-danger">{errors.nextVisitDate}</p>}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Notes / Remarks</p>
              <textarea
                rows={2}
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                className={`${inputCls()} resize-none`}
              />
            </div>
          </div>
        </div>

        </fieldset>

        {/* Buttons */}
        <div className="pt-4 border-t border-brand-border">
          {errors.submit && (
            <div className="mb-3 rounded-btn border border-brand-danger/30 bg-red-50/60 px-3 py-2" role="alert" aria-live="assertive">
              <p className="text-sm text-brand-danger">{errors.submit}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
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
            <button
              onClick={cancelForm}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
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
            ["Health Service", focusedRecord.data.serviceName],
            ["Chief Complaint", focusedRecord.data.chiefComplaint],
            ["Clinical Findings & Diagnosis", focusedRecord.data.findings],
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
          value={recordRows.filter((c) => (c.consultationDate || "").startsWith(new Date().toISOString().slice(0, 7))).length}
          description="Current month count"
          tone="blue"
        />
        <StatCard
          variant="ledger"
          label="WITH FOLLOW-UP"
          value={recordRows.filter((c) => c.followUpRequired === "Yes").length}
          description="Requiring follow-up"
          tone="danger"
        />
      </div>

      <Card className="p-6">
        {/* Filter Controls */}
        <div className="mb-5">
          {/* Unified Filter Row: Search + Date Range + Risk + Follow-up + Sort */}
          <div className="mb-3 grid gap-3" style={{ 
            gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1.2fr) minmax(0, 0.75fr) minmax(0, 0.75fr) minmax(0, 0.8fr)',
            minWidth: 0 
          }}>
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
                <option value="Moderate">Moderate</option>
                <option value="Low">Low</option>
                <option value="Not assessed">Not Assessed</option>
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
              className="consultation-records-table"
              tableClassName="consultation-records-grid"
              fitContainer
              columns={columns}
              rows={displayedRecords}
              dense={isHealthSupervisor}
              renderCell={(key, row) => {
                if (key === "resident")
                  return (
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold shrink-0">
                        {initialsOf(row.resident?.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-brand-ink truncate">{row.resident?.name || "—"}</p>
                        <p className="text-xs text-brand-gray">{row.resident?.barangay || ""}</p>
                      </div>
                    </div>
                  );
                if (key === "date") return <span className="text-brand-ink">{formatDate(row.consultationDate)}</span>;
                if (key === "service") {
                  const service = healthServices.find((s) => s.id === row.serviceId);
                  const label = row.serviceName || service?.name || "";
                  return label ? (
                    <span className="inline-flex max-w-[180px] items-center truncate rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand-blue" title={label}>
                      {label}
                    </span>
                  ) : (
                    <span className="text-brand-gray">—</span>
                  );
                }
                if (key === "risk") {
                  const risk = row.resident?.riskLevel || row.resident?.risk_level || row.riskLevel || "Not assessed";
                  return <RiskBadge level={risk} />;
                }
                if (key === "followUp")
                  return row.followUpRequired === "Yes" ? (
                    <span className="inline-flex rounded-full bg-brand-accent/10 text-brand-accent px-2.5 py-1 text-xs font-medium">
                      {row.nextVisitDate ? formatDate(row.nextVisitDate) : "Yes"}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-medium">No</span>
                  );
                if (key === "actions")
                  return (
                    <div className="relative flex justify-center" data-consultation-actions>
                      <button type="button" onClick={() => setOpenActionMenu((current) => current === row.id ? null : row.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-brand-blue transition-colors hover:bg-brand-light hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40" aria-label={`Actions for ${row.resident?.name || "consultation"}`} aria-haspopup="menu" aria-expanded={openActionMenu === row.id}>
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {openActionMenu === row.id && <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[10rem] rounded-btn border border-brand-border bg-white p-1 shadow-lg">
                        <button type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); setDetailRecord(row); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-brand-bg"><Eye className="h-4 w-4 text-brand-blue" /> View Details</button>
                        {canEditConsultation && <button type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); openForEdit(row); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-brand-bg"><FileText className="h-4 w-4 text-brand-gray" /> Edit Consultation</button>}
                      </div>}
                    </div>
                  );
                return row[key];
              }}
            />
            {!focusedId && filteredRecordRows.length > 0 && <TablePagination total={filteredRecordRows.length} page={recordPage} pageSize={recordPageSize} onPageChange={setRecordPage} onPageSizeChange={(size) => { setRecordPageSize(size); setRecordPage(1); }} className="mt-3" />}
            {focusedId ? null : loading ? (
              <p className="py-10 text-center text-sm text-brand-gray">Loading consultations...</p>
            ) : filteredRecordRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-brand-gray">No consultations yet. Click "+ Add Treatment Consultation" to record the first one.</p>
            ) : null}
          </>
        )}
      </Card>
      {detailRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Consultation details">
          <Card className="max-h-[90vh] w-full max-w-3xl overflow-hidden p-5">
            <div className="flex items-start justify-between gap-3 border-b border-brand-border pb-3">
              <div>
                <h3 className="text-lg font-semibold text-brand-ink">Consultation Details</h3>
                <p className="mt-0.5 text-sm text-brand-gray">{detailRecord.resident?.name || "Resident"} · {formatDate(detailRecord.consultationDate)}</p>
              </div>
              <button type="button" onClick={() => setDetailRecord(null)} className="rounded-btn p-1 text-brand-gray hover:bg-brand-bg" aria-label="Close consultation details"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[calc(90vh-5rem)] overflow-y-auto pr-1">
              {[
                ["Consultation Information", [
                  ["Resident Name", detailRecord.resident?.name],
                  ["Consultation Date", formatDate(detailRecord.consultationDate)],
                  ["Health Service", detailRecord.serviceName],
                  ["Chief Complaint", detailRecord.chiefComplaint],
                ]],
                ["Clinical Information", [
                   ["Clinical Findings & Diagnosis", detailRecord.findings],
                   ["Risk Level", detailRecord.resident?.riskLevel || detailRecord.resident?.risk_level || detailRecord.riskLevel],
                   ["Vital Signs", parseVitals(detailRecord.vitals)],
                ]],
                ["Treatment and Care", [
                  ["Treatment", detailRecord.treatmentGiven],
                  ["Medicines", detailRecord.medicationPrescribed || (detailRecord.medications || []).map((medicine) => medicine.name || medicine).join(", ")],
                  ["Recommendations", detailRecord.adviceGiven],
                  ["Follow-up", detailRecord.followUpRequired === "Yes" ? (detailRecord.nextVisitDate ? `Required — ${formatDate(detailRecord.nextVisitDate)}` : "Required") : "Not required"],
                ]],
                ["Recording Information", [
                  ["Recording Personnel", detailRecord.recordedByName || detailRecord.personnelName],
                ]],
              ].map(([section, fields]) => (
                <section key={section} className="mt-4 first:mt-4">
                  <h4 className="border-b border-brand-border pb-2 text-sm font-semibold text-brand-ink">{section}</h4>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {fields.map(([label, value]) => {
                      const entries = label === "Vital Signs" && value && typeof value === "object"
                        ? Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== "")
                        : [];
                      return (
                        <div key={label} className="min-w-0 rounded-btn border border-brand-border bg-brand-bg/30 p-3">
                          <p className="text-xs font-medium text-brand-gray">{label}</p>
                          {label === "Vital Signs" ? (
                            entries.length ? <dl className="mt-2 space-y-1.5">{entries.map(([key, item]) => <div key={key} className="flex flex-wrap justify-between gap-2 text-sm"><dt className="text-brand-gray">{formatVitalLabel(key)}</dt><dd className="font-medium text-brand-ink">{String(item)}{["temperature"].includes(key) ? " °C" : ["heightCm", "height"].includes(key) ? " cm" : ["weightKg", "weight"].includes(key) ? " kg" : ["o2sat", "oxygenSaturation"].includes(key) ? "%" : ""}</dd></div>)}</dl> : <p className="mt-1 text-sm text-brand-gray">Not recorded</p>
                          ) : <p className="mt-1 whitespace-pre-wrap break-words text-sm text-brand-ink">{value || "Not recorded"}</p>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        crumbs={["Consultations"]}
        title="Treatment Consultation"
        subtitle="Record consultation findings, treatment, and recommendations for residents."
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
