import React from "react";
import { motion } from "framer-motion";
import { stats } from "@/services/mock/mockData";

export default function TrustStats() {
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-blue">Community Health at a Glance</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-dark">Key municipal health indicators</h2>
          <p className="mt-4 text-base leading-8 text-brand-gray">Data points that reflect how the system supports residents, households, records, and follow-up services.</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.landing.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="rounded-[16px] border border-brand-border bg-brand-bg p-6 text-center shadow-card">
              <p className="text-4xl font-heading font-semibold text-brand-blue">{s.value}</p>
              <p className="mt-2 text-sm text-brand-gray">{s.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
