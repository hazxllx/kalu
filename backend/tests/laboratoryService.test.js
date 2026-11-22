import assert from 'node:assert/strict';
import test from 'node:test';
import { list, upload, download, linkConsultation, validateLaboratoryFile } from '../src/services/laboratory.service.js';

const RESIDENT = { id: 'resident-user', role: 'resident' };
const STAFF = { id: 'staff-user', role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' };
const DOC_ID = '11111111-1111-4111-8111-111111111111';
const pdf = () => new File(['%PDF-1.7\nSynthetic test document'], 'CBC.pdf', { type: 'application/pdf' });
function fixture() {
  const state = { residents: [
    { id: 'r1', auth_user_id: RESIDENT.id, barangay_id: 'b1', municipality_id: 'm1' },
    { id: 'r2', auth_user_id: 'other-user', barangay_id: 'b2', municipality_id: 'm1' },
    { id: 'r3', auth_user_id: 'third-user', barangay_id: 'b3', municipality_id: 'm2' },
  ], resident_laboratory_documents: [], visits: [{ id: 'v1', resident_id: 'r1' }, { id: 'v2', resident_id: 'r2' }],
  health_audit_logs: [], bytes: new Map(), downloads: 0, insertError: false, responseLost: false, probeError: false };
  const client = {
    from(table) {
      const filters = [];
      let insertRow;
      let range;
      const query = {
        select() { return query; }, order() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        range(start, end) { range = [start, end]; return query; },
        insert(row) { insertRow = row; return query; },
        then(resolve, reject) { return run(false).then(resolve, reject); },
        maybeSingle() { return run(true); }, single() { return run(true); },
      };
      const run = async (single) => {
        if (insertRow) {
          if (state.insertError && table === 'resident_laboratory_documents') return { error: { message: 'insert failed' } };
          const saved = { uploaded_at: '2026-11-20T12:00:00Z', consultation_id: null, ...insertRow };
          state[table].push(saved);
          if (state.responseLost && table === 'resident_laboratory_documents') return { error: { message: 'response lost' } };
          return { data: single ? saved : [saved], error: null };
        }
        if (state.probeError && table === 'resident_laboratory_documents') return { error: { message: 'probe unavailable' } };
        let rows = state[table].filter((row) => filters.every((match) => match(row)));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return { data: single ? rows[0] || null : rows, error: null };
      };
      return query;
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'resident-laboratory');
      return {
        async upload(path, bytes, options) {
          assert.equal(options.upsert, false); state.bytes.set(path, bytes); return { data: { path }, error: null };
        },
        async remove(paths) { for (const path of paths) state.bytes.delete(path); return { error: null }; },
        async download(path) { state.downloads += 1; return { data: new Blob([state.bytes.get(path)]), error: null }; },
      };
    } },
    async rpc(name, args) {
      assert.equal(name, 'link_resident_laboratory_document');
      assert.equal(args.p_actor_id, STAFF.id);
      const row = state.resident_laboratory_documents.find((doc) => doc.id === args.p_id);
      row.consultation_id = args.p_consultation_id;
      return { data: { ...row }, error: null };
    },
  };
  const seed = (residentId = 'r1') => {
    const row = { id: DOC_ID, resident_id: residentId, consultation_id: null, category: 'cbc', file_name: 'CBC.pdf',
      content_type: 'application/pdf', size_bytes: 30, storage_path: `${residentId}/${DOC_ID}.pdf`, uploaded_at: '2026-11-20T12:00:00Z' };
    state.resident_laboratory_documents.push(row); state.bytes.set(row.storage_path, Buffer.from('%PDF-1.7'));
    return row;
  };
  return { state, client, seed };
}

test('resident laboratory upload derives ownership, stores bytes and metadata, and never returns storage paths', async () => {
  const f = fixture();
  const first = await upload({ user: RESIDENT, category: 'cbc', file: pdf(), client: f.client, residentId: 'r2' });
  const second = await upload({ user: RESIDENT, category: 'other', file: pdf(), client: f.client });
  assert.equal(first.residentId, 'r1');
  assert.notEqual(first.id, second.id);
  assert.equal(first.verifiedClinicalFinding, false);
  assert.equal(first.storagePath, undefined);
  assert.equal(first.uploadedAt, '2026-11-20T12:00:00Z');
  assert.equal(f.state.bytes.size, 2);
  assert.equal(f.state.resident_laboratory_documents[0].uploaded_by, RESIDENT.id);
  const own = await list({ user: RESIDENT, residentId: 'r2', client: f.client });
  assert.equal(own.length, 2);
  assert.ok(own.every((row) => row.residentId === 'r1'));
});

test('other residents, unassigned BHS and cross-barangay/cross-municipality staff cannot list or retrieve files', async () => {
  const f = fixture(); f.seed('r2');
  for (const user of [RESIDENT, STAFF, { ...STAFF, barangayId: null }, { ...STAFF, role: 'bhw' },
    { ...STAFF, role: 'rhu_personnel' }, { ...STAFF, role: 'phn', municipalityId: 'm2' }]) {
    await assert.rejects(download({ user, id: DOC_ID, client: f.client }), (error) => [403, 404].includes(error.statusCode));
  }
  await assert.rejects(list({ user: STAFF, residentId: 'r2', client: f.client }), { statusCode: 404 });
  assert.equal(f.state.downloads, 0);
});

test('assigned BHS and municipal PHN retrieve actual bytes with access audit; staff cannot upload', async () => {
  const f = fixture(); f.seed();
  for (const user of [RESIDENT, STAFF, { ...STAFF, role: 'phn', barangayId: null }]) {
    const result = await download({ user, id: DOC_ID, client: f.client });
    assert.equal(await result.file.text(), '%PDF-1.7');
    assert.equal(result.document.verifiedClinicalFinding, false);
  }
  assert.equal(f.state.health_audit_logs.length, 3);
  await assert.rejects(upload({ user: STAFF, category: 'cbc', file: pdf(), client: f.client }), { statusCode: 403 });
});

test('metadata hidden by the user-scoped read cannot be fetched from private storage', async () => {
  const f = fixture(); f.seed();
  const metadataClient = { from(table) {
    assert.equal(table, 'resident_laboratory_documents');
    const query = { select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => ({ data: null }), range: async () => ({ data: [] }) };
    return query;
  } };
  assert.deepEqual(await list({ user: STAFF, residentId: 'r1', client: f.client, metadataClient }), []);
  await assert.rejects(download({ user: STAFF, id: DOC_ID, client: f.client, metadataClient }), { statusCode: 404 });
  assert.equal(f.state.downloads, 0);
});

test('file validation rejects spoofed MIME/extensions, empty/oversized data and unsupported categories', async () => {
  for (const file of [new File(['not pdf'], 'result.pdf', { type: 'application/pdf' }),
    new File(['%PDF-1.7'], 'result.exe', { type: 'application/pdf' }),
    new File(['<svg/>'], 'result.svg', { type: 'image/svg+xml' }),
    new File([], 'result.pdf', { type: 'application/pdf' }),
    { name: 'big.pdf', type: 'application/pdf', size: 10485761 }]) {
    await assert.rejects(validateLaboratoryFile(file), (error) => [413, 415].includes(error.statusCode));
  }
  const f = fixture();
  await assert.rejects(upload({ user: RESIDENT, category: 'verified', file: pdf(), client: f.client }), { statusCode: 422 });
  assert.equal(f.state.bytes.size, 0);
});

test('confirmed insert failure cleans orphan bytes; response loss recovers committed document and uncertain writes retain bytes', async () => {
  const failed = fixture(); failed.state.insertError = true;
  await assert.rejects(upload({ user: RESIDENT, category: 'cbc', file: pdf(), client: failed.client }), { statusCode: 503 });
  assert.equal(failed.state.bytes.size, 0);
  const lost = fixture(); lost.state.responseLost = true;
  const doc = await upload({ user: RESIDENT, category: 'cbc', file: pdf(), client: lost.client });
  assert.ok(doc.id); assert.equal(lost.state.bytes.size, 1);
  const uncertain = fixture(); uncertain.state.responseLost = true; uncertain.state.probeError = true;
  await assert.rejects(upload({ user: RESIDENT, category: 'cbc', file: pdf(), client: uncertain.client }), { statusCode: 503 });
  assert.equal(uncertain.state.bytes.size, 1);
});

test('only scoped staff can link an existing same-patient consultation and replays preserve history', async () => {
  const f = fixture(); f.seed();
  await assert.rejects(linkConsultation({ user: RESIDENT, id: DOC_ID, consultationId: 'v1', client: f.client }), { statusCode: 403 });
  await assert.rejects(linkConsultation({ user: STAFF, id: DOC_ID, consultationId: 'v2', client: f.client }), { statusCode: 404 });
  const linked = await linkConsultation({ user: STAFF, id: DOC_ID, consultationId: 'v1', client: f.client });
  assert.equal(linked.consultationId, 'v1');
  assert.deepEqual(await linkConsultation({ user: STAFF, id: DOC_ID, consultationId: 'v1', client: f.client }), linked);
});

test('laboratory listing pages through the database row limit to retain older documents', async () => {
  const f = fixture();
  for (let index = 0; index < 405; index += 1) f.seed();
  assert.equal((await list({ user: RESIDENT, client: f.client })).length, 405);
});
