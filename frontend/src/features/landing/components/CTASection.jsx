import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, IdCard, Camera, UserCheck } from "lucide-react";
import GovSeal from "@/components/branding/GovSeal";

const requirements = [
  { icon: IdCard, label: "Valid government-issued ID" },
  { icon: Camera, label: "Recent photograph for verification" },
  { icon: UserCheck, label: "Confirmation by your Barangay Health Worker" },
];

export default function CTASection() {
  return (
    <section className="border-y border-brand-border bg-paper py-16 md:py-20">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="gov-sheet grid bg-white lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-8 md:p-11">
            <p className="gov-kicker flex items-center gap-2.5 text-brand-blue">
              <span className="h-px w-6 bg-brand-blue/45" aria-hidden="true" />
              Resident Enrolment
            </p>
            <h2 className="mt-4 font-display text-[26px] font-bold leading-[1.25] text-brand-dark md:text-[31px]">
              Enrol your household in the municipal health record
            </h2>
            <p className="mt-5 max-w-lg text-[14.5px] leading-[1.8] text-brand-gray">
              Registration is free and processed at your barangay health station.
              Once verified, you may view your health record, request services, and
              receive follow-up notices from the Municipal Health Office.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="group inline-flex items-center gap-2.5 bg-brand-blue px-7 py-3.5 text-[13px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-brand-dark"
              >
                Begin Registration
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center border border-brand-rule px-7 py-3.5 text-[13px] font-bold uppercase tracking-[0.1em] text-brand-dark transition-colors hover:border-brand-blue hover:text-brand-blue"
              >
                I have an account
              </Link>
            </div>
          </div>

          <div className="gov-navy-panel gov-guilloche flex flex-col justify-between p-8 text-white md:p-11">
            <div>
              <div className="flex items-center gap-3">
                <GovSeal height={30} onDark className="shrink-0" />
                <p className="text-[10px] font-bold uppercase leading-tight tracking-gov text-white/70">
                  Bring the following
                  <br />
                  to your health station
                </p>
              </div>
              <ul className="mt-7 space-y-4 border-t border-white/15 pt-6">
                {requirements.map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-goldlight" strokeWidth={1.9} />
                    <span className="text-[13px] leading-relaxed text-white/75">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-8 border-t border-white/15 pt-5 text-[11px] uppercase tracking-[0.13em] text-white/45">
              No fees · No fixers · No appointment needed
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
