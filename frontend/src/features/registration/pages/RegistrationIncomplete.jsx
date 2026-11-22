import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, RefreshCcw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function RegistrationIncomplete() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const status = user?.registrationStatus;
  const incomplete = status !== "complete";

  const continueRegistration = () => {
    const saved = sessionStorage.getItem("residentRegistrationDraft");
    if (saved) sessionStorage.setItem("residentRegistrationResume", "1");
    navigate("/register/new/step-1");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-background">
      <section className="w-full max-w-lg rounded-2xl border border-brand-border bg-white p-6 shadow-card dark:border-border dark:bg-card sm:p-8" role="alert">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-brand-blue">Registration incomplete</p>
        <h1 className="mt-2 text-2xl font-semibold text-brand-ink dark:text-foreground">
          {incomplete ? "Your resident record has not been created" : "We could not verify your registration"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-brand-gray dark:text-muted-foreground">
          {incomplete
            ? "Your sign-in account exists, but your registration is missing the resident record required for the resident portal. Continue the remaining registration step before entering Health Services."
            : "Registration status is unavailable. Refresh your account status or continue registration."}
        </p>
        {user?.residentId && (
          <p className="mt-4 rounded-lg bg-brand-light px-4 py-3 text-sm text-brand-ink">
            Resident record: <strong>{user.residentId}</strong>
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={continueRegistration} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-blue px-5 text-sm font-semibold text-white hover:bg-brand-dark">
            Continue Registration <ArrowRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => refreshProfile?.()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-brand-border px-5 text-sm font-semibold text-brand-ink hover:bg-brand-bg dark:border-border dark:text-foreground">
            <RefreshCcw className="h-4 w-4" /> Refresh Status
          </button>
        </div>
      </section>
    </main>
  );
}
