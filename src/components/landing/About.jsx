import React from "react";
import { motion } from "framer-motion";
import { Target, Eye, CheckCircle2 } from "lucide-react";

export default function About() {
  return (
    <section id="about" className="bg-brand-bg py-24">
      <div className="max-w-content mx-auto px-5 md:px-8 grid lg:grid-cols-2 gap-14 items-center">
        <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="relative">
          <div className="rounded-[24px] overflow-hidden shadow-float">
            <img src="https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1100&q=80" alt="Health workers" className="w-full h-[420px] object-cover" />
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
          <p className="text-sm font-semibold text-brand-accent uppercase tracking-wider">About KALUSAGAP</p>
          <h2 className="mt-3 text-3xl md:text-4xl font-semibold text-brand-ink tracking-tight">Community-focused healthcare for Pili and beyond</h2>
          <p className="mt-4 text-brand-gray text-lg leading-relaxed">
            Built with and for barangay health teams, KALUSAGAP bridges the gap between residents and the care they need — making prevention, monitoring, and follow-up effortless.
          </p>
          <div className="mt-8 space-y-5">
            <div className="flex gap-4">
              <div className="w-11 h-11 shrink-0 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center justify-center"><Target className="w-5 h-5" /></div>
              <div>
                <h3 className="font-semibold text-brand-ink">Our Mission</h3>
                <p className="text-brand-gray mt-1">Empower every barangay with tools to deliver timely, equitable, and data-driven healthcare.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-11 h-11 shrink-0 rounded-xl bg-brand-green/10 text-brand-green flex items-center justify-center"><Eye className="w-5 h-5" /></div>
              <div>
                <h3 className="font-semibold text-brand-ink">Our Vision</h3>
                <p className="text-brand-gray mt-1">Healthier communities where no resident is left behind in their care journey.</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}