import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Download, Send, Check, CheckCircle2, X, RefreshCw, FileText, ArrowLeft, Eye, Printer } from "lucide-react";
import { phnMonthlyTrend } from "@/services/local/phnData";
import {
  filterRowsByScope,
  normalizeBarangay,
  phnDefaultBarangay,
  phnWritableBarangays,
  scopeLabel,
} from "@/lib/phnScope";
import { usePhnCoverage } from "@/context/PhnCoverageContext";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { monthlyConsultations, comparisonMonthlyConsultations } from "@/services/local/dashboardData";
import { reportsApi, referralsApi, followUpsApi, maternalApi, immunizationsApi } from "@/services/api";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid, Legend } from "recharts";

const REPORTS = [];

// PHN reports. `barangay: null` means an RHU-level report (no barangay scope);
// the rest belong to a specific barangay and are scope-filtered below.
const PHN_REPORTS = [];

const STATUS_COLORS = {
  Draft: "bg-brand-gray/10 text-brand-gray",
  Generated: "bg-brand-blue/10 text-brand-blue",
  Submitted: "bg-brand-green/10 text-brand-green",
  "Submitted to RHU": "bg-brand-green/10 text-brand-green",
  "Submitted to MHO": "bg-brand-green/10 text-brand-green",
  Received: "bg-brand-yellow/15 text-[#B07E00]",
  Reviewed: "bg-brand-green/10 text-brand-green",
  Rejected: "bg-brand-danger/10 text-brand-danger",
};

const REPORT_TYPE_LABELS = ["Health Records", "Referrals", "Follow-ups", "Health Services", "Community Health Trends"];

// --- Real-data report generation helpers ----------------------------------
//
// A generated report preview is built from the SAME authenticated, scope-
// enforced APIs the clinical pages use. Nothing is fabricated: totals are the
// count of real records the backend returns for the signed-in user's scope,
// optionally narrowed to the selected reporting month when the records carry a
// date. Report types with no record-list source fall back to an honest "no
// detailed summary available" note rather than inventing numbers.

/** Candidate per-record date fields, most clinically-relevant first. */
const DATE_FIELDS = ["scheduled_date", "referral_date", "service_date", "visit_date", "administered_date", "delivery_date", "record_date", "date", "created_at"];

/** Compute the inclusive [from,to] YYYY-MM-DD window for a "YYYY-MM" period. */
const monthWindow = (period) => {
  if (!/^\d{4}-\d{2}$/.test(String(period || ""))) return null;
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` };
};

const recordDate = (rec) => {
  for (const f of DATE_FIELDS) {
    if (rec?.[f]) return String(rec[f]).slice(0, 10);
  }
  return null;
};

/** Normalize an API response (array | {records} | {rows} | {data}) to an array. */
const toRecordArray = (res) => {
  if (Array.isArray(res)) return res;
  return res?.records || res?.rows || res?.data || [];
};

/**
 * Build a summary from real records. When any record carries a date and a month
 * window is given, totals are narrowed to that month; otherwise the full scoped
 * set is counted and `periodFiltered` is false so the UI can say so. The scoped
 * `records` are retained so the full-report preview can render the actual rows
 * that back the totals (same dataset, same filter — never re-fetched wider).
 */
const summarizeRecords = (res, window) => {
  const list = toRecordArray(res);
  const anyDated = list.some((r) => recordDate(r));
  const scoped = anyDated && window ? list.filter((r) => {
    const d = recordDate(r);
    return d && d >= window.from && d <= window.to;
  }) : list;
  const byStatus = {};
  for (const r of scoped) {
    const s = r?.status ? String(r.status) : "Unspecified";
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  return { total: scoped.length, byStatus, periodFiltered: Boolean(anyDated && window), records: scoped };
};

/** Full name from an embedded resident record, or "" when unavailable. */
const residentName = (r) => {
  const res = r?.resident;
  if (!res) return "";
  return [res.first_name, res.middle_name, res.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
};

/** Readable date from a YYYY-MM-DD or ISO value; placeholder when absent. */
const fmtDate = (v) => {
  if (!v) return "—";
  const raw = String(v);
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Columns shown in the full-report preview per report type, mapped to the ACTUAL
 * fields the source APIs return (follow_ups / health_referrals / maternal_records
 * / immunizations, each with the resident embed the API provides). A field that
 * the API does not return is shown as "—", never fabricated.
 */
const REPORT_COLUMNS = {
  "Follow-up Report": [
    { label: "Resident", get: (r) => residentName(r) || "—" },
    { label: "Scheduled", get: (r) => fmtDate(r.scheduled_date || r.date) },
    { label: "Purpose", get: (r) => r.purpose || "—" },
    { label: "Priority", get: (r) => r.priority || "—" },
    { label: "Status", get: (r) => r.status || "—", badge: true },
  ],
  "Referral Report": [
    { label: "Resident", get: (r) => residentName(r) || "—" },
    { label: "Referral Date", get: (r) => fmtDate(r.referral_date || r.created_at) },
    { label: "Destination", get: (r) => r.destination_facility || r.destination_service || "—" },
    { label: "Reason", get: (r) => r.reason || "—" },
    { label: "Status", get: (r) => r.status || "—", badge: true },
  ],
  "Monthly Maternal Report": [
    { label: "Resident", get: (r) => residentName(r) || "—" },
    { label: "EDD", get: (r) => fmtDate(r.edd) },
    { label: "Prenatal Visits", get: (r) => (r.prenatal_visits ?? r.prenatal_visits === 0 ? String(r.prenatal_visits) : "—") },
    { label: "Risk", get: (r) => r.risk || "—" },
    { label: "Status", get: (r) => r.status || "—", badge: true },
  ],
  "Immunization Report": [
    { label: "Resident", get: (r) => residentName(r) || "—" },
    { label: "Vaccine", get: (r) => r.vaccine || "—" },
    { label: "Dose", get: (r) => r.dose || "—" },
    { label: "Administered", get: (r) => fmtDate(r.administered_date || r.created_at) },
    { label: "Next Dose", get: (r) => fmtDate(r.next_dose) },
    { label: "Status", get: (r) => r.status || "—", badge: true },
  ],
};

/** Light tone for a record-level status badge (neutral default). */
const recordStatusTone = (status) => {
  const s = String(status || "").toLowerCase();
  if (["completed", "accepted", "reviewed", "active"].includes(s)) return "bg-brand-green/10 text-brand-green";
  if (["rejected", "cancelled", "missed"].includes(s)) return "bg-brand-danger/10 text-brand-danger";
  if (["pending", "for review", "ongoing", "scheduled", "upcoming", "today", "high"].includes(s)) return "bg-brand-yellow/15 text-[#B07E00]";
  return "bg-brand-gray/10 text-brand-gray";
};

/** Fallback columns for any record-list type without a specific mapping. */
const GENERIC_COLUMNS = [
  { label: "Resident", get: (r) => residentName(r) || "—" },
  { label: "Date", get: (r) => fmtDate(recordDate(r)) },
  { label: "Status", get: (r) => r.status || "—", badge: true },
];

/** The authenticated, scope-enforced source fetcher for a report type, or null. */
const sourceForType = (type, window) => {
  switch (type) {
    case "Follow-up Report":
    case "Follow-ups":
      return () => followUpsApi.list(window ? { from: window.from, to: window.to } : undefined);
    case "Referral Report":
    case "Referrals":
      return () => referralsApi.list();
    case "Monthly Maternal Report":
      return () => maternalApi.list();
    case "Immunization Report":
      return () => immunizationsApi.list();
    default:
      return null;
  }
};

export default function ReportsPage({ roleKey = "midwife" }) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canGenerate = can("reports.generate");
  const { coverage } = usePhnCoverage();
  const isPhn = roleKey === "phn";
  const coverageLabel = coverage ? (coverage === "RHU" ? "RHU" : coverage) : null;
  const rhuCoverage = coverage === "RHU";

  // Health Supervisor scope — reports are limited to the supervisor's single
  // assigned barangay; the RHU/municipality-level figures are never shown.
  const supervisorScope = getSupervisorScope(user);
  const assignedBarangay = supervisorScope && supervisorScope.level === HS_SCOPE.BARANGAY ? supervisorScope.assignedBarangay : null;
  const canSubmitReports = canGenerate && (isPhn || Boolean(assignedBarangay));

  // A PHN works at the RHU — reports are submitted upward to the MHO, while
  // barangay-level roles submit theirs to the RHU.
  const submitTarget = isPhn ? "MHO" : "RHU";

  const reportTypes = isPhn
    ? REPORT_TYPE_LABELS
    : ["Monthly Maternal Report", "Follow-up Report", "Referral Report", "Immunization Report"];

  // The master list keeps every report the PHN can own; the coverage selector
  // decides which rows are visible (barangay reports vs RHU reports). A
  // barangay-assigned supervisor only ever sees their own barangay's reports.
  const [reports, setReports] = useState(() => (isPhn ? [...PHN_REPORTS] : [...REPORTS]));
  const scopedReports = useMemo(
    () =>
      isPhn
        ? filterRowsByScope(reports, user, coverage)
        : assignedBarangay
          ? // Outgoing reports are already server-scoped to the signed-in
            // Health Supervisor (created_by = self). Keep the barangay guard but
            // never drop a report whose barangay label is missing from the
            // embed, so a resolvable-name hiccup can't hide the user's own work.
            reports.filter((r) => !r.barangay || r.barangay === assignedBarangay)
          : reports,
    [isPhn, reports, user, coverage, assignedBarangay]
  );
  const [selectedReportType, setSelectedReportType] = useState("All");
  // Review step: a generated preview built from real source data, shown before
  // the report is submitted. Submission only happens from here.
  const [preview, setPreview] = useState(/** @type {any} */ (null));
  const [showPreview, setShowPreview] = useState(false);
  // Full, formal report preview opened from the Review summary. Toggling it
  // never submits, re-fetches, or changes the draft — it only reveals the rows
  // already retrieved for the summary.
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Read-only details of a persisted, submitted report (View action).
  const [detailReport, setDetailReport] = useState(/** @type {any} */ (null));
  const [formErrors, setFormErrors] = useState(/** @type {Record<string, any>} */ ({}));
  const [toast, setToast] = useState(null);
  const [reportForm, setReportForm] = useState(() => ({
    reportType: "",
    period: "",
    barangay: phnDefaultBarangay(user, coverage),
  }));
  const [outgoingLoadError, setOutgoingLoadError] = useState("");
  // Distinguish "still loading" from "loaded, but empty" and "failed" so the
  // table never shows the empty-state message during a request or after an error.
  const [loading, setLoading] = useState(canSubmitReports);

  const writableBarangays = phnWritableBarangays(user, coverage);

  // Load the persisted, server-routed reports the caller has submitted. This is
  // the authoritative outgoing list (status + ids come from the backend), so it
  // runs on mount and again after a successful submission.
  const loadOutgoing = useCallback(() => {
    if (!canSubmitReports) {
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setOutgoingLoadError("");
    return reportsApi.list({ box: "outgoing" })
      .then((response) => {
        const persisted = (response?.rows || response?.records || []).map((row) => ({
          id: row.id,
          name: row.title || row.reportType || "Report",
          type: row.reportType,
          period: row.reportPeriod,
          status: row.status === "Submitted" ? (isPhn ? "Submitted to MHO" : "Submitted to RHU") : row.status,
          date: row.createdAt ? new Date(row.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "",
          barangay: row.barangay || assignedBarangay || "",
          submittedDate: row.submittedAt ? new Date(row.submittedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "",
          persisted: true,
        }));
        setReports((prev) => {
          // Preserve locally generated-but-not-yet-submitted drafts (no server
          // id yet) so a background refresh never discards unsaved work.
          const localDrafts = prev.filter((r) => !r.persisted && r.status === "Generated");
          return [...localDrafts, ...persisted];
        });
        setOutgoingLoadError("");
      })
      .catch((error) => {
        setOutgoingLoadError(error?.message || "Could not load submitted reports.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [assignedBarangay, canSubmitReports, isPhn]);

  useEffect(() => {
    let active = true;
    loadOutgoing().finally(() => { if (!active) return; });
    return () => { active = false; };
  }, [loadOutgoing]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const anyModalOpen = showPreview || showFullPreview || Boolean(detailReport);

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // Never let Escape interrupt an in-flight submission.
      if (submitting) return;
      // Escape from the full preview returns to the summary, not all the way out.
      if (showFullPreview) { setShowFullPreview(false); return; }
      setShowPreview(false);
      setDetailReport(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen, submitting, showFullPreview]);

  const filteredReports = scopedReports.filter((r) => {
    const matchesType = selectedReportType === "All" || r.type === selectedReportType;
    return matchesType;
  });

  // Step 1 → 2: validate the form, then build a REAL-data preview from the
  // scope-enforced source APIs. No row is persisted here; submission is a
  // separate, explicit step from the preview.
  const handleGenerate = async () => {
    if (!canGenerate || generating) return;
    const errors = {};
    if (!reportForm.reportType) errors.reportType = "Report type is required.";
    if (!reportForm.period) errors.period = "Reporting period is required.";
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const type = reportForm.reportType;
    const period = reportForm.period;
    const window = monthWindow(period);
    const barangay = isPhn ? normalizeBarangay(reportForm.barangay) : (assignedBarangay || "");
    const name = isPhn && barangay
      ? `${type} (${scopeLabel({ barangay }, user)})`
      : `${type} Report`;
    const fetcher = sourceForType(type, window);

    setGenerating(true);
    try {
      let summary = null;
      let note = "";
      if (fetcher) {
        const res = await fetcher();
        summary = summarizeRecords(res, window);
        if (!summary.periodFiltered) {
          note = "These records do not carry a per-record date, so the totals reflect all records currently in your scope rather than only the selected month.";
        }
      } else {
        note = "A detailed data summary is not available for this report type yet. It will be submitted as a reporting record for the selected period.";
      }
      setPreview({
        name,
        type,
        period,
        barangay,
        scope: isPhn ? scopeLabel({ barangay }, user) : (barangay || "—"),
        summary,
        note,
        records: summary?.records || [],
        generatedAt: new Date(),
      });
      setShowPreview(true);
    } catch (err) {
      setFormErrors((prev) => ({ ...prev, general: err?.message || "Could not generate the report from source data." }));
    } finally {
      setGenerating(false);
    }
  };

  // Step 3: submit the reviewed report through the authenticated backend. The
  // sender, role, scope and recipient routing are all resolved server-side.
  const submitPreview = async () => {
    if (!canSubmitReports || submitting || !preview) return;
    setSubmitting(true);
    try {
      await reportsApi.create({
        reportType: preview.type,
        reportPeriod: preview.period || "",
        title: preview.name || "",
      });
    } catch (err) {
      // Honest failure — the report is NOT marked submitted and the preview
      // stays open so the user can retry or go back.
      showToast(err?.message || "The report could not be submitted. Please try again.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setShowPreview(false);
    setShowFullPreview(false);
    setPreview(null);
    setReportForm({ reportType: "", period: "", barangay: phnDefaultBarangay(user, coverage) });
    showToast("Report submitted successfully.");
    // Re-sync from the backend so the new row (server id/status/timestamps) shows.
    await loadOutgoing();
  };

  const backToEdit = () => {
    // The Prepare form lives inline on the page with its values intact, so
    // "Back to Edit" simply closes the review to return to it.
    setShowFullPreview(false);
    setShowPreview(false);
  };

  // Open the full, formal preview of the current review draft.
  const openReviewFullPreview = () => {
    if (!preview) return;
    setShowFullPreview(true);
  };

  const closeFullPreview = () => setShowFullPreview(false);

  // Print only the report body. A body class scopes the print rules so this
  // never interferes with the certificate / M1 print flows, which have their own.
  const printFullReport = () => {
    const cls = "printing-report";
    const cleanup = () => {
      document.body.classList.remove(cls);
      window.removeEventListener("afterprint", cleanup);
    };
    document.body.classList.add(cls);
    window.addEventListener("afterprint", cleanup);
    window.print();
    // Fallback for browsers that don't fire afterprint reliably.
    setTimeout(cleanup, 1500);
  };

  // Chart shows only the series matching the active coverage (the assigned
  // barangay, or the RHU when the PHN switches to RHU coverage). A
  // barangay-assigned supervisor sees only their barangay's series.
  const trendData = isPhn
    ? phnMonthlyTrend
    : assignedBarangay
      ? comparisonMonthlyConsultations.map((m) => ({ month: m.month, value: m[assignedBarangay] }))
      : monthlyConsultations;
  const chartSeries = isPhn ? [rhuCoverage ? "rhu" : coverageLabel || "rhu"] : [];
  const seriesConfig = {
    rhu: { fill: "#0B5CAD" },
    "San Isidro": { fill: "#2A7DE1" },
    "San Antonio": { fill: "#F5B400" },
    "Old San Roque": { fill: "#E67E22" },
  };
  // The Monthly Consultations trend is not fabricated: it renders only when the
  // trend source actually carries non-zero values. Otherwise an honest empty
  // state is shown instead of a blank chart axis.
  const hasTrendData =
    Array.isArray(trendData) &&
    trendData.some((d) => (isPhn ? chartSeries.some((k) => Number(d?.[k]) > 0) : Number(d?.value) > 0));

  // Report Summary is derived from the REAL, server-persisted reports loaded
  // for this user (scopedReports), never from mock datasets. It reports the
  // caller's own submission pipeline: how many reports exist and where they are
  // in the Submitted -> Received -> Reviewed / Rejected lifecycle. When the user
  // has no reports yet the card shows a genuine empty state.
  const isSubmittedStatus = (s) => s === "Submitted to RHU" || s === "Submitted to MHO" || s === "Submitted";
  const summaryItems = useMemo(() => {
    const total = scopedReports.length;
    if (total === 0) return [];
    const countBy = (pred) => scopedReports.filter(pred).length;
    return [
      { label: "Total Reports", value: String(total) },
      { label: `Submitted to ${submitTarget}`, value: String(countBy((r) => isSubmittedStatus(r.status))) },
      { label: "Received", value: String(countBy((r) => r.status === "Received")) },
      { label: "Reviewed", value: String(countBy((r) => r.status === "Reviewed")) },
      { label: "Returned / Rejected", value: String(countBy((r) => r.status === "Rejected")) },
    ];
  }, [scopedReports, submitTarget]);
  const displayStatus = (report) =>
    isPhn && report.status === "Submitted to RHU" ? "Submitted to MHO" : report.status;

  return (
    <>
      <PageHeader
        crumbs={["Reports"]}
        title="Reports"
        subtitle={
          isPhn
            ? "Prepare, review, and submit RHU-level health reports to the MHO."
            : assignedBarangay
              ? `Prepare, review, and submit Brgy. ${assignedBarangay} health reports to the RHU.`
              : "Prepare, review, and submit your barangay health reports to the RHU."
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* 1 — Primary workflow: prepare & submit a report */}
      <Card className="mb-5 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-brand-ink">Prepare a Report</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-medium text-brand-blue">
            {isPhn ? "Submitted to the MHO" : assignedBarangay ? `Brgy. ${assignedBarangay} → RHU` : "Submitted to the RHU"}
          </span>
        </div>

        {canGenerate ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="rpt-type" className="mb-1.5 block text-sm font-medium text-brand-ink">
                  Report type <span className="text-brand-danger">*</span>
                </label>
                <select
                  id="rpt-type"
                  value={reportForm.reportType}
                  onChange={(e) => {
                    setReportForm({ ...reportForm, reportType: e.target.value });
                    if (formErrors.reportType) setFormErrors((p) => ({ ...p, reportType: "" }));
                  }}
                  className={`w-full rounded-btn border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue dark:bg-card ${formErrors.reportType ? "border-brand-danger" : "border-brand-border"}`}
                >
                  <option value="">Choose a report…</option>
                  {reportTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {formErrors.reportType
                  ? <p className="mt-1 text-xs text-brand-danger">{formErrors.reportType}</p>
                  : <p className="mt-1 text-xs text-brand-gray">Choose the report you need to prepare.</p>}
              </div>

              <div>
                <label htmlFor="rpt-period" className="mb-1.5 block text-sm font-medium text-brand-ink">
                  Reporting period <span className="text-brand-danger">*</span>
                </label>
                <input
                  id="rpt-period"
                  type="month"
                  value={reportForm.period}
                  onChange={(e) => {
                    setReportForm({ ...reportForm, period: e.target.value });
                    if (formErrors.period) setFormErrors((p) => ({ ...p, period: "" }));
                  }}
                  className={`w-full rounded-btn border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue dark:bg-card ${formErrors.period ? "border-brand-danger" : "border-brand-border"}`}
                />
                {formErrors.period
                  ? <p className="mt-1 text-xs text-brand-danger">{formErrors.period}</p>
                  : <p className="mt-1 text-xs text-brand-gray">Select the month covered by this report.</p>}
              </div>

              <div>
                {isPhn ? (
                  <>
                    <label htmlFor="rpt-scope" className="mb-1.5 block text-sm font-medium text-brand-ink">
                      Scope <span className="text-brand-danger">*</span>
                    </label>
                    <select
                      id="rpt-scope"
                      value={reportForm.barangay}
                      onChange={(e) => setReportForm({ ...reportForm, barangay: e.target.value })}
                      className="w-full rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue dark:bg-card"
                    >
                      {writableBarangays.map((b) => (
                        <option key={b} value={b}>{b === "RHU" ? "RHU (no barangay)" : b}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-brand-gray">The area this report applies to.</p>
                  </>
                ) : (
                  <>
                    <label htmlFor="rpt-brgy" className="mb-1.5 block text-sm font-medium text-brand-ink">Barangay</label>
                    <input
                      id="rpt-brgy"
                      type="text"
                      value={assignedBarangay || "—"}
                      readOnly
                      disabled
                      className="w-full cursor-not-allowed rounded-btn border border-brand-border bg-brand-bg px-3 py-2.5 text-sm text-brand-gray outline-none"
                    />
                    <p className="mt-1 text-xs text-brand-gray">Reports cover your assigned barangay.</p>
                  </>
                )}
              </div>
            </div>

            {formErrors.general && <p className="mt-3 text-sm text-brand-danger">{formErrors.general}</p>}

            <div className="mt-4 flex flex-col gap-3 border-t border-brand-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-brand-gray">
                <span className="font-medium text-brand-ink">Next:</span>{" "}
                {!reportForm.reportType
                  ? "Choose a report type to begin."
                  : !reportForm.period
                    ? "Select the month this report covers."
                    : "Generate the report, then review the totals before submitting."}
              </p>
              <button
                onClick={handleGenerate}
                disabled={generating || !canSubmitReports}
                className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" /> {generating ? "Generating…" : "Generate Report"}
              </button>
            </div>
            {!canSubmitReports && !isPhn && (
              <p className="mt-2 text-xs text-brand-gray">Your account has no assigned barangay yet, so reports cannot be generated.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-brand-gray">Your role can review submitted reports below but cannot prepare new ones.</p>
        )}
      </Card>

      {/* 2 — Secondary: submission status + compact consultations trend */}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-brand-ink">Submission Status</h3>
            {!loading && !outgoingLoadError && scopedReports.length > 0 && (
              <span className="text-xs text-brand-gray">{scopedReports.length} total</span>
            )}
          </div>
          {loading ? (
            <p className="inline-flex items-center gap-2 text-sm text-brand-gray"><RefreshCw className="h-4 w-4 animate-spin" /> Loading your reports…</p>
          ) : outgoingLoadError ? (
            <div className="flex items-center justify-between gap-3 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3 py-2.5">
              <p className="text-sm text-brand-danger">{outgoingLoadError}</p>
              <button onClick={() => loadOutgoing()} className="shrink-0 inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : scopedReports.length === 0 ? (
            <div className="rounded-btn border border-dashed border-brand-border p-5 text-center">
              <p className="text-sm font-medium text-brand-ink">No reports submitted yet</p>
              <p className="mt-1 text-xs text-brand-gray">Prepare a report above and it will appear here with its status.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {summaryItems
                  .filter((s) => s.label === "Total Reports" || s.label.startsWith("Submitted") || s.value !== "0")
                  .map((s) => (
                    <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1 text-xs font-medium text-brand-gray">
                      {s.label}: <span className="font-stat font-bold text-brand-ink">{s.value}</span>
                    </span>
                  ))}
              </div>
              <div className="mt-3 border-t border-brand-border">
                <p className="pt-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Recent submissions</p>
                <div className="divide-y divide-brand-border">
                  {scopedReports.slice(0, 4).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setDetailReport(r)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-brand-bg/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-brand-ink">{r.name}</p>
                        <p className="text-xs text-brand-gray">{r.type} · {r.period || "—"}{r.date ? ` · ${r.date}` : ""}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[r.status] || "bg-brand-gray/10 text-brand-gray"}`}>{displayStatus(r)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>

        <Card className="h-fit p-4 sm:p-6">
          <h3 className="mb-1 text-base font-semibold text-brand-ink">{isPhn ? (rhuCoverage ? "RHU Health Cases Trend" : `${coverageLabel} Health Cases Trend`) : "Monthly Consultations"}</h3>
          {hasTrendData ? (
            <ResponsiveContainer width="100%" height={160}>
              {isPhn ? (
                <BarChart data={trendData}>
                  <CartesianGrid vertical={false} stroke="#E5EAF1" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {chartSeries.map((key, i) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key === "rhu" ? "RHU" : key}
                      stackId="a"
                      fill={seriesConfig[key]?.fill || (i % 2 ? "#2A7DE1" : "#F5B400")}
                      radius={i === chartSeries.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      maxBarSize={34}
                    />
                  ))}
                </BarChart>
              ) : (
                <BarChart data={trendData}>
                  <CartesianGrid vertical={false} stroke="#E5EAF1" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
                  <Bar dataKey="value" fill="#0B5CAD" radius={[6, 6, 0, 0]} maxBarSize={34} />
                </BarChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="flex h-28 flex-col items-center justify-center rounded-btn border border-dashed border-brand-border px-4 text-center">
              <p className="text-sm font-medium text-brand-ink">No consultation data yet</p>
              <p className="mt-1 text-xs text-brand-gray">Consultation activity will appear here once records are available.</p>
            </div>
          )}
        </Card>
      </div>

      {/* 3 — Submission history (track status) */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-4">
          <div>
            <h3 className="font-semibold text-brand-ink text-base">Submission History</h3>
            <p className="mt-0.5 text-xs text-brand-gray">Track the status of reports you have submitted.</p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
            <select
              value={selectedReportType}
              onChange={(e) => setSelectedReportType(e.target.value)}
              className="w-full sm:w-auto bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none dark:bg-card"
            >
              <option value="All">All Types</option>
              {reportTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Report Name</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Period</th>
                {isPhn && <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Barangay</th>}
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Date Generated</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((report) => (
                <tr key={report.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-brand-ink">{report.name}</td>
                  <td className="px-4 py-3 text-sm text-brand-gray">{report.type}</td>
                  <td className="px-4 py-3 text-sm text-brand-gray">{report.period}</td>
                  {isPhn && <td className="px-4 py-3 text-sm text-brand-gray">{scopeLabel(report, user)}</td>}
                  <td className="px-4 py-3 text-sm text-brand-gray">{report.date}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[report.status]}`}>
                      {displayStatus(report)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => setDetailReport(report)}
                        className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                      >
                        <Eye className="w-4 h-4" /> View
                      </button>
                      {(report.status === "Submitted to RHU" || report.status === "Submitted to MHO" || report.status === "Submitted") && (
                        <span className="flex items-center gap-1 text-xs text-brand-green">
                          <Check className="w-3 h-3" /> Submitted{report.submittedDate ? ` • ${report.submittedDate}` : ""}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredReports.length === 0 && loading && (
                <tr>
                  <td colSpan={isPhn ? 7 : 6} className="px-4 py-10 text-center text-sm text-brand-gray">
                    <span className="inline-flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Loading reports…
                    </span>
                  </td>
                </tr>
              )}
              {filteredReports.length === 0 && !loading && outgoingLoadError && (
                <tr>
                  <td colSpan={isPhn ? 7 : 6} className="px-4 py-10 text-center text-sm">
                    <p className="font-medium text-brand-danger">{outgoingLoadError}</p>
                    <button
                      onClick={() => loadOutgoing()}
                      className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue"
                    >
                      <RefreshCw className="h-4 w-4" /> Retry
                    </button>
                  </td>
                </tr>
              )}
              {filteredReports.length === 0 && !loading && !outgoingLoadError && (
                <tr>
                  <td colSpan={isPhn ? 7 : 6} className="px-4 py-12 text-center">
                    {scopedReports.length === 0 ? (
                      <div className="flex flex-col items-center">
                        <FileText className="h-8 w-8 text-brand-gray/40" />
                        <p className="mt-3 text-sm font-medium text-brand-ink">No reports yet</p>
                        <p className="mt-1 text-xs text-brand-gray">
                          {canSubmitReports
                            ? `Use "Prepare a Report" above to generate one, review the totals, then submit it to the ${submitTarget}. Submitted reports appear here.`
                            : "No reports are available for your account."}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-brand-gray">No reports match the selected type filter.</p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Review / Preview Modal — real-data summary before submission */}
      {showPreview && preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Review Report</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">Confirm the details below, then submit to the {submitTarget}.</p>
                </div>
                <button onClick={() => { if (!submitting) { setShowPreview(false); } }} disabled={submitting} className="text-brand-gray hover:text-brand-ink disabled:opacity-60" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 rounded-btn border border-brand-border bg-brand-bg/50 p-4">
                {[
                  ["Report", preview.name],
                  ["Type", preview.type],
                  ["Period", preview.period || "—"],
                  [isPhn ? "Scope" : "Barangay", preview.scope || "—"],
                  ["Recipient", submitTarget],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 text-sm">
                    <span className="shrink-0 text-brand-gray">{label}</span>
                    <span className="min-w-0 text-right font-medium text-brand-ink">{value}</span>
                  </div>
                ))}
              </div>

              {/* Report contents built from real, scope-enforced source records */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-brand-ink mb-2">Report Contents</h4>
                {preview.summary ? (
                  preview.summary.total === 0 ? (
                    <div className="rounded-btn border border-brand-border bg-white p-4 text-sm text-brand-gray dark:bg-card">
                      No source records were found{preview.summary.periodFiltered ? " for the selected period" : " in your scope"}. You can go back and choose a different period, or submit this as a zero report.
                    </div>
                  ) : (
                    <div className="rounded-btn border border-brand-border bg-white p-4 dark:bg-card">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-brand-gray">
                          {preview.summary.periodFiltered ? "Records in the selected period" : "Records in your scope"}
                        </span>
                        <span className="font-stat font-bold text-brand-ink">{preview.summary.total}</span>
                      </div>
                      {Object.entries(preview.summary.byStatus).length > 0 && (
                        <div className="mt-3 border-t border-brand-border pt-3 space-y-1.5">
                          {Object.entries(preview.summary.byStatus).map(([status, count]) => (
                            <div key={status} className="flex items-center justify-between text-xs">
                              <span className="text-brand-gray">{status}</span>
                              <span className="font-medium text-brand-ink">{count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className="rounded-btn border border-brand-border bg-white p-4 text-sm text-brand-gray dark:bg-card">
                    {preview.note}
                  </div>
                )}
                {preview.summary && preview.note && (
                  <p className="mt-2 text-xs text-brand-gray">{preview.note}</p>
                )}
                {preview.summary && (
                  <button
                    onClick={openReviewFullPreview}
                    className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-blue px-4 py-2 text-sm font-medium text-brand-blue hover:bg-brand-blue/5 transition-colors"
                  >
                    <Eye className="w-4 h-4" /> Preview Full Report
                  </button>
                )}
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-brand-border pt-4">
                <button
                  onClick={backToEdit}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium text-brand-ink border border-brand-border hover:border-brand-blue hover:text-brand-blue transition-colors disabled:opacity-60"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Edit
                </button>
                <button
                  onClick={() => { if (!submitting) { setShowPreview(false); setPreview(null); } }}
                  disabled={submitting}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
                {canSubmitReports && (
                  <button
                    onClick={submitPreview}
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Send className="w-4 h-4" /> {submitting ? "Submitting…" : `Submit to ${submitTarget}`}
                  </button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Full Report Preview — a formal, readable rendering of the real records
          that back the report. Opening/closing it never submits or re-fetches. */}
      {showFullPreview && preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:static print:block print:bg-white print:p-0">
          <Card className="w-full max-w-4xl max-h-[94vh] overflow-y-auto print:max-h-none print:w-full print:overflow-visible print:border-0 print:shadow-none">
            <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-3 dark:bg-card">
              <h3 className="text-sm font-semibold text-brand-ink">Full Report Preview</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={printFullReport}
                  className="inline-flex items-center gap-2 rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
                </button>
                <button
                  onClick={closeFullPreview}
                  className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Summary
                </button>
                <button onClick={closeFullPreview} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="report-print-area p-6 sm:p-8">
              {/* Report heading */}
              <div className="border-b border-brand-border pb-4 text-center">
                <p className="text-xs uppercase tracking-wide text-brand-gray">Municipal Health Office — Pili, Camarines Sur</p>
                <h2 className="mt-1 text-xl font-bold text-brand-ink">{preview.name}</h2>
                <p className="mt-0.5 text-sm text-brand-gray">{preview.type} · Community Health Report</p>
              </div>

              {/* Report metadata */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Reporting Period", preview.period || "—"],
                  [isPhn ? "Scope" : "Barangay", preview.scope || "—"],
                  ["Recipient", `${submitTarget}`],
                  ["Generated", preview.generatedAt ? preview.generatedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-btn border border-brand-border bg-brand-bg/40 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                    <p className="mt-0.5 font-medium text-brand-ink">{value}</p>
                  </div>
                ))}
              </div>
              {user?.name && (
                <p className="mt-2 text-xs text-brand-gray">Prepared by {user.name}{assignedBarangay ? `, Health Supervisor — ${assignedBarangay}` : ""}.</p>
              )}

              {/* Summary statistics */}
              <div className="mt-5">
                <h4 className="text-sm font-semibold text-brand-ink">Summary</h4>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-btn bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-blue">
                    Total records: {preview.summary?.total ?? 0}
                  </span>
                  {Object.entries(preview.summary?.byStatus || {}).map(([status, count]) => (
                    <span key={status} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${recordStatusTone(status)}`}>
                      {status}: {count}
                    </span>
                  ))}
                </div>
                {!preview.summary?.periodFiltered && (
                  <p className="mt-2 text-xs text-brand-gray">Totals reflect all records currently in your scope (these records do not carry a per-record date for the selected month).</p>
                )}
              </div>

              {/* Detailed records */}
              <div className="mt-5">
                <h4 className="mb-2 text-sm font-semibold text-brand-ink">Included Records</h4>
                {(preview.records || []).length === 0 ? (
                  <div className="rounded-btn border border-dashed border-brand-border p-8 text-center">
                    <FileText className="mx-auto h-8 w-8 text-brand-gray/40" />
                    <p className="mt-2 text-sm font-medium text-brand-ink">No records for this period</p>
                    <p className="mt-1 text-xs text-brand-gray">There are no {preview.type?.toLowerCase()} records in {preview.period || "the selected period"} for your scope.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-btn border border-brand-border">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-brand-bg">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-brand-gray">#</th>
                          {(REPORT_COLUMNS[preview.type] || GENERIC_COLUMNS).map((c) => (
                            <th key={c.label} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-brand-gray">{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(preview.records || []).map((rec, i) => (
                          <tr key={rec.id || i} className="border-t border-brand-border">
                            <td className="px-4 py-2.5 text-brand-gray">{i + 1}</td>
                            {(REPORT_COLUMNS[preview.type] || GENERIC_COLUMNS).map((c) => {
                              const value = c.get(rec);
                              return (
                                <td key={c.label} className="px-4 py-2.5 text-brand-ink">
                                  {c.badge
                                    ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${recordStatusTone(value)}`}>{value}</span>
                                    : value}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-3 text-xs text-brand-gray">
                  Showing {(preview.records || []).length} record{(preview.records || []).length === 1 ? "" : "s"} — the same set counted in the summary total.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Report Details Modal (View a persisted submission) */}
      {detailReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{detailReport.name}</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">{detailReport.type}{detailReport.period ? ` · ${detailReport.period}` : ""}</p>
                </div>
                <button onClick={() => setDetailReport(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-2 rounded-btn border border-brand-border bg-brand-bg/50 p-4">
                {[
                  ["Type", detailReport.type || "—"],
                  ["Period", detailReport.period || "—"],
                  [isPhn ? "Scope" : "Barangay", (isPhn ? scopeLabel(detailReport, user) : detailReport.barangay) || "—"],
                  ["Recipient", submitTarget],
                  ["Status", displayStatus(detailReport)],
                  ["Date Generated", detailReport.date || "—"],
                  ["Submitted", detailReport.submittedDate || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 text-sm">
                    <span className="shrink-0 text-brand-gray">{label}</span>
                    <span className="min-w-0 text-right font-medium text-brand-ink">{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setDetailReport(null)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
