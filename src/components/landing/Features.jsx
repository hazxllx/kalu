import React from "react";
import { motion } from "framer-motion";
import Icon from "@/components/shared/Icon";
import { features } from "@/lib/mockData";

export default function Features() {
  return (
    <section id="features" className="max-w-content mx-auto px-5 md:px-8 py-24">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-brand-accent uppercase tracking-wider">Why KALUSAGAP</p>
        <h2 className="mt-3 text-3xl md:text-4xl font-semibold text-brand-ink tracking-tight">Everything a barangay needs, in one platform</h2>
        <p className="mt-4 text-brand-gray text-lg">Purpose-built for community health workers — simple enough for anyone, powerful enough for real impact.</p>
      </div>
      <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f, i) => (
          <motion.div key={f.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ delay: i * 0.06 }} whileHover={{ y: -4 }}
            className="bg-white rounded-card border border-brand-border p-7 shadow-card transition-shadow hover:shadow-soft">
            <div className="w-12 h-12 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center">
              <Icon name={f.icon} className="w-6 h-6" strokeWidth={1.6} />
            </div>
            <h3 className="mt-5 text-lg font-semibold text-brand-ink">{f.title}</h3>
            <p className="mt-2 text-brand-gray leading-relaxed">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}