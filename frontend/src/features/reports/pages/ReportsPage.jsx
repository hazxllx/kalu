import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import ErrorState from "@/components/common/ErrorState";
import { Download, Send, Check, CheckCircle2, X, RefreshCw, FileText, ArrowLeft, Eye, Printer, AlertTriangle } from "lucide-react";
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
import { authorizedViewsApi } from "@/services/api/authorizedViewsApi";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { lastActivityPeriod } from "@/lib/legacyAnalytics";
import { formatDateRange } from "@/lib/dateUtils";
import { reportsApi, referralsApi, followUpsApi, maternalApi, immunizationsApi, healthServicesApi } from "@/services/api";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import IncomingReports from "@/features/reports/components/IncomingReports";
import ReportSnapshotView from "@/features/reports/components/ReportSnapshotView";
import {
  REPORT_COLUMNS,
  GENERIC_COLUMNS,
  recordStatusTone,
  buildReportContent,
  hasSnapshot,
} from "@/features/reports/lib/reportSnapshot";
import { summarizeRecords } from "@/features/reports/lib/reportGeneration";

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
  "Needs Revision": "bg-brand-danger/10 text-brand-danger",
  Reviewed: "bg-brand-green/10 text-brand-green",
  Rejected: "bg-brand-danger/10 text-brand-danger",
};

const REPORT_TYPE_LABELS = ["Health Records", "Referrals", "Follow-ups", "Health Services", "Community Health Trends"];

const reportDateTime = (value) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

// --- Real-data report generation helpers ----------------------------------
//
// A generated report preview is built from the SAME authenticated, scope-
// enforced APIs the clinical pages use. Nothing is fabricated: totals are the
// count of real records the backend returns for the signed-in user's scope,
// optionally narrowed to the selected reporting month when the records carry a
// date. Report types with no record-list source fall back to an honest "no
// detailed summary available" note rather than inventing numbers.

/** Candidate per-record date fields, most clinically-relevant first. */
// NOTE: per-record date resolution, resident-name formatting, the per-type
// column maps and the status-badge tone now live in the shared snapshot lib
// (@/features/reports/lib/reportSnapshot) so the live preview and the persisted
// recipient view render identically. Only the preview-building helpers that
// are specific to this page remain below.

/** Compute the inclusive [from,to] YYYY-MM-DD window for a "YYYY-MM" period. */
const monthWindow = (period) => {
  if (!/^\d{4}-\d{2}$/.test(String(period || ""))) return null;
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` };
};

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
    case "Health Services":
      return () => healthServicesApi.listAttendance(window ? { from: window.from, to: window.to } : undefined);
    default:
      return null;
  }
};

export default function ReportsPage({ roleKey = "midwife" }) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canGenerate = can("reports.generate");
  const canViewReports = can("reports.view");
  const canViewAnalytics = can("reports.analytics.view");
  const supervisor = user?.role === "health_supervisor";
  const { coverage } = usePhnCoverage();
  const isPhn = roleKey === "phn";
  const coverageLabel = coverage ? (coverage === "RHU" ? "RHU" : coverage) : null;
  const rhuCoverage = coverage === "RHU";

  // Health Supervisor scope — reports are limited to the supervisor's single
  // assigned barangay; the RHU/municipality-level figures are never shown.
  const supervisorScope = getSupervisorScope(user);
  const assignedBarangay = supervisorScope && supervisorScope.level === HS_SCOPE.BARANGAY ? supervisorScope.assignedBarangay : null;
  const canSubmitReports = canGenerate && (isPhn || Boolean(assignedBarangay));
  const canLoadOutgoing = canViewReports && (!supervisor || Boolean(assignedBarangay));

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
  const [reportsOwner, setReportsOwner] = useState(null);
  const outgoingRequest = useRef(0);
  const scopedReports = useMemo(
    () =>
      supervisor && (reportsOwner !== user?.id || !assignedBarangay) ? [] : isPhn
        ? filterRowsByScope(reports, user, coverage)
        : assignedBarangay
          ? // Outgoing reports are already server-scoped to the signed-in
            // Health Supervisor (created_by = self). Keep the barangay guard but
            // never drop a report whose barangay label is missing from the
            // embed, so a resolvable-name hiccup can't hide the user's own work.
            reports.filter((r) => !r.barangay || r.barangay === assignedBarangay)
          : reports,
    [isPhn, reports, user, coverage, assignedBarangay, supervisor, reportsOwner]
  );
  const [selectedReportType, setSelectedReportType] = useState("All");
  const [selectedPeriod, setSelectedPeriod] = useState("");
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
  const [revisionTarget, setRevisionTarget] = useState(/** @type {any} */ (null));
  // The persisted snapshot for the opened report, fetched on demand so the
  // sender reviews EXACTLY what was submitted (not a live reconstruction).
  const [detailContent, setDetailContent] = useState(/** @type {any} */ (null));
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [detailOwner, setDetailOwner] = useState(null);
  const detailStatus = detailContent?.status || detailReport?.status;
  const [submitError, setSubmitError] = useState("");
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
  const [loading, setLoading] = useState(canLoadOutgoing);

  const writableBarangays = phnWritableBarangays(user, coverage);

  // Load the persisted, server-routed reports the caller has submitted. This is
  // the authoritative outgoing list (status + ids come from the backend), so it
  // runs on mount and again after a successful submission.
  const loadOutgoing = useCallback(() => {
    const requestId = ++outgoingRequest.current;
    if (!canLoadOutgoing) {
      setReports([]);
      setOutgoingLoadError(supervisor && !assignedBarangay ? "A valid barangay assignment is required to view report history." : !canViewReports ? "Your account is not permitted to view reports." : "");
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setOutgoingLoadError("");
    return reportsApi.list({ box: "outgoing" }, { ownerId: user?.id })
      .then((response) => {
        if (requestId !== outgoingRequest.current) return;
        const rows = response?.rows || response?.records;
        if (!Array.isArray(rows)) throw new Error("The report history response was incomplete.");
        const persisted = rows.map((row) => ({
          id: row.id,
          name: row.title || row.reportType || "Report",
          type: row.reportType,
          period: row.reportPeriod,
          status: row.status === "Submitted" ? (isPhn ? "Submitted to MHO" : "Submitted to RHU") : row.status,
          date: row.createdAt ? new Date(row.createdAt).toLocaleDateString(supervisor ? "en-PH" : "en-US", { ...(supervisor ? { timeZone: "Asia/Manila" } : {}), month: supervisor ? "short" : "long", day: "numeric", year: "numeric" }) : "",
          barangay: row.barangay || assignedBarangay || "",
          submittedDate: row.submittedAt ? new Date(row.submittedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "",
          remarks: row.remarks || "",
          reviewedAt: row.reviewedAt,
          reviewedByName: row.reviewedByName,
          persisted: true,
        }));
        setReports((prev) => {
          // Preserve locally generated-but-not-yet-submitted drafts (no server
          // id yet) so a background refresh never discards unsaved work.
          const localDrafts = prev.filter((r) => !r.persisted && r.status === "Generated");
          return [...localDrafts, ...persisted];
        });
        setReportsOwner(user?.id);
        setOutgoingLoadError("");
      })
      .catch((error) => {
        if (requestId !== outgoingRequest.current) return;
        setOutgoingLoadError(error?.message || "Could not load submitted reports.");
      })
      .finally(() => {
        if (requestId === outgoingRequest.current) setLoading(false);
      });
  }, [assignedBarangay, canLoadOutgoing, canViewReports, isPhn, supervisor, user?.id]);

  useEffect(() => {
    void loadOutgoing();
    return () => { outgoingRequest.current += 1; };
  }, [loadOutgoing]);
  useEffect(() => {
    setDetailReport(null);
    setShowPreview(false);
    setShowFullPreview(false);
    setPreview(null);
    setRevisionTarget(null);
    setSubmitError("");
  }, [user?.id]);

  // Fetch the persisted snapshot whenever a submitted report is opened for
  // viewing. Local, not-yet-submitted drafts have no server content and skip
  // the fetch; legacy rows return with hasContent=false so the modal can show
  // an explicit "content unavailable" state.
  useEffect(() => {
    if (!detailReport?.id || !detailReport.persisted) {
      setDetailContent(null);
      setDetailError("");
      setDetailLoading(false);
      return undefined;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError("");
    setDetailContent(null);
    reportsApi.get(detailReport.id, { ownerId: user?.id })
      .then((res) => {
        if (!active) return;
        if (!res?.record || String(res.record.id) !== String(detailReport.id)) throw new Error("The saved report was not returned.");
        setDetailContent(res?.record || null);
      })
      .catch((err) => {
        if (!active) return;
        setDetailError(err?.message || "Could not load the submitted report.");
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => { active = false; };
  }, [detailReport, detailRetry, user?.id]);

  const openReportDetail = (report) => {
    setSubmitError("");
    setDetailOwner(user?.id);
    setDetailReport(report);
  };

  const showToast = (message, type = "success") => {
    setToast({ message, type });
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
    return matchesType && (!supervisor || !selectedPeriod || r.period === selectedPeriod);
  });

  // Validate real source data and save the draft snapshot before review.
  // Submission remains a separate, explicit action.
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
      : supervisor && type.endsWith("Report") ? type : `${type} Report`;
    const fetcher = sourceForType(type, window);

    setGenerating(true);
    setSubmitError("");
    try {
      let summary = null;
      let note = "";
      if (!fetcher) throw new Error("This report type has no connected source data and cannot be generated or submitted yet.");
      const res = await fetcher();
      summary = summarizeRecords(res, window);
      note = summary.note;
      const generatedPreview = {
        name,
        type,
        period,
        barangay,
        scope: isPhn ? scopeLabel({ barangay }, user) : (barangay || "—"),
        summary,
        note,
        records: summary?.records || [],
        generatedAt: new Date(),
      };
      if (!revisionTarget?.id) {
        const saved = await reportsApi.create({
          reportType: type,
          reportPeriod: period,
          title: name,
          status: "Draft",
          content: buildReportContent(generatedPreview),
        });
        if (!saved?.record?.id) throw new Error("The report draft was not saved. Please try generating it again.");
        generatedPreview.draftId = saved.record.id;
      }
      setPreview(generatedPreview);
      setShowPreview(true);
      void loadOutgoing();
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
    setSubmitError("");
    try {
      const content = buildReportContent(preview);
      if (revisionTarget?.id) {
        await reportsApi.resubmit(revisionTarget.id, { content });
      } else if (preview.draftId) {
        await reportsApi.submit(preview.draftId);
      } else {
        throw new Error("The reviewed report draft is missing. Generate the report again before submitting.");
      }
    } catch (err) {
      // Honest failure — the report is NOT marked submitted and the preview
      // stays open so the user can retry or go back.
      setSubmitError(err?.message || "The report could not be submitted. Please try again.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setShowPreview(false);
    setShowFullPreview(false);
    setPreview(null);
    setRevisionTarget(null);
    setReportForm({ reportType: "", period: "", barangay: phnDefaultBarangay(user, coverage) });
    showToast(revisionTarget ? "Revised report submitted successfully." : "Report submitted successfully.");
    // Re-sync from the backend so the new row (server id/status/timestamps) shows.
    await loadOutgoing();
  };

  const submitStoredDraft = async () => {
    if (!canSubmitReports || submitting || detailStatus !== "Draft" || !detailReport?.id || !hasSnapshot(detailContent?.content)) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await reportsApi.submit(detailReport.id);
    } catch (err) {
      setSubmitError(err?.message || "The draft could not be submitted. Please try again.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setDetailReport(null);
    showToast("Report submitted successfully.");
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

  const trendRange = lastActivityPeriod(6);
  const loadTrend = useCallback(async (options) => {
    if (!supervisor || !canViewAnalytics || !assignedBarangay) return null;
    const result = await authorizedViewsApi.earlyWarning({ barangay: assignedBarangay, ...lastActivityPeriod(6) }, options);
    if (result.scope?.barangay !== assignedBarangay) throw new Error("The consultation trend did not match your authorized barangay scope.");
    return result;
  }, [supervisor, canViewAnalytics, assignedBarangay]);
  const trendResource = useAuthorizedData(loadTrend);
  // The supervisor chart uses real aggregates, independently of report snapshots.
  // PHN coverage presentation and its existing series are retained.
  const trendData = isPhn
    ? phnMonthlyTrend
    : trendResource.data?.consultationTrends?.slice(-6).map((row) => ({ month: row.month, value: row.consultations })) || [];
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
  const trendComplete = trendResource.data && trendData.every((row) => Number.isFinite(row.value) && row.value >= 0);

  // Report Summary is derived from the REAL, server-persisted reports loaded
  // for this user (scopedReports), never from mock datasets. It reports the
  // caller's own submission pipeline: how many reports exist and where they are
  // in the Submitted -> Received -> Reviewed / Rejected lifecycle. When the user
  // has no reports yet the card shows a genuine empty state.
  const summaryItems = useMemo(() => {
    const total = scopedReports.length;
    if (total === 0) return [];
    const countBy = (pred) => scopedReports.filter(pred).length;
    return [
      { label: "Total Reports", value: String(total) },
      { label: "Pending Review", value: String(countBy((r) => ["Submitted", "Submitted to RHU", "Submitted to MHO", "Received"].includes(r.status))) },
      { label: "Approved", value: String(countBy((r) => r.status === "Reviewed")) },
      { label: "Needs Revision", value: String(countBy((r) => r.status === "Needs Revision")) },
      { label: "Rejected", value: String(countBy((r) => r.status === "Rejected")) },
    ];
  }, [scopedReports, submitTarget]);
  const displayStatus = (report) => {
    if (["Submitted", "Submitted to RHU", "Submitted to MHO", "Received"].includes(report.status)) return "Pending Review";
    if (report.status === "Reviewed") return "Approved";
    return report.status;
  };

  return (
    <div className={supervisor ? "supervisor-module" : "contents"}>
      <PageHeader
        crumbs={["Reports"]}
        title="Reports"
        subtitle={
          isPhn
            ? "Prepare, review, and submit RHU-level health reports to the MHO."
            : assignedBarangay
              ? `Prepare, review, and submit Brgy. ${assignedBarangay} health reports to the RHU.`
              : supervisor ? "A valid barangay assignment is required to prepare and view reports."
              : "Prepare, review, and submit your barangay health reports to the RHU."
        }
      />

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2 ${toast.type === "error" ? "bg-brand-danger text-white" : "bg-brand-ink text-white"}`}>
          {toast.type === "error" ? <AlertTriangle className="w-4 h-4" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4 text-brand-green" aria-hidden="true" />}
          <span className="text-sm">{toast.message}</span>
        </div>
      )}

      {/* Incoming oversight inbox — PHN has municipality-wide read/review
          oversight of reports routed to the RHU. Barangay-level Health
          Supervisors are senders only, so this is shown for the PHN view. */}
      {isPhn && (
        <div className="mb-5">
          <IncomingReports />
        </div>
      )}

      {/* 1 — Primary workflow: prepare & submit a report */}
      <Card className={supervisor ? "supervisor-form mb-4 p-4" : "mb-5 p-4 sm:p-6"}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-brand-ink">{supervisor ? "1. Prepare Report" : "Prepare a Report"}</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-medium text-brand-blue">
            {isPhn ? "Submitted to the MHO" : assignedBarangay ? `Brgy. ${assignedBarangay} → RHU` : "Submitted to the RHU"}
          </span>
        </div>

        {supervisor && revisionTarget && <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-ui text-amber-900"><p className="font-medium">Preparing revision: {revisionTarget.type}, {revisionTarget.period}</p>{revisionTarget.remarks && <p className="mt-1 whitespace-pre-wrap">{revisionTarget.remarks}</p>}<button type="button" onClick={() => { setRevisionTarget(null); setFormErrors({}); }} className="supervisor-button is-quiet mt-2">Cancel revision</button></div>}

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
                     : supervisor ? "Generate a saved draft, review its source records, then submit to the RHU." : "Generate the report, then review the totals before submitting."}
              </p>
              <button
                onClick={handleGenerate}
                disabled={generating || !canSubmitReports}
                className={supervisor ? "supervisor-button is-primary" : "inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark transition-colors disabled:cursor-not-allowed disabled:opacity-60"}
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
      <div className={`grid lg:grid-cols-3 ${supervisor ? "mb-4 gap-4" : "mb-5 gap-5"}`}>
        <Card className={supervisor ? "p-4 lg:col-span-2" : "p-4 sm:p-6 lg:col-span-2"}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-brand-ink">Submission Status</h3>
            {!loading && !outgoingLoadError && scopedReports.length > 0 && (
              <span className="text-xs text-brand-gray">{scopedReports.length} {supervisor ? "loaded" : "total"}</span>
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
              <p className="text-sm font-medium text-brand-ink">{supervisor ? "No saved reports yet" : "No reports submitted yet"}</p>
              <p className="mt-1 text-xs text-brand-gray">Prepare a report above and it will appear here with its status.</p>
            </div>
          ) : (
            <>
               {supervisor ? <div className="supervisor-metric-grid mb-3">
                 {[ ["Pending Review", summaryItems.find((item) => item.label === "Pending Review")?.value], ["Approved", summaryItems.find((item) => item.label === "Approved")?.value], ["Needs Revision", summaryItems.find((item) => item.label === "Needs Revision")?.value], ["Rejected", summaryItems.find((item) => item.label === "Rejected")?.value] ].map(([label, value], index) => <StatCard key={label} variant="ledger" label={label} value={value} tone={["blue", "green", "yellow", "danger"][index]} />)}
               </div> : <div className="flex flex-wrap gap-2">
                {summaryItems
                  .filter((s) => s.label === "Total Reports" || s.label.startsWith("Submitted") || s.value !== "0")
                  .map((s) => (
                    <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1 text-xs font-medium text-brand-gray">
                      {s.label}: <span className="font-stat font-bold text-brand-ink">{s.value}</span>
                    </span>
                  ))}
               </div>}
              <div className="mt-3 border-t border-brand-border">
                <p className="pt-3 text-xs font-medium uppercase tracking-wide text-brand-gray">Recent submissions</p>
                <div className="divide-y divide-brand-border">
                  {scopedReports.slice(0, 4).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => openReportDetail(r)}
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

        <Card className={supervisor ? "h-fit p-4" : "h-fit p-4 sm:p-6"}>
          <h3 className="mb-1 text-base font-semibold text-brand-ink">{isPhn ? (rhuCoverage ? "RHU Health Cases Trend" : `${coverageLabel} Health Cases Trend`) : "Monthly Consultations"}</h3>
          {supervisor && <p className="mb-3 text-caption text-brand-gray">Recorded consultations, {formatDateRange(trendRange.from, trendRange.to)}. Current month is partial; independent of saved report snapshots.</p>}
          {supervisor && (!canViewAnalytics || !assignedBarangay) ? <p className="py-4 text-ui text-brand-gray">Consultation analytics are unavailable for this account's permission or barangay assignment.</p> : supervisor && trendResource.loading ? <p role="status" className="py-4 text-ui text-brand-gray">Loading authorized consultation counts...</p> : supervisor && trendResource.error ? <ErrorState compact title="Consultation trend unavailable" message={trendResource.error} onRetry={trendResource.refresh} /> : supervisor && !trendComplete ? <div className="py-4 text-ui text-brand-gray"><p>The aggregate source did not provide complete consultation counts.</p><button type="button" className="supervisor-button mt-2" onClick={trendResource.refresh}>Retry analytics</button></div> : hasTrendData ? (
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
                  <Bar isAnimationActive={!supervisor} dataKey="value" name="Consultations" fill={supervisor ? "#0B4A8F" : "#0B5CAD"} radius={supervisor ? [2, 2, 0, 0] : [6, 6, 0, 0]} maxBarSize={34} />
                </BarChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="flex h-28 flex-col items-center justify-center rounded-btn border border-dashed border-brand-border px-4 text-center">
              <p className="text-sm font-medium text-brand-ink">{supervisor ? "No consultations in this period" : "No consultation data yet"}</p>
              <p className="mt-1 text-xs text-brand-gray">{supervisor ? "The authorized aggregate contains no recorded consultations in the displayed monthly window." : "Consultation activity will appear here once records are available."}</p>
            </div>
          )}
        </Card>
      </div>

      {/* 3 — Submission history (track status) */}
      <Card className={supervisor ? "p-4" : "p-4 sm:p-6"}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-4">
          <div>
            <h3 className="font-semibold text-brand-ink text-base">Submission History</h3>
            <p className="mt-0.5 text-xs text-brand-gray">{supervisor ? "Saved drafts and submitted reports, with their persisted workflow status." : "Track the status of reports you have submitted."}</p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
            {supervisor ? <>
              <label htmlFor="report-history-type" className="text-caption font-medium text-brand-gray">Report Type<select id="report-history-type" value={selectedReportType} onChange={(e) => setSelectedReportType(e.target.value)} className="supervisor-input mt-1 block w-full"><option value="All">All types</option>{reportTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              <label htmlFor="report-history-period" className="text-caption font-medium text-brand-gray">Reporting Month<input id="report-history-period" type="month" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)} className="supervisor-input mt-1 block w-full" /></label>
              {(selectedReportType !== "All" || selectedPeriod) && <button type="button" onClick={() => { setSelectedReportType("All"); setSelectedPeriod(""); }} className="supervisor-button is-quiet self-end">Clear filters</button>}
            </> : <select
              value={selectedReportType}
              onChange={(e) => setSelectedReportType(e.target.value)}
              className="w-full sm:w-auto bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none dark:bg-card"
            >
              <option value="All">All Types</option>
              {reportTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className={`w-full ${supervisor ? "ui-table" : ""}`} aria-busy={loading}>
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
              {(supervisor && (loading || outgoingLoadError) ? [] : filteredReports).map((report) => (
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
                        onClick={() => openReportDetail(report)}
                        className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                      >
                        <Eye className="w-4 h-4" /> {report.status === "Draft" ? "Review draft" : "View"}
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
              {(supervisor || filteredReports.length === 0) && loading && (
                <tr>
                  <td colSpan={isPhn ? 7 : 6} className="px-4 py-10 text-center text-sm text-brand-gray">
                    <span className="inline-flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Loading reports…
                    </span>
                  </td>
                </tr>
              )}
              {(supervisor || filteredReports.length === 0) && !loading && outgoingLoadError && (
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
                      <p className="text-sm text-brand-gray">No reports match the selected filters.</p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {supervisor && !loading && !outgoingLoadError && <p className="mt-2 text-caption text-brand-gray">Showing {filteredReports.length} of {scopedReports.length} loaded reports. History loads up to 200 records; these are not expected-submission totals.</p>}
      </Card>

      {/* Review / Preview Modal — real-data summary before submission */}
      {showPreview && preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Review Report" className={`w-full max-w-lg max-h-[92vh] overflow-y-auto ${supervisor ? "supervisor-modal" : ""}`}>
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{supervisor ? "2. Review Saved Draft" : "Review Report"}</h3>
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

              {submitError && (
                <p role="alert" className="mt-4 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3 py-2 text-sm text-brand-danger">
                  {submitError}
                </p>
              )}
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
                    <Send className="w-4 h-4" /> {submitting ? "Submitting…" : submitError ? `Retry submission to ${submitTarget}` : revisionTarget ? `Resubmit to ${submitTarget}` : `Submit to ${submitTarget}`}
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
          <Card className={`w-full max-w-4xl max-h-[94vh] overflow-y-auto print:max-h-none print:w-full print:overflow-visible print:border-0 print:shadow-none ${supervisor ? "supervisor-modal" : ""}`}>
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
      {detailReport && (!supervisor || detailOwner === user?.id) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Saved Report Details" className={`w-full max-w-lg max-h-[92vh] overflow-y-auto ${supervisor ? "supervisor-modal" : ""}`}>
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{detailReport.name}</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">{detailReport.type}{detailReport.period ? ` · ${detailReport.period}` : ""}</p>
                </div>
                <button onClick={() => !submitting && setDetailReport(null)} disabled={submitting} className="text-brand-gray hover:text-brand-ink disabled:opacity-60" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {supervisor && (detailContent?.remarks || detailReport.remarks) && <section className="mt-4 rounded border border-amber-300 bg-amber-50 p-3"><h4 className="text-ui font-semibold text-amber-900">{["Needs Revision", "Rejected"].includes(detailContent?.status || detailReport.status) ? "Reviewer Explanation" : "Reviewer Remarks"}</h4><p className="mt-1 whitespace-pre-wrap text-ui text-amber-900">{detailContent?.remarks || detailReport.remarks}</p>{(detailContent?.reviewedByName || detailReport.reviewedByName) && <p className="mt-2 text-caption text-amber-900">{detailContent?.reviewedByName || detailReport.reviewedByName}{(detailContent?.reviewedAt || detailReport.reviewedAt) ? ` · ${reportDateTime(detailContent?.reviewedAt || detailReport.reviewedAt)}` : ""}</p>}</section>}
              {supervisor && Array.isArray(detailContent?.history) && detailContent.history.length > 0 && <section className="mt-4"><h4 className="mb-2 text-ui font-semibold text-brand-ink">Persisted Report History</h4><ol className="divide-y divide-brand-border rounded border border-brand-border px-3">{detailContent.history.map((event, index) => <li key={`${event.at}-${index}`} className="py-2"><p className="text-ui font-medium text-brand-ink">{event.previousStatus ? `${event.previousStatus} → ` : ""}{event.status || event.action}</p><p className="text-caption text-brand-gray">{reportDateTime(event.at)}{event.actorName ? ` · ${event.actorName}` : ""}{event.actorRole ? ` (${event.actorRole.replaceAll("_", " ")})` : ""}</p>{event.explanation && <p className="mt-1 whitespace-pre-wrap text-ui text-brand-gray">{event.explanation}</p>}</li>)}</ol></section>}
              <div className="space-y-2 rounded-btn border border-brand-border bg-brand-bg/50 p-4">
                {[
                  ["Type", detailReport.type || "—"],
                  ["Period", detailReport.period || "—"],
                  [isPhn ? "Scope" : "Barangay", (isPhn ? scopeLabel(detailReport, user) : detailReport.barangay) || "—"],
                  ["Recipient", submitTarget],
                  ["Status", displayStatus({ ...detailReport, status: detailStatus })],
                  ["Date Generated", detailReport.date || "—"],
                  ["Submitted", detailReport.submittedDate || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 text-sm">
                    <span className="shrink-0 text-brand-gray">{label}</span>
                    <span className="min-w-0 text-right font-medium text-brand-ink">{value}</span>
                  </div>
                ))}
              </div>

              {/* Submitted report snapshot — the EXACT content submitted, read
                  back from the server (never regenerated from live records). */}
              <div className="mt-4">
                <h4 className="mb-2 text-sm font-semibold text-brand-ink">{detailStatus === "Draft" ? "Saved Draft Snapshot" : "Submitted Report Snapshot"}</h4>
                {detailLoading ? (
                  <p className="inline-flex items-center gap-2 text-sm text-brand-gray">
                    <RefreshCw className="h-4 w-4 animate-spin" /> Loading submitted report…
                  </p>
                ) : detailError ? (
                  <div role="alert" className="rounded-btn border border-brand-danger/30 bg-brand-danger/5 p-4 text-sm text-brand-danger">
                    {detailError}
                    <button type="button" onClick={() => setDetailRetry((value) => value + 1)} className={supervisor ? "supervisor-button mt-2" : "mt-2 block text-sm font-medium text-brand-blue hover:underline"}>Retry saved report</button>
                  </div>
                ) : hasSnapshot(detailContent?.content) ? (
                  <ReportSnapshotView content={detailContent.content} />
                ) : (
                  <div className="rounded-btn border border-dashed border-brand-border p-4 text-sm text-brand-gray">
                    The full content for this report was not captured at submission time, so it cannot be displayed. Only the submission details above are available for this record.
                  </div>
                )}
              </div>

              {submitError && <p role="alert" className="mt-4 rounded border border-brand-danger/30 bg-brand-danger/5 px-3 py-2 text-ui text-brand-danger">{submitError}</p>}

              <div className="mt-6 flex justify-end">
                {canSubmitReports && detailStatus === "Needs Revision" && (
                  <button
                    onClick={() => {
                      setRevisionTarget(detailReport);
                      setReportForm({
                        reportType: detailReport.type || "",
                        period: detailReport.period || "",
                        barangay: detailReport.barangay || assignedBarangay || phnDefaultBarangay(user, coverage),
                      });
                      setFormErrors({});
                      setDetailReport(null);
                      showToast("Update the report period's source records, then generate and review the revised snapshot.");
                    }}
                    className="mr-auto rounded-btn border border-brand-blue px-4 py-2 text-sm font-medium text-brand-blue hover:bg-brand-blue/5"
                  >
                    Prepare revision
                  </button>
                )}
                {canSubmitReports && detailStatus === "Draft" && (
                  <button
                    onClick={submitStoredDraft}
                    disabled={submitting || detailLoading || !hasSnapshot(detailContent?.content)}
                    className="mr-auto rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "Submitting…" : submitError ? `Retry submission to ${submitTarget}` : `Submit to ${submitTarget}`}
                  </button>
                )}
                <button
                  onClick={() => !submitting && setDetailReport(null)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
