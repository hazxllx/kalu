import assert from 'node:assert/strict';
import test from 'node:test';
import { validPurokGeoJson } from '../../src/features/analytics/lib/purokGeometry.js';

const validRing = [[123.273, 13.558], [123.274, 13.558], [123.274, 13.559], [123.273, 13.559], [123.273, 13.558]];
const authoritative = (props = {}) => ({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [validRing] },
    properties: { barangay_id: 'barangay-a', purok: 'Purok 1', ...props },
  }],
});

test('authoritative Polygon and MultiPolygon layers are accepted unchanged', () => {
  const polygon = authoritative();
  assert.equal(validPurokGeoJson(polygon), polygon);
  const multi = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[validRing]] }, properties: { barangay_id: 'barangay-a', purok: 'Purok 2' } }],
  };
  assert.equal(validPurokGeoJson(multi), multi);
});

test('invalid, fabricated, and incomplete geometry is never rendered', () => {
  const cases = [
    null,
    {},
    { type: 'Feature' },
    { type: 'FeatureCollection', features: [] },
    { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[validRing]] }, properties: { purok: 'Purok 1' } }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[validRing]] }, properties: { barangay_id: 'barangay-a' } }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[validRing]] }, properties: { barangay_id: 7, purok: 'Purok 1' } }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[validRing]] }, properties: { barangay_id: 'barangay-a', purok: '   ' } }] },
  ];
  for (const input of cases) assert.equal(validPurokGeoJson(input), null);
});

test('out-of-range or non-closed geometry is rejected rather than inferred', () => {
  const outOfRange = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[123.3, 13.6], [123.4, 13.6], [99, 99], [123.3, 13.6]]] }, properties: { barangay_id: 'barangay-a', purok: 'Purok 1' } }],
  };
  assert.equal(validPurokGeoJson(outOfRange), null);
  const openRing = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[123.273, 13.558], [123.274, 13.558], [123.274, 13.559]]] }, properties: { barangay_id: 'barangay-a', purok: 'Purok 1' } }],
  };
  assert.equal(validPurokGeoJson(openRing), null);
});

test('recorded reference points and health markers are never converted into polygons', () => {
  // A marker-shaped input (single point) must not satisfy the polygon contract.
  assert.equal(validPurokGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [123.273, 13.558] }, properties: { purok: 'Purok 1' } }] }), null);
  // A FeatureCollection with a valid polygon plus one invalid feature is wholly rejected.
  const mixed = authoritative();
  mixed.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [123.273, 13.558] }, properties: { purok: 'Purok 2' } });
  assert.equal(validPurokGeoJson(mixed), null);
});