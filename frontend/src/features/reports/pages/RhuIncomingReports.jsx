import React from "react";
import PageHeader from "@/components/common/PageHeader";
import IncomingReports from "@/features/reports/components/IncomingReports";

/**
 * RHU Personnel — Incoming Reports.
 *
 * RHU Personnel are the routed RECIPIENTS of Health Supervisor barangay-level
 * reports. This page is the recipient side of the workflow only: it reuses the
 * shared <IncomingReports /> inbox (GET /api/reports?box=incoming, server-scoped
 * to the RHU's municipality) so the RHU can open the submitted report snapshot
 * and acknowledge / review / reject it. RHU Personnel can NEVER author a report
 * (no "Prepare a Report" form, no reports.generate permission).
 */
export default function RhuIncomingReports() {
  return (
    <>
      <PageHeader
        crumbs={["Reports"]}
        title="Incoming Reports"
        subtitle="Barangay health reports submitted to the RHU. Open a report to review its full submitted contents and acknowledge it."
      />
      <IncomingReports />
    </>
  );
}
