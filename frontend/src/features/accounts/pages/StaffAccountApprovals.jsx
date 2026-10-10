import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import ReviewModal, { ModalSection, ModalRow } from "@/features/users/components/ReviewModal";
import { SkeletonTable } from "@/components/common/Skeleton";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import VerificationPagination from "@/features/verification/components/VerificationPagination";
import { staffAccountsApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { Search, CheckCircle2, Ban, ChevronRight, Loader2, AlertCircle, Inbox } from "lucide-react";

const STATUS_FILTERS = ["pending", "approved", "rejected", "all"];
const STATUS_FILTER_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", all: "All statuses" };
const BHW_STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All statuses" },
];
const PAGE_SIZE = 10;
const STATUS_META = {
  pending: { label: "Pending", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  approved: { label: "Approved", dot: "bg-emerald-600", text: "text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", dot: "bg-rose-600", text: "text-rose-700 dark:text-rose-400" },
};

const ROLE_LABELS = {
  bhw: "Barangay Health Worker",
  health_supervisor: "Health Supervisor",
  rhu_personnel: "RHU Personnel",
  resident: "Resident",
  phn: "Public Health Nurse",
  mho: "Municipal Health Officer",
};

function StatusBadge({ value }) {
  const meta = STATUS_META[value] || STATUS_META.pending;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      <span className={meta.text}>{meta.label}</span>
    </span>
  );
}

/*
 * Role-specific request categories, matching the server-side approval authority
 * (`backend/src/config/staffApprovals.js`). The queue endpoint already returns
 * only the request roles the signed-in reviewer may approve; these categories
 * partition that queue and never expose a role the reviewer cannot act on.
 *
 *   Health Supervisor → Residents, Barangay Health Workers
 *   PHN               → Health Supervisors, RHU Personnel
 */
const CATEGORIES = {
  health_supervisor: [
    { key: "resident", label: "Residents", roles: ["resident"] },
    { key: "bhw", label: "Barangay Health Workers", roles: ["bhw"] },
  ],
  phn: [
    { key: "health_supervisor", label: "Health Supervisors", roles: ["health_supervisor"] },
    { key: "rhu_personnel", label: "RHU Personnel", roles: ["rhu_personnel"] },
  ],
};

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : "—");

const stationLabel = (stations) =>
  Array.isArray(stations) && stations.length
    ? stations
        .map((s) => (s === "triage" ? "Triage" : s === "consultation" ? "Consultation" : s))
        .join(" + ")
    : "";

function VerificationDocumentCard({ document, onEnlarge, onRefreshUrl }) {
  const [url, setUrl] = useState(document.url || "");
  const [imageLoading, setImageLoading] = useState(Boolean(document.url));
  const [imageError, setImageError] = useState(!document.url);
  const [refreshing, setRefreshing] = useState(false);
  const isImage = String(document.mimeType || "").toLowerCase().startsWith("image/");

  useEffect(() => {
    setUrl(document.url || "");
    setImageLoading(Boolean(document.url));
    setImageError(!document.url);
  }, [document.url]);

  const refreshUrl = async () => {
    setRefreshing(true);
    try {
      const nextUrl = await onRefreshUrl(document.id);
      if (!nextUrl) throw new Error("A secure document link is not available.");
      setUrl(nextUrl);
      setImageLoading(true);
      setImageError(false);
    } catch {
      setImageError(true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <article className="min-w-0 overflow-hidden rounded-card border border-brand-border bg-white dark:border-border dark:bg-card">
      {isImage && (
        <div className="relative flex h-48 items-center justify-center bg-brand-bg dark:bg-card-nested sm:h-52">
          {url && !imageError ? (
            <>
              <img
                src={url}
                alt={`${document.documentType || "Verification document"}${document.originalFilename ? ` — ${document.originalFilename}` : ""}`}
                className={`max-h-full max-w-full object-contain p-2 ${imageLoading ? "invisible" : ""}`}
                onLoad={() => setImageLoading(false)}
                onError={() => { setImageLoading(false); setImageError(true); }}
              />
              {imageLoading && (
                <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-brand-gray">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading image…
                </span>
              )}
              {!imageLoading && (
                <button
                  type="button"
                  onClick={() => onEnlarge({ ...document, url })}
                  className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue"
                  aria-label={`Enlarge ${document.documentType || "verification image"}`}
                  title="Open larger image"
                />
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-brand-gray">
              <p>{imageError ? "This verification image could not be loaded." : "Image unavailable."}</p>
              <button
                type="button"
                onClick={refreshUrl}
                disabled={refreshing}
                className="rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue disabled:opacity-60"
              >
                {refreshing ? "Refreshing link…" : "Refresh secure link"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-brand-border px-3 py-2.5 dark:border-border">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-brand-ink">{document.documentType || "Verification document"}</p>
          {document.originalFilename && (
            <p className="truncate text-xs text-brand-gray" title={document.originalFilename}>{document.originalFilename}</p>
          )}
        </div>
        {!isImage && (url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue"
          >
            Open document
          </a>
        ) : (
          <span className="shrink-0 text-xs text-brand-gray">Unavailable</span>
        ))}
      </div>
    </article>
  );
}

/**
 * Account Approvals (PHN and Health Supervisor).
 *
 * Both roles render this single component — the PHN as a standalone page and
 * the Health Supervisor embedded inside the Verifications & Approvals tabs
 * (`embedded` only suppresses the page heading). The queue is served by
 * `GET /api/staff-accounts/queue`, which returns only the request roles the
 * signed-in reviewer is responsible for, and every decision goes through
 * `POST /api/staff-accounts/:id/approve|reject` so the profile is actually
 * activated (or locked) and a real `health_audit_logs` entry is written.
 *
 *   PHN               approves Health Supervisor and RHU Personnel accounts
 *   Health Supervisor approves BHW and Resident accounts
 *   System Admin / MHO have no approval queue and 403 on every route here.
 *
 * The category navigation partitions that same queue client-side; it never
 * adds a role the reviewer is not authorised to approve.
 */
export default function StaffAccountApprovals({
  embedded = false,
  bhwOnly = false,
  onPendingCount,
  pendingCountKey = "bhw",
}) {
  const { user } = useAuth();
  const roleKey = user?.role;
  const categories = useMemo(() => {
    const roleCategories = CATEGORIES[roleKey] || [];
    return bhwOnly && roleKey === "health_supervisor"
      ? roleCategories.filter((category) => category.key === "bhw")
      : bhwOnly
        ? []
        : roleCategories;
  }, [bhwOnly, roleKey]);

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("pending");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState(categories[0]?.key || null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [toast, setToast] = useState(null);

  // Keep the active category valid as the signed-in role resolves.
  useEffect(() => {
    setCategory((prev) => (categories.some((c) => c.key === prev) ? prev : categories[0]?.key || null));
  }, [categories]);

  // Only re-query when the status filter changes; the category, search and date
  // filters operate on the loaded rows so the reviewer is not firing a request
  // per keystroke.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const firstPage = await staffAccountsApi.listQueue({ status, limit: 200, offset: 0 });
      const queueRows = [...(firstPage?.rows || [])];
      const total = Number(firstPage?.total) || queueRows.length;
      if (bhwOnly) {
        for (let offset = queueRows.length; offset < total; offset += 200) {
          const nextPage = await staffAccountsApi.listQueue({ status, limit: 200, offset });
          const nextRows = nextPage?.rows || [];
          if (!nextRows.length) break;
          queueRows.push(...nextRows);
        }
      }
      setRows(queueRows);
      if (bhwOnly && status === "pending") {
        onPendingCount?.(
          pendingCountKey,
          queueRows.filter((row) => row.role === "bhw").length,
        );
      }
    } catch (err) {
      setRows([]);
      setLoadError(err?.message || "The approval queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [bhwOnly, onPendingCount, pendingCountKey, status]);

  useEffect(() => {
    if (!categories.length) {
      setLoading(false);
      return;
    }
    load();
  }, [categories, load]);

  const activeCategory = useMemo(
    () => categories.find((c) => c.key === category) || null,
    [categories, category],
  );

  const filtered = useMemo(() => {
    let list = activeCategory ? rows.filter((r) => activeCategory.roles.includes(r.role)) : rows;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.fullName?.toLowerCase().includes(q) ||
          r.email?.toLowerCase().includes(q) ||
          r.licenseNo?.toLowerCase().includes(q) ||
          r.id?.toLowerCase().includes(q),
      );
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) {
        list = list.filter((r) => r.submittedAt && new Date(r.submittedAt) >= from);
      }
    }
    return list;
  }, [rows, activeCategory, query, dateFrom]);
  const pageRows = bhwOnly
    ? filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filtered;

  useEffect(() => {
    if (!bhwOnly) return;
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > pageCount) setPage(pageCount);
  }, [bhwOnly, filtered.length, page]);

  const detailRecord = detailId ? rows.find((r) => r.id === detailId) || null : null;
  const authority = categories.length > 0;
  const statusOptions = bhwOnly
    ? BHW_STATUS_FILTERS
    : STATUS_FILTERS.map((value) => ({ value, label: STATUS_FILTER_LABELS[value] }));

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  /** Apply a decision, then reload so the row shows its real new state. */
  const decide = async (record, decision, reason) => {
    if (decision === "reject" && !reason.trim()) {
      throw new Error("A rejection reason is required.");
    }
    if (decision === "approve") {
      await staffAccountsApi.approve(record.id, reason.trim() ? { remarks: reason.trim() } : {});
    } else {
      await staffAccountsApi.reject(record.id, { reason: reason.trim() });
    }
    setDetailId(null);
    showToast(
      decision === "approve"
        ? `${record.fullName} approved — the account is now active and can sign in.`
        : `${record.fullName} rejected. The account remains locked.`,
    );
    await load();
  };

  return (
    <>
      {!embedded && (
        <PageHeader
          eyebrow="Verification"
          title="Account Approvals"
          subtitle="Review and process health personnel account requests."
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-card bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Request categories — a full-width horizontal underline tab bar matching
          the parent Verifications & Approvals navigation, with a compact count
          badge beside each label. */}
      {authority && !bhwOnly && (
        <nav
          className="tab-scrollbar mb-4 flex w-full gap-3 overflow-x-auto border-b border-brand-border bg-background sm:gap-6 dark:border-border"
          aria-label="Request categories"
        >
          {categories.map((c) => {
            const active = c.key === category;
            return (
              <button
                key={c.key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setCategory(c.key)}
                className={`-mb-px flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue sm:px-4 ${
                  active
                    ? "border-brand-blue font-semibold text-brand-ink dark:text-foreground"
                    : "border-transparent font-medium text-brand-gray hover:text-brand-ink dark:hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </nav>
      )}

      <section className="overflow-hidden rounded-card border border-brand-border bg-white dark:border-border dark:bg-card">
        <div className="flex flex-col gap-2 border-b border-brand-border px-4 py-3 dark:border-border sm:flex-row sm:items-center">
          <label className="flex h-10 min-w-[200px] flex-1 items-center gap-2 rounded-input border border-brand-border bg-white px-3 dark:border-border dark:bg-input">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => { setPage(1); setQuery(event.target.value); }}
              placeholder={bhwOnly ? "Search BHW applicants by name, email, or reference…" : "Search applicants…"}
              aria-label={bhwOnly ? "Search BHW applicants" : "Search applicants"}
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-brand-gray/70"
            />
          </label>
          <select
            value={status}
            onChange={(event) => { setPage(1); setStatus(event.target.value); }}
            aria-label="Filter by status"
            className="h-10 rounded-input border border-brand-border bg-white px-3 text-[13px] outline-none focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label htmlFor="submitted-from" className="sr-only">Submitted on or after</label>
            <input
              id="submitted-from"
              type="date"
              value={dateFrom}
              onChange={(event) => { setPage(1); setDateFrom(event.target.value); }}
              title="Submitted on or after"
              className="h-10 rounded-input border border-brand-border bg-white px-3 text-[13px] text-brand-ink outline-none focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
            />
            {dateFrom && (
              <button
                type="button"
                onClick={() => { setPage(1); setDateFrom(""); }}
                className="rounded-btn px-1.5 py-1 text-xs text-brand-gray underline-offset-2 hover:text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
              >
                Clear
              </button>
            )}
          </div>
          <span className="text-xs tabular-nums text-brand-gray sm:ml-auto">
            {loading ? "Loading…" : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {loadError ? (
          <div className="px-4 py-8 text-center">
            <AlertCircle className="mx-auto h-5 w-5 text-brand-danger" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-brand-ink">The approval queue could not be loaded</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-brand-gray">{loadError}</p>
            <button
              type="button"
              onClick={load}
              className="mt-3 rounded-btn border border-brand-border px-3 py-1.5 text-sm font-medium text-brand-blue hover:border-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="px-4 py-4">
            <SkeletonTable rows={6} cols={6} />
          </div>
        ) : !authority ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-brand-ink">Not an approval authority</p>
            <p className="mt-1 text-xs text-brand-gray">Account approvals are handled by the PHN and the Health Supervisor.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center px-4 py-10 text-center">
            <Inbox className="h-6 w-6 text-brand-gray" strokeWidth={1.75} aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-brand-ink">No applications found</p>
            <p className="mt-1 text-[13px] text-brand-gray">
              {query || dateFrom || status !== "pending"
                ? "No records match the selected filters."
                : bhwOnly
                  ? "Pending BHW applications will appear here."
                  : "Pending Health Supervisor and RHU Personnel account requests will appear here."}
            </p>
          </div>
        ) : (
          <>
            {/* Administrative register — desktop. */}
            <div className="hidden md:block">
              <table className="verification-table">
                <thead>
                  <tr className="border-b border-brand-border bg-brand-bg/70 text-left text-[11px] font-medium uppercase tracking-wide dark:border-border dark:bg-card-nested">
                    <th scope="col" className="px-4 py-2.5 text-brand-gray">Reference</th>
                    <th scope="col" className="px-4 py-2.5 text-brand-gray">Applicant</th>
                    <th scope="col" className="px-4 py-2.5 text-brand-gray">Account type</th>
                    <th scope="col" className="px-4 py-2.5 text-brand-gray">Barangay / Facility</th>
                    <th scope="col" className="px-4 py-2.5 text-brand-gray">Submitted</th>
                    <th scope="col" className="px-4 py-2.5 text-brand-gray">Status</th>
                    <th scope="col" className="px-4 py-2.5 text-right text-brand-gray">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border dark:divide-border">
                  {pageRows.map((r) => {
                    const station = stationLabel(r.rhuStations);
                    return (
                      <tr key={r.id} className="transition-colors hover:bg-brand-bg/60 dark:hover:bg-card-nested/50">
                        <td className="px-4 py-3 align-top font-mono text-xs tabular-nums text-brand-gray">{shortId(r.id)}</td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium text-brand-ink">{r.fullName}</p>
                          <p className="text-xs text-brand-gray">{r.licenseNo || r.email}</p>
                        </td>
                        <td className="px-4 py-3 align-top text-brand-ink">{ROLE_LABELS[r.role] || r.position || "—"}</td>
                        <td className="px-4 py-3 align-top text-brand-ink">
                          {r.barangay || r.facility || "—"}
                          {station && <span className="block text-xs text-brand-gray">{station}</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-top tabular-nums text-brand-gray">{formatDate(r.submittedAt)}</td>
                        <td>{bhwOnly ? <VerificationBadge status={r.status} size="sm" /> : <StatusBadge value={r.status} />}</td>
                        <td className="px-4 py-3 align-top text-right">
                          <button
                            type="button"
                            onClick={() => setDetailId(r.id)}
                            className="inline-flex items-center gap-0.5 rounded-btn px-1.5 py-1 text-sm font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                            aria-label={`Review application from ${r.fullName}`}
                          >
                            Review <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Administrative register — compact record layout for small screens. */}
            <ul className="divide-y divide-brand-border md:hidden dark:divide-border">
              {pageRows.map((r) => {
                const station = stationLabel(r.rhuStations);
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-brand-ink">{r.fullName}</p>
                        <p className="truncate text-xs text-brand-gray">{r.licenseNo || r.email}</p>
                      </div>
                      {bhwOnly ? <VerificationBadge status={r.status} size="sm" /> : <StatusBadge value={r.status} />}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div>
                        <dt className="text-brand-gray">Reference</dt>
                        <dd className="font-mono text-brand-ink">{shortId(r.id)}</dd>
                      </div>
                      <div>
                        <dt className="text-brand-gray">Account type</dt>
                        <dd className="text-brand-ink">{ROLE_LABELS[r.role] || r.position || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-brand-gray">Barangay / Facility</dt>
                        <dd className="text-brand-ink">
                          {r.barangay || r.facility || "—"}
                          {station && <span className="block text-brand-gray">{station}</span>}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-brand-gray">Submitted</dt>
                        <dd className="text-brand-ink">{formatDate(r.submittedAt)}</dd>
                      </div>
                    </dl>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setDetailId(r.id)}
                        className="inline-flex items-center gap-0.5 rounded-btn px-1.5 py-1 text-sm font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                        aria-label={`Review application from ${r.fullName}`}
                      >
                        Review <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {bhwOnly && !loading && !loadError && (
          <VerificationPagination
            page={page}
            pageCount={Math.ceil(filtered.length / PAGE_SIZE)}
            total={filtered.length}
            onPageChange={setPage}
          />
        )}
      </section>

      {detailRecord && (
        <RequestReviewModal
          record={detailRecord}
          bhwOnly={bhwOnly}
          onClose={() => setDetailId(null)}
          onDecide={decide}
        />
      )}
    </>
  );
}

/** Centered request detail modal with the approve / reject decision actions. */
function RequestReviewModal({ record, bhwOnly = false, onClose, onDecide }) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const firstField = useRef(null);
  const [enlargedDocument, setEnlargedDocument] = useState(null);

  // The queue list does not carry the uploaded verification documents; fetch the
  // full request (with fresh, short-lived signed URLs) when the modal opens.
  const [full, setFull] = useState(record);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState("");

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    setFull(record);
    setDocsLoading(true);
    setDocsError("");
    staffAccountsApi
      .get(record.id)
      .then((payload) => { if (active) setFull(payload?.request || record); })
      .catch((err) => { if (active) setDocsError(err?.message || "The verification documents could not be loaded."); })
      .finally(() => { if (active) setDocsLoading(false); });
    return () => { active = false; };
  }, [record.id]);

  const pending = record.status === "pending";

  const verificationDocuments = Array.isArray(full?.verificationDocuments) ? full.verificationDocuments : [];

  const refreshDocumentUrl = async (documentId) => {
    const payload = await staffAccountsApi.get(record.id);
    const request = payload?.request;
    if (!request) throw new Error("The verification documents could not be refreshed.");
    setFull(request);
    return request.verificationDocuments?.find((document) => document.id === documentId)?.url || null;
  };

  const rows = [
    { label: "Reference", value: record.id },
    { label: "Applicant", value: `${record.fullName} (${record.email})` },
    { label: "Contact", value: record.phone || "—" },
    { label: "Position", value: record.position || "—" },
    { label: "Account type", value: ROLE_LABELS[record.role] || record.role },
    { label: "Municipality / LGU", value: record.municipality || "—" },
    { label: "Barangay", value: record.barangay || "—" },
    { label: "Health Facility", value: record.facility || "—" },
    {
      label: "RHU Station",
      value: stationLabel(record.rhuStations) || "—",
    },
    { label: "Professional License", value: record.licenseNo || "Not applicable" },
    { label: "License Expiration", value: record.licenseExpiry ? formatDate(record.licenseExpiry) : "Not applicable" },
    { label: "Submitted", value: formatDate(record.submittedAt) },
    { label: "Reviewed By", value: record.decidedBy || "—" },
    { label: "Reviewed At", value: record.decidedAt ? formatDate(record.decidedAt) : "—" },
  ];

  const run = async (decision) => {
    if (decision === "reject" && notes.trim().length < 5) {
      setError("Please provide a rejection reason of at least 5 characters.");
      return;
    }
    setError("");
    setBusy(decision);
    try {
      await onDecide(record, decision, notes.trim());
    } catch (err) {
      setError(err?.message || "The decision could not be saved.");
    } finally {
      setBusy("");
    }
  };

  return (
    <ReviewModal
      title={record.fullName}
      subtitle={`${ROLE_LABELS[record.role] || record.role} · submitted ${formatDate(record.submittedAt)}`}
      status={bhwOnly ? <VerificationBadge status={record.status} size="sm" /> : <StatusBadge value={record.status} />}
      onClose={onClose}
    >
      <ModalSection label="Request Information">
        <div className="space-y-2">
          {rows.map((r) => <ModalRow key={r.label} label={r.label} value={r.value} />)}
        </div>
      </ModalSection>

      <ModalSection label="Verification Documents">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {docsLoading ? (
            <p className="col-span-full flex items-center gap-2 text-sm text-brand-gray"><Loader2 className="h-4 w-4 animate-spin" /> Loading documents…</p>
          ) : docsError ? (
            <p className="col-span-full text-sm text-brand-danger">{docsError}</p>
          ) : verificationDocuments.length > 0 ? (
            verificationDocuments.map((d) => (
              <VerificationDocumentCard
                key={d.id}
                document={d}
                onEnlarge={setEnlargedDocument}
                onRefreshUrl={refreshDocumentUrl}
              />
            ))
          ) : (
            <p className="col-span-full text-sm text-brand-gray">No document uploaded</p>
          )}
        </div>
      </ModalSection>

      {enlargedDocument && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Enlarged ${enlargedDocument.documentType || "verification image"}`}
          onClick={() => setEnlargedDocument(null)}
        >
          <button
            type="button"
            onClick={() => setEnlargedDocument(null)}
            className="absolute right-4 top-4 rounded-btn border border-white/30 bg-black/40 px-3 py-2 text-sm text-white hover:bg-black/70"
          >
            Close
          </button>
          <img
            src={enlargedDocument.url}
            alt={`${enlargedDocument.documentType || "Verification document"}${enlargedDocument.originalFilename ? ` — ${enlargedDocument.originalFilename}` : ""}`}
            className="max-h-[88vh] max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      {record.rejectionReason && (
        <p className="rounded-card border border-brand-border bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:border-border dark:bg-card-nested">
          <span className="font-semibold text-brand-ink">Decision reason:</span> {record.rejectionReason}
        </p>
      )}

      {pending && (
        <section className="rounded-card border border-brand-border bg-brand-bg/50 p-4 dark:border-border dark:bg-card-nested">
          <p className="mb-2 text-sm font-semibold text-brand-ink">Decision</p>
          <textarea
            ref={firstField}
            rows={3}
            value={notes}
            onChange={(e) => { setNotes(e.target.value); if (error) setError(""); }}
            placeholder="Remarks (optional when approving; a reason is required when rejecting)"
            className="w-full resize-none rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
          />
          {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => run("approve")}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve &amp; Activate
            </button>
            <button
              onClick={() => run("reject")}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/40 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-danger focus-visible:ring-offset-2 disabled:opacity-60 dark:bg-transparent"
            >
              {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Reject
            </button>
          </div>
        </section>
      )}
    </ReviewModal>
  );
}
