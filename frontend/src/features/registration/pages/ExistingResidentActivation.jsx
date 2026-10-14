import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, Eye, EyeOff, IdCard, Loader2, Mail, ShieldCheck,
} from "lucide-react";
import {
  RegistrationShell, RegistrationCard, StepIndicator, PageHeading, InfoNote,
  Field, inputCls, btnPrimary, btnGhost,
} from "@/features/registration/components/RegistrationDesign";
import { REGISTRATION_OTP_LENGTH, isValidRegistrationOtp, sanitizeRegistrationOtp } from "@/features/registration/otp";
import { supabase } from "@/lib/supabase";
import { registrationApi } from "@/services/api";
import {
  normalizeRegistrationEmail,
  signupResponseIssue,
  classifySignupError,
  rateLimitRetrySeconds,
} from "@/features/registration/signupResponse";
import { isSendCodeDisabled } from "@/features/registration/sendCodeGate";
import { isEmail } from "@/utils/validation";
import { isPasswordReuseError } from "@/features/registration/passwordErrors";

const STEPS = [
  { num: 1, label: "Resident ID" },
  { num: 2, label: "Verify Identity" },
  { num: 3, label: "Set Password" },
];

const RESIDENT_ID_PATTERN = /^RES-\d{6}$/;

// Password policy mirrors the new-resident meter: 8+ chars, upper, lower,
// number, special. (Resident passwords are enforced client-side + by Supabase
// Auth; there is no server-side resident password store.)
const passwordChecks = (pw) => [
  pw.length >= 8,
  /[A-Z]/.test(pw),
  /[a-z]/.test(pw),
  /\d/.test(pw),
  /[^A-Za-z0-9]/.test(pw),
];
const isStrongPassword = (pw) => passwordChecks(pw).every(Boolean);

/**
 * Existing-resident account activation ("I already have a barangay health
 * record"). A simplified 3-step flow that links a NEW Supabase Auth account to
 * an EXISTING resident record without re-entering any demographic information:
 *
 *   Step 1 — Existing Resident ID : validate + look up an eligible record.
 *   Step 2 — Verify Identity      : prove email ownership (Supabase OTP) and
 *                                   supply the date of birth on record.
 *   Step 3 — Set Password         : set a password, then link the account to
 *                                   the existing record (server re-checks the
 *                                   Resident ID + date of birth) and redirect.
 *
 * The existing record stays the source of truth: the Resident ID, Health Record
 * Number and health history are never changed, and no second profile is created.
 */
export default function ExistingResidentActivation({ onBack }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const [residentId, setResidentId] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [code, setCode] = useState("");
  const [emailPhase, setEmailPhase] = useState("idle"); // idle | sent | verified
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [residentIdError, setResidentIdError] = useState("");
  const [alreadyLinked, setAlreadyLinked] = useState(false);
  // Resend cooldown + delivery feedback for Step 2. Supabase Auth enforces a
  // 60s send interval (smtp_max_frequency); mirror it client-side so a Resend
  // click during the window never issues a request the server will reject.
  const [resendIn, setResendIn] = useState(0);
  const [sendNotice, setSendNotice] = useState("");
  const [emailDuplicate, setEmailDuplicate] = useState(false);
  const sessionRef = useRef(null);
  const residentIdInputRef = useRef(null);
  const tempPasswordRef = useRef("");
  const sendInFlightRef = useRef(false);

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const message = (err) => err?.message || "We could not complete this step. Please try again.";
  const normalizedId = residentId.trim().toUpperCase();
  const idValid = RESIDENT_ID_PATTERN.test(normalizedId);
  const strong = useMemo(() => isStrongPassword(password), [password]);
  const focusResidentId = () => {
    residentIdInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    residentIdInputRef.current?.focus();
  };

  // Changing the email invalidates any code already sent to the old address and
  // clears a prior duplicate flag, so the resident can correct a typo and retry.
  const onEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    setError("");
    setSendNotice("");
    if (emailDuplicate) setEmailDuplicate(false);
    if (emailPhase === "sent") {
      setEmailPhase("idle");
      setCode("");
      setResendIn(0);
    }
  };

  // --- Step 1: look up the existing record -------------------------------
  const lookup = async () => {
    setError("");
    setResidentIdError("");
    setAlreadyLinked(false);
    if (!normalizedId) {
      setResidentIdError("Resident ID is required.");
      focusResidentId();
      return;
    }
    if (!idValid) {
      setResidentIdError("Enter a valid Resident ID (for example, RES-000123).");
      focusResidentId();
      return;
    }
    setBusy(true);
    try {
      const result = await registrationApi.lookupExistingResident(normalizedId);
      if (result?.status === "already_linked") {
        setAlreadyLinked(true);
        return;
      }
      if (result?.status !== "eligible") {
        throw new Error("We could not retrieve the existing record. Please try again.");
      }
      // Eligible — proceed to identity verification.
      setStep(2);
    } catch (err) {
      setResidentIdError(err?.message || "We could not retrieve the existing record. Please try again.");
      focusResidentId();
    } finally {
      setBusy(false);
    }
  };

  // --- Step 2: email OTP (identity via a verified contact channel) --------
  // Supabase Auth is the single OTP mechanism: signUp triggers the "Confirm
  // your email address" email that renders the {{ .Token }} 6-digit code, and a
  // resend re-issues it. We only advance to the code-entry state when GoTrue
  // actually accepted a NEW send, so a success message is never shown for a
  // duplicate (obfuscated, no email sent) or rate-limited request.
  const sendCode = async () => {
    setError("");
    setSendNotice("");
    if (sendInFlightRef.current || busy) return;
    const normalizedEmail = normalizeRegistrationEmail(email);
    if (!isEmail(normalizedEmail)) return setError("Enter a valid email address.");
    if (!birthDate) return setError("Enter the date of birth on your existing record.");
    if (emailDuplicate) return;
    if (!supabase) return setError("Verification is unavailable right now. Please try again later.");

    const isResend = emailPhase === "sent";
    // Honor the server-enforced 60s interval; a click during the cooldown would
    // only earn an over_email_send_rate_limit error.
    if (isResend && resendIn > 0) return;

    sendInFlightRef.current = true;
    setBusy(true);
    try {
      if (isResend) {
        const { error: resendErr } = await supabase.auth.resend({ type: "signup", email: normalizedEmail });
        if (resendErr) throw resendErr;
      } else {
        // A random temp password only triggers the Confirm-Signup OTP email; the
        // resident sets their real password in Step 3.
        const tempPassword = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}K${Math.floor(Math.random() * 10)}`;
        tempPasswordRef.current = tempPassword;
        const { data, error: signErr } = await supabase.auth.signUp({ email: normalizedEmail, password: tempPassword });
        const issue = signupResponseIssue({ data, error: signErr, email: normalizedEmail });
        if (issue === "duplicate_email") {
          // The email already has an auth account — do NOT silently claim a code
          // was sent (none was). Direct the resident to sign in / recover.
          tempPasswordRef.current = "";
          setEmailDuplicate(true);
          setError("This email already has an account. Log in or reset your password, or use a different email address.");
          return;
        }
        if (issue === "rate_limited") {
          const retry = rateLimitRetrySeconds(signErr) || 60;
          setResendIn(retry);
          setError(`Too many verification emails were sent recently. Please wait ${retry}s, then request a new code.`);
          return;
        }
        if (issue) {
          // profile_conflict | invalid_response | signup_failed
          throw signErr || new Error("We could not send the verification code. Please try again.");
        }
      }
      // GoTrue accepted a genuine new/resent email.
      setEmail(normalizedEmail);
      setEmailPhase("sent");
      setCode("");
      setResendIn(60);
      setSendNotice(
        isResend
          ? "We sent a new code to your email. Please check your inbox, including spam or junk."
          : "We sent a verification code to your email. Please check your inbox, including spam or junk.",
      );
    } catch (err) {
      const errClass = classifySignupError(err);
      if (errClass === "rate_limited") {
        const retry = rateLimitRetrySeconds(err) || 60;
        setResendIn(retry);
        setError(`Too many requests. Please wait ${retry}s before requesting another code.`);
      } else if (errClass === "duplicate_email") {
        setEmailDuplicate(true);
        setError("This email already has an account. Log in or reset your password, or use a different email address.");
      } else {
        setError(message(err));
      }
    } finally {
      sendInFlightRef.current = false;
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError("");
    setSendNotice("");
    if (!isValidRegistrationOtp(code)) {
      return setError(`Enter the ${REGISTRATION_OTP_LENGTH}-digit code sent to your email.`);
    }
    setBusy(true);
    try {
      const { data, error: verifyErr } = await supabase.auth.verifyOtp({
        email: normalizeRegistrationEmail(email),
        token: code,
        type: "email",
      });
      if (verifyErr) throw verifyErr;
      sessionRef.current = data?.session || null;
      setEmailPhase("verified");
      setResendIn(0);
      setStep(3);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  // --- Step 3: set password + link the account to the existing record -----
  const activate = async () => {
    setError("");
    setAlreadyLinked(false);
    if (!strong) return setError("Choose a stronger password (8+ characters with upper, lower, number, and symbol).");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      // Ensure we have an authenticated session from the verified OTP.
      let session = sessionRef.current;
      if (!session?.user) {
        const { data: existing } = await supabase.auth.getSession();
        session = normalizeRegistrationEmail(existing?.session?.user?.email) === normalizeRegistrationEmail(email)
          ? existing.session : null;
      }
      if (!session?.user && tempPasswordRef.current) {
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: normalizeRegistrationEmail(email),
          password: tempPasswordRef.current,
        });
        if (signInErr) throw signInErr;
        session = signInData?.session || null;
      }
      if (!session?.user) {
        throw new Error("Your verification session expired. Please verify your email again.");
      }

      // Set the real password on the authenticated account.
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr && !isPasswordReuseError(pwErr.message)) throw pwErr;
      tempPasswordRef.current = "";

      // Link the account to the existing record. The server re-checks the
      // Resident ID + date of birth and performs the atomic link.
      const result = await registrationApi.activateExisting({ residentId: normalizedId, birthDate });
      if (!result?.id) throw new Error("Activation failed. Please try again.");

      // Account linkage succeeded — go to the resident dashboard. The limited
      // dashboard promotes to the full resident area once the record is active.
      navigate("/app/resident-limited/dashboard");
    } catch (err) {
      // A record linked to another account surfaces as a conflict → login/recovery.
      const msg = message(err);
      if (/already has an account|already linked/i.test(msg)) setAlreadyLinked(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RegistrationShell
      footer={
        <div className="mt-5 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[12.5px] text-white/70">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Sign in to the portal
            </Link>
          </p>
        </div>
      }
    >
      <RegistrationCard>
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <StepIndicator current={step} steps={STEPS} flowLabel="Activate Existing Record" />

          <div className="mt-6 space-y-5">
            {error && <InfoNote tone="danger" icon={AlertCircle}>{error}</InfoNote>}

            {alreadyLinked && (
              <InfoNote tone="gold" icon={ShieldCheck}>
                This resident record already has an account.{" "}
                <Link to="/login" className="font-semibold underline">Log in</Link> or{" "}
                <Link to="/forgot-password" className="font-semibold underline">recover your account</Link> instead.
              </InfoNote>
            )}

            {/* STEP 1 — Existing Resident ID */}
            {step === 1 && (
              <>
                <PageHeading
                  title="Enter your Resident ID"
                  subtitle="Enter the Resident ID provided by your Health Supervisor to retrieve your existing record."
                />
                <Field id="existing-resident-id" label="Resident ID" required error={residentIdError}>
                  <input
                    id="existing-resident-id"
                    ref={residentIdInputRef}
                    type="text"
                    placeholder="e.g. RES-000123"
                    value={residentId}
                    onChange={(e) => {
                      setResidentId(e.target.value);
                      setResidentIdError("");
                      setAlreadyLinked(false);
                    }}
                    onBlur={() => setResidentIdError(
                      !normalizedId
                        ? "Resident ID is required."
                        : (idValid ? "" : "Enter a valid Resident ID (for example, RES-000123).")
                    )}
                    onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
                    aria-invalid={Boolean(residentIdError)}
                    aria-describedby={residentIdError ? "existing-resident-id-error" : undefined}
                    className={inputCls(residentIdError)}
                    autoComplete="off"
                  />
                </Field>
                <InfoNote icon={IdCard}>Your existing record will be verified before you continue.</InfoNote>
              </>
            )}

            {/* STEP 2 — Verify Identity */}
            {step === 2 && (
              <>
                <PageHeading
                  title="Verify your identity"
                  subtitle="Confirm a contact email and the date of birth on your record. A Resident ID alone cannot activate an account."
                />
                <Field label="Email Address" required>
                  <input
                    type="email"
                    value={email}
                    onChange={onEmailChange}
                    disabled={emailPhase === "verified"}
                    className={inputCls(false)}
                    autoComplete="email"
                  />
                </Field>
                <Field label="Date of Birth (on your record)" required>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    disabled={emailPhase === "verified"}
                    className={inputCls(false)}
                  />
                </Field>

                {emailPhase !== "verified" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={sendCode}
                      disabled={busy || !birthDate || isSendCodeDisabled({ email, emailPhase, resendIn, emailDuplicate })}
                      className={btnPrimary}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      {busy
                        ? "Sending…"
                        : emailPhase === "sent"
                          ? (resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code")
                          : "Send verification code"}
                    </button>
                    {emailPhase === "sent" && resendIn > 0 && !busy && (
                      <span className="text-[12px] font-medium text-slate-500 tabular-nums">
                        You can request another code in {resendIn}s.
                      </span>
                    )}
                  </div>
                )}

                {sendNotice && !error && (
                  <InfoNote tone="success" icon={CheckCircle2}>{sendNotice}</InfoNote>
                )}

                {emailPhase === "sent" && (
                  <Field label={`Verification code (${REGISTRATION_OTP_LENGTH} digits)`} required>
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(sanitizeRegistrationOtp(e.target.value))}
                      onKeyDown={(e) => { if (e.key === "Enter") verifyCode(); }}
                      placeholder="123456"
                      className={inputCls(false)}
                    />
                  </Field>
                )}

                <InfoNote icon={ShieldCheck}>
                  We send a one-time code to your email to confirm it is yours. Your date of birth is checked against your existing record before anything is linked.
                </InfoNote>
              </>
            )}

            {/* STEP 3 — Set Password */}
            {step === 3 && (
              <>
                <PageHeading
                  title="Set your password"
                  subtitle="Create a password to finish activating your account. Your existing record, Resident ID, and health history stay exactly as they are."
                />
                <Field label="Password" required>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${inputCls(false)} pr-12`}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-ink"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="Confirm Password" required>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") activate(); }}
                    className={inputCls(false)}
                    autoComplete="new-password"
                  />
                </Field>
                <p className="text-[11.5px] leading-relaxed text-slate-500">
                  Use at least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol.
                </p>
              </>
            )}
          </div>

          {/* Footer actions */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            {step === 1 ? (
              <button type="button" onClick={onBack} className={btnGhost}>
                <ArrowLeft className="h-4 w-4" /> I don&apos;t have a record
              </button>
            ) : (
              <button type="button" onClick={() => { setError(""); setSendNotice(""); setStep((s) => Math.max(1, s - 1)); }} className={btnGhost}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}

            {step === 1 && (
              <button type="button" onClick={lookup} disabled={busy} className={btnPrimary}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 2 && emailPhase === "sent" && (
              <button type="button" onClick={verifyCode} disabled={busy || !isValidRegistrationOtp(code)} className={btnPrimary}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Verify <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 3 && (
              <button type="button" onClick={activate} disabled={busy || !strong || password !== confirm} className={btnPrimary}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}<BadgeCheck className="h-4 w-4" /> Activate account
              </button>
            )}
          </div>
        </div>
      </RegistrationCard>
    </RegistrationShell>
  );
}
