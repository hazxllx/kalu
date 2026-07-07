import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldAlert, RefreshCw, LogOut, LifeBuoy, MapPin, FileText, Calendar, Clock } from "lucide-react";
import { LOGO_URL } from "@/lib/brand";
import VerificationModal from "@/components/shared/VerificationModal";

export default function VerificationStatus() {
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6 md:p-10">
      <div className="absolute top-0 left-0 w-96 h-96 bg-brand-yellow/5 rounded-full blur-3xl -translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-blue/5 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg"
      >
        <img src={LOGO_URL} alt="KALUSAGAP" className="h-10 w-auto mx-auto mb-8" />

        <div className="bg-white rounded-card border border-brand-border shadow-float p-8 md:p-10">
          <div className="w-16 h-16 rounded-full bg-brand-yellow/15 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8 text-[#B07E00]" strokeWidth={1.8} />
          </div>
          <h1 className="mt-5 text-2xl font-heading font-semibold text-brand-ink text-center">Account Pending Verification</h1>
          <p className="mt-3 text-sm text-brand-gray text-center">
            Your registration is currently under review by your assigned Barangay Health Worker.
            You will receive an email notification once your account has been approved.
          </p>

          {/* Status card */}
          <div className="mt-6 flex items-center justify-between bg-brand-yellow/10 border border-brand-yellow/20 rounded-card px-5 py-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
              <div>
                <p className="text-xs text-brand-gray">Account Status</p>
                <p className="text-sm font-heading font-semibold text-[#B07E00]">Pending Verification</p>
              </div>
            </div>
          </div>

          {/* Info grid */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              { icon: Calendar, label: "Registration Date", value: "July 5, 2026" },
              { icon: MapPin, label: "Assigned Barangay", value: "San Jose" },
              { icon: FileText, label: "Reference Number", value: "KSG-2026-00428" },
              { icon: Clock, label: "Estimated Review", value: "2-3 business days" },
            ].map((item) => (
              <div key={item.label} className="bg-brand-bg rounded-btn p-3">
                <div className="flex items-center gap-1.5">
                  <item.icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">{item.label}</p>
                </div>
                <p className="text-sm font-medium text-brand-ink mt-1">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="mt-7 space-y-2.5">
            <button onClick={refresh} className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white py-3.5 rounded-btn font-medium hover:bg-brand-dark transition-colors shadow-soft disabled:opacity-60" disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Checking status..." : "Refresh Status"}
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <Link to="/login" className="flex items-center justify-center gap-2 border border-brand-border bg-white text-brand-gray py-3 rounded-btn font-medium hover:bg-brand-bg transition-colors text-sm">
                Return to Login
              </Link>
              <button className="flex items-center justify-center gap-2 border border-brand-border bg-white text-brand-gray py-3 rounded-btn font-medium hover:bg-brand-bg transition-colors text-sm">
                <LifeBuoy className="w-4 h-4" /> Contact Support
              </button>
            </div>
            <button onClick={() => setModalOpen(true)} className="w-full text-center text-xs text-brand-blue font-medium hover:underline pt-2">
              View Detailed Verification Status
            </button>
          </div>
        </div>
      </motion.div>

      <VerificationModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}