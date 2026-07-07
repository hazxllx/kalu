import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2, ShieldCheck, ArrowRight, Download, MapPin,
  FileText, Calendar, Clock,
} from "lucide-react";
import { LOGO_URL } from "@/lib/brand";

const STEPS = [
  { label: "Registration Submitted", desc: "Your registration was received.", done: true },
  { label: "Identity Verification", desc: "ID document uploaded for review.", done: true },
  { label: "Barangay Health Worker Review", desc: "Awaiting review by assigned BHW.", done: false, current: true },
  { label: "Account Approved", desc: "Pending approval.", done: false },
  { label: "Dashboard Access", desc: "Full system access granted.", done: false },
];

export default function RegistrationSuccess() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6 md:p-10">
      <div className="absolute top-0 left-0 w-96 h-96 bg-brand-green/5 rounded-full blur-3xl -translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-blue/5 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-2xl"
      >
        <img src={LOGO_URL} alt="KALUSAGAP" className="h-10 w-auto mx-auto mb-8" />

        <div className="bg-white rounded-card border border-brand-border shadow-float overflow-hidden">
          {/* Success header */}
          <div className="bg-gradient-to-br from-brand-green/10 to-brand-blue/5 px-8 py-10 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="w-16 h-16 rounded-full bg-brand-green/15 flex items-center justify-center mx-auto"
            >
              <CheckCircle2 className="w-8 h-8 text-brand-green" strokeWidth={2} />
            </motion.div>
            <h1 className="mt-5 text-2xl font-heading font-semibold text-brand-ink">Registration Submitted Successfully</h1>
            <p className="mt-3 text-sm text-brand-gray max-w-md mx-auto">
              Thank you for registering with KALUSAGAP. Your account has been successfully created and is currently awaiting verification by your assigned Barangay Health Worker. You will receive an email notification once your account has been reviewed and approved. Until then, access to system features will remain limited.
            </p>
          </div>

          <div className="px-8 py-6 space-y-5">
            {/* Status card */}
            <div className="flex items-center justify-between bg-brand-yellow/10 border border-brand-yellow/20 rounded-card px-5 py-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
                <div>
                  <p className="text-xs text-brand-gray">Account Status</p>
                  <p className="text-sm font-heading font-semibold text-[#B07E00]">Pending Verification</p>
                </div>
              </div>
              <span className="text-xs font-stat font-bold text-brand-gray">Step 2 of 5</span>
            </div>

            {/* Verification progress */}
            <div>
              <p className="text-xs font-medium text-brand-gray uppercase tracking-wide mb-3">Verification Progress</p>
              <div className="space-y-3">
                {STEPS.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      s.done ? "bg-brand-green/15" : s.current ? "bg-brand-yellow/20" : "bg-brand-bg border border-brand-border"
                    }`}>
                      {s.done
                        ? <CheckCircle2 className="w-4 h-4 text-brand-green" strokeWidth={2.5} />
                        : s.current
                          ? <Clock className="w-4 h-4 text-brand-yellow" strokeWidth={2} />
                          : <span className="w-2 h-2 rounded-full bg-brand-border" />}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${s.done || s.current ? "text-brand-ink" : "text-brand-gray"}`}>{s.label}</p>
                      <p className="text-xs text-brand-gray">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: MapPin, label: "Assigned Barangay", value: "San Jose" },
                { icon: FileText, label: "Reference Number", value: "KSG-2026-00428" },
                { icon: Calendar, label: "Submission Date", value: "July 6, 2026" },
                { icon: Clock, label: "Estimated Review", value: "1-3 business days" },
              ].map((item) => (
                <div key={item.label} className="bg-brand-bg rounded-btn p-3.5">
                  <div className="flex items-center gap-1.5">
                    <item.icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">{item.label}</p>
                  </div>
                  <p className="text-sm font-medium text-brand-ink mt-1">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-2.5 pt-1">
              <Link to="/login" className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white py-3.5 rounded-btn font-medium hover:bg-brand-dark transition-colors shadow-soft">
                Return to Login <ArrowRight className="w-4 h-4" />
              </Link>
              <button className="w-full flex items-center justify-center gap-2 border border-brand-border bg-white text-brand-gray py-3 rounded-btn font-medium hover:bg-brand-bg transition-colors text-sm">
                <Download className="w-4 h-4" /> Download Registration Summary
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}