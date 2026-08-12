import React from "react";
import { motion } from "framer-motion";
import { Activity, ShieldAlert, Syringe, HeartPulse, Apple, Sun } from "lucide-react";
import { SectionHeading, GovChip } from "@/components/landing/GovChrome";

const programs = [
  {
    ref: "NTP",
    title: "Tuberculosis",
    description: "Screening, DOTS treatment, and contact tracing under the National Tuberculosis Program.",
    status: "Ongoing",
    icon: ShieldAlert,
  },
  {
    ref: "NDP",
    title: "Dengue Prevention",
    description: "4S campaign, larviciding, and outbreak response during the rainy season.",
    status: "Seasonal",
    icon: Sun,
  },
  {
    ref: "NCPI",
    title: "COVID-19",
    description: "Vaccination records, bivalent boosters, and surveillance of respiratory illnesses.",
    status: "Watch",
    icon: Syringe,
  },
  {
    ref: "NCD",
    title: "Hypertension",
    description: "Blood pressure screening and medication adherence support for adults.",
    status: "Ongoing",
    icon: HeartPulse,
  },
  {
    ref: "NCD",
    title: "Diabetes",
    description: "Risk screening, glucose monitoring, and lifestyle counselling.",
    status: "Ongoing",
    icon: Activity,
  },
  {
    ref: "PND",
    title: "Nutrition",
    description: "Operation Timbang, micronutrient supplementation, and supplemental feeding.",
    status: "Ongoing",
    icon: Apple,
  },
];

export default function Features() {
  return (
    <section id="programs" className="bg-paper py-20 md:py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <SectionHeading
          kicker="Health Programs Registry"
          title="Programs under municipal supervision"
          lede="Priority programs monitored through KALUSAGAP, with public health status reported to the municipal health officer."
          align="center"
        />

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {programs.map((program, index) => {
            const Icon = program.icon;
            return (
              <motion.article
                key={program.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: (index % 3) * 0.06 }}
                className="gov-sheet flex flex-col bg-white p-6 transition-all hover:shadow-raise"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-10 w-10 items-center justify-center border border-brand-blue/15 bg-brand-light text-brand-blue">
                    <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
                  </div>
                  <GovChip tone={program.status === "Seasonal" ? "gold" : "navy"}>{program.status}</GovChip>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <h3 className="font-display text-[16.5px] font-bold text-brand-dark">{program.title}</h3>
                  <span className="font-stat text-[10px] font-bold uppercase tracking-[0.14em] text-brand-gray/60">
                    {program.ref}
                  </span>
                </div>
                <p className="mt-2.5 flex-1 text-[13.5px] leading-[1.7] text-brand-gray">
                  {program.description}
                </p>
                <div className="mt-5 border-t border-brand-border pt-4">
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-brand-blue">
                    Reported to the Municipal Health Officer
                  </p>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
