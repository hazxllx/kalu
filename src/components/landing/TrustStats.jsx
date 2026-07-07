import React from "react";
import { motion } from "framer-motion";
import { stats } from "@/lib/mockData";

export default function TrustStats() {
  return (
    <section className="max-w-content mx-auto px-5 md:px-8 -mt-4">
      <div className="bg-brand-blue rounded-card px-6 md:px-10 py-10 grid grid-cols-2 md:grid-cols-5 gap-8 shadow-soft">
        {stats.landing.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="text-center">
            <p className="text-3xl md:text-4xl font-stat font-extrabold text-white tracking-tight">{s.value}</p>
            <p className="mt-1.5 text-xs md:text-sm text-white/80">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}