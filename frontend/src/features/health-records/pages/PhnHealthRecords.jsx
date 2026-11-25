import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { FormModalHeader } from "@/components/common/FormModal";
import KpiHorizontal from "@/components/common/KpiHorizontal";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonStatGrid } from "@/components/common/Skeleton";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useAuth } from "@/context/AuthContext";
import { usePhnCoverage } from "@/context/PhnCoverageContext";
import api from "@/services/api/apiClient";
import { consultationsApi, followUpsApi } from "@/services/api";
import { captureOwnerGuard } from "@/services/offline/db";
import { saveConsultationOffline, listConsultationsOffline, listConsultationResidentsOffline, submitConsultationDraft, restoreConsultationDraft } from "@/services/offline/consultationOfflineService";
import { loadServerRows } from "@/lib/serverRows";
import { formatClinicalDate } from "@/lib/dateUtils";
import { normalizeResident } from "../lib/tclData";
import { clinicalPayload, clinicalErrors, consultationForm, consultationCondition, requiresClinicalCompletion, requireServerConsultation, completePhnHealthRecordCheckup } from "../lib/phnRecords";
import { filterRowsByScope } from "@/lib/phnScope";
import { manilaDateKey, followUpNeedsAttention, isHighRiskResident } from "@/lib/phnDashboard";
import PhnCheckupWorkbench from "@/features/consultations/components/PhnCheckupWorkbench";
import MedicineSelector from "@/features/consultations/components/MedicineSelector";
import { Search, Plus, Eye, Edit2, Trash2, X, ClipboardCheck } from "lucide-react";
import { ActionMenu, ActionMenuContent, ActionMenuItem, ActionMenuTrigger } from "@/components/ui/action-menu";
import { formatStatusLabel, getStatusColor, getRiskColor } from "@/lib/statusFormatter";
import TablePagination from "@/components/tables/TablePagination";
import LabResultsPanel from "@/features/health-records/components/LabResultsPanel";
import { consultationAssessment, consultationFollowUp, consultationRiskLevel, consultationServiceName, consultationRiskReasons } from "@/features/consultations/lib/consultationRisk";
import { validateConsultationDateTime, validateConsultationVitals, calculateConsultationBmi, assessConsultationRisk, getManilaDateTime } from "../../../../../shared/consultationClinical.js";
import SearchableSelect from "@/components/common/SearchableSelect";
import { formatBloodPressureInput } from "@/features/consultations/utils/bpClassification";

const inputCls = "w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue focus:border-2";
const fieldNames = {
  consultationDate: "Encounter Date", consultationTime: "Encounter Time", chiefComplaint: "Chief Complaint", findings: "Examination Findings", diagnosis: "Diagnosis / Assessment", bloodPressure: "Blood Pressure", temperature: "Temperature (C)", pulseRate: "Pulse Rate", respiratoryRate: "Respiratory Rate", height: "Height (cm)", weight: "Weight (kg)", bmi: "BMI (kg/m2)", oxygenSaturation: "Oxygen Saturation (%)", nextVisitDate: "Next Visit Date",
};
const vitalFields = ["bloodPressure", "temperature", "pulseRate", "respiratoryRate", "height", "weight", "oxygenSaturation"];
const textFields = ["chiefComplaint", "findings", "diagnosis"];
const riskLabel = (level) => level === "Moderate" ? "Medium" : level || "Unassessed";
const consultationDateIsPast = (record) => {
  const date = String(record?.consultationDate || "").slice(0, 10);
  return Boolean(date && date < getManilaDateTime().date);
};
const generalIndicators = [
  ["severeBreathingDifficulty", "Severe breathing difficulty"], ["suspectedStroke", "Suspected stroke"],
  ["severeBleeding", "Severe bleeding"], ["alteredConsciousness", "Altered consciousness"], ["convulsions", "Convulsions"],
  ["chestPain", "Chest pain"], ["difficultySpeaking", "Difficulty speaking"], ["acuteNeurologicalSymptoms", "Acute neurological symptoms"],
  ["moderateSymptoms", "Symptoms requiring closer monitoring"], ["additionalTesting", "Additional testing required"],
  ["chronicDisease", "Chronic disease requiring monitoring"], ["activeTreatment", "Active treatment required"],
  ["resourcesUnavailable", "Required clinical resources unavailable"],
];
const maternalIndicators = [
  ["bleeding", "Vaginal bleeding"], ["severeHeadache", "Severe headache"], ["visualDisturbance", "Visual disturbance"],
  ["severeAbdominalPain", "Severe abdominal pain"], ["reducedFetalMovement", "Reduced fetal movement"],
];
const compactRiskFindings = (assessment = {}) => {
  const reasons = Array.isArray(assessment.reasons) ? assessment.reasons : [];
  const ruleIds = new Set(reasons.map((reason) => reason?.ruleId));
  const findings = [];
  if ([...ruleIds].some((rule) => String(rule).startsWith("bp_stage") || ["stage1", "bp_stage1_hypertension"].includes(rule)) || reasons.some((reason) => /stage 1|130.*80/i.test(reason?.message || ""))) findings.push("Stage 1 hypertension reading");
  if ([...ruleIds].some((rule) => String(rule).includes("respiratory")) && reasons.some((reason) => /dangerous|urgent/i.test(reason?.message || ""))) findings.push("Dangerous respiratory rate");
  if (reasons.some((reason) => String(reason?.ruleId) === "oxygen_danger" || /oxygen saturation at or below 92/i.test(reason?.message || ""))) findings.push("Oxygen saturation at or below 92%");
  if (reasons.some((reason) => String(reason?.ruleId) === "bmi_abnormal" || /BMI/i.test(reason?.message || ""))) findings.push("BMI requires clinical review");
  if (assessment.missingMeasurements?.includes("temperature") || reasons.some((reason) => /temperature.*missing|missing or invalid.*temperature/i.test(reason?.message || ""))) findings.push("Missing or invalid temperature measurement");
  return findings;
};

function Modal({ title, description, onClose, busy = false, footer = null, children, formDesign = false }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"><Card role="dialog" aria-label={title} aria-modal="true" className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden p-0 sm:max-h-[92vh]">{formDesign ? <FormModalHeader title={title} description={description} onClose={onClose} closeDisabled={busy} /> : <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-6"><h2 className="min-w-0 break-words text-base font-semibold text-brand-ink sm:text-lg">{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-brand-gray disabled:opacity-40"><X className="h-5 w-5" /></button></div>}<div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 ${formDesign ? "bg-white dark:bg-card" : ""}`}>{children}</div>{footer && <div className="shrink-0 border-t border-brand-border bg-white px-4 py-3 sm:px-6">{footer}</div>}</Card></div>;
}

export default function PhnHealthRecords() {
  const { user } = useAuth();
  const { coverage } = usePhnCoverage();
  const queue = usePhnWorkflow({ source: "queue" });
  const { online } = useSyncStatus();
  const load = useCallback(async (options) => {
    const [consultations, residents, followUps] = await Promise.all([
      listConsultationsOffline({ ownerId: options.ownerId, online: () => online, fetchList: () => loadServerRows((params) => api.get("/consultations", { ...options, params })) }),
      listConsultationResidentsOffline({ ownerId: options.ownerId, online: () => online, fetchList: () => loadServerRows((params) => api.get("/residents", { ...options, params: { ...params, verified: true } })) }),
      followUpsApi.list().catch(() => ({ rows: [] })),
    ]);
    return { 
      consultations: consultations.filter((record) => !record.offline), 
      pending: consultations.filter((record) => record.offline), 
      residents: residents.map(normalizeResident).filter(Boolean),
      followUps: followUps?.rows || [],
    };
  }, [online]);
  const resource = useAuthorizedData(load);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [editor, setEditor] = useState(null);
  const [original, setOriginal] = useState(null);
  const [form, setForm] = useState(() => consultationForm());
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [policy, setPolicy] = useState(false);
  const [checkup, setCheckup] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pendingView, setPendingView] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(8);
  const [contextState, setContextState] = useState(null);
  const [contextRetry, setContextRetry] = useState(0);
  const registry = resource.data?.residents || [];
  const residentById = useMemo(() => new Map(registry.map((resident) => [String(resident.id), resident])), [registry]);
  const residentOptions = useMemo(() => registry.map((resident) => {
    const recordNumber = resident.healthRecordNo || resident.healthRecordNumber || resident.health_record_no || "";
    const label = [
      resident.name || "Name not recorded",
      resident.barangay || "Barangay not recorded",
      recordNumber ? `Record ${recordNumber}` : "",
      `Resident ID ${resident.id}`,
    ].join(" · ");
    return { value: String(resident.id), label, resident };
  }).sort((a, b) => a.resident.name.localeCompare(b.resident.name)), [registry]);
  const records = useMemo(() => filterRowsByScope((resource.data?.consultations || []).map((record) => ({ ...record, barangay: record.resident?.barangay || "", consultationLocation: record.facilityName || "" })), user, coverage), [resource.data, user, coverage]);
  const patientsByVisit = useMemo(() => new Map((queue.patients || []).filter((patient) => patient.source !== "submitted").map((patient) => [String(patient.id), patient])), [queue.patients]);
  const selectedResident = residentById.get(String(form.residentId)) || original?.resident || null;
  const contextScope = [user?.id, editor, original?.id, form.residentId, form.consultationDate].join("|");
  const scopedContextState = contextState?.scope === contextScope ? contextState : null;
  const clinicalContext = online ? scopedContextState?.data : null;
  const contextLoading = Boolean(editor && online && form.residentId && (!scopedContextState || scopedContextState.loading));
  const canReviewRisk = editor === "edit" && online && !contextLoading && clinicalContext?.canReviewRisk === true;
  const requireClinical = requiresClinicalCompletion(form, original);
  const bmi = calculateConsultationBmi(form.height, form.weight);
  const originalAssessment = original ? consultationAssessment(original) : null;
  const savedPregnancy = original?.clinicalContext?.pregnancy || original?.consultationDetails?.clinicalContext?.pregnancy;
  const reportedStatus = form.clinicalContext.pregnancyStatus;
  const pregnancy = clinicalContext?.pregnancy || savedPregnancy || (reportedStatus === "pregnant" || reportedStatus === "postpartum"
    ? { isPregnant: reportedStatus === "pregnant", isPostpartum: reportedStatus === "postpartum" } : null);
  const conditions = [...(clinicalContext?.existingConditions || []), ...form.clinicalContext.existingConditions].reduce((merged, item) => {
    const condition = consultationCondition(item);
    if (!condition.name) return merged;
    const key = condition.name.toLowerCase();
    const previous = merged.get(key);
    merged.set(key, { ...condition, status: previous?.status === "uncontrolled" ? "uncontrolled" : condition.status, significant: previous?.significant === true || condition.significant });
    return merged;
  }, new Map());
  const riskPreview = assessConsultationRisk({
    vitals: form, age: clinicalContext?.age ?? selectedResident?.age ?? null, pregnancy,
    existingConditions: [...conditions.values()], indicators: { ...form.clinicalIndicators, followUpRequired: form.followUpRequired === "Yes" },
    previousAssessment: original && consultationRiskLevel(original) === "High"
      ? { ...originalAssessment, level: "High", sourceVisitId: original.id } : clinicalContext?.previousAssessment,
    sourceStatus: clinicalContext?.sourceStatus || "unavailable",
  });
  const viewingForm = viewing ? consultationForm(viewing) : null;
  const viewingAssessment = viewing ? consultationAssessment(viewing) : null;
  const filtered = records.filter((record) => (status === "All" || record.status === status) && `${record.resident?.name || ""} ${record.diagnosis || ""} ${record.id}`.toLowerCase().includes(query.toLowerCase()));
  const pageRecords = filtered.slice((recordsPage - 1) * recordsPageSize, recordsPage * recordsPageSize);
  const statuses = [...new Set(records.map((record) => record.status).filter(Boolean))];
  useEffect(() => { setRecordsPage(1); }, [query, status]);
  useEffect(() => { setRecordsPage((page) => Math.min(page, Math.max(1, Math.ceil(filtered.length / recordsPageSize)))); }, [filtered.length, recordsPageSize]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const ownerId = user?.id;
    if (!editor || !ownerId || !form.residentId || !online
      || validateConsultationDateTime({ consultationDate: form.consultationDate }).consultationDate) {
      setContextState({ scope: contextScope, data: null, loading: false, error: "" });
      return () => { active = false; controller.abort(); };
    }
    const guard = captureOwnerGuard(ownerId);
    setContextState({ scope: contextScope, data: null, loading: true, error: "" });
    consultationsApi.clinicalContext({ residentId: form.residentId, consultationDate: form.consultationDate }, {
      ownerId, signal: controller.signal, dedupeKey: `phn-clinical-context:${contextScope}:${contextRetry}`,
    }).then((context) => {
      if (!active || controller.signal.aborted || !guard()) return;
      if (!context || !Array.isArray(context.existingConditions) || !["available", "incomplete"].includes(context.sourceStatus)) throw new Error("The resident clinical context could not be verified.");
      // Source data stays separate from manually entered encounter dates, times and clinical inputs.
      setContextState({ scope: contextScope, data: context, loading: false, error: "" });
    }).catch((error) => {
      if (active && !controller.signal.aborted && guard()) setContextState({ scope: contextScope, data: null, loading: false, error: error?.message || "Clinical context is unavailable. No absence of pregnancy or conditions has been assumed." });
    });
    return () => { active = false; controller.abort(); };
  }, [contextScope, contextRetry, editor, user?.id, form.residentId, form.consultationDate, online]);
  
  // Calculate PHN-focused KPIs
  const kpiMetrics = useMemo(() => {
    const today = manilaDateKey();
    const currentMonth = today.slice(0, 7); // YYYY-MM
    
    // KPI 1: Unique residents with at least one consultation record
    const uniqueResidents = new Set(records.map(r => r.residentId || r.resident_id).filter(Boolean));
    const totalResidentsWithRecords = uniqueResidents.size;
    
    // KPI 2: Follow-ups due (overdue or due today)
    const followUps = resource.data?.followUps || [];
    const followUpsDue = followUps.filter(f => followUpNeedsAttention(f, today)).length;
    
    // KPI 3: High-risk residents (unique count from resident registry)
    const highRiskResidents = registry.filter(r => isHighRiskResident(r)).length;
    
    // KPI 4: Consultations completed this month
    const consultationsThisMonth = records.filter(record => {
      const date = record.consultationDate || record.consultation_date || "";
      return date.startsWith(currentMonth) && record.status === "completed";
    }).length;
    
    return {
      totalResidentsWithRecords,
      followUpsDue,
      highRiskResidents,
      consultationsThisMonth,
    };
  }, [records, registry, resource.data]);
  const modalOpen = Boolean(editor || viewing || policy || checkup || pendingView);
  useEffect(() => {
    if (!modalOpen) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [modalOpen]);
  useEffect(() => { setEditor(null); setOriginal(null); setViewing(null); setPendingView(null); setPolicy(false); setCheckup(null); setForm(consultationForm()); setContextState(null); setErrors({}); setFailure(""); setBusy(false); setNotice(null); setQuery(""); }, [user?.id]);

  const openRecord = async (record, edit) => {
    if (busy) return;
    if (edit && consultationDateIsPast(record)) {
      setNotice({ error: true, message: "Past clinical records are view-only. Records dated today can still be edited." });
      return;
    }
    if (!online && edit) { setNotice({ error: true, message: "Clinical edits require a fresh server record and an online confirmed update. Cached history has not been changed." }); return; }
    const guard = captureOwnerGuard(user.id);
    setBusy(true); setFailure(""); setNotice(null);
    try {
      const full = requireServerConsultation(online ? await api.get(`/consultations/${record.id}`, { ownerId: user.id }) : { consultation: record }, record.id);
      if (!guard()) return;
      if (edit && consultationDateIsPast(full)) {
        setNotice({ error: true, message: "Past clinical records are view-only. Records dated today can still be edited." });
        return;
      }
      if (edit) { setOriginal(full); setForm(consultationForm(full)); setContextState(null); setErrors({}); setEditor("edit"); }
      else setViewing(full);
    } catch (error) { if (guard()) setNotice({ error: true, message: error?.message || "Could not load the complete consultation." }); }
    finally { if (guard()) setBusy(false); }
  };
  const save = async () => {
    if (busy || !user?.id) return;
    if (editor === "edit" && !online) { setFailure("Clinical edits require an online confirmed update. The saved record has not been changed."); return; }
    const payload = clinicalPayload(form, original);
    const validation = clinicalErrors(payload, { required: requireClinical, encounterDate: form.consultationDate, previousMedications: original?.medications || [] });
    if (form.consultationDate && form.consultationDate > getManilaDateTime().date) validation.consultationDate = "Encounter date cannot be in the future.";
    if (!residentById.has(String(payload.residentId)) && payload.residentId !== String(original?.resident?.id || original?.residentId || "")) validation.residentId = "Select a resident from the authorized registry.";
    if (form.riskReview && !canReviewRisk) validation.riskReview = "Risk review requires current server-confirmed clinical authority for this resident and encounter date.";
    setErrors(validation);
    if (Object.keys(validation).length) return;
    const guard = captureOwnerGuard(user.id);
    setBusy(true); setFailure("");
    try {
      if (editor === "edit") {
        const record = requireServerConsultation(await api.put(`/consultations/${original.id}`, { consultation: payload }, { ownerId: user.id }), original.id);
        if (!guard()) return;
        setViewing(record);
        setNotice({ message: "Consultation updated on the server." });
      } else {
        const result = await saveConsultationOffline({ ownerId: user.id, payload, create: (body, options) => api.post("/consultations", body, options) });
        if (!guard()) return;
        if (result.queued || result.source !== "server") {
          setNotice({ pending: true, message: "Consultation retained as encrypted pending work. It is not a server health record until synchronization is confirmed." });
        } else {
          const record = requireServerConsultation({ consultation: result.record });
          setViewing(record);
          setNotice({ message: "Consultation saved on the server." });
        }
      }
      setEditor(null); setOriginal(null); setForm(consultationForm());
      await resource.refresh();
    } catch (error) {
      if (guard()) {
        const serverErrors = error?.payload?.error?.errors;
        if (serverErrors && typeof serverErrors === "object" && !Array.isArray(serverErrors)) setErrors((current) => ({ ...current, ...serverErrors }));
        setFailure(error?.message || "The consultation could not be saved. No local clinical record was changed.");
      }
    }
    finally { if (guard()) setBusy(false); }
  };
  const pendingAction = async (draft, retry) => {
    if (busy || !user?.id) return;
    const guard = captureOwnerGuard(user.id);
    setBusy(true);
    try {
      if (retry) {
        const result = await submitConsultationDraft({ ownerId: user.id, localId: draft.localId, create: (body, options) => api.post("/consultations", body, options) });
        if (!guard()) return;
        setNotice({ pending: result.queued, message: result.source === "server" && !result.queued ? "The original queued consultation is confirmed by the server." : "The original encrypted operation remains pending; no new consultation identity was created." });
        if (result.source === "server" && !result.queued) setViewing(requireServerConsultation({ consultation: result.record }));
        await resource.refresh();
      } else {
        const restored = await restoreConsultationDraft({ ownerId: user.id, localId: draft.localId });
        if (guard()) setPendingView(restored);
      }
    } catch (error) { if (guard()) setNotice({ error: true, message: error?.message || "Pending clinical work could not be opened or synchronized." }); }
    finally { if (guard()) setBusy(false); }
  };
  const handleCompleteCheckup = async (recorded) => {
    if (!checkup?.id) return;
    const guard = captureOwnerGuard(user?.id);
    try {
      await completePhnHealthRecordCheckup({
        checkup,
        recorded,
        completeCheckup: queue.completeCheckup,
        refreshRecords: resource.refresh,
        refreshQueue: queue.refresh,
      });
      if (!guard()) return;
      setCheckup(null);
      setNotice({ message: "PHN check-up completed and persisted." });
    } catch (error) {
      if (guard()) setNotice({ error: true, message: error?.message || "Could not complete the PHN check-up." });
      throw error;
    }
  };
  const updateField = (name, value) => {
    const next = { ...form, [name]: value };
    setForm(next);
    setErrors((current) => {
      const validation = validateConsultationVitals(next);
      const dateValidation = validateConsultationDateTime(next);
      const nextErrors = { ...current };
      if (vitalFields.includes(name)) {
        if (String(value ?? "").trim() || current[name]) nextErrors[name] = validation[name] || "";
        if (["height", "weight"].includes(name) || current.bmi) nextErrors.bmi = validation.bmi || "";
      }
      if (name === "consultationDate" || name === "consultationTime") nextErrors[name] = dateValidation[name] || "";
      if (name === "consultationDate" && next.consultationDate) {
        const today = getManilaDateTime().date;
        if (next.consultationDate > today) nextErrors.consultationDate = "Encounter date cannot be in the future.";
      }
      if (!nextErrors[name]) delete nextErrors[name];
      if (nextErrors.bmi === "") delete nextErrors.bmi;
      return nextErrors;
    });
  };
  const field = (name, type = "text") => {
    if (name === "bloodPressure") return <label key={name} className="block min-w-0 text-xs font-medium text-brand-gray">{fieldNames[name]}{requireClinical && " *"}
      <input type="text" inputMode="numeric" maxLength={9} disabled={busy} aria-label={fieldNames[name]} aria-required={requireClinical} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `phn-${name}-error` : undefined} value={form[name]} placeholder="120/80" onChange={(event) => {
        const input = event.currentTarget || event.target;
        if (/[^0-9/]/.test(input.value)) {
          updateField(name, input.value.replace(/[^0-9/]/g, ""));
          return;
        }
        const formatted = formatBloodPressureInput(input.value, input.selectionStart, input.selectionEnd, event.nativeEvent?.inputType || "insertText");
        if (formatted) {
          input.value = formatted.value;
          input.setSelectionRange(formatted.caret, formatted.caret);
        }
        updateField(name, input.value);
      }} className={`${inputCls} mt-1`} />{errors[name] && <span id={`phn-${name}-error`} role="alert" className="mt-1 block text-xs text-brand-danger">{errors[name]}</span>}</label>;
    const numeric = ["temperature", "pulseRate", "respiratoryRate", "height", "weight", "oxygenSaturation"].includes(name);
    const inputMode = name === "temperature" || name === "height" || name === "weight" || name === "oxygenSaturation" ? "decimal" : "numeric";
    return <label key={name} className="block min-w-0 text-xs font-medium text-brand-gray">{fieldNames[name]}{requireClinical && (vitalFields.includes(name) || name === "consultationDate" || name === "consultationTime") && " *"}
      <input type={numeric ? "text" : type} inputMode={numeric ? inputMode : undefined} step={type === "number" ? "any" : undefined} max={name === "consultationDate" ? getManilaDateTime().date : undefined} disabled={busy} aria-label={fieldNames[name]} aria-required={requireClinical && (vitalFields.includes(name) || name === "consultationDate" || name === "consultationTime")} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `phn-${name}-error` : undefined} value={form[name]} onChange={(event) => {
        let value = event.target.value;
        if (numeric) {
          if (["pulseRate", "respiratoryRate"].includes(name)) value = value.replace(/\D/g, "").slice(0, 3);
          else value = value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^(-)/, "").slice(0, 12);
        }
        updateField(name, value);
      }} className={`${inputCls} mt-1`} />{errors[name] && <span id={`phn-${name}-error`} role="alert" className="mt-1 block text-xs text-brand-danger">{errors[name]}</span>}</label>;
  };

  return <>
    <PageHeader crumbs={["Clinical Care", "Health Records"]} title="Health Records" subtitle="Persisted consultations and clinical history within your authorized coverage." action={<button disabled={busy || resource.loading || Boolean(resource.error)} onClick={() => { setOriginal(null); setForm(consultationForm()); setContextState(null); setErrors({}); setFailure(""); setEditor("new"); }} className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm text-white disabled:opacity-50"><Plus className="h-4 w-4" /> New Clinical Record</button>} />
    {notice && <div role="status" className={`mb-4 rounded-btn border p-3 text-sm ${notice.error ? "border-brand-danger text-brand-danger" : notice.pending ? "border-brand-yellow text-brand-ink" : "border-brand-green text-brand-ink"}`}>{notice.message}</div>}
    {!online && <p className="mb-4 rounded-btn border border-brand-yellow/30 p-3 text-sm text-brand-gray">Offline: showing authorized encrypted cached server records. Pending consultations are not treated as persisted visits.</p>}
    {resource.data?.pending?.length > 0 && <Card className="mb-5 p-5"><h2 className="mb-3 text-sm font-semibold">Encrypted Pending Consultations</h2>{resource.data.pending.map((draft) => <div key={draft.localId} className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-border py-3"><div><p className="text-sm">{draft.status}</p><p className="text-xs text-brand-gray">Draft {draft.localId}. Not a confirmed server visit.</p></div><div className="flex gap-3"><button disabled={busy} onClick={() => pendingAction(draft, false)} className="text-sm text-brand-blue">View Retained Work</button><button disabled={busy || !online} onClick={() => pendingAction(draft, true)} className="text-sm text-brand-blue disabled:opacity-50">Retry Original Operation</button></div></div>)}</Card>}
    {resource.loading ? <SkeletonStatGrid count={4} /> : resource.error ? <ErrorState title="Health records unavailable" message={resource.error} onRetry={resource.refresh} /> : <>
      <div className="mb-5 phn-kpi-white">
        <KpiHorizontal count={4}>
          <KpiHorizontal.Item
            label="TOTAL RESIDENTS WITH RECORDS"
            value={kpiMetrics.totalResidentsWithRecords}
            tone="blue"
            description="Residents with documented clinical history"
          />
          <KpiHorizontal.Item
            label="FOLLOW-UPS DUE"
            value={kpiMetrics.followUpsDue}
            tone="amber"
            description="Residents requiring follow-up"
          />
          <KpiHorizontal.Item
            label="HIGH-RISK RESIDENTS"
            value={kpiMetrics.highRiskResidents}
            tone="red"
            description="Requiring priority PHN review"
          />
          <KpiHorizontal.Item
            label="CONSULTATIONS THIS MONTH"
            value={kpiMetrics.consultationsThisMonth}
            tone="green"
            description="Completed clinical consultations"
          />
        </KpiHorizontal>
      </div>
       <Card className="clinical-toolbar mb-5 p-4">
         <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
           <div className="clinical-search relative flex-1">
           <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-gray" />
             <input 
               value={query} 
               onChange={(event) => setQuery(event.target.value)} 
               placeholder="Search resident, barangay or program..." 
               className="w-full bg-transparent py-2 pl-10 pr-3 text-sm text-brand-ink outline-none"
             />
           </div>
           <select 
             value={status} 
             onChange={(event) => setStatus(event.target.value)} 
             className="clinical-filter rounded-btn px-3 py-2 text-sm text-brand-ink outline-none sm:w-48"
           >
             <option value="All">All Status</option>
             {statuses.map((item) => <option key={item}>{formatStatusLabel(item)}</option>)}
           </select>
         </div>
         <div className="text-xs text-brand-gray">
           Showing {filtered.length} of {records.length} records
         </div>
       </Card>
        <Card className="clinical-table-card p-0 overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="clinical-table w-full min-w-[980px] text-left text-sm border-collapse">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a" style={{ width: '24%', minWidth: '180px' }}>Resident</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a" style={{ width: '13%', minWidth: '100px' }}>Barangay</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a" style={{ width: '11%', minWidth: '90px' }}>Service</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a" style={{ width: '13%', minWidth: '100px' }}>Last Visit</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a" style={{ width: '9%', minWidth: '80px' }}>Risk</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a" style={{ width: '13%', minWidth: '100px' }}>Status</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a text-center" style={{ width: '17%', minWidth: '80px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRecords.map((record) => {
                  const resident = record.resident || {};
                  const initials = (resident.name || "??").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
                  const riskLevel = consultationRiskLevel(record);
                  const menuId = `table:${record.id}`;
                  const isMenuOpen = openMenuId === menuId;
                  
                  return (
                    <tr key={record.id}>
                      <td className="align-middle" style={{ width: '24%' }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-semibold text-white">
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-25364a truncate">{resident.name || "Name not recorded"}</p>
                            <p className="text-xs text-718096 truncate">
                              {resident.gender || resident.sex || "Unknown"} · {resident.age ? `${resident.age}y` : "Age unknown"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="align-middle text-sm text-brand-ink" style={{ width: '13%' }}>
                        <p className="truncate">{resident.barangay || "Not recorded"}</p>
                      </td>
                      <td className="align-middle text-sm text-brand-ink" style={{ width: '11%' }}>
                        <p className="truncate">{consultationServiceName(record) || "Not recorded"}</p>
                      </td>
                      <td className="align-middle text-sm text-brand-ink" style={{ width: '13%' }}>
                        <p>{record.consultationDate ? formatClinicalDate(record.consultationDate) : "Not recorded"}</p>
                        {record.consultationTime && <p className="text-xs text-brand-gray">{record.consultationTime}</p>}
                      </td>
                      <td className="align-middle" style={{ width: '9%' }}>
                        <span title={consultationRiskReasons(record) || "No saved encounter assessment"} className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium gap-1.5 whitespace-nowrap ${getRiskColor(riskLevel)}`}>
                          <span aria-hidden="true" className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-current opacity-60" />
                          {riskLabel(riskLevel)}
                        </span>
                      </td>
                      <td className="align-middle" style={{ width: '13%' }}>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium gap-1.5 whitespace-nowrap ${getStatusColor(record.status)}`}>
                          <span aria-hidden="true" className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-current opacity-60" />
                          {formatStatusLabel(record.status)}
                        </span>
                      </td>
                      <td className="relative align-middle text-center" style={{ width: '17%' }}>
                        <ActionMenu
                          open={isMenuOpen}
                          onOpenChange={(open) => setOpenMenuId(open ? menuId : null)}
                        >
                          <ActionMenuTrigger label={`Actions for ${resident.name || "resident"}`} disabled={busy} />
                          <ActionMenuContent aria-label={`Actions for ${resident.name || "resident"}`}>
                            <ActionMenuItem icon={Eye} disabled={busy} onSelect={() => { setOpenMenuId(null); openRecord(record, false); }}>
                              View Record
                            </ActionMenuItem>
                            {!consultationDateIsPast(record) && (
                              <ActionMenuItem icon={Edit2} disabled={busy} onSelect={() => { setOpenMenuId(null); openRecord(record, true); }}>
                                Edit Record
                              </ActionMenuItem>
                            )}
                            {patientsByVisit.has(String(record.id)) && (
                              <ActionMenuItem icon={ClipboardCheck} onSelect={() => { setOpenMenuId(null); setCheckup(patientsByVisit.get(String(record.id))); }}>
                                Open PHN Workflow
                              </ActionMenuItem>
                            )}
                            <ActionMenuItem icon={Trash2} onSelect={() => { setOpenMenuId(null); setPolicy(true); }}>
                              Deletion Policy
                            </ActionMenuItem>
                          </ActionMenuContent>
                        </ActionMenu>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-brand-gray">
                      No persisted consultations match this scope and filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-brand-border md:hidden">
            {pageRecords.map((record) => {
              const resident = record.resident || {};
              const riskLevel = consultationRiskLevel(record);
              const menuId = `mobile:${record.id}`;
              return (
                <article key={record.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-base font-semibold text-brand-ink">{resident.name || "Name not recorded"}</p>
                      <p className="mt-0.5 break-words text-xs text-brand-gray">{resident.gender || resident.sex || "Unknown"} · {resident.age ? `${resident.age}y` : "Age unknown"}</p>
                    </div>
                    <ActionMenu
                      open={openMenuId === menuId}
                      onOpenChange={(open) => setOpenMenuId(open ? menuId : null)}
                    >
                      <ActionMenuTrigger label={`Actions for ${resident.name || "resident"}`} disabled={busy} />
                      <ActionMenuContent aria-label={`Actions for ${resident.name || "resident"}`}>
                        <ActionMenuItem icon={Eye} disabled={busy} onSelect={() => { setOpenMenuId(null); openRecord(record, false); }}>
                          View Record
                        </ActionMenuItem>
                        {!consultationDateIsPast(record) && (
                          <ActionMenuItem icon={Edit2} disabled={busy} onSelect={() => { setOpenMenuId(null); openRecord(record, true); }}>
                            Edit Record
                          </ActionMenuItem>
                        )}
                      </ActionMenuContent>
                    </ActionMenu>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Barangay</dt><dd className="mt-1 break-words text-sm text-brand-ink">{resident.barangay || "Not recorded"}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Resident ID</dt><dd className="mt-1 break-words text-sm text-brand-ink">{resident.id || record.residentId || "Not recorded"}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Service</dt><dd className="mt-1 break-words text-sm text-brand-ink">{consultationServiceName(record) || "Not recorded"}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Last Visit</dt><dd className="mt-1 text-sm text-brand-ink">{record.consultationDate ? formatClinicalDate(record.consultationDate) : "Not recorded"}{record.consultationTime && ` · ${record.consultationTime}`}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Risk</dt><dd className="mt-1"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${getRiskColor(riskLevel)}`}>{riskLabel(riskLevel)}</span></dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Status</dt><dd className="mt-1"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${getStatusColor(record.status)}`}>{formatStatusLabel(record.status)}</span></dd></div>
                  </dl>
                </article>
              );
            })}
            {filtered.length === 0 && <p className="p-6 text-center text-sm text-brand-gray">No persisted consultations match this scope and filter.</p>}
          </div>
        </Card>
        <TablePagination
          total={filtered.length}
          page={recordsPage}
          pageSize={recordsPageSize}
          onPageChange={setRecordsPage}
          onPageSizeChange={(size) => { setRecordsPageSize(size); setRecordsPage(1); }}
          className="clinical-pagination mt-4"
        />
    </>}
    {editor && <Modal title={editor === "edit" ? "Edit Persisted Consultation" : "New Clinical Consultation"} description="Record the resident's clinical consultation, assessment, and follow-up plan." formDesign onClose={() => setEditor(null)} busy={busy} footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button disabled={busy} onClick={() => setEditor(null)} className="min-h-11 rounded-btn border border-brand-border px-4 py-2 text-sm sm:min-h-10">Cancel</button><button disabled={busy || (editor === "edit" && !online)} onClick={save} className="min-h-11 rounded-btn bg-brand-blue px-5 py-2 text-sm text-white disabled:opacity-50 sm:min-h-10">{busy ? "Saving..." : "Save Clinical Record"}</button></div>}>
      {failure && <p role="alert" className="mb-4 text-sm text-brand-danger">{failure}</p>}
      <section aria-labelledby="phn-resident-section" className="mb-5">
        <h3 id="phn-resident-section" className="mb-2 text-sm font-semibold">Resident Information</h3>
        <SearchableSelect
          label="Resident Registry Record"
          ariaLabel="Resident Registry Record"
          required
          disabled={editor === "edit" || busy}
          value={form.residentId}
          onChange={(residentId) => {
            setForm((current) => ({ ...current, residentId, clinicalContext: { pregnancyStatus: "unknown", existingConditions: [] }, clinicalIndicators: {}, maternal: null }));
            setErrors((current) => ({ ...current, residentId: "" }));
          }}
          options={[
            ...(original && form.residentId && !residentById.has(String(form.residentId)) ? [{ value: String(form.residentId), label: `${original.resident?.name || "Saved resident record"} · Saved resident ID ${form.residentId}` }] : []),
            ...residentOptions,
          ]}
          placeholder="Search name, resident ID, health record number, or barangay"
          emptyText="No authorized resident matches this search."
          error={errors.residentId || ""}
          maxResults={8}
          portalDropdown
        />
      </section>
      {selectedResident && <p className="mb-4 break-words rounded-btn bg-brand-bg p-3 text-xs text-brand-gray">Resident ID: {selectedResident.id} · Age: {selectedResident.age ?? "Not recorded"} · Sex: {selectedResident.gender || selectedResident.sex || "Not recorded"} · Barangay: {selectedResident.barangay || "Not recorded"}.</p>}
      {original && <p className="mb-4 text-xs text-brand-gray">Recorded service: {consultationServiceName(original) || "Not recorded"}</p>}
      <section aria-labelledby="phn-encounter-section" className="mb-5">
        <h3 id="phn-encounter-section" className="mb-2 text-sm font-semibold">Encounter Information</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{field("consultationDate", "date")}{field("consultationTime", "time")}</div>
      </section>
      <section aria-labelledby="phn-vitals-section" className="mb-5">
      <h3 id="phn-vitals-section" className="mb-2 text-sm font-semibold">Recorded Vital Signs</h3>
      <p className="mb-3 text-xs text-brand-gray">All required vital fields must contain a plausible clinical measurement.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vitalFields.map((name) => field(name, name === "bloodPressure" ? "text" : "number"))}
        <label className="block text-xs font-medium text-brand-gray">{fieldNames.bmi}{requireClinical && " *"}<input aria-label="BMI" aria-required={requireClinical} aria-invalid={Boolean(errors.bmi)} readOnly value={bmi === null ? "" : bmi.toFixed(1)} className={`${inputCls} mt-1 bg-brand-bg`} /><span className="mt-1 block text-xs">Calculated from measured height and weight.</span>{errors.bmi && <span role="alert" className="mt-1 block text-xs text-brand-danger">{errors.bmi}</span>}</label>
      </div>
      </section>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">{textFields.map((name) => <label key={name} className="text-xs font-medium text-brand-gray">{fieldNames[name]}{requireClinical && ["chiefComplaint", "findings"].includes(name) && " *"}<textarea aria-label={fieldNames[name]} aria-required={requireClinical && ["chiefComplaint", "findings"].includes(name)} aria-invalid={Boolean(errors[name])} disabled={busy} rows={3} value={form[name]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={`${inputCls} mt-1 resize-y`} />{errors[name] && <span role="alert" className="text-xs text-brand-danger">{errors[name]}</span>}</label>)}</div>
      <section aria-label="Automatic risk preview" className="mb-5 rounded-btn border border-brand-border p-4">
        <h3 className="text-sm font-semibold">Automatic Risk Assessment</h3>
        <p className={`mt-2 text-lg font-bold ${getRiskColor(riskPreview.level)}`}>{riskLabel(riskPreview.level)}</p>
        {compactRiskFindings(riskPreview).length > 0 && <div className="mt-3"><h4 className="text-xs font-semibold text-brand-ink">Assessment Findings</h4><ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-brand-gray">{compactRiskFindings(riskPreview).map((finding) => <li key={finding}>{finding}</li>)}</ul></div>}
        {riskPreview.referralEvaluationRequired && <p role="alert" className="mt-3 text-xs font-semibold text-brand-danger">Recommended Action: Professional assessment or referral may be required.</p>}
        <p className="mt-3 text-[11px] text-brand-gray">Clinical decision support only; not a medical diagnosis.</p>
      </section>
      {canReviewRisk && <fieldset className="mb-5 rounded-btn border border-brand-border p-4">
        <legend className="px-1 text-sm font-semibold">Professional Risk Review</legend>
        <p className="mb-3 text-xs text-brand-gray">Separate from automatic screening. A licensed review requires a reason and explicit reassessment confirmation; the server authorizes and records the clinician, time and history.</p>
        <label className="flex items-start gap-2 text-xs font-medium"><input aria-label="Record a professional risk review" type="checkbox" disabled={busy} checked={Boolean(form.riskReview)} onChange={(event) => setForm((current) => ({ ...current, riskReview: event.target.checked ? { level: "", reason: "", reassessmentConfirmed: false } : undefined }))} />Record a clinically justified risk correction</label>
        {form.riskReview && <div className="mt-3 space-y-3">
          <label className="block text-xs text-brand-gray">Reviewed Risk Level<select aria-label="Reviewed Risk Level" aria-required="true" disabled={busy} value={form.riskReview.level} onChange={(event) => setForm((current) => ({ ...current, riskReview: { ...current.riskReview, level: event.target.value } }))} className={`${inputCls} mt-1`}><option value="">Select a reviewed classification...</option>{["Low", "Medium", "High"].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
          <label className="block text-xs text-brand-gray">Clinical Review Reason<textarea aria-label="Clinical Review Reason" aria-required="true" disabled={busy} rows={3} maxLength={1000} value={form.riskReview.reason} onChange={(event) => setForm((current) => ({ ...current, riskReview: { ...current.riskReview, reason: event.target.value } }))} className={`${inputCls} mt-1`} /></label>
          <label className="flex items-start gap-2 text-xs text-brand-ink"><input aria-label="Reassessment confirmed" aria-required="true" type="checkbox" disabled={busy} checked={form.riskReview.reassessmentConfirmed === true} onChange={(event) => setForm((current) => ({ ...current, riskReview: { ...current.riskReview, reassessmentConfirmed: event.target.checked } }))} />I reassessed this resident and documented why the classification should change.</label>
        </div>}
      </fieldset>}
      {errors.riskReview && <p role="alert" className="mb-4 text-xs text-brand-danger">{errors.riskReview}</p>}
      <section aria-labelledby="phn-treatment-section" className="mb-5">
        <h3 id="phn-treatment-section" className="mb-3 text-sm font-semibold">Treatment and Medication</h3>
        <MedicineSelector value={form.medications} onChange={(medications) => {
          setForm((current) => ({ ...current, medications }));
          setErrors((current) => {
            const next = { ...current };
            for (const key of Object.keys(next)) if (key === "medications" || key.startsWith("medications[")) delete next[key];
            return next;
          });
        }} errors={errors} disabled={busy} />
      </section>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">{["followUpRequired", "referralRequired"].map((name) => <label key={name} className="text-xs font-medium text-brand-gray">{name === "followUpRequired" ? "Follow-up Required" : "Referral Required"}<select aria-label={name === "followUpRequired" ? "Follow-up Required" : "Referral Required"} disabled={busy} value={form[name]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={`${inputCls} mt-1`}><option>No</option><option>Yes</option></select></label>)}{field("nextVisitDate", "date")}</div>
    </Modal>}
    {viewing && <Modal title="Persisted Clinical Record" onClose={() => setViewing(null)}>
      {(() => {
        const followUp = consultationFollowUp(viewing);
        const referrals = Array.isArray(viewing.referrals) ? viewing.referrals : [];
        const referral = referrals[0] || viewing.referral || null;
        return (
          <div className="space-y-5">
            <section aria-label="Consultation overview" className="rounded-btn border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-ink">Consultation Overview</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <div><dt className="text-xs font-medium text-brand-gray">Resident</dt><dd className="mt-1 text-sm">{viewing.resident?.name || "Not recorded"}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray">Resident ID</dt><dd className="mt-1 break-words text-sm">{viewing.resident?.id || viewing.residentId || "Not recorded"}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray">Encounter Date</dt><dd className="mt-1 text-sm">{viewing.consultationDate ? formatClinicalDate(viewing.consultationDate) : "Not recorded"}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray">Encounter Time</dt><dd className="mt-1 text-sm">{viewing.consultationTime || "Not recorded"}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray">Recorded Service</dt><dd className="mt-1 text-sm">{consultationServiceName(viewing) || "Not recorded"}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray">Record Status</dt><dd className="mt-1 text-sm">{formatStatusLabel(viewing.status)}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray">Attending Personnel</dt><dd className="mt-1 text-sm">{viewing.attendingPersonnel?.fullName || viewing.recordedByName || "Not recorded"}</dd></div>
                <div><dt className="text-xs font-medium text-brand-gray">Record Timestamps</dt><dd className="mt-1 text-sm">Recorded: {viewing.recordedAt || "Not recorded"}<br />Updated: {viewing.updatedAt || "Not recorded"}</dd></div>
              </dl>
            </section>
            <section aria-label="Saved consultation risk" className="rounded-btn border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-ink">Risk Classification</h3>
              <p className="mt-2 text-lg font-bold"><span className={getRiskColor(consultationRiskLevel(viewing))}>{riskLabel(consultationRiskLevel(viewing))}</span></p>
              <p className="mt-2 whitespace-pre-wrap text-xs text-brand-gray">{consultationRiskReasons(viewing) || "No saved encounter assessment reasons recorded."}</p>
              {viewingAssessment?.review && <p className="mt-2 text-xs text-brand-gray">Professional review: {riskLabel(viewingAssessment.review.level)} · {viewingAssessment.review.reason} · Reviewer: {viewingAssessment.review.reviewedBy || "Not recorded"} · {viewingAssessment.review.reviewedAt || "Not recorded"}</p>}
            </section>
            <section aria-label="Recorded vital signs" className="rounded-btn border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-ink">Vital Signs</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{vitalFields.map((name) => <div key={name}><dt className="text-xs text-brand-gray">{fieldNames[name]}</dt><dd className="mt-1 text-sm font-medium">{viewingForm[name] || "Not recorded"}</dd></div>)}
                <div><dt className="text-xs text-brand-gray">{fieldNames.bmi}</dt><dd className="mt-1 text-sm font-medium">{viewing.vitals?.bmi ?? calculateConsultationBmi(viewingForm.height, viewingForm.weight) ?? "Not recorded"}</dd></div>
              </dl>
            </section>
            <section aria-label="Clinical findings" className="rounded-btn border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-ink">Clinical Findings</h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-medium text-brand-gray">Chief Complaint</p><p className="mt-1 whitespace-pre-wrap text-sm">{viewing.chiefComplaint || "Not recorded"}</p></div><div><p className="text-xs font-medium text-brand-gray">Examination Findings</p><p className="mt-1 whitespace-pre-wrap text-sm">{viewing.findings || "Not recorded"}</p></div></div>
              <div className="mt-4"><p className="text-xs font-medium text-brand-gray">Diagnosis / Assessment</p><p className="mt-1 whitespace-pre-wrap text-sm">{viewing.diagnosis || "Not recorded"}</p></div>
            </section>
            <section aria-label="Prescribed medications" className="rounded-btn border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-ink">Prescriptions</h3>
              {(viewing.medications || []).length > 0 ? <div className="mt-3 space-y-3">{viewing.medications.map((medication, index) => <article key={index} className="border-t border-brand-border pt-3 first:border-0 first:pt-0"><p className="break-words text-sm font-semibold">{medication.genericName || medication.brandName || "Medication not named"}</p><p className="mt-1 text-xs text-brand-gray">{[medication.strength, medication.dosageForm].filter(Boolean).join(" · ") || "Strength/form not recorded"}</p><dl className="mt-2 grid gap-2 sm:grid-cols-3"><div><dt className="text-xs text-brand-gray">Route</dt><dd className="text-sm">{medication.route || "Not recorded"}</dd></div><div><dt className="text-xs text-brand-gray">Frequency</dt><dd className="text-sm">{medication.frequency || "Not recorded"}</dd></div><div><dt className="text-xs text-brand-gray">Duration</dt><dd className="text-sm">{medication.duration || "Not recorded"}</dd></div><div><dt className="text-xs text-brand-gray">Quantity</dt><dd className="text-sm">{medication.quantity || "Not recorded"}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-brand-gray">Instructions</dt><dd className="whitespace-pre-wrap text-sm">{medication.instructions || "Not recorded"}</dd></div></dl></article>)}</div> : <p className="mt-2 text-sm text-brand-gray">No medications prescribed.</p>}
            </section>
            <section aria-label="Follow-up information" className="rounded-btn border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-ink">Follow-up Information</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-brand-gray">Follow-up Required</dt><dd className="mt-1 text-sm">{followUp.has ? "Yes" : "No"}</dd></div><div><dt className="text-xs text-brand-gray">Scheduled Date</dt><dd className="mt-1 text-sm">{followUp.date ? formatClinicalDate(followUp.date) : "Not scheduled"}</dd></div><div><dt className="text-xs text-brand-gray">Status</dt><dd className="mt-1 text-sm">{followUp.status || "Not recorded"}</dd></div></dl>
            </section>
            <section aria-label="Referral information" className="rounded-btn border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-ink">Referral Information</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-brand-gray">Referral Required</dt><dd className="mt-1 text-sm">{viewing.referralRequired === "Yes" || viewing.referral_required === true || referral ? "Yes" : "No"}</dd></div><div><dt className="text-xs text-brand-gray">Referral Status</dt><dd className="mt-1 text-sm">{referral?.status || referral?.referralStatus || "Not recorded"}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-brand-gray">Referral Details</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{referral?.reason || referral?.notes || referral?.destinationFacilityName || (referral ? "Referral record available" : "No referral information recorded.")}</dd></div></dl>
            </section>
          </div>
        );
      })()}
      <LabResultsPanel residentId={viewing.resident?.id || viewing.residentId} consultationId={viewing.offline ? undefined : viewing.id} compact />
      {patientsByVisit.has(String(viewing.id)) && <button onClick={() => { setCheckup(patientsByVisit.get(String(viewing.id))); setViewing(null); }} className="mt-4 rounded-btn bg-brand-blue px-4 py-2 text-sm text-white">Open Linked PHN Check-up</button>}
    </Modal>}
    {policy && <Modal title="Clinical Record Retention" onClose={() => setPolicy(false)}><p className="text-sm text-brand-gray">Clinical records cannot be deleted from this page. Corrections must be saved against the existing server visit so the recorded history is retained. No record has been removed.</p></Modal>}
    {pendingView && <Modal title="Retained Pending Clinical Work" onClose={() => setPendingView(null)}><p className="mb-4 text-sm text-brand-gray">Status: {pendingView.status}. This owner-scoped encrypted draft is read-only here and has not been counted as a server health record. Retry uses its original operation ID.</p><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(pendingView.data, null, 2)}</pre></Modal>}
    {checkup && <PhnCheckupWorkbench patient={checkup} onClose={() => setCheckup(null)} onComplete={handleCompleteCheckup} />}
  </>;
}
