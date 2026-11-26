// frontend/src/features/consultations/components/ResidentHealthHistory.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { consultationsApi, residentsApi } from "@/services/api";
import { loadServerRows } from "@/lib/serverRows";
import { formatLongDate } from "@/lib/dateUtils";
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

// Renders or manages SummaryField logic.
function SummaryField({ label, value }) {
  return <div className="min-w-0">
    <dt className="text-[11px] font-medium text-brand-gray">{label}</dt>
    <dd className="break-words text-sm font-medium text-brand-ink dark:text-foreground">{display(value)}</dd>
  </div>;
}

// Renders or manages VitalField logic.
function VitalField({ label, value }) {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-2 border-b border-brand-border/70 py-1 last:border-b-0 dark:border-border">
    <dt className="whitespace-nowrap text-[11px] text-brand-gray">{label}</dt>
    <dd className="break-words text-right text-xs font-medium tabular-nums text-brand-ink dark:text-foreground">{populated(value) ? value : "—"}</dd>
  </div>;
}

// Renders or manages HistoryList logic.
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

const consultationDateTime = (row) => {
  const date = row.consultationDate || row.consultationDetails?.consultationDate || row.visitDate || row.date || "";
  const time = row.consultationTime || row.consultationDetails?.consultationTime || row.time || "";
  return [day(date), time].filter(Boolean).join(" · ");
};

// Renders or manages ConsultationEntry logic.
function ConsultationEntry({ row, onView }) {
  const rawDate = row.consultationDate || row.consultationDetails?.consultationDate || row.visitDate || row.date || "";
  const dateTime = [formatLongDate(rawDate) || day(rawDate), row.consultationTime || row.consultationDetails?.consultationTime || row.time || ""].filter(Boolean).join(" · ");
  const serviceName = row.serviceName || row.healthServiceName || row.consultationDetails?.healthServiceName
    || row.consultationDetails?.healthServiceCategory || "Consultation";
  const bloodPressure = valueFrom(row.vitals, "bp", "bloodPressure") || row.bloodPressure;
  const status = humanize(row.status || "Not recorded").trim();

  return <li className="border-t border-brand-border/70 py-2 first:border-t-0 first:pt-0">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        {dateTime && <p className="text-xs font-semibold text-brand-ink dark:text-foreground">{dateTime}</p>}
        <p className="truncate text-xs text-brand-gray" title={serviceName}>{serviceName}</p>
        {populated(row.chiefComplaint) && <p className="mt-0.5 truncate text-xs text-brand-ink dark:text-foreground" title={row.chiefComplaint}>{row.chiefComplaint}</p>}
        <p className="mt-0.5 text-[11px] text-brand-gray">
          {status}{populated(bloodPressure) ? ` · BP ${bloodPressure} mmHg` : ""}
        </p>
      </div>
      <button type="button" onClick={() => onView?.(row)}
        className="shrink-0 text-[11px] font-medium text-brand-blue hover:underline">
        View details
      </button>
    </div>
  </li>;
}

// Renders or manages ResidentHealthHistory logic.
export default function ResidentHealthHistory({ residentId, residentName = "", bloodType = "", ownerId, scopeKey, revision, consultationId = "", onViewConsultation = null }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [consultationRows, setConsultationRows] = useState([]);
  const [consultationLoading, setConsultationLoading] = useState(true);
  const [consultationError, setConsultationError] = useState(false);
  const [consultationRetry, setConsultationRetry] = useState(0);
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

  useEffect(() => {
    let active = true;
    setConsultationRows([]);
    setConsultationLoading(true);
    setConsultationError(false);
    if (!residentId || !ownerId) {
      setConsultationLoading(false);
      return () => { active = false; };
    }

    Promise.all(["completed", "referred"].map((status) => loadServerRows(
      (params) => consultationsApi.list({ ...params, residentId, status }, {
        ownerId,
        dedupeKey: JSON.stringify([ownerId, scopeKey, residentId, status, revision, consultationRetry]),
      }),
      500,
    )))
      .then((pages) => {
        if (!active) return;
        const rowsById = new Map();
        for (const row of pages.flat()) {
          const rowResidentId = row.resident?.id || row.residentId;
          if (rowResidentId !== residentId) throw new Error("Consultation history returned a different resident.");
          rowsById.set(row.id, row);
        }
        setConsultationRows([...rowsById.values()].sort((left, right) =>
          consultationDateTime(right).localeCompare(consultationDateTime(left)) || String(right.id).localeCompare(String(left.id))));
      })
      .catch(() => { if (active) setConsultationError(true); })
      .finally(() => { if (active) setConsultationLoading(false); });
    return () => { active = false; };
  }, [residentId, ownerId, scopeKey, revision, consultationRetry]);

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
  const visibleConsultations = consultationRows.filter((row) => !consultationId || row.id !== consultationId);
  const vitals = latestVitals?.vitals || {};

  if (!residentId) return <div className="mb-5 border-y border-brand-border py-3 text-sm text-brand-gray">Select a resident to view the health history summary.</div>;
  const dialogTitle = historyDialog === "consultations" ? "Consultation History"
    : historyDialog === "conditions" ? "Existing Conditions" : "Allergies";
  const dialogEntries = historyDialog === "conditions" ? listEntries(conditions)
    : historyDialog === "allergies" ? listEntries(allergies) : [];

  return <section aria-label={`Health history summary for ${residentName || "selected resident"}`} className="mb-5 border-y border-brand-border py-3">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)] xl:divide-x xl:divide-brand-border">
      <div className="min-w-0 xl:pr-4">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Health History</h4>
        {error ? <p className="text-xs text-brand-danger" role="alert">Could not load health summary. <button type="button" className="font-medium text-brand-blue hover:underline" onClick={() => setRetry((n) => n + 1)}>Retry</button></p>
          : !history ? <p role="status" className="text-xs text-brand-gray">Loading health summary...</p>
            : <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              <SummaryField label="Blood type" value={valueFrom(profile, "bloodType", "blood_type") || bloodType} />
              <div className="min-w-0">
                <dt className="text-[11px] font-medium text-brand-gray">Allergies</dt>
                <dd className="mt-1"><HistoryList value={allergies} noun="allergies" onViewAll={() => setHistoryDialog("allergies")} /></dd>
              </div>
              <div className="col-span-2 min-w-0">
                <dt className="text-[11px] font-medium text-brand-gray">Existing Conditions</dt>
                <dd className="mt-1"><HistoryList value={conditions} noun="conditions" onViewAll={() => setHistoryDialog("conditions")} /></dd>
              </div>
            </dl>}
      </div>
      <div className="min-w-0 xl:px-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Consultation History</h4>
          {visibleConsultations.length > 3 && <button type="button" className="shrink-0 whitespace-nowrap text-xs font-medium text-brand-blue hover:underline" onClick={() => setHistoryDialog("consultations")}>View all ({visibleConsultations.length})</button>}
        </div>
        {consultationLoading ? <p role="status" className="text-xs text-brand-gray">Loading consultation history...</p>
          : consultationError ? <p role="alert" className="text-xs text-brand-danger">Could not load consultation history. <button type="button" className="font-medium text-brand-blue hover:underline" onClick={() => setConsultationRetry((value) => value + 1)}>Retry</button></p>
            : visibleConsultations.length ? <ul>{visibleConsultations.slice(0, 3).map((row) => <ConsultationEntry key={row.id} row={row} onView={onViewConsultation} />)}</ul>
              : <p className="text-xs text-brand-gray">No previous consultations recorded.</p>}
      </div>
      <div className="min-w-0 xl:pl-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Previous Vital Signs</h4>
          {(latestVitals?.date || latestVitals?.recordedAt) && <span className="whitespace-nowrap text-[11px] text-brand-gray">{day(latestVitals.date || latestVitals.recordedAt)}</span>}
        </div>
        {error ? <p className="text-xs text-brand-gray">Previous vital signs are unavailable.</p>
          : !history ? <p role="status" className="text-xs text-brand-gray">Loading...</p>
            : latestVitals ? <dl>
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
        visibleConsultations.length ? <ul className="divide-y divide-brand-border px-4 py-2 dark:divide-border sm:px-5">
          {visibleConsultations.map((row) => <ConsultationEntry key={row.id} row={row} onView={(record) => {
            dialogRef.current?.close();
            onViewConsultation?.(record);
          }} />)}
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
