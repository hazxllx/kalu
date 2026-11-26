// frontend/src/features/dashboards/components/ResidentHealthSnapshot.jsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  latestConsultation,
  latestRecordedVitals,
} from "@/features/dashboards/lib/residentHealthSnapshot";

const RISK_TONES = {
  high: "border-rose-300/25 bg-rose-400/10 text-rose-200",
  moderate: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  low: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
  unknown: "border-white/15 bg-white/[0.05] text-white/70",
};

const ACTIVITY_TONES = {
  "health consultation": { dot: "bg-sky-200", label: "text-sky-100" },
  "vital signs": { dot: "bg-brand-gold", label: "text-brand-gold" },
  "follow-up": { dot: "bg-sky-400", label: "text-sky-200" },
  referral: { dot: "bg-white/45", label: "text-white/65" },
};

function CompactMetric({ label, value, unit, title }) {
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <div className="min-w-0" title={title}>
      <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-100/65">{label}</span>
      <span className="mt-1 block truncate text-base font-semibold leading-none text-white">
        {hasValue ? value : "—"}
        {unit && hasValue && <span className="ml-1 text-xs font-normal text-sky-100/60">{unit}</span>}
      </span>
    </div>
  );
}

export default function ResidentHealthSnapshot({
  health,
  healthError = "",
  timeline = [],
  loading,
}) {
  const consultations = health?.consultations || [];
  const latest = useMemo(() => latestConsultation(consultations), [consultations]);
  const vitals = useMemo(() => latestRecordedVitals(consultations), [consultations]);
  const healthUnavailable = loading || Boolean(healthError);
  const recent = timeline.slice(0, 3);
  const latestVisitDate = health?.lastConsultationDate || latest?.date;
  const riskKey = String(health?.riskLevel || "").trim().toLowerCase();
  const riskTone = riskKey.includes("high")
    ? RISK_TONES.high
    : riskKey.includes("moderate")
      ? RISK_TONES.moderate
      : riskKey.includes("low")
        ? RISK_TONES.low
        : RISK_TONES.unknown;
  const formattedRisk = String(health?.riskLevel || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const riskLabel = health?.riskLevel
    ? /risk$/i.test(formattedRisk) ? formattedRisk : `${formattedRisk} Risk`
    : "Risk not assessed";
  const riskDescription = healthError
    ? "Your health classification could not be loaded."
    : health?.riskLevel
      ? "Classification from your care team's latest assessment."
      : "No risk classification is currently recorded.";

  return (
    <section className="relative overflow-hidden rounded-xl bg-brand-dark text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(48% 82% at 8% 118%, rgba(245,197,67,.1), transparent 70%), radial-gradient(42% 72% at 96% -12%, rgba(142,169,192,.1), transparent 72%)",
        }}
      />
      <div className="relative flex flex-col gap-3 p-3 sm:p-4">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-100/60">Resident health</p>
            <h2 className="mt-0.5 font-display text-lg leading-tight text-white sm:text-xl">Health snapshot</h2>
          </div>
          <span className="hidden shrink-0 text-[11px] font-medium tracking-wide text-sky-100/60 sm:block">
            Personal health record
          </span>
        </header>

        <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(290px,0.9fr)] sm:items-center sm:px-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-sky-100/65">
              {loading
                ? "Latest visit · loading"
                : healthError
                ? "Latest visit · unavailable"
                : latestVisitDate
                  ? `Latest visit · ${formatSnapshotDate(latestVisitDate)}`
                  : "Latest visit · not recorded"}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${healthError ? RISK_TONES.unknown : riskTone}`}>
                <i className={`h-1.5 w-1.5 rounded-full ${healthError ? "bg-white/50" : riskKey.includes("high") ? "bg-rose-300" : riskKey.includes("moderate") ? "bg-amber-300" : riskKey.includes("low") ? "bg-emerald-300" : "bg-white/50"}`} />
                {loading ? "Loading health record" : healthError ? "Health record unavailable" : riskLabel}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-snug text-sky-100/65">
              {loading ? "Loading your latest health assessment." : riskDescription}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-2.5 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <CompactMetric label="Blood pressure" value={healthUnavailable ? null : vitals.bloodPressure.value} unit="mmHg" title={healthUnavailable ? "Health readings unavailable" : vitals.bloodPressure.date ? `Recorded ${formatSnapshotDate(vitals.bloodPressure.date)}` : "No blood pressure reading recorded"} />
            <CompactMetric label="Pulse" value={healthUnavailable ? null : vitals.pulseRate.value} unit="bpm" title={healthUnavailable ? "Health readings unavailable" : vitals.pulseRate.date ? `Recorded ${formatSnapshotDate(vitals.pulseRate.date)}` : "No pulse reading recorded"} />
            <CompactMetric label="BMI" value={healthUnavailable ? null : vitals.bmi.value} title={healthUnavailable ? "Health readings unavailable" : vitals.bmi.date ? `Recorded ${formatSnapshotDate(vitals.bmi.date)}` : "No BMI reading recorded"} />
          </div>
        </div>

        <section aria-labelledby="resident-recent-activity" className="px-0.5">
          <header className="mb-1.5 flex items-center justify-between gap-3">
            <h3 id="resident-recent-activity" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/75">
              Recent health activity
            </h3>
            <Link
              to="/app/resident/record"
              className="shrink-0 text-xs font-semibold text-brand-gold transition-colors hover:text-white"
            >
              View full history <span aria-hidden="true">→</span>
            </Link>
          </header>
          <ul className="flex flex-col">
            {loading && !recent.length ? (
              <li className="border-t border-white/10 py-2 text-xs text-sky-100/55">Loading recent activity…</li>
            ) : recent.length ? recent.map((item, index) => {
              const tone = ACTIVITY_TONES[String(item.type || "").toLowerCase()] || ACTIVITY_TONES.referral;
              return (
                <li
                  key={`${item.type}-${item.date}-${index}`}
                  className="grid grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-2 border-t border-white/10 py-2 sm:grid-cols-[148px_minmax(0,1fr)_auto] sm:gap-3"
                >
                  <span className={`inline-flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-[0.04em] ${tone.label}`}>
                    <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                    {item.type}
                  </span>
                  <span className="min-w-0 truncate text-xs text-white/90">
                    {[item.title, item.desc].filter(Boolean).join(" · ") || "Activity recorded"}
                  </span>
                  <time dateTime={String(item.date).slice(0, 10)} className="whitespace-nowrap text-right text-[11px] text-sky-100/60">
                    {formatShortDate(item.date)}
                  </time>
                </li>
              );
            }) : (
              <li className="border-t border-white/10 py-2 text-xs text-sky-100/55">No recent health activity.</li>
            )}
          </ul>
        </section>
      </div>
    </section>
  );
}

function formatShortDate(value) {
  if (!value) return "Date not recorded";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function formatSnapshotDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
