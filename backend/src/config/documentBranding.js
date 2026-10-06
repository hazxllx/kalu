export const OFFICIAL_LOGO_TYPES = Object.freeze(['municipal', 'rhu']);

export const DOCUMENT_BRANDING_TEMPLATES = Object.freeze({
  medical_certificate: Object.freeze({
    issuingLevel: 'municipal',
    logoTypes: Object.freeze(['municipal']),
  }),
  fhsis_m1: Object.freeze({
    issuingLevel: 'barangay',
    logoTypes: Object.freeze(['municipal', 'rhu']),
  }),
  barangay_rhu_referral: Object.freeze({
    issuingLevel: 'barangay-to-rhu',
    logoTypes: Object.freeze(['municipal']),
  }),
});

export default { OFFICIAL_LOGO_TYPES, DOCUMENT_BRANDING_TEMPLATES };
