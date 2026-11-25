import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import TablePagination from "@/components/tables/TablePagination";
import DateRangeFilter, { matchesDateRange } from "@/components/common/DateRangeFilter";
import {
  ChevronDown,
  Loader2,
  RotateCcw,
  Download,
  X,
} from "lucide-react";
import { residentsApi, visitPlansApi, referralsApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { openReferralPdf } from "@/features/referrals/lib/referralPdf";
import { downloadHealthRecordPdf, medicalHistoryForRecord } from "@/features/health-records/lib/healthRecordPdf";
import { shouldShowPregnancyStatus } from "@/features/health-records/lib/pregnancyVisibility";
import LabResultsPanel from "@/features/health-records/components/LabResultsPanel";
import { formatLongDate } from "@/lib/dateUtils";
import RiskBadge from "@/components/common/RiskBadge";
import { consultationBloodPressureClassification, consultationRiskLevel, consultationRiskReasons, consultationServiceName } from "@/features/consultations/lib/consultationRisk";
import { bloodPressureBadgeClassName } from "@/features/consultations/utils/bpClassification";

// Uploaded laboratory files are listed separately and are not embedded in PDF exports.
const labs = [];

const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);

const referralDisplayValue = (value) => {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const items = value.map(referralDisplayValue).filter((item) => item !== "Not recorded");
    return items.length ? items.join(", ") : "Not recorded";
  }
  if (typeof value === "object") {
    return referralDisplayValue(value.label ?? value.name ?? value.value ?? value.key);
  }
  return String(value);
};

function ServiceRecordDetail({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-brand-gray">{label}</p>
      <p className="mt-1 whitespace-pre-line break-words text-sm leading-5 text-brand-ink">{value}</p>
    </div>
  );
}

const formatDate = (iso) => {
  return formatLongDate(iso) || "—";
};

/** Build the vital-sign display from the consultation's backend-validated values. */
const vitalCards = (vitals = {}, bpClassification = null) => {
  const cards = [
    { label: "Blood Pressure", value: vitals.bloodPressure, unit: "mmHg", category: bpClassification?.category || bpClassification?.label },
    { label: "Temperature", value: vitals.temperature, unit: "°C" },
    { label: "Pulse Rate", value: vitals.pulseRate, unit: "bpm" },
    { label: "Respiratory Rate", value: vitals.respiratoryRate, unit: "breaths/min" },
    { label: "Oxygen Saturation", value: vitals.oxygenSaturation, unit: "%" },
    { label: "Height", value: vitals.height, unit: "cm" },
    { label: "Weight", value: vitals.weight, unit: "kg" },
    { label: "BMI", value: vitals.bmi, unit: "", category: vitals.bmiCategory },
  ];
  return cards.filter((c) => c.value !== null && c.value !== undefined && c.value !== "");
};

/* ------------------------------------------------------------------------- */
/* Consultation History filters                                              */
/* ------------------------------------------------------------------------- */

const emptyFilters = () => ({ from: "", to: "", serviceId: "", type: "", status: "" });

const filtersActive = (f) => Boolean(f.from || f.to || f.serviceId || f.type || f.status);

const selectCls =
  "h-9 w-full rounded-btn border border-brand-border bg-white px-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:border-border dark:bg-input";

const compactLabel = "mb-1 block text-xs font-medium uppercase tracking-wide text-brand-gray";
const selectWrapCls = "relative";
const selectIconCls = "pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-gray";

const bmiBadgeClass = (category) => {
  const normalized = String(category || "").toLowerCase();
  if (normalized === "underweight") return "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700/50";
  if (normalized === "normal") return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50";
  if (normalized === "overweight") return "bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-700/50";
  if (normalized === "obese") return "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-700/50";
  return "";
};

const consultationFields = (consultation) => [
  [
    { label: "Chief Complaint", value: consultation.chiefComplaint },
    { label: "Findings", value: consultation.findings },
    { label: "Medications", value: consultation.medications, preserveLines: true },
    { label: "Health Service", value: consultationServiceName(consultation) },
    { label: "Risk Reasons", value: consultationRiskReasons(consultation), preserveLines: true },
  ],
  [
    { label: "Diagnosis", value: consultation.diagnosis },
    { label: "Treatment", value: consultation.treatmentGiven },
    { label: "Recommendations", value: consultation.recommendations },
    {
      label: "Follow-up",
      value: consultation.followUpRequired === "Yes"
        ? `Yes${consultation.nextVisitDate ? ` · ${formatDate(consultation.nextVisitDate)}` : ""}`
        : consultation.followUpRequired === "No" ? "No" : "",
    },
  ],
];

/** A date range is valid when both ends are dates and `to` is not before `from`. */
const dateRangeError = (from, to) => {
  if (from && to && from > to) return "The end date cannot be before the start date.";
  return "";
};

export default function HealthRecord() {
  const { user } = useAuth();
  const [resident, setResident] = useState(null);
  const [consultations, setConsultations] = useState([]);
  const [latestRecord, setLatestRecord] = useState(null);
  const historyRequest = useRef(0);
  const [vaccinations, setVaccinations] = useState([]);
  const [healthServiceRecords, setHealthServiceRecords] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [selectedReferralPdf, setSelectedReferralPdf] = useState("");
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  useEffect(() => {
    if (!selectedFollowUp) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSelectedFollowUp(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedFollowUp]);
  const [referralDetailLoading, setReferralDetailLoading] = useState(false);
  const [referralDownloadId, setReferralDownloadId] = useState("");
  const [referralActionError, setReferralActionError] = useState("");
  const [followUps, setFollowUps] = useState([]);
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportingRef = useRef(false);
  // Consultation History is consolidated into this page as a tab/subsection
  // rather than a separate sidebar entry.
  const [activeTab, setActiveTab] = useState("overview");
  const [referralPage, setReferralPage] = useState(1);
  const [referralPageSize, setReferralPageSize] = useState(8);
  const [consultationPage, setConsultationPage] = useState(1);
  const [consultationPageSize, setConsultationPageSize] = useState(8);

  // Consultation-history filters. Applied server-side (GET
  // /residents/me/health-records?from&to&serviceId&type&status); the backend
  // validates the range and re-checks ownership, so filtering is never a
  // frontend-only concern.
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [filterError, setFilterError] = useState("");

  // Health services (real records) for the service filter + type display.
  const [serviceOptions, setServiceOptions] = useState([]);
  const [historicalServiceOptions, setHistoricalServiceOptions] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState("");
  const serviceFilterOptions = useMemo(() => {
    const optionsById = new Map(serviceOptions.map((service) => [service.id, service]));
    for (const service of historicalServiceOptions) {
      if (!optionsById.has(service.id)) optionsById.set(service.id, service);
    }
    return [...optionsById.values()];
  }, [serviceOptions, historicalServiceOptions]);
  const consultationTypes = useMemo(
    () => [...new Set(serviceFilterOptions.map((service) => service.category).filter(Boolean))].sort(),
    [serviceFilterOptions],
  );

  const loadConsultations = useCallback((active) => {
    const request = ++historyRequest.current;
    setLoading(true);
    setError(null);
    const params = {};
    if (active.from) params.from = active.from;
    if (active.to) params.to = active.to;
    if (active.serviceId) params.serviceId = active.serviceId;
    if (active.type) params.type = active.type;
    if (active.status) params.status = active.status;
    return residentsApi
      .myHealthRecords(params)
      .then((data) => {
        // Keep the latest summary independent of history filters, including when
        // the initial request resolves after the resident selects a range.
        if (!filtersActive(active)) setLatestRecord(data);
        if (request !== historyRequest.current) return;
        setResident(data?.resident || null);
        const rows = Array.isArray(data?.consultations) ? data.consultations : [];
        setConsultations(rows);
        setVaccinations(Array.isArray(data?.vaccinations) ? data.vaccinations : []);
        setHealthServiceRecords(Array.isArray(data?.healthServiceRecords) ? data.healthServiceRecords : []);
        setReferrals(Array.isArray(data?.referrals) ? data.referrals : []);
        setFollowUps(Array.isArray(data?.followUps) ? data.followUps : []);
        setHistoricalServiceOptions((current) => {
          const known = new Map(current.map((service) => [service.id, service]));
          for (const row of rows) {
            if (row.serviceId && !known.has(row.serviceId)) {
              known.set(row.serviceId, {
                id: row.serviceId,
                name: row.serviceName || "Previously recorded health service",
                category: row.serviceCategory || "",
                active: false,
              });
            }
          }
          return [...known.values()];
        });
      })
      .catch((err) => {
        if (request !== historyRequest.current) return;
        setError(err?.message || "Could not load your health record. Please try again.");
        setConsultations([]);
        setVaccinations([]);
        setHealthServiceRecords([]);
        setReferrals([]);
        setFollowUps([]);
      })
      .finally(() => {
        if (request === historyRequest.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadConsultations(appliedFilters);
  }, [loadConsultations, appliedFilters]);

  useEffect(() => {
    setConsultationPage(1);
  }, [appliedFilters]);

  // Use the resident-facing, barangay/RHU-scoped directory. The staff catalog
  // endpoint is intentionally not available to resident accounts.
  useEffect(() => {
    let active = true;
    setServicesLoading(true);
    setServicesError("");
    visitPlansApi
      .directory()
      .then((res) => {
        if (!active) return;
        if (!Array.isArray(res?.facilities) || res.facilities.some((facility) => !Array.isArray(facility.services))) {
          throw new Error("The health-service directory response was invalid.");
        }
        const rows = res.facilities.flatMap((facility) => facility.services);
        setServiceOptions(rows);
      })
      .catch((err) => {
        if (active) {
          setServiceOptions([]);
          setServicesError(err?.message || "Could not load available health services.");
        }
      })
      .finally(() => {
        if (active) setServicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setFilter = (key) => (e) => {
    const value = e.target.value;
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      setFilterError(dateRangeError(next.from, next.to));
      return next;
    });
  };

  // Apply (or re-apply on any change) — the page refetches from the server so
  // sorting stays the server's newest-first order over the filtered set.
  const applyFilters = useCallback(() => {
    const rangeError = dateRangeError(filters.from, filters.to);
    if (rangeError) {
      setFilterError(rangeError);
      return;
    }
    setFilterError("");
    setAppliedFilters({ ...filters });
  }, [filters]);

  // Live-apply date/status/service/type changes; the debounce keeps typing in
  // the date inputs from firing a request per keystroke.
  useEffect(() => {
    if (!filtersActive(filters) && !filtersActive(appliedFilters)) return undefined;
    const t = setTimeout(() => {
      const rangeError = dateRangeError(filters.from, filters.to);
      if (rangeError) {
        setFilterError(rangeError);
        return;
      }
      setFilterError("");
      setAppliedFilters({ ...filters });
    }, 350);
    return () => clearTimeout(t);
  }, [filters.from, filters.to, filters.serviceId, filters.type, filters.status]);

  const resetFilters = () => {
    setFilters(emptyFilters());
    setAppliedFilters(emptyFilters());
    setFilterError("");
  };

  const latestVitals = useMemo(
    () => {
      const consultation = latestRecord?.consultations?.[0];
      return vitalCards(consultation?.vitals, consultation ? consultationBloodPressureClassification(consultation) : null);
    },
    [latestRecord],
  );
  const medicalHistory = medicalHistoryForRecord(latestRecord || {});

  // Pregnancy Status is suppressed only for residents explicitly recorded as
  // male. Female, "Other", and missing/unknown sex keep the field visible so an
  // unknown sex is never mistaken for male. Driven by the authoritative profile
  // `sex`, so it stays correct after load, refresh, and profile updates.
  const showPregnancyStatus = useMemo(
    () => shouldShowPregnancyStatus(resident?.sex),
    [resident?.sex],
  );

  const openReferral = useCallback(async (record) => {
    if (!record?.id || !user?.id) return;
    setReferralDetailLoading(true);
    setReferralActionError("");
    try {
      const data = await referralsApi.get(record.id, { ownerId: user.id, cache: "no-store" });
      setSelectedReferral(data?.record || record);
    } catch (err) {
      setReferralActionError(err?.message || "Could not load the selected referral.");
    } finally {
      setReferralDetailLoading(false);
    }
  }, [user?.id]);

  const viewReferralSlip = useCallback(async (record) => {
    if (!record?.id || !user?.id) return;
    setReferralDownloadId(record.id);
    setReferralActionError("");
    try {
      const data = await referralsApi.get(record.id, { ownerId: user.id, cache: "no-store" });
      if (!data?.record?.id) throw new Error("Could not load the saved referral.");
      const url = await openReferralPdf(data.record);
      if (!url) throw new Error("Could not generate the referral document.");
      setSelectedReferralPdf(String(url));
    } catch (err) {
      setReferralActionError(err?.message || "Could not open the referral slip.");
    } finally {
      setReferralDownloadId("");
    }
  }, [user?.id, referralDownloadId]);

  const closeReferralSlip = useCallback(() => {
    if (selectedReferralPdf?.startsWith("blob:")) URL.revokeObjectURL(selectedReferralPdf);
    setSelectedReferralPdf("");
  }, [selectedReferralPdf]);

  /**
   * Export the resident's own health record as a formatted PDF document. The
    * PDF is generated in the browser (jsPDF) from the records selected by the
    * history filters. Fetch again to include the current range.
   */
  const exportHealthRecord = useCallback(async () => {
    // Prevent overlapping / simultaneous exports.
    if (exportingRef.current) return;
    if (dateRangeError(filters.from, filters.to)) {
      setExportError(dateRangeError(filters.from, filters.to));
      return;
    }
    if (!resident && consultations.length === 0) {
      setExportError("Unable to export health record. Please try again.");
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    setExportError("");
    try {
      // Fetch the selected range directly so export never uses a pending
      // debounce or an older history response.
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const data = await residentsApi.myHealthRecords(params);
      await downloadHealthRecordPdf({
        resident: data?.resident || resident || {},
        consultations: data?.consultations || [],
        vaccinations: (data?.vaccinations || []).filter((item) => matchesDateRange(item.date, filters.from, filters.to)),
        healthServiceRecords: data?.healthServiceRecords || [],
        referrals: data?.referrals || [],
        labs,
        medicalHistory: medicalHistoryForRecord(data || {}),
      });
    } catch {
      setExportError("Unable to export health record. Please try again.");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [resident, consultations, filters]);

  const hasFilters = filtersActive(appliedFilters);
  const referralPageCount = Math.max(1, Math.ceil(referrals.length / referralPageSize));
  const visibleReferrals = referrals.slice(
    (referralPage - 1) * referralPageSize,
    referralPage * referralPageSize,
  );
  const consultationPageCount = Math.max(1, Math.ceil(consultations.length / consultationPageSize));
  const visibleConsultations = consultations.slice(
    (consultationPage - 1) * consultationPageSize,
    consultationPage * consultationPageSize,
  );
  const [serviceRecordPage, setServiceRecordPage] = useState(1);
  const [serviceRecordPageSize, setServiceRecordPageSize] = useState(8);
  const serviceRecordPageCount = Math.max(1, Math.ceil(healthServiceRecords.length / serviceRecordPageSize));
  const visibleServiceRecords = healthServiceRecords.slice(
    (serviceRecordPage - 1) * serviceRecordPageSize,
    serviceRecordPage * serviceRecordPageSize,
  );
  const recordTimeline = useMemo(() => [
    ...consultations.map((item) => ({
      id: `consultation-${item.id}`,
      category: "consultations",
      type: "Health consultation",
      date: item.date,
      detail: [item.chiefComplaint, item.diagnosis].filter(Boolean).join(" · ") || "Consultation recorded",
      tone: "blue",
    })),
    ...healthServiceRecords.map((item) => ({
      id: `service-${item.id}`,
      category: "consultations",
      type: "Health service",
      date: item.date,
      detail: [item.serviceName, item.serviceProvided].filter(Boolean).join(" · ") || "Health service recorded",
      tone: "green",
    })),
    ...vaccinations.map((item, index) => ({
      id: `vaccination-${item.id || `${item.name}-${index}`}`,
      category: "consultations",
      type: "Vaccination",
      date: item.date,
      detail: [item.name, item.dose].filter(Boolean).join(" · ") || "Vaccination recorded",
      tone: "yellow",
    })),
    ...referrals.map((item) => ({
      id: `referral-${item.id}`, category: "referrals", type: "Referral",
      date: String(item.date || "").slice(0, 10),
      detail: [item.reason, item.facility, item.assignedPersonnel && `Assigned to ${item.assignedPersonnel}`, `Schedule: ${item.scheduleResponseStatus}`, `Progress: ${item.serviceProgressStatus}`].filter(Boolean).join(" · "),
      tone: item.serviceProgressStatus === "Completed" ? "green" : "blue",
    })),
    ...followUps.map((item) => ({
      id: `follow-up-${item.id}`, category: "follow-ups", type: "Follow-up",
      date: item.date,
      detail: [item.purpose, item.facility, item.assignedPersonnel && `Assigned to ${item.assignedPersonnel}`, `Schedule: ${item.scheduleResponseStatus}`, `Progress: ${item.serviceProgressStatus === "Ongoing" ? "In Progress" : item.serviceProgressStatus}`, item.linkedServiceType && `Linked ${item.linkedServiceType}`].filter(Boolean).join(" · "),
      tone: item.serviceProgressStatus === "Completed" ? "green" : "blue",
    })),
  ].filter((item) => item.date).sort((a, b) => String(b.date).localeCompare(String(a.date))), [
    consultations,
    healthServiceRecords,
    vaccinations,
    referrals,
    followUps,
  ]);
  const visibleTimeline = useMemo(() => historyTypeFilter === "all" ? recordTimeline : recordTimeline.filter((item) => item.category === historyTypeFilter), [recordTimeline, historyTypeFilter]);

  useEffect(() => {
    setReferralPage((page) => Math.min(page, referralPageCount));
  }, [referralPageCount]);

  useEffect(() => {
    setConsultationPage((page) => Math.min(page, consultationPageCount));
  }, [consultationPageCount]);

  useEffect(() => {
    setServiceRecordPage((page) => Math.min(page, serviceRecordPageCount));
  }, [serviceRecordPageCount]);

  const renderReferralHistory = () => (
    <section aria-labelledby="referral-history-title">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div>
          <h2 id="referral-history-title" className="text-lg font-semibold leading-6 text-brand-ink">Referral History</h2>
          <p className="mt-1 text-sm text-brand-gray">Referrals created for you by authorized health personnel.</p>
        </div>
        <p className="text-sm text-brand-gray">{referrals.length} referral{referrals.length === 1 ? "" : "s"}</p>
      </div>
      {referralActionError && <p role="alert" className="mb-3 text-sm text-brand-danger">{referralActionError}</p>}
      {referrals.length === 0 ? (
        <Card className="p-8 text-center text-sm text-brand-gray">No referral records are available.</Card>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-brand-border bg-white shadow-card">
            <div className="hidden grid-cols-[7rem_minmax(8rem,1fr)_minmax(10rem,1.2fr)_8.5rem_8rem] gap-3 border-b border-brand-border bg-brand-bg/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-brand-gray md:grid">
              <span>Date</span><span>Destination</span><span>Reason</span><span>Status</span><span>Action</span>
            </div>
            <ul className="divide-y divide-brand-border md:divide-y-0">
              {visibleReferrals.map((record) => {
                const status = record.serviceProgressStatus || record.status || "Pending";
                const statusClass = /Completed/i.test(status) ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : /Rejected|Cancelled/i.test(status) ? "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                    : /Pending/.test(status) ? "bg-amber-50 text-amber-800"
                      : "bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
                return (
                  <li key={record.id} className="grid gap-3 border-b border-brand-border px-4 py-4 last:border-b-0 md:grid-cols-[7rem_minmax(8rem,1fr)_minmax(10rem,1.2fr)_8.5rem_8rem] md:items-center md:border-b-0 md:px-4">
                    <div><p className="text-xs font-medium uppercase tracking-wide text-brand-gray md:hidden">Referral Date</p><p className="mt-0.5 text-sm text-brand-ink">{formatDate(record.date)}</p></div>
                    <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-brand-gray md:hidden">Destination</p><p className="mt-0.5 break-words text-sm font-medium text-brand-ink">{record.facility || "Not recorded"}</p></div>
                    <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-brand-gray md:hidden">Reason</p><p className="mt-0.5 break-words text-sm text-brand-gray">{record.reason || "Not recorded"}</p></div>
                    <div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>{status}</span></div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => openReferral(record)} disabled={referralDetailLoading} className="text-xs font-semibold text-brand-blue hover:underline">View details</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <TablePagination
            total={referrals.length}
            page={referralPage}
            pageSize={referralPageSize}
            onPageChange={setReferralPage}
            onPageSizeChange={(size) => { setReferralPageSize(size); setReferralPage(1); }}
            itemLabel="referrals"
            className="mt-4"
          />
        </>
      )}
      {selectedReferral && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Referral details">
          <div className="flex max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-[1000px] flex-col overflow-hidden rounded-xl border border-brand-border bg-white shadow-float dark:border-border dark:bg-card">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-4 py-3 dark:border-border dark:bg-card sm:px-6">
              <h3 className="text-sm font-semibold text-brand-ink">Referral Details</h3>
              <button type="button" onClick={() => setSelectedReferral(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-btn text-brand-gray hover:bg-brand-bg dark:hover:bg-hover" aria-label="Close referral details"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 pb-6 sm:px-6 sm:py-5">
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-blue">Referral Overview</h4>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Referral reference", selectedReferral.reference_no || selectedReferral.referralNo || selectedReferral.id],
                    ["Referral date", formatDate(selectedReferral.referral_date || selectedReferral.referralDate)],
                    ["Referring facility", selectedReferral.referring_facility || "Not recorded"],
                    ["Receiving facility", selectedReferral.external_receiving_facility || selectedReferral.recipient_facility?.name || selectedReferral.destination_facility || "Not recorded"],
                    ["Assigned recipient", selectedReferral.recipient?.full_name || selectedReferral.external_recipient_name || "Not assigned"],
                    ["Priority", selectedReferral.priority || "Not recorded"],
                    ["Status", selectedReferral.status || "Pending"],
                  ].map(([label, value]) => <div key={label} className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-xs text-brand-gray">{label}</dt><dd className="mt-1 break-words font-medium text-brand-ink dark:text-foreground">{referralDisplayValue(value)}</dd></div>)}
                </dl>
              </section>
              <section className="border-t border-brand-border pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-blue">Clinical Information</h4>
                <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Referral reason", selectedReferral.reason],
                    ["Clinical history", selectedReferral.medicalHistory || selectedReferral.medical_history || selectedReferral.encounter?.clinical_history],
                    ["Working diagnosis", selectedReferral.impression || selectedReferral.encounter?.phn_assessment],
                    ["Laboratory requirements", selectedReferral.laboratory_test_required ? selectedReferral.laboratory_test : "Not required"],
                    ["Clinical notes", selectedReferral.additional_instructions || selectedReferral.notes],
                  ].map(([label, value]) => <div key={label} className={`min-w-0 [overflow-wrap:anywhere] ${["Referral reason", "Clinical history", "Clinical notes"].includes(label) ? "sm:col-span-2" : ""}`}><dt className="text-xs text-brand-gray">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-brand-ink dark:text-foreground">{referralDisplayValue(value)}</dd></div>)}
                </dl>
              </section>
              <section className="border-t border-brand-border pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-blue">Referral Progress</h4>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Date referred", formatDate(selectedReferral.referral_date || selectedReferral.created_at)],
                    ["Scheduled appointment", selectedReferral.scheduled_at ? new Date(selectedReferral.scheduled_at).toLocaleString() : "Not scheduled"],
                    ["Status updates", selectedReferral.stage || selectedReferral.status || "Pending"],
                    ["Date completed", formatDate(selectedReferral.completed_at)],
                  ].map(([label, value]) => <div key={label} className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-xs text-brand-gray">{label}</dt><dd className="mt-1 break-words font-medium text-brand-ink dark:text-foreground">{referralDisplayValue(value)}</dd></div>)}
                </dl>
              </section>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  const renderHealthServiceHistory = () => (
    <section aria-labelledby="health-service-history-title">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div>
          <h2 id="health-service-history-title" className="text-lg font-semibold leading-6 text-brand-ink">Health Service History</h2>
          <p className="mt-1 text-sm text-brand-gray">Services delivered to you through health programs and scheduled services.</p>
        </div>
        <p className="text-sm text-brand-gray">{healthServiceRecords.length} completed service{healthServiceRecords.length === 1 ? "" : "s"}</p>
      </div>
      {healthServiceRecords.length === 0 ? (
        <Card className="p-8 text-center text-sm text-brand-gray">No delivered health services have been recorded yet.</Card>
      ) : (
        <>
          <div className="space-y-4">
            {visibleServiceRecords.map((record) => (
              <Card key={record.id} className="overflow-hidden p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-border pb-3 dark:border-border">
                  <div>
                    <h3 className="text-base font-semibold leading-5 text-brand-ink">{record.serviceName}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-gray">
                      {record.serviceCategory && <span className="rounded-full bg-brand-bg px-2.5 py-1">{record.serviceCategory}</span>}
                      <span>{formatDate(record.date)}</span>
                      {record.providedByName && <span>Provided by {record.providedByName}</span>}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Completed</span>
                </div>
                <div className="mt-4 grid gap-3 border-t border-brand-border pt-4 text-sm sm:grid-cols-2 dark:border-border">
                  <ServiceRecordDetail label="Service provided" value={record.serviceProvided} />
                  <ServiceRecordDetail label="Assessment" value={record.assessment} />
                  <ServiceRecordDetail label="Recommendations" value={record.recommendations} />
                  <ServiceRecordDetail label="Follow-up" value={record.followUpRequired ? (record.followUpDate ? formatDate(record.followUpDate) : "Required") : "Not required"} />
                  <ServiceRecordDetail label="Notes" value={record.notes} />
                </div>
              </Card>
            ))}
          </div>
          <TablePagination
            total={healthServiceRecords.length}
            page={serviceRecordPage}
            pageSize={serviceRecordPageSize}
            onPageChange={setServiceRecordPage}
            onPageSizeChange={(size) => { setServiceRecordPageSize(size); setServiceRecordPage(1); }}
            className="mt-4"
          />
        </>
      )}
    </section>
  );

  const renderConsultationHistory = () => (
    <section aria-labelledby="consultation-history-title">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div>
            <h2 id="consultation-history-title" className="text-lg font-semibold leading-6 text-brand-ink">Consultation History</h2>
            <p className="mt-0.5 text-sm text-brand-gray">View your past consultations and health records.</p>
          </div>
        </div>
        <p className="text-sm text-brand-gray" aria-live="polite">
          {loading ? "Counting…" : `${consultations.length} matching consultation${consultations.length === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-brand-border bg-white p-4 shadow-card sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Filter records
          </p>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <DateRangeFilter
              from={filters.from}
              to={filters.to}
              onFromChange={(value) => setFilters((current) => ({ ...current, from: value }))}
              onToChange={(value) => setFilters((current) => ({ ...current, to: value }))}
              className="min-w-0 flex-1 sm:w-52 sm:flex-none"
              portal
            />
          <button
            type="button"
            onClick={resetFilters}
            disabled={!filtersActive(filters) && !hasFilters}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-btn px-2.5 py-1 text-xs font-medium text-brand-blue transition-colors hover:bg-brand-bg disabled:cursor-not-allowed disabled:text-brand-gray/60 disabled:hover:bg-transparent"
          >
            Reset filters
          </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div>
            <label htmlFor="ch-service" className={compactLabel}>Health Service</label>
            <div className={selectWrapCls}>
              <select id="ch-service" value={filters.serviceId} onChange={setFilter("serviceId")} className={`${selectCls} appearance-none pr-8`} disabled={servicesLoading}>
                <option value="">All services</option>
                {serviceFilterOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.active === false ? " (inactive or no longer available)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className={selectIconCls} aria-hidden="true" />
            </div>
          </div>
          <div>
            <label htmlFor="ch-type" className={compactLabel}>Type</label>
            <div className={selectWrapCls}>
              <select id="ch-type" value={filters.type} onChange={setFilter("type")} className={`${selectCls} appearance-none pr-8`}>
                <option value="">All types</option>
                {consultationTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className={selectIconCls} aria-hidden="true" />
            </div>
          </div>
          <div>
            <label htmlFor="ch-status" className={compactLabel}>Status</label>
            <div className={selectWrapCls}>
              <select id="ch-status" value={filters.status} onChange={setFilter("status")} className={`${selectCls} appearance-none pr-8`}>
                <option value="">Completed (default)</option>
                <option value="completed">Completed</option>
                <option value="submitted">Submitted</option>
                <option value="received">Received</option>
                <option value="in_review">In Review</option>
                <option value="referred">Referred</option>
                <option value="draft">Draft</option>
              </select>
              <ChevronDown className={selectIconCls} aria-hidden="true" />
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-btn bg-brand-blue px-3 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              Apply Filters
            </button>
          </div>
        </div>
        {filterError && (
          <p className="mt-2 text-xs font-medium text-brand-danger" role="alert">{filterError}</p>
        )}
        {servicesError && (
          <p className="mt-2 text-xs font-medium text-brand-danger" role="alert">{servicesError}</p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-brand-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading consultations…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-brand-danger/30 bg-brand-danger/5 p-4">
          <p className="text-sm font-semibold text-brand-ink">Couldn't load your consultations</p>
          <p className="mt-0.5 text-xs text-brand-gray">{error}</p>
        </div>
      ) : consultations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-brand-border bg-white p-6 text-center dark:bg-card sm:p-8">
          {hasFilters ? (
            <>
              <p className="text-sm font-medium text-brand-ink">No consultations match your filters</p>
              <p className="mt-1 text-xs text-brand-gray">Try widening the date range or clearing a filter.</p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue dark:bg-card"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Clear Filters
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-brand-ink">No consultations recorded yet</p>
              <p className="mt-1 text-xs text-brand-gray">Your completed consultations will appear here.</p>
            </>
          )}
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {visibleConsultations.map((c) => (
            <article key={c.id} className="overflow-hidden rounded-xl border border-brand-border bg-white shadow-card dark:bg-card">
              <div className="grid min-w-0 gap-4 p-4 sm:p-5 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-5">
                <div className="flex items-center gap-3 border-b border-brand-border pb-3 md:block md:border-b-0 md:border-r md:pb-0 md:pr-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-ink">{formatDate(c.date)}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-gray">
                      {dash(c.time)}
                    </p>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <RiskBadge level={consultationRiskLevel(c)} mediumLabel="Medium" />
                      {c.serviceCategory && (
                        <span className="rounded-full bg-brand-bg px-2.5 py-1 text-xs font-medium text-brand-gray">{c.serviceCategory}</span>
                      )}
                      {c.seenBy && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-brand-gray">
                          Seen by {c.seenBy}
                        </span>
                      )}
                    </div>
                    {c.status && (
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                        String(c.status).toLowerCase() === "completed"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-700"
                      }`}>
                        {String(c.status).replaceAll("_", " ")}
                      </span>
                    )}
                  </div>
          <div className="grid min-w-0 gap-x-6 gap-y-3 lg:grid-cols-2 lg:gap-y-3">
                    {consultationFields(c).map((column, columnIndex) => (
                      <div key={columnIndex} className="min-w-0 space-y-2">
                        {column.map(({ label, value, preserveLines }) => (
                          <div key={label} className="grid min-w-0 grid-cols-1 items-start gap-x-2 text-sm leading-5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                            <span className="text-xs font-medium text-brand-gray sm:text-sm sm:text-brand-ink">{label}</span>
                            <span className={`min-w-0 break-words text-sm text-brand-ink sm:text-brand-gray ${preserveLines ? "whitespace-pre-line" : ""}`}>{dash(value)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {vitalCards(c.vitals, consultationBloodPressureClassification(c)).length > 0 && (
                <div className="border-t border-brand-border bg-brand-bg/60 px-4 py-3 sm:px-5">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand-ink">
                    Vital Signs
                  </h3>
                  <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4 xl:grid-cols-8">
                    {vitalCards(c.vitals, consultationBloodPressureClassification(c)).map(({ label, value, unit, category }, index) => (
                      <div
                        key={label}
                        className={`min-w-0 border-brand-border px-2 first:pl-0 xl:px-3 ${
                          index % 2 === 1 ? "border-l" : ""
                        } ${index % 4 === 0 ? "sm:border-l-0 sm:pl-0" : "sm:border-l"} ${
                          index % 8 === 0 ? "xl:border-l-0 xl:pl-0" : "xl:border-l"
                        }`}
                      >
                        <p className="flex items-center gap-1.5 truncate text-xs text-brand-gray">
                          {label}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="whitespace-nowrap text-sm font-semibold text-brand-ink">
                            {value}{unit ? ` ${unit}` : ""}
                          </span>
                          {label === "BMI" && category && bmiBadgeClass(category) && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${bmiBadgeClass(category)}`}>
                              {category}
                            </span>
                          )}
                          {label === "Blood Pressure" && category && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${bloodPressureBadgeClassName({ category })}`}>
                              {category}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
        <TablePagination
          total={consultations.length}
          page={consultationPage}
          pageSize={consultationPageSize}
          onPageChange={setConsultationPage}
          onPageSizeChange={(size) => { setConsultationPageSize(size); setConsultationPage(1); }}
          className="mt-4"
        />
        </>
      )}
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <PageHeader
        eyebrow="Resident Health Records"
        title="My Health Record"
        subtitle="A complete view of your medical history and vitals."
        dense
        action={
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:justify-end">
            <button
              onClick={exportHealthRecord}
              disabled={loading || !!error || exporting}
              aria-busy={exporting}
              className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-btn border border-brand-gold/60 bg-brand-gold px-4 text-sm font-semibold text-brand-dark transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</> : <><Download className="w-4 h-4" /> Export Health Record</>}
            </button>
            {exportError && <span className="text-xs text-brand-danger">{exportError}</span>}
          </div>
        }
      />

      {error && activeTab === "overview" && (
        <Card className="mb-6 border-brand-danger/30 bg-brand-danger/5 p-4">
          <p className="text-sm font-semibold text-brand-danger">Couldn't load your health record</p>
          <p className="mt-0.5 text-xs text-brand-gray">{error}</p>
        </Card>
      )}

      {loading && !latestRecord && activeTab === "overview" ? (
        <Card className="p-6 text-sm text-brand-gray">Loading your health record…</Card>
      ) : (
        <>
          <Card className="mb-5 rounded-card p-4 shadow-none sm:p-5">
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
              {[
                ["Resident name", resident?.name],
                ["Health Record No.", resident?.healthRecordNo || resident?.healthRecordNumber || resident?.health_record_no],
                ["Barangay", resident?.barangay],
                ["Birthday", resident?.birthDate ? formatDate(resident.birthDate) : null],
                ["Age", resident?.age],
                ["Sex", resident?.sex],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-lg bg-brand-bg/60 px-3 py-2.5 xl:bg-transparent xl:px-0 xl:py-0 xl:first:pl-0">
                  <p className="text-xs font-medium text-brand-gray">{label}</p>
                  <p className="mt-1 min-w-0 break-words text-sm font-semibold leading-5 text-brand-ink">{dash(value)}</p>
                </div>
              ))}
              <div className="min-w-0 rounded-lg bg-brand-bg/60 px-3 py-2.5 xl:bg-transparent xl:px-0 xl:py-0">
                <p className="text-xs font-medium text-brand-gray">Verification</p>
                <p className="mt-1 inline-flex max-w-full break-words border-l-2 border-brand-gold bg-brand-bg px-2.5 py-1 text-xs font-semibold text-brand-ink">
                  {dash(resident?.verificationStatus)}
                </p>
              </div>
            </div>
          </Card>

          {/* Section tabs — Consultation History is a subsection of this page. */}
          <div className="mb-5 flex w-full gap-1 overflow-x-auto rounded-xl border border-brand-border bg-white p-1 shadow-card dark:bg-card" role="tablist" aria-label="Health record sections">
            {[
              { key: "overview", label: "Overview" },
              { key: "consultations", label: "Consultation History" },
              { key: "service-history", label: "Health Service History" },
              { key: "referrals", label: "Referral History" },
            ].map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.key)}
                  className={`min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:px-4 ${
                    active
                      ? "bg-brand-blue text-white shadow-sm"
                      : "text-brand-ink/70 hover:bg-brand-bg hover:text-brand-ink"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === "consultations" ? renderConsultationHistory() : activeTab === "service-history" ? renderHealthServiceHistory() : activeTab === "referrals" ? renderReferralHistory() : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2.5">
                <RiskBadge level={consultationRiskLevel(latestRecord?.consultations?.[0])} mediumLabel="Medium" />
                <h3 className="text-lg font-semibold leading-6 text-brand-ink">
                  Latest Vitals{latestRecord?.consultations?.length ? ` — ${formatDate(latestRecord.consultations[0].date)}` : ""}
                </h3>
              </div>
              <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
                {latestVitals.length === 0 ? (
                  <Card className="p-5 text-sm text-brand-gray xl:col-span-4">No vitals recorded yet.</Card>
                ) : (
                  latestVitals.map((v) => (
                    <Card key={v.label} className="rounded-lg p-4 shadow-none">
                      <p className="text-sm font-medium text-brand-gray">{v.label}</p>
                      <p className="mt-1 font-sans text-xl font-semibold leading-6 text-brand-ink">
                        {v.value} {v.unit && <span className="text-sm font-normal text-brand-gray">{v.unit}</span>}
                      </p>
                      {v.category && <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${bloodPressureBadgeClassName({ category: v.category })}`}>{v.category}</span>}
                    </Card>
                  ))
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Card className="h-full rounded-lg p-4 shadow-none sm:p-5">
                  <h3 className="mb-4 text-base font-semibold leading-6 text-brand-ink">Medical History & Allergies</h3>
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-1 gap-1 border-b border-brand-border pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:gap-3"><span className="text-brand-gray">Recorded Conditions</span><span className="break-words font-medium leading-5 text-brand-ink">{medicalHistory.chronicConditions || "Not recorded"}</span></div>
                    <div className="grid grid-cols-1 gap-1 border-b border-brand-border pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:gap-3"><span className="text-brand-gray">Allergies</span><span className="break-words font-medium leading-5 text-brand-ink">{medicalHistory.allergies || "Not recorded"}</span></div>
                    <div className="grid grid-cols-1 gap-1 border-b border-brand-border pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:gap-3"><span className="text-brand-gray">Latest Prescriptions</span><span className="break-words font-medium leading-5 text-brand-ink">{medicalHistory.currentMedications || "Not recorded"}</span></div>
                    {showPregnancyStatus && (
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:gap-3"><span className="text-brand-gray">Recorded Pregnancy Status</span><span className="break-words font-medium leading-5 text-brand-ink">{medicalHistory.pregnancyStatus || "Not recorded"}</span></div>
                    )}
                  </div>
                </Card>

                <Card className="h-full rounded-lg p-4 shadow-none sm:p-5">
                  <h3 className="mb-4 text-base font-semibold leading-6 text-brand-ink">Vaccinations</h3>
                  <div className="space-y-3">
                    {!latestRecord?.vaccinations?.length ? (
                      <p className="text-sm text-brand-gray">No vaccinations recorded yet.</p>
                    ) : (
                      latestRecord.vaccinations.map((v) => (
                        <div key={v.id || `${v.name}-${v.date}`} className="flex items-start justify-between gap-3 border-b border-brand-border pb-3 text-sm last:border-0 last:pb-0">
                          <div className="min-w-0"><p className="truncate font-medium text-brand-ink">{v.name}{v.dose ? ` · ${v.dose}` : ""}</p><p className="text-xs text-brand-gray">{v.date ? formatDate(v.date) : "Date not recorded"}{v.nextDose ? ` · Next dose ${formatDate(v.nextDose)}` : ""}</p></div>
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{v.status}</span>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                <Card className="h-full rounded-lg p-4 shadow-none sm:p-5">
                  <LabResultsPanel canUpload />
                </Card>

              </div>

              {latestRecord?.referrals?.length > 0 && (
                <Card className="mt-5 rounded-card p-4 shadow-none sm:p-5">
                  <div className="mb-4 flex flex-col gap-3 border-b border-brand-border pb-3 sm:flex-row sm:items-end sm:justify-between">
                    <div><h3 className="text-base font-semibold text-brand-ink">Referrals</h3><p className="mt-1 text-sm text-brand-gray">Actual referral records associated with your account.</p></div>
                    <button type="button" onClick={() => setActiveTab("referrals")} className="shrink-0 text-sm font-semibold text-brand-blue hover:underline">Referral History</button>
                  </div>
                  <div className="divide-y divide-brand-border">
                    {[...latestRecord.referrals].sort((a, b) => String(b.referralDate || b.date).localeCompare(String(a.referralDate || a.date))).map((record) => (
                      <article key={record.id} className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-end last:pb-0">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{record.referenceNo ? `Referral ${record.referenceNo}` : "Referral"}</p>
                          <p className="mt-1 font-medium text-brand-ink">{record.facility || "Destination not recorded"}</p>
                          <p className="mt-1 text-sm text-brand-gray">{record.reason || "Reason not recorded"}</p>
                          <p className="mt-1 text-xs text-brand-gray">{formatDate(record.referralDate || record.date)} · {record.assignedPersonnel || "Personnel not recorded"} · {record.serviceProgressStatus || "Pending"}</p>
                        </div>
                        <button type="button" onClick={() => viewReferralSlip(record)} disabled={referralDownloadId === record.id} className="inline-flex h-10 w-full items-center justify-center rounded-btn border border-brand-blue px-3 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-bg disabled:opacity-50 sm:h-9 sm:w-auto">View Referral Slip</button>
                      </article>
                    ))}
                  </div>
                </Card>
              )}

              {followUps.length > 0 && (
                <Card className="mt-5 rounded-card p-4 shadow-none sm:p-5">
                  <div className="mb-4 border-b border-brand-border pb-3"><h3 className="text-base font-semibold text-brand-ink">Follow-ups</h3><p className="mt-1 text-sm text-brand-gray">Scheduled follow-up records associated with your account.</p></div>
                  <div className="divide-y divide-brand-border">
                    {[...followUps].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((record) => (
                      <article key={record.id} className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-end last:pb-0">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{record.purpose || "Follow-up"}</p>
                          <p className="mt-1 text-sm font-medium text-brand-ink">{formatDate(record.date)}{record.time ? ` · ${record.time}` : ""}</p>
                          <p className="mt-1 text-xs text-brand-gray">{record.assignedPersonnel || "Assigned personnel not recorded"} · {record.serviceProgressStatus || "Scheduled"}</p>
                        </div>
                        <button type="button" onClick={() => setSelectedFollowUp(record)} className="inline-flex h-10 w-full items-center justify-center rounded-btn border border-brand-blue px-3 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-bg sm:h-9 sm:w-auto">View Details</button>
                      </article>
                    ))}
                  </div>
                </Card>
              )}

              <Card className="mt-5 rounded-lg p-4 shadow-none sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div><h3 className="text-lg font-semibold leading-6 text-brand-ink">Health timeline</h3><p className="mt-1 text-sm text-brand-gray">Consultations, referrals, and follow-ups, newest first.</p></div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter health timeline">
                    {[['all','All Records'],['consultations','Consultations'],['referrals','Referrals'],['follow-ups','Follow-Ups']].map(([value,label]) => <button key={value} type="button" onClick={() => setHistoryTypeFilter(value)} aria-pressed={historyTypeFilter === value} className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${historyTypeFilter === value ? 'border-brand-blue bg-brand-blue text-white' : 'border-brand-border text-brand-gray hover:bg-brand-bg hover:text-brand-ink'}`}>{label}</button>)}
                  </div>
                </div>
                {visibleTimeline.length ? (
                  <ol className="relative">
                    <span aria-hidden="true" className="absolute bottom-3 left-[6px] top-3 w-px bg-brand-border" />
                    {visibleTimeline.map((item) => (
                      <li key={item.id} className="relative flex gap-4 py-3 first:pt-0 last:pb-0">
                        <span className={`relative z-10 mt-1 h-[13px] w-[13px] shrink-0 rounded-full ring-4 ring-white dark:ring-card ${
                          item.tone === "green" ? "bg-brand-green" : item.tone === "yellow" ? "bg-brand-gold" : "bg-brand-blue"
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-brand-gray">{item.type}</p>
                          <p className="mt-1 text-sm leading-relaxed text-brand-ink">{item.detail}</p>
                          <p className="mt-0.5 text-xs text-brand-gray">{formatDate(item.date)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="py-2 text-sm text-brand-gray">{recordTimeline.length ? "No records match this filter." : "Nothing recorded yet."}</p>
                )}
              </Card>
            </>
          )}
          {selectedReferralPdf && (
            <div className="fixed inset-0 z-[90] flex h-[100dvh] flex-col bg-white sm:inset-6 sm:h-auto sm:rounded-xl sm:border sm:border-brand-border sm:shadow-2xl" role="dialog" aria-modal="true" aria-label="Referral slip">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-brand-border px-4 sm:px-5">
                <h3 className="text-sm font-semibold text-brand-ink">Referral Slip</h3>
                <div className="flex items-center gap-2">
                  <a href={selectedReferralPdf} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-btn border border-brand-border px-3 text-sm font-semibold text-brand-blue">Open / Print</a>
                  <button type="button" onClick={closeReferralSlip} className="grid h-9 w-9 place-items-center rounded-btn text-brand-gray hover:bg-brand-bg" aria-label="Close referral slip"><X className="h-4 w-4" /></button>
                </div>
              </div>
              <iframe title="Official referral slip" src={selectedReferralPdf} className="min-h-0 w-full flex-1 border-0" />
            </div>
          )}
          {selectedFollowUp && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Follow-up details">
              <div className="flex max-h-[85dvh] w-full min-w-0 flex-col overflow-hidden rounded-xl border border-brand-border bg-white shadow-2xl dark:border-border dark:bg-card sm:w-[92vw] sm:max-w-[840px]">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border px-4 py-3 dark:border-border sm:px-5">
                  <div><p className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Follow-up</p><h3 className="mt-1 text-lg font-semibold text-brand-ink">{selectedFollowUp.purpose || "Follow-up Details"}</h3></div>
                  <button type="button" onClick={() => setSelectedFollowUp(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-btn text-brand-gray hover:bg-brand-bg" aria-label="Close follow-up details"><X className="h-4 w-4" /></button>
                </div>
                <dl className="grid min-h-0 flex-1 gap-x-5 gap-y-3 overflow-y-auto overscroll-contain px-4 py-4 pb-6 sm:grid-cols-2 sm:px-5">
                  {[
                    ["Follow-up reference", selectedFollowUp.id],
                    ["Scheduled date", formatDate(selectedFollowUp.date)],
                    ["Scheduled time", selectedFollowUp.time],
                    ["Status", selectedFollowUp.serviceProgressStatus || "Scheduled"],
                    ["Assigned healthcare personnel", selectedFollowUp.assignedPersonnel],
                    ["Location", selectedFollowUp.facility],
                    ["Purpose", selectedFollowUp.purpose],
                    ["Instructions", selectedFollowUp.notes],
                    ["Completion date", selectedFollowUp.completedAt ? formatLongDate(selectedFollowUp.completedAt) : ""],
                  ].filter(([, value]) => value).map(([label, value]) => (
                    <div key={label} className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-brand-ink">{value}</dd></div>
                  ))}
                </dl>
                <div className="flex shrink-0 justify-end border-t border-brand-border px-4 py-3 dark:border-border sm:px-5"><button type="button" onClick={() => setSelectedFollowUp(null)} className="h-10 rounded-btn border border-brand-border px-4 text-sm font-semibold text-brand-gray">Close</button></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
