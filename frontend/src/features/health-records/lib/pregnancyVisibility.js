// Resident-facing rule for the "Pregnancy Status" field.
//
// Policy:
//  - Hide the field ONLY when the resident's recorded sex is explicitly male.
//  - Show it for female residents (preserving the actual saved value).
//  - Missing / unknown / "Other" sex is treated SAFELY: it must never be
//    assumed to be male, so hiding (the male-specific behavior) is NOT applied.
//    The field is shown and simply reflects whatever value exists (or "—").
//
// The rule is driven by the authoritative resident profile `sex` value, never a
// hardcoded assumption. Matching is case- and whitespace-insensitive so it is
// robust to minor data variations while the DB constraint stays authoritative.

/**
 * @param {string|null|undefined} sex the resident's recorded sex
 * @returns {boolean} true when the Pregnancy Status field may be displayed
 */
export function shouldShowPregnancyStatus(sex) {
  const normalized = String(sex ?? "").trim().toLowerCase();
  // Only an explicit male value suppresses the field. Everything else
  // (female, other, empty, unknown) leaves it visible.
  return normalized !== "male";
}

export default shouldShowPregnancyStatus;
