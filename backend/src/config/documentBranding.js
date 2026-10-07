export const OFFICIAL_LOGO_TYPES = Object.freeze(['municipal', 'rhu']);

/**
 * Approved official-document templates.
 *
 * Each entry declares:
 *   issuingLevel  where the document originates (informational / future scope)
 *   logoTypes     which Admin-uploaded official logos the template may render
 *   officeName    the formal office designation printed under the government
 *                 heading. This is an OFFICE TITLE, never a person's name, so
 *                 it is stable and safe to keep in configuration (the actual
 *                 office is a fixed LGU/RHU entity, not per-user data).
 *   title         the official document title (uppercase, per the reference).
 *
 * The reference image (Pili / Camarines Sur / Rafael C. Salles, M.D.) is an
 * EXAMPLE ONLY. Municipality, province, region, RHU name/address and signatory
 * are resolved at generation time from the database.
 */
export const DOCUMENT_BRANDING_TEMPLATES = Object.freeze({
  medical_certificate: Object.freeze({
    issuingLevel: 'municipal',
    logoTypes: Object.freeze(['municipal', 'rhu']),
    officeName: 'OFFICE OF THE MUNICIPAL HEALTH OFFICER',
    title: 'MEDICAL CERTIFICATE',
  }),
  fhsis_m1: Object.freeze({
    issuingLevel: 'barangay',
    logoTypes: Object.freeze(['municipal', 'rhu']),
    officeName: '',
    title: 'FHSIS M1',
  }),
  barangay_rhu_referral: Object.freeze({
    issuingLevel: 'barangay-to-rhu',
    logoTypes: Object.freeze(['municipal', 'rhu']),
    officeName: 'OFFICE OF THE MUNICIPAL HEALTH OFFICER',
    title: 'REFERRAL FORM',
  }),
});

export default { OFFICIAL_LOGO_TYPES, DOCUMENT_BRANDING_TEMPLATES };
