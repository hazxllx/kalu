import React from "react";
import { useLocation } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";

/**
 * Shared Health Supervisor page header.
 *
 * A single reusable wrapper around the common navy-and-gold `PageHeader` that
 * resolves the Health Supervisor section label, title, and description from the
 * current route. Every Health Supervisor page renders the same recognizable
 * banner; only the metadata changes per route. Nested routes, direct URLs, and
 * browser refreshes all resolve to the correct header because the lookup is
 * based on the active `location.pathname`.
 *
 * Call sites may override any field with explicit props (e.g. a personalized
 * dashboard greeting) — the override wins and the route default fills the rest.
 *
 * @param {{
 *   eyebrow?: string,
 *   title?: import("react").ReactNode,
 *   subtitle?: string,
 *   action?: import("react").ReactNode,
 *   meta?: import("react").ReactNode,
 *   dense?: boolean,
 * }} props
 */
export default function HealthSupervisorPageHeader({
  eyebrow: eyebrowOverride,
  title: titleOverride,
  subtitle: subtitleOverride,
  action,
  meta,
  dense,
}) {
  const { pathname } = useLocation();
  const base = "/app/health_supervisor";
  const metaFor = (path) => {
    if (path === `${base}/dashboard` || path === base) {
      return { eyebrow: "Overview", title: "Health Supervisor Dashboard", subtitle: "An overview of your health supervision activities." };
    }
    if (path.startsWith(`${base}/residents`)) {
      return { eyebrow: "Resident Directory", title: "Resident Directory", subtitle: "View and manage residents within your assigned barangay." };
    }
    if (path.startsWith(`${base}/verifications`)) {
      return { eyebrow: "Account Approvals", title: "Account Approvals", subtitle: "Review and manage resident and worker account verification requests." };
    }
    if (path.startsWith(`${base}/transfer-requests`)) {
      return { eyebrow: "Transfers", title: "Resident Transfer Requests", subtitle: "Review each request and approve to update the resident's current barangay." };
    }
    if (path.startsWith(`${base}/consultations`) || path === `${base}/rhu-consultation`) {
      return { eyebrow: "Consultation", title: "Consultation", subtitle: "Manage and review resident consultations." };
    }
    if (path.startsWith(`${base}/tcls`) || path.startsWith(`${base}/tcl-register`)) {
      return { eyebrow: "Health Programs", title: "Tuberculosis Community Ledgers", subtitle: "Manage TCL registrations, follow-ups, and program records." };
    }
    if (path.startsWith(`${base}/m1`) || path.startsWith(`${base}/maternal-tcl`)) {
      return { eyebrow: "Records", title: "Maternal Records", subtitle: "Access and manage maternal health records and reporting." };
    }
    if (path.startsWith(`${base}/followups`) && !path.includes("followup-calendar")) {
      return { eyebrow: "Follow-ups", title: "Follow-up Monitoring", subtitle: "Track scheduled and overdue resident follow-ups." };
    }
    if (path.startsWith(`${base}/followup-calendar`)) {
      return { eyebrow: "Follow-ups", title: "Schedule Calendar", subtitle: "View scheduled follow-ups and health services." };
    }
    if (path.startsWith(`${base}/services`)) {
      return { eyebrow: "Health Operations", title: "Health Services", subtitle: "Manage community health programs and activities." };
    }
    if (path.startsWith(`${base}/immunization`)) {
      return { eyebrow: "Records", title: "Immunization", subtitle: "Access and manage resident immunization records." };
    }
    if (path.startsWith(`${base}/tb`)) {
      return { eyebrow: "Records", title: "TB Records", subtitle: "Access and manage tuberculosis records." };
    }
    if (path.startsWith(`${base}/ncd`)) {
      return { eyebrow: "Records", title: "Non-Communicable Diseases", subtitle: "Access and manage NCD records." };
    }
    if (path.startsWith(`${base}/oral-health`)) {
      return { eyebrow: "Records", title: "Oral Health", subtitle: "Access and manage oral health records." };
    }
    if (path.startsWith(`${base}/environmental`)) {
      return { eyebrow: "Records", title: "Environmental Health", subtitle: "Access and manage environmental health masterlists." };
    }
    if (path.startsWith(`${base}/referrals`)) {
      return { eyebrow: "Referrals", title: "Referral Monitoring", subtitle: "Monitor and manage resident referrals." };
    }
    if (path.startsWith(`${base}/households/new`)) {
      return { eyebrow: "Households", title: "Add Household", subtitle: "Register a new household in your barangay." };
    }
    if (path.includes(`${base}/households/`) && path.endsWith("/edit")) {
      return { eyebrow: "Households", title: "Edit Household", subtitle: "Update household details and member health records." };
    }
    if (path.startsWith(`${base}/households/risk-overview`)) {
      return { eyebrow: "Households", title: "Household Risk Overview", subtitle: "Review household-level health risk across your barangay." };
    }
    if (path.includes(`${base}/households/`)) {
      return { eyebrow: "Households", title: "Household Risk Detail", subtitle: "Review a household's recorded members and health risks." };
    }
    if (path.startsWith(`${base}/households`)) {
      return { eyebrow: "Households", title: "Households", subtitle: "Manage households and household members in your barangay." };
    }
    if (path.startsWith(`${base}/trends`)) {
      return { eyebrow: "Analytics · Health Trends", title: "Health Trends", subtitle: "Review community health trends and monitoring data." };
    }
    if (path.startsWith(`${base}/reports`)) {
      return { eyebrow: "Monitoring & Reports", title: "Monitoring & Reports", subtitle: "Review community health data and generate reports." };
    }
    if (path.startsWith(`${base}/notifications`)) {
      return { eyebrow: "Account", title: "Notifications", subtitle: "Review messages and alerts for your account." };
    }
    if (path.startsWith(`${base}/settings`) || path.startsWith(`${base}/profile`)) {
      return { eyebrow: "Account", title: "Account Settings", subtitle: "Manage your account, profile, and preferences." };
    }
    return { eyebrow: "Health Supervisor", title: "Health Supervisor", subtitle: "Manage health services and monitoring in your barangay." };
  };

  const route = metaFor(pathname);
  return (
    <div className="ui-page-header-hs">
      <PageHeader
        eyebrow={eyebrowOverride ?? route.eyebrow}
        title={titleOverride ?? route.title}
        subtitle={subtitleOverride ?? route.subtitle}
        action={action}
        meta={meta}
        dense={dense}
      />
    </div>
  );
}