import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Clock, ShieldCheck } from "lucide-react";

const TIMELINE = [
  { label: "Registration Submitted", desc: "Your registration was received.", status: "done" },
  { label: "Profile Completed", desc: "All required fields filled.", status: "done" },
  { label: "Identity Uploaded", desc: "ID documents uploaded.", status: "done" },
  { label: "Barangay Health Worker Review", desc: "Awaiting review by assigned BHW.", status: "current" },
  { label: "Verified", desc: "Account approved and activated.", status: "pending" },
];

export default function VerificationModal({ open, onClose, data = {} }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-card shadow-float w-full max-w-lg max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-brand-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-yellow/15 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold text-brand-ink">Verification Status</h3>
                    <p className="text-xs text-brand-gray">Track your registration progress</p>
                  </div>
                </div>
                <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-brand-bg flex items-center justify-center text-brand-gray">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5">
                {/* Info grid */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {[
                    { label: "Reference Number", value: data.reference || "KSG-2026-00428" },
                    { label: "Assigned Barangay", value: data.barangay || "San Jose" },
                    { label: "Submission Date", value: data.submitted || "July 5, 2026" },
                    { label: "Estimated Review", value: data.estimated || "2-3 business days" },
                  ].map((item) => (
                    <div key={item.label} className="bg-brand-bg rounded-btn p-3">
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">{item.label}</p>
                      <p className="text-sm font-medium text-brand-ink mt-0.5">{item.value}</p>
                    </div>
                  ))}
                </div>

                {/* Timeline */}
                <div className="relative pl-7">
                  <div className="absolute left-[10px] top-2 bottom-2 w-px bg-brand-border" />
                  {TIMELINE.map((step, i) => {
                    const icon = step.status === "done"
                      ? <CheckCircle2 className="w-5 h-5 text-brand-green" strokeWidth={2} />
                      : step.status === "current"
                        ? <Clock className="w-5 h-5 text-brand-yellow" strokeWidth={2} />
                        : <div className="w-5 h-5 rounded-full border-2 border-brand-border" />;
                    return (
                      <div key={i} className="relative pb-6 last:pb-0">
                        <span className="absolute -left-7 top-0 bg-white ring-4 ring-white rounded-full">{icon}</span>
                        <p className={`text-sm font-medium ${step.status === "pending" ? "text-brand-gray" : "text-brand-ink"}`}>{step.label}</p>
                        <p className="text-xs text-brand-gray mt-0.5">{step.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-brand-border flex justify-end">
                <button onClick={onClose} className="bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors">
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}