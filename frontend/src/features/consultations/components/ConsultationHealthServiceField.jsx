import React from "react";
import SearchableSelect from "@/components/common/SearchableSelect";
import { consultationHealthServiceLabel } from "@/features/consultations/lib/consultationRisk";

const GENERAL_CONSULTATION_OPTION = "__general_consultation__";

export default function ConsultationHealthServiceField({
  value = "",
  onChange,
  services = [],
  loading = false,
  fieldError = "",
  serviceError = "",
  disabled = false,
  recordedName = "",
  recordedCategory = "",
}) {
  const hasRecordedService = value && !services.some((service) => service.id === value);
  return (
    <div>
      <SearchableSelect
        id="consultation-health-service"
        label="Health Service Provided"
        ariaLabel="Health Service Provided"
        value={value || GENERAL_CONSULTATION_OPTION}
        onChange={(selected) => onChange(selected === GENERAL_CONSULTATION_OPTION ? "" : selected)}
        options={[
          { value: GENERAL_CONSULTATION_OPTION, label: "General Consultation" },
          ...(hasRecordedService ? [{
            value,
            label: consultationHealthServiceLabel({
              name: recordedName || "Previously selected service",
              category: recordedCategory,
            }),
          }] : []),
          ...services.map((service) => ({
            value: service.id,
            label: consultationHealthServiceLabel(service),
          })),
        ]}
        error={fieldError}
        disabled={loading || disabled}
        compact
        portalDropdown
        placeholder="General Consultation"
      />
      {loading ? (
        <p className="mt-1 text-xs text-brand-gray">Loading health services…</p>
      ) : serviceError ? (
        <p className="mt-1 text-xs text-brand-danger" role="alert">{serviceError}</p>
      ) : services.length === 0 ? (
        <p className="mt-1 text-xs text-brand-gray">General Consultation is available; no active registered services were found.</p>
      ) : (
        <p className="mt-1 text-xs text-brand-gray">Choose General Consultation or a registered service.</p>
      )}
    </div>
  );
}
