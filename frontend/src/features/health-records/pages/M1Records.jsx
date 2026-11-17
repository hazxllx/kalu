import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import TclPageHeader from "@/features/health-records/components/TclPageHeader";
import M1ReportingPeriod from "@/features/health-records/components/M1ReportingPeriod";
import { TclToolbar } from "@/features/health-records/components/TclToolbar";
import TclEmptyState from "@/features/health-records/components/TclEmptyState";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import DataTable from "@/components/tables/DataTable";
import TablePagination from "@/components/tables/TablePagination";
import { SkeletonTable } from "@/components/system/Skeleton";
import {
  Pencil, CheckCircle2, Download, Trash2,
} from "lucide-react";
import { maternalApi, maternalVisitsApi, m1Api, m1ProgramsApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import OfflineCacheNotice from "@/features/offline/components/OfflineCacheNotice";
import {
  listMaternalOffline,
  listMaternalVisitsOffline,
  getM1ReportOffline,
  getM1MetaOffline,
  loadM1ProgramCountsOffline,
} from "@/services/offline/clinicalOfflineService";
import { listResidentsOffline } from "@/services/offline/residentOfflineService";
import { classifySyncError, SYNC_ERROR } from "@/services/offline/errors";
import { isHealthSupervisor, getSupervisorScope } from "@/lib/supervisorScope";
import { availableYears, followUpStatus } from "@/features/health-records/lib/m1Analytics";
import {
  periodLabel as makePeriodLabel, fhsisPeriodLabel, toReportParams,
  PERIOD_TYPES, quarterOfMonth0, reportingYearOptions,
} from "@/features/health-records/lib/reportingPeriod";
import { useM1OfficialPrint } from "@/features/health-records/components/M1OfficialForm";
import { useMaternalRecordPrint } from "@/features/health-records/components/MaternalRecordPrint";
import M1ModuleGrid from "@/features/health-records/components/M1ModuleGrid";
import {
  WorkflowSelector,
  RegisterPregnancyForm,
  RecordEncounterForm,
  DeliveryRecordForm,
  PostpartumFollowUpForm,
} from "@/features/health-records/components/MaternalRecordWorkflow";
import MaternalRecordEditor from "@/features/health-records/components/MaternalRecordEditor";
import {
  buildCreateMaternalPayload,
  buildEditMaternalHeaderPatch,
} from "@/features/health-records/lib/maternalPayloads";
import { buildMaternalCsv, downloadCsv } from "@/features/health-records/lib/programFormExport";

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

// Single-select button-group option sets. Values mirror the previous <select> options
// exactly so the backend payload, DB values and reporting mappings stay unchanged.
// No placeholder ("—") option: an empty form value simply renders nothing selected.
const asOpts = (arr) => arr.map((o) => ({ value: o, label: o }));
const GDM_RESULT_OPTS = [{ value: "+", label: "+ positive" }, { value: "-", label: "- negative" }];
const POS_NEG_OPTS = [{ value: "+", label: "+ positive" }, { value: "-", label: "- negative" }];
const CBC_RESULT_OPTS = [{ value: "+", label: "+ with anemia" }, { value: "-", label: "- without anemia" }];
const DELIVERY_OUTCOME_OPTS = asOpts(DELIVERY_OUTCOMES);
const DELIVERY_TYPE_OPTS = asOpts(DELIVERY_TYPES);
const DELIVERY_PLACE_OPTS = asOpts(DELIVERY_PLACES);
const BIRTH_ATTENDANT_OPTS = asOpts(BIRTH_ATTENDANTS);
const BIRTH_WEIGHT_CLASS_OPTS = [
  { value: "low", label: "Low (< 2,500 g)" },
  { value: "normal", label: "Normal (\u2265 2,500 g)" },
  { value: "unknown", label: "Unknown" },
];
const PREGNANCY_OUTCOME_OPTS = [
  { value: "FT", label: "FT - Full Term" },
  { value: "PT", label: "PT - Pre-term" },
  { value: "FD", label: "FD - Fetal Death" },
  { value: "AB", label: "AB - Abortion/Miscarriage" },
];
const NEWBORN_SEX_OPTS = [{ value: "M", label: "Male" }, { value: "F", label: "Female" }];
const SES_OPTS = [
  { value: "", label: "Not Specified" },
  { value: "NHTS", label: "1 - NHTS" },
  { value: "Non-NHTS", label: "2 - Non-NHTS" },
];

const saveMaternalEncounter = async (recordId, recordPatch, visit) => {
  await maternalApi.update(recordId, recordPatch);
  try {
    await maternalVisitsApi.create(visit);
  } catch (error) {
    const reason = error?.message ? ` ${error.message}` : "";
    throw new Error(`The maternal record was updated, but encounter history was not saved.${reason}`);
  }
};

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
  fimStatus: row.fim_status ?? null,
  ttTdDoses: row.tt_td_doses || {},
  prenatalMicronutrients: row.prenatal_micronutrients || {},
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
  cbcIronGiven: row.cbc_iron_given ?? null,
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
  smokingHistory: row.smoking_history ?? null,
  bingeAlcohol: row.binge_alcohol ?? null,
  insufficientPhysicalActivity: row.insufficient_physical_activity ?? null,
  unhealthyDiet: row.unhealthy_diet ?? null,
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
  fimStatus: null,
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
  cbcIronGiven: null,
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
  smokingHistory: null,
  bingeAlcohol: null,
  insufficientPhysicalActivity: null,
  unhealthyDiet: null,
  bmi: "",
});

const YES_NO = [
  { value: false, label: "No" },
  { value: true, label: "Yes" },
];

/**
 * NOTE: Old MaternalFormModal removed and replaced with workflow-based approach
 * (RegisterPregnancyForm, RecordEncounterForm) from MaternalRecordWorkflow.jsx
 *
 * The new modals maintain full backward compatibility with the maternal_records
 * table and all existing fields. Data is still persisted to the same endpoints.
 */

export default function M1Records() {
  const { user } = useAuth();
  const { online, lastSyncedAt } = useSyncStatus();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMaternalTclRoute = location.pathname.replace(/\/+$/, "").endsWith("/maternal-tcl");

  const supervisor = isHealthSupervisor(user);
  const scope = supervisor ? getSupervisorScope(user) : null;
  const assignedBarangay = scope && scope.level === "barangay" ? scope.assignedBarangay : null;

  const [records, setRecords] = useState([]);
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false); // Show workflow selector
  const [workflowMode, setWorkflowMode] = useState(null); // 'register' | 'encounter' | null
  const [formMode, setFormMode] = useState("register"); // 'register' | 'edit'
  const [editingRecord, setEditingRecord] = useState(null); // For edit mode
  const [selectedResident, setSelectedResident] = useState(null);
  const [detail, setDetail] = useState(null);
  const [visitLoadError, setVisitLoadError] = useState(null);
  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(null); // record pending delete confirmation
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [moduleCounts, setModuleCounts] = useState({});
  const [moduleCountsLoading, setModuleCountsLoading] = useState(false);
  const [moduleCountsError, setModuleCountsError] = useState(null);
  const [moduleCountsRetry, setModuleCountsRetry] = useState(0);
  const [recordsCacheInfo, setRecordsCacheInfo] = useState({ source: null, cachedAt: null, stale: false });
  const [countsCacheInfo, setCountsCacheInfo] = useState({ source: null, cachedAt: null, stale: false });
  const { startPrint, portal, brandingError } = useM1OfficialPrint();
  const { startPrint: startMaternalPrint, portal: maternalPrintPortal } = useMaternalRecordPrint();

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // --- Monthly / Quarterly / Annual reporting controls --------------------
  const now = new Date();
  const [period, setPeriod] = useState(() => PERIOD_TYPES.includes(searchParams.get("period")) ? searchParams.get("period") : "monthly");
  const [year, setYear] = useState(() => {
    const value = Number(searchParams.get("year"));
    return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : now.getFullYear();
  });
  const [month, setMonth] = useState(() => {
    const value = Number(searchParams.get("month"));
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value - 1 : now.getMonth();
  });
  const [quarter, setQuarter] = useState(() => {
    const value = Number(searchParams.get("quarter"));
    return Number.isInteger(value) && value >= 1 && value <= 4 ? value : quarterOfMonth0(now.getMonth());
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;

  // Reset to the first page whenever the visible set changes.
  useEffect(() => { setPage(1); }, [period, year, month, quarter, search, statusFilter, isMaternalTclRoute]);

  const load = React.useCallback(() => {
    if (!user?.id) { setRecords([]); setResidents([]); setLoading(false); return Promise.resolve(); }
    setLoading(true);
    setLoadError(null);
    setRecordsCacheInfo({ source: null, cachedAt: null, stale: false });
    const loadResidents = async () => {
      try {
        return await listResidentsOffline({ ownerId: user.id, params: { limit: 200 } });
      } catch (err) {
        if (classifySyncError(err).code === SYNC_ERROR.NETWORK) return { rows: [] };
        throw err;
      }
    };
    return Promise.all([
      listMaternalOffline({ ownerId: user.id, fetchFn: () => maternalApi.list(), online: () => online }),
      loadResidents(),
    ])
      .then(([maternalResult, residentResult]) => {
        setRecords((maternalResult?.rows || []).map(mapRecord));
        setRecordsCacheInfo({
          source: maternalResult?.source || "server",
          cachedAt: maternalResult?.cachedAt ?? null,
          stale: Boolean(maternalResult?.stale),
        });
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
  }, [assignedBarangay, user?.id, online]);

  const openDetail = async (record) => {
    setVisitLoadError(null);
    setDetail({ ...record, visits: [] });
    if (!user?.id) return;
    try {
      const result = await listMaternalVisitsOffline({
        ownerId: user.id,
        params: { residentId: record.residentId },
        fetchFn: (params) => maternalVisitsApi.list(params),
        online: () => online,
      });
      const visits = (result?.rows || [])
        .filter((visit) => visit.maternal_case_id === record.id)
        .sort((a, b) => String(b.visit_date || "").localeCompare(String(a.visit_date || "")));
      const latestWeightVisit = visits.find((visit) => visit.weight != null);
      const latestHeightVisit = visits.find((visit) => visit.height_cm != null);
      setDetail((current) => current?.id === record.id ? {
        ...record,
        visits,
        latestWeightKg: latestWeightVisit?.weight ?? null,
        latestHeightCm: latestHeightVisit?.height_cm ?? null,
      } : current);
    } catch (error) {
      setVisitLoadError(error?.message || "Could not load maternal encounter history.");
    }
  };

  useEffect(() => {
    if (isMaternalTclRoute) load();
    else setLoading(false);
  }, [isMaternalTclRoute, load]);

  // Program endpoints apply the authenticated server scope and the same period
  // semantics as their detail pages. Never turn a failed count into a valid zero.
  useEffect(() => {
    if (isMaternalTclRoute) return undefined;
    if (!user?.id) { setModuleCounts({}); setModuleCountsLoading(false); return undefined; }
    let active = true;
    setModuleCountsLoading(true);
    setModuleCountsError(null);
    setCountsCacheInfo({ source: null, cachedAt: null, stale: false });
    const params = toReportParams({ period, year, month, quarter });

    loadM1ProgramCountsOffline({ ownerId: user.id, params, clients: m1ProgramsApi, online: () => online })
      .then(({ counts, source, cachedAt, stale }) => {
        if (!active) return;
        setModuleCounts(counts);
        setCountsCacheInfo({ source, cachedAt: cachedAt ?? null, stale: Boolean(stale) });
      })
      .catch((err) => {
        if (!active) return;
        setModuleCounts({});
        setModuleCountsError(err?.message || "Unable to load health program record counts.");
      })
      .finally(() => {
        if (active) setModuleCountsLoading(false);
      });
    return () => { active = false; };
  }, [period, year, month, quarter, isMaternalTclRoute, moduleCountsRetry, user?.id, online]);

  // --- Derived reporting data (pure; from loaded records) -----------------
  const descriptor = useMemo(() => ({ period, year, month, quarter }), [period, year, month, quarter]);
  const yearsList = useMemo(() => {
    return [...new Set([...availableYears(records), ...reportingYearOptions(year)])].sort((a, b) => b - a);
  }, [records, year]);
  const syncPeriodQuery = (next) => {
    const params = toReportParams({ ...descriptor, ...next });
    const updated = new URLSearchParams(searchParams);
    updated.set("period", params.period);
    updated.set("year", String(params.year));
    if (params.period === "monthly") updated.set("month", String(params.month));
    else updated.delete("month");
    if (params.period === "quarterly") updated.set("quarter", String(params.quarter));
    else updated.delete("quarter");
    setSearchParams(updated, { replace: true });
  };
  const changePeriod = (value) => { setPeriod(value); syncPeriodQuery({ period: value }); };
  const changeYear = (value) => { setYear(value); syncPeriodQuery({ year: value }); };
  const changeMonth = (value) => { setMonth(value); syncPeriodQuery({ month: value }); };
  const changeQuarter = (value) => { setQuarter(value); syncPeriodQuery({ quarter: value }); };
  const moduleQuery = new URLSearchParams(toReportParams(descriptor)).toString();

  const participants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .filter((r) => !q || `${r.residentName} ${r.residentId}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.recordedAt || "").localeCompare(String(a.recordedAt || "")));
  }, [records, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(participants.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pagedParticipants = participants.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const handleMaternalExport = () => {
    if (!records.length) {
      showToast("No records to export.");
      return;
    }
    downloadCsv(`prenatal-postpartum-${new Date().toISOString().slice(0, 10)}.csv`, buildMaternalCsv(records));
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
      const [reportRes, metaRes] = await Promise.all([
        getM1ReportOffline({
          ownerId: user?.id,
          params,
          fetchFn: () => m1Api.report(params),
          online: () => online,
        }),
        getM1MetaOffline({
          ownerId: user?.id,
          params: { year, month: metaMonth },
          fetchFn: (p) => m1Api.getMeta(p),
          online: () => online,
        }).catch(() => null),
      ]);
      const reportData = reportRes?.data;
      const metaData = metaRes?.data;
      await startPrint({
        data: reportData?.byCode || {},
        header: {
          periodLabel: fhsisPeriodLabel(descriptor),
          year,
          municipality: metaData?.municipality || "",
          province: metaData?.province || "",
          projectedPopulation: metaData?.meta?.projected_population ?? "",
          barangay: metaData?.barangay?.name || assignedBarangay || "",
          preparedBy: metaData?.meta?.prepared_by || "",
        },
      });
    } catch (err) {
      showToast(err?.message || "Could not generate the M1 report.");
    } finally {
      setExporting(false);
    }
  };

  const openCreate = () => {
    setWorkflowOpen(true);
    setWorkflowMode(null);
    setFormMode("register");
    setEditingRecord(null);
    setSelectedResident(null);
  };

  const openEdit = (record) => {
    setWorkflowOpen(true);
    setWorkflowMode("register");
    setFormMode("edit");
    setEditingRecord(record);
    // For edit mode, we don't need selectedResident since it's already in the record
    setSelectedResident(null);
  };
  const openMaternalWorkflow = (mode, record = null) => {
    const resident = record
      ? residents.find((candidate) => candidate.id === record.residentId)
      : null;
    if (record && !resident) {
      showToast("Could not load the resident for this maternal record.");
      return;
    }
    setWorkflowOpen(true);
    setWorkflowMode(mode);
    setFormMode("register");
    setEditingRecord(record);
    setSelectedResident(resident);
    setDetail(null);
  };
  const closeMaternalWorkflow = () => {
    setWorkflowOpen(false);
    setWorkflowMode(null);
    setFormMode("register");
    setEditingRecord(null);
    setSelectedResident(null);
  };
  const handleWorkflowSelect = (mode) => {
    setWorkflowMode(mode); // 'register' | 'encounter'
  };

  const handleRegisterPregnancy = async (form) => {
    setSaving(true);
    try {
      if (formMode === "edit" && editingRecord) {
        // Send only modified pregnancy header fields so existing prenatal visits,
        // TT/Td doses, screenings, delivery, and postpartum milestones stay intact.
        const patch = buildEditMaternalHeaderPatch(form, editingRecord);
        if (Object.keys(patch).length > 0) {
          await maternalApi.update(editingRecord.id, patch);
          showToast("Pregnancy record updated.");
        } else {
          showToast("No changes to save.");
        }
      } else {
        // Create new record
        const payload = buildCreateMaternalPayload(form);
        await maternalApi.create({ residentId: selectedResident.id, ...payload });
        showToast("Pregnancy registered.");
      }
      await load();
      setWorkflowOpen(false);
      setWorkflowMode(null);
      setFormMode("register");
      setEditingRecord(null);
      setSelectedResident(null);
      setDetail(null);
    } catch (err) {
      showToast(err?.message || (formMode === "edit" ? "Could not update pregnancy record." : "Could not register pregnancy."));
    } finally {
      setSaving(false);
    }
  };

  const handleRecordEncounter = async (form) => {
    if (!selectedResident) return;
    const maternalCase = records.find((record) => record.id === editingRecord?.id)
      || records.find((record) => record.residentId === selectedResident.id && record.status === "Active")
      || records.find((record) => record.residentId === selectedResident.id);
    if (!maternalCase) {
      showToast("Register an active pregnancy before recording an encounter.");
      return;
    }
    const hasSystolic = String(form.systolicBp || "").trim();
    const hasDiastolic = String(form.diastolicBp || "").trim();
    if (Boolean(hasSystolic) !== Boolean(hasDiastolic)) {
      showToast("Enter both systolic and diastolic blood pressure values.");
      return;
    }
    const notes = [
      form.clinicalFindings ? `Clinical findings: ${form.clinicalFindings}` : "",
      form.assessment ? `Assessment: ${form.assessment}` : "",
      form.carePlan ? `Care plan: ${form.carePlan}` : "",
      form.nextVisitDate ? `Next visit: ${form.nextVisitDate}` : "",
    ].filter(Boolean).join("\n");
    const doseUpdates = Object.fromEntries(
      ["td1Date", "td2Date", "td3Date", "td4Date", "td5Date"]
        .map((key, index) => [`td${index + 1}`, form[key]])
        .filter(([, value]) => value),
    );
    const micronutrientUpdates = {
      ...(form.ironFolicTablets !== "" ? { iron_folic_tablets: Number(form.ironFolicTablets) } : {}),
      ...(form.calciumTablets !== "" ? { calcium_tablets: Number(form.calciumTablets) } : {}),
    };
    const maternalPatch = {
      prenatal_visits: Number(maternalCase.prenatalVisits || 0) + 1,
      ...(Object.keys(doseUpdates).length ? { tt_td_doses: { ...maternalCase.ttTdDoses, ...doseUpdates } } : {}),
      ...(Object.keys(micronutrientUpdates).length ? {
        prenatal_micronutrients: { ...maternalCase.prenatalMicronutrients, ...micronutrientUpdates },
      } : {}),
      ...(form.fimStatus !== "" ? { fim_status: form.fimStatus === "true" } : {}),
      ...(form.iodineGivenDate ? { iodine_given_date: form.iodineGivenDate } : {}),
      ...(form.dewormingDate ? { deworming_date: form.dewormingDate } : {}),
      ...(form.syphilisScreenDate ? { syphilis_screen_date: form.syphilisScreenDate } : {}),
      ...(form.syphilisResult ? { syphilis_result: form.syphilisResult } : {}),
      ...(form.hepbScreenDate ? { hepb_screen_date: form.hepbScreenDate } : {}),
      ...(form.hepbResult ? { hepb_result: form.hepbResult } : {}),
      ...(form.hivScreenDate ? { hiv_screen_date: form.hivScreenDate } : {}),
      ...(form.gdmScreenDate ? { gdm_screen_date: form.gdmScreenDate } : {}),
      ...(form.gdmResult ? { gdm_result: form.gdmResult } : {}),
      ...(form.cbcScreenDate ? { cbc_screen_date: form.cbcScreenDate } : {}),
      ...(form.cbcResult ? { cbc_result: form.cbcResult } : {}),
      ...(form.cbcIronGiven !== "" ? { cbc_iron_given: form.cbcIronGiven === "true" } : {}),
    };
    const weight = form.weight === "" ? null : Number(form.weight);
    const height = form.height === "" ? null : Number(form.height);
    const weightForBmi = weight ?? Number(editingRecord?.latestWeightKg);
    const heightForBmi = height ?? Number(editingRecord?.latestHeightCm);
    if (weightForBmi > 0 && heightForBmi > 0) {
      maternalPatch.bmi = Math.round((weightForBmi / ((heightForBmi / 100) ** 2)) * 100) / 100;
    }

    setSaving(true);
    try {
      await saveMaternalEncounter(maternalCase.id, maternalPatch, {
        residentId: selectedResident.id,
        maternalCaseId: maternalCase.id,
        visit_date: form.encounterDate,
        visit_type: "prenatal",
        blood_pressure: hasSystolic && hasDiastolic ? `${hasSystolic}/${hasDiastolic}` : "",
        weight,
        height_cm: height,
        provider: user?.name || "",
        notes,
        clinical_data: {
          prenatal: {
            ...form,
            bmi: maternalPatch.bmi ?? null,
          },
        },
      });
      await load();
      showToast("Maternal encounter recorded.");
      setWorkflowOpen(false);
      setWorkflowMode(null);
      setSelectedResident(null);
    } catch (err) {
      showToast(err?.message || "Could not record the maternal encounter.");
    } finally {
      setSaving(false);
    }
  };

  const handleRecordDelivery = async (form) => {
    if (!selectedResident) return;
    const maternalCase = records.find((record) => record.id === editingRecord?.id)
      || records.find((record) => record.residentId === selectedResident.id && record.status === "Active")
      || records.find((record) => record.residentId === selectedResident.id);
    if (!maternalCase) {
      showToast("Register a pregnancy before recording delivery.");
      return;
    }
    const payload = {
      delivery_date: form.deliveryDate,
      delivery_time: form.deliveryTime || "",
      delivery_outcome: form.deliveryOutcome,
      type_of_delivery: form.typeOfDelivery || "",
      place_of_delivery: form.placeOfDelivery || "",
      birth_attendant: form.birthAttendant || "",
      birth_weight: form.birthWeight || "",
      birth_weight_class: form.birthWeightClass || "",
      pregnancy_outcome: form.pregnancyOutcome || "",
      pregnancy_outcome_date: form.pregnancyOutcomeDate || null,
      newborn_sex: form.newbornSex || "",
      status: "Delivered",
    };
    setSaving(true);
    try {
      await saveMaternalEncounter(maternalCase.id, payload, {
        residentId: selectedResident.id,
        maternalCaseId: maternalCase.id,
        visit_date: form.deliveryDate,
        visit_type: "intrapartum",
        provider: user?.name || "",
        notes: `Delivery outcome: ${form.deliveryOutcome}`,
        clinical_data: { delivery: form },
      });
      await load();
      showToast("Delivery recorded.");
      setWorkflowOpen(false);
      setWorkflowMode(null);
      setSelectedResident(null);
      setEditingRecord(null);
    } catch (error) {
      showToast(error?.message || "Could not record delivery information.");
    } finally {
      setSaving(false);
    }
  };

  const handleRecordPostpartum = async (form) => {
    if (!selectedResident) return;
    const maternalCase = records.find((record) => record.id === editingRecord?.id)
      || records.find((record) => record.residentId === selectedResident.id && record.status === "Delivered")
      || records.find((record) => record.residentId === selectedResident.id);
    if (!maternalCase) {
      showToast("Register a pregnancy before recording a postpartum visit.");
      return;
    }
    const milestoneField = {
      "24h": "pp_checkup_24h",
      "3d": "pp_checkup_day3",
      "7-14d": "pp_checkup_7_14d",
      "6wk": "pp_checkup_6wk",
    }[form.milestone];
    const payload = {
      [milestoneField]: form.encounterDate,
      ...(form.ironFolicCompleted === "true" ? { iron_folic_completed_date: form.encounterDate } : {}),
      ...(form.vitaminAGiven === "true" ? { vitamin_a_given_date: form.encounterDate } : {}),
    };
    setSaving(true);
    try {
      await saveMaternalEncounter(maternalCase.id, payload, {
        residentId: selectedResident.id,
        maternalCaseId: maternalCase.id,
        visit_date: form.encounterDate,
        visit_type: "postpartum",
        provider: user?.name || "",
        notes: form.notes || "",
        clinical_data: {
          postpartum: {
            milestone: form.milestone,
            ironFolicCompleted: form.ironFolicCompleted === "" ? null : form.ironFolicCompleted === "true",
            vitaminAGiven: form.vitaminAGiven === "" ? null : form.vitaminAGiven === "true",
          },
        },
      });
      await load();
      showToast("Postpartum visit recorded.");
      setWorkflowOpen(false);
      setWorkflowMode(null);
      setSelectedResident(null);
      setEditingRecord(null);
    } catch (error) {
      showToast(error?.message || "Could not record the postpartum visit.");
    } finally {
      setSaving(false);
    }
  };

  const handleFullRecordEdit = async (form) => {
    setSaving(true);
    const payload = {
      lmp: form.lmp || null,
      edd: form.edd || null,
      prenatal_visits: form.prenatalVisits,
      risk: form.risk,
      status: form.status,
      provider: form.provider,
      notes: form.notes,
      date_of_registration: form.dateOfRegistration || null,
      family_serial_no: form.familySerialNo || "",
      socio_economic_status: form.socioEconomicStatus || "",
      gravida: form.gravida,
      para: form.para,
      tt_td_doses: {
        ...(form.td1Date ? { td1: form.td1Date } : {}),
        ...(form.td2Date ? { td2: form.td2Date } : {}),
        ...(form.td3Date ? { td3: form.td3Date } : {}),
        ...(form.td4Date ? { td4: form.td4Date } : {}),
        ...(form.td5Date ? { td5: form.td5Date } : {}),
      },
      fim_status: form.fimStatus === "" || form.fimStatus == null ? null : form.fimStatus === "true" || form.fimStatus === true,
      prenatal_micronutrients: {
        ...(form.prenatalIronFolicTablets !== "" && form.prenatalIronFolicTablets != null ? { iron_folic_tablets: Number(form.prenatalIronFolicTablets) } : {}),
        ...(form.calciumTablets !== "" && form.calciumTablets != null ? { calcium_tablets: Number(form.calciumTablets) } : {}),
      },
      iodine_given_date: form.iodineGivenDate || null,
      deworming_date: form.dewormingDate || null,
      syphilis_screen_date: form.syphilisScreenDate || null,
      syphilis_result: form.syphilisResult || "",
      hepb_screen_date: form.hepbScreenDate || null,
      hepb_result: form.hepbResult || "",
      hiv_screen_date: form.hivScreenDate || null,
      gdm_screen_date: form.gdmScreenDate || null,
      gdm_result: form.gdmResult || "",
      cbc_screen_date: form.cbcScreenDate || null,
      cbc_result: form.cbcResult || "",
      cbc_iron_given: form.cbcIronGiven === "" || form.cbcIronGiven == null ? null : form.cbcIronGiven === "true" || form.cbcIronGiven === true,
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
      smoking_history: form.smokingHistory === "" || form.smokingHistory == null ? null : form.smokingHistory === "true" || form.smokingHistory === true,
      binge_alcohol: form.bingeAlcohol === "" || form.bingeAlcohol == null ? null : form.bingeAlcohol === "true" || form.bingeAlcohol === true,
      insufficient_physical_activity: form.insufficientPhysicalActivity === "" || form.insufficientPhysicalActivity == null ? null : form.insufficientPhysicalActivity === "true" || form.insufficientPhysicalActivity === true,
      unhealthy_diet: form.unhealthyDiet === "" || form.unhealthyDiet == null ? null : form.unhealthyDiet === "true" || form.unhealthyDiet === true,
      bmi: form.bmi,
    };

    try {
      await maternalApi.update(detail.id, payload);
      await load();
      showToast("Maternal record updated successfully.");
      setDetail(null);
    } catch (err) {
      showToast(err?.message || "Could not update the maternal record.");
    } finally {
      setSaving(false);
    }
  };

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
      {isMaternalTclRoute ? <>
        <TclPageHeader
          crumb="Prenatal and Postpartum"
          title="Prenatal and Postpartum"
          subtitle={
            assignedBarangay
              ? `Prenatal and postpartum records for Brgy. ${assignedBarangay}.`
              : "Prenatal and postpartum records for your assigned barangay."
          }
        />
        <OfflineCacheNotice
          source={recordsCacheInfo.source}
          cachedAt={recordsCacheInfo.cachedAt}
          lastSyncedAt={lastSyncedAt}
          stale={recordsCacheInfo.stale}
          empty={records.length === 0}
          onRetry={load}
        />
        {loading ? <SkeletonTable rows={8} cols={8} className="ui-tcl-data-table" />
          : loadError ? <Card><ErrorState title="Unable to load maternal records" message={loadError} onRetry={load} /></Card>
            : <section aria-label="Prenatal and postpartum records">
              <TclToolbar
                onSearch={setSearch}
                searchValue={search}
                onFilter={setStatusFilter}
                filterValue={statusFilter}
                filterOptions={[{ value: "All", label: "All Status" }, ...STATUSES.map((status) => ({ value: status, label: status }))]}
                filterVariant="dropdown"
                filterLabel="Status"
                onExport={handleMaternalExport}
                onNew={openCreate}
                loading={saving}
              />
              {participants.length === 0 ? (
                <TclEmptyState
                  type={search.trim() || statusFilter !== "All" ? "filter" : "empty"}
                  title={!(search.trim() || statusFilter !== "All") && recordsCacheInfo.source === "cache" && records.length === 0 ? "No saved records available offline." : "No prenatal or postpartum records found"}
                  description={records.length === 0 ? (recordsCacheInfo.source === "cache" ? "Reconnect to load and save maternal records for offline viewing." : assignedBarangay ? `No maternal records have been recorded for Brgy. ${assignedBarangay} yet.` : "No maternal records have been recorded yet.") : "No maternal records match the selected filters."}
                  compact
                  action={(search.trim() || statusFilter !== "All") ? <button type="button" onClick={() => { setSearch(""); setStatusFilter("All"); }} className="ui-tcl-control ui-tcl-control-secondary">Reset filters</button> : null}
                />
              ) : <>
                <DataTable
                  rows={pagedParticipants}
                  dense compact striped mobileCards stickyHeader maxHeight="clamp(24rem, calc(100dvh - 18rem), 68vh)"
                  className="ui-tcl-data-table !rounded-card !shadow-none"
                  tableClassName="min-w-[64rem]"
                  columns={[
                    { key: "resident", label: "Resident", wrap: true, render: (record) => <button type="button" onClick={() => openDetail(record)} className="text-left"><span className="block font-medium text-brand-blue hover:underline">{record.residentName}</span><span className="block text-xs text-brand-gray">{record.residentId}</span></button> },
                    { key: "age", label: "Age", render: (record) => ageOf(record.residentBirthDate) },
                    { key: "barangay", label: "Barangay", wrap: true, render: (record) => record.barangay || "Not recorded" },
                    { key: "status", label: "Status", render: (record) => <StatusBadge value={record.status} /> },
                    { key: "recordedAt", label: "First Recorded", render: (record) => String(record.recordedAt || "").slice(0, 10) || "Not recorded" },
                    { key: "updatedAt", label: "Latest Update", render: (record) => String(record.updatedAt || "").slice(0, 10) || "Not recorded" },
                    { key: "followUp", label: "Follow-up", wrap: true, render: followUpStatus },
                    { key: "actions", label: "Actions", align: "right", render: (record) => <div className="flex justify-end gap-2"><button type="button" onClick={() => openDetail(record)} className="ui-tcl-control ui-tcl-control-secondary !min-h-9 !px-2.5 !text-xs">View</button><button type="button" onClick={() => openEdit(record)} className="ui-tcl-control ui-tcl-control-secondary !min-h-9 !px-2.5 !text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</button></div> },
                  ]}
                />
                {participants.length > PAGE_SIZE && <TablePagination total={participants.length} page={pageSafe} pageSize={PAGE_SIZE} onPageChange={setPage} className="mt-3" />}
              </>}
            </section>}
      </> : (
        <M1ModuleGrid
          countsByModule={moduleCounts}
          loading={moduleCountsLoading}
          countError={moduleCountsError}
          query={moduleQuery}
          crumbs={["Clinical Care", "M1"]}
          subtitle="Review M1 program records and indicators."
          context={(
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <M1ReportingPeriod
                variant="directory"
                period={period}
                year={year}
                month={month}
                quarter={quarter}
                years={yearsList}
                onPeriodChange={changePeriod}
                onYearChange={changeYear}
                onMonthChange={changeMonth}
                onQuarterChange={changeQuarter}
              />
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                title={`Export the official FHSIS Form M1 for ${periodLabel} (Save as PDF)`}
                className="ui-tcl-control ui-tcl-control-primary shrink-0"
              >
                <Download className="h-4 w-4" />
                {exporting ? "Preparing..." : exportLabel}
              </button>
            </div>
          )}
          notices={(brandingError || moduleCountsError || countsCacheInfo.source === "cache") ? (
            <>
              {countsCacheInfo.source === "cache" && (
                <OfflineCacheNotice
                  source={countsCacheInfo.source}
                  cachedAt={countsCacheInfo.cachedAt}
                  lastSyncedAt={lastSyncedAt}
                  stale={countsCacheInfo.stale}
                  empty={Object.keys(moduleCounts).length === 0}
                  className="!mb-0"
                />
              )}
              {brandingError && (
                <div role="alert" className="border border-brand-danger/30 bg-brand-paper px-4 py-3 text-sm text-brand-danger dark:bg-card">
                  {brandingError}
                </div>
              )}
              {moduleCountsError && (
                <div role="alert" className="flex flex-col gap-3 border border-brand-border bg-brand-paper px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-border dark:bg-card">
                  <div>
                    <p className="font-semibold text-brand-ink dark:text-foreground">Program counts unavailable</p>
                    <p className="mt-0.5 text-xs text-brand-gray dark:text-muted-foreground">{moduleCountsError}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModuleCountsRetry((value) => value + 1)}
                    className="shrink-0 border border-brand-border bg-white px-3 py-2 text-xs font-semibold text-brand-blue hover:border-brand-blue dark:border-border dark:bg-card dark:text-primary"
                  >
                    Retry counts
                  </button>
                </div>
              )}
            </>
          ) : null}
          countNote="Record counts are supplied by each program's scoped data source."
        />
      )}

      {toast && <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg"><CheckCircle2 className="h-4 w-4 text-brand-green" /><span className="text-sm">{toast}</span></div>}

       {/* Maternal Record Details & Edit Modal */}
       {detail && (
         <MaternalRecordEditor
           detail={detail}
           onClose={() => { setDetail(null); setVisitLoadError(null); }}
           onDelete={(record) => setDeleting(record)}
           onPrint={(record) => startMaternalPrint(record)}
           onEditMode={handleFullRecordEdit}
           onRecordEncounter={(record) => openMaternalWorkflow("encounter", record)}
           onRecordDelivery={(record) => openMaternalWorkflow("delivery", record)}
           onRecordPostpartum={(record) => openMaternalWorkflow("postpartum", record)}
           visitLoadError={visitLoadError}
           saving={saving}
         />
       )}

      {/* New maternal record workflow */}
      {workflowOpen && !workflowMode && formMode === "register" && (
        <WorkflowSelector
          residents={residents}
          loading={saving}
          onSelectRegister={() => handleWorkflowSelect("register")}
          onSelectEncounter={() => handleWorkflowSelect("encounter")}
          onSelectDelivery={() => handleWorkflowSelect("delivery")}
          onSelectPostpartum={() => handleWorkflowSelect("postpartum")}
          onClose={closeMaternalWorkflow}
        />
      )}

      {workflowOpen && workflowMode === "register" && (
        <RegisterPregnancyForm
          mode={formMode}
          initial={editingRecord}
          resident={selectedResident}
          residents={residents}
          saving={saving}
          onClose={closeMaternalWorkflow}
          onSave={handleRegisterPregnancy}
          onSelectResident={setSelectedResident}
        />
      )}

      {workflowOpen && workflowMode === "encounter" && (
        <RecordEncounterForm
          resident={selectedResident}
          residents={residents}
          saving={saving}
          initialRecord={editingRecord}
          onClose={closeMaternalWorkflow}
          onSave={handleRecordEncounter}
          onSelectResident={setSelectedResident}
        />
      )}
      {workflowOpen && workflowMode === "delivery" && (
        <DeliveryRecordForm
          resident={selectedResident}
          residents={residents}
          initialRecord={editingRecord}
          saving={saving}
          onClose={closeMaternalWorkflow}
          onSave={handleRecordDelivery}
          onSelectResident={setSelectedResident}
        />
      )}
      {workflowOpen && workflowMode === "postpartum" && (
        <PostpartumFollowUpForm
          resident={selectedResident}
          residents={residents}
          initialRecord={editingRecord}
          saving={saving}
          onClose={closeMaternalWorkflow}
          onSave={handleRecordPostpartum}
          onSelectResident={setSelectedResident}
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
