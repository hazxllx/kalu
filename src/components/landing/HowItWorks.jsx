import React from "react";
import { motion } from "framer-motion";
import { BadgeCheck, CalendarCheck, FileText, Stethoscope, UserPlus } from "lucide-react";
import { SectionHeading } from "@/components/landing/GovChrome";

const steps = [
  {
    number: "01",
    title: "Enroll",
    description: "Create an account and submit your basic household and contact details online.",
    icon: UserPlus,
  },
  {
    number: "02",
    title: "Verify",
    description: "Your identity is confirmed by health personnel to secure access to your records.",
    icon: BadgeCheck,
  },
  {
    number: "03",
    title: "Access",
    description: "View your consultations, immunizations, and health history in one place.",
    icon: FileText,
  },
  {
    number: "04",
    title: "Request",
    description: "Book consultations and apply for health services without queueing at the office.",
    icon: CalendarCheck,
  },
  {
    number: "05",
    title: "Follow Through",
    description: "Receive reminders for check-ups, referrals, and scheduled follow-up visits.",
    icon: Stethoscope,
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="gov-navy-panel gov-guilloche relative py-20 text-white md:py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <SectionHeading
          kicker="Getting Started"
          title="Five steps from sign-up to service"
          lede="Enrollment is done once. After verification, you can reach health services and keep track of your family's records from any device."
          tone="light"
        />

        <ol className="mt-14 grid gap-px border border-white/12 bg-white/12 md:grid-cols-3 lg:grid-cols-5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <motion.li
                key={step.number}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.07 }}
                className="group relative bg-[#082F5C] p-7 transition-colors hover:bg-[#0A3A70]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-[30px] font-bold leading-none text-white/15 transition-colors group-hover:text-brand-goldlight/40">
                    {step.number}
                  </span>
                  <Icon className="h-5 w-5 text-brand-goldlight" strokeWidth={1.7} />
                </div>
                <div className="mt-6 h-px w-9 bg-brand-goldlight/50" aria-hidden="true" />
                <h3 className="mt-4 text-[15px] font-bold uppercase tracking-[0.08em] text-white">
                  {step.title}
                </h3>
                <p className="mt-2.5 text-[12.5px] leading-[1.7] text-white/60">{step.description}</p>
              </motion.li>
            );
          })}
        </ol>

        <p className="mt-8 text-[12px] uppercase tracking-[0.14em] text-white/45">
          Enrollment is free of charge · Assistance available at your barangay health station
        </p>
      </div>
    </section>
  );
}
