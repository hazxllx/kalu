import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";
import Icon from "./Icon";

// Standardized KPI card color system based on category/purpose
// Icon container: light tinted background
// Icon/number/accent bar: full-strength color
const TONE_CONFIG = {
  blue: {
    iconBg: "bg-blue-50 dark:bg-blue-950/30",
    iconText: "text-blue-600 dark:text-blue-400",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-blue-600 dark:bg-blue-500",
    label: "text-slate-600 dark:text-slate-400",
  },
  green: {
    iconBg: "bg-green-50 dark:bg-green-950/30",
    iconText: "text-green-600 dark:text-green-400",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-green-600 dark:bg-green-500",
    label: "text-slate-600 dark:text-slate-400",
  },
  amber: {
    iconBg: "bg-amber-50 dark:bg-amber-950/30",
    iconText: "text-amber-600 dark:text-amber-500",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-amber-500 dark:bg-amber-400",
    label: "text-slate-600 dark:text-slate-400",
  },
  red: {
    iconBg: "bg-red-50 dark:bg-red-950/30",
    iconText: "text-red-600 dark:text-red-500",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-red-600 dark:bg-red-500",
    label: "text-slate-600 dark:text-slate-400",
  },
  indigo: {
    iconBg: "bg-indigo-50 dark:bg-indigo-950/30",
    iconText: "text-indigo-600 dark:text-indigo-400",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-indigo-600 dark:bg-indigo-500",
    label: "text-slate-600 dark:text-slate-400",
  },
  slate: {
    iconBg: "bg-slate-100 dark:bg-slate-800",
    iconText: "text-slate-600 dark:text-slate-400",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-slate-600 dark:bg-slate-500",
    label: "text-slate-600 dark:text-slate-400",
  },
  // Legacy tones for backward compatibility
  accent: {
    iconBg: "bg-blue-50 dark:bg-blue-950/30",
    iconText: "text-blue-600 dark:text-blue-400",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-blue-600 dark:bg-blue-500",
    label: "text-slate-600 dark:text-slate-400",
  },
  yellow: {
    iconBg: "bg-amber-50 dark:bg-amber-950/30",
    iconText: "text-amber-600 dark:text-amber-500",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-amber-500 dark:bg-amber-400",
    label: "text-slate-600 dark:text-slate-400",
  },
  danger: {
    iconBg: "bg-red-50 dark:bg-red-950/30",
    iconText: "text-red-600 dark:text-red-500",
    valueBg: "text-slate-900 dark:text-slate-100",
    accent: "bg-red-600 dark:bg-red-500",
    label: "text-slate-600 dark:text-slate-400",
  },
};

// Backward compatibility: legacy tone mapping
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
 * Standardized KPI Card Component
 *
 * Displays a professional KPI metric with:
 * - White card background with rounded corners (20px)
 * - Subtle border and soft shadow
 * - Colored icon container (upper-left)
 * - Large bold KPI number
 * - Clear label underneath
 * - Optional description
 * - Colored bottom accent bar
 *
 * Color system:
 * - blue: General / Total
 * - green: Completed / Success
 * - amber: Pending / Waiting
 * - red: Overdue / High Risk
 * - indigo: Scheduled / Upcoming
 * - slate: Information / Records
 *
 * Supports multiple variants for backward compatibility:
 * - default: New standardized design (full-width card)
 * - consultation: Horizontal compact layout
 * - ledger: Report-style card with optional navigation
 */
export default function StatCard({
  icon = null,
  label,
  value,
  tone = "blue",
  index = 0,
  onClick = null,
  compact = false,
  indicator = true, // Default to new design with bottom accent
  active = false,
  variant = "default",
  description = null,
  href = null,
  className = "",
  animateValue = false,
}) {
  const interactive = typeof onClick === "function";
  const toneConfig = TONE_CONFIG[tone] || TONE_CONFIG.blue;

  // Consultation variant: horizontal compact layout
  if (variant === "consultation") {
    const metricClass = `ui-stat-card flex h-full min-h-[112px] items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-4 shadow-sm transition-colors ${interactive ? "cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" : ""} ${className}`;
    const content = (
      <>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneConfig.iconBg}`}>
          <Icon name={icon} className={`h-5 w-5 ${toneConfig.iconText}`} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-medium leading-5 ${toneConfig.label}`}>{label}</p>
          <p className={`mt-1 font-stat text-2xl font-extrabold leading-8 tracking-tight ${toneConfig.valueBg}`}>{animateValue ? <MetricValue value={value} /> : value}</p>
          {description && <p className={`mt-0.5 truncate text-xs leading-4 ${toneConfig.label}`} title={description}>{description}</p>}
        </div>
      </>
    );
    if (interactive) return <button type="button" onClick={onClick} aria-pressed={active} className={metricClass}>{content}</button>;
    return <div className={metricClass}>{content}</div>;
  }

  // Ledger variant: report-style card with optional link
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

  // Default variant: new standardized KPI card design
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      whileHover={{ y: interactive ? -4 : 0 }}
      onClick={interactive ? onClick : undefined}
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
      className={`ui-stat-card relative overflow-hidden rounded-[20px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-sm transition-all duration-200 ${
        compact ? "p-4" : "p-6"
      } ${
        active
          ? "border-blue-400 dark:border-blue-500 shadow-md ring-1 ring-blue-500/20"
          : ""
      } ${
        interactive
          ? "cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          : ""
      } ${className}`}
    >
      {/* Colored icon container - upper left */}
      <div className={`flex items-center justify-center rounded-lg ${compact ? "h-8 w-8 mb-2" : "h-10 w-10 mb-3"} ${toneConfig.iconBg}`}>
        <Icon
          name={icon}
          className={`${compact ? "h-4 w-4" : "h-5 w-5"} ${toneConfig.iconText}`}
          strokeWidth={1.8}
        />
      </div>

      {/* Large bold KPI number */}
      <p className={`font-stat font-extrabold tracking-tight ${toneConfig.valueBg} ${compact ? "text-2xl mt-2" : "text-3xl mt-3"}`}>
        {animateValue ? <MetricValue value={value} /> : value}
      </p>

      {/* KPI label */}
      <p className={`mt-1 ${toneConfig.label} ${compact ? "text-xs" : "text-sm"} font-medium`}>
        {label}
      </p>

      {/* Optional description */}
      {description && (
        <p className={`mt-1.5 ${toneConfig.label} text-xs leading-relaxed line-clamp-2`}>
          {description}
        </p>
      )}

      {/* Colored bottom accent bar */}
      {indicator && (
        <div
          aria-hidden="true"
          className={`absolute inset-x-0 bottom-0 h-1 ${toneConfig.accent}`}
        />
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
