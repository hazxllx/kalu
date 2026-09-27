import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";

import {
  RegistrationShell,
  RegistrationCard,
  PageHeading,
  Field,
  inputCls,
  InfoNote,
  btnPrimary,
} from "@/features/registration/components/RegistrationDesign";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** Basic email shape check (mirrors the registration form's inline rule). */
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

/**
 * Forgot Password — request a Supabase Auth password-reset email.
 *
 * Uses the shared browser Supabase client (public anon key only) and
 * `resetPasswordForEmail`, pointing the recovery link back to the app's own
 * `/reset-password` route via `window.location.origin` (works for localhost and
 * any deployed origin — no hardcoded URL). The success state is intentionally
 * generic so it never reveals whether an account exists.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // guard against duplicate submissions while processing
    setError("");

    if (!email.trim()) {
      setError("Please enter your registered email address.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError("Password reset is unavailable: authentication is not configured. Contact the system administrator.");
      return;
    }

    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Supabase does not disclose whether the address exists; a returned error
      // here is a real failure (rate limit, network). Show a friendly, generic
      // error and never confirm/deny account existence.
      if (resetError) {
        const msg = String(resetError.message || "").toLowerCase();
        if (msg.includes("rate") || msg.includes("too many")) {
          setError("Too many requests. Please wait a moment before trying again.");
        } else {
          setError("We couldn't send the reset link right now. Please try again in a moment.");
        }
        return;
      }
      setSent(true);
    } catch {
      setError("We couldn't send the reset link right now. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <RegistrationShell
      footer={
        <p className="mt-5 text-center text-[12.5px] text-white/70">
          Remembered your password?{" "}
          <Link to="/login" className="font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white">
            Back to Login
          </Link>
        </p>
      }
    >
      <RegistrationCard>
        <div className="px-5 py-7 sm:px-10 sm:py-9">
          {sent ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
              className="text-center"
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10 ring-8 ring-brand-green/5">
                <CheckCircle2 className="h-8 w-8 text-brand-green" strokeWidth={1.8} />
              </div>
              <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">Reset link sent</h1>
              <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-brand-gold" aria-hidden="true" />
              <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-slate-500">
                If an account exists for this email address, a password reset link has been sent.
                Please check your inbox and follow the link to set a new password.
              </p>
              <div className="mt-7">
                <Link to="/login" className={btnPrimary}>
                  <ArrowLeft className="h-4 w-4" /> Back to Login
                </Link>
              </div>
            </motion.div>
          ) : (
            <>
              <PageHeading
                title="Forgot Password?"
                subtitle="Enter your registered email address and we'll send you a link to reset your password."
              />

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                {error && (
                  <InfoNote tone="danger" icon={AlertTriangle}>
                    {error}
                  </InfoNote>
                )}

                <Field
                  label="Email Address"
                  required
                  trailing={
                    <Mail className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  }
                >
                  <input
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="name@example.gov.ph"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (error) setError(""); }}
                    className={`${inputCls()} pr-11`}
                  />
                </Field>

                <button type="submit" disabled={loading} className={`${btnPrimary} w-full`}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </button>

                <p className="text-center">
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-blue underline decoration-brand-rule underline-offset-4 transition-colors hover:decoration-brand-blue"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to Login
                  </Link>
                </p>
              </form>
            </>
          )}
        </div>
      </RegistrationCard>
    </RegistrationShell>
  );
}
