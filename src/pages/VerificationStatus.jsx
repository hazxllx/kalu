import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldAlert, RefreshCw, LifeBuoy, MapPin, FileText, Calendar, Clock } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center bg-[color:#f5f7fa] p-6 md:p-10">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-lg">
        <img src={LOGO_URL} alt="KALUSAGAP" className="mx-auto mb-8 h-10 w-auto" />

        <div className="rounded-[24px] border border-slate-200 bg-white p-8 shadow-card md:p-10">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <ShieldAlert className="h-8 w-8 text-amber-700" strokeWidth={1.8} />
          </div>
          <h1 className="mt-5 text-center text-2xl font-semibold text-slate-900">Account Pending Verification</h1>
          <p className="mt-3 text-center text-sm text-slate-600">
            Your registration is currently under review by your assigned Barangay Health Worker.
            You will receive an email notification once your account has been approved.
          </p>

          <div className="mt-6 flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-700" strokeWidth={1.8} />
              <div>
                <p className="text-xs text-slate-600">Account Status</p>
                <p className="text-sm font-semibold text-amber-700">Pending Verification</p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              { icon: Calendar, label: "Registration Date", value: "July 5, 2026" },
              { icon: MapPin, label: "Assigned Barangay", value: "San Jose" },
              { icon: FileText, label: "Reference Number", value: "KSG-2026-00428" },
              { icon: Clock, label: "Estimated Review", value: "2-3 business days" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-center gap-1.5">
                  <item.icon className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.8} />
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-800">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-7 space-y-2.5">
            <button onClick={refresh} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-blue py-3.5 font-medium text-white transition-colors hover:bg-brand-dark shadow-card disabled:opacity-60" disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Checking status..." : "Refresh Status"}
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <Link to="/login" className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50">
                Return to Login
              </Link>
              <button className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50">
                <LifeBuoy className="h-4 w-4" /> Contact Support
              </button>
            </div>
            <button onClick={() => setModalOpen(true)} className="w-full pt-2 text-center text-xs font-medium text-brand-blue hover:underline">
              View Detailed Verification Status
            </button>
          </div>
        </div>
      </motion.div>

      <VerificationModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}