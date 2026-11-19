import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getServiceClient } from '../config/supabase.js';
import {
  DOCUMENT_BRANDING_TEMPLATES,
  OFFICIAL_LOGO_TYPES,
} from '../config/documentBranding.js';
import ApiError from '../utils/apiError.js';

/**
 * KALUSAGAP — Official Document Branding & Logo Management Service (`documentBranding.service.js`).
 *
 * Architectural layer:
 *   `documentBranding.routes -> authenticate -> authorize / upload -> documentBranding.controller -> documentBranding.service -> Supabase Storage & PostgreSQL`
 *
 * Responsibilities:
 *   - Manages municipality-scoped official seals/logos (`municipal`, `rhu`) stored
 *     privately in the Supabase Storage `documents` bucket and indexed in the
 *     `official_logos` table via atomic RPCs (`save_official_logo`, `remove_official_logo`).
 *   - Provides short-lived signed preview URLs (`SIGNED_URL_SECONDS = 600`) for the
 *     System Administrator branding configuration screen (`getAdminLogoSettings`).
 *   - Resolves complete branding payloads for official health documents and
 *     certificates (`getDocumentBranding`), combining template metadata
 *     (`DOCUMENT_BRANDING_TEMPLATES`), inline base64 data URLs for configured logos,
 *     municipality and RHU facility records (`municipalities`, `facilities`), and
 *     active Municipal Health Officer (`mho`) signatory credentials (`profiles`).
 */

const BUCKET = 'documents';
const SIGNED_URL_SECONDS = 600;
const ALLOWED_ROLES = new Set([
  'admin',
  'mho',
  'phn',
  'rhu_personnel',
  'health_supervisor',
  'bhw',
]);

/** Ensure the requested logo slot is a supported official logo type (`municipal` or `rhu`). */
const assertLogoType = (logoType) => {
  if (!OFFICIAL_LOGO_TYPES.includes(logoType)) {
    throw ApiError.notFound('Official logo type not found.');
  }
};

/**
 * Resolve the municipality UUID governing the caller's branding operations.
 *
 * Staff accounts use their assigned `user.municipalityId`. Unassigned `admin`
 * accounts automatically resolve to the sole active municipality in single-LGU
 * deployments, or receive `409 Conflict` in multi-municipality deployments until
 * explicitly assigned.
 *
 * @param {Object} user - Authenticated user context.
 * @param {Object} supabase - Supabase service client.
 * @returns {Promise<string>} Resolved municipality UUID.
 */
const requireMunicipality = async (user, supabase) => {
  if (user?.municipalityId) return user.municipalityId;
  if (user?.role === 'admin') {
    const { data, error } = await supabase
      .from('municipalities')
      .select('id')
      .eq('is_active', true)
      .limit(2);
    throwOnSupabaseError(error, 'Could not resolve the administrator municipality scope');
    if (data?.length === 1) return data[0].id;
    throw ApiError.conflict(
      'Assign the System Administrator to a municipality before managing branding for a multi-municipality deployment.',
    );
  }
  throw ApiError.conflict('Your account must be assigned to a municipality to use official branding.');
};

/** Strip directory components and ASCII control characters from an uploaded logo filename. */
const cleanFilename = (name) =>
  path.basename(String(name || 'official-logo'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 180) || 'official-logo';

const throwOnSupabaseError = (error, message) => {
  if (error) {
    throw Object.assign(new Error(`${message}: ${error.message || 'storage request failed'}`), {
      statusCode: 500,
    });
  }
};

/** Fetch all active `official_logos` metadata rows for a municipality. */
const getLogoRows = async (supabase, municipalityId) => {
  const { data, error } = await supabase
    .from('official_logos')
    .select('logo_type, storage_path, original_filename, mime_type, file_size, uploaded_by, created_at, updated_at')
    .eq('municipality_id', municipalityId);
  throwOnSupabaseError(error, 'Could not load official logo settings');
  return data || [];
};

/** Generate a 10-minute signed preview URL and metadata DTO for a stored `official_logos` row. */
const signedLogo = async (supabase, row) => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  throwOnSupabaseError(error, 'Could not create an official logo preview link');
  if (!data?.signedUrl) {
    throw Object.assign(new Error('Could not create an official logo preview link.'), {
      statusCode: 500,
    });
  }
  return {
    type: row.logo_type,
    url: data.signedUrl,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Retrieve the municipality details and signed preview URLs for configured
 * `municipal` and `rhu` logos for the System Administrator settings panel.
 *
 * Restricted strictly to `admin` callers (`403 Forbidden` otherwise).
 *
 * @param {Object} [params] - Call parameters (`user`).
 * @returns {Promise<Object>} `{ municipality, logos: { municipal, rhu } }`.
 */
export const getAdminLogoSettings = async ({ user } = {}) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may view official logo settings.');
  }
  const supabase = getServiceClient();
  const municipalityId = await requireMunicipality(user, supabase);
  const [rows, municipalityResult] = await Promise.all([
    getLogoRows(supabase, municipalityId),
    supabase.from('municipalities').select('id, name, province').eq('id', municipalityId).maybeSingle(),
  ]);
  throwOnSupabaseError(municipalityResult.error, 'Could not load municipality branding scope');
  if (!municipalityResult.data) {
    throw ApiError.conflict('Your account is assigned to a municipality that is no longer available.');
  }
  const entries = await Promise.all(rows.map(async (row) => [row.logo_type, await signedLogo(supabase, row)]));
  const logos = Object.fromEntries(entries);
  return {
    municipality: municipalityResult.data,
    logos: {
      municipal: logos.municipal || null,
      rhu: logos.rhu || null,
    },
  };
};

/**
 * Resolve the organization + authorized signatory data a document generator
 * needs, from the existing database tables (municipalities, facilities,
 * profiles). Nothing here is hardcoded.
 */
const loadOrganizationAndSignatory = async (supabase, municipalityId, documentType, user = null) => {
  const template = DOCUMENT_BRANDING_TEMPLATES[documentType];

  const municipality = await (async () => {
    const { data, error } = await supabase
      .from('municipalities')
      .select('id, name, province, region')
      .eq('id', municipalityId)
      .maybeSingle();
    throwOnSupabaseError(error, 'Could not load municipality branding scope');
    return data || null;
  })();

  // RHU facility: the first facility of type 'rhu' in the municipality. Address
  // is optional (the seed stores the RHU with no address yet).
  const [facilityRows] = await Promise.all([
    supabase
      .from('facilities')
      .select('name, type, address')
      .eq('municipality_id', municipalityId)
      .eq('type', 'rhu')
      .limit(5),
  ]);
  throwOnSupabaseError(facilityRows.error, 'Could not load RHU facility settings');
  const rhu = (facilityRows.data || []).find((f) => f.name) || null;

  // Authorized signatory: prefer an active MHO (the required approval role for
  // medical documents). Falls back to the profile of the requesting user when no
  // MHO profile is stored. Only identity fields are surfaced; the signatory is
  // resolved server-side and stamped at issue time by the certificate service.
  let signatory = null;
  try {
    const mho = await supabase
      .from('profiles')
      .select('full_name, position, license_no')
      .eq('role', 'mho')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    throwOnSupabaseError(mho.error, 'Could not load authorized signatory');
    if (mho.data) {
      signatory = {
        fullName: mho.data.full_name || '',
        position: mho.data.position || 'Municipal Health Officer',
        licenseNumber: mho.data.license_no || '',
      };
    }
  } catch (_error) {
    // Fall back to the requesting profile; do not fail document generation
    // solely because no MHO profile is configured.
  }
  if (!signatory && user?.name) {
    signatory = {
      fullName: user.name,
      position: user.position || 'Municipal Health Officer',
      licenseNumber: user.licenseNumber || '',
    };
  }

  return {
    municipality: municipality ? {
      name: municipality.name || '',
      province: municipality.province || '',
      region: municipality.region || '',
      id: municipality.id,
    } : {},
    rhu: rhu ? {
      name: rhu.name || '',
      type: rhu.type || 'rhu',
      address: rhu.address || '',
    } : null,
    officeName: template.officeName || '',
    documentTitle: template.title || '',
    signatory,
  };
};

/**
 * Assemble the complete official branding payload required to render or issue a
 * specific `documentType` (e.g. medical certificate, referral, FHSIS report).
 *
 * Downloads required logos from private storage and encodes them as `base64`
 * data URLs so client/PDF renderers never need direct bucket access, reports any
 * unconfigured slots in `missingLogoTypes`, and attaches municipality, RHU
 * facility, and active MHO signatory metadata.
 *
 * @param {Object} [params] - Branding lookup parameters (`user`, `documentType`, `supabase`).
 * @returns {Promise<Object>} Resolved branding bundle (`logos`, `missingLogoTypes`, `organization`, `signatory`).
 */
export const getDocumentBranding = async ({ user, documentType, supabase } = {}) => {
  if (!ALLOWED_ROLES.has(user?.role)) {
    throw ApiError.forbidden('Your account cannot use official document branding.');
  }
  const template = DOCUMENT_BRANDING_TEMPLATES[documentType];
  if (!template) throw ApiError.notFound('Document branding template not found.');

  const client = supabase || getServiceClient();
  const municipalityId = await requireMunicipality(user, client);
  const rows = await getLogoRows(client, municipalityId);
  const rowByType = new Map(rows.map((row) => [row.logo_type, row]));
  const resolved = await Promise.all(template.logoTypes.map(async (logoType) => {
    const row = rowByType.get(logoType);
    if (!row) return null;
    const { data, error } = await client.storage.from(BUCKET).download(row.storage_path);
    throwOnSupabaseError(error, `Could not retrieve the configured ${logoType} logo`);
    if (!data) {
      throw Object.assign(new Error(`Could not retrieve the configured ${logoType} logo.`), { statusCode: 500 });
    }
    const contents = Buffer.from(await data.arrayBuffer());
    return [logoType, {
      type: logoType,
      dataUrl: `data:${row.mime_type};base64,${contents.toString('base64')}`,
      mimeType: row.mime_type,
      originalFilename: row.original_filename,
    }];
  }));
  const logos = Object.fromEntries(resolved.filter(Boolean));
  const { municipality, rhu, officeName, documentTitle, signatory } =
    await loadOrganizationAndSignatory(client, municipalityId, documentType, user);
  return {
    documentType,
    issuingLevel: template.issuingLevel,
    logos,
    missingLogoTypes: template.logoTypes.filter((logoType) => !logos[logoType]),
    organization: {
      municipality: municipality.name || '',
      province: municipality.province || '',
      region: municipality.region || '',
      officeName,
      rhuName: rhu?.name || '',
      rhuAddress: rhu?.address || '',
      address: rhu?.address || '',
      rhu,
    },
    signatory,
  };
};

/**
 * Upload and activate a new official logo (`municipal` or `rhu`) for the
 * administrator's municipality.
 *
 * Writes the validated image buffer to `official-logos/<municipalityId>/<logoType>/<uuid><ext>`
 * in private storage, commits the active pointer via the `save_official_logo` RPC
 * (rolling back the uploaded object if the RPC fails), and performs best-effort
 * deletion of any superseded `previousStoragePath` (returning `cleanupWarning`
 * if storage cleanup fails).
 *
 * @param {Object} [params] - Upload parameters (`user`, `logoType`, `file`, `format`).
 * @returns {Promise<Object>} `{ logo, cleanupWarning }` with a fresh signed preview URL.
 */
export const uploadOfficialLogo = async ({ user, logoType, file, format } = {}) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may upload official logos.');
  }
  assertLogoType(logoType);
  if (!file?.buffer || !format?.mimeType || !format?.extension) {
    throw ApiError.badRequest('A validated logo image is required.');
  }
  const supabase = getServiceClient();
  const municipalityId = await requireMunicipality(user, supabase);
  const storagePath = `official-logos/${municipalityId}/${logoType}/${randomUUID()}${format.extension}`;
  const originalFilename = cleanFilename(file.originalname);
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file.buffer, {
    cacheControl: '300',
    contentType: format.mimeType,
    upsert: false,
  });
  throwOnSupabaseError(uploadError, 'Could not upload the new official logo');

  const { data, error } = await supabase.rpc('save_official_logo', {
    p_municipality_id: municipalityId,
    p_logo_type: logoType,
    p_storage_path: storagePath,
    p_original_filename: originalFilename,
    p_mime_type: format.mimeType,
    p_file_size: file.size,
    p_uploaded_by: user.id,
  });
  if (error) {
    try {
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath]);
      throwOnSupabaseError(cleanupError, 'Could not remove the unreferenced uploaded logo');
    } catch (cleanupError) {
      console.error(`Official logo upload rollback failed: ${cleanupError.message}`);
    }
    throwOnSupabaseError(error, 'Could not activate the new official logo');
  }

  const result = data || {};
  const previousPath = result.previousStoragePath;
  let cleanupWarning = null;
  if (previousPath && previousPath !== storagePath) {
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([previousPath]);
    if (cleanupError) {
      cleanupWarning = 'The new logo is active, but the replaced file remains in private storage and needs cleanup.';
      console.error(`Official logo replacement cleanup failed: ${cleanupError.message}`);
    }
  }

  const [rows] = await Promise.all([getLogoRows(supabase, municipalityId)]);
  const row = rows.find((entry) => entry.logo_type === logoType);
  if (!row) {
    throw Object.assign(new Error('The logo was uploaded but its active configuration could not be reloaded.'), {
      statusCode: 500,
    });
  }
  return {
    logo: await signedLogo(supabase, row),
    cleanupWarning,
  };
};

/**
 * Deactivate and remove a configured official logo (`municipal` or `rhu`) for
 * the administrator's municipality via the `remove_official_logo` RPC, then
 * delete the underlying object from private storage on a best-effort basis.
 *
 * @param {Object} [params] - Removal parameters (`user`, `logoType`).
 * @returns {Promise<Object>} `{ removed: true, cleanupWarning }`.
 */
export const removeOfficialLogo = async ({ user, logoType } = {}) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may remove official logos.');
  }
  assertLogoType(logoType);
  const municipalityId = requireMunicipality(user);
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc('remove_official_logo', {
    p_municipality_id: municipalityId,
    p_logo_type: logoType,
    p_uploaded_by: user.id,
  });
  throwOnSupabaseError(error, 'Could not remove the official logo configuration');
  const storagePath = data?.storagePath;
  if (!storagePath) throw ApiError.notFound('No official logo is currently configured.');

  let cleanupWarning = null;
  const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (cleanupError) {
    cleanupWarning = 'The logo was removed from active configuration, but its private file remains and needs cleanup.';
    console.error(`Official logo removal cleanup failed: ${cleanupError.message}`);
  }
  return { removed: true, cleanupWarning };
};

export default {
  getAdminLogoSettings,
  getDocumentBranding,
  uploadOfficialLogo,
  removeOfficialLogo,
};
