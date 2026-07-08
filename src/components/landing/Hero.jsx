import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Play, ShieldCheck } from "lucide-react";

export default function Hero() {
  return (
    <section id="home" className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-brand-light/60 to-brand-bg -z-10" />
      <div className="max-w-content mx-auto px-5 md:px-8 grid lg:grid-cols-2 gap-14 items-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <span className="inline-flex items-center gap-2 bg-white border border-brand-border rounded-full px-3.5 py-1.5 text-xs font-medium text-brand-blue shadow-card">
            <ShieldCheck className="w-3.5 h-3.5" /> Healthcare for Every Community
          </span>
          <h1 className="mt-6 text-4xl md:text-5xl lg:text-[3.4rem] font-semibold leading-[1.08] text-brand-ink tracking-tight">
            Smarter Community <span className="text-brand-blue">Healthcare</span> Starts Here.
          </h1>
          <p className="mt-6 text-lg text-brand-gray leading-relaxed max-w-xl">
            KALUSAGAP helps Barangay Health Workers, Rural Health Units, and residents manage health records, monitor community risks, and improve follow-up care through one connected platform.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login" className="inline-flex items-center gap-2 bg-brand-blue text-white px-6 py-3.5 rounded-btn font-medium hover:bg-brand-dark transition-colors shadow-soft">
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#features" className="inline-flex items-center gap-2 bg-white border border-brand-border text-brand-ink px-6 py-3.5 rounded-btn font-medium hover:border-brand-blue transition-colors">
              <Play className="w-4 h-4 text-brand-blue" /> Learn More
            </a>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.1 }} className="relative">
          <div className="relative rounded-[28px] overflow-hidden shadow-float">
            <img src={new URL("../../public/Landing1.png", import.meta.url).href} alt="Community healthcare" className="w-full h-auto object-contain" />
          </div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
            className="absolute -bottom-6 -left-4 md:left-6 bg-white rounded-2xl shadow-float p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-green/10 text-brand-green flex items-center justify-center font-stat font-bold">98%</div>
            <div>
              <p className="text-sm font-semibold text-brand-ink">Resident Satisfaction</p>
              <p className="text-xs text-brand-gray">Across 6 barangays</p>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}