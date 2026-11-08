import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Mail, ArrowLeft } from "lucide-react";
import GovSeal from "@/components/branding/GovSeal";

export default function PersonnelRegistration() {
  return (
    <div className="min-h-dvh gov-navy-panel flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 sm:p-9 shadow-2xl">
        <div className="flex items-center gap-3"><GovSeal height={42} eager /><span className="font-display text-xl font-bold text-brand-dark">KALUSAGAP</span></div>
        <div className="mt-6 flex items-center gap-2 text-brand-blue"><ShieldCheck className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-wider">Personnel Access</span></div>
        <h1 className="mt-2 font-display text-2xl font-bold text-brand-dark">Accounts Are Administrator-Provisioned</h1>
        <p className="mt-3 text-sm leading-relaxed text-brand-gray">Public registration is for residents. Health personnel cannot create an account or choose their own role, barangay or facility here.</p>
        <ol className="mt-5 space-y-3 text-sm text-brand-ink list-decimal pl-5">
          <li>Request access from your authorized municipal system administrator.</li>
          <li>The administrator verifies your employment and assigns your role and coverage in the server account profile.</li>
          <li>Open the invitation link provided by the administrator and complete the password-setup process. Account activation is confirmed by the server.</li>
          <li>Sign in with the provisioned account. An expired or missing invitation must be resolved by the administrator.</li>
        </ol>
        <div className="mt-5 flex gap-3 rounded-lg border border-brand-border bg-brand-light p-4"><Mail className="h-5 w-5 shrink-0 text-brand-blue" /><p className="text-xs leading-relaxed text-brand-gray">This page does not submit an access request, send an invitation or activate an account.</p></div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/register" className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue"><ArrowLeft className="h-4 w-4" /> Resident Registration</Link>
          <Link to="/login" className="rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
