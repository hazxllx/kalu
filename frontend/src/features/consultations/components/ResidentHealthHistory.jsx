import React, { useEffect, useMemo, useState } from "react";
import { residentsApi } from "@/services/api";

const populated = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const display = (value) => populated(value) ? String(value) : "None recorded";
const day = (value) => value ? String(value).slice(0, 10) : "Date not recorded";
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

function SummaryField({ label, value }) {
  return <div className="min-w-0">
    <dt className="text-[11px] font-medium text-brand-gray">{label}</dt>
    <dd className="break-words text-sm font-medium text-brand-ink">{display(value)}</dd>
  </div>;
}

function HistoryEntry({ row }) {
  return <li className="border-t border-brand-border/70 py-2 first:border-t-0 first:pt-0">
    <p className="text-xs font-semibold text-brand-ink">{day(row.date)}{row.time ? ` · ${row.time}` : ""}</p>
    <p className="truncate text-xs text-brand-gray" title={row.serviceName || "General consultation"}>
      {row.serviceName || "General consultation"}
    </p>
    <p className="mt-0.5 break-words text-xs text-brand-ink">{display(row.chiefComplaint)}</p>
    {populated(row.diagnosis) && <p className="mt-0.5 break-words text-xs text-brand-gray">Diagnosis: {row.diagnosis}</p>}
  </li>;
}

export default function ResidentHealthHistory({ residentId, residentName = "", bloodType = "", ownerId, scopeKey, revision, consultationId = "" }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    setHistory(null);
    setError(false);
    setShowAll(false);
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
  const visibleConsultations = showAll ? consultations : consultations.slice(0, 2);
  const vitals = latestVitals?.vitals || {};

  if (!residentId) return <div className="mb-5 border-y border-brand-border py-3 text-sm text-brand-gray">Select a resident to view the health history summary.</div>;
  if (error) return <div className="mb-5 border-y border-brand-border py-3 text-sm">
    <span role="alert" className="text-brand-danger">Could not load health history for this resident.</span>
    <button type="button" className="ml-2 font-medium text-brand-blue hover:underline" onClick={() => setRetry((n) => n + 1)}>Retry</button>
  </div>;
  if (!history) return <div role="status" className="mb-5 border-y border-brand-border py-3 text-sm text-brand-gray">Loading resident health history...</div>;

  return <section aria-label={`Health history summary for ${residentName || "selected resident"}`} className="mb-5 border-y border-brand-border py-3">
    <div className="grid gap-4 md:grid-cols-3 md:divide-x md:divide-brand-border">
      <div className="min-w-0 md:pr-4">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Health History</h4>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SummaryField label="Blood type" value={valueFrom(profile, "bloodType", "blood_type") || bloodType} />
          <SummaryField label="Allergies" value={allergies} />
          <div className="col-span-2"><SummaryField label="Existing conditions" value={conditions} /></div>
        </dl>
      </div>
      <div className="min-w-0 md:px-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Previous Consultations</h4>
          {consultations.length > 2 && <button type="button" className="shrink-0 text-xs font-medium text-brand-blue hover:underline" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show Less" : "View All"}</button>}
        </div>
        {visibleConsultations.length ? <ul>{visibleConsultations.map((row) => <HistoryEntry key={row.id} row={row} />)}</ul> : <p className="text-xs text-brand-gray">None recorded</p>}
      </div>
      <div className="min-w-0 md:pl-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-blue">Previous Vital Signs</h4>
          {latestVitals && <span className="text-[11px] text-brand-gray">{day(latestVitals.date || latestVitals.recordedAt)}</span>}
        </div>
        {latestVitals ? <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {vitalFields.map(([label, key, unit]) => <SummaryField key={key} label={label} value={populated(vitals[key]) ? `${vitals[key]}${unit}` : "Unavailable"} />)}
        </dl> : <p className="text-xs text-brand-gray">No recorded vital signs.</p>}
      </div>
    </div>
  </section>;
}
