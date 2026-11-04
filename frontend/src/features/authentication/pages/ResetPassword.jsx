import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { authApi, registrationApi } from "@/services/api";
import { validatePassword } from "@/utils/validation";
import { isManagedPersonnelSession, resolvePasswordSetup, saveResetPassword, passwordWasSaved, personnelSetupBlocked, personnelPasswordError } from "../personnelPasswordSetup";

/**
 * Password reset and personnel invitation setup share this protected route.
 *
 * The recovery email links back to this route with a recovery token in the URL
 * hash. The shared Supabase client is configured with `detectSessionInUrl`, so
 * it parses that hash and fires a `PASSWORD_RECOVERY` auth event, establishing
 * a short-lived recovery session. This page waits for that session before saving.
 * Personnel setup must save the password and finalize the verified caller's
 * lifecycle on the server. Ordinary resets retain Supabase's updateUser flow.
 * Sign out only after the relevant flow confirms success.
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
  const [setupStatus, setSetupStatus] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [partialSaved, setPartialSaved] = useState(false);
  const sessionRef = useRef(null);
  const inspectedToken = useRef(null);
  const setupSequence = useRef(0);
  const setupRequiredRef = useRef(false);
  const submittingRef = useRef(false);
  const finishedRef = useRef(false);

  const inspectSession = useCallback(async (session, force = false) => {
    if (finishedRef.current || submittingRef.current) return;
    if (!force && inspectedToken.current === session?.access_token) return;
    const sequence = ++setupSequence.current;
    inspectedToken.current = session?.access_token;
    if (session?.user?.id !== sessionRef.current?.user?.id) setupRequiredRef.current = false;
    sessionRef.current = session;
    setStatus("checking");
    setError("");
    try {
      const result = await resolvePasswordSetup(session, authApi.personnelSetupStatus, { knownRequired: setupRequiredRef.current });
      if (sequence !== setupSequence.current || finishedRef.current) return;
      setSetupStatus(result);
      setupRequiredRef.current = result.setupRequired;
      setStatus(personnelSetupBlocked(result) ? "setup_blocked" : "ready");
    } catch (failure) {
      if (sequence !== setupSequence.current || finishedRef.current) return;
      if ([401, 403].includes(failure?.status)) setStatus("invalid");
      else {
        setStatus("setup_error");
        setError("We could not verify your account's password-setup requirements. Setup cannot continue safely until the server confirms approval and activation. Try checking again.");
      }
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus("invalid");
      return undefined;
    }
    let active = true;
    let timer;
    let sessionTimer;
    inspectedToken.current = null;

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

    // The PASSWORD_RECOVERY event fires once the recovery link's hash is parsed.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || submittingRef.current || finishedRef.current) return;
      if (session) {
        clearTimeout(timer);
        clearTimeout(sessionTimer);
        // Leave the Auth callback before making an API call that reads its session.
        sessionTimer = setTimeout(() => { if (active) void inspectSession(session); }, 0);
      } else if (event === "SIGNED_OUT") {
        sessionRef.current = null;
        setupRequiredRef.current = false;
        setupSequence.current += 1;
        setStatus("invalid");
      }
    });

    // The event may have already fired before this listener attached; check the
    // current session directly. If none is present yet, allow a brief window for
    // `detectSessionInUrl` to process the hash before declaring the link invalid.
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setStatus("invalid");
      else if (data?.session) void inspectSession(data.session);
      else {
        timer = setTimeout(() => {
          if (active) setStatus((s) => (s === "checking" ? "invalid" : s));
        }, 1600);
      }
    }).catch(() => { if (active) setStatus("invalid"); });

    return () => {
      active = false;
      sub?.subscription?.unsubscribe?.();
      clearTimeout(timer);
      clearTimeout(sessionTimer);
      setupSequence.current += 1;
    };
  }, [inspectSession]);

  const submit = async (e) => {
    e.preventDefault();
    if (submittingRef.current || status !== "ready") return;
    setError("");

    if (!newPassword || !confirmPassword) {
      setError("Please fill in both password fields.");
      return;
    }
    const policyError = setupStatus?.setupRequired ? personnelPasswordError(newPassword) : validatePassword(newPassword, { label: "Password" });
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
    submittingRef.current = true;
    let saving = false;
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const session = data?.session;
      if (!session?.user?.id || session.user.id !== sessionRef.current?.user?.id) {
        setStatus("invalid");
        return;
      }
      // Re-check requirements before mutation, including after a token refresh.
      const verifiedSetup = await resolvePasswordSetup(session, authApi.personnelSetupStatus, { knownRequired: setupRequiredRef.current });
      setSetupStatus(verifiedSetup);
      setupRequiredRef.current = verifiedSetup.setupRequired;
      if (personnelSetupBlocked(verifiedSetup)) {
        setStatus("setup_blocked");
        return;
      }
      saving = true;
      const outcome = await saveResetPassword({
        session,
        password: newPassword,
        setupStatus: verifiedSetup,
        passwordPreviouslySaved: partialSaved,
        auth: supabase.auth,
        personnelSetup: authApi.personnelPasswordSetup,
        activateResident: registrationApi.activate,
      });
      finishedRef.current = true;
      setCompletion(outcome);
      setPartialSaved(false);
      setNewPassword("");
      setConfirmPassword("");
      setStatus("done");
      try {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
      } catch {
        setError("Your password was saved, but automatic sign-out could not be confirmed. Close this reset session before signing in again.");
      }
    } catch (failure) {
      const msg = String(failure?.message || "").toLowerCase();
      if (passwordWasSaved(failure)) {
        setPartialSaved(true);
        setError(`Your password was saved, but account setup or activation is incomplete. ${failure?.message || "The server could not confirm finalization."} You may retry account setup; do not assume sign-in is enabled.`);
      } else if ([401, 403].includes(failure?.status) || msg.includes("session") || msg.includes("expired") || msg.includes("jwt")) {
        setStatus("invalid");
      } else if (!saving && isManagedPersonnelSession(sessionRef.current)) {
        setStatus("setup_error");
        setError("We could not verify account setup with the server. No additional password change was attempted; account setup remains unconfirmed. Check again when the service is available.");
      } else if (msg.includes("different") || msg.includes("same")) {
        setError("Your new password must be different from your current password.");
      } else if (msg.includes("rate") || msg.includes("too many")) {
        setError("Too many attempts. Please wait a moment and try again.");
      } else {
        setError(failure?.message || "We couldn't update your password. Please try again.");
      }
    } finally {
      submittingRef.current = false;
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
            <p className="mt-4 text-[13px] text-slate-500">Verifying your link and account setup...</p>
          </div>
        </RegistrationCard>
      </RegistrationShell>
    );
  }

  if (status === "setup_blocked") {
    return <RegistrationShell footer={null}>
      <RegistrationCard>
        <div className="px-6 py-10 text-center sm:px-12 sm:py-12">
          <AlertTriangle className="mx-auto h-10 w-10 text-brand-danger" />
          <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">{setupStatus?.suspended ? "Account Access Is Suspended" : setupStatus?.approvalStatus === "rejected" ? "Account Approval Was Rejected" : "Account Approval Is Pending"}</h1>
          <p role="status" className="mt-4 text-[13px] leading-relaxed text-slate-500">Password setup cannot continue while this account is suspended or unapproved. No password is changed by checking this link. An administrator must review your account before setup or sign-in can proceed.</p>
          <button type="button" onClick={() => { if (sessionRef.current) void inspectSession(sessionRef.current, true); }} className={`${btnPrimary} mt-6`}>Check account status again</button>
          <p className="mt-4"><Link to="/login" className="text-sm font-semibold text-brand-blue underline">Back to Login</Link></p>
        </div>
      </RegistrationCard>
    </RegistrationShell>;
  }

  if (status === "setup_error") {
    return <RegistrationShell footer={null}>
      <RegistrationCard>
        <div className="px-6 py-10 text-center sm:px-12 sm:py-12">
          <AlertTriangle className="mx-auto h-10 w-10 text-brand-danger" />
          <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">Account Setup Could Not Be Verified</h1>
          <p role="alert" className="mt-4 text-[13px] leading-relaxed text-slate-500">{error}</p>
          <button type="button" onClick={() => { if (sessionRef.current) void inspectSession(sessionRef.current, true); }} className={`${btnPrimary} mt-6`}>Check account setup again</button>
          <p className="mt-4"><Link to="/login" className="text-sm font-semibold text-brand-blue underline">Back to Login</Link></p>
        </div>
      </RegistrationCard>
    </RegistrationShell>;
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
            <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">{completion?.title}</h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-brand-gold" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-slate-500">
              {completion?.message}
            </p>
            {error && <div className="mt-4"><InfoNote tone="danger" icon={AlertTriangle}>{error}</InfoNote></div>}
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
      disabled={submitting}
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
            title={setupStatus?.setupRequired ? "Complete Account Password Setup" : "Create New Password"}
            subtitle={setupStatus?.setupRequired ? "Set your own password. Sign-in will be enabled only when approval, setup, and administrator activation are confirmed." : "Enter and confirm your new password below."}
          />

          <form onSubmit={submit} className="mt-6 space-y-5">
            {setupStatus?.setupRequired && <InfoNote>{setupStatus.activationRequested === false ? "Your approved account will remain inactive after password setup until an administrator authorizes activation." : "Saving a password alone does not activate your account. The server must confirm that account setup is complete."}</InfoNote>}
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
                disabled={submitting}
                onChange={(e) => { setNewPassword(e.target.value); setPartialSaved(false); if (error) setError(""); }}
                className={`${inputCls()} pr-12`}
              />
            </Field>

            <Field
              label="Confirm New Password"
              required
              hint={setupStatus?.setupRequired ? "8 to 200 characters, with uppercase, lowercase, a number, and a non-whitespace special character." : "Minimum 8 characters, with an uppercase letter, a lowercase letter, and a number."}
              trailing={eyeButton(showConfirm, () => setShowConfirm((v) => !v))}
            >
              <input
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                disabled={submitting}
                onChange={(e) => { setConfirmPassword(e.target.value); setPartialSaved(false); if (error) setError(""); }}
                className={`${inputCls()} pr-12`}
              />
            </Field>

            <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating...
                </>
              ) : (
                 partialSaved ? "Retry Account Setup" : setupStatus?.setupRequired ? "Save Password and Complete Setup" : "Update Password"
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
