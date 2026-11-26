// frontend/src/features/health-records/components/M1PageHeader.jsx
import React from "react";
import HealthSupervisorPageHeader from "@/features/dashboards/components/HealthSupervisorPageHeader";
import TclPageHeader from "./TclPageHeader";
import M1BackButton from "./M1BackButton";

// Renders or manages M1PageHeader logic.
export default function M1PageHeader({
  variant = "detail",
  eyebrow = "M1 Health Programs",
  title,
  subtitle = "",
  action = null,
  crumb = title,
  backTo = "/app/health_supervisor/m1",
  backLabel = "Back to M1 Programs",
}) {
  if (variant === "overview") {
    // Overview: delegate to HealthSupervisorPageHeader with dense/compact styling
    return (
      <HealthSupervisorPageHeader
        dense
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        action={action}
      />
    );
  }

  // Detail: compact single-line breadcrumb + back button via TclPageHeader
  return (
    <TclPageHeader
      dense
      title={title}
      subtitle={subtitle}
      crumb={crumb}
      backTo={backTo}
      crumbs={[
        { label: "Records", to: "/app/health_supervisor/dashboard" },
        { label: "M1", to: "/app/health_supervisor/m1" },
        { label: crumb },
      ]}
      action={<M1BackButton fallback={backTo} label={backLabel} />}
    />
  );
}
