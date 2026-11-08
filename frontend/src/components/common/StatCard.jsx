import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";
import Icon from "./Icon";

const TONES = {
  accent: "bg-brand-accent/10 text-brand-accent",
  blue: "bg-brand-blue/10 text-brand-blue",
  green: "bg-brand-green/10 text-brand-green",
  yellow: "bg-brand-yellow/15 text-[#B07E00]",
  danger: "bg-brand-danger/10 text-brand-danger",
};

// Solid tone used for the subtle colored bottom indicator (opt-in).
const BAR_TONES = {
  accent: "bg-brand-accent",
  blue: "bg-brand-blue",
  green: "bg-brand-green",
  yellow: "bg-brand-yellow",
  danger: "bg-brand-danger",
};

/**
 * Shared KPI card.
 *
 * Backwards compatible: existing call sites pass only
 * `{ icon, label, value, tone, index, onClick }` and render exactly as before
 * (a lightly tinted icon square and a muted top-right dot).
 *
 * Opt-in props used by the compact PHN Check-ups dashboard:
 *   - compact:   trims padding and type scale so four cards fit one row.
 *   - indicator: draws a subtle colored bottom bar (tone-matched) instead of
 *                the top-right dot, matching the reference KPI treatment.
 *   - active:    highlights the card when it represents the active filter.
 */
export default function StatCard({
  icon = null,
  label,
  value,
  tone = "accent",
  index = 0,
  onClick = null,
  compact = false,
  indicator = false,
  active = false,
  variant = "default",
  description = null,
  href = null,
  className = "",
  animateValue = false,
}) {
  const interactive = typeof onClick === "function";
  if (variant === "consultation") {
    const metricClass = `ui-stat-card flex h-full min-h-[112px] items-center gap-3 rounded-btn border border-brand-border bg-white p-4 shadow-none ${interactive ? "cursor-pointer hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30" : ""} ${className}`;
    const content = (
      <>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONES[tone] || TONES.accent}`}>
          <Icon name={icon} className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-5 text-brand-gray">{label}</p>
          <p className={`mt-1 font-stat text-2xl font-extrabold leading-8 tracking-tight ${tone === "danger" ? "text-brand-danger" : tone === "green" ? "text-brand-green" : "text-brand-blue"}`}>{value}</p>
          {description && <p className="mt-0.5 truncate text-xs leading-4 text-brand-gray" title={description}>{description}</p>}
        </div>
      </>
    );
    if (interactive) return <button type="button" onClick={onClick} aria-pressed={active} className={metricClass}>{content}</button>;
    return <div className={metricClass}>{content}</div>;
  }
  if (variant === "ledger") {
    const metricClass = `supervisor-metric ${active ? "is-active" : ""} ${className}`;
    const numeric = typeof value === "number" || (typeof value === "string" && /^[\d,.]+$/.test(value));
    const content = (
      <>
        <div className="flex items-start justify-between gap-2">
          <span className="supervisor-metric-label">{label}</span>
          {(href || interactive) && <Icon name="ArrowUpRight" className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />}
        </div>
        <p className="supervisor-metric-value" data-numeric={numeric}>{animateValue ? <MetricValue value={value} /> : value ?? "Unavailable"}</p>
        {description && <p className="supervisor-metric-description">{description}</p>}
      </>
    );
    if (href) {
      return <Link to={href} className={metricClass} data-tone={tone}>{content}</Link>;
    }
    if (interactive) {
      return <button type="button" onClick={onClick} aria-pressed={active} className={metricClass} data-tone={tone}>{content}</button>;
    }
    return <div className={metricClass} data-tone={tone}>{content}</div>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      whileHover={{ y: interactive ? -3 : -2 }}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      aria-pressed={interactive ? active : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`ui-stat-card relative overflow-hidden rounded-2xl border bg-white shadow-card ${compact ? "p-4" : "p-5"} ${
        active ? "border-brand-blue ring-1 ring-brand-blue/30" : "border-slate-200"
      } ${interactive ? "cursor-pointer hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40" : ""} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex items-center justify-center ${compact ? "w-9 h-9 rounded-lg" : "w-11 h-11 rounded-xl"} ${TONES[tone] || TONES.accent}`}
        >
          <Icon name={icon} className={compact ? "w-4 h-4" : "w-5 h-5"} strokeWidth={1.8} />
        </div>
        {!indicator && <div className="h-2.5 w-2.5 rounded-full bg-slate-200" />}
      </div>
      <p
        className={`font-stat font-extrabold tracking-tight text-slate-900 ${compact ? "mt-2.5 text-2xl" : "mt-4 text-3xl"}`}
      >
        {value}
      </p>
      <p className={`mt-1 text-slate-600 ${compact ? "text-xs" : "text-sm"}`}>{label}</p>
      {indicator && (
        <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-1 ${BAR_TONES[tone] || BAR_TONES.accent}`} />
      )}
    </motion.div>
  );
}

function MetricValue({ value }) {
  const reducedMotion = useReducedMotion();
  const lastTarget = useRef(null);
  const current = useRef(0);
  const [displayed, setDisplayed] = useState(0);
  const numeric = Number.isSafeInteger(value) && value >= 0;

  useEffect(() => {
    if (!numeric) return undefined;
    if (reducedMotion || typeof requestAnimationFrame !== "function" || lastTarget.current === value) {
      lastTarget.current = value;
      current.current = value;
      setDisplayed(value);
      return undefined;
    }
    lastTarget.current = value;
    const from = current.current;
    const start = performance.now();
    let frame;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 480);
      current.current = Math.round(from + (value - from) * (1 - (1 - progress) ** 3));
      setDisplayed(current.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, numeric, reducedMotion]);

  if (!numeric) return value ?? "Unavailable";
  return <span aria-label={value.toLocaleString()}><span aria-hidden="true">{(reducedMotion ? value : displayed).toLocaleString()}</span></span>;
}
