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
} from "lucide-react";
import { AgencyMark } from "@/components/landing/GovChrome";

const options = [
  {
    key: "resident",
    icon: UserPlus,
    code: "FORM A",
    title: "New resident registration",
    copy: "For residents of Pili who have not yet been enrolled in the municipal health record.",
    to: "/register/new/step-1",
    cta: "Proceed to Form A",
    requirements: [
      { icon: IdCard, label: "Valid government-issued identification card" },
      { icon: MapPin, label: "Current address and barangay of residence" },
      { icon: Camera, label: "Recent photograph for face verification" },
    ],
    note: "Reviewed by your Barangay Health Worker within 2–3 working days.",
  },
  {
    key: "transfer",
    icon: ArrowLeftRight,
    code: "FORM B",
    title: "Transfer of residency",
    copy: "For residents transferring from another barangay or municipality who already hold a health record.",
    to: "/register/transfer",
    cta: "Proceed to Form B",
    requirements: [
      { icon: FileCheck2, label: "Previous health record or referral document" },
      { icon: IdCard, label: "Valid government-issued identification card" },
      { icon: MapPin, label: "Proof of new address within Pili" },
    ],
    note: "Records are consolidated once your previous unit confirms the transfer.",
  },
  {
    key: "official",
    icon: Building2,
    code: "FORM C",
    title: "Health personnel account",
    copy: "For barangay health workers, midwives, RHU personnel, and municipal health officers.",
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

export default function RegistrationTypeSelection() {
  const [selected, setSelected] = useState("resident");
  const active = options.find((o) => o.key === selected);

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-8 md:py-14">
        <AgencyMark />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="gov-sheet mt-7 bg-white"
        >
          <div className="border-b border-brand-border bg-brand-paper px-7 py-6 md:px-9">
            <p className="gov-kicker flex items-center gap-2.5 text-brand-blue">
              <span className="h-px w-6 bg-brand-blue/45" aria-hidden="true" />
              Registration · Step 1 of 2
            </p>
            <h1 className="mt-3 font-display text-[24px] font-bold text-brand-dark md:text-[27px]">
              Select the applicable registration form
            </h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-brand-gray">
              Choose the form that matches your circumstances. All registrations
              are processed free of charge by the Municipal Health Office.
            </p>
          </div>

          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            {/* Form options */}
            <div className="divide-y divide-brand-border border-b border-brand-border lg:border-b-0 lg:border-r">
              {options.map((opt) => {
                const isActive = selected === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSelected(opt.key)}
                    aria-pressed={isActive}
                    className={`group relative flex w-full items-start gap-4 px-7 py-6 text-left transition-colors md:px-9 ${
                      isActive ? "bg-brand-paper" : "bg-white hover:bg-brand-paper/60"
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-0 h-full w-[3px] transition-colors ${
                        isActive ? "bg-brand-blue" : "bg-transparent"
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center border transition-colors ${
                        isActive
                          ? "border-brand-blue bg-brand-blue text-white"
                          : "border-brand-rule bg-white text-brand-blue group-hover:border-brand-blue"
                      }`}
                    >
                      <opt.icon className="h-[19px] w-[19px]" strokeWidth={1.9} />
                    </span>
                    <span className="flex-1">
                      <span className="flex items-center gap-2.5">
                        <span className="font-stat text-[10px] font-bold tracking-[0.14em] text-brand-gray/70">
                          {opt.code}
                        </span>
                        {isActive && (
                          <span className="inline-flex items-center gap-1 bg-brand-blue/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-gov text-brand-blue">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            Selected
                          </span>
                        )}
                      </span>
                      <span
                        className={`mt-1 block text-[15px] font-bold leading-snug transition-colors ${
                          isActive ? "text-brand-blue" : "text-brand-ink"
                        }`}
                      >
                        {opt.title}
                      </span>
                      <span className="mt-1.5 block text-[13px] leading-relaxed text-brand-gray">
                        {opt.copy}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Requirements panel */}
            <div className="bg-brand-paper px-7 py-7 md:px-9">
              <p className="gov-kicker text-brand-blue">Documentary requirements</p>
              <div className="mt-3.5 h-px w-full bg-brand-border" aria-hidden="true" />

              <motion.div key={active.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
                <p className="mt-5 font-display text-[16px] font-bold text-brand-dark">
                  {active.title}
                </p>

                <ul className="mt-5 space-y-4">
                  {active.requirements.map((req) => (
                    <li key={req.label} className="flex items-start gap-3.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-brand-border bg-white text-brand-blue">
                        <req.icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </span>
                      <span className="text-[13px] leading-relaxed text-brand-ink">
                        {req.label}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-7 border-l-2 border-brand-gold bg-brand-goldpale px-4 py-3.5">
                  <p className="text-[12px] leading-relaxed text-brand-amber">{active.note}</p>
                </div>

                <Link
                  to={active.to}
                  className="group mt-7 flex w-full items-center justify-center gap-2.5 bg-brand-blue py-3.5 text-[13px] font-bold uppercase tracking-[0.11em] text-white transition-colors hover:bg-brand-dark"
                >
                  {active.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </motion.div>
            </div>
          </div>

          <div className="border-t border-brand-border px-7 py-5 md:px-9">
            <p className="text-center text-[13px] text-brand-gray">
              Already registered?{" "}
              <Link
                to="/login"
                className="font-semibold text-brand-blue underline decoration-brand-rule underline-offset-4 hover:decoration-brand-blue"
              >
                Sign in to the portal
              </Link>
            </p>
          </div>
        </motion.div>

        <p className="mt-6 text-center">
          <Link
            to="/"
            className="text-[12px] font-medium text-brand-gray underline decoration-brand-rule underline-offset-4 transition-colors hover:text-brand-blue hover:decoration-brand-blue"
          >
            Return to portal home
          </Link>
        </p>
      </div>
    </div>
  );
}
