import React, { useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { homeForRole, landingFor } from "@/lib/roles";
import GovSeal from "@/components/branding/GovSeal";
import { email as validateEmail, required, validateFields, firstErrorField } from "@/utils/validation";
import { FieldError, ValidationSummary } from "@/components/common/Validation";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isSupabaseConfigured, authNotice } = useAuth();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const fieldRefs = { email: emailRef, password: passwordRef };

  const focusField = (field) => {
    const target = fieldRefs[field]?.current;
    if (target) target.focus();
  };

  // The role is resolved from the authenticated account — never chosen here.
  // A `from` path left in history by an earlier session is honored only when
  // the signed-in role may open it; otherwise the role's own dashboard is used
  // (prevents a valid account being dropped on /unauthorized after sign-in).
  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return; // guard against rapid double submission

    const errors = validateFields(
      { email, password },
      {
        email: (v) => validateEmail(v, { label: "Email address" }),
        password: (v) => required(v, "Password"),
      },
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const first = firstErrorField(errors);
      if (first) focusField(first);
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const role = await login({ email, password });
      const from = location.state?.from;
      navigate(landingFor(role, from) || homeForRole(role), { replace: true });
    } catch (err) {
      // Generic message only: never reveal whether the email exists.
      setError(err.message || "Unable to sign in. Please check your credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  const clearFieldError = (field) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center gov-navy-panel px-4 py-5 sm:py-7">
      <div className="pointer-events-none absolute inset-0 gov-guilloche opacity-60" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{ backgroundImage: "radial-gradient(60% 45% at 50% 0%, rgba(255,255,255,0.10), transparent 70%)" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative flex w-full max-w-5xl flex-col"
      >
        {/* Branding above the card */}
        <div className="mb-3 flex items-center justify-center gap-3 text-center">
          <GovSeal height={40} eager onDark />
          <div className="text-left">
            <p className="font-display text-[17px] font-bold leading-tight tracking-[0.02em] text-white">KALUSAGAP</p>
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/70">Community Health System</p>
          </div>
        </div>

        {/* Split card */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_70px_-30px_rgba(3,20,45,0.65)] ring-1 ring-white/10">
          <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
            {/* LEFT — login form */}
            <div className="px-6 py-6 sm:px-8 sm:py-7">
              <p className="gov-kicker text-brand-blue">Secure Health Portal</p>
              <h1 className="mt-2 font-display text-[23px] font-bold text-brand-dark sm:text-[25px]">
                Sign in to the portal
              </h1>
              <p className="mt-1.5 text-[13px] text-brand-gray">
                Access your KALUSAGAP account to continue.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-brand-danger/30 bg-brand-danger/5 px-3 py-2.5 text-[12.5px] text-brand-danger"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                    <span>{error}</span>
                  </div>
                )}

                <ValidationSummary
                  errors={fieldErrors}
                  title="Please fix the highlighted fields."
                  onFocusField={focusField}
                />

                {/* The session is valid but the profile service failed. This is
                    NOT an account problem, so it is shown as a warning rather
                    than the "no profile" error. */}
                {!error && authNotice && (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-lg border border-brand-gold/40 bg-brand-goldpale/70 px-3 py-2.5 text-[12px] leading-relaxed text-brand-amber"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                    <span>{authNotice}</span>
                  </div>
                )}

                <div>
                  <label htmlFor="login-email" className="text-[12.5px] font-bold text-brand-ink">
                    Email address <span className="font-normal text-brand-danger">*</span>
                  </label>
                  <div
                    className={`mt-1.5 flex items-center gap-3 rounded-lg border bg-white px-3.5 py-2.5 transition-all focus-within:ring-2 focus-within:ring-brand-blue/20 ${
                      fieldErrors.email ? "border-brand-danger" : "border-brand-border focus-within:border-brand-blue"
                    }`}
                  >
                    <Mail className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={2} />
                    <input
                      id="login-email"
                      ref={emailRef}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearFieldError("email");
                      }}
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
                      placeholder="your@email.gov.ph"
                      className="w-full bg-transparent text-[14px] text-brand-ink outline-none placeholder:text-brand-gray/50"
                    />
                  </div>
                  <FieldError id="login-email-error" error={fieldErrors.email} />
                </div>

                <div>
                  <label htmlFor="login-password" className="text-[12.5px] font-bold text-brand-ink">
                    Password <span className="font-normal text-brand-danger">*</span>
                  </label>
                  <div
                    className={`mt-1.5 flex items-center gap-3 rounded-lg border bg-white px-3.5 py-2.5 transition-all focus-within:ring-2 focus-within:ring-brand-blue/20 ${
                      fieldErrors.password ? "border-brand-danger" : "border-brand-border focus-within:border-brand-blue"
                    }`}
                  >
                    <Lock className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={2} />
                    <input
                      id="login-password"
                      ref={passwordRef}
                      type={show ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        clearFieldError("password");
                      }}
                      aria-invalid={Boolean(fieldErrors.password)}
                      aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                      placeholder="••••••••"
                      className="w-full bg-transparent text-[14px] text-brand-ink outline-none placeholder:text-brand-gray/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShow(!show)}
                      aria-label={show ? "Hide password" : "Show password"}
                      className="text-brand-gray transition-colors hover:text-brand-blue"
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <FieldError id="login-password-error" error={fieldErrors.password} />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-brand-gray">
                    <input type="checkbox" defaultChecked className="h-4 w-4 accent-brand-blue" />
                    Remember me
                  </label>
                  <a
                    href="#"
                    className="text-[12px] font-medium text-brand-blue underline decoration-brand-rule underline-offset-4 hover:decoration-brand-blue"
                  >
                    Forgot password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !isSupabaseConfigured}
                  className="group flex w-full items-center justify-center gap-2.5 rounded-lg bg-brand-blue py-3 text-[13px] font-bold uppercase tracking-[0.12em] text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>

                <p className="text-center text-[13px] text-brand-gray">
                  Don&apos;t have an account?{" "}
                  <Link
                    to="/register"
                    className="font-semibold text-brand-blue underline decoration-brand-rule underline-offset-4 hover:decoration-brand-blue"
                  >
                    Register here
                  </Link>
                </p>
              </form>

              {/* Authentication is Supabase-only. If the portal has no Supabase
                  configuration there is no local fallback to sign in with, so
                  say so plainly instead of offering a fabricated account. */}
              {!isSupabaseConfigured && (
                <div
                  role="status"
                  className="mt-5 flex items-start gap-2 rounded-lg border border-brand-gold/40 bg-brand-goldpale/70 px-3 py-2.5 text-[11.5px] leading-relaxed text-brand-amber"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  <span>
                    Sign-in is unavailable: this deployment has no Supabase authentication
                    configured. Contact the system administrator.
                  </span>
                </div>
              )}
            </div>

            {/* RIGHT — KALUSAGAP visual panel (desktop) */}
            <div className="relative hidden flex-col overflow-hidden gov-navy-panel gov-guilloche text-white lg:flex">
              <div className="flex min-h-0 flex-1 flex-col justify-center px-9 py-8">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-gov text-brand-goldlight">
                  <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
                  Official Portal
                </span>
                <h2 className="mt-5 font-display text-[26px] font-bold leading-[1.25]">
                  Better health,<br />closer to home.
                </h2>
                <p className="mt-3 max-w-[16rem] text-[12.5px] leading-relaxed text-white/70">
                  Connecting residents and health personnel through one secure community health system.
                </p>
              </div>
              <div className="h-[3px] w-full shrink-0 gov-flag-rule" aria-hidden="true" />
            </div>
          </div>
        </div>

        <p className="mt-4 text-center">
          <Link
            to="/"
            className="text-[12px] font-medium text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white hover:decoration-white"
          >
            Return to portal home
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
