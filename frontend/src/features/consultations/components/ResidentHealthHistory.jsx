import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { residentsApi } from "@/services/api";
import { X } from "lucide-react";

const populated = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const display = (value) => populated(value) ? String(value) : "None recorded";
const day = (value) => value ? String(value).slice(0, 10) : "";
const humanize = (value) => String(value || "").replaceAll("_", " ");

const vitalFields = [
  ["Blood pressure", "bloodPressure", " mmHg"],
  ["Temperature", "temperature", " °C"],
  ["Pulse rate", "pulseRate", " bpm"],
  ["Respiratory rate", "respiratoryRate", " breaths/min"],
  ["Height", "height", " cm"],
  ["Weight", "weight", " kg"],
  ["BMI", "bmi", ""],
  ["Oxygen saturation", "oxygenSaturation", "%"],
];

const valueFrom = (source, ...keys) => keys.map((key) => source?.[key]).find(populated);

const listEntryLabel = (value) => {
  if (typeof value === "string" || typeof value === "number") return humanize(value).trim();
  if (Array.isArray(value)) return value.map(listEntryLabel).filter(Boolean).join(" · ");
  if (value && typeof value === "object") {
    const named = value.name || value.condition || value.diagnosis || value.allergen || value.label || value.value;
    return named ? listEntryLabel(named) : Object.values(value).map(listEntryLabel).filter(Boolean).join(" · ");
  }
  return "";
};

const listEntries = (value) => {
  if (Array.isArray(value)) return value.map(listEntryLabel).filter(Boolean);
  return listEntryLabel(value).split(/[,;]|\r?\n/).map((entry) => entry.trim()).filter(Boolean);
};

function SummaryField({ label, value }) {
  return <div className="min-w-0">
    <dt className="text-[11px] font-medium text-brand-gray">{label}</dt>
    <dd className="break-words text-sm font-medium text-brand-ink dark:text-foreground">{display(value)}</dd>
  </div>;
}

function VitalField({ label, value }) {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-2 border-b border-brand-border/70 py-1 last:border-b-0 dark:border-border">
    <dt className="whitespace-nowrap text-[11px] text-brand-gray">{label}</dt>
    <dd className="break-words text-right text-xs font-medium tabular-nums text-brand-ink dark:text-foreground">{populated(value) ? value : "—"}</dd>
  </div>;
}

function HistoryList({ value, noun, onViewAll }) {
  const entries = listEntries(value);
  const expandable = entries.length > 2;

  return <>
    {expandable && <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
      <span className="text-[11px] text-brand-gray">{entries.length} recorded {noun}</span>
      <button type="button"
        className="shrink-0 text-[11px] font-medium text-brand-blue hover:underline"
        onClick={onViewAll}>View all</button>
    </div>}
    {!entries.length ? <p className="text-xs text-brand-gray">None recorded</p> : (
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {entries.slice(0, 2).map((entry, index) => <li key={`${entry}-${index}`}
          className="max-w-full break-words rounded-btn border border-brand-border bg-brand-bg/50 px-1.5 py-0.5 text-[11px] leading-4 text-brand-ink dark:border-border dark:bg-card dark:text-foreground"
          style={{ overflowWrap: "anywhere" }}>{entry}</li>)}
      </ul>
    )}
  </>;
}

function HistoryEntry({ row, compact = false }) {
  const dateTime = [day(row.date), row.time].filter(Boolean).join(" · ");
  const vitals = vitalFields
    .map(([label, key, unit]) => populated(row.vitals?.[key]) ? `${label}: ${row.vitals[key]}${unit}` : "")
    .filter(Boolean);

  return <li className="border-t border-brand-border/70 py-2 first:border-t-0 first:pt-0">
    {dateTime && <p className="text-xs font-semibold text-brand-ink dark:text-foreground">{dateTime}</p>}
    {populated(row.serviceName) && <p className="truncate text-xs text-brand-gray" title={row.serviceName}>{row.serviceName}</p>}
    {populated(row.chiefComplaint) && <p className={`mt-0.5 break-words text-xs text-brand-ink dark:text-foreground ${compact ? "line-clamp-2" : ""}`}
      title={row.chiefComplaint} style={{ overflowWrap: "anywhere" }}>{row.chiefComplaint}</p>}
    {populated(row.diagnosis) && <p className={`mt-0.5 break-words text-xs text-brand-gray ${compact ? "line-clamp-1" : ""}`}
      title={row.diagnosis} style={{ overflowWrap: "anywhere" }}>Diagnosis: {row.diagnosis}</p>}
    {!compact && vitals.length > 0 && <p className="mt-1 break-words text-[11px] leading-4 text-brand-gray">{vitals.join(" · ")}</p>}
  </li>;
}

export default function ResidentHealthHistory({ residentId, residentName = "", bloodType = "", ownerId, scopeKey, revision, consultationId = "" }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [historyDialog, setHistoryDialog] = useState("");
  const dialogRef = useRef(null);
  const dialogTitleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (historyDialog && !dialog.open) dialog.showModal();
    else if (!historyDialog && dialog.open) dialog.close();
  }, [historyDialog]);

  useEffect(() => {
    let active = true;
    setHistory(null);
    setError(false);
    setHistoryDialog("");
    residentsApi.healthHistory(residentId, { ownerId, dedupeKey: JSON.stringify([ownerId, scopeKey, revision, retry]) })
      .then((data) => {
        if (data?.residentId !== residentId) throw new Error("Mismatched resident history.");
        if (active) setHistory(data);
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [residentId, ownerId, scopeKey, revision, retry]);

  const consultations = useMemo(() => (history?.consultations || [])
    .filter((row) => !consultationId || row.id !== consultationId)
    .sort((a, b) => `${b.date || ""}T${b.time || ""}`.localeCompare(`${a.date || ""}T${a.time || ""}`)),
  [history, consultationId]);
  const measurements = useMemo(() => consultations.filter((row) =>
    vitalFields.some(([, key]) => populated(row.vitals?.[key]))), [consultations]);
  const latestVitals = measurements[0];
  const profile = history?.profile || {};
  const latestMedical = consultations.find((row) => populated(row.allergies) || populated(row.existingConditions) || populated(row.clinicalHistory));
  const allergies = valueFrom(profile, "allergies", "knownAllergies") || latestMedical?.allergies;
  const conditions = valueFrom(profile, "existingConditions", "chronicConditions", "medicalConditions") || latestMedical?.existingConditions || latestMedical?.clinicalHistory;
  const visibleConsultations = consultations.slice(0, 3);
  const vitals = latestVitals?.vitals || {};

  if (!residentId) return <div className="mb-5 border-y border-brand-border py-3 text-sm text-brand-gray">Select a resident to view the health history summary.</div>;
  if (error) return <div className="mb-5 border-y border-brand-border py-3 text-sm">
    <span role="alert" className="text-brand-danger">Could not load health history for this resident.</span>
    <button type="button" className="ml-2 font-medium text-brand-blue hover:underline" onClick={() => setRetry((n) => n + 1)}>Retry</button>
  </div>;
  if (!history) return <div role="status" className="mb-5 border-y border-brand-border py-3 text-sm text-brand-gray">Loading resident health history...</div>;

  const dialogTitle = historyDialog === "consultations" ? "Previous Consultations"
    : historyDialog === "conditions" ? "Existing Conditions" : "Allergies";
  const dialogEntries = historyDialog === "conditions" ? listEntries(conditions)
    : historyDialog === "allergies" ? listEntries(allergies) : [];

  return <section aria-label={`Health history summary for ${residentName || "selected resident"}`} className="mb-5 border-y border-brand-border py-3">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)] xl:divide-x xl:divide-brand-border">
      <div className="min-w-0 xl:pr-4">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Health History</h4>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SummaryField label="Blood type" value={valueFrom(profile, "bloodType", "blood_type") || bloodType} />
          <div className="min-w-0">
            <dt className="text-[11px] font-medium text-brand-gray">Allergies</dt>
            <dd className="mt-1"><HistoryList value={allergies} noun="allergies" onViewAll={() => setHistoryDialog("allergies")} /></dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="text-[11px] font-medium text-brand-gray">Existing Conditions</dt>
            <dd className="mt-1"><HistoryList value={conditions} noun="conditions" onViewAll={() => setHistoryDialog("conditions")} /></dd>
          </div>
        </dl>
      </div>
      <div className="min-w-0 xl:px-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Previous Consultations</h4>
          {consultations.length > 3 && <button type="button" className="shrink-0 whitespace-nowrap text-xs font-medium text-brand-blue hover:underline" onClick={() => setHistoryDialog("consultations")}>View all ({consultations.length})</button>}
        </div>
        {visibleConsultations.length ? <ul>{visibleConsultations.map((row) => <HistoryEntry key={row.id} row={row} compact />)}</ul> : <p className="text-xs text-brand-gray">No previous consultations recorded.</p>}
      </div>
      <div className="min-w-0 xl:pl-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Previous Vital Signs</h4>
          {(latestVitals?.date || latestVitals?.recordedAt) && <span className="whitespace-nowrap text-[11px] text-brand-gray">{day(latestVitals.date || latestVitals.recordedAt)}</span>}
        </div>
        {latestVitals ? <dl>
          {vitalFields.map(([label, key, unit]) => <VitalField key={key} label={label}
            value={populated(vitals[key]) ? `${vitals[key]}${unit}` : "—"} />)}
        </dl> : <p className="text-xs text-brand-gray">No recorded vital signs.</p>}
      </div>
    </div>
    <dialog ref={dialogRef} onClose={() => setHistoryDialog("")}
      aria-labelledby={dialogTitleId}
      className="resident-history-dialog m-auto max-h-[88vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-card border border-brand-border bg-white p-0 text-brand-ink shadow-float backdrop:bg-black/50 dark:border-border dark:bg-card dark:text-foreground">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-brand-border bg-white px-4 py-3 dark:border-border dark:bg-card sm:px-5">
        <h3 id={dialogTitleId} className="text-sm font-semibold text-brand-ink dark:text-foreground">{dialogTitle}</h3>
        <button type="button" onClick={() => dialogRef.current?.close()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-brand-gray hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
          aria-label="Close health history details"><X className="h-4 w-4" /></button>
      </div>
      {historyDialog === "consultations" ? (
        consultations.length ? <ul className="divide-y divide-brand-border px-4 py-2 dark:divide-border sm:px-5">
          {consultations.map((row) => <HistoryEntry key={row.id} row={row} />)}
        </ul> : <p className="p-5 text-sm text-brand-gray">None recorded</p>
      ) : (
        dialogEntries.length ? <ul className="flex flex-wrap gap-2 p-4 sm:p-5">
          {dialogEntries.map((entry, index) => <li key={`${entry}-${index}`}
            className="max-w-full break-words rounded-btn border border-brand-border bg-brand-bg/50 px-2.5 py-1 text-xs text-brand-ink dark:border-border dark:bg-card-nested dark:text-foreground"
            style={{ overflowWrap: "anywhere" }}>{entry}</li>)}
        </ul> : <p className="p-5 text-sm text-brand-gray">None recorded</p>
      )}
    </dialog>
  </section>;
}
