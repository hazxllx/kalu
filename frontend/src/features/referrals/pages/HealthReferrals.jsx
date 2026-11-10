import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import TablePagination from "@/components/tables/TablePagination";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { ROLE } from "@/lib/roles";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { referralsApi } from "@/services/api";
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
import { Plus, Eye, Edit2, RefreshCw, X, Search, Check, Download, AlertTriangle, MoreVertical } from "lucide-react";

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
const referralDisplayStatus = (status) => {
  if (["Pending", "Accepted", "In Progress"].includes(status)) return "Pending";
  return status || "Pending";
};
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

const todayIso = () => localDateKey();

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const ageFrom = (birthDate) => {
  if (!birthDate) return undefined;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
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
  referringFacility: row.referring_facility || "",
  reason: row.reason || "",
  destinationFacility: row.destination_facility || "",
  destinationService: row.destination_service || "",
  priority: row.priority || "Medium",
  status: row.status || "Pending",
  referralDate: row.referral_date || "",
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
  impression: row.impression || "",
  scheduledAt: row.scheduled_at || "",
  treatmentVisitId: row.treatment_visit_id || "",
  // Derived progress stage (set by the backend when the row is expanded).
  stage: row.stage || null,
  recipientPersonnelId: row.recipient_personnel_id || "",
  recipientFacilityId: row.recipient_facility_id || "",
  recipientRole: row.recipient_role || "",
  recipientStation: row.recipient_station || "",
  recipientName: row.recipient?.full_name || "",
  senderName: row.sender?.full_name || "",
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

const EMPTY_FORM = () => ({
  referralDate: todayIso(),
  scheduledAt: "",
  destinationFacility: "",
  recipientPersonnelId: "",
  recipientFacilityId: "",
  recipientRole: "",
  recipientStation: "",
  destinationService: "",
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
  impression: "",
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

function ReferralFormModal({ initial, draft, resident, residents, saving, onClose, onSave, onSelectResident, ownerId }) {
  const isEdit = Boolean(initial);
  const routingOnly = isEdit && initial.status !== "Pending";
  const [form, setForm] = useState(/** @type {() => Record<string, any>} */ (() => {
    if (initial) {
      return {
        referralDate: initial.referralDate || todayIso(),
        scheduledAt: toLocalDateTimeInput(initial.scheduledAt),
        destinationFacility: initial.destinationFacility || "",
        recipientPersonnelId: initial.recipientPersonnelId || "",
        recipientFacilityId: initial.recipientFacilityId || "",
        recipientRole: initial.recipientRole || "",
        recipientStation: initial.recipientStation || "",
        destinationService: initial.destinationService || "",
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
        impression: initial.impression || "",
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
        chiefComplaints: draft.chiefComplaints || draft.chiefComplaint || "",
        medicalHistory: draft.medicalHistory || draft.clinicalHistory || "",
        physicalExamFindings: draft.physicalExamFindings || draft.findings || "",
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
  const residentId = initial?.residentId || resident?.id;
  useEffect(() => {
    let active = true;
    setRoutes([]);
    setRoutesError("");
    setRoutesLoading(true);
    if (!residentId) { setRoutesLoading(false); return () => { active = false; }; }
    referralsApi.recipients({ residentId }, { ownerId }).then((response) => {
      if (active) setRoutes(response?.rows || []);
    }).catch((error) => {
      if (active) setRoutesError(error?.message || "Could not load authorized recipients.");
    }).finally(() => { if (active) setRoutesLoading(false); });
    return () => { active = false; };
  }, [residentId, ownerId, routeRetry]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);
  const buildErrors = (now = new Date()) => ({
    ...(!routingOnly ? referralDateErrors(form, {
      now,
      originalScheduledAt: isEdit ? toLocalDateTimeInput(initial.scheduledAt) : null,
    }) : {}),
    ...(!isEdit && !resident ? { resident: "Please select a resident." } : {}),
    ...(!form.reason.trim() ? { reason: "Referral reason is required." } : {}),
    ...(!selectedReferralRoute(routes, form) ? { recipient: "Select a current receiving facility, role and recipient." } : {}),
    ...(form.laboratoryTestRequired && !form.laboratoryTest.trim()
      ? { laboratoryTest: "Laboratory test details are required when laboratory test is marked as required." }
      : {}),
  });
  const liveErrors = buildErrors(now);
  const facilities = [...new Map(routes.map((route) => [route.facility_id, route.facility_name])).entries()];
  const roles = [...new Set(routes.filter((route) => route.facility_id === form.recipientFacilityId).map((route) => route.role))];
  const recipients = routes.filter((route) => route.facility_id === form.recipientFacilityId && route.role === form.recipientRole);
  const chosenRoute = selectedReferralRoute(routes, form);
  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = buildErrors(new Date());
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{routingOnly ? "Reassign Referral" : isEdit ? "Edit Referral" : "New Referral"}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">{routingOnly ? "The new recipient must accept again. Clinical details and history are retained." : "Route this referral to an authorized person at a registered receiving facility."}</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          <div className="space-y-4">
            {isEdit ? (
              <div className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Resident</p>
                <p className="mt-0.5 text-sm font-medium text-brand-ink">{initial.residentName}</p>
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium text-brand-ink">Resident <span className="text-brand-danger">*</span></label>
                <div className="mt-1.5">
                  <ResidentSearchSelect residents={residents} value={resident} onChange={onSelectResident} />
                </div>
                {liveErrors.resident && <p className="mt-1 text-xs text-brand-danger">{liveErrors.resident}</p>}
              </div>
            )}

            <div className="space-y-3 rounded-btn border border-brand-border p-4">
              <h4 className="text-sm font-semibold text-brand-ink">Receiving Assignment</h4>
              {routesLoading ? <p className="text-sm text-brand-gray">Loading authorized recipients...</p> : routesError ? (
                <div role="alert" className="text-sm text-brand-danger">{routesError} <button type="button" onClick={() => setRouteRetry((value) => value + 1)} className="underline">Retry</button></div>
              ) : routes.length === 0 && residentId ? <p className="text-sm text-brand-gray">No active authorized recipient is configured for this resident. Facility and personnel assignments must be completed first.</p> : null}
              <div>
                <label className="text-sm font-medium text-brand-ink">Receiving Facility <span className="text-brand-danger">*</span></label>
                <select disabled={routesLoading || !residentId} value={form.recipientFacilityId} onChange={(event) => {
                  const id = event.target.value;
                  setForm((prior) => ({ ...prior, recipientFacilityId: id, destinationFacility: facilities.find(([key]) => key === id)?.[1] || "", recipientRole: "", recipientPersonnelId: "", recipientStation: "" }));
                }} className={`${inputCls(liveErrors.recipient)} cursor-pointer`}>
                  <option value="">Select receiving facility</option>
                  {facilities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Receiving Role <span className="text-brand-danger">*</span></label>
                <select disabled={!form.recipientFacilityId || routesLoading} value={form.recipientRole} onChange={(event) => setForm((prior) => ({ ...prior, recipientRole: event.target.value, recipientPersonnelId: "", recipientStation: "" }))} className={`${inputCls()} cursor-pointer`}>
                  <option value="">Select role</option>
                  {roles.map((role) => <option key={role} value={role}>{referralRoleLabel(role)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Assigned Recipient <span className="text-brand-danger">*</span></label>
                <select disabled={!form.recipientRole || routesLoading} value={chosenRoute ? referralRouteKey(chosenRoute) : ""} onChange={(event) => {
                  const route = recipients.find((entry) => referralRouteKey(entry) === event.target.value);
                  setForm((prior) => ({ ...prior, recipientPersonnelId: route?.id || "", recipientStation: route?.station || "" }));
                }} className={`${inputCls(liveErrors.recipient)} cursor-pointer`}>
                  <option value="">Select recipient</option>
                  {recipients.map((route) => <option key={referralRouteKey(route)} value={referralRouteKey(route)}>{route.name}{route.station ? ` (${route.station})` : ""}</option>)}
                </select>
                {liveErrors.recipient && <p className="mt-1 text-xs text-brand-danger">{liveErrors.recipient}</p>}
              </div>
            </div>

            <fieldset disabled={routingOnly} className="space-y-4 disabled:opacity-70">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-brand-ink">Referral Date</label>
                <input type="date" max={todayIso()} value={form.referralDate} onChange={(e) => set("referralDate")(e.target.value)} className={inputCls(liveErrors.referralDate)} />
                {liveErrors.referralDate && <p className="mt-1 text-xs text-brand-danger">{liveErrors.referralDate}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Scheduled Date &amp; Time</label>
                <input type="datetime-local" min={referralDateTimeMinimum()} value={form.scheduledAt} onChange={(e) => set("scheduledAt")(e.target.value)} className={inputCls(liveErrors.scheduledAt)} />
                {liveErrors.scheduledAt && <p className="mt-1 text-xs text-brand-danger">{liveErrors.scheduledAt}</p>}
              </div>
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
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-brand-ink">Referring Facility</label>
                <input type="text" value={form.referringFacility} onChange={(e) => set("referringFacility")(e.target.value)} placeholder="e.g. Barangay Health Station" className={inputCls()} />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Referral Reason <span className="text-brand-danger">*</span></label>
              <input type="text" value={form.reason} onChange={(e) => set("reason")(e.target.value)} placeholder="Enter reason..." className={inputCls(liveErrors.reason)} />
              {liveErrors.reason && <p className="mt-1 text-xs text-brand-danger">{liveErrors.reason}</p>}
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Additional notes..." className={`${inputCls()} resize-none`} />
            </div>

            <div className="rounded-btn border border-brand-border p-4">
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
                    <input type="text" value={form.laboratoryTest} onChange={(e) => set("laboratoryTest")(e.target.value)} placeholder="e.g. Complete Blood Count, Urinalysis, FBS" className={inputCls(liveErrors.laboratoryTest)} />
                    {liveErrors.laboratoryTest && <p className="mt-1 text-xs text-brand-danger">{liveErrors.laboratoryTest}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Additional Instructions</label>
                    <textarea rows={2} value={form.additionalInstructions} onChange={(e) => set("additionalInstructions")(e.target.value)} placeholder="Optional instructions for the laboratory..." className={`${inputCls()} resize-none`} />
                  </div>
                </>
              )}
            </div>

            <div className="rounded-btn border border-brand-border p-4">
              <p className="text-sm font-semibold text-brand-ink mb-3">Clinical Detail</p>
              <p className="text-xs text-brand-gray mb-3">Clinical findings from the barangay health station to share with the RHU.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Chief Complaints</label>
                  <textarea rows={2} value={form.chiefComplaints} onChange={(e) => set("chiefComplaints")(e.target.value)} placeholder="Presenting symptoms and complaints..." className={`${inputCls()} resize-none`} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Medical History</label>
                  <textarea rows={2} value={form.medicalHistory} onChange={(e) => set("medicalHistory")(e.target.value)} placeholder="Relevant past medical history, medications, allergies..." className={`${inputCls()} resize-none`} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Physical Examination Findings</label>
                  <textarea rows={2} value={form.physicalExamFindings} onChange={(e) => set("physicalExamFindings")(e.target.value)} placeholder="Vital signs, general appearance, exam findings..." className={`${inputCls()} resize-none`} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Impression / Working Diagnosis</label>
                  <input type="text" value={form.impression} onChange={(e) => set("impression")(e.target.value)} placeholder="Initial impression or working diagnosis..." className={inputCls()} />
                </div>
              </div>
            </div>
            </fieldset>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
            <button
              disabled={saving || routesLoading || Boolean(routesError) || Object.values(liveErrors).some(Boolean)}
              onClick={() => { if (validate()) onSave(form); }}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <Check className="h-4 w-4" /> {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Referral"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function HealthReferrals() {
  const { user } = useAuth();
  const { can } = usePermissions();
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [residentLoadError, setResidentLoadError] = useState(null);
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
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const actionMenuTriggerRef = useRef(null);
  const actionMenuRef = useRef(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [exportingId, setExportingId] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [referralPage, setReferralPage] = useState(1);
  const [referralPageSize, setReferralPageSize] = useState(8);
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [box, setBox] = useState("all");
  const [toast, setToast] = useState(null);
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
    if (!canCreate) {
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    setDraft(incoming);
    setEditing(null);
    setSelectedResident(null);
    setFormOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [canCreate, location.state, location.pathname, navigate]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

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
    const loadResidents = async () => {
      const all = [];
      for (let offset = 0; ; offset += 100) {
        if (requestId !== loadRequest.current) throw new Error("The referral directory request was superseded.");
        const response = await api.get('/residents', { params: { limit: 100, offset }, ownerId: user.id });
        const page = Array.isArray(response?.rows) ? response.rows : Array.isArray(response) ? response : null;
        if (!page) throw new Error("The resident directory returned an invalid response.");
        all.push(...page);
        if (page.length < 100 || (Number.isFinite(response.total) && all.length >= response.total)) return { rows: all };
      }
    };
    const results = await Promise.allSettled([
      referralsApi.list({ box }, { ownerId: user.id }),
      canWrite && canCreate ? loadResidents() : Promise.resolve(null),
    ]);
    if (requestId !== loadRequest.current) return;

    const [referralResult, residentResult] = results;
    if (referralResult.status === "fulfilled" && Array.isArray(referralResult.value?.rows)) {
      setRecords(referralResult.value.rows.map(mapRecord));
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
        setResidents(
          rows
            .map((r) => ({
              id: r.id,
              name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
              barangay: r.barangay || "",
              age: ageFrom(r.birthDate),
              gender: r.sex,
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
    } else setResidents([]);
    setLoading(false);
  }, [assignedBarangay, box, canWrite, canCreate, isHealthSupervisor, user?.id, user?.role, user?.municipalityId, user?.barangayId, user?.facilityId]);

  useEffect(() => {
    load();
    return () => { loadRequest.current += 1; };
  }, [load]);

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
  }, [records, search, statusFilter, priorityFilter]);
  const pageRecords = filtered.slice((referralPage - 1) * referralPageSize, referralPage * referralPageSize);
  useEffect(() => { setReferralPage(1); }, [search, statusFilter, priorityFilter]);
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

  const toPayload = (form) => ({
    referral_date: form.referralDate || null,
    scheduled_at: form.scheduledAt ? localDateTimeToIso(form.scheduledAt) : null,
    client_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    destination_facility: form.destinationFacility.trim(),
    destination_service: form.destinationService.trim(),
    reason: form.reason.trim(),
    priority: form.priority,
    referring_facility: form.referringFacility.trim(),
    notes: form.notes,
    laboratory_test_required: Boolean(form.laboratoryTestRequired),
    laboratory_test: form.laboratoryTest ? form.laboratoryTest.trim() : "",
    additional_instructions: form.additionalInstructions ? form.additionalInstructions.trim() : "",
    chief_complaints: form.chiefComplaints || "",
    medical_history: form.medicalHistory || "",
    physical_exam_findings: form.physicalExamFindings || "",
    impression: form.impression || "",
    treatment_visit_id: form.treatmentVisitId || null,
    recipient_personnel_id: form.recipientPersonnelId,
    recipient_facility_id: form.recipientFacilityId,
    recipient_role: form.recipientRole,
    recipient_station: form.recipientStation || null,
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
      const detail = await referralsApi.get(record.id, { ownerId: user.id });
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
      const response = await referralsApi.get(record.id, { ownerId: user.id });
      if (!response?.record || response.record.id !== record.id || !STATUSES.includes(response.record.status)) throw new Error("The referral detail response is invalid.");
      if (requestId === detailRequest.current) setDetail(mapRecord(response.record));
    } catch (error) {
      if (requestId === detailRequest.current) setDetailError(error?.message || "Could not load referral history.");
    } finally { if (requestId === detailRequest.current) setDetailLoading(false); }
  }, [user?.id, canRead, isHealthSupervisor, assignedBarangay]);

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

  const toggleActionMenu = (event, recordId) => {
    if (openActionMenu === recordId) {
      setOpenActionMenu(null);
      setActionMenuPosition(null);
      return;
    }
    actionMenuTriggerRef.current = event.currentTarget;
    setActionMenuPosition(null);
    setOpenActionMenu(recordId);
  };

  useLayoutEffect(() => {
    if (!openActionMenu) {
      setActionMenuPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const trigger = actionMenuTriggerRef.current;
      const menu = actionMenuRef.current;
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
      setActionMenuPosition({ left, top });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [openActionMenu]);

  useEffect(() => {
    if (!openActionMenu) return undefined;
    const onPointerDown = (event) => {
      if (
        !actionMenuTriggerRef.current?.contains(event.target) &&
        !actionMenuRef.current?.contains(event.target)
      ) {
        setOpenActionMenu(null);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenActionMenu(null);
        actionMenuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openActionMenu]);

  const columns = isResident
    ? ["Referral Date", "Reason", "Destination", "Lab Test", "Priority", "Status", ""]
    : ["Resident", "Referral Date", "Reason", "Destination", "Lab Test", "Priority", "Status", "Actions"];

  return (
    <>
      <PageHeader
        crumbs={["Referrals"]}
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

      <Card className="p-4 mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2 lg:max-w-md lg:flex-1">
            <Search className="h-4 w-4 text-brand-gray" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, reason, facility..." className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Referral status filter" className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20">
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === "Historical" ? "Historical (Rejected / Cancelled)" : s === "All" ? "All Status" : s}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none">
              <option value="All">All Priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <TablePagination total={filtered.length} page={referralPage} pageSize={referralPageSize} onPageChange={setReferralPage} onPageSizeChange={(size) => { setReferralPageSize(size); setReferralPage(1); }} className="m-3" />
        <div>
          <table className={`ui-table w-full referral-monitoring-grid ${isResident ? "referral-monitoring-grid-resident" : "referral-monitoring-grid-supervisor"}`}>
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                {columns.map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">{h}</th>
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
                    <StatusBadge value={referralDisplayStatus(r.status)} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={(event) => toggleActionMenu(event, r.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-brand-blue transition-colors hover:bg-brand-light hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                        aria-label={`Actions for ${r.residentName}`}
                        aria-haspopup="menu"
                        aria-expanded={openActionMenu === r.id}
                      >
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </button>
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
                        : isResident
                          ? "You have no referrals yet."
                          : "No referrals match the selected filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {openActionMenu && typeof document !== "undefined" && createPortal(
        (() => {
          const record = filtered.find((item) => item.id === openActionMenu);
          if (!record) return null;

          const menuItemClass = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg focus-visible:bg-brand-bg focus-visible:outline-none";
          const closeMenu = () => {
            setOpenActionMenu(null);
            setActionMenuPosition(null);
          };
          const selectAction = (action) => {
            closeMenu();
            action();
          };

          return (
            <div
              ref={actionMenuRef}
              role="menu"
              aria-label={`Actions for ${record.residentName}`}
              className="fixed z-[90] max-h-[calc(100vh-1rem)] w-48 overflow-y-auto rounded-lg border border-brand-border bg-white py-1 shadow-lg"
              style={{
                left: actionMenuPosition?.left ?? 0,
                top: actionMenuPosition?.top ?? 0,
                visibility: actionMenuPosition ? "visible" : "hidden",
              }}
            >
              <button type="button" role="menuitem" onClick={() => selectAction(() => void openDetail(record))} className={menuItemClass}>
                <Eye className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
                View Details
              </button>
              {!isResident && shouldShowReferralDownloadAction(user) && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={exportingId === record.id}
                  onClick={() => selectAction(() => handleDownloadPdf(record))}
                  className={`${menuItemClass} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Download className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
                  Download / Print
                </button>
              )}
              {!isResident && canAssignReferral(record, can) && (
                <button type="button" role="menuitem" onClick={() => selectAction(() => openEdit(record))} className={menuItemClass}>
                  <Edit2 className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
                  Edit
                </button>
              )}
              {!isResident && allowedReferralStatuses(record, can).length > 0 && (
                <button type="button" role="menuitem" onClick={() => selectAction(() => openStatus(record))} className={menuItemClass}>
                  <RefreshCw className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
                  Update Status
                </button>
              )}
            </div>
          );
        })(),
        document.body,
      )}

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
            className={`flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden ${isHealthSupervisor ? "supervisor-modal" : ""}`}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border px-4 py-3 sm:px-5">
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

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
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
                {detail.medicalHistory && <DetailField label="Medical history" value={detail.medicalHistory} />}
                {detail.physicalExamFindings && <DetailField label="Physical examination findings" value={detail.physicalExamFindings} />}
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
        <ReferralFormModal
          initial={editing}
          draft={draft}
          resident={targetResident}
          residents={residents}
          saving={saving}
          ownerId={user?.id}
          onClose={() => { setFormOpen(false); setEditing(null); setSelectedResident(null); setDraft(null); }}
          onSave={handleSave}
          onSelectResident={setSelectedResident}
        />
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

    </>
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
