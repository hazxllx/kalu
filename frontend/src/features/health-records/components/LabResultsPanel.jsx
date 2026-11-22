import React, { useEffect, useRef, useState } from "react";
import { FileText, FlaskConical, Loader2, Upload } from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";

const categories = [
  ["cbc", "Complete blood count"], ["urinalysis", "Urinalysis"], ["fecalysis", "Fecalysis"],
  ["blood_chemistry", "Blood chemistry"], ["fasting_blood_sugar", "Fasting blood sugar"],
  ["lipid_profile", "Lipid profile"], ["pregnancy_test", "Pregnancy test"], ["ultrasound", "Ultrasound"],
  ["xray", "X-ray"], ["other", "Other"],
];
const categoryLabels = Object.fromEntries(categories);
const dateLabel = (value) => value ? new Date(value).toLocaleDateString() : "Date not recorded";

export default function LabResultsPanel(props) {
  const { user } = useAuth();
  if (!user?.id) return null;
  return <LaboratoryContent key={`${user.id}:${user.role || ""}:${user.barangayId || user.barangay_id || ""}:${user.municipalityId || user.municipality_id || ""}:${props.residentId || "own"}:${props.consultationId || ""}`} {...props} ownerId={user.id} />;
}

function LaboratoryContent({ ownerId, residentId, consultationId, canUpload = false, compact = false }) {
  const { can } = usePermissions();
  const mounted = useRef(true);
  const [results, setResults] = useState([]);
  const [category, setCategory] = useState("cbc");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!canUpload && !residentId) return;
    let active = true;
    setResults([]);
    setLoading(true);
    setError("");
    api.get("/lab-results", { params: canUpload ? undefined : { residentId }, cache: "no-store", ownerId, dedupeKey: ownerId })
      .then((response) => {
        if (!Array.isArray(response)) throw new Error("Invalid laboratory results response.");
        if (active) setResults(response);
      })
      .catch((err) => { if (active) { setResults([]); setError(err?.message || "Could not load laboratory results."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canUpload, residentId, revision, ownerId]);

  const upload = async (event) => {
    event.preventDefault();
    if (!file || busy) return;
    const formElement = event.currentTarget;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("category", category);
      form.append("file", file);
      await api.post("/lab-results", form, { ownerId });
      if (!mounted.current) return;
      setFile(null);
      formElement.reset();
      setRevision((value) => value + 1);
    } catch (err) { if (mounted.current) setError(err?.message || "Could not upload the laboratory result."); }
    finally { if (mounted.current) setBusy(false); }
  };

  const openFile = async (item) => {
    const opened = window.open("about:blank", "_blank");
    if (opened) opened.opener = null;
    setBusy(true); setError("");
    try {
      const blob = await api.get(`/lab-results/${encodeURIComponent(item.id)}/file`, { responseType: "blob", cache: "no-store", timeout: 60000, ownerId, dedupeKey: ownerId });
      if (!mounted.current) { opened?.close(); return; }
      if (!["application/pdf", "image/png", "image/jpeg"].includes(blob.type)) throw new Error("The server returned an unsupported file format.");
      const url = URL.createObjectURL(blob);
      if (opened) {
        opened.location = url;
      } else {
        const link = document.createElement("a");
        link.href = url; link.download = item.fileName || "laboratory-result"; link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { opened?.close(); if (mounted.current) setError(err?.message || "Could not open this laboratory result."); }
    finally { if (mounted.current) setBusy(false); }
  };

  const linkResult = async (item) => {
    setBusy(true); setError("");
    try {
      await api.patch(`/lab-results/${encodeURIComponent(item.id)}`, { consultationId }, { ownerId });
      if (!mounted.current) return;
      setRevision((value) => value + 1);
    } catch (err) { if (mounted.current) setError(err?.message || "Could not link this laboratory result."); }
    finally { if (mounted.current) setBusy(false); }
  };

  if (!canUpload && !residentId) return null;

  return <section className={compact ? "mt-5 border-t border-brand-border pt-4" : ""} aria-label="Laboratory results">
    <div className="mb-4 flex items-center gap-2"><FlaskConical className="h-4 w-4 text-brand-blue" aria-hidden="true" /><h3 className={`${compact ? "text-sm " : ""}font-semibold text-brand-ink`}>Laboratory Results</h3></div>
    {canUpload && <form onSubmit={upload} className="mb-4 grid gap-2">
      <label className="sr-only" htmlFor="lab-category">Test category</label>
      <select id="lab-category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 rounded-btn border border-brand-border bg-white px-2 text-sm text-brand-ink">
        {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className="flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-btn border border-brand-border bg-white px-2 text-sm text-brand-gray focus-within:ring-2 focus-within:ring-brand-blue"><FileText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{file?.name || "Choose a result file"}</span><input type="file" aria-label="Laboratory result file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button type="submit" disabled={!file || busy} className="inline-flex h-9 items-center justify-center gap-2 rounded-btn bg-brand-blue px-3 text-sm font-medium text-white disabled:opacity-50"><Upload className="h-4 w-4" /> Upload</button>
    </form>}
    {error && <p role="alert" className="mb-2 text-xs text-brand-danger">{error}</p>}
    {loading ? <p className="flex items-center gap-2 py-3 text-sm text-brand-gray"><Loader2 className="h-4 w-4 animate-spin" /> Loading laboratory results...</p> : results.length === 0 ? !error && <p className="py-2 text-sm text-brand-gray">No laboratory results recorded yet.</p> : <ul className="divide-y divide-brand-border">
      {results.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
        <div className="min-w-0"><p className="break-words text-sm font-medium text-brand-ink">{item.fileName || categoryLabels[item.category] || "Laboratory result"}</p><p className="mt-0.5 text-xs text-brand-gray">{categoryLabels[item.category] || item.category} · {dateLabel(item.uploadedAt)} · Requires clinical review</p></div>
        {!canUpload && consultationId && !item.consultationId && can("consultation.records.update") && can("consultation.history.view") && <button type="button" onClick={() => linkResult(item)} disabled={busy} className="shrink-0 text-sm font-medium text-brand-blue hover:underline disabled:opacity-50">Link to consultation</button>}
        <button type="button" onClick={() => openFile(item)} disabled={busy} className="shrink-0 text-sm font-medium text-brand-blue hover:underline disabled:opacity-50">Open</button>
      </li>)}
    </ul>}
  </section>;
}
