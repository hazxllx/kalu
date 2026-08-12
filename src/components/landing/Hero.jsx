import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, FileCheck2, Users, Megaphone, Phone } from "lucide-react";
import GovSeal from "@/components/landing/GovSeal";

const advisories = [
  "Free anti-dengue clean-up drive — all barangays, every Saturday, 6:00 AM.",
  "Measles-Rubella immunization ongoing at the Rural Health Unit until further notice.",
  "Prenatal check-ups available Monday to Friday, 8:00 AM – 4:00 PM.",
  "TB DOTS medicine refill: present your treatment card at your barangay health station.",
];

const assurances = [
  { icon: ShieldCheck, title: "Data Privacy Act", copy: "Records handled under R.A. 10173." },
  { icon: FileCheck2, title: "Verified Access", copy: "Accounts confirmed by your BHW." },
  { icon: Users, title: "Barangay-Linked", copy: "Connected to all 26 barangays." },
];

export default function Hero() {
  return (
    <section id="home" className="relative overflow-hidden bg-white">
      {/* Advisory ticker */}
      <div className="border-b border-brand-border bg-[#FDF6E3]">
        <div className="mx-auto flex max-w-content items-center gap-3 px-5 py-2.5 md:px-8">
          <span className="flex shrink-0 items-center gap-1.5 border border-brand-gold/40 bg-white px-2 py-1 text-[9.5px] font-bold uppercase tracking-gov text-brand-gold">
            <Megaphone className="h-3 w-3" strokeWidth={2.2} />
            Advisory
          </span>
          <div className="relative flex-1 overflow-hidden">
            <div className="marquee-track flex w-max gap-10 whitespace-nowrap">
              {[...advisories, ...advisories].map((a, i) => (
                <span key={i} className="text-[12.5px] text-brand-ink/80">
                  {a}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main masthead */}
      <div className="relative gov-navy-panel gov-guilloche text-white">
        <div className="mx-auto grid max-w-content gap-12 px-5 py-16 md:px-8 md:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-brand-goldlight/70" aria-hidden="true" />
              <p className="gov-kicker text-brand-goldlight">
                Municipality of Pili · Camarines Sur
              </p>
            </div>

            <h1 className="mt-6 font-display text-[32px] font-bold leading-[1.18] tracking-[-0.015em] sm:text-[40px] lg:text-[46px]">
              Community Health Risk Monitoring
              <span className="block text-brand-goldlight">and Early Intervention System</span>
            </h1>

            <div className="mt-6 h-px w-24 bg-white/25" aria-hidden="true" />

            <p className="mt-6 max-w-xl text-[15.5px] leading-[1.8] text-white/75">
              The official health portal of the Municipal Health Office. Residents,
              barangay health workers, midwives, and municipal personnel are served
              through one accountable record system.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="group inline-flex items-center gap-2.5 bg-white px-7 py-3.5 text-[13.5px] font-bold uppercase tracking-[0.1em] text-brand-dark transition-colors hover:bg-brand-goldlight"
              >
                Register as Resident
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 border border-white/35 px-7 py-3.5 text-[13.5px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:border-white hover:bg-white/10"
              >
                Log In
              </Link>
            </div>

            <div className="mt-11 grid gap-x-8 gap-y-5 border-t border-white/15 pt-7 sm:grid-cols-3">
              {assurances.map((item) => (
                <div key={item.title} className="flex gap-3">
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-goldlight" strokeWidth={1.9} />
                  <div>
                    <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-white">
                      {item.title}
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-white/60">{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Official notice sheet */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="relative"
          >
            <div className="border border-white/15 bg-white shadow-raise">
              {/* Sheet masthead */}
              <div className="flex items-center gap-3.5 border-b-2 border-brand-dark bg-brand-paper px-6 py-5">
                <GovSeal height={38} eager className="shrink-0" />
                <div className="min-w-0">
                  <p className="font-display text-[15px] font-bold leading-snug tracking-[0.03em] text-brand-dark">
                    KALUSAGAP
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-brand-gray">
                    Public Service Notice
                  </p>
                </div>
              </div>
              <div className="h-[3px] w-full gov-flag-rule" aria-hidden="true" />

              <div className="px-6 py-6">
                <p className="gov-kicker text-brand-blue">Who may enrol</p>
                <ul className="mt-4 divide-y divide-brand-border/70">
                  {[
                    ["Bona fide residents", "Any resident of Pili aged 18 and above."],
                    ["Transferees", "Residents relocating from another barangay or municipality."],
                    ["Health personnel", "BHWs, midwives, RHU staff, and MHO officers."],
                  ].map(([label, copy]) => (
                    <li key={label} className="flex gap-3.5 py-3.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 bg-brand-blue" aria-hidden="true" />
                      <div>
                        <p className="text-[13.5px] font-semibold text-brand-ink">{label}</p>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-brand-gray">{copy}</p>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 border-l-[3px] border-brand-gold bg-[#FDF6E3] px-4 py-3.5">
                  <p className="text-[12px] leading-relaxed text-brand-ink/85">
                    <span className="font-bold">Requirements: </span>
                    one valid government-issued ID and a recent photograph for
                    identity verification. No fees are collected for registration.
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 border-t border-brand-border pt-4">
                  <p className="flex items-center gap-2 text-[12px] text-brand-gray">
                    <Phone className="h-3.5 w-3.5 text-brand-blue" strokeWidth={2} />
                    Health hotline (054) 477-1234
                  </p>
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-gray">
                    MHO Circular 01
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
