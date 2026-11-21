import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { getBarangayBoundaries } from '../src/services/barangayBoundaries.service.js';
import { createBarangayBoundariesController } from '../src/controllers/barangayBoundaries.controller.js';

const asset = JSON.parse(await readFile(new URL('../src/config/piliBarangayBoundaries.geojson', import.meta.url), 'utf8'));
const municipality = { id: 'pili-id', name: 'Pili', province: 'Camarines Sur' };
const registry = [
  { id: 'san-antonio-id', name: 'San Antonio', municipality_id: 'pili-id', status: 'Active' },
  { id: 'san-isidro-id', name: 'San Isidro', municipality_id: 'pili-id', status: 'Active' },
  { id: 'old-san-roque-id', name: 'Old San Roque', municipality_id: 'pili-id', status: 'Active' },
];
const scope = { actorId: 'supervisor-id', municipalityId: 'pili-id', barangay: 'San Isidro' };
const mapRows = (rows) => rows.map(({ id, name }) => ({ id, name, registryAvailable: true }));
const deps = (overrides = {}) => ({
  repo: {
    getMunicipality: async (id) => id === municipality.id ? municipality : null,
    listBarangays: async ({ municipalityId }) => registry.filter((row) => row.municipality_id === municipalityId),
  },
  loadMap: async () => ({ scope: 'barangay', barangays: mapRows([registry[1]]) }),
  ...overrides,
});

test('asset contains exactly three sourced Pili barangay polygons with complete provenance', () => {
  assert.equal(asset.type, 'FeatureCollection');
  assert.equal(asset.features.length, 3);
  assert.deepEqual(asset.features.map((f) => f.properties.adm4_name.replace(/ \(Pob\.\)$/, '')).sort(),
    ['Old San Roque', 'San Isidro', 'San Jose']);
  assert.equal(asset.provenance.retrievedOn, '2026-11-21');
  assert.match(asset.provenance.sourceUrl, /^https:\/\/data\.humdata\.org\//);
  assert.match(asset.provenance.licenseUrl, /creativecommons\.org\/licenses\/by\/3\.0\/igo\/legalcode$/);
  assert.equal(new Set(asset.features.map((f) => f.properties.adm4_pcode)).size, 3);
  for (const feature of asset.features) {
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.properties.adm3_name, 'Pili (Capital)');
    assert.equal(feature.properties.adm3_pcode, 'PH0501728');
    assert.equal(feature.properties.adm2_name, 'Camarines Sur');
    assert.equal(feature.properties.adm0_name, 'Philippines');
    assert.match(feature.properties.adm4_pcode, /^PH\d{10}$/);
    assert.equal(feature.properties.adm4_pcode, {
      'Old San Roque (Pob.)': 'PH0501728012',
      'San Isidro (Pob.)': 'PH0501728019',
      'San Jose': 'PH0501728020',
    }[feature.properties.adm4_name]);
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
    const provenance = asset.provenance.features.find((f) => f.adm4_pcode === feature.properties.adm4_pcode);
    assert.ok(provenance);
    assert.equal(provenance.geometrySha256, createHash('sha256').update(JSON.stringify(feature.geometry)).digest('hex'));
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    assert.ok(polygons.length > 0);
    for (const rings of polygons) {
      assert.ok(rings.length > 0);
      for (const ring of rings) {
        assert.ok(ring.length >= 4);
        assert.deepEqual(ring[0], ring.at(-1));
        let area = 0;
        for (let i = 0; i < ring.length; i += 1) {
          const point = ring[i];
          assert.equal(point.length, 2);
          assert.ok(point.every(Number.isFinite));
          assert.ok(point[0] > 123 && point[0] < 124, 'Longitude must be in Pili, not swapped');
          assert.ok(point[1] > 13 && point[1] < 14, 'Latitude must be in Pili, not swapped');
          const next = ring[(i + 1) % ring.length];
          area += point[0] * next[1] - next[0] * point[1];
        }
        assert.ok(Math.abs(area) > 1e-12, 'Ring must enclose nonzero area');
      }
    }
  }
});

test('supervisor receives only their authorized polygon and filtered provenance', async () => {
  let supplied;
  const result = await getBarangayBoundaries(scope, deps({ loadMap: async (received) => {
    supplied = received;
    return { scope: 'barangay', barangays: mapRows([registry[1]]) };
  } }));
  assert.deepEqual(supplied, scope);
  assert.equal(result.type, 'FeatureCollection');
  assert.deepEqual(result.features.map((f) => f.properties.name), ['San Isidro']);
  assert.equal(result.features[0].properties.barangayId, 'san-isidro-id');
  assert.equal(result.provenance.features.length, 1);
  assert.equal(result.provenance.features[0].adm4_pcode, result.features[0].properties.adm4_pcode);
  assert.deepEqual(result.unavailable, []);
  const original = asset.features.find((f) => f.properties.adm4_pcode === result.features[0].properties.adm4_pcode);
  assert.deepEqual(result.features[0].geometry, original.geometry);
  result.features[0].geometry.coordinates.length = 0;
  assert.ok((await getBarangayBoundaries(scope, deps())).features[0].geometry.coordinates.length > 0);
});

test('municipality result intersects the allowlist and reports unsupported San Antonio without fabricating it', async () => {
  const result = await getBarangayBoundaries({ ...scope, barangay: null }, deps({
    loadMap: async () => ({ scope: 'municipality', barangays: mapRows(registry) }),
  }));
  assert.deepEqual(result.features.map((f) => f.properties.name).sort(), ['Old San Roque', 'San Isidro']);
  assert.deepEqual(result.unavailable, [{ barangayId: 'san-antonio-id', name: 'San Antonio', reason: 'verified_boundary_unavailable' }]);
  assert.ok(!JSON.stringify(result).includes('San Jose'), 'Unassigned source features must not leak via provenance');
});

test('requests cannot use unknown barangays or missing authentication to expose static data', async () => {
  let called = false;
  const dependencies = deps({ loadMap: async () => { called = true; throw new Error('Must not load'); } });
  await assert.rejects(getBarangayBoundaries({}, dependencies), { statusCode: 401 });
  await assert.rejects(getBarangayBoundaries({ actorId: scope.actorId }, dependencies), { statusCode: 403 });
  await assert.rejects(getBarangayBoundaries({ ...scope, barangay: 'San Jose' }, dependencies), { statusCode: 422 });
  await assert.rejects(getBarangayBoundaries({ ...scope, barangay: 'Unknown' }, dependencies), { statusCode: 422 });
  assert.equal(called, false);
});

test('denied DB authorization and unavailable registry fail closed', async () => {
  const denied = Object.assign(new Error('Forbidden'), { statusCode: 403 });
  await assert.rejects(getBarangayBoundaries(scope, deps({ loadMap: async () => { throw denied; } })), (error) => error === denied);
  await assert.rejects(getBarangayBoundaries(scope, deps({ loadMap: async () => ({ scope: 'barangay', barangays: [] }) })), { statusCode: 403 });
  await assert.rejects(getBarangayBoundaries(scope, deps({ loadMap: async () => ({ scope: 'barangay', barangays: [{ id: 'invented', name: 'San Isidro', registryAvailable: true }] }) })), { statusCode: 403 });
  await assert.rejects(getBarangayBoundaries(scope, deps({ loadMap: async () => ({ scope: 'barangay', barangays: mapRows(registry) }) })), { statusCode: 403 });
  await assert.rejects(getBarangayBoundaries(scope, deps({ repo: { getMunicipality: async () => null, listBarangays: async () => registry } })), { statusCode: 503 });
});

test('inactive, mismatched and missing municipality registry rows never authorize a polygon', async () => {
  for (const altered of [
    { ...registry[1], status: 'Inactive' },
    { ...registry[1], municipality_id: 'another-municipality' },
    { ...registry[1], municipality_id: undefined },
    { ...registry[1], name: 'Different name' },
  ]) {
    await assert.rejects(getBarangayBoundaries(scope, deps({ repo: {
      getMunicipality: async () => municipality,
      listBarangays: async () => [altered],
    } })), { statusCode: 403 });
  }
});

test('a same-named authorized barangay in another municipality cannot receive Pili geometry', async () => {
  const result = await getBarangayBoundaries(scope, deps({ repo: {
    getMunicipality: async () => ({ ...municipality, name: 'Other town' }),
    listBarangays: async () => registry,
  } }));
  assert.deepEqual(result.features, []);
  assert.equal(result.unavailable.length, 1);
  assert.deepEqual(result.provenance.features, []);
});

test('production delegation keeps DB authorization authoritative and propagates RPC denial', async () => {
  let args;
  const result = await getBarangayBoundaries(scope, {
    repo: { ...deps().repo, mode: 'supabase' },
    rpc: async (name, params) => {
      args = { name, params };
      return { data: { scope: 'barangay', barangays: mapRows([registry[1]]), conditionTotals: [], summary: {} } };
    },
  });
  assert.equal(args.name, 'scoped_aggregate_analytics');
  assert.equal(args.params.p_actor_id, scope.actorId);
  assert.equal(args.params.p_kind, 'community-map');
  assert.equal(args.params.p_barangay, scope.barangay);
  assert.equal(result.features.length, 1);
  await assert.rejects(getBarangayBoundaries(scope, {
    repo: { ...deps().repo, mode: 'supabase' },
    rpc: async () => ({ error: { code: '42501', message: 'Outside assigned scope' } }),
  }), { statusCode: 403 });
});

test('controller takes actor and municipality only from session and pins supervisor assignment', async () => {
  let actual;
  const handler = createBarangayBoundariesController({ service: async (received) => { actual = received; return { type: 'FeatureCollection', features: [] }; } });
  const headers = {};
  let body;
  const res = { set: (key, value) => { headers[key] = value; }, status: () => res, json: (value) => { body = value; } };
  const req = {
    user: { id: scope.actorId, role: 'health_supervisor', barangay: scope.barangay, municipalityId: scope.municipalityId },
    query: { actorId: 'other-actor', municipalityId: 'other-municipality' },
  };
  await handler(req, res);
  assert.deepEqual(actual, scope);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(body.data.type, 'FeatureCollection');
  await assert.rejects(handler({ ...req, query: { barangay: 'Old San Roque' } }, res), { statusCode: 403 });
  await assert.rejects(handler({ ...req, user: { ...req.user, barangay: null } }, res), { statusCode: 403 });
  await assert.rejects(handler({ ...req, query: { barangay: ['San Isidro', 'Old San Roque'] } }, res), { statusCode: 422 });
});
