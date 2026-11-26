// backend/src/services/barangayBoundaries.service.js
import { readFile } from 'node:fs/promises';
import repository from '../repositories/index.js';
import { isApprovedBarangayName } from '../config/barangays.js';
import { getCommunityMap } from './analytics.service.js';
import ApiError from '../utils/apiError.js';

const assetUrl = new URL('../config/piliBarangayBoundaries.geojson', import.meta.url);
const normalize = (value) => String(value ?? '').trim().toLowerCase();
// Exact COD-AB identities: source names retain the PSA poblacion suffix.
const sourceIdentities = new Map([
  ['old san roque', { code: 'PH0501728012', name: 'Old San Roque (Pob.)' }],
  ['san isidro', { code: 'PH0501728019', name: 'San Isidro (Pob.)' }],
  ['san jose', { code: 'PH0501728020', name: 'San Jose' }],
]);
let boundaryAsset;

const loadBoundaries = async () => {
  boundaryAsset ??= readFile(assetUrl, 'utf8').then(JSON.parse).catch((cause) => {
    boundaryAsset = undefined;
    throw Object.assign(new ApiError(503, 'Verified barangay boundaries are unavailable.'), { cause });
  });
  return boundaryAsset;
};

/**
 * Accept only server-created scope. Production getCommunityMap rechecks the
 * actor's stored profile, permission and barangay assignment in PostgreSQL.
 * Intersect its map rows with the active municipality registry before looking
 * up geometry. Never expose the complete bundled collection or a static URL.
 */
export const getBarangayBoundaries = async (
  { actorId = null, barangay = null, municipalityId = null } = {},
  { repo = repository, loadMap = getCommunityMap, ...dependencies } = {},
) => {
  if (!actorId) throw ApiError.unauthorized();
  if (!municipalityId) throw ApiError.forbidden('An assigned municipality is required.');
  if (barangay && !isApprovedBarangayName(barangay)) {
    throw ApiError.unprocessable('The selected barangay is not supported.');
  }

  // Authorize first, including when the asset is missing or the source does not
  // cover this municipality. No client-provided rows are accepted by this API.
  const map = await loadMap({ actorId, barangay, municipalityId }, { repo, ...dependencies });
  if (!map || !Array.isArray(map.barangays) || !['barangay', 'municipality'].includes(map.scope)) {
    throw new ApiError(503, 'Authorized barangay registry could not be verified.');
  }
  const [municipality, registry] = await Promise.all([
    repo.getMunicipality(municipalityId),
    repo.listBarangays({ municipalityId }),
  ]);
  if (!municipality || municipality.id !== municipalityId || !Array.isArray(registry)) {
    throw new ApiError(503, 'Authorized municipality identity could not be verified.');
  }
  const authorized = map.barangays.filter((row) =>
    row?.id && row.registryAvailable === true && isApprovedBarangayName(row.name) &&
    (!barangay || normalize(row.name) === normalize(barangay)) &&
    registry.some((registered) => registered.id === row.id &&
      normalize(registered.name) === normalize(row.name) &&
      (registered.municipality_id ?? registered.municipalityId) === municipalityId &&
      normalize(registered.status) === 'active'));
  // A malformed or stale allowlist must not accidentally widen a barangay scope.
  if ((map.scope === 'barangay' && authorized.length !== 1) ||
      authorized.length !== map.barangays.length ||
      new Set(authorized.map((row) => row.id)).size !== authorized.length) {
    throw ApiError.forbidden('The authorized barangay registry could not be verified.');
  }

  const asset = await loadBoundaries();
  const coveredMunicipality = normalize(municipality.name) === 'pili' &&
    normalize(municipality.province) === 'camarines sur';
  const features = [];
  const unavailable = [];
  for (const row of authorized) {
    const identity = sourceIdentities.get(normalize(row.name));
    const matches = coveredMunicipality && identity ? asset.features.filter((feature) =>
      feature.properties.adm4_pcode === identity.code &&
      feature.properties.adm4_name === identity.name &&
      feature.properties.adm3_pcode === 'PH0501728' &&
      feature.properties.adm3_name === 'Pili (Capital)' &&
      feature.properties.adm2_pcode === 'PH05017' &&
      feature.properties.adm2_name === 'Camarines Sur') : [];
    if (matches.length !== 1) {
      unavailable.push({ barangayId: row.id, name: row.name, reason: 'verified_boundary_unavailable' });
      continue;
    }
    const feature = matches[0];
    features.push({
      ...structuredClone(feature),
      properties: {
        ...structuredClone(feature.properties),
        name: row.name,
        barangayId: row.id,
        sourceFeatureId: feature.id ?? feature.properties.adm4_pcode,
      },
    });
  }
  // Per-feature provenance must be filtered as strictly as the geometry itself.
  const { features: sourceFeatures, ...provenance } = asset.provenance;
  return {
    type: 'FeatureCollection',
    scope: map.scope,
    features,
    unavailable,
    provenance: {
      ...provenance,
      features: sourceFeatures.filter((source) => features.some((feature) =>
        feature.properties.adm4_pcode === source.adm4_pcode)),
    },
  };
};

export default { getBarangayBoundaries };
