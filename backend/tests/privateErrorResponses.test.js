import assert from 'node:assert/strict';
import test from 'node:test';
import errorHandler from '../src/middleware/errorHandler.js';
import ApiError from '../src/utils/apiError.js';

const responseFor = (error) => {
  let payload;
  let status;
  const res = { status(value) { status = value; return res; }, json(value) { payload = value; } };
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try { errorHandler(error, { method: 'GET', path: '/test', requestId: 'test' }, res, () => {}); }
  finally { console.error = originalError; console.warn = originalWarn; }
  return { payload, status };
};

test('internal PostgreSQL failure details never expose SQL/clinical values through API error carriers', () => {
  const result = responseFor(Object.assign(new Error('Database failed'), { statusCode: 500, details: { sql: 'internal statement', privateValue: 'synthetic-private-value' } }));
  assert.equal(result.status, 500);
  assert.equal('details' in result.payload.error, false);
  assert.equal('errors' in result.payload.error, false);
  assert.equal(JSON.stringify(result.payload).includes('synthetic-private-value'), false);
});

test('safe validation and resident conflict revision details remain usable by the UI', () => {
  const validation = responseFor(ApiError.unprocessable('Invalid field', { field: 'currentAddress' }));
  assert.deepEqual(validation.payload.error.details, { field: 'currentAddress' });
  const conflict = responseFor(ApiError.staleRevision('Review required', { currentRevision: 4 }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.error.code, 'STALE_REVISION');
  assert.deepEqual(conflict.payload.error.details, { currentRevision: 4 });
});
