import test from 'node:test';
import assert from 'node:assert/strict';
import { renderM1FhsisPdf } from '../src/features/health-records/lib/m1FhsisPdfRenderer.js';
import { renderReferralPdf } from '../src/features/referrals/lib/referralPdfRenderer.js';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';

const REFERRAL_BRANDING = {
  organization: {
    municipality: 'Pili',
    province: 'Camarines Sur',
    officeName: 'OFFICE OF THE MUNICIPAL HEALTH OFFICER',
    rhuName: 'RHU',
    rhuAddress: '',
    address: '',
  },
  logos: {
    municipal: { dataUrl: onePixelPng, width: 1, height: 1 },
    rhu: { dataUrl: onePixelPng, width: 1, height: 1 },
  },
  signatory: {
    fullName: 'Dr. Maria L. Santos',
    position: 'Municipal Health Officer',
    licenseNumber: 'PRC-2026-0001',
  },
};

test('M1 FHSIS PDF embeds centrally resolved logos without changing its page count', () => {
  const pdf = renderM1FhsisPdf({}, {
    logos: {
      municipal: { dataUrl: onePixelPng, width: 1, height: 1 },
      rhu: { dataUrl: onePixelPng, width: 1, height: 1 },
    },
  });
  const output = pdf.output();

  assert.equal(pdf.internal.getNumberOfPages(), 9);
  assert.match(output, /\/Subtype\s*\/Image/);
});

test('M1 FHSIS PDF preserves the text-only fallback when logos are unconfigured', () => {
  const pdf = renderM1FhsisPdf({});
  assert.equal(pdf.internal.getNumberOfPages(), 9);
  assert.doesNotMatch(pdf.output(), /\/Subtype\s*\/Image/);
});

test('Referral Form PDF renders a single A4 page with the government header and signatory', () => {
  const referral = {
    id: 'REF-1',
    referralNo: 'RH-000001',
    reason: 'Suspected dengue',
    destinationFacility: 'Bicol Regional Hospital',
    destinationService: 'Internal Medicine',
    resident: {
      first_name: 'Juan',
      middle_name: 'A.',
      last_name: 'Dela Cruz',
      sex: 'Male',
      birth_date: '1990-01-15',
      current_address: 'San Isidro, Pili',
    },
  };
  const pdf = renderReferralPdf(referral, REFERRAL_BRANDING);
  assert.ok(pdf, 'referral PDF rendered');
  assert.equal(pdf.internal.getNumberOfPages(), 1);
  const output = pdf.output();

  assert.match(output, /\/Subtype\s*\/Image/, 'logos are embedded');
  assert.match(output, /Republic of the Philippines/);
  assert.match(output, /REFERRAL FORM/);
});

test('Referral Form PDF falls back to a text-only header when branding is unconfigured', () => {
  const referral = {
    id: 'REF-2',
    reason: 'Prenatal checkup',
    resident: { first_name: 'Maria', last_name: 'Santos', sex: 'Female', birth_date: '1995-05-20' },
  };
  const pdf = renderReferralPdf(referral, null);
  assert.ok(pdf, 'referral PDF rendered without branding');
  assert.equal(pdf.internal.getNumberOfPages(), 1);
  assert.doesNotMatch(pdf.output(), /\/Subtype\s*\/Image/);
  assert.match(pdf.output(), /Republic of the Philippines/);
});
