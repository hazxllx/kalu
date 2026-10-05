import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import StatCard from "@/components/common/StatCard";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import {
  Baby, Plus, X, Pencil, CheckCircle2, Search, Download, ChevronLeft, ChevronRight, Trash2,
  Users, HeartPulse, Syringe, Smile, Activity, Droplets, ShieldAlert, FileBarChart2, Printer, ChevronRight as ArrowChevron,
} from "lucide-react";
import { maternalApi, residentsApi, referralsApi, m1Api } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { isHealthSupervisor, getSupervisorScope } from "@/lib/supervisorScope";
import {
  filterByPeriod, availableYears, periodBreakdown, followUpStatus, MONTH_LABELS,
} from "@/features/health-records/lib/m1Analytics";
import {
  periodLabel as makePeriodLabel, fhsisPeriodLabel, toReportParams,
  QUARTER_RANGE_LABEL, QUARTERS, quarterOfMonth0,
} from "@/features/health-records/lib/reportingPeriod";
import { useM1OfficialPrint } from "@/features/health-records/components/M1OfficialForm";
import { useMaternalRecordPrint } from "@/features/health-records/components/MaternalRecordPrint";
import M1DataEntryModal from "@/features/health-records/components/M1DataEntryModal";
import M1SectionPanel from "@/features/health-records/components/M1SectionPanel";

// FHSIS M1 program sections shown as the Health Services launcher. Maternal Care
// opens the in-page operational records; Child Care and Environmental Health
// open their existing operational modules; the remaining sections open the
// section workspace (live indicator values + manual reporting input where an
// indicator has no operational source). Order/labels follow the official M1 form.
const HEALTH_SERVICES = [
  { key: "A", title: "Family Planning", desc: "Women of reproductive age and family planning method utilization.", icon: Users, kind: "section" },
  { key: "B", title: "Maternal Care", desc: "Prenatal, delivery and postpartum services.", icon: HeartPulse, kind: "maternal" },
  { key: "C", title: "Child Care", desc: "Immunization, nutrition and child services.", icon: Syringe, kind: "nav", to: "../immunization" },
  { key: "D", title: "Oral Health", desc: "Oral health care visits across age groups.", icon: Smile, kind: "section" },
  { key: "F", title: "Non-Communicable Diseases", desc: "Risk assessment, hypertension, diabetes, cancer screening.", icon: Activity, kind: "section" },
  { key: "G", title: "Environmental Health", desc: "Household water supply and sanitation.", icon: Droplets, kind: "nav", to: "../households" },
  { key: "E", title: "Infectious Disease", desc: "TB, rabies, schistosomiasis, leprosy, malaria.", icon: ShieldAlert, kind: "section" },
  { key: "H", title: "Vital Statistics", desc: "Mortality and natality.", icon: FileBarChart2, kind: "section" },
];
const SECTION_TITLE = Object.fromEntries(HEALTH_SERVICES.map((s) => [s.key, s.title]));

const RISK_LEVELS = ["Low", "Moderate", "High"];
const STATUSES = ["Active", "Delivered", "Transferred", "Inactive"];

// Canonical delivery vocabulary. These exact values are what the FHSIS M1
// Section B2 derivation matches on (see backend/src/config/m1Catalog.js), so the
// delivery indicators can be computed from the maternal case instead of being
// re-entered on the M1 form.
const DELIVERY_TYPES = ["Vaginal", "Cesarean"];
const DELIVERY_OUTCOMES = ["Live Birth", "Fetal Death"];
const DELIVERY_PLACES = ["Public Facility", "Private Facility", "Home / Non-Facility"];
const BIRTH_ATTENDANTS = ["Doctor", "Nurse", "Midwife", "Hilot/TBA", "Other"];

// ---------------------------------------------------------------------------
// FHSIS M1 export (official reporting-form layout).
//
// The "Export" button produces the official FHSIS Monthly Form M1 through a
// DEDICATED print renderer (M1OfficialForm + useM1OfficialPrint → browser
// "Save as PDF"). That print layer reproduces the official form structure
// (navy section bars, grouped/merged column headers, the Family-Planning
// matrix, parent/child indicator hierarchy) and is completely separate from
// this screen UI, so cleaning up the Maternal Record screen never alters the
// printed form. The SAME official layout is used for Monthly, Quarterly and
// Annual exports — only the reporting period and the aggregated values change.
//
// Values come straight from the M1 aggregation API (`m1Api.report` → `byCode`),
// which aggregates the persisted records server-side for the selected period
// (barangay-scoped). Monthly uses the selected month, Quarterly aggregates its
// three months, Annual aggregates January–December. Nothing is hardcoded and
// the PDF never uses a separate dataset from the screen.
// ---------------------------------------------------------------------------

/** persisted maternal_records row (snake_case) → view shape. */
const mapRecord = (row) => ({
  id: row.id,
  residentId: row.resident_id,
  residentName: row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : row.residentName || "Resident",
  barangay: row.resident?.barangay || row.barangay || "",
  residentBirthDate: row.resident?.birth_date || "",
  residentSex: row.resident?.sex || "",
  recordedAt: row.created_at || "",
  updatedAt: row.updated_at || "",
  lmp: row.lmp || "",
  edd: row.edd || "",
  prenatalVisits: row.prenatal_visits ?? 0,
  risk: row.risk || "Low",
  status: row.status || "Active",
  notes: row.notes || "",
  provider: row.provider || "",
  // Post-partum care & delivery outcome
  typeOfDelivery: row.type_of_delivery || "",
  deliveryDate: row.delivery_date || "",
  deliveryOutcome: row.delivery_outcome || "",
  birthWeight: row.birth_weight || "",
  placeOfDelivery: row.place_of_delivery || "",
  birthAttendant: row.birth_attendant || "",
  ppCheckup24h: row.pp_checkup_24h || "",
  ppCheckupDay3: row.pp_checkup_day3 || "",
  ppCheckup7to14d: row.pp_checkup_7_14d || "",
  ppCheckup6wk: row.pp_checkup_6wk || "",
  ironFolicCompletedDate: row.iron_folic_completed_date || "",
  vitaminAGivenDate: row.vitamin_a_given_date || "",
  smokingHistory: Boolean(row.smoking_history),
  bingeAlcohol: Boolean(row.binge_alcohol),
  insufficientPhysicalActivity: Boolean(row.insufficient_physical_activity),
  unhealthyDiet: Boolean(row.unhealthy_diet),
  bmi: row.bmi ?? "",
});

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

const EMPTY_FORM = () => ({
  lmp: "",
  edd: "",
  prenatalVisits: 0,
  risk: "Low",
  status: "Active",
  provider: "",
  notes: "",
  typeOfDelivery: "",
  deliveryDate: "",
  deliveryOutcome: "",
  birthWeight: "",
  placeOfDelivery: "",
  birthAttendant: "",
  ppCheckup24h: "",
  ppCheckupDay3: "",
  ppCheckup7to14d: "",
  ppCheckup6wk: "",
  ironFolicCompletedDate: "",
  vitaminAGivenDate: "",
  smokingHistory: false,
  bingeAlcohol: false,
  insufficientPhysicalActivity: false,
  unhealthyDiet: false,
  bmi: "",
});

const YES_NO = [
  { value: false, label: "No" },
  { value: true, label: "Yes" },
];

function MaternalFormModal({ initial, resident, residents, saving, onClose, onSave, onSelectResident }) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(() => /** @type {Record<string, any>} */ (initial ? { ...initial } : EMPTY_FORM()));
  const [errors, setErrors] = useState(/** @type {Record<string, any>} */ ({}));
  const [activeFormTab, setActiveFormTab] = useState("prenatal");

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!isEdit && !resident) next.resident = "Please select a resident.";
    const visits = Number(form.prenatalVisits);
    if (!Number.isFinite(visits) || visits < 0) next.prenatalVisits = "Enter a valid number of visits.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{isEdit ? "Edit Maternal Record" : "New Maternal Record"}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">Prenatal monitoring details for the resident.</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-4 flex gap-2 overflow-x-auto border-b border-brand-border" role="tablist" aria-label="Maternal record sections">
            {[
              { id: "prenatal", label: "Prenatal" },
              { id: "postpartum", label: "Delivery & Postpartum" },
              { id: "additional", label: "Additional Care" },
            ].map((tab) => {
              const selected = activeFormTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`maternal-form-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`maternal-form-panel-${tab.id}`}
                  onClick={() => setActiveFormTab(tab.id)}
                  className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
                    selected
                      ? "border-brand-blue text-brand-blue"
                      : "border-transparent text-brand-gray hover:text-brand-ink"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            <div
              id="maternal-form-panel-prenatal"
              role="tabpanel"
              aria-labelledby="maternal-form-tab-prenatal"
              hidden={activeFormTab !== "prenatal"}
              className="space-y-4"
            >
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
                {errors.resident && <p className="mt-1 text-xs text-brand-danger">{errors.resident}</p>}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-brand-ink">Last Menstrual Period (LMP)</label>
                <input type="date" value={form.lmp} onChange={(e) => set("lmp")(e.target.value)} className={inputCls()} />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Expected Delivery Date (EDD)</label>
                <input type="date" value={form.edd} onChange={(e) => set("edd")(e.target.value)} className={inputCls()} />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Prenatal Visits</label>
                <input type="number" min={0} value={form.prenatalVisits} onChange={(e) => set("prenatalVisits")(e.target.value)} className={inputCls(errors.prenatalVisits)} />
                {errors.prenatalVisits && <p className="mt-1 text-xs text-brand-danger">{errors.prenatalVisits}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Risk Classification</label>
                <select value={form.risk} onChange={(e) => set("risk")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Status</label>
                <select value={form.status} onChange={(e) => set("status")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Provider</label>
                <input type="text" value={form.provider} onChange={(e) => set("provider")(e.target.value)} placeholder="e.g. Midwife" className={inputCls()} />
              </div>
            </div>

            {/* Household & member context (read-only, from the resident/household profile — not duplicated here). */}
            {(resident || initial) && (
              <div className="rounded-btn bg-brand-bg px-3.5 py-3">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Household &amp; Member (from resident profile)</p>
                <p className="mt-0.5 text-sm font-medium text-brand-ink">
                  {resident?.name || initial?.residentName}
                  {resident?.sex ? ` · ${resident.sex}` : ""}
                  {resident?.age != null ? ` · ${resident.age} yrs` : ""}
                  {(resident?.barangay || initial?.barangay) ? ` · ${resident?.barangay || initial?.barangay}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-brand-gray">Zone No. and HH No. are managed in the household profile.</p>
              </div>
            )}
            </div>

            <div
              id="maternal-form-panel-postpartum"
              role="tabpanel"
              aria-labelledby="maternal-form-tab-postpartum"
              hidden={activeFormTab !== "postpartum"}
              className="space-y-4"
            >
            {/* Post-partum Care and Delivery Outcome */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Post-partum Care &amp; Delivery Outcome</p>
              <p className="mb-2 text-[11px] text-brand-gray">These delivery fields feed the FHSIS M1 Section B2 indicators automatically — enter the delivery here and they are counted in the report; do not re-enter them in M1 Data Entry.</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Date of Delivery</label>
                  <input type="date" value={form.deliveryDate} onChange={(e) => set("deliveryDate")(e.target.value)} className={inputCls()} />
                  <p className="mt-1 text-[11px] text-brand-gray">Reporting month for Section B2 delivery indicators.</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Delivery Outcome</label>
                  <select value={form.deliveryOutcome} onChange={(e) => set("deliveryOutcome")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    {DELIVERY_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Type of Delivery</label>
                  <select value={form.typeOfDelivery} onChange={(e) => set("typeOfDelivery")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    {DELIVERY_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Birth Weight (kg)</label>
                  <input type="number" step="0.01" min={0} value={form.birthWeight} onChange={(e) => set("birthWeight")(e.target.value)} placeholder="e.g. 3.2" className={inputCls()} />
                  <p className="mt-1 text-[11px] text-brand-gray">&lt; 2.5 kg classified as low birth weight; blank = unknown.</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Place of Delivery</label>
                  <select value={form.placeOfDelivery} onChange={(e) => set("placeOfDelivery")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    {DELIVERY_PLACES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Birth Attendant</label>
                  <select value={form.birthAttendant} onChange={(e) => set("birthAttendant")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    {BIRTH_ATTENDANTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Post-partum Check-ups (date each visit was done) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Post-partum Check-ups</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Within 24 hours after delivery</label>
                  <input type="date" value={form.ppCheckup24h} onChange={(e) => set("ppCheckup24h")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">On day 3</label>
                  <input type="date" value={form.ppCheckupDay3} onChange={(e) => set("ppCheckupDay3")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Between 7–14 days</label>
                  <input type="date" value={form.ppCheckup7to14d} onChange={(e) => set("ppCheckup7to14d")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">6 weeks after birth</label>
                  <input type="date" value={form.ppCheckup6wk} onChange={(e) => set("ppCheckup6wk")(e.target.value)} className={inputCls()} />
                </div>
              </div>
            </div>
            </div>

            <div
              id="maternal-form-panel-additional"
              role="tabpanel"
              aria-labelledby="maternal-form-tab-additional"
              hidden={activeFormTab !== "additional"}
              className="space-y-4"
            >
            {/* Supplementation / preventive care (documentation dates only) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Supplementation / Preventive Care</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Date Dose of Iron folic Completed</label>
                  <input type="date" value={form.ironFolicCompletedDate} onChange={(e) => set("ironFolicCompletedDate")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Date Vitamin A Given</label>
                  <input type="date" value={form.vitaminAGivenDate} onChange={(e) => set("vitaminAGivenDate")(e.target.value)} className={inputCls()} />
                </div>
              </div>
            </div>

            {/* Health / lifestyle profile (documentation only — no risk scoring) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Health / Lifestyle Profile</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  ["smokingHistory", "With history of smoking"],
                  ["bingeAlcohol", "Binge Alcohol Drinker"],
                  ["insufficientPhysicalActivity", "Insufficient Physical Activity"],
                  ["unhealthyDiet", "Consumed Unhealthy Diet"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <label className="text-sm font-medium text-brand-ink">{label}</label>
                    <select value={String(form[key])} onChange={(e) => set(key)(e.target.value === "true")} className={`${inputCls()} cursor-pointer`}>
                      {YES_NO.map((o) => <option key={o.label} value={String(o.value)}>{o.label}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <label className="text-sm font-medium text-brand-ink">Body Mass Index (Asia Pacific Standard)</label>
                  <input type="number" step="0.1" min={0} value={form.bmi} onChange={(e) => set("bmi")(e.target.value)} placeholder="e.g. 22.5" className={inputCls()} />
                  <p className="mt-1 text-[11px] text-brand-gray">Recorded value only. Risk classification requires validation with RHU/MHO.</p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Relevant maternal information..." className={`${inputCls()} resize-none`} />
            </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
            <button
              disabled={saving}
              onClick={() => {
                if (!validate()) {
                  setActiveFormTab("prenatal");
                  return;
                }
                onSave({ ...form, prenatalVisits: Number(form.prenatalVisits) || 0 });
              }}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Record"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function M1Records() {
  const { user } = useAuth();

  const supervisor = isHealthSupervisor(user);
  const scope = supervisor ? getSupervisorScope(user) : null;
  const assignedBarangay = scope && scope.level === "barangay" ? scope.assignedBarangay : null;

  const [records, setRecords] = useState([]);
  const [residents, setResidents] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [referralsLoaded, setReferralsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedResident, setSelectedResident] = useState(null);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(null); // record pending delete confirmation
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [activeSection, setActiveSection] = useState(null); // null = Health Services grid; 'B' = maternal; else section panel
  const [m1EntryOpen, setM1EntryOpen] = useState(false);
  const [m1EntrySection, setM1EntrySection] = useState("D");
  // Per-section service-record counts for the Service Summary. Keyed by FHSIS
  // section (A–H) and read from the SAME barangay-scoped aggregation API that
  // produces the official M1 form, so the summary never duplicates data and
  // never diverges from the report. null = not loaded yet.
  const [sectionCounts, setSectionCounts] = useState(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const navigate = useNavigate();
  const { startPrint, portal } = useM1OfficialPrint();
  const { startPrint: startMaternalPrint, portal: maternalPrintPortal } = useMaternalRecordPrint();

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // --- Monthly / Quarterly / Annual reporting controls --------------------
  const now = new Date();
  const [period, setPeriod] = useState("monthly"); // 'monthly' | 'quarterly' | 'annual'
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [quarter, setQuarter] = useState(quarterOfMonth0(now.getMonth())); // 1-4
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;

  // Reset to the first page whenever the visible set changes.
  useEffect(() => { setPage(1); }, [period, year, month, quarter, search, statusFilter]);

  const load = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return Promise.all([maternalApi.list(), residentsApi.list({ limit: 200 })])
      .then(([maternalResult, residentResult]) => {
        setRecords((maternalResult?.rows || []).map(mapRecord));
        const rows = residentResult?.rows || residentResult || [];
        setResidents(
          rows
            .map((r) => ({
              id: r.id,
              name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
              barangay: r.barangay || "",
              age: r.birthDate ? new Date().getFullYear() - new Date(r.birthDate).getFullYear() : undefined,
              sex: r.sex || "",
            }))
            .filter((r) => !assignedBarangay || r.barangay === assignedBarangay)
        );
      })
      .catch((err) => setLoadError(err?.message || "Unable to load maternal records. Please try again."))
      .finally(() => setLoading(false));
  }, [assignedBarangay]);

  useEffect(() => { load(); }, [load]);

  // Maternal referrals (public.health_referrals). Loaded separately and best-effort:
  // the M1 form joins these to the maternal caseload on resident_id to populate
  // the "clients referred" indicators. A role without referral access simply
  // yields an empty set (the form then prints those rows at 0 with a remark).
  useEffect(() => {
    let active = true;
    referralsApi
      .list()
      .then((res) => {
        if (!active) return;
        setReferrals(res?.rows || res || []);
        setReferralsLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setReferrals([]);
        setReferralsLoaded(false);
      });
    return () => { active = false; };
  }, []);

  // --- Derived reporting data (pure; from loaded records) -----------------
  const descriptor = useMemo(() => ({ period, year, month, quarter }), [period, year, month, quarter]);
  const yearsList = useMemo(() => availableYears(records), [records]);

  // Service Summary counts — the number of operational service records
  // consolidated into the M1 report for each FHSIS section in the selected
  // period. Read from the shared, barangay-scoped aggregation API
  // (GET /m1/report → byCode) that also drives the official M1 form, so the
  // summary reuses the existing Health Services / operational records instead of
  // storing its own, and updates automatically as records are added in their
  // modules. Only fetched while the summary grid is visible.
  useEffect(() => {
    if (activeSection !== null) return undefined;
    let active = true;
    setCountsLoading(true);
    m1Api
      .report(toReportParams(descriptor))
      .then((res) => {
        if (!active) return;
        const byCode = res?.byCode || {};
        const totals = {};
        for (const row of Object.values(byCode)) {
          const key = row?.section;
          if (!key) continue;
          totals[key] = (totals[key] || 0) + (Number(row.total) || 0);
        }
        setSectionCounts(totals);
      })
      .catch(() => { if (active) setSectionCounts(null); })
      .finally(() => { if (active) setCountsLoading(false); });
    return () => { active = false; };
  }, [descriptor, activeSection]);
  const periodRecords = useMemo(
    () => filterByPeriod(records, descriptor),
    [records, descriptor],
  );
  const chartData = useMemo(() => periodBreakdown(records, { period, year, quarter }), [records, period, year, quarter]);

  const participants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodRecords
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .filter((r) => !q || `${r.residentName} ${r.residentId}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.recordedAt || "").localeCompare(String(a.recordedAt || "")));
  }, [periodRecords, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(participants.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pagedParticipants = participants.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // M1 workspace metrics (computed from the maternal operational records already
  // loaded for the selected period — no fabricated values).
  const m1Metrics = useMemo(() => {
    const unique = new Set(periodRecords.map((r) => r.residentId).filter(Boolean));
    return {
      periodRecords: periodRecords.length,
      residentsServed: unique.size,
      totalRecords: records.length,
    };
  }, [periodRecords, records]);

  const openManualEntry = (sectionKey) => { setM1EntrySection(sectionKey || "D"); setM1EntryOpen(true); };
  const openService = (svc) => {
    if (svc.kind === "nav" && svc.to) { navigate(svc.to); return; }
    setActiveSection(svc.key);
  };

  const ageOf = (birthDate) => {
    if (!birthDate) return "—";
    const d = new Date(birthDate);
    if (Number.isNaN(d.getTime())) return "—";
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a -= 1;
    return a >= 0 ? a : "—";
  };

  const periodLabel = makePeriodLabel(descriptor);
  const exportLabel = period === "monthly" ? "Export Monthly" : period === "quarterly" ? "Export Quarterly" : "Export Annual";

  // Export the official FHSIS Form M1 for the SELECTED reporting period. Data is
  // fetched fresh from the M1 aggregation API (`report` → `byCode`) for the
  // same period shown on screen (Monthly = one month, Quarterly = three months,
  // Annual = the whole year) and handed to the dedicated official-form print
  // renderer (browser "Save as PDF"), so the printed form keeps its official
  // layout and uses the same persisted data regardless of this screen's UI.
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = toReportParams(descriptor);
      // Report header meta is stored per month; use the period's first month for
      // the shared header fields (municipality/province/population/prepared-by).
      const metaMonth = period === "quarterly" ? (quarter - 1) * 3 + 1 : period === "annual" ? 1 : month + 1;
      const [reportData, metaData] = await Promise.all([
        m1Api.report(params),
        m1Api.getMeta({ year, month: metaMonth }).catch(() => null),
      ]);
      startPrint({
        data: reportData?.byCode || {},
        header: {
          periodLabel: fhsisPeriodLabel(descriptor),
          year,
          municipality: metaData?.municipality || "",
          province: metaData?.province || "",
          projectedPopulation: metaData?.meta?.projected_population ?? "",
          rhu: metaData?.meta?.bhs_name || "",
          barangay: metaData?.barangay?.name || assignedBarangay || "",
          bhs: metaData?.barangay?.healthStation || "",
          preparedBy: metaData?.meta?.prepared_by || "",
        },
      });
    } catch (err) {
      showToast(err?.message || "Could not generate the M1 report.");
    } finally {
      setExporting(false);
    }
  };

  const openCreate = () => { setEditing(null); setSelectedResident(null); setFormOpen(true); };
  const openEdit = (record) => { setEditing(record); setSelectedResident(null); setDetail(null); setFormOpen(true); };

  const handleSave = async (form) => {
    setSaving(true);
    // Shared maternal payload (snake_case → maternal_records columns).
    const payload = {
      lmp: form.lmp || null,
      edd: form.edd || null,
      prenatal_visits: form.prenatalVisits,
      risk: form.risk,
      status: form.status,
      provider: form.provider,
      notes: form.notes,
      type_of_delivery: form.typeOfDelivery || "",
      delivery_date: form.deliveryDate || null,
      delivery_outcome: form.deliveryOutcome || "",
      birth_weight: form.birthWeight || "",
      place_of_delivery: form.placeOfDelivery || "",
      birth_attendant: form.birthAttendant || "",
      pp_checkup_24h: form.ppCheckup24h || null,
      pp_checkup_day3: form.ppCheckupDay3 || null,
      pp_checkup_7_14d: form.ppCheckup7to14d || null,
      pp_checkup_6wk: form.ppCheckup6wk || null,
      iron_folic_completed_date: form.ironFolicCompletedDate || null,
      vitamin_a_given_date: form.vitaminAGivenDate || null,
      smoking_history: Boolean(form.smokingHistory),
      binge_alcohol: Boolean(form.bingeAlcohol),
      insufficient_physical_activity: Boolean(form.insufficientPhysicalActivity),
      unhealthy_diet: Boolean(form.unhealthyDiet),
      bmi: form.bmi === "" || form.bmi === null || form.bmi === undefined ? null : Number(form.bmi),
    };
    try {
      if (editing) {
        await maternalApi.update(editing.id, payload);
      } else {
        await maternalApi.create({ residentId: selectedResident.id, ...payload });
      }
      // The database is the source of truth: re-fetch so every reporting view
      // (summary cards, chart, record list, Monthly/Quarterly/Annual aggregation
      // and the exported PDF) reflects the persisted record, not optimistic state.
      await load();
      showToast(editing ? "Maternal record updated." : "Maternal record created.");
      setFormOpen(false);
      setEditing(null);
      setSelectedResident(null);
    } catch (err) {
      showToast(err?.message || "Could not save the maternal record.");
    } finally {
      setSaving(false);
    }
  };

  // Delete a maternal record (persisted). After a successful delete the data is
  // re-fetched so the record stops counting in every reporting period and view.
  const handleDelete = async (record) => {
    if (!record || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await maternalApi.remove(record.id);
      await load();
      showToast("Maternal record deleted.");
      setDeleting(null);
      setDetail(null);
    } catch (err) {
      showToast(err?.message || "Could not delete the maternal record.");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["M1"]}
        title="M1"
        subtitle={
          assignedBarangay
            ? `Monthly FHSIS service recording and reporting for Brgy. ${assignedBarangay}.`
            : "Monthly FHSIS service recording and reporting for your assigned barangay."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
              title={`Export the official FHSIS Form M1 for ${periodLabel} (Save as PDF)`}
            >
              <Download className="h-4 w-4" /> {exporting ? "Preparing…" : exportLabel}
            </button>
          </div>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {loading ? (
        <Card className="p-10 text-center">
          <Baby className="mx-auto h-10 w-10 animate-pulse text-brand-gray/50" />
          <p className="mt-3 text-sm font-medium text-brand-ink">Loading maternal records...</p>
        </Card>
      ) : loadError ? (
        <Card className="p-10 text-center">
          <Baby className="mx-auto h-10 w-10 text-brand-danger" />
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unable to load maternal records</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">{loadError}</p>
          <button onClick={load} className="mt-4 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Try Again</button>
        </Card>
      ) : (
        <>
          {/* Period controls: Monthly | Quarterly | Annual */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-btn border border-brand-border bg-white p-0.5">
              {["monthly", "quarterly", "annual"].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded-[6px] px-3.5 py-1.5 text-sm font-medium capitalize transition-colors ${
                    period === p ? "bg-brand-blue text-white" : "text-brand-gray hover:text-brand-ink"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Year — shown for every period */}
            <label className="flex items-center gap-2 text-sm text-brand-gray">
              <span>Year:</span>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
              >
                {yearsList.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>

            {/* Month — monthly only */}
            {period === "monthly" && (
              <label className="flex items-center gap-2 text-sm text-brand-gray">
                <span>Month:</span>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                >
                  {MONTH_LABELS.map((label, i) => <option key={label} value={i}>{label}</option>)}
                </select>
              </label>
            )}

            {/* Quarter — quarterly only */}
            {period === "quarterly" && (
              <label className="flex items-center gap-2 text-sm text-brand-gray">
                <span>Quarter:</span>
                <select
                  value={quarter}
                  onChange={(e) => setQuarter(Number(e.target.value))}
                  className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                >
                  {QUARTERS.map((q) => <option key={q} value={q}>Q{q} — {QUARTER_RANGE_LABEL[q]}</option>)}
                </select>
              </label>
            )}

            <span className="text-sm text-brand-gray">Showing: <span className="font-medium text-brand-ink">{periodLabel}</span></span>
          </div>

          {/* M1 workspace metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 sm:gap-5">
            <StatCard icon="CalendarClock" tone="blue" index={0} label="Reporting Period" value={periodLabel} />
            <StatCard icon="FileHeart" tone="danger" index={1} label="Maternal Records (period)" value={m1Metrics.periodRecords} />
            <StatCard icon="Users" tone="green" index={2} label="Residents Served (period)" value={m1Metrics.residentsServed} />
            <StatCard icon="ClipboardList" tone="yellow" index={3} label="Total Maternal Records" value={m1Metrics.totalRecords} />
          </div>

          {/* Health Services — Service Summary of the operational records M1 consolidates. */}
          {activeSection === null && (
            <Card className="mt-6 p-6">
              <h3 className="font-semibold text-brand-ink">Health Services</h3>
              <p className="mt-0.5 text-xs text-brand-gray">
                Operational health service records are consolidated automatically into the M1 report for {periodLabel}.
                Services, personnel and participants are created and managed in the Health Services module — M1 only reads and totals those records.
              </p>

              <div className="mt-5 flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Service Summary</h4>
                {countsLoading && <span className="text-[11px] text-brand-gray">Updating…</span>}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {HEALTH_SERVICES.map((svc) => {
                  const Icon = svc.icon;
                  // Maternal (B) mirrors the operational maternal records in period
                  // (same number as the "Maternal Records (period)" summary card);
                  // every other section reads its consolidated total from the M1
                  // aggregation API. null = counts still loading.
                  const count = svc.key === "B"
                    ? m1Metrics.periodRecords
                    : (sectionCounts ? sectionCounts[svc.key] || 0 : null);
                  return (
                    <button
                      key={svc.key}
                      onClick={() => openService(svc)}
                      className="group flex flex-col rounded-btn border border-brand-border bg-white p-4 text-left transition-colors hover:border-brand-blue"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-brand-blue/10 text-brand-blue">
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="text-sm font-semibold text-brand-ink">{svc.title}</span>
                      </div>
                      <p className="mt-3 flex-1">
                        <span className="font-stat text-2xl font-bold text-brand-ink">{count === null ? "—" : count}</span>
                        <span className="ml-1.5 text-xs text-brand-gray">{count === 1 ? "record" : "records"}</span>
                      </p>
                      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-blue">
                        View Records <ArrowChevron className="h-4 w-4" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Non-maternal section workspace (live indicator values + reporting input) */}
          {activeSection && activeSection !== "B" && (
            <M1SectionPanel
              sectionKey={activeSection}
              sectionTitle={SECTION_TITLE[activeSection] || "FHSIS Section"}
              descriptor={descriptor}
              periodLabel={periodLabel}
              navigate={navigate}
              onBack={() => setActiveSection(null)}
              onEditManual={openManualEntry}
            />
          )}

          {/* Maternal Care operational records (the Maternal Care service) */}
          {activeSection === "B" && (
          <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => setActiveSection(null)} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
                <ChevronLeft className="h-4 w-4" /> Health Services
              </button>
              <div>
                <h3 className="font-semibold text-brand-ink">Maternal Care Records</h3>
                <p className="text-xs text-brand-gray">Individual maternal cases — the operational source for FHSIS Section B.</p>
              </div>
            </div>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              <Plus className="h-4 w-4" /> New Maternal Record
            </button>
          </div>

          {/* Participation chart (period-aware) */}
          <Card className="mt-6 p-6">
            <h3 className="font-semibold text-brand-ink">M1 Participation by Month</h3>
            <p className="mt-0.5 text-xs text-brand-gray">
              {period === "monthly"
                ? `New maternal records first recorded each month in ${year} (highlighting ${MONTH_LABELS[month]}).`
                : period === "quarterly"
                  ? `New maternal records recorded in Q${quarter} ${year} (${QUARTER_RANGE_LABEL[quarter]}).`
                  : `New maternal records first recorded each month in ${year}.`}
            </p>
            {chartData.some((mm) => mm.count > 0) ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 12, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid #E5EAF1" }} cursor={{ fill: "#F8FBFF" }} />
                  <Bar dataKey="count" name="M1 participants" radius={[4, 4, 0, 0]} barSize={26}>
                    {chartData.map((mm) => (
                      <Cell key={mm.month} fill={period === "monthly" && mm.idx === month ? "#F5B400" : "#0B5CAD"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-10 text-center text-sm text-brand-gray">No M1 records for {periodLabel}.</p>
            )}
          </Card>

          {/* Annual monthly breakdown table */}
          {period === "annual" && chartData.some((mm) => mm.count > 0) && (
            <Card className="mt-6 p-6">
              <h3 className="font-semibold text-brand-ink">Monthly M1 Participation — {year}</h3>
              <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                {chartData.map((mm) => (
                  <div key={mm.month} className="flex items-center justify-between border-b border-brand-border py-1.5 text-sm">
                    <span className="text-brand-gray">{mm.label}</span>
                    <span className="font-stat font-bold text-brand-ink">{mm.count}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Participants table */}
          <Card className="mt-6 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border px-5 py-4">
              <div>
                <h3 className="font-semibold text-brand-ink">M1 / Maternal Participants</h3>
                <p className="text-xs text-brand-gray">Residents with maternal records for {periodLabel} — {participants.length} shown.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-gray" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or ID"
                    className="w-56 rounded-btn border border-brand-border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                >
                  <option value="All">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {participants.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-bg">
                  <Baby className="h-7 w-7 text-brand-blue" />
                </div>
                <h4 className="mt-4 text-base font-semibold text-brand-ink">No M1 participants for {periodLabel}</h4>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
                  {records.length === 0
                    ? (assignedBarangay
                        ? `No maternal records have been recorded for Brgy. ${assignedBarangay} yet.`
                        : "No maternal records have been recorded yet.")
                    : "No maternal records match this period or filter."}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-brand-border bg-brand-bg/50 text-left">
                        <th className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Resident</th>
                        <th className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Age</th>
                        <th className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Barangay</th>
                        <th className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Status</th>
                        <th className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-brand-gray">First Recorded</th>
                        <th className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Latest Update</th>
                        <th className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Follow-up</th>
                        <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-brand-gray">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedParticipants.map((m) => (
                        <tr
                          key={m.id}
                          onClick={() => setDetail(m)}
                          className="cursor-pointer border-b border-brand-border last:border-0 hover:bg-brand-bg/40"
                        >
                          <td className="px-5 py-3">
                            <p className="font-medium text-brand-ink">{m.residentName}</p>
                            <p className="text-xs text-brand-gray">{m.residentId}</p>
                          </td>
                          <td className="px-3 py-3 text-brand-ink">{ageOf(m.residentBirthDate)}</td>
                          <td className="px-3 py-3 text-brand-gray">{m.barangay || "—"}</td>
                          <td className="px-3 py-3"><StatusBadge value={m.status} /></td>
                          <td className="px-3 py-3 text-brand-gray">{String(m.recordedAt || "").slice(0, 10) || "—"}</td>
                          <td className="px-3 py-3 text-brand-gray">{String(m.updatedAt || "").slice(0, 10) || "—"}</td>
                          <td className="px-3 py-3 text-brand-gray">{followUpStatus(m)}</td>
                          <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setDetail(m)} className="text-sm font-medium text-brand-blue hover:underline">View</button>
                            <button onClick={() => openEdit(m)} className="ml-3 inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-brand-border px-5 py-3 text-sm">
                    <span className="text-brand-gray">Page {pageSafe} of {totalPages}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={pageSafe <= 1}
                        className="inline-flex items-center gap-1 rounded-btn border border-brand-border px-3 py-1.5 font-medium text-brand-ink disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" /> Prev
                      </button>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={pageSafe >= totalPages}
                        className="inline-flex items-center gap-1 rounded-btn border border-brand-border px-3 py-1.5 font-medium text-brand-ink disabled:opacity-40"
                      >
                        Next <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
          </>
          )}
        </>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{detail.residentName}</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">Maternal record{detail.barangay ? ` · ${detail.barangay}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={detail.risk} />
                  <button onClick={() => setDetail(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["LMP", detail.lmp || "—"],
                  ["EDD", detail.edd || "—"],
                  ["Prenatal Visits", detail.prenatalVisits],
                  ["Status", detail.status],
                  ["Provider", detail.provider || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">{value}</p>
                  </div>
                ))}
              </div>

              {/* Post-partum care & delivery outcome */}
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Post-partum Care &amp; Delivery Outcome</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Date of Delivery", detail.deliveryDate || "—"],
                    ["Delivery Outcome", detail.deliveryOutcome || "—"],
                    ["Type of Delivery", detail.typeOfDelivery || "—"],
                    ["Birth Weight", detail.birthWeight || "—"],
                    ["Place of Delivery", detail.placeOfDelivery || "—"],
                    ["Birth Attendant", detail.birthAttendant || "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                      <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Post-partum check-ups + supplementation */}
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Post-partum Check-ups &amp; Supplementation</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Within 24 hours", detail.ppCheckup24h || "—"],
                    ["On day 3", detail.ppCheckupDay3 || "—"],
                    ["Between 7–14 days", detail.ppCheckup7to14d || "—"],
                    ["6 weeks after birth", detail.ppCheckup6wk || "—"],
                    ["Iron/Folic Completed", detail.ironFolicCompletedDate || "—"],
                    ["Vitamin A Given", detail.vitaminAGivenDate || "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                      <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Health / lifestyle profile */}
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Health / Lifestyle Profile</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Smoking History", detail.smokingHistory ? "Yes" : "No"],
                    ["Binge Alcohol Drinker", detail.bingeAlcohol ? "Yes" : "No"],
                    ["Insufficient Physical Activity", detail.insufficientPhysicalActivity ? "Yes" : "No"],
                    ["Consumed Unhealthy Diet", detail.unhealthyDiet ? "Yes" : "No"],
                    ["BMI (Asia Pacific Standard)", detail.bmi !== "" && detail.bmi != null ? detail.bmi : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                      <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                      <p className="mt-0.5 text-sm font-medium text-brand-ink">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-btn bg-brand-bg px-3.5 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Notes</p>
                <p className="mt-0.5 text-sm text-brand-ink">{detail.notes || "No notes recorded."}</p>
              </div>
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-brand-border pt-4">
                <button
                  onClick={() => setDeleting(detail)}
                  className="inline-flex items-center gap-1.5 rounded-btn px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/10"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => startMaternalPrint(detail)}
                    className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg"
                  >
                    <Printer className="h-4 w-4" /> Print
                  </button>
                  <button onClick={() => setDetail(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Close</button>
                  <button onClick={() => openEdit(detail)} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
                    <Pencil className="h-4 w-4" /> Edit
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <MaternalFormModal
          initial={editing}
          resident={selectedResident}
          residents={residents}
          saving={saving}
          onClose={() => { setFormOpen(false); setEditing(null); setSelectedResident(null); }}
          onSave={handleSave}
          onSelectResident={setSelectedResident}
        />
      )}

      {/* Section reporting-figures entry (manual indicators with no operational source) */}
      {m1EntryOpen && (
        <M1DataEntryModal
          initialSection={m1EntrySection}
          initialYear={year}
          initialMonth={period === "monthly" ? month + 1 : (period === "quarterly" ? (quarter - 1) * 3 + 1 : 1)}
          onClose={() => setM1EntryOpen(false)}
          onSaved={() => showToast("M1 reporting data saved.")}
        />
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-danger/10">
                  <Trash2 className="h-5 w-5 text-brand-danger" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Delete maternal record?</h3>
                  <p className="mt-1 text-sm text-brand-gray">
                    This permanently deletes the maternal record for{" "}
                    <span className="font-medium text-brand-ink">{deleting.residentName}</span>. It will no longer be
                    counted in Monthly, Quarterly or Annual reports, the charts, or the exported M1 report. This action
                    cannot be undone.
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setDeleting(null)}
                  disabled={deleteBusy}
                  className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleting)}
                  disabled={deleteBusy}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" /> {deleteBusy ? "Deleting…" : "Delete Record"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* FHSIS M1 print portal (renders only during "Save as PDF"). */}
      {portal}
      {maternalPrintPortal}
    </>
  );
}
