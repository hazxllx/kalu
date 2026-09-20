import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDocumentUpload,
  ALLOWED_DOCUMENT_TYPES,
  GOVERNMENT_ID_TYPES,
  MAX_FILE_SIZE,
} from '../src/validators/documents.validators.js';

const makeFile = (name, type, size) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

test('registration documents accept PDF/JPG/PNG up to 10 MB', () => {
  for (const [name, type] of [['a.pdf', 'application/pdf'], ['a.jpg', 'image/jpeg'], ['a.png', 'image/png']]) {
    const result = validateDocumentUpload({ file: makeFile(name, type, 1024), documentType: 'proof_of_residency' });
    assert.ok(!result.error, `${name} rejected: ${JSON.stringify(result.error)}`);
  }
  const atLimit = validateDocumentUpload({ file: makeFile('a.pdf', 'application/pdf', MAX_FILE_SIZE), documentType: 'proof_of_residency' });
  assert.ok(!atLimit.error, 'file at exactly 10 MB should be accepted');
});

test('registration documents reject unsafe types and oversize files', () => {
  const badType = validateDocumentUpload({ file: makeFile('a.exe', 'application/octet-stream', 1024), documentType: 'proof_of_residency' });
  assert.ok(badType.error?.file, 'executable must be rejected');

  const oversize = validateDocumentUpload({ file: makeFile('a.pdf', 'application/pdf', MAX_FILE_SIZE + 1), documentType: 'proof_of_residency' });
  assert.ok(oversize.error?.file, 'file over 10 MB must be rejected');

  const empty = validateDocumentUpload({ file: makeFile('a.pdf', 'application/pdf', 0), documentType: 'proof_of_residency' });
  assert.ok(empty.error?.file, 'empty file must be rejected');
});

test('government ID front/back require a valid ID type', () => {
  const missing = validateDocumentUpload({ file: makeFile('f.jpg', 'image/jpeg', 1024), documentType: 'government_id_front' });
  assert.ok(missing.error?.governmentIdType, 'missing ID type must be rejected');

  const other = validateDocumentUpload({ file: makeFile('f.jpg', 'image/jpeg', 1024), documentType: 'government_id_front', governmentIdType: 'other' });
  assert.ok(other.error?.governmentIdType, 'generic "other" without a specified type must be rejected');

  const customOther = validateDocumentUpload({
    file: makeFile('f.jpg', 'image/jpeg', 1024),
    documentType: 'government_id_front',
    governmentIdType: 'other',
    governmentIdTypeOther: 'BIR ID',
  });
  assert.ok(!customOther.error, JSON.stringify(customOther.error));
  assert.equal(customOther.value.governmentIdType, 'BIR ID');

  const valid = validateDocumentUpload({ file: makeFile('f.jpg', 'image/jpeg', 1024), documentType: 'government_id_front', governmentIdType: 'drivers_license' });
  assert.ok(!valid.error, JSON.stringify(valid.error));
  assert.equal(valid.value.governmentIdType, 'drivers_license');

  const back = validateDocumentUpload({ file: makeFile('b.jpg', 'image/jpeg', 1024), documentType: 'government_id_back', governmentIdType: 'umid' });
  assert.ok(!back.error, JSON.stringify(back.error));
  assert.equal(back.value.governmentIdType, 'umid');
});

test('identity photo and proof of residency accept valid uploads', () => {
  const photo = validateDocumentUpload({ file: makeFile('selfie.png', 'image/png', 2048), documentType: 'identity_photo' });
  assert.ok(!photo.error, JSON.stringify(photo.error));

  const residency = validateDocumentUpload({ file: makeFile('residency.pdf', 'application/pdf', 2048), documentType: 'proof_of_residency' });
  assert.ok(!residency.error, JSON.stringify(residency.error));
});

test('structured document types are registered', () => {
  for (const type of ['government_id_front', 'government_id_back', 'identity_photo']) {
    assert.ok(ALLOWED_DOCUMENT_TYPES.includes(type), `${type} must be an allowed document type`);
  }
  assert.ok(GOVERNMENT_ID_TYPES.includes('philsys'));
  assert.ok(GOVERNMENT_ID_TYPES.includes('postal_id'));
});