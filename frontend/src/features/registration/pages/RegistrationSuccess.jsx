import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, ShieldCheck, LogIn, Printer, ArrowLeft } from "lucide-react";
import { AgencyMark } from "@/components/branding/GovChrome";

export default function RegistrationSuccess() {
  const success = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('registrationSuccess');
      if (!raw) return null;
      sessionStorage.removeItem('registrationSuccess');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, []);

  const needsConfirmation = useMemo(() => {
    const flag = sessionStorage.getItem('registrationNeedsConfirmation') === '1';
    sessionStorage.removeItem('registrationNeedsConfirmation');
    return flag;
  }, []);

  const reference = success?.healthRecordNo || success?.residentId || '—';

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-2xl px-5 py-10 md:px-8 md:py-14">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <AgencyMark align="center" sealSize={44} />

          <div className="gov-sheet mt-7 bg-white">
            <div className="border-b border-brand-border bg-brand-paper px-8 py-6">
              <div className="flex items-center justify-between gap-4">
                <p className="gov-kicker text-brand-blue">Acknowledgment of Receipt</p>
                <span className="border border-brand-border bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-gov text-brand-gray">
                  Form A · 2026
                </span>
              </div>
              <p className="mt-2 font-display text-[20px] font-bold text-brand-dark">
                Application received and logged
              </p>
            </div>

            <div className="px-8 py-8">
              <div className="flex items-start gap-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-brand-green bg-brand-green/10">
                  <CheckCircle2 className="h-7 w-7 text-brand-green" strokeWidth={1.9} />
                </div>
                <div>
                  <h1 className="font-display text-[24px] font-bold leading-snug text-brand-dark">
                    Registration submitted
                  </h1>
                  <p className="mt-2 text-[13.5px] leading-[1.7] text-brand-gray">
                    Your application has been logged with the Municipal Health
                    Office. Your assigned Barangay Health Worker will review the
                    submitted information before full account access is granted.
                  </p>
                </div>
              </div>

              <dl className="mt-8 grid grid-cols-2 gap-px border border-brand-border bg-brand-border sm:grid-cols-4">
                {[
                  ["Reference No.", reference],
                  ["Type", "Form A"],
                  ["Status", "Pending"],
                  ["Office", "MHO · Pili"],
                  ...(success?.barangay ? [["Barangay", success.barangay]] : []),
                  ...(success?.name ? [["Name", success.name]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="bg-white px-4 py-4">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-gray">
                      {label}
                    </dt>
                    <dd className="mt-1.5 font-stat text-[13px] font-bold text-brand-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6 border-l-[3px] border-brand-gold bg-brand-goldpale px-5 py-4">
                <p className="flex items-center gap-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-brand-amber">
                  <ShieldCheck className="h-4 w-4" strokeWidth={2} />
                  Pending verification
                </p>
                {needsConfirmation ? (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-brand-ink/80">
                    Your account was created. Check your email inbox and confirm your address, then sign in. Once
                    signed in, open <strong>Verification Status</strong> to finish creating your resident record and
                    track the Health Supervisor's review.
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-brand-ink/80">
                    You may now sign in with a limited resident account. Your registration is pending review by the
                    Health Supervisor of your barangay; once approved, full access to health services is unlocked.
                  </p>
                )}
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <Link
                  to="/login"
                  className="flex items-center justify-center gap-2.5 bg-brand-blue py-3.5 text-[13px] font-bold uppercase tracking-[0.11em] text-white transition-colors hover:bg-brand-dark"
                >
                  <LogIn className="h-4 w-4" />
                  Proceed to Sign In
                </Link>
                <button
                  onClick={() => window.print()}
                  className="flex items-center justify-center gap-2.5 border border-brand-rule bg-white py-3.5 text-[13px] font-bold uppercase tracking-[0.11em] text-brand-dark transition-colors hover:border-brand-blue hover:text-brand-blue"
                >
                  <Printer className="h-4 w-4" />
                  Print Acknowledgment
                </button>
              </div>
            </div>

            <div className="border-t border-dashed border-brand-rule px-8 py-5">
              <p className="text-center font-stat text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gray/80">
                Keep this reference number for your follow-up inquiries
              </p>
            </div>
          </div>

          <p className="mt-6 text-center">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-[12px] font-medium text-brand-gray underline decoration-brand-rule underline-offset-4 transition-colors hover:text-brand-blue hover:decoration-brand-blue"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Return to portal home
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
