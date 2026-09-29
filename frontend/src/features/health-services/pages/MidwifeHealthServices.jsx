import React from "react";
import HealthServicesManager from "@/features/health-services/components/HealthServicesManager";

/**
 * Health Supervisor Health Services — database-backed catalog + assignment,
 * scoped to the supervisor's assigned barangay.
 *
 * Source of truth is the /api/health-services backend (Supabase), not
 * localStorage. Services the supervisor creates are pinned to their barangay by
 * the backend; services assigned to them by a PHN/MHO also appear here (the API
 * merges assigned services into the visible list).
 */
export default function MidwifeHealthServices() {
  return (
    <HealthServicesManager subtitle="Health services in your barangay, including those assigned to you." />
  );
}
