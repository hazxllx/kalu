import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

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
import { validatePassword } from "@/utils/validation";

/**
 * Reset Password — set a new password from a Supabase recovery link.
 *
 * The recovery email links back to this route with a recovery token in the URL
 * hash. The shared Supabase client is configured with `detectSessionInUrl`, so
 * it parses that hash and fires a `PASSWORD_RECOVERY` auth event, establishing
 * a short-lived recovery session. This page waits for that session before
 * allowing a password change, applies the new password with
 * `supabase.auth.updateUser`, then signs out so the recovery session never
 * leaks into the authenticated app — the user logs in again with the new
 * password. No custom token system is used.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  // checking → waiting for the recovery session; ready → session present;
  // invalid → no/expired recovery session; done → password updated.
  const [status, setStatus] = useState("checking");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus("invalid");
      return undefined;
    }
    let active = true;
    let timer;

    // A recovery link that is expired, already used or otherwise rejected by
    // Supabase redirects back with the error in the URL (implicit flow uses the
    // hash, PKCE uses the query string) instead of a session, e.g.
    //   #error=access_denied&error_code=otp_expired&error_description=...
    // Detect that immediately so the user gets the correct message rather than
    // waiting for the generic timeout.
    const readUrlError = () => {
      const parse = (str) => new URLSearchParams(str.startsWith("#") || str.startsWith("?") ? str.slice(1) : str);
      const hashParams = parse(window.location.hash || "");
      const queryParams = parse(window.location.search || "");
      return (
        hashParams.get("error_code") ||
        hashParams.get("error") ||
        queryParams.get("error_code") ||
        queryParams.get("error") ||
        null
      );
    };

    if (readUrlError()) {
      setStatus("invalid");
      return undefined;
    }

    const markReady = () => {
      if (!active) return;
      setStatus((s) => (s === "done" ? s : "ready"));
    };

    // The PASSWORD_RECOVERY event fires once the recovery link's hash is parsed.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) markReady();
    });

    // The event may have already fired before this listener attached; check the
    // current session directly. If none is present yet, allow a brief window for
    // `detectSessionInUrl` to process the hash before declaring the link invalid.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data?.session) markReady();
      else {
        timer = setTimeout(() => {
          if (active) setStatus((s) => (s === "checking" ? "invalid" : s));
        }, 1600);
      }
    });

    return () => {
      active = false;
      sub?.subscription?.unsubscribe?.();
      clearTimeout(timer);
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");

    if (!newPassword || !confirmPassword) {
      setError("Please fill in both password fields.");
      return;
    }
    const policyError = validatePassword(newPassword, { label: "Password" });
    if (policyError) {
      setError(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!supabase) {
      setError("Password reset is unavailable: authentication is not configured.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        const msg = String(updateError.message || "").toLowerCase();
        if (msg.includes("session") || msg.includes("expired") || msg.includes("jwt")) {
          setStatus("invalid");
        } else if (msg.includes("different") || msg.includes("same")) {
          setError("Your new password must be different from your current password.");
        } else if (msg.includes("rate") || msg.includes("too many")) {
          setError("Too many attempts. Please wait a moment and try again.");
        } else {
          setError("We couldn't update your password. Please try again.");
        }
        return;
      }
      setStatus("done");
      // Clear the recovery session so the user is not left signed in via the
      // recovery link; they must log in again with their new password.
      await supabase.auth.signOut();
    } catch {
      setError("We couldn't update your password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------ checking ------------------------------- */
  if (status === "checking") {
    return (
      <RegistrationShell footer={null}>
        <RegistrationCard>
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-blue" />
            <p className="mt-4 text-[13px] text-slate-500">Verifying your reset link…</p>
          </div>
        </RegistrationCard>
      </RegistrationShell>
    );
  }

  /* --------------------------- invalid / expired -------------------------- */
  if (status === "invalid") {
    return (
      <RegistrationShell
        footer={
          <p className="mt-5 text-center text-[12.5px] text-white/70">
            <Link to="/login" className="font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white">
              Back to Login
            </Link>
          </p>
        }
      >
        <RegistrationCard>
          <div className="px-6 py-10 text-center sm:px-12 sm:py-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-danger/10 ring-8 ring-brand-danger/5">
              <AlertTriangle className="h-8 w-8 text-brand-danger" strokeWidth={1.8} />
            </div>
            <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">Invalid or expired password reset link.</h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-brand-gold" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-slate-500">
              This password reset link is missing, invalid, or has expired. Please request a new
              reset link and try again.
            </p>
            <div className="mt-7">
              <Link to="/forgot-password" className={btnPrimary}>
                Request a new reset link
              </Link>
            </div>
          </div>
        </RegistrationCard>
      </RegistrationShell>
    );
  }

  /* -------------------------------- done --------------------------------- */
  if (status === "done") {
    return (
      <RegistrationShell footer={null}>
        <RegistrationCard>
          <div className="px-6 py-10 text-center sm:px-12 sm:py-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10 ring-8 ring-brand-green/5">
              <CheckCircle2 className="h-8 w-8 text-brand-green" strokeWidth={1.8} />
            </div>
            <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">Password Updated Successfully</h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-brand-gold" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-slate-500">
              Your password has been changed successfully. You can now log in using your new password.
            </p>
            <div className="mt-7">
              <button type="button" onClick={() => navigate("/login")} className={btnPrimary}>
                <ArrowLeft className="h-4 w-4" /> Back to Login
              </button>
            </div>
          </div>
        </RegistrationCard>
      </RegistrationShell>
    );
  }

  /* ------------------------------- form ---------------------------------- */
  const eyeButton = (shown, toggle) => (
    <button
      type="button"
      onClick={toggle}
      aria-label={shown ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-ink"
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  return (
    <RegistrationShell
      footer={
        <p className="mt-5 text-center text-[12.5px] text-white/70">
          <Link to="/login" className="font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white">
            Back to Login
          </Link>
        </p>
      }
    >
      <RegistrationCard>
        <div className="px-5 py-7 sm:px-10 sm:py-9">
          <PageHeading
            title="Create New Password"
            subtitle="Enter and confirm your new password below."
          />

          <form onSubmit={submit} className="mt-6 space-y-5">
            {error && (
              <InfoNote tone="danger" icon={AlertTriangle}>
                {error}
              </InfoNote>
            )}

            <Field label="New Password" required trailing={eyeButton(showNew, () => setShowNew((v) => !v))}>
              <input
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                autoFocus
                placeholder="Create a new password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); if (error) setError(""); }}
                className={`${inputCls()} pr-12`}
              />
            </Field>

            <Field
              label="Confirm New Password"
              required
              hint="Minimum 8 characters, with an uppercase letter, a lowercase letter, and a number."
              trailing={eyeButton(showConfirm, () => setShowConfirm((v) => !v))}
            >
              <input
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(""); }}
                className={`${inputCls()} pr-12`}
              />
            </Field>

            <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating...
                </>
              ) : (
                "Update Password"
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
        </div>
      </RegistrationCard>
    </RegistrationShell>
  );
}
