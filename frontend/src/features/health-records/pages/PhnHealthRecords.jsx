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
import { followUpsApi } from "@/services/api";
import { captureOwnerGuard } from "@/services/offline/db";
import { saveConsultationOffline, listConsultationsOffline, listConsultationResidentsOffline, submitConsultationDraft, restoreConsultationDraft } from "@/services/offline/consultationOfflineService";
import { loadServerRows } from "@/lib/serverRows";
import { formatClinicalDate } from "@/lib/dateUtils";
import { normalizeResident } from "../lib/tclData";
import { clinicalPayload, clinicalErrors, consultationForm, requireServerConsultation } from "../lib/phnRecords";
import { filterRowsByScope } from "@/lib/phnScope";
import { manilaDateKey, followUpNeedsAttention, isHighRiskResident } from "@/lib/phnDashboard";
import PhnCheckupWorkbench from "@/features/consultations/components/PhnCheckupWorkbench";
import { Search, Plus, Eye, Edit2, Trash2, X, ClipboardCheck, MoreVertical } from "lucide-react";
import { formatStatusLabel, getStatusColor, formatRiskLabel, getRiskColor } from "@/lib/statusFormatter";
import TablePagination from "@/components/tables/TablePagination";

const inputCls = "w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue focus:border-2";
const fieldNames = {
  consultationDate: "Encounter Date", consultationTime: "Encounter Time", chiefComplaint: "Chief Complaint", findings: "Examination Findings", diagnosis: "Diagnosis / Assessment", treatmentGiven: "Treatment Given", medicationPrescribed: "Medication Notes", adviceGiven: "Advice / Recommendations", remarks: "Clinical History / Remarks", bloodPressure: "Blood Pressure", temperature: "Temperature (C)", pulseRate: "Pulse Rate", respiratoryRate: "Respiratory Rate", height: "Height (cm)", weight: "Weight (kg)", oxygenSaturation: "Oxygen Saturation (%)", nextVisitDate: "Next Visit Date",
};
const vitalFields = ["bloodPressure", "temperature", "pulseRate", "respiratoryRate", "height", "weight", "oxygenSaturation"];
const textFields = ["chiefComplaint", "findings", "diagnosis", "treatmentGiven", "medicationPrescribed", "adviceGiven", "remarks"];
const medicationFields = ["genericName", "strength", "dose", "frequency", "duration", "quantity", "instructions"];

function Modal({ title, onClose, busy = false, children }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><Card role="dialog" aria-modal="true" className="w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 sm:p-7"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-brand-ink">{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-brand-gray disabled:opacity-40"><X className="h-5 w-5" /></button></div>{children}</Card></div>;
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
  const registry = resource.data?.residents || [];
  const residentById = useMemo(() => new Map(registry.map((resident) => [String(resident.id), resident])), [registry]);
  const records = useMemo(() => filterRowsByScope((resource.data?.consultations || []).map((record) => ({ ...record, barangay: record.resident?.barangay || "", consultationLocation: record.facilityName || "" })), user, coverage), [resource.data, user, coverage]);
  const patientsByVisit = useMemo(() => new Map((queue.patients || []).filter((patient) => patient.source !== "submitted").map((patient) => [String(patient.id), patient])), [queue.patients]);
  const selectedResident = residentById.get(String(form.residentId)) || original?.resident || null;
  const filtered = records.filter((record) => (status === "All" || record.status === status) && `${record.resident?.name || ""} ${record.diagnosis || ""} ${record.id}`.toLowerCase().includes(query.toLowerCase()));
  const pageRecords = filtered.slice((recordsPage - 1) * recordsPageSize, recordsPage * recordsPageSize);
  const statuses = [...new Set(records.map((record) => record.status).filter(Boolean))];
  useEffect(() => { setRecordsPage(1); }, [query, status]);
  useEffect(() => { setRecordsPage((page) => Math.min(page, Math.max(1, Math.ceil(filtered.length / recordsPageSize)))); }, [filtered.length, recordsPageSize]);
  
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
  useEffect(() => { setEditor(null); setOriginal(null); setViewing(null); setPendingView(null); setPolicy(false); setCheckup(null); setForm(consultationForm()); setFailure(""); setNotice(null); setQuery(""); }, [user?.id]);

  const openRecord = async (record, edit) => {
    if (busy) return;
    if (!online && edit) { setNotice({ error: true, message: "Clinical edits require a fresh server record and an online confirmed update. Cached history has not been changed." }); return; }
    const guard = captureOwnerGuard(user.id);
    setBusy(true); setFailure(""); setNotice(null);
    try {
      const full = requireServerConsultation(online ? await api.get(`/consultations/${record.id}`, { ownerId: user.id }) : { consultation: record }, record.id);
      if (!guard()) return;
      if (edit) { setOriginal(full); setForm(consultationForm(full)); setErrors({}); setEditor("edit"); }
      else setViewing(full);
    } catch (error) { if (guard()) setNotice({ error: true, message: error?.message || "Could not load the complete consultation." }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (busy || !user?.id) return;
    const payload = clinicalPayload(form, original);
    const validation = clinicalErrors(payload);
    if (!residentById.has(String(payload.residentId)) && payload.residentId !== String(original?.resident?.id || "")) validation.residentId = "Select a resident from the authorized registry.";
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
    } catch (error) { if (guard()) setFailure(error?.message || "The consultation could not be saved. No local clinical record was changed."); }
    finally { setBusy(false); }
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
    finally { setBusy(false); }
  };
  const field = (name, type = "text") => <label key={name} className="block text-xs font-medium text-brand-gray">{fieldNames[name]}<input type={type} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} className={`${inputCls} mt-1`} />{errors[name] && <span className="mt-1 block text-xs text-brand-danger">{errors[name]}</span>}</label>;

  return <>
    <PageHeader crumbs={["Clinical Care", "Health Records"]} title="Health Records" subtitle="Persisted consultations and clinical history within your authorized coverage." action={<button disabled={busy || resource.loading || Boolean(resource.error)} onClick={() => { setOriginal(null); setForm(consultationForm()); setErrors({}); setFailure(""); setEditor("new"); }} className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm text-white disabled:opacity-50"><Plus className="h-4 w-4" /> New Clinical Record</button>} />
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
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-25364a" style={{ width: '11%', minWidth: '90px' }}>Program</th>
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
                  const riskLevel = record.riskLevel || "low";
                  const isMenuOpen = openMenuId === record.id;
                  
                  return (
                    <tr key={record.id}>
                      <td className="align-middle" style={{ width: '24%' }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-e2e8f0 text-sm font-semibold text-25364a">
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
                        <p className="truncate">{record.program || record.serviceName || "General"}</p>
                      </td>
                      <td className="align-middle text-sm text-brand-ink" style={{ width: '13%' }}>
                        <p>{record.consultationDate ? formatClinicalDate(record.consultationDate) : "Not recorded"}</p>
                        {record.consultationTime && <p className="text-xs text-brand-gray">{record.consultationTime}</p>}
                      </td>
                      <td className="align-middle" style={{ width: '9%' }}>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium gap-1.5 whitespace-nowrap ${getRiskColor(riskLevel)}`}>
                          <span aria-hidden="true" className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-current opacity-60" />
                          {formatRiskLabel(riskLevel)}
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
      <label className="mb-4 block text-sm font-medium">Resident Registry Record<select disabled={editor === "edit" || busy} value={form.residentId} onChange={(event) => setForm({ ...form, residentId: event.target.value })} className={`${inputCls} mt-1`}><option value="">Select an authorized resident...</option>{registry.map((resident) => <option key={resident.id} value={resident.id}>{resident.name || "Name not recorded"} · {resident.barangay || "Barangay not recorded"} · {String(resident.id).slice(-8)}</option>)}{original?.resident && !residentById.has(String(original.resident.id)) && <option value={original.resident.id}>{original.resident.name} · Saved resident ID</option>}</select>{errors.residentId && <span className="text-xs text-brand-danger">{errors.residentId}</span>}</label>
      {selectedResident && <p className="mb-4 rounded-btn bg-brand-bg p-3 text-xs text-brand-gray">Resident ID: {selectedResident.id} · Age: {selectedResident.age ?? "Not recorded"} · Sex: {selectedResident.gender || selectedResident.sex || "Not recorded"} · Barangay: {selectedResident.barangay || "Not recorded"}. Demographics are maintained in the resident registry.</p>}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">{field("consultationDate", "date")}{field("consultationTime", "time")}</div>
      <h3 className="mb-3 text-sm font-semibold">Recorded Vitals</h3><div className="mb-5 grid gap-3 sm:grid-cols-3">{vitalFields.map((name) => field(name, name === "bloodPressure" ? "text" : "number"))}</div>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">{textFields.map((name) => <label key={name} className="text-xs font-medium text-brand-gray">{fieldNames[name]}<textarea rows={3} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} className={`${inputCls} mt-1 resize-y`} />{errors[name] && <span className="text-xs text-brand-danger">{errors[name]}</span>}</label>)}</div>
      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">Structured Prescriptions</h3><button type="button" onClick={() => setForm({ ...form, medications: [...form.medications, { genericName: "", custom: true, source: "custom" }] })} className="text-xs font-medium text-brand-blue">Add Recorded Medication</button></div>
      {form.medications.map((medication, index) => <div key={index} className="mb-3 rounded-btn border border-brand-border p-3"><div className="grid gap-3 sm:grid-cols-3">{medicationFields.map((name) => <label key={name} className="text-xs capitalize text-brand-gray">{name}<input readOnly={name === "genericName" && Boolean(medication.medicineId || medication.medicine_id)} value={medication[name] ?? ""} onChange={(event) => setForm({ ...form, medications: form.medications.map((item, position) => position === index ? { ...item, [name]: event.target.value } : item) })} className={`${inputCls} mt-1`} /></label>)}</div><button type="button" onClick={() => setForm({ ...form, medications: form.medications.filter((_, position) => position !== index) })} className="mt-2 text-xs text-brand-danger">Remove From Current Prescription</button></div>)}{errors.medications && <p className="text-xs text-brand-danger">{errors.medications}</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">{["followUpRequired", "referralRequired"].map((name) => <label key={name} className="text-xs font-medium text-brand-gray">{name === "followUpRequired" ? "Follow-up Required" : "Referral Required"}<select value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} className={`${inputCls} mt-1`}><option>No</option><option>Yes</option></select></label>)}{field("nextVisitDate", "date")}</div>
      <p className="mt-4 text-xs text-brand-gray">The original recorded timestamp, server status and additional clinical detail JSON are preserved on edit. Referral-required is a clinical flag; recipient routing is completed through the referral workflow.</p>
      <div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => setEditor(null)} className="rounded-btn border border-brand-border px-4 py-2 text-sm">Cancel</button><button disabled={busy} onClick={save} className="rounded-btn bg-brand-blue px-5 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving..." : "Save Clinical Record"}</button></div>
    </Modal>}
    {viewing && <Modal title="Persisted Clinical Record" onClose={() => setViewing(null)}>
      <p className="mb-4 text-xs text-brand-gray">Server visit: {viewing.id} · Resident: {viewing.resident?.name || viewing.resident?.id} · Encounter: {viewing.consultationDate} {viewing.consultationTime} · Status: {viewing.status}</p>
      <div className="grid gap-4 sm:grid-cols-2">{textFields.map((name) => <div key={name}><p className="text-xs font-medium text-brand-gray">{fieldNames[name]}</p><p className="mt-1 whitespace-pre-wrap text-sm">{viewing[name] || "Not recorded"}</p></div>)}</div>
      <h3 className="mt-6 mb-3 text-sm font-semibold">Recorded Vitals and Prescriptions</h3><div className="grid gap-3 sm:grid-cols-3">{vitalFields.map((name) => <div key={name}><p className="text-xs text-brand-gray">{fieldNames[name]}</p><p className="text-sm">{consultationForm(viewing)[name] || "Not recorded"}</p></div>)}</div>
      <div className="mt-4 space-y-2">{(viewing.medications || []).map((medication, index) => <p key={index} className="rounded-btn border border-brand-border p-3 text-sm">{Object.entries(medication).filter(([name, item]) => !["medicineId", "custom", "source"].includes(name) && item !== null && item !== "").map(([name, item]) => `${name}: ${String(item)}`).join(" · ")}</p>)}</div>
      <h3 className="mt-6 mb-3 text-sm font-semibold">Clinical History / Workflow</h3><p className="text-xs text-brand-gray">Originally recorded: {viewing.recordedAt || "Not recorded"} · Last server update: {viewing.updatedAt || "Not recorded"} · Attending personnel: {viewing.attendingPersonnel?.fullName || "Not recorded"}</p>
      {viewing.consultationDetails && <details className="mt-3 rounded-btn border border-brand-border p-3"><summary className="cursor-pointer text-sm font-medium">Full Retained Clinical Details</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(viewing.consultationDetails, null, 2)}</pre></details>}
      {patientsByVisit.has(String(viewing.id)) && <button onClick={() => { setCheckup(patientsByVisit.get(String(viewing.id))); setViewing(null); }} className="mt-4 rounded-btn bg-brand-blue px-4 py-2 text-sm text-white">Open Linked PHN Check-up</button>}
    </Modal>}
    {policy && <Modal title="Clinical Record Retention" onClose={() => setPolicy(false)}><p className="text-sm text-brand-gray">Clinical records cannot be deleted from this page. Corrections must be saved against the existing server visit so the recorded history is retained. No record has been removed.</p></Modal>}
    {pendingView && <Modal title="Retained Pending Clinical Work" onClose={() => setPendingView(null)}><p className="mb-4 text-sm text-brand-gray">Status: {pendingView.status}. This owner-scoped encrypted draft is read-only here and has not been counted as a server health record. Retry uses its original operation ID.</p><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(pendingView.data, null, 2)}</pre></Modal>}
    {checkup && <PhnCheckupWorkbench patient={checkup} patientId={checkup.id} onClose={() => setCheckup(null)} onSaved={() => { setCheckup(null); void resource.refresh(); void queue.refresh(); }} />}
  </>;
}
