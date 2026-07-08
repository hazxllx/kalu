import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, ShieldCheck, LogIn } from "lucide-react";
import { LOGO_URL } from "@/lib/brand";

export default function RegistrationSuccess() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6 md:p-10">
      <div className="absolute top-0 left-0 w-96 h-96 bg-brand-green/5 rounded-full blur-3xl -translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-blue/5 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-lg">
        <img src={LOGO_URL} alt="KALUSAGAP" className="h-16 w-auto mx-auto mb-8" />

        <div className="bg-white rounded-card border border-brand-border shadow-float overflow-hidden">
          <div className="bg-gradient-to-br from-brand-green/10 to-brand-blue/5 px-8 py-10 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="w-16 h-16 rounded-full bg-brand-green/15 flex items-center justify-center mx-auto"
            >
              <CheckCircle2 className="w-8 h-8 text-brand-green" strokeWidth={2} />
            </motion.div>
            <h1 className="mt-5 text-2xl font-heading font-semibold text-brand-ink">Registration Submitted</h1>
            <p className="mt-3 text-sm text-brand-gray max-w-md mx-auto">
              Your registration has been submitted successfully. Your assigned Barangay Health Worker will review your information before your account receives full access.
            </p>
          </div>

          <div className="px-8 py-6 space-y-5">
            <div className="flex items-center justify-between bg-brand-yellow/10 border border-brand-yellow/20 rounded-card px-5 py-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
                <div>
                  <p className="text-xs text-brand-gray">Account Status</p>
                  <p className="text-sm font-heading font-semibold text-[#B07E00]">Pending Verification</p>
                </div>
              </div>
            </div>

            <div className="bg-brand-bg rounded-card p-4">
              <p className="text-xs font-body text-brand-gray">
                You can now log in using your email and password. A limited resident account will be available while your registration is under review. Some healthcare features will remain locked until verification is complete.
              </p>
            </div>

            <div className="space-y-2.5">
              <Link to="/login" className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white py-3.5 rounded-btn font-medium hover:bg-brand-dark transition-colors shadow-soft">
                <LogIn className="w-4 h-4" /> Proceed to Login
              </Link>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}