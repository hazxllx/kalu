import { randomUUID } from 'node:crypto';
import { getServiceClient, getUserClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

const TABLE = 'resident_laboratory_documents';
const BUCKET = 'resident-laboratory';
const SELECT = 'id,resident_id,consultation_id,category,file_name,content_type,size_bytes,storage_path,uploaded_at';
export const LABORATORY_CATEGORIES = Object.freeze(['cbc', 'urinalysis', 'fecalysis', 'blood_chemistry',
  'fasting_blood_sugar', 'lipid_profile', 'pregnancy_test', 'ultrasound', 'xray', 'other']);
const EXTENSIONS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const checked = (result, message) => {
  if (result.error) throw new ApiError(503, message);
  return result.data;
};
const dto = (row) => ({ id: row.id, residentId: row.resident_id, consultationId: row.consultation_id,
  category: row.category, fileName: row.file_name, contentType: row.content_type,
  sizeBytes: row.size_bytes, uploadedAt: row.uploaded_at, verifiedClinicalFinding: false });

// Never accept an account/resident association from multipart input. Staff access
// always uses the resident's current scope, not the scope at upload time.
export const residentInScope = async (client, user, residentId) => {
  if (!user?.id) throw ApiError.unauthorized();
  let query = client.from('residents').select('id,auth_user_id,barangay_id,municipality_id');
  if (user.role === 'resident') query = query.eq('auth_user_id', user.id);
  else {
    if (!['health_supervisor', 'phn', 'mho'].includes(user.role)) throw ApiError.forbidden();
    if (typeof residentId !== 'string' || !residentId.trim() || residentId.length > 200) {
      throw ApiError.badRequest('A resident is required.');
    }
    query = query.eq('id', residentId);
  }
  const resident = checked(await query.maybeSingle(), 'Could not load resident.');
  if (!resident) throw ApiError.notFound('Resident record not found.');
  if (user.role === 'health_supervisor') {
    if (!user.barangayId || resident.barangay_id !== user.barangayId
      || !user.municipalityId || resident.municipality_id !== user.municipalityId) throw ApiError.notFound();
  } else if (['phn', 'mho'].includes(user.role)) {
    if (!user.municipalityId || resident.municipality_id !== user.municipalityId) throw ApiError.notFound();
  }
  return resident;
};

export const list = async ({ user, residentId, client = getServiceClient(),
  metadataClient = user?.accessToken ? getUserClient(user.accessToken) : client }) => {
  const resident = await residentInScope(client, user, residentId);
  // Page explicitly: Supabase's default row cap must not hide older documents.
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const page = checked(await metadataClient.from(TABLE).select(SELECT).eq('resident_id', resident.id)
      .order('uploaded_at', { ascending: false }).order('id').range(offset, offset + 199),
    'Could not load laboratory results.') || [];
    rows.push(...page.map(dto));
    if (page.length < 200) break;
  }
  return rows;
};

export const validateLaboratoryFile = async (file) => {
  if (!file || !EXTENSIONS[file.type]) throw ApiError.unsupportedMediaType('Upload a PDF, JPG, JPEG, or PNG laboratory document.');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 10 * 1024 * 1024) {
    throw ApiError.payloadTooLarge('Laboratory documents must be between 1 byte and 10 MB.');
  }
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  if (!(file.type === 'image/jpeg' ? ['jpg', 'jpeg'] : [EXTENSIONS[file.type]]).includes(extension)) {
    throw ApiError.unsupportedMediaType('The filename must match the document format.');
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = file.type === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : file.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw ApiError.unsupportedMediaType('The uploaded file content does not match its format.');
  return bytes;
};

export const upload = async ({ user, category, file, client = getServiceClient() }) => {
  if (user?.role !== 'resident') throw ApiError.forbidden('Only residents may upload their own laboratory results.');
  if (!LABORATORY_CATEGORIES.includes(category)) throw ApiError.unprocessable('Select a valid laboratory document type.');
  const resident = await residentInScope(client, user);
  const bytes = await validateLaboratoryFile(file);
  const id = randomUUID();
  const storagePath = `${resident.id}/${id}.${EXTENSIONS[file.type]}`;
  checked(await client.storage.from(BUCKET).upload(storagePath, bytes, { contentType: file.type, upsert: false }),
    'Could not securely store laboratory document. Please retry.');
  const result = await client.from(TABLE).insert({ id, resident_id: resident.id, category,
    file_name: file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 255), content_type: file.type,
    size_bytes: bytes.length, storage_path: storagePath, uploaded_by: user.id }).select(SELECT).single();
  if (result.error) {
    // A transport error may mean the INSERT committed but its response was lost.
    // Read the generated ID before cleanup so a committed document is never broken.
    const probe = await client.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
    if (!probe.error && probe.data) return dto(probe.data);
    if (!probe.error) await client.storage.from(BUCKET).remove([storagePath]);
    throw new ApiError(503, 'Could not confirm laboratory document upload. Please refresh your documents before retrying.');
  }
  return dto(result.data);
};

const scopedDocument = async (client, user, id, metadataClient = client) => {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw ApiError.notFound();
  }
  const row = checked(await metadataClient.from(TABLE).select(SELECT).eq('id', id).maybeSingle(), 'Could not load laboratory document.');
  if (!row) throw ApiError.notFound();
  const resident = await residentInScope(client, user, row.resident_id);
  // A resident's query ignores supplied residentId; compare again for file reads.
  if (resident.id !== row.resident_id) throw ApiError.notFound();
  return { row, resident };
};

export const download = async ({ user, id, client = getServiceClient(),
  metadataClient = user?.accessToken ? getUserClient(user.accessToken) : client }) => {
  const { row, resident } = await scopedDocument(client, user, id, metadataClient);
  const file = checked(await client.storage.from(BUCKET).download(row.storage_path), 'Could not retrieve laboratory document.');
  checked(await client.from('health_audit_logs').insert({ actor_id: user.id, action: 'LABORATORY_VIEWED',
    entity_type: TABLE, entity_id: row.id, municipality_id: resident.municipality_id,
    barangay_id: resident.barangay_id, metadata: {} }), 'Could not record document access.');
  return { file, document: dto(row) };
};

export const linkConsultation = async ({ user, id, consultationId, client = getServiceClient() }) => {
  if (!['health_supervisor', 'phn', 'mho'].includes(user?.role)) throw ApiError.forbidden();
  if (typeof consultationId !== 'string' || !consultationId.trim() || consultationId.length > 200) {
    throw ApiError.unprocessable('Select an existing consultation.');
  }
  const { row } = await scopedDocument(client, user, id);
  const visit = checked(await client.from('visits').select('id,resident_id').eq('id', consultationId).maybeSingle(),
    'Could not load consultation.');
  if (!visit || visit.resident_id !== row.resident_id) throw ApiError.notFound('Consultation not found for this resident.');
  // A document can be linked once; racing links cannot silently replace history.
  if (row.consultation_id && row.consultation_id !== consultationId) throw ApiError.conflict('This result is already linked to a consultation.');
  if (row.consultation_id === consultationId) return dto(row);
  const result = await client.rpc('link_resident_laboratory_document', {
    p_id: row.id, p_consultation_id: consultationId, p_actor_id: user.id,
  });
  if (result.error?.code === '23505') throw ApiError.conflict('The laboratory document was linked by another user. Please reload.');
  if (result.error?.code === '42501') throw ApiError.forbidden();
  const updated = checked(result, 'Could not link laboratory document.');
  return dto(updated);
};
