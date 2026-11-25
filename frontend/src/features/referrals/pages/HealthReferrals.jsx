import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import FormModal from "@/components/common/FormModal";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import TablePagination from "@/components/tables/TablePagination";
import DateRangeFilter, { matchesDateRange } from "@/components/common/DateRangeFilter";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import { useAuth } from "@/context/AuthContext";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import OfflineCacheNotice from "@/features/offline/components/OfflineCacheNotice";
import { listReferralsOffline, getReferralOffline } from "@/services/offline/clinicalOfflineService";
import { listResidentsOffline } from "@/services/offline/residentOfflineService";
import { classifySyncError, SYNC_ERROR } from "@/services/offline/errors";
import { usePermissions } from "@/context/PermissionsContext";
import { ROLE } from "@/lib/roles";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { referralsApi, residentFollowUpsApi, residentsApi } from "@/services/api";
import { api } from "@/services/api/apiClient";
import { downloadReferralPdf } from "@/features/referrals/lib/referralPdf";
import { allowedReferralStatuses, canAssignReferral, REFERRAL_STATUSES, referralRecipientLabel, referralRoleLabel, referralRouteKey, selectedReferralRoute, shouldShowReferralDownloadAction } from "@/features/referrals/lib/referralTrackingActions";
import ReferralHistory from "@/features/referrals/components/ReferralHistory";
import {
  localDateKey,
  localDateTimeToIso,
  referralDateErrors,
  referralDateTimeMinimum,
  toLocalDateTimeInput,
} from "@/features/referrals/lib/referralDateValidation";
import { Plus, Eye, Edit2, RefreshCw, X, Search, Check, Download, AlertTriangle, CalendarClock, Ban, CheckCircle2 } from "lucide-react";
import SearchableSelect from "@/components/common/SearchableSelect";
import { validateConsultationVitals } from "../../../../../shared/consultationClinical.js";
import { formatBloodPressureInput } from "@/features/consultations/utils/bpClassification";
import {
  ActionMenu,
  ActionMenuContent,
  ActionMenuItem,
  ActionMenuMessage,
  ActionMenuTrigger,
} from "@/components/ui/action-menu";

/**
 * Referral coordination page backed by the real API (`/api/referrals` ->
 * Supabase `health_referrals`).
 *
 * Senders route/edit their own in-scope rows. Current individual recipients
 * decide/progress/complete them. Residents and existing scoped oversight roles
 * read the same canonical records, including immutable workflow history.
 *
 * No local/mock persistence: every read and write goes through referralsApi,
 * and failures surface as explicit error states rather than empty successes.
 */

const STATUSES = REFERRAL_STATUSES;
const PRIORITIES = ["Low", "Medium", "High"];
const STATUS_FILTERS = ["All", "Pending", "Completed", "Historical"];
const REFERRAL_PROGRESS_COLORS = {
  Pending: "bg-amber-50 text-amber-700",
  Accepted: "bg-brand-blue/10 text-brand-blue",
  "In Progress": "bg-brand-blue/10 text-brand-blue",
  Completed: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-rose-50 text-rose-700",
  Cancelled: "bg-slate-100 text-slate-600",
};
const referralDisplayStatus = (status) => status || "Pending";
const scheduleResponseLabel = (value) => value === "Default Confirmed" || value === "Awaiting Response"
  ? "Confirmed by default"
  : value || "Confirmed by default";
const referralFilterStatus = (status) => {
  if (status === "Completed") return "Completed";
  if (["Pending", "Accepted", "In Progress"].includes(status)) return "Pending";
  if (["Rejected", "Cancelled"].includes(status)) return "Historical";
  return "All";
};

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const referralVitalsOf = (vitals = {}) => {
  const source = vitals && typeof vitals === "object" ? vitals : {};
  return {
    bp: String(source.bp ?? source.bloodPressure ?? ""),
    temperature: String(source.temperature ?? ""),
    hr: String(source.hr ?? source.pulseRate ?? ""),
    rr: String(source.rr ?? source.respiratoryRate ?? ""),
    heightCm: String(source.heightCm ?? source.height_cm ?? source.height ?? ""),
    weightKg: String(source.weightKg ?? source.weight_kg ?? source.weight ?? ""),
    o2sat: String(source.o2sat ?? source.oxygenSaturation ?? ""),
  };
};

const bmiFromVitals = ({ heightCm, weightKg }) => {
  const height = Number.parseFloat(heightCm);
  const weight = Number.parseFloat(weightKg);
  if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) return "";
  const bmi = weight / ((height / 100) ** 2);
  if (!Number.isFinite(bmi) || bmi < 3 || bmi > 200) return "";
  return bmi.toFixed(2);
};

const formatReferralVitals = (vitals = {}) => [
  ["Blood pressure", vitals.bp && `${vitals.bp} mmHg`],
  ["Temperature", vitals.temperature && `${vitals.temperature} °C`],
  ["Pulse rate", vitals.hr && `${vitals.hr} bpm`],
  ["Respiratory rate", vitals.rr && `${vitals.rr} breaths/min`],
  ["Height", vitals.heightCm && `${vitals.heightCm} cm`],
  ["Weight", vitals.weightKg && `${vitals.weightKg} kg`],
  ["BMI", bmiFromVitals(vitals)],
  ["Oxygen saturation", vitals.o2sat && `${vitals.o2sat}%`],
].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n");

const todayIso = () => localDateKey();

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const formatClock = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
};

const ageFrom = (birthDate) => {
  if (typeof birthDate !== "string" || !birthDate) return undefined;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
};

const residentAgeOf = (resident) => {
  const calculated = ageFrom(resident?.birthDate);
  if (calculated !== undefined) return calculated;
  const savedAge = resident?.age;
  return (typeof savedAge === "number" || typeof savedAge === "string") && String(savedAge).trim() ? savedAge : "—";
};

const residentNameOf = (resident) => {
  const name = [resident?.firstName, resident?.middleName, resident?.lastName, resident?.suffix]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
  return name || (typeof resident?.name === "string" && resident.name.trim()) || "—";
};

const residentAddressOf = (resident) => {
  const currentAddress = typeof resident?.currentAddress === "string" ? resident.currentAddress.trim() : "";
  const permanentAddress = typeof resident?.permanentAddress === "string" ? resident.permanentAddress.trim() : "";
  const address = currentAddress || permanentAddress;
  const zoneValue = resident?.zone;
  const zone = typeof zoneValue === "number" || typeof zoneValue === "string" ? String(zoneValue).trim() : "";
  const savedZone = address.match(/\bzone\s*(\d+)\b/i)?.[1];
  const additions = [];
  if (zone && (!savedZone || Number(savedZone) !== Number(zone))) additions.push(`Zone ${zone}`);
  const barangay = typeof resident?.barangay === "string" ? resident.barangay.trim() : "";
  if (barangay && !address.toLowerCase().includes(barangay.toLowerCase())) additions.push(barangay);
  return [address, ...additions].filter(Boolean).join(", ") || "—";
};

/** persisted health_referrals row (snake_case) → view model. */
const mapRecord = (row) => ({
  id: row.id,
  residentId: row.resident_id,
  residentName: row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : row.residentName || "Resident",
  barangay: row.resident?.barangay || "",
  barangayId: row.resident?.barangay_id || "",
  sex: row.resident?.sex || "",
  age: ageFrom(row.resident?.birth_date),
  birthDate: row.resident?.birth_date || "",
  address: row.resident?.current_address || row.resident?.permanent_address || "",
  contactNumber: row.resident?.cellphone_no || "",
  referringFacility: row.referring_facility || "",
  reason: row.reason || "",
  destinationFacility: row.destination_facility || "",
  destinationService: row.destination_service || "",
  referralCategory: row.referral_category || "",
  priority: row.priority || "Medium",
  status: row.status || "Pending",
  scheduleResponseStatus: scheduleResponseLabel(row.schedule_response_status),
  referralDate: row.referral_date || "",
  createdAt: row.created_at || "",
  notes: row.notes || "",
  resolutionNotes: row.resolution_notes || "",
  completedAt: row.completed_at || "",
  laboratoryTestRequired: row.laboratory_test_required || false,
  laboratoryTest: row.laboratory_test || "",
  additionalInstructions: row.additional_instructions || "",
  // Unified workflow: barangay clinical detail + scheduling + RHU encounter link.
  chiefComplaints: row.chief_complaints || "",
  medicalHistory: row.medical_history || "",
  physicalExamFindings: row.physical_exam_findings || "",
  referralVitals: referralVitalsOf(row.referral_vitals || {}),
  impression: row.impression || "",
  scheduledAt: row.scheduled_at || "",
  treatmentVisitId: row.treatment_visit_id || "",
  // Derived progress stage (set by the backend when the row is expanded).
  stage: row.stage || null,
  recipientPersonnelId: row.recipient_personnel_id || "",
  recipientFacilityId: row.recipient_facility_id || "",
  recipientRole: row.recipient_role || "",
  recipientStation: row.recipient_station || "",
  recipientFacilityType: row.recipient_facility?.type || "",
  recipientFacilityMunicipalityId: row.recipient_facility?.municipality_id || "",
  residentMunicipalityId: row.resident?.municipality_id || "",
  destinationIsHospital: /hospital/i.test(`${row.destination_facility || ""} ${row.external_receiving_facility || ""}`),
  recipientName: row.recipient?.full_name || "",
  senderName: row.sender?.full_name || "",
  externalReceivingFacility: row.external_receiving_facility || "",
  externalReceivingAddress: row.external_receiving_address || "",
  externalReceivingRole: row.external_receiving_role || "",
  externalRecipientName: row.external_recipient_name || "",
  externalRecipientPosition: row.external_recipient_position || "",
  senderId: row.created_by,
  version: row.version,
  capabilities: row.capabilities || {},
  history: row.history || [],
  encounter: row.encounter || null,
  legacyReferralIds: (row.legacy_links || []).map((link) => link.legacy_referral_id),
});

const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

const formText = (value) => String(value ?? "");

const isReferralRoute = (route) =>
  route !== null
  && typeof route === "object"
  && !Array.isArray(route)
  && ["id", "name", "role", "facility_id", "facility_name"].every((key) =>
    typeof route[key] === "string" && route[key].trim().length > 0)
  && (route.station === null || route.station === undefined || typeof route.station === "string");

const EMPTY_FORM = () => ({
  referralDate: todayIso(),
  scheduledAt: "",
  scheduleChangeReason: "",
  destinationFacility: "",
  recipientPersonnelId: "",
  recipientFacilityId: "",
  recipientRole: "",
  recipientStation: "",
  destinationService: "",
  referralCategory: "",
  reason: "",
  priority: "High",
  referringFacility: "",
  notes: "",
  laboratoryTestRequired: false,
  laboratoryTest: "",
  additionalInstructions: "",
  chiefComplaints: "",
  medicalHistory: "",
  physicalExamFindings: "",
  referralVitals: referralVitalsOf(),
  impression: "",
  externalReceivingEnabled: false,
  externalReceivingFacility: "",
  externalReceivingAddress: "",
  externalReceivingRole: "",
  externalRecipientName: "",
  externalRecipientPosition: "",
  treatmentVisitId: "",
});

/**
 * Notes assembled from the PHN check-up a referral draft was created from, so
 * the findings captured during the encounter are carried into the referral
 * instead of being re-typed.
 */
const draftNotesOf = (d) =>
  [
    d?.consultationLocation ? `Consultation Location: ${d.consultationLocation}` : "",
    d?.findings ? `PHN Findings: ${d.findings}` : "",
    d?.riskLevel ? `Risk Level: ${d.riskLevel}` : "",
    d?.clinicalNotes ? `Clinical Notes: ${d.clinicalNotes}` : "",
    d?.recommendations ? `Recommendations: ${d.recommendations}` : "",
  ]
    .filter(Boolean)
    .join("\n");

class ReferralModalErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Referral form failed to render.", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
        <Card className="w-full max-w-md">
          <div className="p-6 text-center" role="alert">
            <h3 className="text-lg font-semibold text-brand-ink">Referral form unavailable</h3>
            <p className="mt-2 text-sm text-brand-gray">The referral form encountered an unexpected error. Close it to return to the Referrals page.</p>
            <button type="button" onClick={this.props.onClose} className="mt-5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              Close referral form
            </button>
          </div>
        </Card>
      </div>
    );
  }
}

function ReferralFormModal({ initial, draft, resident, residents, barangays = [], saving, onClose, onSave, onSelectResident, onRegisterGuest, ownerId, assignedBarangay, referringFacilityFallback, referringPersonnelName }) {
  const isEdit = Boolean(initial);
  const consultationLinked = Boolean(draft?.treatmentVisitId || initial?.treatmentVisitId);
  const routingOnly = isEdit && initial.status !== "Pending";
  const [form, setForm] = useState(/** @type {() => Record<string, any>} */ (() => {
    if (initial) {
      return {
        referralDate: initial.referralDate || todayIso(),
        scheduledAt: toLocalDateTimeInput(initial.scheduledAt),
        scheduleChangeReason: "",
        destinationFacility: initial.destinationFacility || "",
        recipientPersonnelId: initial.recipientPersonnelId || "",
        recipientFacilityId: initial.recipientFacilityId || "",
        recipientRole: initial.recipientRole || "",
        recipientStation: initial.recipientStation || "",
        destinationService: initial.destinationService || "",
        referralCategory: initial.referralCategory || "",
        reason: initial.reason || "",
        priority: initial.priority || "High",
        referringFacility: initial.referringFacility || "",
        notes: initial.notes || "",
        laboratoryTestRequired: initial.laboratoryTestRequired || false,
        laboratoryTest: initial.laboratoryTest || "",
        additionalInstructions: initial.additionalInstructions || "",
        chiefComplaints: initial.chiefComplaints || "",
        medicalHistory: initial.medicalHistory || "",
        physicalExamFindings: initial.physicalExamFindings || "",
        referralVitals: referralVitalsOf(initial.referralVitals),
        impression: initial.impression || "",
        externalReceivingEnabled: Boolean(initial.externalReceivingFacility || initial.externalReceivingAddress || initial.externalReceivingRole || initial.externalRecipientName || initial.externalRecipientPosition),
        externalReceivingFacility: initial.externalReceivingFacility || "",
        externalReceivingAddress: initial.externalReceivingAddress || "",
        externalReceivingRole: initial.externalReceivingRole || "",
        externalRecipientName: initial.externalRecipientName || "",
        externalRecipientPosition: initial.externalRecipientPosition || "",
        treatmentVisitId: initial.treatmentVisitId || "",
      };
    }
    if (draft) {
      // Pre-fill from the completed check-up / treatment record the draft came
      // from (PHN check-up or HS Treatment Record "needs referral").
      return {
        ...EMPTY_FORM(),
        reason: draft.reason || draft.findings || "",
        priority: ["Low", "Medium", "High"].includes(draft.riskLevel) ? draft.riskLevel : "High",
        notes: draftNotesOf(draft),
        referringFacility: draft.referringFacility || "",
        referralCategory: draft.referralCategory || "",
        chiefComplaints: draft.chiefComplaints || draft.chiefComplaint || "",
        medicalHistory: draft.medicalHistory || draft.clinicalHistory || "",
        physicalExamFindings: draft.physicalExamFindings || "",
        referralVitals: referralVitalsOf(draft.vitals || draft.triage?.vitals || {}),
        impression: draft.impression || draft.diagnosis || "",
        treatmentVisitId: draft.treatmentVisitId || "",
      };
    }
    return EMPTY_FORM();
  }));
  const [errors, setErrors] = useState(/** @type {Record<string, any>} */ ({}));
  const [routes, setRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routesError, setRoutesError] = useState("");
  const [routeRetry, setRouteRetry] = useState(0);
  const [patientMode, setPatientMode] = useState("existing");
  const [guest, setGuest] = useState({ firstName: "", middleName: "", lastName: "", birthDate: "", sex: "", currentAddress: "", cellphoneNo: "", barangay: "" });
  const [guestError, setGuestError] = useState("");
  const [guestSaving, setGuestSaving] = useState(false);
  const residentId = initial?.residentId || resident?.id;
  const [residentProfile, setResidentProfile] = useState(null);
  const [residentProfileLoading, setResidentProfileLoading] = useState(false);
  const [residentProfileError, setResidentProfileError] = useState("");
  useEffect(() => {
    let active = true;
    setResidentProfile(null);
    setResidentProfileError("");
    if (!residentId) {
      setResidentProfileLoading(false);
      return () => { active = false; };
    }
    setResidentProfileLoading(true);
    residentsApi.get(residentId, { ownerId, cache: "no-store" }).then((response) => {
      const profile = response?.resident || response?.data?.resident || response;
      if (!profile?.id || String(profile.id) !== String(residentId)) {
        throw new Error("The selected resident profile could not be verified.");
      }
      if (active) setResidentProfile(profile);
    }).catch((error) => {
      if (active) setResidentProfileError(error?.message || "Unable to load the selected resident's current registration information.");
    }).finally(() => {
      if (active) setResidentProfileLoading(false);
    });
    return () => { active = false; };
  }, [residentId, ownerId]);
  const patientProfile = String(residentProfile?.id || "") === String(residentId || "") ? residentProfile : null;
  useEffect(() => {
    let active = true;
    setRoutes([]);
    setRoutesError("");
    setRoutesLoading(true);
    if (!residentId) { setRoutesLoading(false); return () => { active = false; }; }
    referralsApi.recipients({ residentId }, { ownerId }).then((response) => {
      if (active) {
        if (!Array.isArray(response?.rows)) {
          throw new Error("The authorized recipient service returned an invalid response.");
        }
        if (response.rows.some((route) => !isReferralRoute(route))) {
          throw new Error("The authorized recipient list contains incomplete assignments. Retry to reload it.");
        }
        if (response.referringFacility !== null && response.referringFacility !== undefined && typeof response.referringFacility !== "string") {
          throw new Error("The referring facility information is invalid. Retry to reload it.");
        }
        setRoutes(response.rows);
        if (!initial && response?.referringFacility) {
          setForm((prior) => ({ ...prior, referringFacility: response.referringFacility }));
        }
      }
    }).catch((error) => {
      if (active) setRoutesError(error?.message || "Could not load authorized recipients.");
    }).finally(() => { if (active) setRoutesLoading(false); });
    return () => { active = false; };
  }, [residentId, ownerId, routeRetry, isEdit]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);
  const facilities = [...new Map(routes.map((route) => [route.facility_id, route.facility_name])).entries()];
  const roles = [...new Set(routes.filter((route) => route.facility_id === form.recipientFacilityId).map((route) => route.role))];
  const buildErrors = (now = new Date()) => ({
    ...(!routingOnly ? referralDateErrors(form, {
      now,
      originalScheduledAt: isEdit ? toLocalDateTimeInput(initial.scheduledAt) : null,
    }) : {}),
    ...(!isEdit && !resident ? { resident: "Please select a resident." } : {}),
    ...(!formText(form.reason).trim() ? { reason: "Referral reason is required." } : {}),
    ...(isEdit && !routingOnly && form.scheduledAt !== toLocalDateTimeInput(initial.scheduledAt) && !formText(form.scheduleChangeReason).trim()
      ? { scheduleChangeReason: "A reason is required when directly changing the schedule." }
      : {}),
    ...(!form.externalReceivingEnabled && !facilities.some(([id]) => id === form.recipientFacilityId)
      ? { recipientFacility: "Select a receiving facility." }
      : {}),
    ...(!form.externalReceivingEnabled
      && facilities.some(([id]) => id === form.recipientFacilityId)
      && !roles.includes(form.recipientRole)
      ? { recipientRole: "Select a receiving role for this facility." }
      : {}),
    ...(!form.externalReceivingEnabled
      && facilities.some(([id]) => id === form.recipientFacilityId)
      && roles.includes(form.recipientRole)
      && !selectedReferralRoute(routes, form)
      ? { recipient: "Select an authorized recipient for this facility and role." }
      : {}),
    ...(form.externalReceivingEnabled && !formText(form.externalReceivingFacility).trim() ? { externalReceivingFacility: "Enter the outside facility name." } : {}),
    ...(form.externalReceivingEnabled && !formText(form.externalReceivingRole).trim() ? { externalReceivingRole: "Enter the outside receiving role." } : {}),
    ...(form.externalReceivingEnabled && !formText(form.externalRecipientName).trim() ? { externalRecipientName: "Enter the outside recipient's name." } : {}),
    ...(form.externalReceivingEnabled && !formText(form.externalRecipientPosition).trim() ? { externalRecipientPosition: "Enter the outside recipient's position." } : {}),
    ...(form.laboratoryTestRequired && !formText(form.laboratoryTest).trim()
      ? { laboratoryTest: "Laboratory test details are required when laboratory test is marked as required." }
      : {}),
    ...(!routingOnly && !consultationLinked ? Object.fromEntries(
      Object.entries(validateConsultationVitals({
        bloodPressure: form.referralVitals.bp,
        temperature: form.referralVitals.temperature,
        pulseRate: form.referralVitals.hr,
        respiratoryRate: form.referralVitals.rr,
        height: form.referralVitals.heightCm,
        weight: form.referralVitals.weightKg,
        oxygenSaturation: form.referralVitals.o2sat,
      }, { required: false })).map(([key, message]) => [`vital_${key}`, message])
    ) : {}),
  });
  const liveErrors = buildErrors(now);
  const availableRecipientRoutes = routes.filter((route) =>
    (!form.recipientFacilityId || route.facility_id === form.recipientFacilityId)
    && (!form.recipientRole || route.role === form.recipientRole)
  );
  const chosenRoute = selectedReferralRoute(routes, form);
  const recipientLabel = (route) => [
    `${route.name}${route.station ? ` (${route.station})` : ""}`,
    route.facility_name,
    referralRoleLabel(route.role),
  ].filter(Boolean).join(" · ");
  const knownBarangays = [...new Set([
    ...(Array.isArray(barangays) ? barangays : []),
    ...(Array.isArray(residents) ? residents.map((entry) => entry?.barangay) : []),
  ].filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()))]
    .sort((a, b) => a.localeCompare(b));
  const registerGuest = async () => {
    setGuestError("");
    if (!guest.firstName.trim() || !guest.lastName.trim() || !guest.birthDate || !guest.sex || !guest.currentAddress.trim() || !guest.barangay.trim()) {
      setGuestError("Enter the patient's name, date of birth, sex, complete address, and barangay.");
      return;
    }
    setGuestSaving(true);
    try {
      await onRegisterGuest(guest);
      setPatientMode("existing");
    } catch (error) {
      setGuestError(error?.message || "Could not save this patient. Check the details or search for an existing record.");
    } finally {
      setGuestSaving(false);
    }
  };
  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value ?? (typeof p[key] === "boolean" ? false : "") }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = buildErrors(new Date());
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <FormModal
      title={routingOnly ? "Reassign Referral" : isEdit ? "Edit Referral" : "New Referral"}
      description={routingOnly ? "The new recipient must accept again. Clinical details and history are retained." : "Assign an authorized KALUSAGAP recipient for tracking, and optionally add an outside facility or contact."}
      onClose={onClose}
      size="large"
      bodyClassName="px-4 py-4 sm:px-6"
      footer={
        <>
          <button type="button" onClick={onClose} className="min-h-10 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg dark:border-border dark:bg-input dark:hover:bg-hover">Cancel</button>
          <button
            type="button"
            disabled={saving || (!form.externalReceivingEnabled && (routesLoading || Boolean(routesError)))}
            onClick={() => { if (validate()) onSave(form); }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            <Check className="h-4 w-4" /> {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Referral"}
          </button>
        </>
      }
    >
          <div className="space-y-4">
            {isEdit ? (
              <section className="rounded-btn border border-brand-border p-4">
                <h4 className="text-sm font-semibold text-brand-ink">Select Patient</h4>
                <div className="mt-3 rounded-btn bg-brand-bg px-3.5 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-brand-gray">Selected patient</p>
                  <p className="mt-0.5 text-sm font-medium text-brand-ink">{initial.residentName}</p>
                </div>
              </section>
            ) : (
              <section className="rounded-btn border border-brand-border p-4">
                <h4 className="text-sm font-semibold text-brand-ink">Select Patient</h4>
                <p className="mt-1 text-xs text-brand-gray">Choose the resident first so the authorized referral recipients can be scoped correctly.</p>
                <div className="mt-3">
                <label className="text-sm font-medium text-brand-ink">Patient <span className="text-brand-danger">*</span></label>
                <div className="mt-2 flex gap-2 text-sm">
                  <button type="button" onClick={() => { setPatientMode("existing"); setGuestError(""); }} className={`rounded-btn border px-3 py-2 ${patientMode === "existing" ? "border-brand-blue bg-brand-blue/5 text-brand-blue" : "border-brand-border text-brand-gray"}`}>Search resident</button>
                  <button type="button" disabled={Boolean(draft?.treatmentVisitId)} title={draft?.treatmentVisitId ? "This referral is linked to the selected resident's treatment record." : undefined} onClick={() => { setPatientMode("guest"); setGuestError(""); onSelectResident(null); }} className={`rounded-btn border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${patientMode === "guest" ? "border-brand-blue bg-brand-blue/5 text-brand-blue" : "border-brand-border text-brand-gray"}`}>Add patient without account</button>
                </div>
                {patientMode === "existing" ? <div className="mt-2">
                  <ResidentSearchSelect residents={residents} value={resident} onChange={(value) => {
                    onSelectResident(value);
                    if (value) setErrors((prior) => ({ ...prior, resident: "" }));
                  }} />
                  {resident && <p className="mt-1 text-xs text-brand-gray">{resident.accountStatus === "none" ? "Patient record · No KALUSAGAP login account" : "Linked to a KALUSAGAP resident account"}</p>}
                </div> : <div className="mt-3 space-y-3 rounded-btn border border-brand-border p-3">
                  <p className="text-xs text-brand-gray">This creates a patient record only. No email, password, or login account is created. Existing matching records are rejected to prevent duplicates.</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm text-brand-ink">First name<input value={guest.firstName} onChange={(e) => setGuest((p) => ({ ...p, firstName: e.target.value }))} className={inputCls()} /></label>
                    <label className="text-sm text-brand-ink">Last name<input value={guest.lastName} onChange={(e) => setGuest((p) => ({ ...p, lastName: e.target.value }))} className={inputCls()} /></label>
                    <label className="text-sm text-brand-ink">Middle name (optional)<input value={guest.middleName} onChange={(e) => setGuest((p) => ({ ...p, middleName: e.target.value }))} className={inputCls()} /></label>
                    <label className="text-sm text-brand-ink">Date of birth<input type="date" max={todayIso()} value={guest.birthDate} onChange={(e) => setGuest((p) => ({ ...p, birthDate: e.target.value }))} className={inputCls()} /></label>
                    <label className="text-sm text-brand-ink">Sex<select value={guest.sex} onChange={(e) => setGuest((p) => ({ ...p, sex: e.target.value }))} className={`${inputCls()} cursor-pointer`}><option value="">Select sex</option><option>Female</option><option>Male</option></select></label>
                    <label className="text-sm text-brand-ink">Barangay<select value={guest.barangay} onChange={(e) => setGuest((p) => ({ ...p, barangay: e.target.value }))} className={`${inputCls()} cursor-pointer`}><option value="">Select barangay</option>{knownBarangays.map((name) => <option key={name}>{name}</option>)}{assignedBarangay && !knownBarangays.includes(assignedBarangay) && <option>{assignedBarangay}</option>}</select></label>
                    <label className="text-sm text-brand-ink sm:col-span-2">Complete address<input value={guest.currentAddress} onChange={(e) => setGuest((p) => ({ ...p, currentAddress: e.target.value }))} placeholder="House no., street/zone, barangay, municipality" className={inputCls()} /></label>
                    <label className="text-sm text-brand-ink sm:col-span-2">Contact number (optional)<input type="tel" value={guest.cellphoneNo} onChange={(e) => setGuest((p) => ({ ...p, cellphoneNo: e.target.value }))} className={inputCls()} /></label>
                  </div>
                  {guestError && <p role="alert" className="text-xs text-brand-danger">{guestError}</p>}
                  <button type="button" disabled={guestSaving} onClick={registerGuest} className="rounded-btn bg-brand-blue px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{guestSaving ? "Saving patient..." : "Save patient and continue"}</button>
                </div>}
                {errors.resident && <p className="mt-1 text-xs text-brand-danger">{errors.resident}</p>}
                </div>
              </section>
            )}

            <fieldset disabled={routingOnly} className="grid grid-cols-1 gap-4 rounded-btn border border-brand-border p-4 disabled:opacity-70 sm:grid-cols-2">
              <label className="block text-sm font-medium text-brand-ink">Referring Personnel
                <input type="text" value={referringPersonnelName || "—"} disabled title="Referring personnel is taken from the signed-in account." className={`${inputCls()} bg-brand-bg text-brand-gray disabled:opacity-100`} />
              </label>
              <label className="block text-sm font-medium text-brand-ink">Referring Facility
                <input type="text" value={form.referringFacility || referringFacilityFallback} disabled title="This facility is derived from your account assignment." className={`${inputCls()} cursor-not-allowed bg-brand-bg text-brand-gray disabled:opacity-100`} />
              </label>
            </fieldset>

            <section className="space-y-3 rounded-btn border border-brand-border p-4">
              <div>
                <h4 className="text-sm font-semibold text-brand-ink">Receiving Facility &amp; Assignment</h4>
                <p className="mt-1 text-xs text-brand-gray">Choose a registered in-app assignee, or use manual entry for an outside referral.</p>
              </div>
              {!form.externalReceivingEnabled && <>
              {routesLoading ? <p className="text-sm text-brand-gray">Loading authorized recipients...</p> : routesError ? (
                <div role="alert" className="text-sm text-brand-danger">{routesError} <button type="button" onClick={() => setRouteRetry((value) => value + 1)} className="underline">Retry</button></div>
              ) : routes.length === 0 && residentId ? <p className="text-sm text-brand-gray">No active authorized recipient is configured for this resident. Facility and personnel assignments must be completed first.</p> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="referral-receiving-facility" className="block text-sm font-medium text-brand-ink">Receiving Facility <span className="text-brand-danger">*</span></label>
                <select id="referral-receiving-facility" aria-invalid={Boolean(errors.recipientFacility)} aria-describedby={errors.recipientFacility ? "referral-receiving-facility-error" : undefined} disabled={routesLoading || !residentId || routes.length === 0} value={form.recipientFacilityId} onChange={(event) => {
                  const id = event.target.value;
                  setForm((prior) => {
                    const role = routes.some((route) => route.facility_id === id && route.role === prior.recipientRole) ? prior.recipientRole : "";
                    const recipient = routes.find((route) => route.id === prior.recipientPersonnelId && route.facility_id === id && route.role === role);
                    return {
                      ...prior,
                      recipientFacilityId: id,
                      destinationFacility: facilities.find(([key]) => key === id)?.[1] || "",
                      recipientRole: role,
                      recipientPersonnelId: recipient?.id || "",
                      recipientStation: recipient?.station || "",
                    };
                  });
                  setErrors((prior) => ({ ...prior, recipientFacility: "", recipientRole: "", recipient: "" }));
                }} className={`${inputCls(errors.recipientFacility)} cursor-pointer`}>
                  <option value="">Select receiving facility</option>
                  {facilities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                {errors.recipientFacility && <p id="referral-receiving-facility-error" className="mt-1 text-xs text-brand-danger">{errors.recipientFacility}</p>}
              </div>
              <div>
                <label htmlFor="referral-receiving-role" className="block text-sm font-medium text-brand-ink">Receiving Role <span className="text-brand-danger">*</span></label>
                <select id="referral-receiving-role" aria-invalid={Boolean(errors.recipientRole)} aria-describedby={errors.recipientRole ? "referral-receiving-role-error" : undefined} disabled={!form.recipientFacilityId || routesLoading} value={form.recipientRole} onChange={(event) => {
                  const role = event.target.value;
                  setForm((prior) => {
                    const recipient = routes.find((route) => route.id === prior.recipientPersonnelId && route.facility_id === prior.recipientFacilityId && route.role === role);
                    return { ...prior, recipientRole: role, recipientPersonnelId: recipient?.id || "", recipientStation: recipient?.station || "" };
                  });
                  setErrors((prior) => ({ ...prior, recipientRole: "", recipient: "" }));
                }} className={`${inputCls(errors.recipientRole)} cursor-pointer`}>
                  <option value="">Select role</option>
                  {roles.map((role) => <option key={role} value={role}>{referralRoleLabel(role)}</option>)}
                </select>
                {errors.recipientRole && <p id="referral-receiving-role-error" className="mt-1 text-xs text-brand-danger">{errors.recipientRole}</p>}
              </div>
              </div>
              <div>
                <label htmlFor="referral-assigned-recipient" className="block text-sm font-medium text-brand-ink">Assigned Recipient <span className="text-brand-danger">*</span></label>
                <div className="mt-1.5">
                <SearchableSelect
                  id="referral-assigned-recipient"
                  ariaLabel="Assigned recipient"
                  value={chosenRoute ? referralRouteKey(chosenRoute) : ""}
                  onChange={(value) => {
                    const route = routes.find((entry) => referralRouteKey(entry) === value);
                    if (route) setErrors((prior) => ({ ...prior, recipient: "" }));
                    setForm((prior) => ({
                      ...prior,
                      recipientFacilityId: route?.facility_id || prior.recipientFacilityId,
                      destinationFacility: route?.facility_name || prior.destinationFacility,
                      recipientRole: route?.role || prior.recipientRole,
                      recipientPersonnelId: route?.id || "",
                      recipientStation: route?.station || "",
                    }));
                  }}
                  options={availableRecipientRoutes.map((route) => ({ value: referralRouteKey(route), label: recipientLabel(route) }))}
                  placeholder={routesLoading ? "Loading recipients..." : !residentId ? "Select a patient first" : "Search authorized recipient"}
                  emptyText={routesLoading ? "Loading authorized recipients..." : "No authorized recipient matches this facility and role."}
                  error={errors.recipient}
                  disabled={!residentId || routesLoading || routes.length === 0 || !form.recipientFacilityId || !form.recipientRole}
                  maxResults={6}
                  portalDropdown
                />
                {!routesLoading && residentId && routes.length === 0 && !routesError && <p className="mt-1 text-xs text-brand-gray">No active recipients are configured for this patient. Ask an administrator to verify staff, facility, and station assignments.</p>}
                {routes.length > 0 && !chosenRoute && !errors.recipient && <p className="mt-1 text-xs text-brand-gray">Choose a suggestion to assign the correct facility, role, and station.</p>}
                </div>
              </div>
              </>}
              <fieldset disabled={routingOnly} className="rounded-btn border border-brand-border bg-brand-bg/40 p-3 disabled:opacity-70">
                <label className="flex cursor-pointer items-start gap-2 text-sm font-medium text-brand-ink">
                  <input type="checkbox" checked={form.externalReceivingEnabled} onChange={(event) => {
                    const enabled = event.target.checked;
                    setErrors((prior) => ({
                      ...prior,
                      recipientFacility: "",
                      recipientRole: "",
                      recipient: "",
                      externalReceivingFacility: "",
                      externalReceivingRole: "",
                      externalRecipientName: "",
                      externalRecipientPosition: "",
                    }));
                    setForm((prior) => ({ ...prior, externalReceivingEnabled: enabled,
                      ...(enabled ? { destinationFacility: "", recipientPersonnelId: "", recipientFacilityId: "", recipientRole: "", recipientStation: "" }
                        : { externalReceivingFacility: "", externalReceivingAddress: "", externalReceivingRole: "", externalRecipientName: "", externalRecipientPosition: "" }) }));
                  }} className="mt-0.5 h-4 w-4 accent-brand-blue" />
                  Other / enter an outside facility or recipient manually
                </label>
                <p className="ml-6 mt-1 text-xs text-brand-gray">Use this for a hospital, clinic, or recipient without a KALUSAGAP account. No in-app assignee is required; the sender will update referral progress manually.</p>
                {form.externalReceivingEnabled && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-brand-ink">Other facility <span className="text-brand-danger">*</span><input type="text" value={form.externalReceivingFacility} onChange={(event) => set("externalReceivingFacility")(event.target.value)} placeholder="Hospital or clinic name" className={inputCls(errors.externalReceivingFacility)} />{errors.externalReceivingFacility && <span className="mt-1 block text-xs text-brand-danger">{errors.externalReceivingFacility}</span>}</label>
                  <label className="text-sm font-medium text-brand-ink">Facility address<input type="text" value={form.externalReceivingAddress} onChange={(event) => set("externalReceivingAddress")(event.target.value)} placeholder="Street, barangay, municipality" className={inputCls()} /></label>
                  <label className="text-sm font-medium text-brand-ink">Other receiving role <span className="text-brand-danger">*</span><input type="text" value={form.externalReceivingRole} onChange={(event) => set("externalReceivingRole")(event.target.value)} placeholder="e.g. Cardiologist" className={inputCls(errors.externalReceivingRole)} />{errors.externalReceivingRole && <span className="mt-1 block text-xs text-brand-danger">{errors.externalReceivingRole}</span>}</label>
                  <label className="text-sm font-medium text-brand-ink">Outside recipient's position <span className="text-brand-danger">*</span><input type="text" value={form.externalRecipientPosition} onChange={(event) => set("externalRecipientPosition")(event.target.value)} placeholder="e.g. Attending physician" className={inputCls(errors.externalRecipientPosition)} />{errors.externalRecipientPosition && <span className="mt-1 block text-xs text-brand-danger">{errors.externalRecipientPosition}</span>}</label>
                  <label className="text-sm font-medium text-brand-ink sm:col-span-2">Outside recipient's full name <span className="text-brand-danger">*</span><input type="text" value={form.externalRecipientName} onChange={(event) => set("externalRecipientName")(event.target.value)} placeholder="Full name of the external contact" className={inputCls(errors.externalRecipientName)} />{errors.externalRecipientName && <span className="mt-1 block text-xs text-brand-danger">{errors.externalRecipientName}</span>}</label>
                </div>}
              </fieldset>
            </section>

            <section className="rounded-btn border border-brand-border p-4">
              <h4 className="text-sm font-semibold text-brand-ink">Patient Information</h4>
              <p className="mt-1 text-xs text-brand-gray">Details are drawn from the selected resident profile.</p>
              {residentProfileLoading && <p role="status" className="mt-2 text-xs text-brand-gray">Loading the latest registration information...</p>}
              {residentProfileError && <p role="alert" className="mt-2 text-xs text-brand-danger">{residentProfileError}</p>}
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="col-span-2"><p className="text-[11px] uppercase text-brand-gray">Patient name</p><p className="mt-0.5 font-medium text-brand-ink">{patientProfile ? residentNameOf(patientProfile) : "—"}</p></div>
                <div><p className="text-[11px] uppercase text-brand-gray">Age</p><p className="mt-0.5 font-medium text-brand-ink">{patientProfile ? residentAgeOf(patientProfile) : "—"}</p></div>
                <div><p className="text-[11px] uppercase text-brand-gray">Sex</p><p className="mt-0.5 font-medium text-brand-ink">{typeof patientProfile?.sex === "string" && patientProfile.sex.trim() ? patientProfile.sex : "—"}</p></div>
                <div><p className="text-[11px] uppercase text-brand-gray">Date of birth</p><p className="mt-0.5 font-medium text-brand-ink">{typeof patientProfile?.birthDate === "string" && patientProfile.birthDate.trim() ? patientProfile.birthDate : "—"}</p></div>
                <div className="col-span-2"><p className="text-[11px] uppercase text-brand-gray">Complete address</p><p className="mt-0.5 break-words font-medium text-brand-ink">{patientProfile ? residentAddressOf(patientProfile) : "—"}</p></div>
                <div className="col-span-2"><p className="text-[11px] uppercase text-brand-gray">Contact number</p><p className="mt-0.5 font-medium text-brand-ink">{typeof patientProfile?.cellphoneNo === "string" && patientProfile.cellphoneNo.trim() ? patientProfile.cellphoneNo : "—"}</p></div>
              </div>
            </section>

            <fieldset disabled={routingOnly} className="space-y-4 disabled:opacity-70">
            <section className="space-y-3 rounded-btn border border-brand-border p-4">
            <div>
              <h4 className="text-sm font-semibold text-brand-ink">Referral Details</h4>
              <p className="mt-1 text-xs text-brand-gray">Set the referral date, appointment, urgency, and destination service.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-brand-ink">Referral Date</label>
                <input type="date" min={todayIso()} value={form.referralDate} onChange={(e) => set("referralDate")(e.target.value)} className={inputCls(errors.referralDate)} />
                {errors.referralDate && <p className="mt-1 text-xs text-brand-danger">{errors.referralDate}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Referral Time</label>
                <p className="mt-1.5 rounded-btn border border-brand-border bg-brand-bg px-3.5 py-2.5 text-sm text-brand-ink">{initial?.createdAt ? formatClock(initial.createdAt) : "Recorded automatically on submission"}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Scheduled Date &amp; Time</label>
                <input type="datetime-local" min={form.referralDate ? `${form.referralDate}T00:00` : referralDateTimeMinimum()} value={form.scheduledAt} onChange={(e) => set("scheduledAt")(e.target.value)} className={inputCls(errors.scheduledAt)} />
                <p className="mt-1 text-xs text-brand-gray">Enter a future schedule in Philippine time.</p>
                {errors.scheduledAt && <p className="mt-1 text-xs text-brand-danger">{errors.scheduledAt}</p>}
              </div>
              {isEdit && !routingOnly && form.scheduledAt !== toLocalDateTimeInput(initial.scheduledAt) && <div className="sm:col-span-2">
                <label className="text-sm font-medium text-brand-ink">Reason for direct schedule change <span className="text-brand-danger">*</span></label>
                <textarea rows={2} value={form.scheduleChangeReason} onChange={(e) => set("scheduleChangeReason")(e.target.value)} placeholder="Explain why this appointment needs to change" className={inputCls(errors.scheduleChangeReason)} />
                {errors.scheduleChangeReason && <p className="mt-1 text-xs text-brand-danger">{errors.scheduleChangeReason}</p>}
              </div>}
              <div>
                <label className="text-sm font-medium text-brand-ink">Priority</label>
                <select value={form.priority} onChange={(e) => set("priority")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Destination Service</label>
                <input type="text" value={form.destinationService} onChange={(e) => set("destinationService")(e.target.value)} placeholder="e.g. OB-Gyn, Laboratory" className={inputCls()} />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Referral Category</label>
                <input type="text" value={form.referralCategory} onChange={(e) => set("referralCategory")(e.target.value)} placeholder="Optional category" className={inputCls()} />
              </div>
            </div>
            </section>

            <section className="space-y-3 rounded-btn border border-brand-border p-4">
            <div>
              <h4 className="text-sm font-semibold text-brand-ink">Reason &amp; Additional Information</h4>
              <p className="mt-1 text-xs text-brand-gray">Describe why the patient is being referred and include any relevant notes.</p>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Referral Reason <span className="text-brand-danger">*</span></label>
              <input type="text" value={form.reason} onChange={(e) => set("reason")(e.target.value)} placeholder="Enter reason..." className={inputCls(errors.reason)} />
              {errors.reason && <p className="mt-1 text-xs text-brand-danger">{errors.reason}</p>}
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Additional notes..." className={`${inputCls()} resize-none`} />
            </div>

            <div className="rounded-btn bg-brand-bg/50 p-3">
              <p className="text-sm font-semibold text-brand-ink mb-3">Laboratory Test</p>
              <div className="mb-3">
                <label className="text-sm font-medium text-brand-ink">Laboratory Test Required</label>
                <div className="mt-1.5 flex items-center gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-ink">
                    <input type="radio" checked={form.laboratoryTestRequired} onChange={() => set("laboratoryTestRequired")(true)} className="h-4 w-4 accent-brand-blue" />
                    Yes
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-ink">
                    <input type="radio" checked={!form.laboratoryTestRequired} onChange={() => set("laboratoryTestRequired")(false)} className="h-4 w-4 accent-brand-blue" />
                    No
                  </label>
                </div>
              </div>
              {form.laboratoryTestRequired && (
                <>
                  <div className="mb-3">
                    <label className="text-sm font-medium text-brand-ink">Laboratory Test <span className="text-brand-danger">*</span></label>
                    <input type="text" value={form.laboratoryTest} onChange={(e) => set("laboratoryTest")(e.target.value)} placeholder="e.g. Complete Blood Count, Urinalysis, FBS" className={inputCls(errors.laboratoryTest)} />
                    {errors.laboratoryTest && <p className="mt-1 text-xs text-brand-danger">{errors.laboratoryTest}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Additional Instructions</label>
                    <textarea rows={2} value={form.additionalInstructions} onChange={(e) => set("additionalInstructions")(e.target.value)} placeholder="Optional instructions for the laboratory..." className={`${inputCls()} resize-none`} />
                  </div>
                </>
              )}
            </div>
            </section>

            {consultationLinked ? (
              <section className="rounded-btn border border-brand-blue/20 bg-brand-blue/5 p-4 dark:bg-brand-blue/10">
                <h4 className="text-sm font-semibold text-brand-ink">Consultation details attached</h4>
                <p className="mt-1 text-sm leading-relaxed text-brand-gray">
                  Chief complaints, clinical findings, vital signs, and working diagnosis are carried over from the linked treatment consultation. Add only the referral-specific information above.
                </p>
              </section>
            ) : (
            <section className="rounded-btn border border-brand-border p-4">
              <h4 className="text-sm font-semibold text-brand-ink">Clinical Information</h4>
              <p className="text-xs text-brand-gray mb-3">Clinical findings from the barangay health station to share with the RHU.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Chief Complaints</label>
                  <textarea rows={2} value={form.chiefComplaints} onChange={(e) => set("chiefComplaints")(e.target.value)} placeholder="Presenting symptoms and complaints..." className={`${inputCls()} resize-none`} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Clinical History</label>
                  <textarea rows={2} value={form.medicalHistory} onChange={(e) => set("medicalHistory")(e.target.value)} placeholder="Relevant past medical history, medications, allergies..." className={`${inputCls()} resize-none`} />
                </div>
                <div>
                  <h5 className="text-sm font-medium text-brand-ink">Vital Signs</h5>
                  <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {[
                      ["bp", "Blood Pressure (mmHg)", "120/80"],
                      ["temperature", "Temperature (°C)", "e.g. 36.7"],
                      ["hr", "Pulse Rate (bpm)", "e.g. 74"],
                      ["rr", "Respiratory Rate (breaths/min)", "e.g. 18"],
                      ["heightCm", "Height (cm)", "e.g. 158"],
                      ["weightKg", "Weight (kg)", "e.g. 62"],
                      ["o2sat", "Oxygen Saturation (%)", "e.g. 98"],
                    ].map(([key, label, placeholder]) => (
                      <label key={key} className="flex min-w-0 flex-col text-xs font-medium text-brand-gray">
                        <span className="mb-1.5 min-h-8 leading-4">{label}</span>
                        <input
                          type="text"
                          inputMode={key === "bp" ? "numeric" : "decimal"}
                          value={form.referralVitals[key]}
                          onChange={(event) => setForm((prior) => ({
                            ...prior,
                            referralVitals: {
                              ...prior.referralVitals,
                              [key]: key === "bp"
                                ? formatBloodPressureInput(
                                    event.target.value,
                                    event.currentTarget.selectionStart,
                                    event.currentTarget.selectionEnd,
                                    event.nativeEvent.inputType,
                                  )?.value || event.target.value
                                : event.target.value,
                            },
                          }))}
                          placeholder={placeholder}
                          className={inputCls()}
                        />
                        {liveErrors[`vital_${{ bp: "bloodPressure", temperature: "temperature", hr: "pulseRate", rr: "respiratoryRate", heightCm: "height", weightKg: "weight", o2sat: "oxygenSaturation" }[key]}`] && (
                          <span className="mt-1 text-xs text-brand-danger">
                            {liveErrors[`vital_${{ bp: "bloodPressure", temperature: "temperature", hr: "pulseRate", rr: "respiratoryRate", heightCm: "height", weightKg: "weight", o2sat: "oxygenSaturation" }[key]}`]}
                          </span>
                        )}
                      </label>
                    ))}
                    <label className="flex min-w-0 flex-col text-xs font-medium text-brand-gray">
                      <span className="mb-1.5 min-h-8 leading-4">BMI (auto)</span>
                      <input type="text" readOnly aria-readonly="true" value={bmiFromVitals(form.referralVitals)} placeholder="—" className={`${inputCls()} bg-brand-bg text-brand-blue`} />
                    </label>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Impression / Working Diagnosis</label>
                  <input type="text" value={form.impression} onChange={(e) => set("impression")(e.target.value)} placeholder="Initial impression or working diagnosis..." className={inputCls()} />
                </div>
              </div>
            </section>
            )}
            </fieldset>
          </div>
    </FormModal>
  );
}

export default function HealthReferrals() {
  const { user } = useAuth();
  const { online, lastSyncedAt } = useSyncStatus();
  const { can, matrixLoadState } = usePermissions();
  const isResident = user?.role === ROLE.RESIDENT || user?.role === ROLE.RESIDENT_LIMITED;
  const isHealthSupervisor = user?.role === ROLE.HEALTH_SUPERVISOR;
  const canRead = can("referrals.view") || can("referrals.history.view");
  const canCreate = can("referrals.create");
  const scope = getSupervisorScope(user);
  const assignedBarangay = scope && scope.level === HS_SCOPE.BARANGAY ? scope.assignedBarangay : null;
  /**
   * Roles that may raise or edit referrals. The API's WRITE_ROLES are the
   * Health Supervisor and the PHN, so the MHO (municipal monitoring) and the
    * RHU recipients can act on assigned rows but cannot author/edit referrals.
   */
  const canWrite = [ROLE.HEALTH_SUPERVISOR, ROLE.PHN].includes(user?.role);
  const isSupervisorOnly = user?.role === ROLE.MHO;
  const canSetReferralStatus = (status, record) => allowedReferralStatuses(record, can).includes(status);

  const [records, setRecords] = useState([]);
  const [residents, setResidents] = useState([]);
  const [referralBarangays, setReferralBarangays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [residentLoadError, setResidentLoadError] = useState(null);
  const [cacheInfo, setCacheInfo] = useState({ source: null, cachedAt: null, stale: false });
  const [saving, setSaving] = useState(false);
  const loadRequest = useRef(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedResident, setSelectedResident] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequest = useRef(0);
  const detailDialogRef = useRef(null);
  const detailCloseButtonRef = useRef(null);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [exportingId, setExportingId] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [referralPage, setReferralPage] = useState(1);
  const [referralPageSize, setReferralPageSize] = useState(8);
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [box, setBox] = useState("all");
  const [toast, setToast] = useState(null);
  const [scheduleRequests, setScheduleRequests] = useState([]);
  const [residentRequestBusy, setResidentRequestBusy] = useState(false);
  const [scheduleRequestTarget, setScheduleRequestTarget] = useState(null);
  // Pre-filled draft from a completed PHN check-up ("Create Referral" on the
  // check-up page navigates here with `state.referralDraft`), so the findings
  // captured during the encounter are never re-typed.
  const [draft, setDraft] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedReferralId = isHealthSupervisor ? searchParams.get("referral") : null;
  const requestedStatus = isHealthSupervisor ? searchParams.get("status") : null;
  const closeDetail = useCallback(() => {
    detailRequest.current += 1;
    setDetail(null);
    setDetailError("");
    if (isHealthSupervisor && searchParams.has("referral")) {
      const next = new URLSearchParams(searchParams);
      next.delete("referral");
      setSearchParams(next, { replace: true });
    }
  }, [isHealthSupervisor, searchParams, setSearchParams]);

  useEffect(() => {
    setRecords([]);
    setResidents([]);
    setReferralBarangays([]);
    setDetail(null);
    setFormOpen(false);
    setStatusTarget(null);
    setOpenActionMenu(null);
    setBox(user?.role === ROLE.RHU_PERSONNEL ? "incoming" : "all");
    detailRequest.current += 1;
    return () => { detailRequest.current += 1; };
  }, [user?.id, user?.role]);

  useEffect(() => {
    const incoming = location.state?.referralDraft;
    if (!incoming) return;
    // Navigation may arrive before the permission matrix finishes loading.
    // Do not discard a consultation handoff just because `can()` is still
    // fail-closed during that brief startup window.
    if (matrixLoadState?.status === "loading") return;
    if (!canCreate) {
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    setDraft(incoming);
    setEditing(null);
    setSelectedResident(null);
    setFormOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [canCreate, location.state, location.pathname, navigate, matrixLoadState?.status]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const closeReferralForm = () => {
    setFormOpen(false);
    setEditing(null);
    setSelectedResident(null);
    setDraft(null);
  };

  const load = useCallback(async () => {
    const requestId = ++loadRequest.current;
    setLoading(true);
    setLoadError(null);
    setResidentLoadError(null);
    if (!user?.id) { setRecords([]); setResidents([]); setLoading(false); return; }
    if (isHealthSupervisor && !assignedBarangay) {
      setRecords([]); setResidents([]); setLoading(false);
      setLoadError("A verified barangay assignment is required to view referrals.");
      return;
    }
    setCacheInfo({ source: null, cachedAt: null, stale: false });
    const loadResidents = async () => {
      if (online) {
        try {
          const all = [];
          for (let offset = 0; ; offset += 100) {
            if (requestId !== loadRequest.current) throw new Error("The referral directory request was superseded.");
            const response = await api.get('/residents', { params: { limit: 100, offset }, ownerId: user.id });
            const page = Array.isArray(response?.rows) ? response.rows : Array.isArray(response) ? response : null;
            if (!page) throw new Error("The resident directory returned an invalid response.");
            all.push(...page);
            if (page.length < 100 || (Number.isFinite(response.total) && all.length >= response.total)) return { rows: all };
          }
        } catch (err) {
          if (classifySyncError(err).code !== SYNC_ERROR.NETWORK) throw err;
        }
      }
      const cached = await listResidentsOffline({ ownerId: user.id });
      return { rows: cached?.rows || [] };
    };
    const results = await Promise.allSettled([
      listReferralsOffline({
        ownerId: user.id,
        params: { box },
        fetchFn: (params) => referralsApi.list(params, { ownerId: user.id }),
        online: () => online,
      }),
      canWrite && canCreate ? loadResidents() : Promise.resolve(null),
      canWrite && canCreate ? residentsApi.directoryFilters({ ownerId: user.id }) : Promise.resolve(null),
    ]);
    if (requestId !== loadRequest.current) return;

    const [referralResult, residentResult, barangayResult] = results;
    if (referralResult.status === "fulfilled" && Array.isArray(referralResult.value?.rows)) {
      setRecords(referralResult.value.rows.map(mapRecord));
      setCacheInfo({
        source: referralResult.value.source || "server",
        cachedAt: referralResult.value.cachedAt ?? null,
        stale: Boolean(referralResult.value.stale),
      });
    } else {
      setRecords([]);
      setLoadError(
        referralResult.status === "rejected"
          ? referralResult.reason?.message || "Unable to load referrals. Please try again."
          : "The referrals service returned an invalid response. Please try again.",
      );
    }

    if (canWrite && canCreate) {
      const rows = residentResult.status === "fulfilled"
        ? Array.isArray(residentResult.value?.rows)
          ? residentResult.value.rows
          : Array.isArray(residentResult.value)
            ? residentResult.value
            : null
        : null;
      if (rows) {
        const validRows = rows.filter((row) =>
          row && typeof row === "object" && !Array.isArray(row) && typeof row.id === "string" && row.id.trim());
        if (validRows.length !== rows.length) {
          setResidentLoadError("Some resident records could not be displayed because their registration data was incomplete.");
        }
        setResidents(
          validRows
            .map((r) => ({
              id: r.id,
              name: [r.firstName, r.middleName, r.lastName, r.suffix].filter((part) => typeof part === "string" && part.trim()).join(" "),
              barangay: typeof r.barangay === "string" ? r.barangay : "",
              age: ageFrom(r.birthDate),
              gender: typeof r.sex === "string" ? r.sex : "",
              birthDate: typeof r.birthDate === "string" ? r.birthDate : "",
              address: typeof r.currentAddress === "string" ? r.currentAddress : typeof r.permanentAddress === "string" ? r.permanentAddress : "",
              cellphoneNo: typeof r.cellphoneNo === "string" ? r.cellphoneNo : "",
              accountStatus: r.accountStatus || (r.authUserId ? "linked" : "none"),
            }))
            .filter((r) => !assignedBarangay || r.barangay === assignedBarangay),
        );
      } else {
        setResidents([]);
        setResidentLoadError(
          residentResult.status === "rejected"
            ? residentResult.reason?.message || "Unable to load the resident directory."
            : "The resident directory returned an invalid response.",
        );
      }
      const filterData = barangayResult.status === "fulfilled" ? (barangayResult.value?.filters || barangayResult.value?.data || barangayResult.value) : null;
      const directoryBarangays = Array.isArray(filterData?.barangays)
        ? filterData.barangays.map((row) => typeof row === "string" ? row : row.name).filter(Boolean)
        : filterData?.barangay?.name ? [filterData.barangay.name] : [];
      setReferralBarangays(directoryBarangays);
    } else setResidents([]);
    setLoading(false);
  }, [assignedBarangay, box, canWrite, canCreate, isHealthSupervisor, user?.id, user?.role, user?.municipalityId, user?.barangayId, user?.facilityId, online]);

  useEffect(() => {
    load();
    return () => { loadRequest.current += 1; };
  }, [load]);

  const loadScheduleRequests = useCallback(async () => {
    if (!isResident || !user?.id) { setScheduleRequests([]); return; }
    try {
      const response = await residentFollowUpsApi.listScheduleRequests();
      setScheduleRequests(Array.isArray(response) ? response : response?.rows || []);
    } catch {
      setScheduleRequests([]);
    }
  }, [isResident, user?.id]);

  useEffect(() => { void loadScheduleRequests(); }, [loadScheduleRequests]);

  const submitResidentScheduleRequest = async ({ record, requestType, proposedSchedule = null, reason = "" }) => {
    setResidentRequestBusy(true);
    try {
      await residentFollowUpsApi.request({
        targetType: "referral",
        targetId: record.id,
        requestType,
        proposedSchedule,
        reason,
      });
      setScheduleRequestTarget(null);
      await Promise.all([load(), loadScheduleRequests()]);
      showToast(requestType === "attendance" ? "Attendance confirmed." : "Your request was sent to the responsible health team.");
    } catch (error) {
      showToast(error?.message || "Could not submit your schedule request.");
    } finally {
      setResidentRequestBusy(false);
    }
  };

  const canResidentRespondToReferral = (record) => {
    const internalFacility = Boolean(record.recipientFacilityId)
      && ["rhu", "barangay_health_station"].includes(String(record.recipientFacilityType || "").toLowerCase())
      && Boolean(record.recipientFacilityMunicipalityId)
      && record.recipientFacilityMunicipalityId === record.residentMunicipalityId;
    const isOpen = !["Completed", "Rejected", "Cancelled"].includes(record.status);
    const hasSchedule = Boolean(record.scheduledAt);
    return internalFacility && !record.destinationIsHospital && isOpen && hasSchedule;
  };

  const pendingRequestForReferral = (record) => scheduleRequests.find((request) =>
    request.referral_id === record.id && request.status === "Pending Approval");

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  useEffect(() => {
    if (!detail) return undefined;

    const previouslyFocused = document.activeElement;
    detailCloseButtonRef.current?.focus();

    const handleDialogKeyDown = (event) => {
      if (event.key === "Escape") {
        closeDetail();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = detailDialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [detail, closeDetail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const statusMatches = statusFilter === "All"
        || statusFilter === "Completed" && r.status === "Completed"
        || statusFilter === "Pending" && ["Pending", "Accepted", "In Progress"].includes(r.status)
        || statusFilter === "Historical" && ["Rejected", "Cancelled"].includes(r.status);
      if (!statusMatches) return false;
      if (priorityFilter !== "All" && r.priority !== priorityFilter) return false;
      if (!matchesDateRange(r.referralDate, dateFrom, dateTo)) return false;
      if (q && ![
        r.residentName,
        r.reason,
        r.destinationFacility,
        r.destinationService,
        r.laboratoryTest,
        r.referringFacility,
        r.recipientName,
        r.senderName,
      ].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [records, search, statusFilter, priorityFilter, dateFrom, dateTo]);
  const pageRecords = filtered.slice((referralPage - 1) * referralPageSize, referralPage * referralPageSize);
  useEffect(() => { setReferralPage(1); }, [search, statusFilter, priorityFilter, dateFrom, dateTo]);
  useEffect(() => {
    setReferralPage((page) => Math.min(page, Math.max(1, Math.ceil(filtered.length / referralPageSize))));
  }, [filtered.length, referralPageSize]);

  const openCreate = () => {
    if (!canCreate) return;
    setEditing(null);
    setDraft(null);
    setSelectedResident(null);
    setFormOpen(true);
  };
  const openEdit = (record) => {
    if (!canAssignReferral(record, can)) return;
    setEditing(record);
    setDraft(null);
    setSelectedResident(null);
    closeDetail();
    setFormOpen(true);
  };

  /**
   * The resident a create will be filed against: the one picked in the modal, or
    * the one the referral draft was created from, matched ONLY by stable ID.
   */
  const targetResident =
    selectedResident ||
    (draft
      ? residents.find((r) => r.id === draft.residentId) || null
      : null);

  const registerReferralGuest = async (patient) => {
    const response = await residentsApi.create({
      firstName: patient.firstName.trim(), middleName: patient.middleName.trim(),
      lastName: patient.lastName.trim(), birthDate: patient.birthDate, sex: patient.sex,
      barangay: patient.barangay, currentAddress: patient.currentAddress.trim(),
      permanentAddress: patient.currentAddress.trim(), cellphoneNo: patient.cellphoneNo.trim(),
      createLoginAccount: false,
    }, { ownerId: user.id });
    const row = response?.resident || response?.data?.resident || response;
    const entry = {
      id: row.id,
      name: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
      barangay: row.barangay || patient.barangay,
      age: ageFrom(row.birthDate || patient.birthDate),
      gender: row.sex || patient.sex,
      birthDate: row.birthDate || patient.birthDate,
      address: row.currentAddress || patient.currentAddress,
      cellphoneNo: row.cellphoneNo || patient.cellphoneNo,
      accountStatus: "none",
    };
    if (!entry.id) throw new Error("The patient record was not returned. Search the resident directory before retrying.");
    setResidents((previous) => previous.some((item) => item.id === entry.id) ? previous : [entry, ...previous]);
    setSelectedResident(entry);
    return entry;
  };

  const toPayload = (form) => ({
    referral_date: form.referralDate || null,
    scheduled_at: form.scheduledAt ? localDateTimeToIso(form.scheduledAt) : null,
    schedule_change_reason: formText(form.scheduleChangeReason).trim(),
    destination_facility: form.externalReceivingEnabled ? formText(form.externalReceivingFacility).trim() : formText(form.destinationFacility).trim(),
    destination_service: formText(form.destinationService).trim(),
    referral_category: formText(form.referralCategory).trim(),
    reason: formText(form.reason).trim(),
    priority: form.priority,
    referring_facility: formText(form.referringFacility).trim(),
    notes: formText(form.notes),
    laboratory_test_required: Boolean(form.laboratoryTestRequired),
    laboratory_test: formText(form.laboratoryTest).trim(),
    additional_instructions: formText(form.additionalInstructions).trim(),
    chief_complaints: formText(form.chiefComplaints),
    medical_history: formText(form.medicalHistory),
    physical_exam_findings: formText(form.physicalExamFindings),
    referral_vitals: Object.fromEntries(Object.entries(referralVitalsOf(form.referralVitals)).map(([key, value]) => [key, formText(value).trim() || null])),
    impression: formText(form.impression),
    external_receiving_facility: form.externalReceivingEnabled ? formText(form.externalReceivingFacility).trim() : "",
    external_receiving_address: form.externalReceivingEnabled ? formText(form.externalReceivingAddress).trim() : "",
    external_receiving_role: form.externalReceivingEnabled ? formText(form.externalReceivingRole).trim() : "",
    external_recipient_name: form.externalReceivingEnabled ? formText(form.externalRecipientName).trim() : "",
    external_recipient_position: form.externalReceivingEnabled ? formText(form.externalRecipientPosition).trim() : "",
    treatment_visit_id: form.treatmentVisitId || null,
    recipient_personnel_id: form.externalReceivingEnabled ? null : form.recipientPersonnelId,
    recipient_facility_id: form.externalReceivingEnabled ? null : form.recipientFacilityId,
    recipient_role: form.externalReceivingEnabled ? null : form.recipientRole,
    recipient_station: form.externalReceivingEnabled ? null : form.recipientStation || null,
  });

  const handleSave = async (form) => {
    if (editing ? !canAssignReferral(editing, can) : !canCreate) return;
    setSaving(true);
    try {
      if (editing) {
        const payload = editing.status === "Pending" ? toPayload(form) : {
          recipient_personnel_id: form.recipientPersonnelId, recipient_facility_id: form.recipientFacilityId,
          recipient_role: form.recipientRole, recipient_station: form.recipientStation || null,
        };
        const result = await referralsApi.update(editing.id, { ...payload, expected_version: editing.version }, { ownerId: user.id });
        const mapped = mapRecord(result?.record || result);
        setRecords((prev) => prev.map((r) => (r.id === editing.id ? { ...r, ...mapped } : r)));
        showToast("Referral updated.");
      } else {
        if (!targetResident) {
          showToast("Select the resident before saving the referral.");
          return;
        }
        const result = await referralsApi.create({ residentId: targetResident.id, ...toPayload(form) }, { ownerId: user.id });
        const mapped = {
          ...mapRecord(result?.record || result),
          residentName: targetResident.name,
          barangay: targetResident.barangay,
          age: targetResident.age,
          sex: targetResident.gender,
        };
        setRecords((prev) => [mapped, ...prev]);
        showToast("Referral created.");
      }
      setFormOpen(false);
      setEditing(null);
      setSelectedResident(null);
      setDraft(null);
    } catch (err) {
      showToast(err?.message || "Could not save the referral.");
    } finally {
      setSaving(false);
    }
  };

  const openStatus = (record) => {
    const allowed = allowedReferralStatuses(record, can);
    if (!allowed.length) return;
    setStatusTarget(record);
    setNewStatus(allowed[0]);
    setResolutionNotes("");
  };

  const handleStatusSave = async () => {
    if (!statusTarget || !canSetReferralStatus(newStatus, statusTarget)) return;
    if (["Rejected", "Cancelled"].includes(newStatus) && !resolutionNotes.trim()) return;
    setSaving(true);
    try {
      const result = await referralsApi.updateStatus(statusTarget.id, { status: newStatus, resolution_notes: resolutionNotes, expected_version: statusTarget.version }, { ownerId: user.id });
      const mapped = mapRecord(result?.record || result);
      setRecords((prev) => prev.map((r) => (r.id === statusTarget.id ? { ...r, ...mapped } : r)));
      setStatusTarget(null);
      if (detail?.id === mapped.id) setDetail(mapped);
      showToast("Referral status updated.");
    } catch (err) {
      showToast(err?.message || "Could not update the referral status.");
      if (err?.status === 409) {
        try {
          const fresh = await referralsApi.get(statusTarget.id, { ownerId: user.id });
          if (fresh?.record) {
            const mapped = mapRecord(fresh.record);
            setStatusTarget(mapped);
            setNewStatus(allowedReferralStatuses(mapped, can)[0] || "");
            setRecords((previous) => previous.map((row) => row.id === mapped.id ? mapped : row));
          }
        } catch { showToast("This assignment changed. Refresh the referrals list before continuing."); }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async (record) => {
    if (exportingId) return;
    setExportingId(record.id);
    try {
      const detail = await getReferralOffline({
        ownerId: user.id,
        id: record.id,
        fetchFn: (id) => referralsApi.get(id, { ownerId: user.id }),
        online: () => online,
      });
      if (!detail?.record?.id) throw new Error("Could not load the saved referral document.");
      const row = detail.record;
      await downloadReferralPdf(row, { residents });
    } catch (err) {
      showToast(err?.message || "Could not generate the referral PDF.");
    } finally {
      setExportingId(null);
    }
  };

  const openDetail = useCallback(async (record) => {
    if (!user?.id || !canRead || (isHealthSupervisor && !assignedBarangay)) return;
    const requestId = ++detailRequest.current;
    setDetail(record);
    setDetailLoading(true);
    setDetailError("");
    try {
      const response = await getReferralOffline({
        ownerId: user.id,
        id: record.id,
        fetchFn: (id) => referralsApi.get(id, { ownerId: user.id }),
        online: () => online,
      });
      if (!response?.record || response.record.id !== record.id || !STATUSES.includes(response.record.status)) throw new Error("The referral detail response is invalid.");
      if (requestId === detailRequest.current) setDetail(mapRecord(response.record));
    } catch (error) {
      if (requestId === detailRequest.current) setDetailError(error?.message || "Could not load referral history.");
    } finally { if (requestId === detailRequest.current) setDetailLoading(false); }
  }, [user?.id, canRead, isHealthSupervisor, assignedBarangay, online]);

  useEffect(() => {
    if (requestedStatus && STATUSES.includes(requestedStatus)) {
      setStatusFilter(referralFilterStatus(requestedStatus));
      setBox("all");
    }
  }, [requestedStatus]);

  useEffect(() => {
    if (!requestedReferralId) return undefined;
    void openDetail({ id: requestedReferralId });
    return () => { detailRequest.current += 1; };
  }, [requestedReferralId, openDetail]);

  const showReferralTypeFilter = canWrite && canCreate;
  const columns = isResident
    ? ["Referral Date", "Reason", "Destination", "Lab Test", "Priority", "Referral Status", "Actions"]
    : ["Resident", "Referral Date", "Reason", "Destination", "Lab Test", "Priority", "Referral Status", "Actions"];

  return (
    <>
      <PageHeader
        crumbs={
          isResident || isSupervisorOnly 
            ? ["Referrals"] 
            : isHealthSupervisor 
              ? ["Health Operations", "Referrals"]
              : ["Care Coordination", "Referrals"]
        }
        title={isResident ? "My Referrals" : isSupervisorOnly ? "Referral Tracking" : isHealthSupervisor ? "Referral Monitoring" : "Referrals"}
        subtitle={
          isResident
            ? "Referrals your health workers have made for you and their current status."
            : isSupervisorOnly
              ? "Monitor referred residents and track referral progress across the municipality."
              : assignedBarangay
                ? `Track referrals sent from Brgy. ${assignedBarangay} and those assigned to you.`
                : "Track sent referrals and respond to referrals explicitly assigned to you."
        }
        action={
          canWrite && canCreate ? (
            <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
              <Plus className="w-4 h-4" /> New Referral
            </button>
          ) : null
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <Check className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {(loadError || residentLoadError) && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-4 py-3 text-sm">
          <div className="flex items-start gap-2 text-brand-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {loadError || residentLoadError}
              {loadError && residentLoadError ? ` ${residentLoadError}` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-btn border border-brand-danger/40 px-3 py-1.5 font-medium text-brand-danger hover:bg-brand-danger/10 disabled:opacity-60"
          >
            {loading ? "Retrying..." : "Retry"}
          </button>
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
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${showReferralTypeFilter ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.8fr)_minmax(0,1.5fr)]" : "xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.8fr)_minmax(0,1.5fr)]"} xl:items-end`}>
          {showReferralTypeFilter && (
            <label className="min-w-0 text-xs font-medium text-brand-gray">
              Referral Type
              <select
                value={box}
                onChange={(event) => setBox(event.target.value)}
                aria-label="Referral type"
                className="mt-1 h-10 w-full rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink outline-none focus:border-brand-blue dark:border-border dark:bg-input"
              >
                <option value="all">All Referrals</option>
                <option value="outgoing">Sent Referrals</option>
              </select>
            </label>
          )}
          <label className="min-w-0 text-xs font-medium text-brand-gray">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Referral status filter" className="mt-1 h-10 w-full rounded-btn border border-brand-border bg-white px-3 text-sm font-medium text-brand-ink outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input dark:text-foreground">
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === "Historical" ? "Historical (Rejected / Cancelled)" : s === "All" ? "All Status" : s}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-medium text-brand-gray">
            Priority
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Referral priority filter" className="mt-1 h-10 w-full rounded-btn border border-brand-border bg-white px-3 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
              <option value="All">All Priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-medium text-brand-gray sm:col-span-2 xl:col-span-1">
            Search
            <div className="mt-1 flex h-10 items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 dark:border-border dark:bg-input">
              <Search className="h-4 w-4 shrink-0 text-brand-gray" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, reason, facility..." className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-brand-gray/70" />
            </div>
          </label>
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} className="sm:col-span-2 xl:col-span-1 [&>label]:text-xs" />
        </div>
      </Card>

      <Card className="clinical-table-card overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className={`clinical-table ui-table w-full referral-monitoring-grid ${isResident ? "referral-monitoring-grid-resident" : "referral-monitoring-grid-supervisor"}`}>
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                {columns.map((h) => (
                  <th key={h} className={`whitespace-nowrap text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3 ${h === "Actions" ? "text-center" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRecords.map((r) => (
                <tr key={r.id} className="border-b border-brand-border hover:bg-brand-bg/50">
                  {!isResident && (
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-brand-ink">{r.residentName}</p>
                      <p className="text-xs text-brand-gray">{r.barangay}</p>
                    </td>
                  )}
                  <td className="px-4 py-3 text-sm text-brand-ink">{formatDate(r.referralDate)}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.reason}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">
                    {r.destinationFacility}
                    {r.destinationService ? <span className="block text-xs text-brand-gray">{r.destinationService}</span> : null}
                    <span className="mt-1 block text-xs text-brand-gray">{referralRecipientLabel(r)}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">
                    {r.laboratoryTestRequired ? (
                      <span className="inline-flex items-center gap-1 text-brand-blue">
                        {r.laboratoryTest || "Required"}
                      </span>
                    ) : (
                      <span className="text-xs text-brand-gray">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[r.priority] || ""}`}>{r.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="min-w-[145px] space-y-1.5 leading-4">
                      <div>
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-brand-gray">Schedule</span>
                        <span className="inline-flex max-w-full whitespace-normal break-words rounded-full bg-brand-blue/10 px-2 py-1 text-[11px] font-medium leading-tight text-brand-blue">{r.scheduleResponseStatus}</span>
                      </div>
                      <div>
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-brand-gray">Service progress</span>
                        <span className={`inline-flex max-w-full whitespace-normal break-words rounded-full px-2 py-1 text-[11px] font-medium leading-tight ${REFERRAL_PROGRESS_COLORS[referralDisplayStatus(r.status)] || "bg-slate-100 text-slate-600"}`}>
                          {referralDisplayStatus(r.status)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center">
                      <ActionMenu
                        open={openActionMenu === r.id}
                        onOpenChange={(open) => setOpenActionMenu(open ? r.id : null)}
                      >
                        <ActionMenuTrigger label={`Actions for ${r.residentName}`} />
                        <ActionMenuContent aria-label={`Actions for ${r.residentName}`}>
                          <ActionMenuItem icon={Eye} onSelect={() => void openDetail(r)}>View Details</ActionMenuItem>
                          {isResident && canResidentRespondToReferral(r) && !pendingRequestForReferral(r) && (
                            <>
                              {r.scheduleResponseStatus !== "Attendance Confirmed" && (
                                <ActionMenuItem
                                  icon={CheckCircle2}
                                  disabled={residentRequestBusy}
                                  onSelect={() => void submitResidentScheduleRequest({ record: r, requestType: "attendance" })}
                                >
                                  Confirm Attendance
                                </ActionMenuItem>
                              )}
                              <ActionMenuItem
                                icon={CalendarClock}
                                disabled={residentRequestBusy}
                                onSelect={() => setScheduleRequestTarget({ record: r, requestType: "reschedule" })}
                              >
                                Request Reschedule
                              </ActionMenuItem>
                              <ActionMenuItem
                                icon={Ban}
                                danger
                                disabled={residentRequestBusy}
                                onSelect={() => setScheduleRequestTarget({ record: r, requestType: "cancellation" })}
                              >
                                Request Cancellation
                              </ActionMenuItem>
                            </>
                          )}
                          {isResident && pendingRequestForReferral(r) && (
                            <ActionMenuMessage>Your schedule request is awaiting staff review.</ActionMenuMessage>
                          )}
                          {isResident && !canResidentRespondToReferral(r) && !["Completed", "Rejected", "Cancelled"].includes(r.status) && (
                            <ActionMenuMessage>Schedule changes for this destination must be arranged directly with the facility.</ActionMenuMessage>
                          )}
                          {!isResident && shouldShowReferralDownloadAction(user) && (
                            <ActionMenuItem
                              icon={Download}
                              disabled={exportingId === r.id}
                              onSelect={() => handleDownloadPdf(r)}
                            >
                              Download / Print
                            </ActionMenuItem>
                          )}
                          {!isResident && canAssignReferral(r, can) && (
                            <ActionMenuItem icon={Edit2} onSelect={() => openEdit(r)}>Edit</ActionMenuItem>
                          )}
                          {!isResident && allowedReferralStatuses(r, can).length > 0 && (
                            <ActionMenuItem icon={RefreshCw} onSelect={() => openStatus(r)}>Update Status</ActionMenuItem>
                          )}
                        </ActionMenuContent>
                      </ActionMenu>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-brand-gray">
                    {loading
                      ? "Loading referrals..."
                      : loadError
                        ? <span className="text-brand-danger">{loadError}</span>
                        : cacheInfo.source === "cache" && records.length === 0
                          ? "No saved records available offline."
                          : isResident
                            ? "You have no referrals yet."
                            : "No referrals match the selected filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination total={filtered.length} page={referralPage} pageSize={referralPageSize} onPageChange={setReferralPage} onPageSizeChange={(size) => { setReferralPageSize(size); setReferralPage(1); }} className="m-3" />
      </Card>

      {/* Detail modal */}
      {detail && (
        <div
          ref={detailDialogRef}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetail();
          }}
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="referral-detail-title"
            aria-describedby="referral-detail-description"
            className={`flex w-full flex-col overflow-hidden ${isHealthSupervisor ? "supervisor-modal" : ""}`}
            style={{ maxWidth: "760px", maxHeight: "84vh" }}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border px-3 py-2.5 sm:px-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-gray">Referral details</p>
                <h3 id="referral-detail-title" className="mt-0.5 truncate text-base font-semibold text-brand-ink sm:text-lg">{detail.residentName || "Selected Referral"}</h3>
                <p id="referral-detail-description" className="mt-0.5 truncate text-xs text-brand-gray">
                  {detail.destinationFacility || `Record ${detail.id}`}{detail.barangay ? ` · ${detail.barangay}` : ""}
                </p>
              </div>
              <button
                ref={detailCloseButtonRef}
                type="button"
                onClick={closeDetail}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                aria-label="Close referral details"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
              {detailLoading && <p className="text-sm text-brand-gray">Loading current referral and history...</p>}
              {detailError && <div role="alert"><p className="text-sm text-brand-danger">{detailError}</p><button type="button" onClick={() => openDetail(detail)} className="mt-2 text-sm font-medium text-brand-blue hover:underline">Retry</button></div>}
              {!detailLoading && !detailError && <>
              <div className="flex flex-wrap items-center gap-2">
                {detail.stage && (
                  <span className="inline-flex items-center rounded-full bg-brand-blue/10 px-2.5 py-1 text-xs font-medium text-brand-blue">
                    {detail.stage.label}
                  </span>
                )}
                <StatusBadge value={detail.status} />
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PRIORITY_COLORS[detail.priority] || ""}`}>
                  {detail.priority} priority
                </span>
              </div>

              <section aria-labelledby="referral-overview-heading">
                <h4 id="referral-overview-heading" className="mb-2 text-sm font-semibold text-brand-ink">Referral overview</h4>
                <dl className="grid grid-cols-1 gap-x-5 gap-y-2.5 rounded-btn border border-brand-border bg-brand-bg/50 p-3 text-sm sm:grid-cols-2">
                  {[
                    ["Referral date", formatDate(detail.referralDate)],
                    ["Scheduled", detail.scheduledAt ? new Date(detail.scheduledAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"],
                    ["Destination", detail.destinationFacility || "—"],
                    ["Outside receiving facility", detail.externalReceivingFacility || "—"],
                    ["Outside facility address", detail.externalReceivingAddress || "—"],
                    ["Outside recipient", detail.externalRecipientName || "—"],
                    ["Outside role / position", [detail.externalReceivingRole, detail.externalRecipientPosition].filter(Boolean).join(" · ") || "—"],
                    ["Destination service", detail.destinationService || "—"],
                    ["Referring facility", detail.referringFacility || "—"],
                    ["Sender", detail.senderName || "Historical sender"],
                    ["Assigned recipient", referralRecipientLabel(detail)],
                    ["Historical document IDs", detail.legacyReferralIds.join(", ") || "None"],
                    ["Completed", formatDate(detail.completedAt)],
                    ["Laboratory test required", detail.laboratoryTestRequired ? "Yes" : "No"],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-brand-gray">{label}</dt>
                      <dd className="mt-0.5 break-words font-medium text-brand-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-labelledby="referral-clinical-heading" className="space-y-2">
                <h4 id="referral-clinical-heading" className="text-sm font-semibold text-brand-ink">Clinical information</h4>
                <DetailField label="Reason for referral" value={detail.reason || "—"} />
                {detail.chiefComplaints && <DetailField label="Chief complaints" value={detail.chiefComplaints} />}
                {detail.medicalHistory && <DetailField label="Clinical history" value={detail.medicalHistory} />}
                {formatReferralVitals(detail.referralVitals) && <DetailField label="Barangay vital signs" value={formatReferralVitals(detail.referralVitals)} />}
                {detail.physicalExamFindings && <DetailField label="Previously recorded examination findings" value={detail.physicalExamFindings} />}
                {detail.impression && <DetailField label="Impression / working diagnosis" value={detail.impression} />}
                {detail.laboratoryTestRequired && (
                  <DetailField
                    label="Laboratory test"
                    value={[detail.laboratoryTest || "—", detail.additionalInstructions].filter(Boolean).join("\n")}
                  />
                )}
              </section>

              <section aria-labelledby="referral-notes-heading" className="space-y-2">
                <h4 id="referral-notes-heading" className="text-sm font-semibold text-brand-ink">Notes and resolution</h4>
                <DetailField label="Notes" value={detail.notes || "No notes recorded."} />
                {detail.resolutionNotes && <DetailField label="Resolution" value={detail.resolutionNotes} />}
              </section>
              {detail.encounter && <DetailField label="Receiving encounter" value={`${detail.encounter.id}: ${detail.encounter.status}${detail.encounter.completed_at ? ` / completed ${new Date(detail.encounter.completed_at).toLocaleString()}` : ""}`} />}
              <ReferralHistory history={detail.history} />
              </>}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-brand-border px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={closeDetail}
                className="rounded-btn px-3 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
              >
                Close
              </button>
              {!isResident && !detailLoading && !detailError && canAssignReferral(detail, can) && (
                <button
                  type="button"
                  onClick={() => openEdit(detail)}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-2"
                >
                  <Edit2 className="h-4 w-4" /> {detail.status === "Pending" ? "Edit / Assign" : "Reassign"}
                </button>
              )}
              {!isResident && !detailLoading && !detailError && allowedReferralStatuses(detail, can).length > 0 && <button type="button" onClick={() => { openStatus(detail); closeDetail(); }} className="rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white">Update Status</button>}
            </div>
          </Card>
        </div>
      )}

      {/* Create / Edit modal */}
      {formOpen && canWrite && (
        <ReferralModalErrorBoundary onClose={closeReferralForm}>
          <ReferralFormModal
            initial={editing}
            draft={draft}
            resident={targetResident}
            residents={residents}
            barangays={referralBarangays}
            saving={saving}
            ownerId={user?.id}
            assignedBarangay={assignedBarangay}
            referringFacilityFallback={isHealthSupervisor
              ? `Barangay Health Station — ${assignedBarangay || user?.barangay || "your barangay"}`
              : `RHU — ${user?.municipality || "your municipality"}`}
            referringPersonnelName={user?.name}
            onClose={closeReferralForm}
            onSave={handleSave}
            onSelectResident={setSelectedResident}
            onRegisterGuest={registerReferralGuest}
          />
        </ReferralModalErrorBoundary>
      )}

      {/* Update status modal */}
      {statusTarget && !isResident && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-brand-ink">Update Status</h3>
                <button onClick={() => setStatusTarget(null)} className="text-brand-gray hover:text-brand-ink"><X className="h-4 w-4" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-brand-gray mb-1">Current Status</p>
                  <StatusBadge value={statusTarget.status} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">New Status</label>
                  <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    {allowedReferralStatuses(statusTarget, can)
                      .map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Resolution / Notes{["Rejected", "Cancelled"].includes(newStatus) ? " (required)" : ""}</label>
                  <textarea rows={3} required={["Rejected", "Cancelled"].includes(newStatus)} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="Record the reason or progress update..." className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none" />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setStatusTarget(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
                <button disabled={saving || !canSetReferralStatus(newStatus, statusTarget) || (["Rejected", "Cancelled"].includes(newStatus) && !resolutionNotes.trim())} onClick={handleStatusSave} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">Update</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {scheduleRequestTarget && (
        <ResidentReferralScheduleRequestModal
          target={scheduleRequestTarget}
          busy={residentRequestBusy}
          onClose={() => { if (!residentRequestBusy) setScheduleRequestTarget(null); }}
          onSubmit={(details) => submitResidentScheduleRequest({ record: scheduleRequestTarget.record, ...details })}
        />
      )}

    </>
  );
}

function ResidentReferralScheduleRequestModal({ target, busy, onClose, onSubmit }) {
  const [dateTime, setDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const minimumDateTime = (() => {
    const now = new Date(Date.now() + 60_000);
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  })();
  const isReschedule = target.requestType === "reschedule";
  const title = isReschedule ? "Request a new appointment time" : "Request referral cancellation";
  const submit = () => {
    if (isReschedule && (!dateTime || dateTime <= minimumDateTime)) {
      setError("Choose a future date and time.");
      return;
    }
    if (!reason.trim()) {
      setError("Please provide a reason for your request.");
      return;
    }
    setError("");
    onSubmit({ requestType: target.requestType, proposedSchedule: isReschedule ? dateTime : null, reason: reason.trim() });
  };
  return (
    <FormModal
      title={title}
      description={`${target.record.reason} · ${target.record.destinationFacility}`}
      onClose={onClose}
      closeDisabled={busy}
      closeOnBackdrop
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink disabled:opacity-60">Keep schedule</button>
        <button type="button" onClick={submit} disabled={busy} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? "Sending…" : "Send request"}</button>
      </>}
    >
      <p className="text-sm text-brand-gray">Your current referral schedule stays active until the responsible health team reviews the request.</p>
      <section className="mt-4 space-y-4">
        <h3 className="border-b border-brand-border pb-2 text-sm font-semibold text-brand-ink">Schedule request</h3>
        {isReschedule && <label className="block text-sm font-medium text-brand-ink">Proposed date and time<input type="datetime-local" min={minimumDateTime} value={dateTime} onChange={(event) => setDateTime(event.target.value)} className="mt-1.5 w-full rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink dark:bg-input dark:text-foreground" /></label>}
        <label className="block text-sm font-medium text-brand-ink">Reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Tell the health team why you need this change." className="mt-1.5 w-full resize-y rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink dark:bg-input dark:text-foreground" /></label>
        {error && <p role="alert" className="text-sm text-brand-danger">{error}</p>}
      </section>
    </FormModal>
  );
}

function DetailField({ label, value }) {
  return (
    <div className="min-w-0 rounded-btn border border-brand-border px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-brand-gray">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-brand-ink">{value}</p>
    </div>
  );
}
