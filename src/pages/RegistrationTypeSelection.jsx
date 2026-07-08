import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { FileText, UserPlus, ArrowRight } from "lucide-react";
import { LOGO_URL } from "@/lib/brand";

export default function RegistrationTypeSelection() {
  return (
    <div className="w-full bg-gradient-to-br from-brand-bg via-brand-blue/5 to-brand-yellow/3 p-4 md:p-6">
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-brand-blue/8 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-brand-green/8 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
      <div className="absolute top-1/2 right-1/4 w-96 h-96 bg-brand-yellow/8 rounded-full blur-2xl" />
      
      <div className="relative flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-8">
            <img src={LOGO_URL} alt="KALUSAGAP" className="h-16 w-auto mx-auto mb-6" />
            <h1 className="text-3xl md:text-4xl font-semibold text-brand-ink tracking-tight">
              Create an Account
            </h1>
            <p className="mt-2 text-base text-brand-gray">
              Choose your registration type to get started.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* New Resident Registration Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-white rounded-[24px] border border-brand-border shadow-float p-8 hover:shadow-lg transition-shadow"
          >
            <div className="w-12 h-12 rounded-xl bg-brand-blue/10 flex items-center justify-center mb-4">
              <UserPlus className="w-6 h-6 text-brand-blue" strokeWidth={1.8} />
            </div>
            <h2 className="text-lg md:text-xl font-semibold text-brand-ink mb-2">
              New Resident Registration
            </h2>
            <p className="text-sm text-brand-gray mb-4 leading-relaxed">
              Register as a new resident in your barangay.
              <br />
              Complete a 4-step registration form.
            </p>
            <Link
              to="/register/new/step-1"
              className="inline-flex items-center gap-2 text-brand-blue font-medium hover:text-brand-dark transition-colors"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>

          {/* Transfer Registration Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-white rounded-[24px] border border-brand-border shadow-float p-8 hover:shadow-lg transition-shadow"
          >
            <div className="w-12 h-12 rounded-xl bg-brand-green/10 flex items-center justify-center mb-4">
              <FileText className="w-6 h-6 text-brand-green" strokeWidth={1.8} />
            </div>
            <h2 className="text-lg md:text-xl font-semibold text-brand-ink mb-2">
              Transfer From Another Barangay
            </h2>
            <p className="text-sm text-brand-gray mb-4 leading-relaxed">
              Upload your health record from your previous barangay.
              <br />
              We will extract your information automatically.
            </p>
            <Link
              to="/register/transfer"
              className="inline-flex items-center gap-2 text-brand-blue font-medium hover:text-brand-dark transition-colors"
            >
              Upload Document <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>

        <p className="text-center text-sm text-brand-gray">
          Already have an account?{" "}
          <Link to="/login" className="text-brand-blue font-medium hover:underline">
            Login
          </Link>
        </p>
        </div>
      </div>
    </div>
  );
}
