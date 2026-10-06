import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getServiceClient } from '../config/supabase.js';
import {
  DOCUMENT_BRANDING_TEMPLATES,
  OFFICIAL_LOGO_TYPES,
} from '../config/documentBranding.js';
import ApiError from '../utils/apiError.js';

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

const assertLogoType = (logoType) => {
  if (!OFFICIAL_LOGO_TYPES.includes(logoType)) {
    throw ApiError.notFound('Official logo type not found.');
  }
};

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

const getLogoRows = async (supabase, municipalityId) => {
  const { data, error } = await supabase
    .from('official_logos')
    .select('logo_type, storage_path, original_filename, mime_type, file_size, uploaded_by, created_at, updated_at')
    .eq('municipality_id', municipalityId);
  throwOnSupabaseError(error, 'Could not load official logo settings');
  return data || [];
};

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

export const getDocumentBranding = async ({ user, documentType } = {}) => {
  if (!ALLOWED_ROLES.has(user?.role)) {
    throw ApiError.forbidden('Your account cannot use official document branding.');
  }
  const template = DOCUMENT_BRANDING_TEMPLATES[documentType];
  if (!template) throw ApiError.notFound('Document branding template not found.');

  const supabase = getServiceClient();
  const municipalityId = await requireMunicipality(user, supabase);
  const rows = await getLogoRows(supabase, municipalityId);
  const rowByType = new Map(rows.map((row) => [row.logo_type, row]));
  const resolved = await Promise.all(template.logoTypes.map(async (logoType) => {
    const row = rowByType.get(logoType);
    if (!row) return null;
    const { data, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
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
  return {
    documentType,
    issuingLevel: template.issuingLevel,
    logos,
    missingLogoTypes: template.logoTypes.filter((logoType) => !logos[logoType]),
  };
};

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
