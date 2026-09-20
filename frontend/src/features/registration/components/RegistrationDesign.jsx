import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, ChevronDown, Edit3 } from "lucide-react";
import GovSeal from "@/components/branding/GovSeal";

/**
 * KALUSAGAP registration design system.
 *
 * Single source of truth for the registration surface: the navy portal
 * background, the KALUSAGAP masthead, the white content card, typography,
 * form fields, the step indicator and the action buttons. Every registration
 * flow (new resident, transfer of residency, municipality) composes these
 * primitives so the pages read as one system.
 *
 * The Municipality Registration page is the visual reference; these values are
 * lifted from it so that page keeps its exact appearance.
 */

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

export const labelCls =
  "block text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500";

export const inputCls = (error) =>
  `w-full rounded-xl border bg-slate-50/60 px-4 py-3 text-sm text-brand-ink outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/10 ${
    error
      ? "border-brand-danger bg-rose-50/50 focus:border-brand-danger focus:ring-brand-danger/10"
      : "border-slate-200 hover:border-slate-300"
  }`;

/** Label + optional flag + inline error, matching the reference form. */
export function Field({
  label,
  required = false,
  optional = false,
  error = null,
  hint = null,
  trailing = null,
  children,
  className = "",
}) {
  return (
    <div className={`group ${className}`}>
      <label className={`${labelCls} transition-colors group-focus-within:text-brand-blue`}>
        {label}
        {required && <span className="ml-0.5 font-medium text-brand-danger">*</span>}
        {optional && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">
            (Optional)
          </span>
        )}
      </label>
      <div className="mt-1.5">
        {trailing ? (
          <div className="relative">
            {children}
            {trailing}
          </div>
        ) : (
          children
        )}
      </div>
      {hint && !error && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">{hint}</p>
      )}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] font-medium text-brand-danger">
          <span className="inline-block h-1 w-1 rounded-full bg-brand-danger" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Native select styled exactly like the reference inputs. */
export function SelectField({
  label,
  required = false,
  optional = false,
  error = null,
  hint = null,
  children,
  className = "",
  ...props
}) {
  return (
    <Field
      label={label}
      required={required}
      optional={optional}
      error={error}
      hint={hint}
      className={className}
    >
      <div className="relative">
        <select {...props} className={`${inputCls(error)} cursor-pointer appearance-none pr-10`}>
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Content primitives                                                          */
/* -------------------------------------------------------------------------- */

/** Lettered/section kicker with the leading rule, used above form sections. */
export function SectionKicker({ children, className = "" }) {
  return (
    <p
      className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-blue ${className}`}
    >
      <span className="h-px w-6 bg-brand-blue/40" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Display heading for a registration page: serif title with the gold rule. */
export function PageHeading({ title, subtitle }) {
  return (
    <div>
      <h1 className="font-display text-[20px] font-bold leading-tight text-brand-dark sm:text-[22px]">
        {title}
      </h1>
      <div className="mt-3 h-[3px] w-12 rounded-full bg-brand-gold" aria-hidden="true" />
      {subtitle && (
        <p className="mt-3.5 text-[12.5px] leading-relaxed text-slate-500">{subtitle}</p>
      )}
    </div>
  );
}

/** Bordered information / status note. */
export function InfoNote({ tone = "info", icon: Icon = null, children, className = "" }) {
  const tones = {
    info: "border-brand-blue/15 bg-brand-light/40 text-slate-500",
    gold: "border-brand-gold/30 bg-brand-goldpale/70 text-brand-amber",
    danger: "border-brand-danger/25 bg-rose-50/60 text-brand-danger",
  };
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 text-[12px] leading-relaxed ${tones[tone]} ${className}`}
    >
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Label/value review list with an optional "Edit" action. */
export function ReviewBlock({ title, onEdit, items }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
            {title}
          </p>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-blue transition-colors hover:text-brand-dark"
            >
              <Edit3 className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4"
          >
            <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:w-40 sm:shrink-0 sm:pt-0.5">
              {label}
            </p>
            <p className="min-w-0 break-words text-[13px] font-medium text-brand-ink">
              {value || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step indicator                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Shared 4-step (or N-step) indicator.
 * Active: filled navy circle with halo. Completed: navy with a check.
 * Upcoming: neutral outline. Connectors fill navy once a step completes.
 */
export function StepIndicator({ current, steps, flowLabel }) {
  const total = steps.length;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-200/80 pb-3">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-blue">
          {flowLabel} · Step {String(current).padStart(2, "0")} of {String(total).padStart(2, "0")}
        </p>
      </div>

      {/* Flexible grid: every step gets an equal, shrinkable column so long
          labels wrap instead of overflowing/clipping the card. */}
      <div
        className="mt-6 grid items-start"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {steps.map((step, i) => {
          const num = step.num ?? i + 1;
          const isActive = current === num;
          const isComplete = current > num;
          const isLast = i === total - 1;
          return (
            <div key={num} className="relative flex min-w-0 flex-col items-center gap-2.5 px-0.5">
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[calc(50%+22px)] right-[calc(-50%+22px)] top-[17px] h-[2px] rounded-full transition-colors duration-500 ${
                    isComplete ? "bg-brand-blue" : "bg-slate-200"
                  }`}
                />
              )}
              <div className="relative z-10">
                {isActive && (
                  <span
                    className="absolute -inset-1.5 rounded-full border border-brand-blue/25"
                    aria-hidden="true"
                  />
                )}
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                    isComplete || isActive
                      ? "border-brand-blue bg-brand-blue shadow-[0_4px_12px_-2px_rgba(18,81,143,0.45)]"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-4 w-4 text-white" strokeWidth={3} />
                  ) : (
                    <span
                      className={`font-stat text-[12px] font-bold tabular-nums transition-colors ${
                        isActive ? "text-white" : "text-slate-400"
                      }`}
                    >
                      {String(num).padStart(2, "0")}
                    </span>
                  )}
                </div>
              </div>
              <span
                className={`w-full text-center text-[9.5px] font-bold uppercase leading-tight tracking-[0.08em] transition-colors sm:text-[10px] sm:tracking-[0.1em] ${
                  isActive ? "text-brand-blue" : isComplete ? "text-slate-700" : "text-slate-400"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

export const btnPrimary =
  "group inline-flex items-center justify-center gap-2 rounded-xl bg-brand-blue px-6 py-3 text-[12.5px] font-bold uppercase tracking-[0.1em] text-white transition-all hover:bg-brand-dark hover:shadow-[0_8px_20px_-6px_rgba(18,81,143,0.5)] focus-visible:ring-4 focus-visible:ring-brand-blue/20 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-brand-blue disabled:hover:shadow-none";

export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3 text-[12.5px] font-bold uppercase tracking-[0.1em] text-brand-dark transition-colors hover:border-brand-blue hover:text-brand-blue focus-visible:ring-4 focus-visible:ring-brand-blue/10 disabled:cursor-not-allowed disabled:opacity-60";

export const btnGhost =
  "group inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12.5px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-ink";

/* -------------------------------------------------------------------------- */
/* Shell + card                                                                */
/* -------------------------------------------------------------------------- */

/** Navy portal background + KALUSAGAP masthead + centered content column. */
export function RegistrationShell({ children, footer = undefined }) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#0A2E55] px-4 py-6 sm:px-6 sm:py-10">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 12%, rgba(255,255,255,0.06) 0 1px, transparent 1px 11px), radial-gradient(circle at 82% 88%, rgba(255,255,255,0.045) 0 1px, transparent 1px 13px), linear-gradient(158deg, #0A3A70 0%, #072B54 55%, #051F3E 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(228,195,93,0.08), transparent 70%)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative flex w-full max-w-3xl flex-col"
      >
        <div className="mb-4 flex items-center justify-center gap-3 sm:mb-5">
          <GovSeal height={40} eager onDark />
          <div className="text-left">
            <p className="font-display text-[16px] font-bold leading-tight tracking-[0.02em] text-white">
              KALUSAGAP
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/60">
              Community Health System
            </p>
          </div>
        </div>

        {children}

        {footer === undefined ? (
          <p className="mt-5 text-center">
            <Link
              to="/"
              className="text-[12px] font-medium text-white/60 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60"
            >
              Return to portal home
            </Link>
          </p>
        ) : (
          footer
        )}
      </motion.div>
    </div>
  );
}

/** White content card shared by every registration page. */
export function RegistrationCard({ children, className = "" }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl bg-white shadow-[0_32px_80px_-24px_rgba(3,20,45,0.7)] ring-1 ring-black/5 sm:rounded-[20px] ${className}`}
    >
      {children}
    </div>
  );
}
