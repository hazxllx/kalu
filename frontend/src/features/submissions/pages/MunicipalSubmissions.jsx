import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonStatGrid } from "@/components/common/Skeleton";
import ReportSnapshotView from "@/features/reports/components/ReportSnapshotView";
import { hasSnapshot } from "@/features/reports/lib/reportSnapshot";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { reportsApi } from "@/services/api/reportsApi";
import { municipalSubmissionsApi } from "@/services/api/municipalSubmissionsApi";
import { captureOwnerGuard } from "@/services/offline/db";
import { submissionFromReport, linkedReviewHistory, reviewPersistedReport } from "../lib/municipalReports";
import { Search, ChevronRight, X, RefreshCw, FileText, CheckCircle2, Clock, RotateCcw } from "lucide-react";

const formatDate = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Invalid recorded timestamp";
};
const input = "rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue";
const Badge = ({ status }) => <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === "Accepted" ? "bg-brand-green/10 text-brand-green" : status === "Rejected" ? "bg-brand-danger/10 text-brand-danger" : "bg-brand-blue/10 text-brand-blue"}`}>{status || "Status not recorded"}</span>;

export default function MunicipalSubmissions() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const load = useCallback(async (options) => {
    const [reports, meta] = await Promise.all([reportsApi.listAll({ box: "incoming" }, options), reportsApi.meta(options)]);
    if (!meta?.transitions || !Array.isArray(meta.statuses)) throw new Error("Report workflow metadata is unavailable.");
    return { reports: reports.map(submissionFromReport), meta };
  }, []);
  const resource = useAuthorizedData(load);
  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [barangay, setBarangay] = useState("All");
  const [status, setStatus] = useState("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [detailId, setDetailId] = useState(null);
  const [reviewMode, setReviewMode] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const detailLoad = useCallback(async (options) => {
    if (!detailId) return null;
    const [response, reviews] = await Promise.all([reportsApi.get(detailId, options), municipalSubmissionsApi.listReviews({ submissionRef: detailId }, options)]);
    if (!response?.record?.id || String(response.record.id) !== String(detailId)) throw new Error("The server did not return the selected report snapshot.");
    return { report: submissionFromReport(response.record), legacy: linkedReviewHistory(response.record, reviews) };
  }, [detailId]);
  const detail = useAuthorizedData(detailLoad);
  const reports = resource.data?.reports || [];
  const meta = resource.data?.meta;
  const selected = detail.data?.report;
  const transitions = selected ? meta?.transitions?.[selected.status] || [] : [];
  const canReview = Boolean(selected && selected.recipientRole === user?.role && selected.createdBy !== user?.id && can("reports.review") && transitions.length);
  const barangays = [...new Set(reports.map((report) => report.barangay).filter(Boolean))].sort();
  const filtered = useMemo(() => {
    const rows = reports.filter((report) => {
      const timestamp = report.submittedAt ? Date.parse(report.submittedAt) : null;
      return (tab === "All" || report.group === tab) && (barangay === "All" || report.barangay === barangay) && (status === "All" || report.status === status)
        && (!from || timestamp !== null && timestamp >= Date.parse(`${from}T00:00:00+08:00`))
        && (!to || timestamp !== null && timestamp <= Date.parse(`${to}T23:59:59.999+08:00`))
        && `${report.reference} ${report.type} ${report.barangay || ""} ${report.creator}`.toLowerCase().includes(search.toLowerCase());
    });
    return rows.sort((a, b) => (sort === "oldest" ? 1 : -1) * ((Date.parse(a.submittedAt) || 0) - (Date.parse(b.submittedAt) || 0)));
  }, [reports, tab, barangay, status, from, to, search, sort]);
  useEffect(() => {
    setDetailId(null); setReviewMode(""); setRemarks(""); setFailure(""); setNotice(""); setSearch(""); setBarangay("All"); setStatus("All");
  }, [user?.id]);
  useEffect(() => {
    if (!detailId) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [detailId]);
  const open = (id) => { setDetailId(id); setReviewMode(""); setRemarks(""); setFailure(""); };
  const close = () => { if (!busy) { setDetailId(null); setReviewMode(""); setRemarks(""); setFailure(""); } };
  const submitReview = async () => {
    if (busy || !canReview || !transitions.includes(reviewMode)) return;
    if (reviewMode === "Rejected" && !remarks.trim()) { setFailure("A rejection requires recorded remarks."); return; }
    const guard = captureOwnerGuard(user.id);
    setBusy(true); setFailure("");
    try {
      const record = await reviewPersistedReport({ report: selected, status: reviewMode, remarks: remarks.trim(), review: (id, payload) => reportsApi.review(id, payload, { ownerId: user.id }) });
      if (!guard()) return;
      setNotice(`Report ${record.id} is now ${record.status}, confirmed by the server.`);
      setReviewMode(""); setRemarks("");
      await Promise.all([detail.refresh(), resource.refresh()]);
    } catch (error) { if (guard()) setFailure(error?.message || "The report review was not saved."); }
    finally { setBusy(false); }
  };
  return <>
    <PageHeader crumbs={["Submissions"]} title="Municipal Submissions" subtitle="Persisted report deliveries and immutable snapshots. PHN/RHU-recipient reports are oversight-only." action={<button disabled={resource.loading || busy} onClick={resource.refresh} className="flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm text-brand-blue"><RefreshCw className="h-4 w-4" /> Refresh</button>} />
    {notice && <p role="status" className="mb-4 rounded-btn border border-brand-green/30 bg-brand-green/5 p-3 text-sm">{notice}</p>}
    {resource.loading ? <SkeletonStatGrid count={4} /> : resource.error ? <ErrorState title="Submissions unavailable" message={resource.error} onRetry={resource.refresh} /> : <>
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">{[["Persisted Incoming Reports", reports.length, FileText], ["Submitted", reports.filter((report) => report.status === "Submitted").length, Clock], ["Accepted", reports.filter((report) => report.status === "Accepted").length, CheckCircle2], ["Rejected", reports.filter((report) => report.status === "Rejected").length, RotateCcw]].map(([label, count, Icon]) => <Card key={String(label)} className="flex items-center gap-3 p-5"><Icon className="h-5 w-5 text-brand-blue" /><div><p className="text-xs text-brand-gray">{label}</p><p className="text-2xl font-semibold">{count}</p></div></Card>)}</div>
      <Card className="overflow-hidden"><div className="flex border-b border-brand-border px-5 pt-4">{["All", "TCL", "M1"].map((name) => <button key={name} onClick={() => setTab(name)} className={`border-b-2 px-4 pb-3 text-sm font-medium ${tab === name ? "border-brand-blue text-brand-blue" : "border-transparent text-brand-gray"}`}>{name === "All" ? "All Reports" : name === "TCL" ? "TCL Reports" : "M1 / Maternal Reports"}</button>)}</div>
        <div className="flex flex-wrap gap-3 p-5"><div className="flex items-center gap-2"><Search className="h-4 w-4 text-brand-gray" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search server reference or creator" className={input} /></div><select value={barangay} onChange={(event) => setBarangay(event.target.value)} className={input}><option value="All">All Recorded Barangays</option>{barangays.map((name) => <option key={name}>{name}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)} className={input}><option value="All">All Status</option>{meta.statuses.map((name) => <option key={name}>{name}</option>)}</select><input aria-label="Submitted from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={input} /><input aria-label="Submitted to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className={input} /><select value={sort} onChange={(event) => setSort(event.target.value)} className={input}><option value="newest">Newest Submission</option><option value="oldest">Oldest Submission</option></select></div>
        {from && to && from > to ? <p role="alert" className="px-5 pb-4 text-sm text-brand-danger">The date range is invalid.</p> : null}
        <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-brand-bg"><tr>{["Server Reference", "Report Type", "Barangay", "Reporting Period", "Report Creator", "Submitted At", "Status", "Action"].map((label) => <th key={label} className="px-5 py-3 font-medium text-brand-gray">{label}</th>)}</tr></thead><tbody>{filtered.map((report) => <tr key={report.id} className="border-t border-brand-border hover:bg-brand-bg/50"><td className="max-w-[180px] break-all px-5 py-3 text-xs">{report.reference}</td><td className="px-5 py-3">{report.type || "Not recorded"}</td><td className="px-5 py-3">{report.barangay || "Not recorded"}</td><td className="px-5 py-3">{report.period || "Not recorded"}</td><td className="px-5 py-3">{report.creator || "Not recorded"}</td><td className="whitespace-nowrap px-5 py-3">{formatDate(report.submittedAt)}</td><td className="px-5 py-3"><Badge status={report.status} /></td><td className="px-5 py-3"><button onClick={() => open(report.id)} className="inline-flex items-center gap-1 text-brand-blue">View <ChevronRight className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
        <div className="space-y-3 px-4 pb-4 md:hidden">{filtered.map((report) => <div key={report.id} className="rounded-btn border border-brand-border p-4"><p className="break-all text-xs font-medium">{report.reference}</p><p className="mt-2 text-sm">{report.type || "Type not recorded"} · {report.barangay || "Barangay not recorded"}</p><p className="mt-1 text-xs text-brand-gray">Submitted: {formatDate(report.submittedAt)}</p><div className="mt-3 flex items-center justify-between"><Badge status={report.status} /><button onClick={() => open(report.id)} className="text-sm text-brand-blue">View Snapshot</button></div></div>)}</div>
        {filtered.length === 0 && <div className="px-5 py-12 text-center"><p className="text-sm font-medium">No Persisted Reports Match</p><p className="mt-1 text-xs text-brand-gray">Review decisions alone are never treated as submitted reports.</p></div>}
      </Card>
    </>}
    {detailId && <div className="fixed inset-0 z-[70]"><button className="absolute inset-0 bg-black/60" onClick={close} aria-label="Close report detail" /><aside role="dialog" aria-modal="true" className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"><header className="flex items-center justify-between gap-3 border-b border-brand-border p-5"><div className="min-w-0"><p className="break-all text-sm font-semibold">{detailId}</p><p className="text-xs text-brand-gray">Persisted Submission Snapshot</p></div><button disabled={busy} onClick={close} aria-label="Close"><X className="h-5 w-5" /></button></header><div className="flex-1 space-y-5 overflow-y-auto p-5">{detail.loading ? <SkeletonStatGrid count={2} /> : detail.error ? <ErrorState message={detail.error} onRetry={detail.refresh} /> : selected && <>
      <Card className="p-4"><h3 className="mb-3 text-xs font-semibold uppercase text-brand-gray">Submission Information</h3><div className="grid grid-cols-2 gap-3 text-sm">{[["Report Type", selected.type], ["Report Creator", selected.creator], ["Submitted At", formatDate(selected.submittedAt)], ["Last Server Update", formatDate(selected.updatedAt)], ["Period", selected.period], ["Recipient Role", selected.recipientRole]].map(([label, value]) => <div key={label}><p className="text-xs text-brand-gray">{label}</p><p>{value || "Not recorded"}</p></div>)}</div><div className="mt-3"><Badge status={selected.status} /></div></Card>
      <Card className="p-4"><h3 className="mb-3 text-xs font-semibold uppercase text-brand-gray">Immutable Submitted Contents</h3>{hasSnapshot(selected.content) ? <ReportSnapshotView content={selected.content} /> : <p className="text-sm text-brand-gray">This historical report has no supported stored content snapshot. Its contents have not been recreated from current records.</p>}</Card>
      <Card className="p-4"><h3 className="mb-3 text-xs font-semibold uppercase text-brand-gray">Server History</h3>{Array.isArray(selected.history) && selected.history.length ? selected.history.map((event, index) => <div key={index} className="mb-3 rounded-btn bg-brand-bg p-3 text-sm"><p>{event.action || event.toStatus || "Recorded event"}</p><p className="text-xs text-brand-gray">{event.actorName || event.actorId || event.by || "Actor not recorded"} · {formatDate(event.at || event.createdAt)}</p>{(event.remarks || event.notes) && <p className="mt-1 text-xs">{event.remarks || event.notes}</p>}</div>) : <p className="text-sm text-brand-gray">No server history was supplied for this historical row.</p>}</Card>
      {detail.data.legacy.length > 0 && <Card className="p-4"><h3 className="mb-3 text-xs font-semibold uppercase text-brand-gray">Linked Historical Review Decisions</h3><p className="mb-3 text-xs text-brand-gray">These decisions match this exact server report ID. They do not create submissions or overwrite its current workflow status.</p>{detail.data.legacy.map((review) => <div key={review.id} className="mb-2 border-t border-brand-border pt-2 text-sm"><p>{review.reviewStatus || review.status} · {formatDate(review.reviewedAt)}</p><p className="text-xs text-brand-gray">Reviewer: {review.reviewedBy || "Not recorded"}</p><p className="text-xs">{review.reviewNotes || "No remarks recorded"}</p></div>)}</Card>}
      <Card className="border-brand-blue/20 p-4"><h3 className="mb-3 text-xs font-semibold uppercase text-brand-gray">Recipient Review</h3>{canReview ? <><div className="flex flex-wrap gap-2">{transitions.map((next) => <button disabled={busy} key={next} onClick={() => { setReviewMode(next); setFailure(""); }} className={`rounded-full border px-4 py-2 text-xs ${reviewMode === next ? "bg-brand-blue text-white" : "border-brand-border text-brand-blue"}`}>{next}</button>)}</div>{reviewMode && <><label className="mt-4 block text-sm">Recorded Review Remarks<textarea rows={3} disabled={busy} value={remarks} onChange={(event) => setRemarks(event.target.value)} className={`${input} mt-1 w-full`} /></label><button disabled={busy} onClick={submitReview} className="mt-3 rounded-btn bg-brand-blue px-5 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving..." : `Confirm ${reviewMode}`}</button></>}{failure && <p role="alert" className="mt-3 text-sm text-brand-danger">{failure}</p>}</> : <p className="text-sm text-brand-gray">Read-only oversight or no permitted recipient transition. The server account, recipient routing and verified permission grants control review authority.</p>}</Card>
    </>}</div></aside></div>}
  </>;
}
