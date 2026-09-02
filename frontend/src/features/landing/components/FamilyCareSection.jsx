import React from "react";
import { motion } from "framer-motion";
import { HeartHandshake, HomeIcon, Stethoscope, CheckCircle2 } from "lucide-react";
import { SectionHeading } from "@/components/branding/GovChrome";

const elderlyIllustration = new URL("../../../assets/illustrations/nursing-home.png", import.meta.url).href;

const provisions = [
  {
    icon: HomeIcon,
    title: "Home visitation for seniors",
    copy: "Barangay health workers and midwives conduct scheduled house calls for elderly residents with limited mobility.",
  },
  {
    icon: HeartHandshake,
    title: "Family health follow-up",
    copy: "Nutrition checks, chronic condition monitoring, and maternal follow-through are tracked per household.",
  },
  {
    icon: Stethoscope,
    title: "Referral to the RHU",
    copy: "Cases beyond barangay capacity are endorsed to the Rural Health Unit with complete records attached.",
  },
];

export default function FamilyCareSection() {
  return (
    <section className="bg-paper py-20 md:py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45 }}
          >
            <SectionHeading
              kicker="Senior Citizens & Families"
              title="Care that reaches the household"
              lede="Under the Expanded Senior Citizens Act and the municipal family health program, services are brought to residents who cannot travel to the health centre."
            />

            <ul className="mt-10 divide-y divide-brand-border border-y border-brand-border">
              {provisions.map((item) => (
                <li key={item.title} className="flex gap-4 py-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-brand-blue/15 bg-white text-brand-blue">
                    <item.icon className="h-4.5 w-4.5" strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-brand-ink">{item.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-[1.7] text-brand-gray">{item.copy}</p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-6 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-blue">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              No fees are collected for home visitation
            </p>
          </motion.div>

          <motion.figure
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="gov-sheet bg-white"
          >
            <div className="gov-grid border-b border-brand-border bg-brand-light/50 p-6 md:p-10">
              <img
                src={elderlyIllustration}
                alt="Barangay health worker attending to an elderly resident at home"
                className="mx-auto w-full max-w-md object-contain"
              />
            </div>
            <figcaption className="flex items-center justify-between gap-4 px-6 py-4">
              <p className="text-[12px] leading-relaxed text-brand-gray">
                Home-based care conducted by barangay health workers in coordination
                with the Rural Health Unit.
              </p>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-gov text-brand-gray/70">
                Fig. 1
              </span>
            </figcaption>
          </motion.figure>
        </div>
      </div>
    </section>
  );
}
