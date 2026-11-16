import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { getResidentFollowUpPresentation } from "@/features/follow-ups/lib/residentFollowUpPresentation";
import {
  latestConsultation,
  latestRecordedVitals,
  pulseReadings,
  visitTrend,
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
      <span className="block truncate font-mono text-[10px] uppercase tracking-[0.1em] text-sky-100/65">{label}</span>
      <span className="mt-1 block truncate font-mono text-base font-medium leading-none text-white">
        {hasValue ? value : "—"}
        {unit && hasValue && <span className="ml-1 text-[10px] font-normal text-sky-100/60">{unit}</span>}
      </span>
    </div>
  );
}

function VitalsTrend({ readings, error, loading }) {
  const latest = readings[readings.length - 1];
  if (error) {
    return <div className="grid h-[74px] place-items-center text-center text-xs text-sky-100/60">Health readings are unavailable.</div>;
  }
  if (loading) {
    return <div className="grid h-[74px] place-items-center text-center text-xs text-sky-100/60">Loading pulse readings…</div>;
  }
  if (!readings.length) {
    return <div className="grid h-[74px] place-items-center text-center text-xs text-sky-100/60">No pulse readings recorded.</div>;
  }

  const min = Math.min(...readings.map((item) => item.value));
  const max = Math.max(...readings.map((item) => item.value));
  const span = max - min || 1;
  const points = readings.map((item, index) => ({
    ...item,
    x: readings.length === 1 ? 150 : 16 + (index * 268) / (readings.length - 1),
    y: 48 - ((item.value - min) / span) * 30,
  }));
  const path = points.map((point, index) =>
    `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
  ).join(" ");
  const labelStep = Math.max(1, Math.ceil(readings.length / 4));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[11px] text-sky-100/60">Pulse rate · bpm</p>
        <p className="shrink-0 text-xs font-semibold tabular-nums text-white">
          {latest.value} <span className="font-normal text-sky-100/60">bpm · {formatShortDate(latest.date)}</span>
        </p>
      </div>
      <svg
        viewBox="0 0 300 72"
        preserveAspectRatio="none"
        className="h-[66px] w-full"
        role="img"
        aria-label={`${readings.length} pulse readings, oldest to newest`}
      >
        {[16, 32, 48].map((y) => (
          <line key={y} x1="12" y1={y} x2="288" y2={y} stroke="rgba(176,199,219,.15)" />
        ))}
        {points.length > 1 && <path d={path} fill="none" stroke="#8EA9C0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r={index === points.length - 1 ? 4 : 2.7}
              fill={index === points.length - 1 ? "hsl(var(--brand-gold))" : "#91AABE"}
              stroke="#102F53"
              strokeWidth="1.4"
            >
              <title>{`${formatShortDate(point.date)}: ${point.value} bpm`}</title>
            </circle>
            {(index % labelStep === 0 || index === points.length - 1) && (
              <text
                x={point.x}
                y="68"
                textAnchor={points.length === 1 ? "middle" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
                fill="rgba(205,220,234,.62)"
                fontSize="8"
              >
                {formatShortDate(point.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {points.length === 1 && <p className="mt-0.5 text-[10px] text-sky-100/55">Single recorded reading · no trend inferred</p>}
    </div>
  );
}

function VisitsTrend({ weeks, loading, error, healthError }) {
  if (loading) {
    return <div className="grid h-[84px] place-items-center text-xs text-sky-100/60">Loading visit activity…</div>;
  }
  if (healthError || error) {
    return <div className="grid h-[84px] place-items-center text-center text-xs text-sky-100/60">{healthError ? "Consultation activity is unavailable." : "Follow-up activity is unavailable."}</div>;
  }

  const series = [
    { key: "consultations", label: "Consultations", color: "#E7EEF5" },
    { key: "completedFollowUps", label: "Completed follow-ups", color: "hsl(var(--brand-gold))" },
    { key: "upcoming", label: "Upcoming", color: "#8EA9C0" },
    { key: "overdue", label: "Overdue", color: "#E87979" },
  ];
  const max = Math.max(0, ...weeks.flatMap((week) => series.map(({ key }) => week[key])));
  if (!max) {
    return <div className="grid h-[84px] place-items-center text-center text-xs text-sky-100/60">No visit activity in the displayed weeks.</div>;
  }

  const barWidth = 4;
  const barGap = 1.5;
  const groupWidth = series.length * barWidth + (series.length - 1) * barGap;
  const groupStep = 39;
  const labelIndexes = new Set([0, 2, 3, 4, 6]);

  return (
    <div>
      <svg
        viewBox="0 0 300 82"
        preserveAspectRatio="none"
        className="h-[76px] w-full"
        role="img"
        aria-label="Consultations, completed follow-ups, upcoming activities and overdue follow-ups by week"
      >
        {[14, 34, 54].map((y) => (
          <line key={y} x1="12" y1={y} x2="288" y2={y} stroke="rgba(176,199,219,.15)" />
        ))}
        {weeks.map((week, weekIndex) => {
          const center = 22 + weekIndex * groupStep;
          return (
            <g key={week.key}>
              {series.map((item, seriesIndex) => {
                const count = week[item.key];
                if (!count) return null;
                const height = Math.max(3, (count / max) * 42);
                return (
                  <rect
                    key={item.key}
                    x={center - groupWidth / 2 + seriesIndex * (barWidth + barGap)}
                    y={56 - height}
                    width={barWidth}
                    height={height}
                    rx="1.5"
                    fill={item.color}
                  >
                    <title>{`${week.key}: ${count} ${item.label.toLowerCase()}`}</title>
                  </rect>
                );
              })}
              {labelIndexes.has(weekIndex) && (
                <text x={center} y="75" textAnchor="middle" fill="rgba(205,220,234,.58)" fontSize="7.5">
                  {week.key}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-tight text-sky-100/65">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1">
            <i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ResidentHealthSnapshot({
  health,
  healthError = "",
  followUps = [],
  followUpsLoading = false,
  followUpsError = "",
  timeline = [],
  loading,
}) {
  const consultations = health?.consultations || [];
  const latest = useMemo(() => latestConsultation(consultations), [consultations]);
  const vitals = useMemo(() => latestRecordedVitals(consultations), [consultations]);
  const pulseSeries = useMemo(() => pulseReadings(consultations), [consultations]);
  const visitSeries = useMemo(() => visitTrend(consultations, followUps), [consultations, followUps]);
  const followUpCounts = useMemo(() => followUps.reduce((counts, row) => {
    const presentation = getResidentFollowUpPresentation(row);
    if (presentation.category === "upcoming") counts.upcoming += 1;
    if (presentation.awaitingResponse) counts.awaiting += 1;
    if (presentation.category === "completed") counts.completed += 1;
    return counts;
  }, { upcoming: 0, awaiting: 0, completed: 0 }), [followUps]);
  const healthUnavailable = loading || Boolean(healthError);
  const followUpsUnavailable = loading || followUpsLoading || Boolean(followUpsError);
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
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-sky-100/60">Resident health</p>
            <h2 className="mt-0.5 font-display text-lg leading-tight text-white sm:text-xl">Health snapshot</h2>
          </div>
          <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-sky-100/50 sm:block">
            Personal health record
          </span>
        </header>

        <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(290px,0.9fr)] sm:items-center sm:px-4">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-sky-100/60">
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

        <div className="grid gap-3 md:grid-cols-2">
          <SnapshotCard title="Vitals trend">
            <VitalsTrend readings={pulseSeries} error={Boolean(healthError)} loading={loading} />
          </SnapshotCard>
          <SnapshotCard title="Visits">
            <VisitsTrend weeks={visitSeries} loading={loading || followUpsLoading} error={Boolean(followUpsError)} healthError={Boolean(healthError)} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/10 pt-2.5 sm:grid-cols-4">
              <SnapshotStat label="Total consultations" value={healthUnavailable ? "—" : consultations.length} />
              <SnapshotStat label="Upcoming" value={followUpsUnavailable ? "—" : followUpCounts.upcoming} />
              <SnapshotStat label="Awaiting response" value={followUpsUnavailable ? "—" : followUpCounts.awaiting} tone="amber" />
              <SnapshotStat label="Completed follow-ups" value={followUpsUnavailable ? "—" : followUpCounts.completed} tone="green" />
            </div>
          </SnapshotCard>
        </div>

        <section aria-labelledby="resident-recent-activity" className="px-0.5">
          <header className="mb-1.5 flex items-center justify-between gap-3">
            <h3 id="resident-recent-activity" className="font-mono text-[10px] uppercase tracking-[0.13em] text-white/75">
              Recent health activity
            </h3>
            <Link
              to="/app/resident/record"
              className="shrink-0 text-[11px] font-medium text-brand-gold transition-colors hover:text-white"
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
                  <span className={`inline-flex min-w-0 items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.08em] ${tone.label}`}>
                    <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                    {item.type}
                  </span>
                  <span className="min-w-0 truncate text-xs text-white/90">
                    {[item.title, item.desc].filter(Boolean).join(" · ") || "Activity recorded"}
                  </span>
                  <time dateTime={String(item.date).slice(0, 10)} className="whitespace-nowrap text-right font-mono text-[10px] text-sky-100/55">
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

function SnapshotCard({ title, children }) {
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-3 sm:p-3.5">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.13em] text-white/80">{title}</h3>
      {children}
    </article>
  );
}

function SnapshotStat({ label, value, tone = "default" }) {
  const labelTone = tone === "amber"
    ? "text-amber-200/80"
    : tone === "green"
      ? "text-emerald-200/80"
      : "text-sky-100/60";
  return (
    <div className="min-w-0">
      <span className={`block truncate text-[10px] leading-tight ${labelTone}`}>{label}</span>
      <span className="mt-0.5 block font-mono text-base font-medium leading-none tabular-nums text-white">{value}</span>
    </div>
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
