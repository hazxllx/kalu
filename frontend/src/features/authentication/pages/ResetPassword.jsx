import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

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
import { isEmail, validatePassword } from "@/utils/validation";
import { isManagedPersonnelSession, resolvePasswordSetup, saveResetPassword, passwordWasSaved, personnelSetupBlocked, personnelPasswordError } from "../personnelPasswordSetup";

const PERSONNEL_RECOVERY_STORAGE_KEY = "personnelPasswordRecoveryRetry";

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
  const [verifyingLink, setVerifyingLink] = useState(false);
  const [requestLinkEmail, setRequestLinkEmail] = useState("");
  const [requestLinkState, setRequestLinkState] = useState({ loading: false, success: "", error: "" });
  const sessionRef = useRef(null);
  const pendingVerifyRef = useRef(null);
  const recoveryProofRef = useRef(null);
  const partialRecoveryRef = useRef(null);
  const verifyingLinkRef = useRef(false);
  const inspectedToken = useRef(null);
  const verificationTypeRef = useRef(null);
  const setupSequence = useRef(0);
  const setupRequiredRef = useRef(false);
  const submittingRef = useRef(false);
  const finishedRef = useRef(false);

  const inspectSession = useCallback(async (session, force = false) => {
    if (finishedRef.current || submittingRef.current) return;
    if (!force && inspectedToken.current === session?.access_token && !partialRecoveryRef.current) return;
    const sequence = ++setupSequence.current;
    inspectedToken.current = session?.access_token;
    if (partialRecoveryRef.current) {
      if (session?.user?.id && session.user.id !== partialRecoveryRef.current.accountId) {
        try { sessionStorage.removeItem(PERSONNEL_RECOVERY_STORAGE_KEY); } catch { /* Optional storage. */ }
        partialRecoveryRef.current = null;
        recoveryProofRef.current = null;
      } else {
        const saved = partialRecoveryRef.current;
        recoveryProofRef.current = { accountId: saved.accountId, secret: saved.secret };
        sessionRef.current = session?.user?.id ? session : { user: { id: saved.accountId }, access_token: null };
        setSetupStatus(saved.setupStatus);
        setupRequiredRef.current = true;
        setPartialSaved(true);
        setStatus("ready");
        setError("Your password was saved but setup was not confirmed. Enter the same password again to finish securely.");
        return;
      }
    }
    if (session?.user?.id !== sessionRef.current?.user?.id) {
      setupRequiredRef.current = false;
      if (recoveryProofRef.current?.accountId !== session?.user?.id) recoveryProofRef.current = null;
    }
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
      if ([401, 403].includes(failure?.status)) {
        setError(`The link created a session, but the account setup check was rejected (HTTP ${failure.status}). Confirm the staff account is approved, then request a fresh link.`);
        setStatus("invalid");
      }
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
    recoveryProofRef.current = null;
    partialRecoveryRef.current = null;
    let restoredRecovery = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(PERSONNEL_RECOVERY_STORAGE_KEY) || "null");
      if (saved?.partialSaved === true && typeof saved.accountId === "string"
        && typeof saved.secret === "string" && saved.secret.length >= 32
        && saved.setupStatus?.setupRequired === true && saved.setupStatus?.mustChangePassword === true) {
        partialRecoveryRef.current = saved;
        recoveryProofRef.current = { accountId: saved.accountId, secret: saved.secret };
        setSetupStatus(saved.setupStatus);
        setPartialSaved(true);
        setupRequiredRef.current = true;
        restoredRecovery = true;
      }
    } catch { /* Session storage is optional; recovery can continue in this page. */ }

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

    const urlError = readUrlError();
    if (urlError && !restoredRecovery) {
      setError(`The authentication service rejected this link (${String(urlError).slice(0, 80)}). Request a fresh link and use the newest email.`);
      setStatus("invalid");
      return undefined;
    }

    // Personnel setup links use a token hash that is exchanged only after the
    // recipient clicks Continue. This prevents email security scanners from
    // consuming the one-time link just by previewing it.
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const verificationType = params.get("type");
    verificationTypeRef.current = verificationType;
    if (tokenHash || verificationType) {
      if (!tokenHash || !["invite", "recovery"].includes(verificationType)) {
        setError("The setup link is missing a valid verification token or link type. Request a fresh link.");
        setStatus("invalid");
        return undefined;
      }
      pendingVerifyRef.current = {
        tokenHash,
        verificationType,
        recoverySecret: verificationType === "recovery" ? params.get("recovery_secret") : null,
      };
      setStatus("awaiting_verification");
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
        if (partialRecoveryRef.current) {
          void inspectSession(null, true);
          return;
        }
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
      if (sessionError) {
        setError("The browser could not restore the verified setup session. Request a fresh link and open it in the same browser.");
        setStatus("invalid");
      }
      else if (data?.session) void inspectSession(data.session);
      else if (partialRecoveryRef.current) void inspectSession(null, true);
      else {
        timer = setTimeout(() => {
          if (active) setStatus((s) => (s === "checking" ? "invalid" : s));
        }, 1600);
      }
    }).catch(() => {
      if (active) {
        setError("The browser could not check the verified setup session. Check your connection and request a fresh link if this continues.");
        setStatus("invalid");
      }
    });

    return () => {
      active = false;
      sub?.subscription?.unsubscribe?.();
      clearTimeout(timer);
      clearTimeout(sessionTimer);
      setupSequence.current += 1;
    };
  }, [inspectSession]);

  const verifySetupLink = async () => {
    // State updates render asynchronously. A fast double-click can otherwise
    // submit the same one-time token twice; the second request receives
    // otp_expired and could overwrite the first successful verification.
    if (verifyingLinkRef.current || !pendingVerifyRef.current || !supabase) return;
    verifyingLinkRef.current = true;
    setVerifyingLink(true);
    setError("");
    try {
      const { tokenHash, verificationType, recoverySecret } = pendingVerifyRef.current;
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: verificationType,
      });
      if (verifyError) throw verifyError;
      const session = data?.session;
      if (!session?.access_token || !session?.user?.id) {
        setError("The verification service accepted the link but did not return a password setup session. Request a fresh link if this continues.");
        setStatus("invalid");
        return;
      }
      pendingVerifyRef.current = null;
      recoveryProofRef.current = recoverySecret ? { accountId: session.user.id, secret: recoverySecret } : null;
      window.history.replaceState({}, document.title, window.location.pathname);
      await inspectSession(session, true);
    } catch (failure) {
      const message = String(failure?.message || "").toLowerCase();
      if (message.includes("fetch") || message.includes("network") || message.includes("timeout")) {
        setStatus("awaiting_verification");
        setError("We couldn't reach the secure verification service. Check your connection and try again. The link has not been confirmed as expired.");
      } else {
        const code = String(failure?.code || failure?.error_code || failure?.name || "verification_rejected").slice(0, 80);
        const expired = /expired|otp_expired|invite_not_found|invalid_token/i.test(`${code} ${message}`);
        setError(expired
          ? `The verification service reports that this link is expired, already used, or invalid (${code}). Request a fresh link and open the newest email.`
          : `The verification service rejected this link (${code}). Request a fresh link. If it happens again, share this code with support.`);
        setStatus("invalid");
      }
    } finally {
      verifyingLinkRef.current = false;
      setVerifyingLink(false);
    }
  };

  const passwordRequirements = [
    { label: "At least 8 characters", valid: newPassword.length >= 8 },
    { label: "No more than 200 characters", valid: newPassword.length <= 200 },
    { label: "At least one uppercase letter (A–Z)", valid: /[A-Z]/.test(newPassword) },
    { label: "At least one lowercase letter (a–z)", valid: /[a-z]/.test(newPassword) },
    { label: "At least one number (0–9)", valid: /\d/.test(newPassword) },
    { label: "At least one special character (!, @, #, $, %, etc.)", valid: /[^A-Za-z0-9\s]/.test(newPassword) },
    { label: "No whitespace characters", valid: !/\s/.test(newPassword) },
  ];
  const passwordRequirementsMet = passwordRequirements.every((item) => item.valid);
  const confirmPasswordMessage = confirmPassword.length > 0
    ? newPassword === confirmPassword ? "Passwords match." : "Passwords do not match."
    : "";
  const confirmPasswordIsValid = confirmPassword.length > 0 && newPassword === confirmPassword;

  const requestFreshLink = async (event) => {
    event.preventDefault();
    const email = requestLinkEmail.trim();
    if (requestLinkState.loading) return;
    if (!email) {
      setRequestLinkState({ loading: false, success: "", error: "Please enter your registered email address to request a new link." });
      return;
    }
    if (!isEmail(email)) {
      setRequestLinkState({ loading: false, success: "", error: "Please enter a valid email address." });
      return;
    }

    setRequestLinkState({ loading: true, success: "", error: "" });
    try {
      await authApi.requestPasswordReset(email);
      setRequestLinkState({
        loading: false,
        success: "If a password link can be sent for this account, it has been sent. Staff using administrator-issued temporary passwords must request a fresh invitation from an administrator.",
        error: "",
      });
      setRequestLinkEmail("");
    } catch (failure) {
      const status = Number(failure?.status || 0);
      const message = status === 429
        ? "Too many requests. Please wait a moment before requesting another link."
        : "We could not send a fresh link right now. Please try again in a moment.";
      setRequestLinkState({ loading: false, success: "", error: message });
    }
  };

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
      const retryRecovery = partialSaved && recoveryProofRef.current && setupStatus?.mustChangePassword === true;
      let session;
      if (retryRecovery) {
        session = { user: { id: recoveryProofRef.current.accountId }, access_token: null };
      } else {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        session = data?.session;
      }
      if (!session?.user?.id || session.user.id !== sessionRef.current?.user?.id) {
        if (!retryRecovery || session?.user?.id !== recoveryProofRef.current?.accountId) {
          setStatus("invalid");
          return;
        }
      }
      // Re-check requirements before mutation, including after a token refresh.
      const verifiedSetup = retryRecovery ? setupStatus
        : await resolvePasswordSetup(session, authApi.personnelSetupStatus, { knownRequired: setupRequiredRef.current });
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
        recoverySecret: recoveryProofRef.current?.accountId === session.user.id ? recoveryProofRef.current.secret : null,
        auth: supabase.auth,
        personnelSetup: authApi.personnelPasswordSetup,
        activateResident: registrationApi.activate,
      });
      finishedRef.current = true;
      try { sessionStorage.removeItem(PERSONNEL_RECOVERY_STORAGE_KEY); } catch { /* Optional storage. */ }
      partialRecoveryRef.current = null;
      recoveryProofRef.current = null;
      setCompletion(outcome);
      setPartialSaved(false);
      setNewPassword("");
      setConfirmPassword("");
      try {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
      } catch {
        // The password is already saved. Still move away from the consumed
        // one-time link; an active session will be handled by AuthContext.
      }
      window.location.replace(`${window.location.origin}/login?passwordSetupComplete=1`);
    } catch (failure) {
      const msg = String(failure?.message || "").toLowerCase();
      if (passwordWasSaved(failure)) {
        setPartialSaved(true);
        const proof = recoveryProofRef.current;
        if (proof && setupStatus?.mustChangePassword === true) {
          partialRecoveryRef.current = { accountId: proof.accountId, secret: proof.secret, setupStatus, partialSaved: true };
          try { sessionStorage.setItem(PERSONNEL_RECOVERY_STORAGE_KEY, JSON.stringify(partialRecoveryRef.current)); }
          catch { /* Same-page retry remains available if storage is blocked. */ }
        }
        setError(`Your password was saved, but account setup or activation is incomplete. ${failure?.message || "The server could not confirm finalization."} You may retry account setup; do not assume sign-in is enabled.`);
      } else if ([401, 403].includes(failure?.status) || msg.includes("session") || msg.includes("expired") || msg.includes("jwt")) {
        if (saving && partialSaved && recoveryProofRef.current) {
          setPartialSaved(true);
          setStatus("ready");
          setError("The same password submitted before is required to finish setup. Re-enter it and retry.");
        } else if (saving) {
          setStatus("setup_error");
          setError("The password request was submitted, but the server could not confirm the final result. Try signing in with the password you just chose. If sign-in fails, request a fresh reset link.");
        } else {
          setStatus("invalid");
        }
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

  if (status === "awaiting_verification") {
    return <RegistrationShell footer={null}>
      <RegistrationCard>
        <div className="px-6 py-10 text-center sm:px-12 sm:py-12">
          <CheckCircle2 className="mx-auto h-10 w-10 text-brand-green" />
          <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">Continue Password Setup</h1>
          <p className="mt-4 text-[13px] leading-relaxed text-slate-500">Your invitation is ready. Continue to securely verify it and choose your password.</p>
          <button type="button" onClick={verifySetupLink} disabled={verifyingLink} className={`${btnPrimary} mt-6`}>
            {verifyingLink ? <><Loader2 className="h-4 w-4 animate-spin" /> Verifying...</> : "Continue to Password Setup"}
          </button>
          {error && <p role="alert" className="mt-4 text-sm text-brand-danger">{error}</p>}
          <p className="mt-4"><Link to="/login" className="text-sm font-semibold text-brand-blue underline">Back to Login</Link></p>
        </div>
      </RegistrationCard>
    </RegistrationShell>;
  }

  /* --------------------------- invalid / expired -------------------------- */
  if (status === "invalid") {
    const isSetupLink = verificationTypeRef.current === "invite"
      || (typeof window !== "undefined" && window.location.pathname === "/setup-password");
    const requestTitle = isSetupLink ? "Request a new setup link" : "Request a new reset link";
    const actionLabel = isSetupLink ? "Send a new setup link" : "Send a new reset link";
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
            <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">
              {isSetupLink ? "Invalid or expired password setup link." : "Password Reset Link Expired"}
            </h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-brand-gold" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-slate-500">
              {error || (isSetupLink
                ? "This password setup invitation is missing, invalid, already used, or has expired. Request a fresh link and use the newest email."
                : "This password reset link is invalid or has expired. Please request a new link using your registered email address.")}
            </p>

            <form onSubmit={requestFreshLink} className="mx-auto mt-7 w-full max-w-md space-y-3 text-left">
              <Field label="Registered Email Address" required>
                <input
                  type="email"
                  autoComplete="email"
                  value={requestLinkEmail}
                  disabled={requestLinkState.loading}
                  onChange={(event) => {
                    setRequestLinkEmail(event.target.value);
                    if (requestLinkState.error) setRequestLinkState((previous) => ({ ...previous, error: "" }));
                    if (requestLinkState.success) setRequestLinkState((previous) => ({ ...previous, success: "" }));
                  }}
                  placeholder="name@example.com"
                  className={inputCls(Boolean(requestLinkState.error))}
                />
              </Field>

              <button type="submit" disabled={requestLinkState.loading} className={`${btnPrimary} w-full`}>
                {requestLinkState.loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                  </>
                ) : (isSetupLink ? actionLabel : "Send New Reset Link")}
              </button>

              {requestLinkState.success && (
                <p role="status" className="text-[12px] font-medium text-brand-green">{requestLinkState.success}</p>
              )}
              {requestLinkState.error && (
                <p role="alert" className="text-[12px] font-medium text-brand-danger">{requestLinkState.error}</p>
              )}
              {!isSetupLink && (
                <p className="text-[12px] leading-relaxed text-slate-500">
                  Check your inbox for the latest password reset email. For security, only the most recent valid link should be used.
                </p>
              )}
            </form>

            <div className="mt-5">
              <Link to="/forgot-password" className="text-sm font-semibold text-brand-blue underline decoration-brand-rule underline-offset-4 transition-colors hover:decoration-brand-blue">
                {requestTitle}
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
            {error && (
              <InfoNote tone="danger" icon={AlertTriangle}>
                {error}
              </InfoNote>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <h3 className="text-sm font-semibold text-brand-dark">Password Requirements</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                Create a secure password for your KALUSAGAP account. Make sure your password meets all the requirements below.
              </p>
              <ul className="mt-3 grid grid-cols-1 gap-y-2 text-[12px] text-slate-600 sm:grid-cols-2 sm:gap-x-5">
                {passwordRequirements.map((requirement) => {
                  const passes = requirement.valid;
                  return (
                    <li key={requirement.label} className="flex items-center gap-2">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${passes ? "border-brand-green/30 bg-brand-green/10 text-brand-green" : "border-slate-300 bg-white text-slate-400"}`}
                        aria-hidden="true"
                      >
                        {passes ? <Check className="h-3 w-3" strokeWidth={2.5} /> : "•"}
                      </span>
                      <span className={passes ? "text-brand-dark" : "text-slate-500"}>{requirement.label}</span>
                    </li>
                  );
                })}
              </ul>
              {passwordRequirementsMet && (
                <p className="mt-3 text-[12px] font-medium text-brand-green">Your password meets all security requirements.</p>
              )}
            </div>

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
              hint={setupStatus?.setupRequired ? "8 to 200 characters, with uppercase, lowercase, a number, a special character, and no whitespace." : "Minimum 8 characters, with an uppercase letter, a lowercase letter, and a number."}
              trailing={eyeButton(showConfirm, () => setShowConfirm((v) => !v))}
            >
              <input
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                disabled={submitting}
                onChange={(e) => { setConfirmPassword(e.target.value); setPartialSaved(false); if (error) setError(""); }}
                className={`${inputCls(confirmPassword.length > 0 && !confirmPasswordIsValid)} pr-12`}
              />
              {confirmPasswordMessage && (
                <p className={`mt-2 text-[11.5px] font-medium ${confirmPasswordIsValid ? "text-brand-green" : "text-brand-danger"}`}>
                  {confirmPasswordMessage}
                </p>
              )}
            </Field>

            <button type="submit" disabled={submitting || !!(confirmPassword && newPassword && newPassword !== confirmPassword)} className={`${btnPrimary} w-full`}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating...
                </>
              ) : (
                 partialSaved ? "Retry Account Setup" : setupStatus?.setupRequired ? "Save Password and Complete Setup" : "Update Password"
              )}
            </button>

            <p className="text-center text-[11.5px] leading-relaxed text-slate-500">
              Security tip: Use a unique password that you don't use for other websites. Never share your password with anyone.
            </p>

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
