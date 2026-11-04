import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import { getEmailTransporter, sendSmtpMail } from './email.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGED_ROLES = new Set(['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw']);
const ACCESS_EVENTS = new Set(['approved', 'reactivated', 'invitation']);
const PROFILE_COLUMNS = 'id,email,full_name,role,status';
const ACCOUNT_COLUMNS = 'account_id,approval_status,activation_requested,setup_required,setup_completed_at,suspended_at,decision_reason';
const WORKER_ERROR_CODES = new Set([
  'PROFILE_READ_FAILED', 'ACCOUNT_READ_FAILED', 'ACCOUNT_IDENTITY_MISMATCH',
  'AUTH_USER_READ_FAILED', 'AUTH_IDENTITY_MISMATCH', 'AUTH_LINK_GENERATION_FAILED',
  'AUTH_LINK_IDENTITY_MISMATCH', 'AUTH_LINK_INVALID', 'AUTH_REDIRECT_MISMATCH',
  'SMTP_NOT_CONFIGURED', 'CLIENT_URL_NOT_CONFIGURED', 'CLIENT_URL_INVALID',
  'NOTIFICATION_BEGIN_FAILED',
]);
let activeBatch = null;
let stopCurrentWorker = null;

const failure = (code) => Object.assign(new Error(code), { code });
const emailOf = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = (value) => /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(value);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const log = (logger, level, job, code) => {
  // Codes are application-owned constants; no raw provider errors or PII.
  try {
    logger[level]?.('personnel_notification', {
      notificationId: UUID.test(job?.id || '') ? job.id : null,
      accountId: UUID.test(job?.account_id || '') ? job.account_id : null,
      code,
    });
  } catch { /* Logging must not turn an accepted send into a retry. */ }
};

const emptyResult = () => ({
  claimed: 0, mailServerAccepted: 0, failed: 0, deliveryUnknown: 0,
  cancelled: 0, notStarted: 0, unfinalized: 0,
});

const clientOrigin = (config) => {
  if (!config.clientUrl) throw failure('CLIENT_URL_NOT_CONFIGURED');
  try {
    const url = new URL(config.clientUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash
      || (url.protocol === 'http:' && (!local || config.isProduction))) {
      throw failure('CLIENT_URL_INVALID');
    }
    return url.origin;
  } catch {
    throw failure('CLIENT_URL_INVALID');
  }
};

const eventStillValid = (job, account) => ACCESS_EVENTS.has(job.event_type)
  ? account.approval_status === 'approved' && !account.suspended_at
  : job.event_type === 'rejected' ? account.approval_status === 'rejected'
    : job.event_type === 'suspended' && Boolean(account.suspended_at);

const buildMail = ({ job, account, profile, origin, actionLink, needsSetup, authConfirmed, config }) => {
  const titlePrefix = profile.role === 'admin' ? 'Administrative' : 'Health Personnel';
  const accountLabel = profile.role === 'admin' ? 'administrative account' : 'health personnel account';
  const titles = {
    approved: `${titlePrefix} Account Approved`,
    reactivated: `${titlePrefix} Account Reactivated`,
    invitation: `${titlePrefix} Password Setup`,
    rejected: `${titlePrefix} Account Request Rejected`,
    suspended: `${titlePrefix} Account Suspended`,
  };
  const paragraphs = [profile.full_name ? `Hello ${profile.full_name},` : 'Hello,'];
  let link = null;
  let linkLabel = null;
  if (job.event_type === 'rejected' || job.event_type === 'suspended') {
    paragraphs.push(job.event_type === 'rejected'
      ? `Your ${accountLabel} request has been rejected. This notice does not grant access to KALUSAGAP.`
      : `Your ${accountLabel} has been suspended. Access to KALUSAGAP is disabled.`);
    paragraphs.push(`Reason: ${job.reason || account.decision_reason || 'Please contact your administrator for the decision details.'}`);
  } else {
    paragraphs.push(job.event_type === 'approved' ? `Your ${accountLabel} has been approved.`
      : job.event_type === 'reactivated' ? `Your administrator has removed the suspension from your approved ${accountLabel}.`
        : `Your administrator has invited you to set up your approved ${accountLabel}.`);
    if (needsSetup) {
      paragraphs.push('Approval alone does not grant access. Your account remains inactive until you complete password setup.');
      paragraphs.push(account.activation_requested
        ? 'Activation has been requested. Complete password setup before signing in.'
        : 'Access has not been enabled by your administrator. Completing password setup does not override that decision.');
      link = actionLink;
      linkLabel = 'Set Your Password';
    } else {
      const active = account.activation_requested && profile.status === 'active' && authConfirmed;
      paragraphs.push(active
        ? 'Your account is active. Sign in using your existing credentials; they have not been changed.'
        : 'Your account is approved, but access is not currently active. Your existing credentials have not been changed. Contact your administrator about activation.');
      link = `${origin}/login`;
      linkLabel = 'Sign In';
    }
  }
  const footer = needsSetup
    ? 'This is an expiring, one-time password setup link. Its expiration is controlled by the account security policy. Do not share it. If it has expired, contact your administrator for a new invitation.'
    : 'If you did not expect this notice, contact your KALUSAGAP administrator.';
  // A fixed Message-ID is for traceability only, not SMTP idempotence.
  return {
    from: config.smtpFrom,
    to: { address: profile.email.trim() },
    messageId: `<personnel-${job.id}@notifications.kalusagap.local>`,
    subject: `KALUSAGAP ${titles[job.event_type]}`,
    text: [...paragraphs, ...(link ? [`${linkLabel}: ${link}`] : []), footer].join('\n\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:18px;">${titles[job.event_type]}</h1>
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n')}
      ${link ? `<p><a href="${escapeHtml(link)}">${linkLabel}</a></p>` : ''}
      <p>${escapeHtml(footer)}</p>
    </div>`,
  };
};

const smtpFailure = (error) => {
  const rejected = error.responseCode >= 400 && error.responseCode <= 599 && error.smtpPhase !== 'after_send';
  const knownBeforeData = ['EAUTH', 'ENOAUTH', 'EOAUTH2', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)
    || ['handshake', 'envelope'].includes(error.smtpPhase)
    || (error.beforeData && error.code !== 'SMTP_ERROR' && !['data', 'after_send'].includes(error.smtpPhase));
  return {
    status: rejected || knownBeforeData ? 'failed' : 'delivery_unknown',
    code: error.code === 'SMTP_ERROR' ? 'SMTP_OUTCOME_UNKNOWN' : `SMTP_${error.code}`,
    providerId: null,
  };
};

const smtpResult = (info, message) => {
  const includesRecipient = (list) => Array.isArray(list)
    && list.some((recipient) => emailOf(recipient?.address || recipient) === emailOf(message.to.address));
  const accepted = includesRecipient(info?.accepted);
  const rejected = includesRecipient(info?.rejected);
  const finalReply = String(info?.response || '').trim().split(/\r?\n/).at(-1);
  const responseCode = Number(finalReply.match(/^(\d{3})(?:\s|$)/)?.[1]);
  if (accepted && !rejected && !includesRecipient(info?.pending)
    && responseCode >= 200 && responseCode <= 299 && info?.messageId === message.messageId) {
    return { status: 'sent', code: 'SMTP_ACCEPTED', providerId: info.messageId };
  }
  if (Array.isArray(info?.accepted) && info.accepted.length === 0 && rejected) {
    return { status: 'failed', code: 'SMTP_RECIPIENT_REJECTED', providerId: null };
  }
  return { status: 'delivery_unknown', code: 'SMTP_ACCEPTANCE_UNVERIFIED', providerId: null };
};

/** Service-role only. targetId is an account ID; links never leave this worker. */
export const processPersonnelNotifications = ({
  targetId = null, limit = 10, supabase, transport, config = env, logger = console,
} = {}) => {
  if (activeBatch) return Promise.resolve({ ...emptyResult(), errorCode: 'WORKER_BUSY' });
  activeBatch = (async () => {
    const result = emptyResult();
    if (!supabase && !config.isSupabaseConfigured) {
      log(logger, 'warn', null, 'SUPABASE_NOT_CONFIGURED');
      return { ...result, errorCode: 'SUPABASE_NOT_CONFIGURED' };
    }
    if (targetId !== null && !UUID.test(targetId)) {
      log(logger, 'error', null, 'NOTIFICATION_TARGET_INVALID');
      return { ...result, errorCode: 'NOTIFICATION_TARGET_INVALID' };
    }
    let client;
    let jobs;
    try {
      client = supabase || getServiceClient();
      const { data, error } = await client.rpc('claim_personnel_notifications', {
        p_limit: Math.min(100, Math.max(1, Math.floor(Number(limit) || 10))),
        p_target_id: targetId,
      });
      if (error || !Array.isArray(data)) throw failure('NOTIFICATION_CLAIM_FAILED');
      jobs = data;
    } catch {
      log(logger, 'error', null, 'NOTIFICATION_CLAIM_FAILED');
      return { ...result, errorCode: 'NOTIFICATION_CLAIM_FAILED' };
    }
    result.claimed = jobs.length;
    const seen = new Set();
    await Promise.all(jobs.map(async (job) => {
      if (!UUID.test(job?.id || '') || !UUID.test(job?.account_id || '')
        || !UUID.test(job?.claim_token || '') || job.status !== 'processing' || seen.has(job.id)) {
        result.notStarted += 1;
        log(logger, 'warn', job, 'NOTIFICATION_CLAIM_INVALID');
        return;
      }
      seen.add(job.id);
      const finish = async (status, code, providerId = null) => {
        try {
          const { data, error } = await client.rpc('finish_personnel_notification', {
            p_notification_id: job.id, p_claim_token: job.claim_token,
            p_status: status, p_error_code: status === 'sent' ? null : code,
            p_provider_id: providerId,
          });
          if (error || data !== true) throw failure('NOTIFICATION_FINALIZE_FAILED');
          if (status === 'failed') result.failed += 1;
          if (status === 'delivery_unknown') result.deliveryUnknown += 1;
          if (status === 'cancelled') result.cancelled += 1;
          log(logger, status === 'sent' || status === 'cancelled' ? 'info' : 'warn', job, code);
        } catch {
          result.unfinalized += 1;
          // In particular, NEVER turn an accepted send into a failed/retry job.
          // Stale sending leases are parked delivery_unknown by the claim RPC.
          log(logger, 'error', job, 'NOTIFICATION_FINALIZE_FAILED');
        }
      };
      let message;
      let smtp;
      try {
        const [{ data: account, error: accountError }, { data: profile, error: profileError }] = await Promise.all([
          client.from('personnel_accounts').select(ACCOUNT_COLUMNS).eq('account_id', job.account_id).maybeSingle(),
          client.from('profiles').select(PROFILE_COLUMNS).eq('id', job.account_id).maybeSingle(),
        ]);
        if (accountError) throw failure('ACCOUNT_READ_FAILED');
        if (profileError) throw failure('PROFILE_READ_FAILED');
        if (!account || !profile || !MANAGED_ROLES.has(profile.role) || !eventStillValid(job, account)) {
          await finish('cancelled', 'NOTIFICATION_LIFECYCLE_CHANGED');
          return;
        }
        if (account.account_id !== job.account_id || profile.id !== job.account_id || !validEmail(profile.email)) {
          throw failure('ACCOUNT_IDENTITY_MISMATCH');
        }
        const needsSetup = ACCESS_EVENTS.has(job.event_type) && account.setup_required === true && !account.setup_completed_at;
        if (job.event_type === 'invitation' && !needsSetup) {
          await finish('cancelled', 'NOTIFICATION_SETUP_COMPLETED');
          return;
        }
        const { data: authData, error: authError } = await client.auth.admin.getUserById(job.account_id);
        if (authError) throw failure('AUTH_USER_READ_FAILED');
        const authUser = authData?.user;
        if (authUser?.id !== job.account_id || !validEmail(authUser.email)
          || emailOf(authUser.email) !== emailOf(profile.email)) throw failure('AUTH_IDENTITY_MISMATCH');
        if (!config.smtpHost || !config.smtpUser || !config.smtpPassword || !config.smtpFrom
          || (transport && typeof transport.sendMail !== 'function')) throw failure('SMTP_NOT_CONFIGURED');
        smtp = transport || getEmailTransporter();
        const origin = ACCESS_EVENTS.has(job.event_type) ? clientOrigin(config) : null;
        let actionLink = null;
        if (needsSetup) {
          const type = authUser.email_confirmed_at ? 'recovery' : 'invite';
          const redirectTo = `${origin}/reset-password`;
          const { data: generated, error: linkError } = await client.auth.admin.generateLink({
            type, email: authUser.email, options: { redirectTo },
          });
          if (linkError) throw failure('AUTH_LINK_GENERATION_FAILED');
          if (generated?.user?.id !== job.account_id || emailOf(generated?.user?.email) !== emailOf(authUser.email)) {
            throw failure('AUTH_LINK_IDENTITY_MISMATCH');
          }
          try {
            const url = new URL(generated?.properties?.action_link);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
              || (url.protocol === 'http:' && (config.isProduction || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
              || url.searchParams.get('type') !== type
              || (!url.searchParams.get('token') && !url.searchParams.get('token_hash'))) {
              throw failure('AUTH_LINK_INVALID');
            }
            if (url.searchParams.get('redirect_to') !== redirectTo) throw failure('AUTH_REDIRECT_MISMATCH');
            actionLink = url.href;
          } catch (error) {
            throw failure(error?.code === 'AUTH_REDIRECT_MISMATCH' ? error.code : 'AUTH_LINK_INVALID');
          }
        }
        message = buildMail({ job, account, profile, origin, actionLink, needsSetup, authConfirmed: Boolean(authUser.email_confirmed_at), config });
        const { data: begun, error: beginError } = await client.rpc('begin_personnel_notification_send', {
          p_notification_id: job.id, p_claim_token: job.claim_token,
        });
        if (beginError) throw failure('NOTIFICATION_BEGIN_FAILED');
        if (begun !== true) {
          result.notStarted += 1;
          log(logger, 'info', job, 'NOTIFICATION_NOT_SENDABLE');
          return;
        }
      } catch (error) {
        await finish('failed', WORKER_ERROR_CODES.has(error?.code) ? error.code : 'NOTIFICATION_PREPARE_FAILED');
        return;
      }
      let outcome;
      try {
        outcome = smtpResult(await sendSmtpMail(message, { transport: smtp }), message);
      } catch (error) {
        outcome = smtpFailure(error);
      }
      if (outcome.status === 'sent') result.mailServerAccepted += 1;
      await finish(outcome.status, outcome.code, outcome.providerId);
    }));
    return result;
  })().catch(() => {
    log(logger, 'error', null, 'NOTIFICATION_WORKER_FAILED');
    return { ...emptyResult(), errorCode: 'NOTIFICATION_WORKER_FAILED' };
  }).finally(() => { activeBatch = null; });
  return activeBatch;
};

/** Called by server.js only. The returned stop function drains in-flight work. */
export const startPersonnelNotificationWorker = (options = {}) => {
  if (stopCurrentWorker) return stopCurrentWorker;
  const config = options.config || env;
  const logger = options.logger || console;
  if (!options.supabase && !config.isSupabaseConfigured) {
    log(logger, 'warn', null, 'SUPABASE_NOT_CONFIGURED');
    return async () => {};
  }
  const interval = Math.min(3_600_000, Math.max(10_000, Number(config.personnelNotificationIntervalMs) || 60_000));
  let stopped = false;
  const run = () => {
    if (!stopped && !activeBatch) void processPersonnelNotifications({ ...options, config, logger });
  };
  const timer = setInterval(run, interval);
  timer.unref();
  let stopping = null;
  const stop = () => {
    if (!stopping) {
      stopped = true;
      clearInterval(timer);
      stopping = Promise.resolve(activeBatch).finally(() => {
        if (stopCurrentWorker === stop) stopCurrentWorker = null;
      });
    }
    return stopping;
  };
  stopCurrentWorker = stop;
  run();
  return stop;
};

export default { processPersonnelNotifications, startPersonnelNotificationWorker };
