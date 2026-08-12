import React from "react";
import { motion } from "framer-motion";
import { FileText, Users, ShieldCheck, HeartPulse, MapPin, Quote } from "lucide-react";
import GovSeal from "@/components/landing/GovSeal";
import { SectionHeading } from "@/components/landing/GovChrome";

const mandates = [
  { title: "Digital records", icon: FileText, description: "Replace paper forms with an auditable resident record." },
  { title: "Community monitoring", icon: Users, description: "Keep barangay health teams working from one roster." },
  { title: "Risk identification", icon: ShieldCheck, description: "Flag residents needing priority intervention." },
  { title: "Follow-up support", icon: HeartPulse, description: "Track visits, referrals, and treatment outcomes." },
  { title: "Program coordination", icon: MapPin, description: "Align barangay, RHU, and municipal reporting." },
];

const ledger = [
  { figure: "26", label: "Barangays covered" },
  { figure: "7", label: "Service roles" },
  { figure: "24/7", label: "Record availability" },
  { figure: "R.A. 11223", label: "Universal Health Care Act" },
];

export default function About() {
  return (
    <section id="about" className="border-y border-brand-border bg-white py-20 md:py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="grid gap-14 lg:grid-cols-[1fr_0.92fr] lg:items-start">
          {/* Mandate */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45 }}
          >
            <SectionHeading
              kicker="About the System"
              title="A single record of community health"
              lede="KALUSAGAP is the community health risk monitoring and early intervention system of the Municipality of Pili. It serves barangay health workers, midwives, rural health unit personnel, the municipal health officer, and the residents they attend to."
            />

            <div className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
              {mandates.map((item) => (
                <div key={item.title} className="flex gap-4 border-l-2 border-brand-border pl-4">
                  <item.icon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-blue" strokeWidth={1.8} />
                  <div>
                    <h3 className="text-[13.5px] font-bold text-brand-ink">{item.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-[1.65] text-brand-gray">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Statistics ledger */}
            <div className="mt-12 grid grid-cols-2 border-l border-t border-brand-border sm:grid-cols-4">
              {ledger.map((item) => (
                <div key={item.label} className="border-b border-r border-brand-border px-4 py-5">
                  <p className="font-display text-[22px] font-bold leading-none text-brand-dark">
                    {item.figure}
                  </p>
                  <p className="mt-2.5 text-[10.5px] font-semibold uppercase leading-tight tracking-[0.12em] text-brand-gray">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Official statement panel */}
          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="lg:sticky lg:top-28"
          >
            <div className="gov-navy-panel gov-guilloche relative overflow-hidden text-white">
              <div className="px-8 py-9">
                <Quote className="h-7 w-7 text-brand-goldlight/70" strokeWidth={1.6} />
                <p className="mt-5 font-display text-[19px] leading-[1.6] text-white">
                  "Health is not a privilege granted to the few. It is a service
                  owed to every resident of this municipality."
                </p>
                <div className="mt-7 flex items-center gap-3.5 border-t border-white/15 pt-6">
                  <GovSeal height={32} onDark className="shrink-0" />
                  <div>
                    <p className="text-[13px] font-bold text-white">Office of the Municipal Health Officer</p>
                    <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-white/55">
                      Pili, Camarines Sur
                    </p>
                  </div>
                </div>
              </div>
              <div className="h-[3px] w-full gov-flag-rule" aria-hidden="true" />
            </div>

            <div className="gov-sheet mt-6 bg-white">
              <div className="border-b border-brand-border bg-brand-paper px-6 py-4">
                <p className="gov-kicker text-brand-blue">System Capabilities</p>
              </div>
              <dl className="divide-y divide-brand-border">
                {[
                  ["Resident health records", "Secure, shared health profiles"],
                  ["Risk categorization", "Low, medium, and high classification"],
                  ["Follow-up management", "Visits, referrals, and outcomes"],
                  ["Early warning alerts", "Timely response for priority cases"],
                ].map(([term, detail]) => (
                  <div key={term} className="px-6 py-4">
                    <dt className="text-[13px] font-bold text-brand-ink">{term}</dt>
                    <dd className="mt-1 text-[12.5px] text-brand-gray">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </motion.aside>
        </div>
      </div>
    </section>
  );
}
