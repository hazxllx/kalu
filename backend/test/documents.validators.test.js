import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDocumentUpload } from '../src/validators/documents.validators.js';

/**
 * Document upload validation — focus on the identity photo (holding-ID selfie)
 * image-only rule added for the resubmission flow, without weakening the
 * existing ID front/back rules (which still accept PDF).
 */

const fileOf = (name, type, size = 1024) => new File([new Uint8Array(size)], name, { type });

test('identity_photo accepts a JPG/PNG image', () => {
  const jpg = validateDocumentUpload({
    file: fileOf('selfie.jpg', 'image/jpeg'),
    documentType: 'identity_photo',
    residentId: 'RES-1',
  });
  assert.equal(jpg.error, undefined);
  assert.equal(jpg.value.documentType, 'identity_photo');
});

test('identity_photo rejects a PDF (must be a photo)', () => {
  const pdf = validateDocumentUpload({
    file: fileOf('selfie.pdf', 'application/pdf'),
    documentType: 'identity_photo',
    residentId: 'RES-1',
  });
  assert.ok(pdf.error);
  assert.ok(pdf.error.file);
});

test('government_id_front still accepts a PDF (unchanged rule)', () => {
  const pdf = validateDocumentUpload({
    file: fileOf('id-front.pdf', 'application/pdf'),
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    residentId: 'RES-1',
  });
  assert.equal(pdf.error, undefined);
});

test('government_id_front requires a government ID type', () => {
  const missing = validateDocumentUpload({
    file: fileOf('id-front.jpg', 'image/jpeg'),
    documentType: 'government_id_front',
    residentId: 'RES-1',
  });
  assert.ok(missing.error);
  assert.ok(missing.error.governmentIdType);
});

test('an oversized file is rejected', () => {
  const big = validateDocumentUpload({
    file: fileOf('huge.jpg', 'image/jpeg', 11 * 1024 * 1024),
    documentType: 'identity_photo',
    residentId: 'RES-1',
  });
  assert.ok(big.error);
  assert.ok(big.error.file);
});
