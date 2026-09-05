import { createHash, randomBytes, randomUUID } from 'node:crypto';
import store from '../repositories/fileStore.js';
import { getServiceClient } from '../config/supabase.js';
import env from '../config/env.js';
import ApiError from '../utils/apiError.js';

const STATUS = Object.freeze({ PENDING: 'pending_mho_verification', MHO: 'under_mho_review', PHN: 'under_phn_verification', RETURNED: 'returned_for_correction', APPROVED: 'approved', REJECTED: 'rejected' });
const MHO_ROLES = ['mho'];
const PHN_ROLES = ['phn'];
const required = ['municipalityName', 'municipalityAddress', 'municipalHealthOffice', 'rhuName', 'rhuAddress', 'rhuContact', 'barangayCount', 'authorizedRepresentative', 'representativePosition', 'representativeContact', 'representativeEmail', 'officialMunicipalEmail', 'mhoName', 'mhoEmail', 'phnName', 'phnEmail', 'registeredBarangays'];

const clean = (value) => String(value ?? '').trim();
const normalize = (body = {}) => ({
  municipalityName: clean(body.municipalityName), province: clean(body.province) || 'Camarines Sur',
  municipalityAddress: clean(body.municipalityAddress),
  municipalHealthOffice: clean(body.municipalHealthOffice), rhuName: clean(body.rhuName), rhuAddress: clean(body.rhuAddress), rhuContact: clean(body.rhuContact),
  barangayCount: Number(body.barangayCount), authorizedRepresentative: clean(body.authorizedRepresentative), representativePosition: clean(body.representativePosition), representativeContact: clean(body.representativeContact), representativeEmail: clean(body.representativeEmail), officialMunicipalEmail: clean(body.officialMunicipalEmail),
  mhoName: clean(body.mhoName), mhoEmail: clean(body.mhoEmail), phnName: clean(body.phnName), phnEmail: clean(body.phnEmail),
  registeredBarangays: Array.isArray(body.registeredBarangays) ? body.registeredBarangays.map(clean).filter(Boolean) : clean(body.registeredBarangays).split(',').map(clean).filter(Boolean),
});
const validate = (body) => {
  const input = normalize(body);
  const missing = required.filter((field) => !input[field] || (field === 'barangayCount' && (!Number.isInteger(input[field]) || input[field] < 1)));
  if (input.province !== 'Camarines Sur') missing.push('province');
  if (!input.registeredBarangays.length) missing.push('registeredBarangays');
  if (missing.length) throw ApiError.badRequest('Please provide all required municipality details.', { fields: missing });
  return input;
};
const toPublic = (row) => ({ reference: row.reference || row.reference_no, municipality: row.municipalityName || row.municipality_name, province: row.province, municipalityAddress: row.municipalityAddress || row.municipality_address || '', rhuName: row.rhuName || row.rhu_name || '', rhuAddress: row.rhuAddress || row.rhu_address || '', rhuContact: row.rhuContact || row.rhu_contact || '', municipalHealthOffice: row.municipalHealthOffice || row.municipal_health_office || '', mhoName: row.mhoName || row.mho_name || '', mhoEmail: row.mhoEmail || row.mho_email || '', phnName: row.phnName || row.phn_name || '', phnEmail: row.phnEmail || row.phn_email || '', registeredBarangays: row.registeredBarangays || row.registered_barangays || [], barangayCount: row.barangayCount || row.barangay_count, status: row.status, submittedAt: row.submittedAt || row.submitted_at, updatedAt: row.updatedAt || row.updated_at, mhoReason: row.mhoReason || row.mho_reason || '', phnReason: row.phnReason || row.phn_reason || '' });
const organizationId = (name) => `mun-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const makeToken = () => randomBytes(32).toString('base64url');
const tokenExpiry = () => new Date(Date.now() + TOKEN_TTL_MS).toISOString();
const tokenLink = (token) => `${env.clientUrls?.[0] || 'http://localhost:5173'}/municipality-verification/${token}`;

const nextReference = async () => {
  if (env.isSupabaseConfigured) {
    const { data, error } = await getServiceClient().rpc('increment_counter', { counter_name: 'onboarding' });
    if (error) throw new Error(error.message);
    return `KAL-${new Date().getFullYear()}-${String(data).padStart(4, '0')}`;
  }
  return store.mutate((data) => {
    data.counters.onboarding += 1;
    return `KAL-${new Date().getFullYear()}-${String(data.counters.onboarding).padStart(4, '0')}`;
  });
};

const localLinks = (mhoToken, phnToken) => (env.isDevAuthEnabled ? {
  mho: tokenLink(mhoToken),
  phn: tokenLink(phnToken),
} : undefined);

const auditLocal = (data, row, action, actorType = 'applicant', reason = '') => {
  data.municipalityOnboardingAudit.push({ id: randomUUID(), onboardingId: row.id, actorType, action, reason, createdAt: new Date().toISOString() });
};

const activateOrganization = async (row) => {
  const client = getServiceClient();
  const municipalityId = organizationId(row.municipality_name || row.municipalityName);
  const rhuId = `${municipalityId}-rhu-1`;
  const { error: municipalityError } = await client.from('municipalities').upsert({ id: municipalityId, name: row.municipality_name || row.municipalityName, province: row.province, status: 'approved' });
  if (municipalityError) throw new Error(municipalityError.message);
  const { error: rhuError } = await client.from('rhus').upsert({ id: rhuId, municipality_id: municipalityId, name: row.rhu_name || row.rhuName, address: row.rhu_address || row.rhuAddress, contact_number: row.rhu_contact || row.rhuContact });
  if (rhuError) throw new Error(rhuError.message);
  const names = row.registered_barangays || row.registeredBarangays || [];
  if (names.length) {
    const { error } = await client.from('barangays').upsert(names.map((name) => ({ id: `${municipalityId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, municipality_id: municipalityId, rhu_id: rhuId, name })));
    if (error) throw new Error(error.message);
  }
    for (const [emailField, role] of [['mho_email', 'mho'], ['phn_email', 'phn']]) {
      const email = row[emailField] || row[emailField.replace('_', '')];
      if (!email) continue;
      const { data: userData, error: userError } = await client.auth.admin.getUserByEmail(email);
      if (userError) continue;
      const user = userData?.user;
      if (!user) continue;
      const { error: membershipError } = await client.from('organization_memberships').upsert({ user_id: user.id, municipality_id: municipalityId, rhu_id: rhuId, role }, { onConflict: 'user_id' });
      if (membershipError) throw new Error(membershipError.message);
      const metadata = { ...(user.app_metadata || {}), municipality_id: municipalityId, rhu_id: rhuId, role };
      const { error: metadataError } = await client.auth.admin.updateUserById(user.id, { app_metadata: metadata });
      if (metadataError) throw new Error(metadataError.message);
    }
  await client.from('municipality_onboarding_audit').insert({ onboarding_id: row.id, actor_type: 'system', action: 'activated' });
};

const activateLocalOrganization = (data, row) => {
  const municipalityId = organizationId(row.municipalityName);
  const rhuId = `${municipalityId}-rhu-1`;
  const municipality = { id: municipalityId, name: row.municipalityName, province: row.province, status: 'approved', updatedAt: new Date().toISOString() };
  const rhu = { id: rhuId, municipalityId, name: row.rhuName, address: row.rhuAddress, contactNumber: row.rhuContact };
  data.municipalities = data.municipalities.filter((item) => item.id !== municipalityId).concat(municipality);
  data.rhus = data.rhus.filter((item) => item.id !== rhuId).concat(rhu);
  row.registeredBarangays.forEach((name) => {
    const id = `${municipalityId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    data.barangays = data.barangays.filter((item) => item.id !== id).concat({ id, municipalityId, rhuId, name, active: true });
  });
  auditLocal(data, row, 'activated', 'system');
};

const findSupabaseToken = async (token, forDecision = false) => {
  const digest = hashToken(token);
  const client = getServiceClient();
  for (const role of ['mho', 'phn']) {
    const usedColumn = `${role}_token_used_at`;
    let query = client.from('municipality_onboarding_requests').select('*').eq(`${role}_token_hash`, digest);
    if (forDecision) query = query.is(usedColumn, null);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const expiresAt = role === 'mho' ? data.mho_token_expires_at : data.phn_token_expires_at;
      if (new Date(expiresAt).getTime() > Date.now()) return { row: data, role, used: Boolean(data[usedColumn]) };
      break;
    }
  }
  if (forDecision) throw ApiError.unauthorized('This verification link is invalid, expired, or already used.');
  throw ApiError.unauthorized('This verification link is invalid, expired, or already used.');
};

export const submit = async (body) => {
  const input = validate(body);
  const reference = await nextReference();
  const mhoToken = makeToken();
  const phnToken = makeToken();
  const expiresAt = tokenExpiry();
  if (env.isSupabaseConfigured) {
    const { data, error } = await getServiceClient().from('municipality_onboarding_requests').insert({ id: randomUUID(), reference_no: reference, municipality_name: input.municipalityName, province: input.province, municipality_address: input.municipalityAddress, municipal_health_office: input.municipalHealthOffice, rhu_name: input.rhuName, rhu_address: input.rhuAddress, rhu_contact: input.rhuContact, barangay_count: input.barangayCount, registered_barangays: input.registeredBarangays, authorized_representative: input.authorizedRepresentative, representative_position: input.representativePosition, representative_contact: input.representativeContact, representative_email: input.representativeEmail, official_municipal_email: input.officialMunicipalEmail, mho_name: input.mhoName, mho_email: input.mhoEmail, phn_name: input.phnName, phn_email: input.phnEmail, mho_token_hash: hashToken(mhoToken), mho_token_expires_at: expiresAt, phn_token_hash: hashToken(phnToken), phn_token_expires_at: expiresAt }).select('*').single();
    if (error) throw new Error(error.message);
    await getServiceClient().from('municipality_onboarding_audit').insert({ onboarding_id: data.id, actor_type: 'applicant', action: 'submitted' });
    return { ...toPublic(data), verificationLinks: localLinks(mhoToken, phnToken) };
  }
  return store.mutate((data) => {
    const duplicate = data.municipalityOnboarding.find((row) => row.municipalityName.toLowerCase() === input.municipalityName.toLowerCase() && ![STATUS.REJECTED].includes(row.status));
    if (duplicate) throw ApiError.conflict('A registration for this municipality is already in progress.');
    const now = new Date().toISOString();
    const row = { id: `ONB-${data.municipalityOnboarding.length + 1}`, reference, ...input, status: STATUS.PENDING, submittedAt: now, updatedAt: now, mhoReason: '', phnReason: '', mhoTokenHash: hashToken(mhoToken), mhoTokenExpiresAt: expiresAt, mhoTokenUsedAt: null, phnTokenHash: hashToken(phnToken), phnTokenExpiresAt: expiresAt, phnTokenUsedAt: null };
    data.municipalityOnboarding.push(row);
    auditLocal(data, row, 'submitted');
    return { ...toPublic(row), verificationLinks: localLinks(mhoToken, phnToken) };
  });
};

export const getStatus = async (reference) => {
  if (!reference) throw ApiError.badRequest('Registration reference is required.');
  if (env.isSupabaseConfigured) {
    const { data, error } = await getServiceClient().from('municipality_onboarding_requests').select('*').eq('reference_no', reference).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw ApiError.notFound('Registration not found.');
    return toPublic(data);
  }
  const row = store.municipalityOnboarding.find((item) => item.reference === reference);
  if (!row) throw ApiError.notFound('Registration not found.');
  return toPublic(row);
};

const tokenRecord = (data, token, allowUsed = false) => {
  const digest = hashToken(token);
  const now = Date.now();
  const row = data.municipalityOnboarding.find((item) => {
    const mhoValid = item.mhoTokenHash === digest && (allowUsed || !item.mhoTokenUsedAt) && new Date(item.mhoTokenExpiresAt).getTime() > now;
    const phnValid = item.phnTokenHash === digest && (allowUsed || !item.phnTokenUsedAt) && new Date(item.phnTokenExpiresAt).getTime() > now;
    return mhoValid || phnValid;
  });
  if (!row) throw ApiError.unauthorized('This verification link is invalid, expired, or already used.');
  const role = row.mhoTokenHash === digest ? 'mho' : 'phn';
  return { row, role, used: role === 'mho' ? Boolean(row.mhoTokenUsedAt) : Boolean(row.phnTokenUsedAt) };
};

export const getVerification = async (token) => {
  if (!token) throw ApiError.unauthorized('Verification token is required.');
  if (env.isSupabaseConfigured) {
    const { row, role, used } = await findSupabaseToken(token);
    return { ...toPublic(row), verificationRole: role, verificationCompleted: used };
  }
  const { row, role, used } = tokenRecord({ municipalityOnboarding: store.municipalityOnboarding }, token, true);
  return { ...toPublic(row), verificationRole: role, verificationCompleted: used };
};

export const decideWithToken = async ({ token, decision, reason = '' }) => {
  if (!['approve', 'correction', 'reject'].includes(decision)) throw ApiError.badRequest('Decision must be approve, correction, or reject.');
  const trimmedReason = clean(reason);
  if (['correction', 'reject'].includes(decision) && !trimmedReason) throw ApiError.badRequest('A reason is required for this decision.');
  if (env.isSupabaseConfigured) {
    const { row, role } = await findSupabaseToken(token, true);
    const validStatus = role === 'mho' ? [STATUS.PENDING, STATUS.RETURNED] : [STATUS.PHN];
    if (!validStatus.includes(row.status)) throw ApiError.conflict('This registration is not available for this verification stage.');
    const nextStatus = decision === 'approve' ? (role === 'mho' ? STATUS.PHN : STATUS.APPROVED) : decision === 'correction' ? STATUS.RETURNED : STATUS.REJECTED;
    const now = new Date().toISOString();
    const updates = { status: nextStatus, ...(role === 'mho' ? { mho_token_used_at: now, mho_reviewed_at: now, mho_reason: trimmedReason } : { phn_token_used_at: now, phn_reviewed_at: now, phn_reason: trimmedReason }) };
    const { data, error } = await getServiceClient().from('municipality_onboarding_requests').update(updates).eq('id', row.id).select('*').single();
    if (error) throw new Error(error.message);
    await getServiceClient().from('municipality_onboarding_audit').insert({ onboarding_id: row.id, actor_type: role, action: decision === 'approve' ? 'approved' : decision === 'correction' ? 'correction_requested' : 'rejected', reason: trimmedReason });
    if (nextStatus === STATUS.APPROVED) await activateOrganization(data);
    return { ...toPublic(data), verificationRole: role, verificationCompleted: true };
  }
  return store.mutate((data) => {
    const { row, role } = tokenRecord(data, token);
    const validStatus = role === 'mho' ? [STATUS.PENDING, STATUS.RETURNED] : [STATUS.PHN];
    if (!validStatus.includes(row.status)) throw ApiError.conflict('This registration is not available for this verification stage.');
    const nextStatus = decision === 'approve' ? (role === 'mho' ? STATUS.PHN : STATUS.APPROVED) : decision === 'correction' ? STATUS.RETURNED : STATUS.REJECTED;
    row.status = nextStatus; row.updatedAt = new Date().toISOString();
    if (role === 'mho') { row.mhoTokenUsedAt = new Date().toISOString(); row.mhoReason = trimmedReason; } else { row.phnTokenUsedAt = new Date().toISOString(); row.phnReason = trimmedReason; }
    if (nextStatus === STATUS.APPROVED) row.activatedAt = new Date().toISOString();
    auditLocal(data, row, role === 'mho' ? (decision === 'approve' ? 'approved' : decision === 'correction' ? 'correction_requested' : 'rejected') : (decision === 'approve' ? 'approved' : decision === 'correction' ? 'correction_requested' : 'rejected'), role, trimmedReason);
    if (nextStatus === STATUS.APPROVED) activateLocalOrganization(data, row);
    return { ...toPublic(row), verificationRole: role, verificationCompleted: true };
  });
};

export const resubmit = async (reference, body) => {
  const input = validate(body);
  const mhoToken = makeToken(); const phnToken = makeToken(); const expiresAt = tokenExpiry();
  if (env.isSupabaseConfigured) {
    const client = getServiceClient();
    const { data: existing, error: lookupError } = await client.from('municipality_onboarding_requests').select('*').eq('reference_no', reference).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!existing || existing.status !== STATUS.RETURNED) throw ApiError.conflict('Only registrations returned for correction can be resubmitted.');
    const { data, error } = await client.from('municipality_onboarding_requests').update({ municipality_name: input.municipalityName, province: input.province, municipality_address: input.municipalityAddress, municipal_health_office: input.municipalHealthOffice, rhu_name: input.rhuName, rhu_address: input.rhuAddress, rhu_contact: input.rhuContact, barangay_count: input.barangayCount, registered_barangays: input.registeredBarangays, authorized_representative: input.authorizedRepresentative, representative_position: input.representativePosition, representative_contact: input.representativeContact, representative_email: input.representativeEmail, official_municipal_email: input.officialMunicipalEmail, mho_name: input.mhoName, mho_email: input.mhoEmail, phn_name: input.phnName, phn_email: input.phnEmail, status: STATUS.PENDING, mho_token_hash: hashToken(mhoToken), mho_token_expires_at: expiresAt, mho_token_used_at: null, phn_token_hash: hashToken(phnToken), phn_token_expires_at: expiresAt, phn_token_used_at: null, updated_at: new Date().toISOString() }).eq('id', existing.id).select('*').single();
    if (error) throw new Error(error.message);
    await client.from('municipality_onboarding_audit').insert({ onboarding_id: existing.id, actor_type: 'applicant', action: 'resubmitted' });
    return { ...toPublic(data), verificationLinks: localLinks(mhoToken, phnToken) };
  }
  return store.mutate((data) => {
    const row = data.municipalityOnboarding.find((item) => item.reference === reference);
    if (!row || row.status !== STATUS.RETURNED) throw ApiError.conflict('Only registrations returned for correction can be resubmitted.');
    Object.assign(row, input, { status: STATUS.PENDING, updatedAt: new Date().toISOString(), mhoTokenHash: hashToken(mhoToken), mhoTokenExpiresAt: expiresAt, mhoTokenUsedAt: null, phnTokenHash: hashToken(phnToken), phnTokenExpiresAt: expiresAt, phnTokenUsedAt: null, mhoReason: '', phnReason: '' });
    auditLocal(data, row, 'resubmitted');
    return { ...toPublic(row), verificationLinks: localLinks(mhoToken, phnToken) };
  });
};

export const listForReviewer = async (user) => {
  const statuses = user.role === 'mho' ? [STATUS.PENDING, STATUS.MHO, STATUS.RETURNED] : [STATUS.PHN];
  if (env.isSupabaseConfigured) {
    const { data, error } = await getServiceClient().from('municipality_onboarding_requests').select('*').in('status', statuses).order('submitted_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data.map(toPublic);
  }
  return store.municipalityOnboarding.filter((row) => statuses.includes(row.status)).map(toPublic);
};

export const decide = async ({ reference, decision, reason = '', user }) => {
  const role = user?.role;
  if (!MHO_ROLES.includes(role) && !PHN_ROLES.includes(role)) throw ApiError.forbidden('Only an MHO or PHN may review municipality registration.');
  if (!['approve', 'return', 'reject'].includes(decision)) throw ApiError.badRequest('Decision must be approve, return, or reject.');
  if (['return', 'reject'].includes(decision) && !clean(reason)) throw ApiError.badRequest('A reason is required when returning or rejecting a registration.');
  const nextStatus = role === 'mho' ? (decision === 'approve' ? STATUS.PHN : decision === 'reject' ? STATUS.REJECTED : STATUS.RETURNED) : (decision === 'approve' ? STATUS.APPROVED : decision === 'reject' ? STATUS.REJECTED : STATUS.RETURNED);
  if (env.isSupabaseConfigured) {
    const field = role === 'mho' ? { status: nextStatus, mho_reviewed_by: user.id, mho_reviewed_at: new Date().toISOString(), mho_reason: clean(reason) } : { status: nextStatus, phn_reviewed_by: user.id, phn_reviewed_at: new Date().toISOString(), phn_reason: clean(reason) };
    const { data, error } = await getServiceClient().from('municipality_onboarding_requests').update(field).eq('reference_no', reference).eq('status', role === 'mho' ? STATUS.PENDING : STATUS.PHN).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw ApiError.notFound('Registration is not available for your review.');
    if (nextStatus === STATUS.APPROVED) {
      const municipalityId = organizationId(data.municipality_name);
      const rhuId = `${municipalityId}-rhu-1`;
      const client = getServiceClient();
      const { error: municipalityError } = await client.from('municipalities').upsert({ id: municipalityId, name: data.municipality_name, province: data.province, status: 'approved' });
      if (municipalityError) throw new Error(municipalityError.message);
      const { error: rhuError } = await client.from('rhus').upsert({ id: rhuId, municipality_id: municipalityId, name: data.rhu_name, address: data.rhu_address, contact_number: data.rhu_contact });
      if (rhuError) throw new Error(rhuError.message);
    }
    return toPublic(data);
  }
  return store.mutate((data) => {
    const row = data.municipalityOnboarding.find((item) => item.reference === reference);
    const expected = role === 'mho' ? [STATUS.PENDING, STATUS.RETURNED] : [STATUS.PHN];
    if (!row || !expected.includes(row.status)) throw ApiError.notFound('Registration is not available for your review.');
    row.status = nextStatus; row.updatedAt = new Date().toISOString();
    if (role === 'mho') row.mhoReason = clean(reason); else row.phnReason = clean(reason);
    return toPublic(row);
  });
};

export { STATUS };
export default { submit, getStatus, getVerification, decideWithToken, resubmit, listForReviewer, decide };
