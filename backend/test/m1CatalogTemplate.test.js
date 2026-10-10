import assert from 'node:assert/strict';
import test from 'node:test';
import { M1_INDICATORS } from '../src/config/m1Catalog.js';
import { M1_FORM_TEMPLATE } from '../../frontend/src/features/health-records/lib/m1OfficialFormTemplate.js';

const collectTemplateCodes = (value, codes = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTemplateCodes(item, codes));
  } else if (value && typeof value === 'object') {
    if (value.code) codes.push(value.code);
    Object.values(value).forEach((item) => collectTemplateCodes(item, codes));
  }
  return codes;
};

const catalogCodes = M1_INDICATORS.map((indicator) => indicator.code);
const templateCodes = collectTemplateCodes(M1_FORM_TEMPLATE);
const duplicateCodes = (codes) => codes.filter((code, index) => codes.indexOf(code) !== index);

test('M1 catalog indicator codes are unique and fully source-mapped', async () => {
  assert.deepEqual([...new Set(duplicateCodes(catalogCodes))], []);
  assert.equal(M1_INDICATORS.every((indicator) => (
    indicator.code
    && indicator.section
    && indicator.subsection
    && indicator.name
    && indicator.source
    && indicator.aggregation
  )), true);
});

test('official M1 template contains no unknown or duplicate catalog codes', async () => {
  assert.deepEqual([...new Set(duplicateCodes(templateCodes))], []);
  assert.deepEqual(
    [...new Set(templateCodes.filter((code) => !catalogCodes.includes(code)))],
    [],
  );
});

test('unresolved catalog-to-template gap remains explicit and bounded', async () => {
  const missingFromTemplate = catalogCodes.filter((code) => !templateCodes.includes(code));
  assert.deepEqual(missingFromTemplate, [
    'A3_1',
    'B1_7',
    'B2_22',
    'B2_22a',
    'B2_22b',
    'B2_25',
    'C2_23',
    'C2_24',
    'C2_25',
    'C2_26',
    'C2_27',
    'C2_29',
    'C2_32',
    'C2_status_overweight',
    'C2_status_normal',
    'C3_35',
    'C3_35a',
    'D_1',
    'D_2',
    'D_3',
    'D_4',
    'D_5',
    'D_6',
    'D_7',
    'D_8',
    'D_9',
    'D_10',
    'E2_3',
    'E2_4',
    'E2_5',
    'E2_6',
    'E5_1',
    'E5_2',
    'E5_3',
    'E5_4',
    'E6_1',
    'E6_2',
    'G_5',
    'G_6',
    'H1_1',
    'H1_3',
    'H1_5',
    'H1_6',
    'H1_7',
    'H1_8',
    'H1_detail',
  ]);
});
