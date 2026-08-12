import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Info } from "lucide-react";
import { ROLES } from "@/lib/brand";
import { AgencyMark } from "@/components/landing/GovChrome";
import GovSeal from "@/components/landing/GovSeal";

export default function Login() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [role, setRole] = useState("resident-limited");

  const submit = (e) => {
    e.preventDefault();
    navigate(`${ROLES[role].basePath}/dashboard`);
  };

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto grid min-h-[calc(100vh-70px)] max-w-6xl gap-10 px-5 py-10 md:px-8 md:py-14 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        {/* Form side */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <AgencyMark />

          <div className="gov-sheet mt-7 bg-white">
            <div className="border-b border-brand-border bg-brand-paper px-7 py-5 md:px-9">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-[22px] font-bold text-brand-dark">
                    Sign in to the portal
                  </h1>
                  <p className="mt-1 text-[12.5px] text-brand-gray">
                    Authorised personnel and residents, kindly log in below.
                  </p>
                </div>
                <span className="hidden shrink-0 items-center gap-1.5 border border-brand-blue/25 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-gov text-brand-blue sm:inline-flex">
                  <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
                  Secure Access
                </span>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-5 px-7 py-7 md:px-9">
              <div>
                <label className="text-[12.5px] font-bold text-brand-ink">
                  Email address <span className="font-normal text-brand-danger">*</span>
                </label>
                <div className="mt-2 flex items-center gap-3 border border-brand-border bg-white px-3.5 py-3 transition-colors focus-within:border-brand-blue">
                  <Mail className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={2} />
                  <input
                    type="email"
                    defaultValue="maria.santos@pili.gov.ph"
                    className="w-full bg-transparent text-[14px] text-brand-ink outline-none placeholder:text-brand-gray/50"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[12.5px] font-bold text-brand-ink">
                    Password <span className="font-normal text-brand-danger">*</span>
                  </label>
                  <a
                    href="#"
                    className="text-[12px] font-medium text-brand-blue underline decoration-brand-rule underline-offset-4 hover:decoration-brand-blue"
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="mt-2 flex items-center gap-3 border border-brand-border bg-white px-3.5 py-3 transition-colors focus-within:border-brand-blue">
                  <Lock className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={2} />
                  <input
                    type={show ? "text" : "password"}
                    defaultValue="password"
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

              <div>
                <label className="text-[12.5px] font-bold text-brand-ink">
                  Sign in as
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="mt-2 w-full appearance-none border border-brand-border bg-white px-3.5 py-3 text-[14px] text-brand-ink outline-none transition-colors focus:border-brand-blue"
                >
                  {Object.values(ROLES).map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 accent-brand-blue"
                />
                <span className="text-[13px] text-brand-gray">Keep me signed in on this device</span>
              </label>

              <button
                type="submit"
                className="group flex w-full items-center justify-center gap-2.5 bg-brand-blue py-3.5 text-[13px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-brand-dark"
              >
                Sign In
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>

              <p className="pt-1 text-center text-[13px] text-brand-gray">
                New to the portal?{" "}
                <Link
                  to="/register"
                  className="font-semibold text-brand-blue underline decoration-brand-rule underline-offset-4 hover:decoration-brand-blue"
                >
                  Register an account
                </Link>
              </p>
            </form>

            <div className="border-t border-brand-border bg-brand-paper px-7 py-4 md:px-9">
              <p className="flex items-center gap-2 text-[11.5px] leading-relaxed text-brand-gray">
                <Info className="h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
                Continued use of this portal constitutes consent to monitoring in
                accordance with the Data Privacy Act of 2012.
              </p>
            </div>
          </div>

          <p className="mt-6 text-center">
            <Link
              to="/"
              className="text-[12px] font-medium text-brand-gray underline decoration-brand-rule underline-offset-4 transition-colors hover:text-brand-blue hover:decoration-brand-blue"
            >
              Return to portal home
            </Link>
          </p>
        </motion.div>

        {/* Official notice side */}
        <motion.aside
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="hidden lg:block"
        >
          <div className="gov-navy-panel gov-guilloche relative overflow-hidden text-white">
            <div className="flex items-center gap-3.5 border-b border-white/12 px-9 pb-5 pt-9">
              <GovSeal height={32} onDark className="shrink-0" />
              <div>
                <p className="gov-kicker text-brand-goldlight">Official Access</p>
                <p className="mt-1 font-display text-[17px] font-bold">Who uses this portal</p>
              </div>
            </div>

            <div className="px-9 py-7">
              <ul className="divide-y divide-white/12">
                {[
                  {
                    role: "Residents",
                    copy: "View your health record, book appointments, and receive follow-up notices.",
                  },
                  {
                    role: "Barangay Health Workers",
                    copy: "Encode household data, conduct home visits, and manage follow-ups.",
                  },
                  {
                    role: "Midwives & RHU Personnel",
                    copy: "Deliver maternal care, immunization, and treatment services.",
                  },
                  {
                    role: "Municipal Health Officer & Admin",
                    copy: "Monitor programs, approve accounts, and issue public health advisories.",
                  },
                ].map((item) => (
                  <li key={item.role} className="flex gap-4 py-5">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 bg-brand-goldlight" aria-hidden="true" />
                    <div>
                      <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-white">
                        {item.role}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-white/60">{item.copy}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-7 border border-white/15 bg-white/[0.06] p-5">
                <p className="flex items-center gap-2.5 text-[12px] leading-relaxed text-white/70">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-brand-goldlight" strokeWidth={1.9} />
                  Trouble signing in? Contact your Barangay Health Worker or the
                  Municipal Health Office at (054) 477-1234.
                </p>
              </div>
            </div>

            <div className="h-[3px] w-full gov-flag-rule" aria-hidden="true" />
          </div>
        </motion.aside>
      </div>
    </div>
  );
}
