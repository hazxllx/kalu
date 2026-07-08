import React, { useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, RefreshCw, MapPin, FileText, Calendar, Clock } from "lucide-react";

export default function VerificationBanner() {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  };

  const details = [
    { icon: ShieldAlert, label: "Verification Status", value: "Pending Verification" },
    { icon: MapPin, label: "Assigned Barangay", value: "San Jose" },
    { icon: Calendar, label: "Registration Date", value: "July 5, 2026" },
    { icon: Clock, label: "Estimated Review", value: "1-3 business days" },
    { icon: FileText, label: "Reference Number", value: "KSG-2026-00428" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-card border border-brand-yellow/30 shadow-card overflow-hidden"
    >
      <div className="bg-brand-yellow/10 border-b border-brand-yellow/20 px-6 py-5 flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-brand-yellow/20 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <h3 className="font-heading font-semibold text-brand-ink">Account Pending Verification</h3>
          <p className="mt-1 text-sm text-brand-gray">
            Your account is currently under review by your assigned Barangay Health Worker.
            Some healthcare features will become available after your account has been verified.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="shrink-0 flex items-center gap-2 bg-white border border-brand-border text-brand-gray px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.8} />
          {refreshing ? "Checking..." : "Refresh Status"}
        </button>
      </div>
      <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-5 gap-4">
        {details.map((d) => (
          <div key={d.label}>
            <div className="flex items-center gap-1.5">
              <d.icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />
              <p className="text-[11px] text-brand-gray uppercase tracking-wide">{d.label}</p>
            </div>
            <p className="mt-1 text-sm font-medium text-brand-ink">{d.value}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}