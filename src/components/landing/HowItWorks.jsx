import React from "react";
import { motion } from "framer-motion";
import Icon from "@/components/shared/Icon";
import { howItWorks } from "@/lib/mockData";

export default function HowItWorks() {
  return (
    <section className="max-w-content mx-auto px-5 md:px-8 py-24">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-sm font-semibold text-brand-accent uppercase tracking-wider">How It Works</p>
        <h2 className="mt-3 text-3xl md:text-4xl font-semibold text-brand-ink tracking-tight">Four simple steps to better care</h2>
      </div>
      <div className="mt-16 grid md:grid-cols-4 gap-8 relative">
        {howItWorks.map((s, i) => (
          <motion.div key={s.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="relative text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-white border border-brand-border shadow-card flex items-center justify-center text-brand-blue relative z-10">
              <Icon name={s.icon} className="w-7 h-7" strokeWidth={1.6} />
              <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-brand-blue text-white text-xs font-semibold flex items-center justify-center">{i + 1}</span>
            </div>
            <h3 className="mt-5 font-semibold text-brand-ink">{s.title}</h3>
            <p className="mt-2 text-sm text-brand-gray leading-relaxed">{s.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}