import React from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Baby, HeartPulse, ShieldCheck, Stethoscope, Syringe, Users, Droplets } from "lucide-react";
import { SectionHeading } from "@/components/landing/GovChrome";

const services = [
  {
    code: "MHO-01",
    title: "Medical Consultation",
    description: "Primary care assessment, diagnosis, and treatment at the Rural Health Unit and barangay health stations.",
    schedule: "Mon – Fri · 8:00 AM – 4:00 PM",
    icon: Stethoscope,
  },
  {
    code: "MHO-02",
    title: "Maternal Care",
    description: "Prenatal and postnatal monitoring, birth planning, and referral to the birthing facility.",
    schedule: "Tue & Thu · 8:00 AM – 12:00 NN",
    icon: Baby,
  },
  {
    code: "MHO-03",
    title: "Immunization",
    description: "Expanded Program on Immunization for infants and children, plus adult vaccination drives.",
    schedule: "Wed · 8:00 AM – 3:00 PM",
    icon: Syringe,
  },
  {
    code: "MHO-04",
    title: "Family Planning",
    description: "Counselling, commodity provision, and reproductive health services for couples and individuals.",
    schedule: "Mon – Fri · By appointment",
    icon: Users,
  },
  {
    code: "MHO-05",
    title: "Tuberculosis (DOTS)",
    description: "Screening, directly observed treatment, and case holding for TB patients under the NTP.",
    schedule: "Daily · 8:00 AM – 10:00 AM",
    icon: ShieldCheck,
  },
  {
    code: "MHO-06",
    title: "Nutrition & Wellness",
    description: "Operation Timbang, growth monitoring, micronutrient supplementation, and feeding programs.",
    schedule: "Quarterly · Per barangay",
    icon: HeartPulse,
  },
  {
    code: "MHO-07",
    title: "Environmental Health",
    description: "Water potability testing, sanitation inspection, and household environment monitoring.",
    schedule: "Mon – Fri · On request",
    icon: Droplets,
  },
];

export default function ServicesSection() {
  return (
    <section id="services" className="border-y border-brand-border bg-white py-20 md:py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <SectionHeading
            kicker="Citizen's Charter"
            title="Frontline health services"
            lede="Services delivered by the Municipal Health Office and its barangay health stations, in accordance with the Anti-Red Tape Act."
          />
          <a
            href="#how-it-works"
            className="hidden items-center gap-2 border border-brand-rule px-5 py-3 text-[12px] font-bold uppercase tracking-[0.12em] text-brand-dark transition-colors hover:border-brand-blue hover:text-brand-blue lg:inline-flex"
          >
            View process flow
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-12 grid border-l border-t border-brand-border sm:grid-cols-2 xl:grid-cols-3">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <motion.article
                key={service.code}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: (index % 3) * 0.06 }}
                className="group relative border-b border-r border-brand-border bg-white p-7 transition-colors hover:bg-brand-paper"
              >
                <span
                  className="absolute inset-x-0 top-0 h-[3px] scale-x-0 bg-brand-blue transition-transform duration-300 group-hover:scale-x-100"
                  aria-hidden="true"
                />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-11 w-11 items-center justify-center border border-brand-blue/20 bg-brand-light text-brand-blue">
                    <Icon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <span className="font-stat text-[10.5px] font-bold uppercase tracking-[0.14em] text-brand-gray/70">
                    {service.code}
                  </span>
                </div>

                <h3 className="mt-5 font-display text-[17px] font-bold leading-snug text-brand-dark">
                  {service.title}
                </h3>
                <p className="mt-3 text-[13.5px] leading-[1.7] text-brand-gray">{service.description}</p>

                <p className="mt-5 border-t border-dashed border-brand-border pt-3.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-brand-blue">
                  {service.schedule}
                </p>
              </motion.article>
            );
          })}

          {/* Filler cell that keeps the grid rectangular and adds a call to action */}
          <div className="border-b border-r border-brand-border bg-brand-light/60 p-7">
            <p className="gov-kicker text-brand-blue">Need assistance?</p>
            <p className="mt-4 text-[13.5px] leading-[1.7] text-brand-gray">
              Approach your Barangay Health Worker or call the municipal health
              hotline for guidance on any of the services listed.
            </p>
            <p className="mt-5 font-display text-[19px] font-bold text-brand-dark">(054) 477-1234</p>
            <p className="mt-1 text-[11.5px] uppercase tracking-[0.12em] text-brand-gray">
              Mon – Fri · 8:00 AM – 5:00 PM
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
