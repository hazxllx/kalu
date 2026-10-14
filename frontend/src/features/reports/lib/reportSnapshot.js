/**
 * Report snapshot — the immutable, submitted report content.
 *
 * A snapshot captures EXACTLY what the sender reviewed and submitted: the
 * summary totals, the per-record rows, and the reporting metadata. Once built
 * it no longer depends on the live source APIs or the column getter functions,
 * so a recipient opening the report later sees the same content even after the
 * underlying resident / maternal / referral records change.
 *
 * This module is shared by:
 *   - ReportsPage.jsx    — builds the snapshot at submit time and renders the
 *                          live preview that backs it,
 *   - IncomingReports.jsx — renders the persisted snapshot for the recipient,
 * so the "preview" and the "received report" are guaranteed to agree.
 *
 * The shape is versioned (REPORT_CONTENT_SCHEMA_VERSION). New report formats
 * must bump the version rather than silently changing an existing one.
 */

export const REPORT_CONTENT_SCHEMA_VERSION = 1;

/** Full name from an embedded resident record, or "" when unavailable. */
export const residentName = (r) => {
  const res = r?.resident;
  if (!res) return "";
  return [res.first_name, res.middle_name, res.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
};

/** Readable date from a YYYY-MM-DD or ISO value; placeholder when absent. */
export const fmtDate = (v) => {
  if (!v) return "—";
  const raw = String(v);
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

/** Candidate per-record date fields, most clinically-relevant first. */
export const DATE_FIELDS = ["scheduled_date", "referral_date", "service_date", "visit_date", "administered_date", "delivery_date", "record_date", "date", "created_at"];

export const recordDate = (rec) => {
  for (const f of DATE_FIELDS) {
    if (rec?.[f]) return String(rec[f]).slice(0, 10);
  }
  return null;
};

/** Light tone for a record-level status badge (neutral default). */
export const recordStatusTone = (status) => {
  const s = String(status || "").toLowerCase();
  if (["completed", "accepted", "reviewed", "active"].includes(s)) return "bg-brand-green/10 text-brand-green";
  if (["rejected", "cancelled", "missed"].includes(s)) return "bg-brand-danger/10 text-brand-danger";
  if (["pending", "for review", "ongoing", "scheduled", "upcoming", "today", "high"].includes(s)) return "bg-brand-yellow/15 text-[#B07E00]";
  return "bg-brand-gray/10 text-brand-gray";
};

/**
 * Columns shown per report type, mapped to the ACTUAL fields the source APIs
 * return (follow_ups / health_referrals / maternal_records / immunizations,
 * each with the resident embed the API provides). A field the API does not
 * return is shown as "—", never fabricated.
 */
export const REPORT_COLUMNS = {
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
  "Health Services": [
    { label: "Service", get: (r) => r.service?.name || r.service_name || "—" },
    { label: "Resident", get: (r) => residentName(r) || "—" },
    { label: "Scheduled", get: (r) => fmtDate(r.scheduled_date) },
    { label: "Status", get: (r) => r.status || "—", badge: true },
  ],
};

REPORT_COLUMNS["Follow-ups"] = REPORT_COLUMNS["Follow-up Report"];
REPORT_COLUMNS.Referrals = REPORT_COLUMNS["Referral Report"];

/** Fallback columns for any record-list type without a specific mapping. */
export const GENERIC_COLUMNS = [
  { label: "Resident", get: (r) => residentName(r) || "—" },
  { label: "Date", get: (r) => fmtDate(recordDate(r)) },
  { label: "Status", get: (r) => r.status || "—", badge: true },
];

/** The column definitions (with getters) for a report type. */
export const columnsForType = (type) => REPORT_COLUMNS[type] || GENERIC_COLUMNS;

/**
 * Flatten a live preview into an immutable, self-contained snapshot. The rows
 * are formatted strings aligned to `columns`, so rendering the snapshot later
 * needs neither the source APIs nor the getter functions.
 *
 * @param {object} preview - the review-step preview built in ReportsPage.
 * @returns {object} the versioned snapshot content persisted with the report.
 */
export const buildReportContent = (preview) => {
  if (!preview) return null;
  const cols = columnsForType(preview.type);
  const columns = cols.map((c) => ({ label: c.label, badge: Boolean(c.badge) }));
  const rows = (preview.records || []).map((rec) =>
    cols.map((c) => {
      const v = c.get(rec);
      return v === undefined || v === null ? "—" : String(v);
    }),
  );
  const generatedAt =
    preview.generatedAt instanceof Date
      ? preview.generatedAt.toISOString()
      : preview.generatedAt || new Date().toISOString();
  return {
    schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
    reportType: preview.type || "",
    reportPeriod: preview.period || "",
    title: preview.name || "",
    scope: preview.scope || "",
    barangay: preview.barangay || "",
    generatedAt,
    note: preview.note || "",
    summary: preview.summary
      ? {
          total: preview.summary.total,
          byStatus: preview.summary.byStatus || {},
          periodFiltered: Boolean(preview.summary.periodFiltered),
        }
      : null,
    columns,
    rows,
  };
};

/** True when a persisted report row carries a usable content snapshot. */
export const hasSnapshot = (content) =>
  Boolean(content && typeof content === "object" && Array.isArray(content.columns));

export default {
  REPORT_CONTENT_SCHEMA_VERSION,
  REPORT_COLUMNS,
  GENERIC_COLUMNS,
  columnsForType,
  residentName,
  fmtDate,
  recordDate,
  recordStatusTone,
  buildReportContent,
  hasSnapshot,
};
