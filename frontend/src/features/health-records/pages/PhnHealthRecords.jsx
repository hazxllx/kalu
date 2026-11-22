import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
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
import { Search, Plus, Eye, Edit2, Trash2, X, ClipboardCheck, MoreVertical } from "lucide-react";
import { formatStatusLabel, getStatusColor, getRiskColor } from "@/lib/statusFormatter";
import TablePagination from "@/components/tables/TablePagination";
import LabResultsPanel from "@/features/health-records/components/LabResultsPanel";
import { consultationAssessment, consultationRiskLevel, consultationServiceName, consultationRiskReasons } from "@/features/consultations/lib/consultationRisk";
import { validateConsultationDateTime, calculateConsultationBmi, assessConsultationRisk } from "../../../../../shared/consultationClinical.js";

const inputCls = "w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue focus:border-2";
const fieldNames = {
  consultationDate: "Encounter Date", consultationTime: "Encounter Time", chiefComplaint: "Chief Complaint", findings: "Examination Findings", diagnosis: "Diagnosis / Assessment", treatmentGiven: "Treatment Given", medicationPrescribed: "Medication Notes", adviceGiven: "Advice / Recommendations", remarks: "Clinical History / Remarks", bloodPressure: "Blood Pressure", temperature: "Temperature (C)", pulseRate: "Pulse Rate", respiratoryRate: "Respiratory Rate", height: "Height (cm)", weight: "Weight (kg)", bmi: "BMI (kg/m2)", oxygenSaturation: "Oxygen Saturation (%)", nextVisitDate: "Next Visit Date",
};
const vitalFields = ["bloodPressure", "temperature", "pulseRate", "respiratoryRate", "height", "weight", "oxygenSaturation"];
const textFields = ["chiefComplaint", "findings", "diagnosis", "treatmentGiven", "medicationPrescribed", "adviceGiven", "remarks"];
const riskLabel = (level) => level === "Moderate" ? "Medium" : level || "Unassessed";
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

function Modal({ title, onClose, busy = false, children }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><Card role="dialog" aria-label={title} aria-modal="true" className="w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 sm:p-7"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-brand-ink">{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-brand-gray disabled:opacity-40"><X className="h-5 w-5" /></button></div>{children}</Card></div>;
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
    if (!modalOpen && !openMenuId) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [modalOpen, openMenuId]);
  useEffect(() => { setEditor(null); setOriginal(null); setViewing(null); setPendingView(null); setPolicy(false); setCheckup(null); setForm(consultationForm()); setContextState(null); setErrors({}); setFailure(""); setBusy(false); setNotice(null); setQuery(""); }, [user?.id]);

  const openRecord = async (record, edit) => {
    if (busy) return;
    if (!online && edit) { setNotice({ error: true, message: "Clinical edits require a fresh server record and an online confirmed update. Cached history has not been changed." }); return; }
    const guard = captureOwnerGuard(user.id);
    setBusy(true); setFailure(""); setNotice(null);
    try {
      const full = requireServerConsultation(online ? await api.get(`/consultations/${record.id}`, { ownerId: user.id }) : { consultation: record }, record.id);
      if (!guard()) return;
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
  const field = (name, type = "text") => <label key={name} className="block text-xs font-medium text-brand-gray">{fieldNames[name]}{requireClinical && (vitalFields.includes(name) || name === "consultationDate" || name === "consultationTime") && " *"}<input type={type} step={type === "number" ? "any" : undefined} disabled={busy} aria-label={fieldNames[name]} aria-required={requireClinical && (vitalFields.includes(name) || name === "consultationDate" || name === "consultationTime")} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `phn-${name}-error` : undefined} value={form[name]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={`${inputCls} mt-1`} />{errors[name] && <span id={`phn-${name}-error`} role="alert" className="mt-1 block text-xs text-brand-danger">{errors[name]}</span>}</label>;

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
          <div className="overflow-x-auto">
            <table className="clinical-table w-full text-left text-sm border-collapse">
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
                  const isMenuOpen = openMenuId === record.id;
                  
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
                        <button
                          disabled={busy}
                          onClick={() => setOpenMenuId(isMenuOpen ? null : record.id)}
                          className="clinical-action inline-flex items-center justify-center disabled:opacity-50"
                          title="Actions"
                          type="button"
                        >
                          <MoreVertical className="h-4 w-4 text-718096" />
                        </button>
                        {isMenuOpen && (
                          <>
                            <div 
                              className="fixed inset-0 z-30" 
                              onClick={() => setOpenMenuId(null)}
                            />
                            <div className="absolute z-40 min-w-[160px] rounded border border-e2e8f0 bg-white shadow-md py-1" 
                              style={{
                                top: '100%',
                                right: 0,
                                marginTop: '0.5rem',
                              }}
                            >
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  openRecord(record, false);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-25364a hover:bg-f5f8fc disabled:opacity-50 transition-colors text-left"
                              >
                                <Eye className="h-4 w-4 flex-shrink-0 text-315f91" />
                                <span>View Record</span>
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  openRecord(record, true);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-25364a hover:bg-f5f8fc disabled:opacity-50 transition-colors text-left"
                              >
                                <Edit2 className="h-4 w-4 flex-shrink-0 text-315f91" />
                                <span>Edit Record</span>
                              </button>
                              {patientsByVisit.has(String(record.id)) && (
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setCheckup(patientsByVisit.get(String(record.id)));
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-25364a hover:bg-f5f8fc transition-colors text-left"
                                  type="button"
                                >
                                  <ClipboardCheck className="h-4 w-4 flex-shrink-0 text-16a34a" />
                                  <span>Open PHN Workflow</span>
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setPolicy(true);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-718096 hover:bg-f5f8fc transition-colors text-left"
                                type="button"
                              >
                                <Trash2 className="h-4 w-4 flex-shrink-0" />
                                <span>Deletion Policy</span>
                              </button>
                            </div>
                          </>
                        )}
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
    {editor && <Modal title={editor === "edit" ? "Edit Persisted Consultation" : "New Clinical Consultation"} onClose={() => setEditor(null)} busy={busy}>
      {failure && <p role="alert" className="mb-4 text-sm text-brand-danger">{failure}</p>}
      <label className="mb-4 block text-sm font-medium">Resident Registry Record<select aria-label="Resident Registry Record" disabled={editor === "edit" || busy} value={form.residentId} onChange={(event) => setForm((current) => ({ ...current, residentId: event.target.value, clinicalContext: { pregnancyStatus: "unknown", existingConditions: [] }, clinicalIndicators: { dangerSignsReviewed: false }, maternal: null }))} className={`${inputCls} mt-1`}><option value="">Select an authorized resident...</option>{registry.map((resident) => <option key={resident.id} value={resident.id}>{resident.name || "Name not recorded"} · {resident.barangay || "Barangay not recorded"} · {String(resident.id).slice(-8)}</option>)}{original && form.residentId && !residentById.has(form.residentId) && <option value={form.residentId}>{original.resident?.name || "Saved resident record"} · Saved resident ID: {form.residentId}</option>}</select>{errors.residentId && <span role="alert" className="text-xs text-brand-danger">{errors.residentId}</span>}</label>
      {selectedResident && <p className="mb-4 rounded-btn bg-brand-bg p-3 text-xs text-brand-gray">Resident ID: {selectedResident.id} · Age: {selectedResident.age ?? "Not recorded"} · Sex: {selectedResident.gender || selectedResident.sex || "Not recorded"} · Barangay: {selectedResident.barangay || "Not recorded"}. Demographics are maintained in the resident registry.</p>}
      {original && <p className="mb-4 text-xs text-brand-gray">Recorded service: {consultationServiceName(original) || "Not recorded"}. The saved service association and maternal care snapshot are retained.</p>}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">{field("consultationDate", "date")}{field("consultationTime", "time")}</div>
      <h3 className="mb-2 text-sm font-semibold">Recorded Vitals</h3>
      <p className="mb-3 text-xs text-brand-gray">All 8 vital fields, including calculated BMI, are required for a new record or clinical correction. Metadata-only edits retain partial historical measurements.</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {vitalFields.map((name) => field(name, name === "bloodPressure" ? "text" : "number"))}
        <label className="block text-xs font-medium text-brand-gray">{fieldNames.bmi}{requireClinical && " *"}<input aria-label="BMI" aria-required={requireClinical} aria-invalid={Boolean(errors.bmi)} readOnly value={bmi === null ? "" : bmi.toFixed(1)} className={`${inputCls} mt-1 bg-brand-bg`} /><span className="mt-1 block text-xs">Calculated from measured height and weight.</span>{errors.bmi && <span role="alert" className="mt-1 block text-xs text-brand-danger">{errors.bmi}</span>}</label>
      </div>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">{textFields.map((name) => <label key={name} className="text-xs font-medium text-brand-gray">{fieldNames[name]}{requireClinical && ["chiefComplaint", "findings"].includes(name) && " *"}<textarea aria-label={fieldNames[name]} aria-required={requireClinical && ["chiefComplaint", "findings"].includes(name)} aria-invalid={Boolean(errors[name])} disabled={busy} rows={3} value={form[name]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={`${inputCls} mt-1 resize-y`} />{errors[name] && <span role="alert" className="text-xs text-brand-danger">{errors[name]}</span>}</label>)}</div>
      <section aria-label="Consultation clinical context" className="mb-5 rounded-btn border border-brand-border p-4">
        <h3 className="text-sm font-semibold">Clinical Context and Danger Signs</h3>
        <p role="status" className="mt-2 text-xs text-brand-gray">{!online ? "Offline: clinical sources cannot be verified; risk is not assumed Low."
          : contextLoading ? "Loading resident clinical sources for this encounter date..."
            : clinicalContext ? `Clinical source status: ${clinicalContext.sourceStatus}. Source records are reconciled again by the server on save.`
              : scopedContextState?.error || "Select a resident and valid encounter date to load clinical sources. No absence of pregnancy or conditions has been assumed."}</p>
        {online && scopedContextState?.error && <button type="button" disabled={busy || contextLoading} onClick={() => setContextRetry((current) => current + 1)} className="mt-2 text-xs font-medium text-brand-blue">Retry Clinical Context</button>}
        {clinicalContext?.pregnancy && <p className="mt-2 text-xs text-brand-gray">Recorded maternal context: {clinicalContext.pregnancy.isPregnant ? "Pregnant" : clinicalContext.pregnancy.isPostpartum ? "Postpartum" : "Recorded episode"}. An entered status cannot silently dismiss a recorded maternal episode.</p>}
        {form.maternal && <p className="mt-2 text-xs text-brand-gray">Retained maternal care: {form.maternal.careType || "Not recorded"} · Pregnancy ID: {form.maternal.pregnancyId || "Unlinked"} · LMP: {form.maternal.lmpDate || "Not recorded"} · EDD: {form.maternal.eddDate || "Not recorded"} · Gestational age: {form.maternal.gestationalAgeWeeks ?? "Not recorded"}</p>}
        <label className="mt-3 block text-xs font-medium text-brand-gray">Reported Pregnancy Status<select aria-label="Reported Pregnancy Status" disabled={busy} value={reportedStatus} onChange={(event) => setForm((current) => ({ ...current, clinicalContext: { ...current.clinicalContext, pregnancyStatus: event.target.value } }))} className={`${inputCls} mt-1`}><option value="unknown">Not yet confirmed</option><option value="not_pregnant">Not pregnant</option><option value="pregnant">Pregnant</option><option value="postpartum">Postpartum</option></select></label>
        {clinicalContext?.existingConditions.length > 0 && <div className="mt-3 text-xs text-brand-gray"><p className="font-medium">Conditions in verified source records</p><ul className="mt-1 list-disc pl-4">{clinicalContext.existingConditions.map((condition, index) => <li key={index}>{consultationCondition(condition).name} · {consultationCondition(condition).status}{condition.significant === true ? " · Significant" : ""}</li>)}</ul></div>}
        <div className="mt-4 flex items-center justify-between gap-3"><h4 className="text-xs font-semibold">Reported Existing Conditions</h4><button type="button" disabled={busy || form.clinicalContext.existingConditions.length >= 50} onClick={() => setForm((current) => ({ ...current, clinicalContext: { ...current.clinicalContext, existingConditions: [...current.clinicalContext.existingConditions, { name: "", status: "stable", significant: false }] } }))} className="text-xs font-medium text-brand-blue disabled:opacity-50">Add Condition</button></div>
        {form.clinicalContext.existingConditions.map((condition, index) => <div key={index} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
          <label className="text-xs text-brand-gray">Condition<input aria-label={`Condition ${index + 1}`} disabled={busy} maxLength={160} value={condition.name} onChange={(event) => setForm((current) => ({ ...current, clinicalContext: { ...current.clinicalContext, existingConditions: current.clinicalContext.existingConditions.map((item, position) => position === index ? { ...item, name: event.target.value } : item) } }))} className={`${inputCls} mt-1`} /></label>
          <label className="text-xs text-brand-gray">Control<select aria-label={`Condition ${index + 1} control`} disabled={busy} value={condition.status} onChange={(event) => setForm((current) => ({ ...current, clinicalContext: { ...current.clinicalContext, existingConditions: current.clinicalContext.existingConditions.map((item, position) => position === index ? { ...item, status: event.target.value } : item) } }))} className={`${inputCls} mt-1`}><option value="stable">Stable / monitored</option><option value="uncontrolled">Uncontrolled</option></select></label>
          <button type="button" aria-label={`Remove condition ${index + 1}`} disabled={busy} onClick={() => setForm((current) => ({ ...current, clinicalContext: { ...current.clinicalContext, existingConditions: current.clinicalContext.existingConditions.filter((_, position) => position !== index) } }))} className="text-xs text-brand-danger">Remove</button>
          <label className="flex items-center gap-2 text-xs text-brand-gray sm:col-span-3"><input aria-label={`Condition ${index + 1} is significant`} type="checkbox" disabled={busy} checked={condition.significant === true} onChange={(event) => setForm((current) => ({ ...current, clinicalContext: { ...current.clinicalContext, existingConditions: current.clinicalContext.existingConditions.map((item, position) => position === index ? { ...item, significant: event.target.checked } : item) } }))} />Significant clinical condition</label>
        </div>)}
        {Object.entries(errors).filter(([name]) => name.startsWith("clinicalContext") || name.startsWith("maternal")).map(([name, message]) => <p key={name} role="alert" className="mt-2 text-xs text-brand-danger">{message}</p>)}
        <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-brand-blue">Warning Signs and Monitoring Needs</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{[...generalIndicators, ...(pregnancy ? maternalIndicators : [])].map(([name, label]) => <label key={name} className="flex items-start gap-2 text-xs text-brand-ink"><input aria-label={label} type="checkbox" disabled={busy} checked={form.clinicalIndicators[name] === true} onChange={(event) => setForm((current) => ({ ...current, clinicalIndicators: { ...current.clinicalIndicators, [name]: event.target.checked } }))} />{label}</label>)}</div></details>
        <label className="mt-4 flex items-start gap-2 border-t border-brand-border pt-3 text-xs font-medium text-brand-ink"><input aria-label="Clinical history, pregnancy status and danger signs reviewed" aria-required={requireClinical} type="checkbox" disabled={busy} checked={form.clinicalIndicators.dangerSignsReviewed === true} onChange={(event) => setForm((current) => ({ ...current, clinicalIndicators: { ...current.clinicalIndicators, dangerSignsReviewed: event.target.checked } }))} />Clinical history, pregnancy status and danger signs reviewed{requireClinical && " *"}</label>
        {Object.entries(errors).filter(([name]) => name.startsWith("clinicalIndicators")).map(([name, message]) => <p key={name} role="alert" className="mt-2 text-xs text-brand-danger">{message}</p>)}
      </section>
      <section aria-label="Automatic risk preview" className="mb-5 rounded-btn border border-brand-border p-4">
        <h3 className="text-sm font-semibold">Automatic Risk Preview: <span className={getRiskColor(riskPreview.level)}>{riskLabel(riskPreview.level)}</span></h3>
        <p className="mt-2 text-xs text-brand-gray">Decision support only, not a diagnosis or an approved local protocol. The server recomputes and saves the assessment and reasons.</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-brand-gray">{riskPreview.reasons.map((reason, index) => <li key={`${reason.ruleId}-${index}`}>{reason.message}</li>)}</ul>
        {riskPreview.referralEvaluationRequired && <p role="alert" className="mt-3 text-xs font-semibold text-brand-danger">{riskPreview.urgency === "immediate" ? "Immediate professional evaluation is needed. Do not delay emergency care to complete this form." : "Prompt professional assessment or referral evaluation is needed."}</p>}
        {original && <p className="mt-3 border-t border-brand-border pt-3 text-xs text-brand-gray">Saved server classification: {riskLabel(consultationRiskLevel(original))}. {consultationRiskReasons(original) || "No saved reasons recorded."}</p>}
        {originalAssessment?.review && <p className="mt-2 text-xs text-brand-gray">Saved professional review: {riskLabel(originalAssessment.review.level)} · {originalAssessment.review.reason} · {originalAssessment.review.reviewedAt || "Not recorded"}. This saved review is retained unless a new reassessment is submitted.</p>}
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
      <h3 className="mb-3 text-sm font-semibold">Structured Prescriptions</h3>
      <MedicineSelector value={form.medications} onChange={(medications) => setForm((current) => ({ ...current, medications }))} errors={errors} disabled={busy} />
      <div className="mt-5 grid gap-4 sm:grid-cols-3">{["followUpRequired", "referralRequired"].map((name) => <label key={name} className="text-xs font-medium text-brand-gray">{name === "followUpRequired" ? "Follow-up Required" : "Referral Required"}<select aria-label={name === "followUpRequired" ? "Follow-up Required" : "Referral Required"} disabled={busy} value={form[name]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={`${inputCls} mt-1`}><option>No</option><option>Yes</option></select></label>)}{field("nextVisitDate", "date")}</div>
      <p className="mt-4 text-xs text-brand-gray">The original recorded timestamp, server status, prescriptions, maternal snapshot and clinical assessment history are preserved on edit. Diagnosis is optional and separate from required findings. Referral-required is a clinical flag; recipient routing is completed through the referral workflow.</p>
      <div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => setEditor(null)} className="rounded-btn border border-brand-border px-4 py-2 text-sm">Cancel</button><button disabled={busy || (editor === "edit" && !online)} onClick={save} className="rounded-btn bg-brand-blue px-5 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving..." : "Save Clinical Record"}</button></div>
    </Modal>}
    {viewing && <Modal title="Persisted Clinical Record" onClose={() => setViewing(null)}>
      <p className="mb-4 text-xs text-brand-gray">Server visit: {viewing.id} · Resident: {viewing.resident?.name || viewing.resident?.id} · Encounter: {viewing.consultationDate} {viewing.consultationTime} · Status: {viewing.status}</p>
      <section aria-label="Saved consultation risk" className="mb-5 rounded-btn border border-brand-border p-4"><h3 className="text-sm font-semibold">Recorded Service: {consultationServiceName(viewing) || "Not recorded"}</h3><p className="mt-2 text-sm">Saved Risk: <span className={getRiskColor(consultationRiskLevel(viewing))}>{riskLabel(consultationRiskLevel(viewing))}</span></p><p className="mt-2 text-xs text-brand-gray">{consultationRiskReasons(viewing) || "No saved encounter assessment reasons recorded."}</p>{viewingAssessment?.referralEvaluationRequired && <p className="mt-2 text-xs font-semibold text-brand-danger">Professional referral evaluation required{viewingAssessment.urgency ? `: ${viewingAssessment.urgency}` : ""}.</p>}{viewingAssessment?.review && <p className="mt-2 text-xs text-brand-gray">Professional review: {riskLabel(viewingAssessment.review.level)} · {viewingAssessment.review.reason} · Reviewer: {viewingAssessment.review.reviewedBy} · {viewingAssessment.review.reviewedAt}</p>}</section>
      <div className="grid gap-4 sm:grid-cols-2">{textFields.map((name) => <div key={name}><p className="text-xs font-medium text-brand-gray">{fieldNames[name]}</p><p className="mt-1 whitespace-pre-wrap text-sm">{viewing[name] || "Not recorded"}</p></div>)}</div>
      <h3 className="mt-6 mb-3 text-sm font-semibold">Recorded Vitals and Prescriptions</h3><div className="grid gap-3 sm:grid-cols-3">{vitalFields.map((name) => <div key={name}><p className="text-xs text-brand-gray">{fieldNames[name]}</p><p className="text-sm">{viewingForm[name] || "Not recorded"}</p></div>)}<div><p className="text-xs text-brand-gray">{fieldNames.bmi}</p><p className="text-sm">{viewing.vitals?.bmi ?? calculateConsultationBmi(viewingForm.height, viewingForm.weight) ?? "Not recorded"}</p></div></div>
      <div className="mt-4 space-y-2">{(viewing.medications || []).map((medication, index) => <p key={index} className="rounded-btn border border-brand-border p-3 text-sm">{Object.entries(medication).filter(([name, item]) => !["medicineId", "custom", "source"].includes(name) && item !== null && item !== "").map(([name, item]) => `${name}: ${String(item)}`).join(" · ")}</p>)}</div>
      <h3 className="mt-6 mb-3 text-sm font-semibold">Clinical History / Workflow</h3><p className="text-xs text-brand-gray">Originally recorded: {viewing.recordedAt || "Not recorded"} · Last server update: {viewing.updatedAt || "Not recorded"} · Attending personnel: {viewing.attendingPersonnel?.fullName || "Not recorded"}</p>
      {viewing.consultationDetails && <details className="mt-3 rounded-btn border border-brand-border p-3"><summary className="cursor-pointer text-sm font-medium">Full Retained Clinical Details</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(viewing.consultationDetails, null, 2)}</pre></details>}
      <LabResultsPanel residentId={viewing.resident?.id || viewing.residentId} consultationId={viewing.offline ? undefined : viewing.id} compact />
      {patientsByVisit.has(String(viewing.id)) && <button onClick={() => { setCheckup(patientsByVisit.get(String(viewing.id))); setViewing(null); }} className="mt-4 rounded-btn bg-brand-blue px-4 py-2 text-sm text-white">Open Linked PHN Check-up</button>}
    </Modal>}
    {policy && <Modal title="Clinical Record Retention" onClose={() => setPolicy(false)}><p className="text-sm text-brand-gray">Clinical records cannot be deleted from this page. Corrections must be saved against the existing server visit so the recorded history is retained. No record has been removed.</p></Modal>}
    {pendingView && <Modal title="Retained Pending Clinical Work" onClose={() => setPendingView(null)}><p className="mb-4 text-sm text-brand-gray">Status: {pendingView.status}. This owner-scoped encrypted draft is read-only here and has not been counted as a server health record. Retry uses its original operation ID.</p><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(pendingView.data, null, 2)}</pre></Modal>}
    {checkup && <PhnCheckupWorkbench patient={checkup} onClose={() => setCheckup(null)} onComplete={handleCompleteCheckup} />}
  </>;
}
