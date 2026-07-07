import React from "react";
import { motion } from "framer-motion";
import Icon from "@/components/shared/Icon";
import { services } from "@/lib/mockData";

export default function ServicesSection() {
  return (
    <section id="services" className="bg-brand-light/50 py-24">
      <div className="max-w-content mx-auto px-5 md:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-sm font-semibold text-brand-accent uppercase tracking-wider">Health Services</p>
          <h2 className="mt-3 text-3xl md:text-4xl font-semibold text-brand-ink tracking-tight">Care available at your barangay</h2>
          <p className="mt-4 text-brand-gray text-lg">Comprehensive primary healthcare services for every member of the community.</p>
        </div>
        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-5">
          {services.map((s, i) => (
            <motion.div key={s.name} initial={{ opacity: 0, scale: 0.96 }} whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }} transition={{ delay: i * 0.05 }} whileHover={{ y: -4 }}
              className="bg-white rounded-card border border-brand-border p-6 text-center shadow-card hover:shadow-soft transition-shadow">
              <div className="w-12 h-12 mx-auto rounded-xl bg-brand-blue/8 text-brand-blue flex items-center justify-center">
                <Icon name={s.icon} className="w-6 h-6" strokeWidth={1.6} />
              </div>
              <p className="mt-4 font-medium text-brand-ink">{s.name}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}