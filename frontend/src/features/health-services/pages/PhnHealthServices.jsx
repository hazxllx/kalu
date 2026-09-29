import React from "react";
import HealthServicesManager from "@/features/health-services/components/HealthServicesManager";

/**
 * PHN Health Services — database-backed catalog + personnel assignment.
 *
 * Source of truth is the /api/health-services backend (Supabase), not
 * localStorage. The PHN is municipality-wide, so they can scope a service to a
 * facility (RHU or a Barangay Health Station) and optionally a barangay, and
 * assign it to authorized personnel; scope/visibility is enforced by the backend
 * and RLS.
 */
export default function PhnHealthServices() {
  return (
    <HealthServicesManager subtitle="Create health services, scope them to a facility/barangay, and assign personnel." />
  );
}
