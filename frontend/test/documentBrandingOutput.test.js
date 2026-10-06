import test from 'node:test';
import assert from 'node:assert/strict';
import { renderM1FhsisPdf } from '../src/features/health-records/lib/m1FhsisPdfRenderer.js';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';

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
