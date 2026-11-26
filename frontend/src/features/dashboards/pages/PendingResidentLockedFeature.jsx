// frontend/src/features/dashboards/pages/PendingResidentLockedFeature.jsx
import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { Card } from "@/components/common/Card";
import PageHeader from "@/components/common/PageHeader";

// Renders or manages PendingResidentLockedFeature logic.
export default function PendingResidentLockedFeature({ title = "Follow-ups" }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-5">
      <PageHeader crumbs={["Dashboard", title]} title={title} subtitle="This feature becomes available after your resident account is verified." />
      <Card className="p-5 text-center sm:p-8">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-brand-ink dark:text-foreground">Follow-ups are locked for now</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-brand-gray dark:text-muted-foreground">
          Your account is still pending verification. Once it is approved, you’ll be able to view and respond to follow-up schedules here.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <Link to="/app/resident-limited/profile" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2">
            <ShieldCheck className="h-4 w-4" /> View verification status
          </Link>
          <Link to="/app/resident-limited/dashboard" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:text-foreground dark:hover:bg-hover">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}
