import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  UserPlus,
  ArrowLeftRight,
  Check,
  IdCard,
  Camera,
  MapPin,
  FileCheck2,
  Clock,
} from "lucide-react";
import GovSeal from "@/components/branding/GovSeal";

const options = [
  {
    key: "resident",
    icon: UserPlus,
    code: "FORM A",
    title: "New resident registration",
    copy: "For residents of Pili not yet enrolled in the municipal health record.",
    to: "/register/new/step-1",
    cta: "Continue",
    requirements: [
      { icon: IdCard, label: "Valid government-issued identification" },
      { icon: MapPin, label: "Current address and barangay" },
      { icon: Camera, label: "Recent photograph for verification" },
    ],
    note: "Your registration will be reviewed by the appropriate health personnel within 2–3 working days.",
  },
  {
    key: "transfer",
    icon: ArrowLeftRight,
    code: "FORM B",
    title: "Transfer of residency",
    copy: "For residents transferring from another barangay or municipality with an existing record.",
    to: "/register/transfer",
    cta: "Continue",
    requirements: [
      { icon: FileCheck2, label: "Previous health record or referral document" },
      { icon: IdCard, label: "Valid government-issued identification" },
      { icon: MapPin, label: "Proof of new address within Pili" },
    ],
    note: "Records are consolidated once your previous unit confirms the transfer.",
  },
  {
    key: "official",
    icon: Building2,
    code: "FORM C",
    title: "Health personnel account",
    copy: "For authorized health workers and municipal health personnel. Staff accounts require verification by the Municipal Health Office.",
    to: "/login",
    cta: "Request official access",
    requirements: [
      { icon: FileCheck2, label: "Certificate of appointment or service record" },
      { icon: IdCard, label: "Office-issued identification card" },
      { icon: Building2, label: "Endorsement from your assigned health unit" },
    ],
    note: "Accounts are activated by the System Administrator after credential review.",
  },
];

const STEPS = [
  { n: 1, label: "Registration Type" },
  { n: 2, label: "Registration Information" },
];

/**
 * Requirements and processing time for the selected form.
 *
 * Rendered in the dark information panel on desktop and inline under the form
 * options on smaller screens, so the whole card stays visible in the viewport
 * and nothing is ever scrolled out of reach inside the card.
 */
function FormDetails({ form, tone = "light", className = "" }) {
  const dark = tone === "dark";
  return (
    <motion.div
      key={form.key}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={className}
    >
      <p
        className={`text-[10.5px] font-bold uppercase tracking-gov ${
          dark ? "text-brand-goldlight" : "text-brand-gray"
        }`}
      >
        What you&apos;ll need
      </p>
      <ul className={`mt-2 grid gap-1.5 ${dark ? "" : "sm:grid-cols-2"}`}>
        {form.requirements.map((req) => (
          <li key={req.label} className="flex items-start gap-2">
            <Check
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${dark ? "text-brand-goldlight" : "text-brand-blue"}`}
              strokeWidth={2.5}
            />
            <span className={`text-[12px] leading-snug ${dark ? "text-white/80" : "text-brand-ink"}`}>{req.label}</span>
          </li>
        ))}
      </ul>

      <div
        className={`mt-3 flex items-start gap-2.5 rounded-lg border-l-2 px-3 py-2.5 ${
          dark ? "border-brand-goldlight/70 bg-white/10" : "border-brand-gold bg-brand-goldpale"
        }`}
      >
        <Clock
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${dark ? "text-brand-goldlight" : "text-brand-amber"}`}
          strokeWidth={2}
        />
        <div>
          <p
            className={`text-[10px] font-bold uppercase tracking-gov ${
              dark ? "text-brand-goldlight" : "text-brand-amber"
            }`}
          >
            Processing time
          </p>
          <p className={`mt-0.5 text-[11.5px] leading-relaxed ${dark ? "text-white/75" : "text-brand-amber"}`}>
            {form.note}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function StepIndicator({ current = 1 }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label={`Step ${current} of ${STEPS.length}`}>
      {STEPS.map((s, i) => {
        const active = s.n === current;
        const done = s.n < current;
        return (
          <li key={s.n} className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold transition-colors ${
                  active
                    ? "border-brand-blue bg-brand-blue text-white"
                    : done
                    ? "border-brand-blue bg-brand-light text-brand-blue"
                    : "border-brand-rule bg-white text-brand-gray"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : s.n}
              </span>
              <span className={`text-[11px] font-semibold sm:text-[11.5px] ${active ? "text-brand-ink" : "text-brand-gray"}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-brand-rule sm:w-8" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function RegistrationTypeSelection() {
  const [selected, setSelected] = useState("resident");
  const active = options.find((o) => o.key === selected);

  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center gov-navy-panel px-4 py-5 sm:py-7">
      <div className="pointer-events-none absolute inset-0 gov-guilloche opacity-60" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{ backgroundImage: "radial-gradient(60% 45% at 50% 0%, rgba(255,255,255,0.10), transparent 70%)" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative flex w-full max-w-5xl flex-col"
      >
        {/* Branding above the card */}
        <div className="mb-3 flex items-center justify-center gap-3">
          <GovSeal height={38} eager onDark />
          <div className="text-left">
            <p className="font-display text-[16px] font-bold leading-tight tracking-[0.02em] text-white">KALUSAGAP</p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/70">Community Health System</p>
          </div>
        </div>

        {/* Split card */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_70px_-30px_rgba(3,20,45,0.65)] ring-1 ring-white/10">
          <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
            {/* LEFT — registration */}
            <div className="px-5 py-5 sm:px-7 sm:py-6">
              <StepIndicator current={1} />

              <p className="gov-kicker mt-3.5 flex items-center gap-2 text-brand-blue">
                <span className="h-px w-5 bg-brand-blue/45" aria-hidden="true" />
                Registration · Step 1 of 2
              </p>
              <h1 className="mt-1.5 font-display text-[20px] font-bold text-brand-dark md:text-[22px]">
                Select the applicable registration form
              </h1>
              <p className="mt-1 text-[12.5px] leading-relaxed text-brand-gray">
                Choose the form that best matches your circumstances.
              </p>

              {/* Option cards */}
              <div className="mt-3.5 space-y-2">
                {options.map((opt) => {
                  const isActive = selected === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSelected(opt.key)}
                      aria-pressed={isActive}
                      className={`group flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-all ${
                        isActive
                          ? "border-brand-blue bg-brand-light/60 ring-1 ring-brand-blue/20"
                          : "border-brand-border bg-white hover:border-brand-blue/50 hover:bg-brand-paper/70"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          isActive
                            ? "border-brand-blue bg-brand-blue text-white"
                            : "border-brand-rule bg-white text-brand-blue group-hover:border-brand-blue"
                        }`}
                      >
                        <opt.icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
                      </span>
                      <span className="flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-stat text-[9px] font-bold tracking-[0.14em] text-brand-gray/70">{opt.code}</span>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand-blue/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-gov text-brand-blue">
                              <Check className="h-2.5 w-2.5" strokeWidth={3} />
                              Selected
                            </span>
                          )}
                        </span>
                        <span className={`mt-0.5 block text-[13.5px] font-bold leading-snug ${isActive ? "text-brand-blue" : "text-brand-ink"}`}>
                          {opt.title}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-brand-gray">{opt.copy}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Requirements and processing time — shown here below `lg`,
                  and in the information panel on desktop. */}
              <FormDetails form={active} className="mt-4 lg:hidden" />

              <Link
                to={active.to}
                className="group mt-4 flex w-full items-center justify-center gap-2.5 rounded-lg bg-brand-blue py-3 text-[13px] font-bold uppercase tracking-[0.11em] text-white shadow-sm transition-colors hover:bg-brand-dark"
              >
                {active.cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>

              <p className="mt-3 text-center text-[12.5px] text-brand-gray">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="font-semibold text-brand-blue underline decoration-brand-rule underline-offset-4 hover:decoration-brand-blue"
                >
                  Log in
                </Link>
              </p>
            </div>

            {/* RIGHT — information panel (desktop) */}
            <div className="relative hidden flex-col overflow-hidden gov-navy-panel gov-guilloche text-white lg:flex">
              <div className="flex min-h-0 flex-1 flex-col justify-center px-8 py-8">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-gov text-brand-goldlight">
                  <UserPlus className="h-3 w-3" strokeWidth={2.2} />
                  Join KALUSAGAP
                </span>
                <h2 className="mt-4 font-display text-[22px] font-bold leading-[1.25]">
                  One record,<br />better community care.
                </h2>
                <p className="mt-2.5 max-w-[17rem] text-[12.5px] leading-relaxed text-white/70">
                  Register once to access health services, records, consultations, referrals, and follow-up care.
                </p>

                <div className="mt-4 h-px w-full bg-white/15" aria-hidden="true" />
                <FormDetails form={active} tone="dark" className="mt-4" />
              </div>
              <div className="h-[3px] w-full shrink-0 gov-flag-rule" aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-4 text-center">
          <Link
            to="/"
            className="text-[12px] font-medium text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white hover:decoration-white"
          >
            Return to portal home
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
