import React from "react";
import ProgramFormPage from "../components/ProgramFormPage";
import TclPageHeader from "../components/TclPageHeader";
import { PROGRAM_FORMS } from "../lib/programFormConfig";

/**
 * Environmental Health Masterlist. Household-level sanitation monitoring (Parts
 * 1-4 of the official DOH masterlist). Records are linked to households, not to
 * individual patient consultations. The complete-sanitation and safely-managed
 * indicators are derived server-side from the official dependency rules.
 */
export default function EnvironmentalMasterlist() {
  return (
    <>
      <TclPageHeader
        crumb="Environmental"
        title="Environmental Health Masterlist"
        subtitle="Household water supply, sanitation facilities, waste management and complete-sanitation monitoring."
      />
      <ProgramFormPage config={PROGRAM_FORMS.environmental} />
    </>
  );
}
