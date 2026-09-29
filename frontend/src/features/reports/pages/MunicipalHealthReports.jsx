import React from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import IncomingReports from "@/features/reports/components/IncomingReports";
import {
  Map as MapIcon, ClipboardList, TrendingUp, Send, FileText, ChevronRight,
} from "lucide-react";

/**
 * Municipal Health Reports (MHO).
 *
 * The recipient side of the report workflow — <IncomingReports /> — is the only
 * authoritative, server-scoped dataset the MHO reads here (GET /api/reports,
 * bound to the MHO's municipality). The former summary cards, barangay table,
 * health-activity chart, TCL/M1 status, household-risk clusters, immunization/
 * maternal/referral tiles and "recent activity" were all fed by empty
 * client-only/session stores (services/local/dashboardData +
 * householdRiskStore + municipalSubmissionsStore) with NO server read path, so
 * they represented no live data. They have been removed rather than shown as
 * hollow zeros or wired to mock data.
 *
 * The MHO's live municipal monitoring already lives on dedicated, authoritative
 * pages (Community Monitoring, TCL & M1 Submissions, Health Trends, Referrals,
 * Medical Certificates); this page links to them instead of duplicating them
 * with empty data. MHO authorization scope is unchanged — no household-level
 * access is granted here.
 */

const MONITORING_LINKS = [
  {
    to: "/app/mho/barangays",
    icon: MapIcon,
    title: "Community Monitoring",
    desc: "Municipality-wide barangay health overview, risk distribution and trends from recorded data.",
  },
  {
    to: "/app/mho/submissions",
    icon: ClipboardList,
    title: "TCL & M1 Submissions",
    desc: "Review and act on TCL / M1 reporting submitted by the barangays.",
  },
  {
    to: "/app/mho/trends",
    icon: TrendingUp,
    title: "Health Trends",
    desc: "Consultation, disease and early-warning trends across the municipality.",
  },
  {
    to: "/app/mho/referrals",
    icon: Send,
    title: "Referrals",
    desc: "Monitor the municipal referral register and coordination status.",
  },
  {
    to: "/app/mho/certificates",
    icon: FileText,
    title: "Medical Certificates",
    desc: "Review and approve medical certificate requests within the municipality.",
  },
];

export default function MunicipalHealthReports() {
  return (
    <>
      <PageHeader
        crumbs={["Reports"]}
        title="Municipal Health Reports"
        subtitle="Reports submitted to your office, plus links to the live municipal monitoring views."
      />

      {/* Incoming Reports — real, persisted reports submitted TO the MHO (e.g. by
          a PHN). Server-scoped to the authenticated MHO's municipality. */}
      <div className="mb-6">
        <IncomingReports />
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-brand-ink sm:text-base">Municipal Monitoring</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-brand-gray">
            Open the authoritative, live views for municipal health monitoring and reporting.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MONITORING_LINKS.map(({ to, icon: Icon, title, desc }) => (
            <Link
              key={to}
              to={to}
              className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-colors hover:border-brand-blue/40 dark:border-border dark:bg-card"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-semibold text-brand-ink">
                  {title}
                  <ChevronRight className="h-3.5 w-3.5 text-brand-gray transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-brand-gray">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}
