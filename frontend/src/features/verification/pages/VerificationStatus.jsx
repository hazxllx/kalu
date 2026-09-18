import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn } from "lucide-react";

import { LOGO_URL } from "@/lib/brand";
import { useAuth } from "@/context/AuthContext";
import { ROLE } from "@/lib/roles";
import VerificationBanner from "@/features/verification/components/VerificationBanner";

/**
 * Standalone verification status page (shown after registration).
 *
 * When the visitor is signed in, the real status is read from the backend and
 * rendered by `VerificationBanner`. Otherwise they are asked to sign in.
 * Nothing here can change the verification result.
 */
export default function VerificationStatus() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();

  const dashboardPath =
    user?.role === ROLE.RESIDENT
      ? "/app/resident/verification"
      : user?.role === ROLE.RESIDENT_LIMITED
        ? "/app/resident-limited/verification"
        : "/login";

  if (isLoadingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[color:#f5f7fa] p-6">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:#f5f7fa] p-6 md:p-10">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl">
        <img src={LOGO_URL} alt="KALUSAGAP" className="mx-auto mb-8 h-10 w-auto" />

        <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-card md:p-8">
          <h1 className="text-center text-2xl font-semibold text-slate-900">Verification status</h1>
          <p className="mt-3 text-center text-sm text-slate-600">
            Residence registration is reviewed manually by the Health Supervisor of your barangay.
          </p>

          <div className="mt-6">
            {isAuthenticated ? (
              <VerificationBanner />
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 text-center">
                <p className="text-sm text-slate-700">
                  Your registration is pending review. Sign in to see your current status.
                </p>
              </div>
            )}
          </div>

          <div className="mt-7 space-y-2.5">
            {isAuthenticated ? (
              <Link
                to={dashboardPath}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-blue py-3.5 font-medium text-white shadow-card transition-colors hover:bg-brand-dark"
              >
                Go to my verification status
              </Link>
            ) : (
              <Link
                to="/login"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-blue py-3.5 font-medium text-white shadow-card transition-colors hover:bg-brand-dark"
              >
                <LogIn className="h-4 w-4" /> Proceed to Sign In
              </Link>
            )}
            <Link
              to="/"
              className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Return to portal home
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
