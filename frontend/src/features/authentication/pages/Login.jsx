import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, AlertTriangle, ChevronDown, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { homeForRole } from "@/lib/roles";
import GovSeal from "@/components/branding/GovSeal";
import { MOCK_ACCOUNTS } from "@/services/mock/mockAccounts";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isSupabaseConfigured } = useAuth();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  // The role is resolved from the authenticated account — never chosen here.
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const role = await login({ email, password });
      const from = location.state?.from;
      navigate(from || homeForRole(role), { replace: true });
    } catch (err) {
      setError(err.message || "Unable to sign in. Please check your credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  // Demo helper: populate the form only. The user still clicks "Sign In".
  const fillDemoAccount = (account) => {
    setEmail(account.email);
    setPassword(account.password);
    setError("");
  };

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

                <div>
                  <label htmlFor="login-email" className="text-[12.5px] font-bold text-brand-ink">
                    Email address <span className="font-normal text-brand-danger">*</span>
                  </label>
                  <div className="mt-1.5 flex items-center gap-3 rounded-lg border border-brand-border bg-white px-3.5 py-2.5 transition-all focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20">
                    <Mail className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={2} />
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.gov.ph"
                      className="w-full bg-transparent text-[14px] text-brand-ink outline-none placeholder:text-brand-gray/50"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-password" className="text-[12.5px] font-bold text-brand-ink">
                    Password <span className="font-normal text-brand-danger">*</span>
                  </label>
                  <div className="mt-1.5 flex items-center gap-3 rounded-lg border border-brand-border bg-white px-3.5 py-2.5 transition-all focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20">
                    <Lock className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={2} />
                    <input
                      id="login-password"
                      type={show ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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
                  disabled={submitting}
                  className="group flex w-full items-center justify-center gap-2.5 rounded-lg bg-brand-blue py-3 text-[13px] font-bold uppercase tracking-[0.12em] text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? "Signing in…" : "Sign In"}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
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

              {/* Demo access — collapsed, secondary */}
              <div className="mt-5 rounded-lg border border-brand-border bg-brand-paper">
                <button
                  type="button"
                  onClick={() => setDemoOpen((v) => !v)}
                  aria-expanded={demoOpen}
                  aria-controls="demo-accounts-panel"
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-light/50"
                >
                  <span className="flex items-center gap-2.5">
                    <Users className="h-4 w-4 text-brand-blue" strokeWidth={2} />
                    <span>
                      <span className="block text-[11.5px] font-bold uppercase tracking-gov text-brand-ink">Demo Access</span>
                      <span className="block text-[11px] text-brand-gray">Try a prepared test account</span>
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-brand-gray transition-transform duration-200 ${demoOpen ? "rotate-180" : ""}`}
                    strokeWidth={2}
                  />
                </button>

                {demoOpen && (
                  <div id="demo-accounts-panel" className="border-t border-brand-border px-4 pb-3 pt-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-gov text-brand-gray">
                      For development and presentation only
                    </p>
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {MOCK_ACCOUNTS.map((acc) => (
                        <li key={acc.email}>
                          <button
                            type="button"
                            onClick={() => fillDemoAccount(acc)}
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-left transition-colors hover:border-brand-blue hover:bg-brand-light/60"
                          >
                            <span className="truncate text-[11.5px] font-semibold text-brand-ink">{acc.label}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-brand-blue" strokeWidth={2.2} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10.5px] leading-relaxed text-brand-gray">
                      Fills the form only — click <span className="font-semibold">Sign In</span> to continue.
                      {!isSupabaseConfigured && " Any password is accepted locally."}
                    </p>
                  </div>
                )}
              </div>
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
