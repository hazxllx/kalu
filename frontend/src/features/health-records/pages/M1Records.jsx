import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import PageHeader from "@/components/common/PageHeader";
import BackToTclButton from "@/features/health-records/components/BackToTclButton";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import {
  Baby, Plus, X, Pencil, CheckCircle2, Search, Download, ChevronLeft, ChevronRight, Trash2, Printer,
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
import HealthServicesSummary from "@/features/health-records/components/HealthServicesSummary";
import { HEALTH_SERVICE_TITLES } from "@/features/health-records/lib/healthServicesConfig";

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
  // Registration & identity (TCL PN PP)
  dateOfRegistration: row.date_of_registration || "",
  familySerialNo: row.family_serial_no || "",
  socioEconomicStatus: row.socio_economic_status || "",
  gravida: row.gravida ?? "",
  para: row.para ?? "",
  // Immunization status (Td/TT dose dates + FIM)
  td1Date: row.tt_td_doses?.td1 || "",
  td2Date: row.tt_td_doses?.td2 || "",
  td3Date: row.tt_td_doses?.td3 || "",
  td4Date: row.tt_td_doses?.td4 || "",
  td5Date: row.tt_td_doses?.td5 || "",
  fimStatus: Boolean(row.fim_status),
  // Micronutrient supplementation + deworming
  prenatalIronFolicTablets: row.prenatal_micronutrients?.iron_folic_tablets ?? "",
  calciumTablets: row.prenatal_micronutrients?.calcium_tablets ?? "",
  iodineGivenDate: row.iodine_given_date || "",
  dewormingDate: row.deworming_date || "",
  // Infectious disease surveillance
  syphilisScreenDate: row.syphilis_screen_date || "",
  syphilisResult: row.syphilis_result || "",
  hepbScreenDate: row.hepb_screen_date || "",
  hepbResult: row.hepb_result || "",
  hivScreenDate: row.hiv_screen_date || "",
  // Laboratory screening
  gdmScreenDate: row.gdm_screen_date || "",
  gdmResult: row.gdm_result || "",
  cbcScreenDate: row.cbc_screen_date || "",
  cbcResult: row.cbc_result || "",
  cbcIronGiven: Boolean(row.cbc_iron_given),
  // Pregnancy outcome
  pregnancyOutcome: row.pregnancy_outcome || "",
  pregnancyOutcomeDate: row.pregnancy_outcome_date || "",
  newbornSex: row.newborn_sex || "",
  // Post-partum care & delivery outcome
  typeOfDelivery: row.type_of_delivery || "",
  deliveryDate: row.delivery_date || "",
  deliveryTime: row.delivery_time || "",
  deliveryOutcome: row.delivery_outcome || "",
  birthWeight: row.birth_weight || "",
  birthWeightClass: row.birth_weight_class || "",
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
  // Registration & identity (TCL PN PP cols 1,2,5,7)
  dateOfRegistration: "",
  familySerialNo: "",
  socioEconomicStatus: "",
  gravida: "",
  para: "",
  // Immunization status (col 10)
  td1Date: "",
  td2Date: "",
  td3Date: "",
  td4Date: "",
  td5Date: "",
  fimStatus: false,
  // Micronutrient supplementation (col 11) + deworming (col 13)
  prenatalIronFolicTablets: "",
  calciumTablets: "",
  iodineGivenDate: "",
  dewormingDate: "",
  // Infectious disease surveillance (col 14)
  syphilisScreenDate: "",
  syphilisResult: "",
  hepbScreenDate: "",
  hepbResult: "",
  hivScreenDate: "",
  // Laboratory screening (col 15)
  gdmScreenDate: "",
  gdmResult: "",
  cbcScreenDate: "",
  cbcResult: "",
  cbcIronGiven: false,
  // Pregnancy outcome (col 16)
  pregnancyOutcome: "",
  pregnancyOutcomeDate: "",
  newbornSex: "",
  typeOfDelivery: "",
  deliveryDate: "",
  deliveryTime: "",
  deliveryOutcome: "",
  birthWeight: "",
  birthWeightClass: "",
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

  // Lock background scroll while the modal is open and allow Escape to close it.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit maternal record" : "New maternal record"}
    >
      <Card className="flex h-full w-full max-w-3xl flex-col overflow-hidden !rounded-none sm:h-auto sm:max-h-[90vh] sm:!rounded-2xl">
        {/* Header — stays fixed while the form body scrolls */}
        <div className="flex items-start justify-between gap-3 border-b border-brand-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-brand-ink sm:text-lg">{isEdit ? "Edit Maternal Record" : "New Maternal Record"}</h3>
            <p className="mt-0.5 text-sm text-brand-gray">Prenatal monitoring details for the resident.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 shrink-0 rounded-btn p-1.5 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab navigation — wraps on narrow screens instead of showing a horizontal scrollbar */}
        <div className="flex flex-wrap gap-x-1 border-b border-brand-border px-3 sm:px-4" role="tablist" aria-label="Maternal record sections">
          {[
            { id: "prenatal", label: "Prenatal" },
            { id: "services", label: "Prenatal Services" },
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
                className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
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

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="space-y-5">
            <div
              id="maternal-form-panel-prenatal"
              role="tabpanel"
              aria-labelledby="maternal-form-tab-prenatal"
              hidden={activeFormTab !== "prenatal"}
              className="space-y-5"
            >
              {/* Patient information */}
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Patient information</p>
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
              </section>

              {/* Pregnancy details */}
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Pregnancy details</p>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
                </div>
              </section>

              {/* Record information */}
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Record information</p>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Date of Registration</label>
                    <input type="date" value={form.dateOfRegistration} onChange={(e) => set("dateOfRegistration")(e.target.value)} className={inputCls()} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Family Serial No.</label>
                    <input type="text" value={form.familySerialNo} onChange={(e) => set("familySerialNo")(e.target.value)} className={inputCls()} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Socio-Economic Status</label>
                    <select value={form.socioEconomicStatus} onChange={(e) => set("socioEconomicStatus")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                      <option value="">—</option>
                      <option value="NHTS">1 - NHTS</option>
                      <option value="Non-NHTS">2 - Non-NHTS</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Gravida (G)</label>
                    <input type="number" min={0} value={form.gravida} onChange={(e) => set("gravida")(e.target.value)} className={inputCls()} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Para (P)</label>
                    <input type="number" min={0} value={form.para} onChange={(e) => set("para")(e.target.value)} className={inputCls()} />
                  </div>
                </div>
              </section>

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
              id="maternal-form-panel-services"
              role="tabpanel"
              aria-labelledby="maternal-form-tab-services"
              hidden={activeFormTab !== "services"}
              className="space-y-4"
            >
            {/* Immunization status (TCL PN PP col 10) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Immunization Status — Td/TT (date given)</p>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                {[["td1Date", "Td1 / TT1"], ["td2Date", "Td2 / TT2"], ["td3Date", "Td3 / TT3"], ["td4Date", "Td4 / TT4"], ["td5Date", "Td5 / TT5"]].map(([key, label]) => (
                  <div key={key}>
                    <label className="text-sm font-medium text-brand-ink">{label}</label>
                    <input type="date" value={form[key]} onChange={(e) => set(key)(e.target.value)} className={inputCls()} />
                  </div>
                ))}
                <div>
                  <label className="text-sm font-medium text-brand-ink">FIM Status</label>
                  <select value={String(form.fimStatus)} onChange={(e) => set("fimStatus")(e.target.value === "true")} className={`${inputCls()} cursor-pointer`}>
                    {YES_NO.map((o) => <option key={o.label} value={String(o.value)}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Micronutrient supplementation (col 11) + deworming (col 13) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Micronutrient Supplementation &amp; Deworming</p>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Iron + Folic Acid (total tablets)</label>
                  <input type="number" min={0} value={form.prenatalIronFolicTablets} onChange={(e) => set("prenatalIronFolicTablets")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Calcium Carbonate (total tablets)</label>
                  <input type="number" min={0} value={form.calciumTablets} onChange={(e) => set("calciumTablets")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Iodine Capsules (date 2 capsules given)</label>
                  <input type="date" value={form.iodineGivenDate} onChange={(e) => set("iodineGivenDate")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Deworming Tablet (date, 2nd/3rd tri)</label>
                  <input type="date" value={form.dewormingDate} onChange={(e) => set("dewormingDate")(e.target.value)} className={inputCls()} />
                </div>
              </div>
            </div>

            {/* Infectious disease surveillance (col 14) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Infectious Disease Surveillance</p>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Syphilis Screening (date)</label>
                  <input type="date" value={form.syphilisScreenDate} onChange={(e) => set("syphilisScreenDate")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Syphilis Result</label>
                  <select value={form.syphilisResult} onChange={(e) => set("syphilisResult")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    <option value="+">+ positive</option>
                    <option value="-">- negative</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Hepatitis B Screening (date)</label>
                  <input type="date" value={form.hepbScreenDate} onChange={(e) => set("hepbScreenDate")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Hepatitis B Result (HBsAg)</label>
                  <select value={form.hepbResult} onChange={(e) => set("hepbResult")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    <option value="+">+ positive</option>
                    <option value="-">- negative</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">HIV Screening (date)</label>
                  <input type="date" value={form.hivScreenDate} onChange={(e) => set("hivScreenDate")(e.target.value)} className={inputCls()} />
                </div>
              </div>
            </div>

            {/* Laboratory screening (col 15) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Laboratory Screening</p>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-brand-ink">Gestational Diabetes (date screened)</label>
                  <input type="date" value={form.gdmScreenDate} onChange={(e) => set("gdmScreenDate")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Gestational Diabetes Result</label>
                  <select value={form.gdmResult} onChange={(e) => set("gdmResult")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    <option value="+">+ positive</option>
                    <option value="-">- negative</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">CBC / Hgb &amp; Hct (date screened)</label>
                  <input type="date" value={form.cbcScreenDate} onChange={(e) => set("cbcScreenDate")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">CBC Result</label>
                  <select value={form.cbcResult} onChange={(e) => set("cbcResult")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    <option value="+">+ with anemia</option>
                    <option value="-">- without anemia</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Given Iron (if anemic)</label>
                  <select value={String(form.cbcIronGiven)} onChange={(e) => set("cbcIronGiven")(e.target.value === "true")} className={`${inputCls()} cursor-pointer`}>
                    {YES_NO.map((o) => <option key={o.label} value={String(o.value)}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
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
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
                <div>
                  <label className="text-sm font-medium text-brand-ink">Time of Delivery</label>
                  <input type="time" value={form.deliveryTime} onChange={(e) => set("deliveryTime")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Birth Weight Classification</label>
                  <select value={form.birthWeightClass} onChange={(e) => set("birthWeightClass")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    <option value="low">Low (&lt; 2,500 g)</option>
                    <option value="normal">Normal (&ge; 2,500 g)</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Pregnancy Outcome</label>
                  <select value={form.pregnancyOutcome} onChange={(e) => set("pregnancyOutcome")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    <option value="FT">FT - Full Term</option>
                    <option value="PT">PT - Pre-term</option>
                    <option value="FD">FD - Fetal Death</option>
                    <option value="AB">AB - Abortion/Miscarriage</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Date Terminated</label>
                  <input type="date" value={form.pregnancyOutcomeDate} onChange={(e) => set("pregnancyOutcomeDate")(e.target.value)} className={inputCls()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink">Newborn Sex</label>
                  <select value={form.newbornSex} onChange={(e) => set("newbornSex")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">—</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Post-partum Check-ups (date each visit was done) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Post-partum Check-ups</p>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
        </div>

        {/* Footer — stays fixed at the bottom; actions, validation and loading state preserved */}
        <div className="flex items-center justify-end gap-3 border-t border-brand-border px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg">Cancel</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (!validate()) {
                setActiveFormTab("prenatal");
                return;
              }
              onSave({ ...form, prenatalVisits: Number(form.prenatalVisits) || 0 });
            }}
            className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" /> {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Record"}
          </button>
        </div>
      </Card>
    </div>
  );
}

export default function M1Records() {
  const { user } = useAuth();
  const location = useLocation();
  const isMaternalTclRoute = location.pathname.replace(/\/+$/, "").endsWith("/maternal-tcl");

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
  const [activeSection, setActiveSection] = useState(isMaternalTclRoute ? "B" : null); // null = Health Services grid; 'B' = maternal; else section panel
  const [m1EntryOpen, setM1EntryOpen] = useState(false);
  const [m1EntrySection, setM1EntrySection] = useState("D");
  // Per-section service-record counts for the Service Summary. Keyed by FHSIS
  // section (A–H) and read from the SAME barangay-scoped aggregation API that
  // produces the official M1 form, so the summary never duplicates data and
  // never diverges from the report. null = not loaded yet.
  const [sectionCounts, setSectionCounts] = useState(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const [countsError, setCountsError] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cameFromTcl = isMaternalTclRoute || searchParams.get("from") === "tcl";
  const { startPrint, portal, brandingError } = useM1OfficialPrint();
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
  useEffect(() => { setPage(1); }, [period, year, month, quarter, search, statusFilter, isMaternalTclRoute]);

  useEffect(() => {
    setActiveSection(isMaternalTclRoute ? "B" : null);
  }, [isMaternalTclRoute]);

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
  // modules. Only fetched while the summary grid is visible. On error the
  // summary shows a retry action rather than silently reading 0.
  useEffect(() => {
    if (activeSection !== null) return undefined;
    let active = true;
    setCountsLoading(true);
    setCountsError(null);
    m1Api
      .report(toReportParams(descriptor))
      .then((res) => {
        if (!active) return;
        const byCode = res?.byCode || {};
        const totals = {};
        for (const row of Object.values(byCode)) {
          const key = row?.section;
          if (!key) continue;
          if (Number(row.total) > 0) totals[key] = (totals[key] || 0) + 1;
        }
        setSectionCounts(totals);
      })
      .catch((err) => {
        if (!active) return;
        setSectionCounts(null);
        setCountsError(err?.message || "Unable to load record counts.");
      })
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
    return (isMaternalTclRoute ? records : periodRecords)
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .filter((r) => !q || `${r.residentName} ${r.residentId}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.recordedAt || "").localeCompare(String(a.recordedAt || "")));
  }, [isMaternalTclRoute, records, periodRecords, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(participants.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pagedParticipants = participants.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const openManualEntry = (sectionKey) => { setM1EntrySection(sectionKey || "D"); setM1EntryOpen(true); };
  const openService = (svc) => {
    const target = svc.open || {};
    if (target.to) { navigate(target.to); return; }
    if (target.section) setActiveSection(target.section);
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
  const exportLabel = period === "monthly" ? "Export Monthly Report" : period === "quarterly" ? "Export Quarterly Report" : "Export Annual Report";

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
      await startPrint({
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
      // Registration & identity (TCL PN PP cols 1,2,5,7)
      date_of_registration: form.dateOfRegistration || null,
      family_serial_no: form.familySerialNo || "",
      socio_economic_status: form.socioEconomicStatus || "",
      gravida: form.gravida === "" || form.gravida === null || form.gravida === undefined ? null : Number(form.gravida),
      para: form.para === "" || form.para === null || form.para === undefined ? null : Number(form.para),
      // Immunization status (col 10) — assemble Td/TT dose map
      tt_td_doses: {
        ...(form.td1Date ? { td1: form.td1Date } : {}),
        ...(form.td2Date ? { td2: form.td2Date } : {}),
        ...(form.td3Date ? { td3: form.td3Date } : {}),
        ...(form.td4Date ? { td4: form.td4Date } : {}),
        ...(form.td5Date ? { td5: form.td5Date } : {}),
      },
      fim_status: Boolean(form.fimStatus),
      // Micronutrient supplementation (col 11) + deworming (col 13)
      prenatal_micronutrients: {
        ...(form.prenatalIronFolicTablets !== "" && form.prenatalIronFolicTablets != null ? { iron_folic_tablets: Number(form.prenatalIronFolicTablets) } : {}),
        ...(form.calciumTablets !== "" && form.calciumTablets != null ? { calcium_tablets: Number(form.calciumTablets) } : {}),
      },
      iodine_given_date: form.iodineGivenDate || null,
      deworming_date: form.dewormingDate || null,
      // Infectious disease surveillance (col 14)
      syphilis_screen_date: form.syphilisScreenDate || null,
      syphilis_result: form.syphilisResult || "",
      hepb_screen_date: form.hepbScreenDate || null,
      hepb_result: form.hepbResult || "",
      hiv_screen_date: form.hivScreenDate || null,
      // Laboratory screening (col 15)
      gdm_screen_date: form.gdmScreenDate || null,
      gdm_result: form.gdmResult || "",
      cbc_screen_date: form.cbcScreenDate || null,
      cbc_result: form.cbcResult || "",
      cbc_iron_given: Boolean(form.cbcIronGiven),
      // Pregnancy outcome (col 16)
      pregnancy_outcome: form.pregnancyOutcome || "",
      pregnancy_outcome_date: form.pregnancyOutcomeDate || null,
      newborn_sex: form.newbornSex || "",
      type_of_delivery: form.typeOfDelivery || "",
      delivery_date: form.deliveryDate || null,
      delivery_time: form.deliveryTime || "",
      delivery_outcome: form.deliveryOutcome || "",
      birth_weight: form.birthWeight || "",
      birth_weight_class: form.birthWeightClass || "",
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
      {cameFromTcl && <BackToTclButton />}
      {isMaternalTclRoute ? (
        <PageHeader
          crumbs={cameFromTcl
            ? [{ label: "Records", to: "../tcls" }, { label: "TCL", to: "../tcls" }, "Prenatal and Postpartum"]
            : ["M1"]}
          title="Prenatal and Postpartum"
          subtitle={
            assignedBarangay
              ? `Prenatal and postpartum records for Brgy. ${assignedBarangay}.`
              : "Prenatal and postpartum records for your assigned barangay."
          }
        />
      ) : (
        /* Monthly Health Services — formal M1 consolidated report masthead,
           rendered through the shared PageHeader using the report variant so
           the institutional navy/gold banner stays consistent with every other
           page header while keeping the Official Record / M1 labels and the
           Export action. */
        <PageHeader
          variant="report"
          eyebrow="M1 Consolidated Report"
          title="Monthly Health Services"
          subtitle={`Consolidated recording of barangay health-service delivery for FHSIS Form M1 statutory reporting${assignedBarangay ? ` — Brgy. ${assignedBarangay}` : ""}.`}
          action={
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-btn border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-50 md:w-auto"
              title={`Export the official FHSIS Form M1 for ${periodLabel} (Save as PDF)`}
            >
              <Download className="h-4 w-4" /> {exporting ? "Preparing…" : exportLabel}
            </button>
          }
        />
      )}

      {brandingError && <Card role="alert" className="mb-4 p-3 text-sm text-brand-danger">{brandingError}</Card>}

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
          {!isMaternalTclRoute && (
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-btn border border-brand-border bg-white px-3 py-2.5">
            <span className="mr-1 hidden text-[11px] font-semibold uppercase tracking-gov text-brand-gray sm:inline">Reporting Period</span>
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

            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-brand-blue/15 bg-brand-light px-3 py-1 text-xs font-medium text-brand-blue">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-blue" aria-hidden="true" />
              <span className="uppercase tracking-wide text-[10px] text-brand-blue/70">Active</span>
              {periodLabel}
            </span>
          </div>
          )}

          {/* Health Services — standardized service summary + M1 reporting entry. */}
          {activeSection === null && (
            <HealthServicesSummary
              periodLabel={periodLabel}
              period={period}
              countsBySection={sectionCounts || {}}
              countsLoading={countsLoading}
              countsError={countsError}
              onRetryCounts={() => {
                setSectionCounts(null);
                setCountsError(null);
                setCountsLoading(true);
                m1Api
                  .report(toReportParams(descriptor))
                  .then((res) => {
                    const byCode = res?.byCode || {};
                    const totals = {};
                    for (const row of Object.values(byCode)) {
                      const key = row?.section;
                      if (!key) continue;
                      if (Number(row.total) > 0) totals[key] = (totals[key] || 0) + 1;
                    }
                    setSectionCounts(totals);
                    setCountsError(null);
                  })
                  .catch((err) => setCountsError(err?.message || "Unable to load record counts."))
                  .finally(() => setCountsLoading(false));
              }}
              onOpenService={openService}
            />
          )}

          {/* Non-maternal section workspace (live indicator values + reporting input) */}
          {activeSection && activeSection !== "B" && (
            <M1SectionPanel
              sectionKey={activeSection}
              sectionTitle={HEALTH_SERVICE_TITLES[activeSection] || "FHSIS Section"}
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
              {!isMaternalTclRoute && (
                <button onClick={() => setActiveSection(null)} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
                  <ChevronLeft className="h-4 w-4" /> Health Services
                </button>
              )}
              <div>
                <h3 className="font-semibold text-brand-ink">{isMaternalTclRoute ? "Prenatal and Postpartum Records" : "Maternal Care Records"}</h3>
                <p className="text-xs text-brand-gray">
                  {isMaternalTclRoute
                    ? "Individual maternal cases with prenatal, delivery, and postpartum follow-up details."
                    : "Individual maternal cases — the operational source for FHSIS Section B."}
                </p>
              </div>
            </div>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              <Plus className="h-4 w-4" /> New Maternal Record
            </button>
          </div>

          {!isMaternalTclRoute && (
          <>
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
          </>
          )}

          {/* Participants table */}
          <Card className="mt-6 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border px-5 py-4">
              <div>
                <h3 className="font-semibold text-brand-ink">{isMaternalTclRoute ? "Prenatal and Postpartum Records" : "M1 / Maternal Participants"}</h3>
                <p className="text-xs text-brand-gray">
                  {isMaternalTclRoute
                    ? `${participants.length} maternal record${participants.length === 1 ? "" : "s"} shown.`
                    : `Residents with maternal records for ${periodLabel} — ${participants.length} shown.`}
                </p>
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
                <h4 className="mt-4 text-base font-semibold text-brand-ink">
                  {isMaternalTclRoute ? "No prenatal or postpartum records found" : `No M1 participants for ${periodLabel}`}
                </h4>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
                  {records.length === 0
                    ? (assignedBarangay
                        ? `No maternal records have been recorded for Brgy. ${assignedBarangay} yet.`
                        : "No maternal records have been recorded yet.")
                    : isMaternalTclRoute
                      ? "No maternal records match this filter."
                      : "No maternal records match this period or filter."}
                </p>
                {(search.trim() !== "" || statusFilter !== "All") && (
                  <button
                    onClick={() => { setSearch(""); setStatusFilter("All"); }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue"
                  >
                    <X className="h-3.5 w-3.5" /> Reset filters
                  </button>
                )}
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
