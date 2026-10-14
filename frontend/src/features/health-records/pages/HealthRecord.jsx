import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Droplets,
  FileText,
  FlaskConical,
  Heart,
  HeartPulse,
  Loader2,
  Pill,
  RotateCcw,
  Ruler,
  Scale,
  Search,
  SearchX,
  Stethoscope,
  Syringe,
  Thermometer,
  UserRoundCheck,
  Wind,
  Download,
  Filter,
} from "lucide-react";
import { residentsApi, visitPlansApi } from "@/services/api";
import { downloadHealthRecordPdf } from "@/features/health-records/lib/healthRecordPdf";
import { shouldShowPregnancyStatus } from "@/features/health-records/lib/pregnancyVisibility";

// These sections are sourced from separate modules (immunization, laboratory)
// that are not part of the consultation record. They intentionally render an
// empty state here until those data sources are wired to the resident view; the
// consultation history + vitals below come from the live API.
const vaccinations = [];
const labs = [];
const MEDICAL_HISTORY = {};

const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Build the vital-sign display from the consultation's backend-validated values. */
const vitalCards = (vitals = {}) => {
  const cards = [
    { label: "Blood Pressure", value: vitals.bloodPressure, unit: "mmHg", Icon: HeartPulse },
    { label: "Temperature", value: vitals.temperature, unit: "°C", Icon: Thermometer },
    { label: "Pulse Rate", value: vitals.pulseRate, unit: "bpm", Icon: Heart },
    { label: "Respiratory Rate", value: vitals.respiratoryRate, unit: "breaths/min", Icon: Wind },
    { label: "Oxygen Saturation", value: vitals.oxygenSaturation, unit: "%", Icon: Droplets },
    { label: "Height", value: vitals.height, unit: "cm", Icon: Ruler },
    { label: "Weight", value: vitals.weight, unit: "kg", Icon: Scale },
    { label: "BMI", value: vitals.bmi, unit: "", Icon: Activity, category: vitals.bmiCategory },
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

const compactLabel = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-brand-gray";
const selectWrapCls = "relative";
const selectIconCls = "pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-gray";

const bmiBadgeClass = (category) => {
  const normalized = String(category || "").toLowerCase();
  if (normalized === "underweight") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (normalized === "normal") return "bg-green-50 text-green-800 ring-green-200";
  if (normalized === "overweight") return "bg-orange-50 text-orange-800 ring-orange-200";
  if (normalized === "obese") return "bg-red-50 text-red-800 ring-red-200";
  return "";
};

const consultationFields = (consultation) => [
  [
    { label: "Chief Complaint", value: consultation.chiefComplaint, Icon: ClipboardList },
    { label: "Findings", value: consultation.findings, Icon: FileText },
    { label: "Medications", value: consultation.medications, Icon: Pill, preserveLines: true },
    { label: "Health Service", value: consultation.serviceName, Icon: Stethoscope },
  ],
  [
    { label: "Diagnosis", value: consultation.diagnosis, Icon: Activity },
    { label: "Treatment", value: consultation.treatmentGiven, Icon: HeartPulse },
    { label: "Recommendations", value: consultation.recommendations, Icon: FileText },
    {
      label: "Follow-up",
      value: consultation.followUpRequired === "Yes"
        ? `Yes${consultation.nextVisitDate ? ` · ${formatDate(consultation.nextVisitDate)}` : ""}`
        : consultation.followUpRequired === "No" ? "No" : "",
      Icon: CalendarDays,
    },
  ],
];

/** A date range is valid when both ends are dates and `to` is not before `from`. */
const dateRangeError = (from, to) => {
  if (from && to && from > to) return "The end date cannot be before the start date.";
  return "";
};

export default function HealthRecord() {
  const [resident, setResident] = useState(null);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportingRef = useRef(false);
  // Consultation History is consolidated into this page as a tab/subsection
  // rather than a separate sidebar entry.
  const [activeTab, setActiveTab] = useState("overview");

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
        setResident(data?.resident || null);
        const rows = Array.isArray(data?.consultations) ? data.consultations : [];
        setConsultations(rows);
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
        setError(err?.message || "Could not load your health record. Please try again.");
        setConsultations([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadConsultations(appliedFilters);
  }, [loadConsultations, appliedFilters]);

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
    () => (consultations.length ? vitalCards(consultations[0].vitals) : []),
    [consultations],
  );

  // Pregnancy Status is suppressed only for residents explicitly recorded as
  // male. Female, "Other", and missing/unknown sex keep the field visible so an
  // unknown sex is never mistaken for male. Driven by the authoritative profile
  // `sex`, so it stays correct after load, refresh, and profile updates.
  const showPregnancyStatus = useMemo(
    () => shouldShowPregnancyStatus(resident?.sex),
    [resident?.sex],
  );

  /**
   * Export the resident's own health record as a formatted PDF document. The
   * PDF is generated in the browser (jsPDF) from the SAME data object this page
   * already loaded — nothing is re-fetched, uploaded or sent to a server.
   */
  const exportHealthRecord = useCallback(async () => {
    // Prevent overlapping / simultaneous exports.
    if (exportingRef.current) return;
    if (!resident && consultations.length === 0) {
      setExportError("Unable to export health record. Please try again.");
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    setExportError("");
    try {
      await downloadHealthRecordPdf({
        resident: resident || {},
        consultations,
        // These sections have no resident-facing data source yet; the PDF
        // renders them as empty / "Not available" rather than inventing values.
        vaccinations,
        labs,
        medicalHistory: MEDICAL_HISTORY,
      });
    } catch {
      setExportError("Unable to export health record. Please try again.");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [resident, consultations]);

  const hasFilters = filtersActive(appliedFilters);

  const renderConsultationHistory = () => (
    <section aria-labelledby="consultation-history-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand-blue">
            <Stethoscope className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="consultation-history-title" className="text-lg font-semibold leading-6 text-brand-ink">Consultation History</h2>
            <p className="mt-0.5 text-sm text-brand-gray">View your past consultations and health records.</p>
          </div>
        </div>
        <p className="pl-14 text-sm text-brand-gray sm:pl-0" aria-live="polite">
          {loading ? "Counting…" : `${consultations.length} matching consultation${consultations.length === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-brand-border bg-white p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            <Filter className="h-3.5 w-3.5 text-brand-blue" aria-hidden="true" /> Filter records
          </p>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!filtersActive(filters) && !hasFilters}
            className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-xs font-medium text-brand-blue transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-brand-gray/60 disabled:hover:bg-transparent"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Clear Filters
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div>
            <label htmlFor="ch-from" className={compactLabel}>From date</label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-gray" aria-hidden="true" />
              <input id="ch-from" type="date" value={filters.from} max={filters.to || undefined} onChange={setFilter("from")} className={`${selectCls} pl-8`} />
            </div>
          </div>
          <div>
            <label htmlFor="ch-to" className={compactLabel}>To date</label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-gray" aria-hidden="true" />
              <input id="ch-to" type="date" value={filters.to} min={filters.from || undefined} onChange={setFilter("to")} className={`${selectCls} pl-8`} />
            </div>
          </div>
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
              <Search className="h-4 w-4" aria-hidden="true" /> Apply Filters
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
        <div className="rounded-2xl border border-dashed border-brand-border p-8 text-center">
          {hasFilters ? (
            <>
              <SearchX className="mx-auto h-8 w-8 text-brand-gray/60" />
              <p className="mt-3 text-sm font-medium text-brand-ink">No consultations match your filters</p>
              <p className="mt-1 text-xs text-brand-gray">Try widening the date range or clearing a filter.</p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Clear Filters
              </button>
            </>
          ) : (
            <>
              <Stethoscope className="mx-auto h-8 w-8 text-brand-gray/60" />
              <p className="mt-3 text-sm font-medium text-brand-ink">No consultations recorded yet</p>
              <p className="mt-1 text-xs text-brand-gray">Your completed consultations will appear here.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {consultations.map((c) => (
            <article key={c.id} className="overflow-hidden rounded-xl border border-brand-border bg-white">
              <div className="grid min-w-0 gap-4 p-4 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-5">
                <div className="flex items-center gap-3 border-b border-brand-border pb-3 md:block md:border-b-0 md:border-r md:pb-0 md:pr-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand-blue">
                    <CalendarDays className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 md:mt-3">
                    <p className="text-sm font-semibold text-brand-ink">{formatDate(c.date)}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-gray">
                      <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {dash(c.time)}
                    </p>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {c.serviceCategory && (
                        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-brand-gray">{c.serviceCategory}</span>
                      )}
                      {c.seenBy && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-brand-gray">
                          <UserRoundCheck className="h-3.5 w-3.5 text-brand-blue" aria-hidden="true" /> {c.seenBy}
                        </span>
                      )}
                    </div>
                    {c.status && (
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                        String(c.status).toLowerCase() === "completed"
                          ? "bg-green-50 text-green-800"
                          : "bg-slate-100 text-slate-700"
                      }`}>
                        {String(c.status).toLowerCase() === "completed" && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        {String(c.status).replaceAll("_", " ")}
                      </span>
                    )}
                  </div>
                  <div className="grid min-w-0 gap-x-6 gap-y-3 lg:grid-cols-2 lg:gap-y-2">
                    {consultationFields(c).map((column, columnIndex) => (
                      <div key={columnIndex} className="min-w-0 space-y-2">
                        {column.map(({ label, value, Icon, preserveLines }) => (
                          <div key={label} className="grid min-w-0 grid-cols-[1rem_6.5rem_minmax(0,1fr)] items-start gap-x-2 text-[13px] leading-5">
                            <Icon className="mt-0.5 h-3.5 w-3.5 text-brand-blue" aria-hidden="true" />
                            <span className="font-medium text-brand-ink">{label}</span>
                            <span className={`min-w-0 break-words text-brand-gray ${preserveLines ? "whitespace-pre-line" : ""}`}>{dash(value)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {vitalCards(c.vitals).length > 0 && (
                <div className="border-t border-brand-border bg-slate-50/60 px-4 py-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand-ink">
                    <Activity className="h-4 w-4 text-brand-blue" aria-hidden="true" /> Vital Signs
                  </h3>
                  <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4 xl:grid-cols-8">
                    {vitalCards(c.vitals).map(({ label, value, unit, Icon, category }, index) => (
                      <div
                        key={label}
                        className={`min-w-0 border-brand-border px-2 first:pl-0 xl:px-3 ${
                          index % 2 === 1 ? "border-l" : ""
                        } ${index % 4 === 0 ? "sm:border-l-0 sm:pl-0" : "sm:border-l"} ${
                          index % 8 === 0 ? "xl:border-l-0 xl:pl-0" : "xl:border-l"
                        }`}
                      >
                        <p className="flex items-center gap-1.5 truncate text-[11px] text-brand-gray">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" /> {label}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="whitespace-nowrap text-sm font-semibold text-brand-ink">
                            {value}{unit ? ` ${unit}` : ""}
                          </span>
                          {label === "BMI" && category && bmiBadgeClass(category) && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${bmiBadgeClass(category)}`}>
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
      )}
    </section>
  );

  return (
    <>
      <PageHeader
        crumbs={["My Health Record"]}
        title="My Health Record"
        subtitle="A complete view of your medical history and vitals."
        action={
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={exportHealthRecord}
              disabled={loading || !!error || exporting}
              aria-busy={exporting}
              className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" /> Export Health Record
                </>
              )}
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

      {loading && activeTab === "overview" ? (
        <Card className="p-6 text-sm text-brand-gray">Loading your health record…</Card>
      ) : (
        <>
          <Card className="p-5 mb-6">
            <div className="grid md:grid-cols-2 xl:grid-cols-6 gap-4 text-sm">
              <div><p className="text-brand-gray">Resident Name</p><p className="font-semibold text-brand-ink">{dash(resident?.name)}</p></div>
              <div><p className="text-brand-gray">Barangay</p><p className="font-semibold text-brand-ink">{dash(resident?.barangay)}</p></div>
              <div><p className="text-brand-gray">Birthday</p><p className="font-semibold text-brand-ink">{dash(resident?.birthDate)}</p></div>
              <div><p className="text-brand-gray">Age</p><p className="font-semibold text-brand-ink">{dash(resident?.age)}</p></div>
              <div><p className="text-brand-gray">Sex</p><p className="font-semibold text-brand-ink">{dash(resident?.sex)}</p></div>
              <div><p className="text-brand-gray">Verification</p><p className="font-semibold text-brand-ink capitalize">{dash(resident?.verificationStatus)}</p></div>
            </div>
          </Card>

          {/* Section tabs — Consultation History is a subsection of this page. */}
          <div className="mb-6 flex flex-wrap gap-1 border-b border-brand-border" role="tablist" aria-label="Health record sections">
            {[
              { key: "overview", label: "Overview" },
              { key: "consultations", label: "Consultation History" },
            ].map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.key)}
                  className={`-mb-px rounded-t-btn border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-brand-blue text-brand-blue"
                      : "border-transparent text-brand-gray hover:text-brand-ink"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === "overview" ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-brand-gray uppercase tracking-wide">
                  Latest Vitals{consultations.length ? ` — ${formatDate(consultations[0].date)}` : ""}
                </h3>
              </div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                {latestVitals.length === 0 ? (
                  <Card className="p-5 text-sm text-brand-gray xl:col-span-4">No vitals recorded yet.</Card>
                ) : (
                  latestVitals.map((v) => (
                    <Card key={v.label} className="p-5">
                      <p className="text-xs text-brand-gray">{v.label}</p>
                      <p className="font-stat font-bold text-brand-ink text-lg">
                        {v.value} {v.unit && <span className="text-xs font-normal text-brand-gray">{v.unit}</span>}
                      </p>
                    </Card>
                  ))
                )}
              </div>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                <Card className="p-6">
                  <h3 className="font-semibold text-brand-ink mb-4">Medical History & Allergies</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Chronic Conditions</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.chronicConditions || "—"}</span></div>
                    <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Allergies</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.allergies || "—"}</span></div>
                    <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Current Medications</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.currentMedications || "—"}</span></div>
                    {showPregnancyStatus && (
                      <div className="flex justify-between"><span className="text-brand-gray">Pregnancy Status</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.pregnancyStatus || "—"}</span></div>
                    )}
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2"><Syringe className="w-4 h-4 text-brand-blue" /> Vaccinations</h3>
                  <div className="space-y-3">
                    {vaccinations.length === 0 ? (
                      <p className="text-sm text-brand-gray">No vaccinations recorded yet.</p>
                    ) : (
                      vaccinations.map((v) => (
                        <div key={v.name} className="flex items-center justify-between text-sm border-b border-brand-border pb-3 last:border-0 last:pb-0">
                          <div><p className="text-brand-ink font-medium">{v.name}</p><p className="text-brand-gray text-xs">{v.date}</p></div>
                          <span className="text-xs text-brand-green bg-brand-green/10 px-2 py-1 rounded-full">{v.status}</span>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2"><FlaskConical className="w-4 h-4 text-brand-blue" /> Laboratory Results</h3>
                  <div className="space-y-3">
                    {labs.length === 0 ? (
                      <p className="text-sm text-brand-gray">No laboratory results recorded yet.</p>
                    ) : (
                      labs.map((l) => (
                        <div key={l.name} className="flex items-center justify-between text-sm border-b border-brand-border pb-3 last:border-0 last:pb-0">
                          <div><p className="text-brand-ink font-medium">{l.name}</p><p className="text-brand-gray text-xs">{l.date}</p></div>
                          <span className="text-brand-ink font-medium">{l.result}</span>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            </>
          ) : (
            renderConsultationHistory()
          )}
        </>
      )}
    </>
  );
}
