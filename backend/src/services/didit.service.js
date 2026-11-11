import { createHmac, timingSafeEqual } from 'node:crypto';

import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import repository from '../repositories/index.js';
import ApiError from '../utils/apiError.js';
import { ageFromDateOnly } from '../validators/common.js';
import { isMinorAge } from '../config/guardianPolicy.js';
import { notifyResident } from './notifications.service.js';

const CONSENT_VERSION = 'didit-identity-v1';
const DIDIT_SESSION_URL = 'https://verification.didit.me/v3/session/';
const configured = () => {
  if (!env.diditApiKey || !env.diditWebhookSecret || !env.diditWorkflowId) {
    throw new ApiError(503, 'Identity verification is not configured yet. Please contact support.');
  }
};
const webhookConfigured = () => {
  if (!env.diditWebhookSecret) throw new ApiError(503, 'Didit webhook is not configured.');
};

const mapStatus = (value) => {
  switch (String(value || '').trim().toLowerCase()) {
    case 'not started':
    case 'in progress':
    case 'resubmitted':
    case 'awaiting user': return 'in_progress';
    case 'in review': return 'pending_review';
    case 'approved': return 'verified';
    case 'declined': return 'declined';
    case 'kyc expired':
    case 'expired': return 'expired';
    case 'abandoned': return 'failed';
    default: return null;
  }
};

const allApproved = (rows) => Array.isArray(rows) && rows.length > 0
  && rows.every((row) => String(row?.status || '').trim().toLowerCase() === 'approved');

const anyFailed = (rows) => Array.isArray(rows)
  && rows.some((row) => ['declined', 'rejected', 'failed'].includes(String(row?.status || '').trim().toLowerCase()));

// Do not treat a top-level Didit Approved as a face match by itself. The
// workflow must return successful ID, liveness, and face-match results.
const resolveIdentityStatus = (rawStatus, decision) => {
  const mapped = mapStatus(rawStatus);
  if (mapped !== 'verified') return mapped;
  const idChecks = decision?.id_verifications;
  const livenessChecks = decision?.liveness_checks;
  const faceChecks = decision?.face_matches;
  if ([idChecks, livenessChecks, faceChecks].some(anyFailed)) return 'declined';
  return [idChecks, livenessChecks, faceChecks].every(allApproved) ? 'verified' : 'pending_review';
};

const isSandboxResult = (payload) => String(payload?.environment || '').trim().toLowerCase() === 'sandbox';

const autoApproveResident = async (residentId) => {
  const resident = await repository.getResident(residentId);
  if (!resident) throw new Error('Didit session is linked to a missing resident.');
  const profileIsComplete = Boolean(
    String(resident.firstName || '').trim()
    && String(resident.lastName || '').trim()
    && resident.birthDate
    && String(resident.sex || '').trim()
    && String(resident.currentAddress || '').trim()
    && String(resident.barangay || '').trim(),
  );
  if (!profileIsComplete) {
    console.warn(`[didit] Identity matched for ${residentId}, but registration remains pending because required resident details are incomplete.`);
    return false;
  }
  if (['rejected', 'resubmission_required'].includes(resident.verificationStatus)) return false;
  if (resident.verificationStatus !== 'approved') {
    const updated = await repository.updateResident(residentId, {
      verificationStatus: 'approved',
      verifiedBy: null,
      verifiedAt: new Date().toISOString(),
      rejectionReason: '',
    });
    const autoApprovalReason = 'Automatically approved: Didit verified the identity document, liveness, and selfie face match.';
    const recentLogs = await repository.listResidentVerificationLogs(residentId, { limit: 20 });
    const hasAutoApprovalLog = recentLogs.some((log) => log.action === 'approved' && log.reason === autoApprovalReason);
    if (!hasAutoApprovalLog) {
      await repository.insertResidentVerificationLog({
        residentId,
        reviewedBy: null,
        action: 'approved',
        reason: autoApprovalReason,
        previousStatus: resident.verificationStatus || 'pending',
        newStatus: 'approved',
      });
    }
    if (resident.authUserId) await repository.setProfileStatus(resident.authUserId, 'active');
    await notifyResident({
      recipientAuthUserId: resident.authUserId,
      category: 'information',
      title: 'Registration approved',
      message: 'Your identity checks passed and your resident account is now approved.',
      relatedType: 'resident_verification',
      relatedId: residentId,
    });
    return true;
  }
  if (resident.authUserId) await repository.setProfileStatus(resident.authUserId, 'active');
  return true;
};

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = sortKeys(value[key]);
      return out;
    }, {});
  }
  return typeof value === 'number' && !Number.isInteger(value) && value % 1 === 0
    ? Math.trunc(value)
    : value;
};

const validSignature = (body, timestamp, signatures) => {
  const epoch = Number(timestamp);
  if (!Number.isInteger(epoch) || Math.abs(Math.floor(Date.now() / 1000) - epoch) > 300) return false;
  const canonical = JSON.stringify(sortKeys(body));
  const expected = createHmac('sha256', env.diditWebhookSecret).update(canonical, 'utf8').digest('hex');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return signatures.some((signature) => {
    if (!/^[a-f\d]{64}$/i.test(String(signature || ''))) return false;
    const receivedBytes = Buffer.from(signature, 'utf8');
    return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
  });
};

const sanitizedDecision = (decision, status) => ({
  status: String(decision?.status || status || ''),
  features: Array.isArray(decision?.features)
    ? decision.features.filter((value) => typeof value === 'string').slice(0, 40)
    : [],
  idVerifications: Array.isArray(decision?.id_verifications)
    ? decision.id_verifications.slice(0, 10).map((item) => ({
      status: String(item?.status || ''),
      documentType: String(item?.document_type || ''),
      verificationMethod: String(item?.verification_method || ''),
      warnings: Array.isArray(item?.warnings)
        ? item.warnings.slice(0, 20).map((warning) => ({
          risk: String(warning?.risk || ''),
          description: String(warning?.short_description || ''),
          type: String(warning?.log_type || ''),
        }))
        : [],
    }))
    : [],
  livenessChecks: Array.isArray(decision?.liveness_checks)
    ? decision.liveness_checks.slice(0, 10).map((item) => ({
      status: String(item?.status || ''),
      method: String(item?.method || ''),
      score: Number.isFinite(item?.score) ? item.score : null,
    }))
    : [],
  faceMatches: Array.isArray(decision?.face_matches)
    ? decision.face_matches.slice(0, 10).map((item) => ({
      status: String(item?.status || ''),
      score: Number.isFinite(item?.score) ? item.score : null,
    }))
    : [],
});

const decisionMedia = (decision) => ({
  status: String(decision?.status || ''),
  idVerifications: (Array.isArray(decision?.id_verifications) ? decision.id_verifications : [])
    .slice(0, 10)
    .map((item, index) => ({
      id: `didit-id-${index + 1}`,
      status: String(item?.status || ''),
      documentType: String(item?.document_type || 'Identity document'),
      frontImage: item?.front_image || item?.full_front_image || null,
      backImage: item?.back_image || item?.full_back_image || null,
      portraitImage: item?.portrait_image || null,
    })),
  livenessChecks: (Array.isArray(decision?.liveness_checks) ? decision.liveness_checks : [])
    .slice(0, 10)
    .map((item, index) => ({
      id: `didit-live-${index + 1}`,
      status: String(item?.status || ''),
      method: String(item?.method || ''),
      score: Number.isFinite(item?.score) ? item.score : null,
      referenceImage: item?.reference_image || null,
    })),
});

export const getLatestForResident = async (residentId) => {
  const { data, error } = await getServiceClient()
    .from('identity_verifications')
    .select('status,didit_status,created_at,completed_at,failure_reason')
    .eq('resident_id', residentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not load identity verification status.');
  return data ? {
    status: data.status,
    diditStatus: data.didit_status,
    startedAt: data.created_at,
    completedAt: data.completed_at,
    message: data.failure_reason || '',
  } : { status: 'unverified', diditStatus: 'Not Started', startedAt: null, completedAt: null, message: '' };
};

// Didit media URLs are short-lived signed links. Retrieve them only when an
// authorized reviewer opens the approval record; never persist the links or
// the underlying identity images in KALUSAGAP storage.
export const getReviewEvidence = async (residentId) => {
  if (!env.diditApiKey) throw new ApiError(503, 'Didit review evidence is not configured.');
  const client = getServiceClient();
  const { data: attempt, error: attemptError } = await client.from('identity_verifications')
    .select('didit_session_id,status,didit_status')
    .eq('resident_id', residentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (attemptError) throw new Error(attemptError.message || 'Could not load the Didit session.');
  if (!attempt) return { status: 'unverified', diditStatus: 'Not Started', evidence: null };

  let response;
  try {
    response = await fetch(`${DIDIT_SESSION_URL}${encodeURIComponent(attempt.didit_session_id)}/decision/`, {
      headers: { 'x-api-key': env.diditApiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ApiError(502, 'Could not retrieve the Didit verification evidence. Please retry.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[didit] Decision retrieval failed:', response.status, result?.detail || result?.message || 'unknown error');
    throw new ApiError(response.status === 404 ? 404 : 502, 'Didit verification evidence is temporarily unavailable. Please retry.');
  }

  const rawStatus = String(result?.status || attempt.didit_status || '');
  // Sandbox outcomes are selectable simulations, not identity evidence. Keep
  // them pending and do not expose their media or trigger auto-approval.
  if (isSandboxResult(result)) {
    const { error: sandboxUpdateError } = await client.from('identity_verifications').update({
      status: 'pending_review',
      didit_status: `Sandbox test: ${rawStatus || 'completed'}`,
      decision: sanitizedDecision(result, rawStatus),
      completed_at: null,
    }).eq('didit_session_id', attempt.didit_session_id);
    if (sandboxUpdateError) throw new Error(sandboxUpdateError.message || 'Could not save the Didit sandbox result.');
    const { error: residentUpdateError } = await client.from('residents')
      .update({ identity_verification_status: 'pending_review' })
      .eq('id', residentId).eq('didit_session_id', attempt.didit_session_id);
    if (residentUpdateError) throw new Error(residentUpdateError.message || 'Could not update resident identity status.');
    return {
      status: 'pending_review', diditStatus: `Sandbox test: ${rawStatus || 'completed'}`,
      decision: sanitizedDecision(result, rawStatus), evidence: null, registrationApproved: false, sandbox: true,
    };
  }
  const status = resolveIdentityStatus(rawStatus, result) || attempt.status;
  const safeDecision = sanitizedDecision(result, rawStatus);
  const terminal = ['verified', 'declined', 'failed', 'expired'].includes(status);
  const { error: updateAttemptError } = await client.from('identity_verifications').update({
    status,
    didit_status: rawStatus,
    decision: safeDecision,
    completed_at: terminal ? new Date().toISOString() : null,
  }).eq('didit_session_id', attempt.didit_session_id);
  if (updateAttemptError) throw new Error(updateAttemptError.message || 'Could not save the Didit verification result.');

  const residentPatch = { identity_verification_status: status };
  if (status === 'verified') residentPatch.identity_verified_at = new Date().toISOString();
  const { error: residentUpdateError } = await client.from('residents')
    .update(residentPatch).eq('id', residentId).eq('didit_session_id', attempt.didit_session_id);
  if (residentUpdateError) throw new Error(residentUpdateError.message || 'Could not update resident identity status.');

  const registrationApproved = status === 'verified' ? await autoApproveResident(residentId) : false;

  return { status, diditStatus: rawStatus, decision: safeDecision, evidence: decisionMedia(result), registrationApproved };
};

export const syncOwnResult = async ({ user } = {}) => {
  if (!['resident', 'resident-limited'].includes(user?.role)) throw ApiError.forbidden('Only residents can sync their own Didit result.');
  const resident = await repository.getResidentByAuthUserId(user.id);
  if (!resident) throw ApiError.notFound('Your resident profile is not available yet.');
  const result = await getReviewEvidence(resident.id);
  return {
    status: result.status,
    diditStatus: result.diditStatus,
    decision: result.decision,
    registrationApproved: result.registrationApproved,
    sandbox: Boolean(result.sandbox),
  };
};

export const startSession = async ({ user, consent } = {}) => {
  configured();
  if (consent !== true) throw ApiError.badRequest('Consent is required before starting identity verification.');
  if (!['resident', 'resident-limited'].includes(user?.role)) throw ApiError.forbidden('Only residents can start identity verification.');

  const resident = await repository.getResidentByAuthUserId(user.id);
  if (!resident) throw ApiError.notFound('Your resident profile is not available yet.');
  if (isMinorAge(resident.birthDate)) {
    throw ApiError.forbidden('Didit identity verification is available for adult residents only.');
  }
  const age = ageFromDateOnly(resident.birthDate);
  if (age === null || age < 18) throw ApiError.forbidden('Didit identity verification is available for adult residents only.');
  if (resident.verificationStatus === 'approved') {
    throw ApiError.conflict('Your resident registration is already approved.');
  }

  const client = getServiceClient();
  const { data: identityState, error: identityStateError } = await client.from('residents')
    .select('identity_verification_status,identity_attempt_count,didit_session_id')
    .eq('id', resident.id).single();
  if (identityStateError) throw new Error(identityStateError.message || 'Could not read identity verification status.');
  if (identityState.identity_verification_status === 'verified') {
    throw ApiError.conflict('Your identity has already been verified.');
  }

  // Resume an unfinished hosted session when Didit still supplies its link.
  // If the session is terminal or the link has expired, continue below and
  // create a fresh attempt so the resident can retry.
  if (identityState.identity_verification_status === 'in_progress' && identityState.didit_session_id) {
    try {
      const currentResponse = await fetch(`${DIDIT_SESSION_URL}${encodeURIComponent(identityState.didit_session_id)}/decision/`, {
        headers: { 'x-api-key': env.diditApiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      const current = await currentResponse.json().catch(() => ({}));
      if (currentResponse.ok) {
        const currentStatus = resolveIdentityStatus(current?.status, current);
        const currentUrl = current?.session_url || current?.url;
        if (currentStatus === 'in_progress' && currentUrl) return { url: currentUrl, status: currentStatus, resumed: true };
        if (currentStatus && currentStatus !== 'in_progress') {
          const synced = await getReviewEvidence(resident.id);
          if (synced.status === 'verified') {
            throw ApiError.conflict('Your identity verification succeeded and your registration has been approved.');
          }
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409) throw error;
      console.warn(`[didit] Could not resume session for ${resident.id}; starting a new attempt: ${error?.message || 'unknown error'}`);
    }
  }

  const callback = env.clientUrl ? new URL('/verification-status?didit=complete', env.clientUrl).toString() : undefined;
  let response;
  try {
    response = await fetch(DIDIT_SESSION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.diditApiKey },
      body: JSON.stringify({
        workflow_id: env.diditWorkflowId,
        ...(callback ? { callback } : {}),
        vendor_data: resident.id,
        language: 'en',
        expected_details: {
          first_name: resident.firstName,
          last_name: resident.lastName,
          date_of_birth: resident.birthDate,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(502, 'Could not reach Didit. Please try again.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.session_id || !result?.url) {
    console.error('[didit] Session creation failed:', response.status, result?.detail || result?.message || 'unknown error');
    throw new ApiError(502, 'Didit could not start your identity check. Please try again later.');
  }

  const initialStatus = mapStatus(result.status) || 'in_progress';
  const attempt = {
    resident_id: resident.id,
    auth_user_id: user.id,
    didit_session_id: result.session_id,
    didit_session_number: Number.isInteger(result.session_number) ? result.session_number : null,
    vendor_data: resident.id,
    status: initialStatus,
    didit_status: String(result.status || 'Not Started'),
    workflow_id: result.workflow_id || env.diditWorkflowId,
    workflow_version: Number.isInteger(result.workflow_version) ? result.workflow_version : null,
    consented_at: new Date().toISOString(),
    consent_version: CONSENT_VERSION,
  };
  const { error: attemptError } = await client.from('identity_verifications')
    .upsert(attempt, { onConflict: 'didit_session_id' });
  if (attemptError) throw new Error(attemptError.message || 'Could not save the identity verification session.');

  const { error: residentError } = await client.from('residents').update({
    identity_verification_status: initialStatus,
    didit_session_id: result.session_id,
    identity_last_attempt_at: new Date().toISOString(),
    identity_attempt_count: Number(identityState.identity_attempt_count || 0)
      + (identityState.didit_session_id === result.session_id ? 0 : 1),
  }).eq('id', resident.id);
  if (residentError) throw new Error(residentError.message || 'Could not update resident identity verification status.');

  return { url: result.url, status: initialStatus };
};

export const handleWebhook = async ({ body, headers }) => {
  webhookConfigured();
  const signatures = [headers['x-signature-v2'], headers['x-signature-v2-previous']].filter(Boolean);
  if (!validSignature(body, headers['x-timestamp'], signatures)) {
    throw ApiError.unauthorized('Invalid Didit webhook signature.');
  }
  // Didit's console test payloads are signed but contain sample residents and
  // must never alter application data.
  if (String(headers['x-didit-test-webhook'] || '').toLowerCase() === 'true') return { received: true, test: true };

  const eventId = String(body?.event_id || '').trim();
  if (!eventId) throw ApiError.badRequest('Didit webhook event_id is required.');
  const client = getServiceClient();
  const { data: existing, error: lookupError } = await client.from('didit_webhook_events')
    .select('event_id').eq('event_id', eventId).maybeSingle();
  if (lookupError) throw new Error(lookupError.message || 'Could not check Didit webhook idempotency.');
  if (existing) return { received: true, duplicate: true };

  const type = String(body?.webhook_type || '');
  const sessionId = String(body?.session_id || '');
  const rawStatus = String(body?.status || '');
  if (isSandboxResult(body)) {
    const { error: sandboxEventError } = await client.from('didit_webhook_events').insert({
      event_id: eventId, webhook_type: type, didit_session_id: sessionId || null,
      status: `Sandbox test: ${rawStatus}`,
    });
    if (sandboxEventError && sandboxEventError.code !== '23505') {
      throw new Error(sandboxEventError.message || 'Could not record the Didit sandbox event.');
    }
    return { received: true, sandbox: true };
  }
  if (type === 'status.updated' && sessionId) {
    const nextStatus = resolveIdentityStatus(rawStatus, body?.decision);
    if (nextStatus) {
      const { data: attempt, error: attemptLookupError } = await client.from('identity_verifications')
        .select('resident_id').eq('didit_session_id', sessionId).maybeSingle();
      if (attemptLookupError) throw new Error(attemptLookupError.message || 'Could not find the Didit session.');
      if (attempt) {
        const terminal = ['verified', 'declined', 'failed', 'expired'].includes(nextStatus);
        const { error: updateAttemptError } = await client.from('identity_verifications').update({
          status: nextStatus,
          didit_status: rawStatus,
          decision: sanitizedDecision(body?.decision, rawStatus),
          completed_at: terminal ? new Date().toISOString() : null,
        }).eq('didit_session_id', sessionId);
        if (updateAttemptError) throw new Error(updateAttemptError.message || 'Could not save the Didit result.');

        const residentPatch = { identity_verification_status: nextStatus };
        if (nextStatus === 'verified') residentPatch.identity_verified_at = new Date().toISOString();
        const { error: residentUpdateError } = await client.from('residents')
          .update(residentPatch).eq('id', attempt.resident_id).eq('didit_session_id', sessionId);
        if (residentUpdateError) throw new Error(residentUpdateError.message || 'Could not update resident identity status.');
        if (nextStatus === 'verified') await autoApproveResident(attempt.resident_id);
      }
    }
  }

  const { error: eventError } = await client.from('didit_webhook_events').insert({
    event_id: eventId,
    webhook_type: type,
    didit_session_id: sessionId || null,
    status: rawStatus,
  });
  if (eventError && eventError.code !== '23505') throw new Error(eventError.message || 'Could not record Didit webhook event.');
  return { received: true };
};

export default { getLatestForResident, getReviewEvidence, syncOwnResult, startSession, handleWebhook };
