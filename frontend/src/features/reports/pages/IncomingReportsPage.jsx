import React from "react";
import PageHeader from "@/components/common/PageHeader";
import IncomingReports from "@/features/reports/components/IncomingReports";

/**
 * Incoming Reports page — the recipient inbox for the report submission
 * workflow (e.g. RHU Personnel receiving Health Supervisor reports). All data
 * is server-scoped to the authenticated recipient; see IncomingReports.
 */
export default function IncomingReportsPage() {
  return (
    <>
      <PageHeader
        crumbs={["Reports", "Incoming"]}
        title="Incoming Reports"
        subtitle="Reports submitted to you by health personnel in your scope."
      />
      <IncomingReports />
    </>
  );
}
