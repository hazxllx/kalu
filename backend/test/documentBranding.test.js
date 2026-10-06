import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { DOCUMENT_BRANDING_TEMPLATES } from '../src/config/documentBranding.js';
import documentBrandingController from '../src/controllers/documentBranding.controller.js';
import { validateOfficialLogo } from '../src/middleware/uploadOfficialLogo.js';
import documentBrandingRoutes from '../src/routes/documentBranding.routes.js';
import {
  getAdminLogoSettings,
  getDocumentBranding,
  removeOfficialLogo,
  uploadOfficialLogo,
} from '../src/services/documentBranding.service.js';

const pngBuffer = () => PNG.sync.write({
  width: 1,
  height: 1,
  data: Buffer.from([255, 255, 255, 255]),
});

const jpegBuffer = () => jpeg.encode({
  width: 1,
  height: 1,
  data: Uint8Array.from([255, 255, 255, 255]),
}, 80).data;

test('admin logo API handlers are exported and mounted at the expected paths', () => {
  assert.equal(typeof documentBrandingController.getAdminLogos, 'function');
  const endpoints = documentBrandingRoutes.stack.flatMap(({ route }) => (
    route
      ? Object.entries(route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${route.path}`)
      : []
  ));
  assert.ok(endpoints.includes('GET /admin/logos'));
  assert.ok(endpoints.includes('POST /admin/logos/:logoType'));
  assert.ok(endpoints.includes('DELETE /admin/logos/:logoType'));
});

test('official logo validation decodes PNG and JPEG pixel data', () => {
  assert.deepEqual(
    validateOfficialLogo({ mimetype: 'image/png', buffer: pngBuffer() }),
    { mimeType: 'image/png', extension: '.png' },
  );
  assert.deepEqual(
    validateOfficialLogo({ mimetype: 'image/jpeg', buffer: jpegBuffer() }),
    { mimeType: 'image/jpeg', extension: '.jpg' },
  );
});

test('official logo validation rejects spoofed, truncated, and oversized-dimension images', () => {
  assert.throws(
    () => validateOfficialLogo({ mimetype: 'image/png', buffer: Buffer.from('not an image') }),
    { statusCode: 400 },
  );
  assert.throws(
    () => validateOfficialLogo({ mimetype: 'image/jpeg', buffer: pngBuffer() }),
    { statusCode: 400 },
  );
  const oversized = Buffer.from(pngBuffer());
  oversized.writeUInt32BE(100_000, 16);
  oversized.writeUInt32BE(100_000, 20);
  assert.throws(
    () => validateOfficialLogo({ mimetype: 'image/png', buffer: oversized }),
    { statusCode: 400 },
  );
});

test('approved document templates centrally define logo requirements', () => {
  assert.deepEqual(DOCUMENT_BRANDING_TEMPLATES.medical_certificate, {
    issuingLevel: 'municipal',
    logoTypes: ['municipal'],
  });
  assert.deepEqual(DOCUMENT_BRANDING_TEMPLATES.fhsis_m1, {
    issuingLevel: 'barangay',
    logoTypes: ['municipal', 'rhu'],
  });
  assert.deepEqual(DOCUMENT_BRANDING_TEMPLATES.barangay_rhu_referral, {
    issuingLevel: 'barangay-to-rhu',
    logoTypes: ['municipal'],
  });
});

test('residents cannot query document branding configuration', async () => {
  await assert.rejects(
    getDocumentBranding({ user: { id: 'resident-id', role: 'resident' }, documentType: 'fhsis_m1' }),
    { statusCode: 403 },
  );
});

test('non-admin staff cannot view, upload, or remove official logos', async () => {
  const user = { id: 'staff-id', role: 'phn', municipalityId: 'municipality-id' };
  await assert.rejects(getAdminLogoSettings({ user }), { statusCode: 403 });
  await assert.rejects(uploadOfficialLogo({ user }), { statusCode: 403 });
  await assert.rejects(removeOfficialLogo({ user, logoType: 'municipal' }), { statusCode: 403 });
});

test('clients cannot invent a document template or issuing level', async () => {
  await assert.rejects(
    getDocumentBranding({
      user: { id: 'staff-id', role: 'phn', municipalityId: 'municipality-id' },
      documentType: 'arbitrary',
      issuingLevel: 'municipal',
    }),
    { statusCode: 404 },
  );
});
