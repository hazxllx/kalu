/**
 * Validation for an authoritative purok GeoJSON layer.
 *
 * KALUSAGAP currently has NO authoritative purok polygon dataset. This module
 * is the forward-compatible seam an authorized future loader uses to render
 * accurate purok heatmaps: it accepts ONLY a GeoJSON FeatureCollection whose
 * features are Polygon/MultiPolygon with a stable `barangay_id` and a non-empty
 * `purok` identifier. Coordinates are the authoritative geographic truth; they
 * are never derived from names, markers, or recorded reference points. Invalid
 * or fabricated geometry returns `null` and the map falls back to the current
 * recorded-reference view.
 */

/** @param {unknown} layer @returns {GeoJSON.FeatureCollection | null} */
export const validPurokGeoJson = (layer) => {
  if (!layer || layer.type !== 'FeatureCollection' || !Array.isArray(layer.features) || layer.features.length === 0) return null;
  const featureCollection = layer;
  const valid = featureCollection.features.every((feature) => {
    const geometry = feature?.geometry;
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
    const coords = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(1);
    const ringsValid = Array.isArray(coords) && coords.length > 0 && coords.every((ring) =>
      Array.isArray(ring) && ring.length >= 4 && ring.every((position) =>
        Array.isArray(position) && position.length >= 2 &&
        Number.isFinite(position[0]) && Number.isFinite(position[1]) &&
        position[1] >= -90 && position[1] <= 90 && position[0] >= -180 && position[0] <= 180));
    const properties = feature?.properties || {};
    return ringsValid && typeof properties.barangay_id === 'string' && properties.barangay_id.length > 0 &&
      typeof properties.purok === 'string' && properties.purok.trim().length > 0;
  });
  return valid ? featureCollection : null;
};

export default validPurokGeoJson;