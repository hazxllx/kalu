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
    logoTypes: ['municipal', 'rhu'],
    officeName: 'OFFICE OF THE MUNICIPAL HEALTH OFFICER',
    title: 'MEDICAL CERTIFICATE',
  });
  assert.deepEqual(DOCUMENT_BRANDING_TEMPLATES.fhsis_m1, {
    issuingLevel: 'barangay',
    logoTypes: ['municipal', 'rhu'],
    officeName: '',
    title: 'FHSIS M1',
  });
  assert.deepEqual(DOCUMENT_BRANDING_TEMPLATES.barangay_rhu_referral, {
    issuingLevel: 'barangay-to-rhu',
    logoTypes: ['municipal', 'rhu'],
    officeName: 'OFFICE OF THE MUNICIPAL HEALTH OFFICER',
    title: 'REFERRAL FORM',
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

test('document branding resolves dynamic organization and authorized signatory data', async () => {
  const pngBytes = pngBuffer();
  const storageDownload = {
    data: {
      arrayBuffer: async () => new Uint8Array(pngBytes).buffer,
    },
    error: null,
  };

  const logoRows = [
    {
      logo_type: 'municipal',
      storage_path: 'official-logos/municipality-id/municipal/a.png',
      mime_type: 'image/png',
      original_filename: 'lgu.png',
      file_size: pngBytes.length,
      uploaded_by: 'admin-id',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const supabase = {
    from(table) {
      const builder = {
        _table: table,
        _op: 'select',
        select() { return this; },
        eq() { return this; },
        limit() { return this; },
        maybeSingle() {
          if (table === 'municipalities') {
            return Promise.resolve({
              data: { id: 'municipality-id', name: 'Pili', province: 'Camarines Sur', region: 'Region V (Bicol)' },
              error: null,
            });
          }
          if (table === 'profiles') {
            return Promise.resolve({
              data: { full_name: 'Rafael C. Salles, M.D.', position: 'Municipal Health Officer', license_no: '069196' },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (table === 'official_logos') return resolve({ data: logoRows, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
    storage: {
      from() {
        return {
          download: async () => storageDownload,
          createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/signed' }, error: null }),
        };
      },
    },
  };

  const result = await getDocumentBranding({
    user: { id: 'mho-id', role: 'mho', municipalityId: 'municipality-id' },
    documentType: 'medical_certificate',
    supabase,
  });

  assert.equal(result.documentType, 'medical_certificate');
  assert.equal(result.organization.municipality, 'Pili');
  assert.equal(result.organization.province, 'Camarines Sur');
  assert.equal(result.organization.region, 'Region V (Bicol)');
  assert.equal(result.organization.officeName, 'OFFICE OF THE MUNICIPAL HEALTH OFFICER');
  assert.equal(result.signatory.fullName, 'Rafael C. Salles, M.D.');
  assert.equal(result.signatory.licenseNumber, '069196');
  assert.deepEqual(result.missingLogoTypes, ['rhu']);
  assert.ok(result.logos.municipal.dataUrl.startsWith('data:image/png;base64,'));
  // RHU facility absent in this stub → empty rhu name, no crash.
  assert.equal(result.organization.rhuName, '');
});
