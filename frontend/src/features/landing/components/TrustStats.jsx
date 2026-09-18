import React from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Database, Users, Activity } from "lucide-react";

/**
 * Trust section for the public landing page.
 *
 * This describes what the system does — it deliberately shows no fabricated
 * municipal statistics. Live figures belong to the authenticated dashboards,
 * where they come from the API (and are shown as empty/loading states until
 * real data is available).
 */
const POINTS = [
  {
    icon: Database,
    title: "One resident record",
    desc: "Health records, household profiles and consultations kept in a single, consistent registry.",
  },
  {
    icon: Activity,
    title: "Risk flagged early",
    desc: "Household and community risk factors are monitored so interventions happen sooner.",
  },
  {
    icon: Users,
    title: "Scoped to your role",
    desc: "Every account sees only the barangay and records its role is permitted to access.",
  },
  {
    icon: ShieldCheck,
    title: "Protected by design",
    desc: "Authentication, role-based authorization and database-level policies guard resident data.",
  },
];

export default function TrustStats() {
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-blue">Built for Community Health</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-dark">What the system guarantees</h2>
          <p className="mt-4 text-base leading-8 text-brand-gray">How KALUSAGAP supports residents, households, records, and follow-up services across the municipality.</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {POINTS.map((point, i) => (
            <motion.div
              key={point.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-[16px] border border-brand-border bg-brand-bg p-6 shadow-card"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
                <point.icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <p className="mt-4 font-heading text-base font-semibold text-brand-dark">{point.title}</p>
              <p className="mt-2 text-sm leading-7 text-brand-gray">{point.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
